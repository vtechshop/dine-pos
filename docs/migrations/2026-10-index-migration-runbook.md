# Production migration runbook — indexes and new fields (2026-10)

**Status: PREPARED, NOT EXECUTED.** Nothing in this runbook has been run against
staging or production. Every step that writes to a database is marked ⚠ WRITE and
must be run manually by an operator, in a maintenance window, after the backup in
step 1 has been verified.

Supersedes the short note in `2026-10-guest-qrSessionToken-index.md`.

---

## 0. What changes, and why

| # | Collection | Old index | New index (as defined in code) | Why |
|---|---|---|---|---|
| A | `guests` | `qrSessionToken_1` `{qrSessionToken:1}` `{unique:true, sparse:true}` | `qrSessionToken_unique_string` `{qrSessionToken:1}` `{unique:true, partialFilterExpression:{qrSessionToken:{$type:'string'}}}` | `qrSessionToken` defaults to `null` and is set to `null` for staff-created guests and **every billed guest**. A sparse index still indexes explicit `null`, so where the old index is built the **second guest with a null token fails with E11000** (billing/adding guests breaks). |
| B | `hotels` | `parentHotelId_1_branchCode_1` defined with **both** `sparse` and `partialFilterExpression` — MongoDB rejects that spec, so it was **never built** | `{parentHotelId:1, branchCode:1}` `{unique:true, partialFilterExpression:{parentHotelId:{$type:'objectId'}, branchCode:{$gt:''}}}` | Branch-code uniqueness inside an organisation has never been enforced. |

New fields (all additive, with defaults — **no backfill required for correctness**):

| Collection | Field(s) | Default | Notes |
|---|---|---|---|
| `orders` | `additionalDiscount`, `refundMethod`, `settledVia` | `0`, `''`, `''` | Old orders: shift cash counts them by the legacy rule (createdAt fallback). |
| `guests` | `collectedAmount`, `cashCollected` | `null`, `null` | `null` = billed before this release → excluded from the new guest-bill shift source; their orders are still counted by the legacy order rule. |
| `tablesessions` | `billingStartedAt`, `billedAt`, `billPaymentMethod`, `billSplitDetails`, `giftVoucherAmount`, `collectedAmount`, `cashCollected` | `null` / `0` | Open sessions at deploy time are unaffected. |
| `refreshtokens` | `actingOrgId` | `null` | HQ admins already "inside" a branch must return to HQ once to hop branches again. |
| `tickets` | `hotelId` | absent | Legacy tickets are matched by the hotel's registered phone. |

**Shift transition note:** a shift that is **open during the deploy** mixes old and
new rules. Close all shifts before deploying, or expect a one-time difference on
that shift.

### Mongoose `autoIndex`
`autoIndex` is not disabled, so **every app instance builds missing indexes when it
connects**. On deploy, index B and index A (new name) will be created automatically
if the data allows; a failure is only logged. **Recommended:** create the indexes
manually in step 5 *before* deploying, so the deploy is a no-op for indexes and any
failure is seen by an operator, not hidden in logs.

---

## 1. Pre-migration backup and verification

1. Atlas: take an **on-demand snapshot** of the production cluster (or confirm a
   continuous-backup restore point within the last few minutes).
2. Additionally export the affected collections (read-only on prod):
   ```bash
   mongodump --uri="$PROD_URI_READONLY" --db=hotelbillingpos \
     --collection=guests  --out=backup-2026-10
   mongodump --uri="$PROD_URI_READONLY" --db=hotelbillingpos \
     --collection=hotels  --out=backup-2026-10
   ```
3. **Verify the backup**: restore it into a scratch database and compare counts:
   ```bash
   mongorestore --uri="$SCRATCH_URI" --nsFrom='hotelbillingpos.*' --nsTo='restorecheck.*' backup-2026-10
   ```
   ```js
   // in both prod (read-only) and scratch:
   db.guests.countDocuments({}); db.hotels.countDocuments({});
   ```
   Do not continue unless the counts match.
4. Record the current index list (paste into the change ticket):
   ```js
   db.guests.getIndexes(); db.hotels.getIndexes();
   ```

## 2. Staging migration (full rehearsal)

1. Restore the step-1 snapshot into the **staging** cluster (never point staging
   at production).
2. Deploy this release to staging with `NODE_ENV=production` semantics (see the
   staging note in the audit: `NODE_ENV=staging` enables dev-only routes).
3. Run steps 3–6 on staging exactly as written. Time each step.
4. Run the staging device test plan (`docs/staging-device-test-plan.md`), including
   billing two guests at one table and creating two branches.
5. Only proceed to production if every validation query in step 6 passes on staging.

## 3. Inspect existing indexes (read-only)

```js
// A — guests
db.guests.getIndexes().filter(i => i.key && i.key.qrSessionToken)
// Expect one of:
//   (a) qrSessionToken_1 {unique, sparse}  → old index IS built (see step 4A)
//   (b) nothing                              → old index never built (common if nulls existed)
//   (c) qrSessionToken_unique_string         → new index already present

// B — hotels
db.hotels.getIndexes().filter(i => i.key && i.key.branchCode)
// Expect: nothing (old spec was invalid). If an index with this key exists with
// different options, note its name — it must be dropped before creating the new one.
```

## 4. Detect duplicate or invalid data (read-only)

**A. Guest tokens** — real (string) tokens must be unique:
```js
db.guests.aggregate([
  { $match: { qrSessionToken: { $type: 'string' } } },
  { $group: { _id: '$qrSessionToken', n: { $sum: 1 }, ids: { $push: '$_id' } } },
  { $match: { n: { $gt: 1 } } },
])
// Must return nothing. Informational:
db.guests.countDocuments({ qrSessionToken: null })
db.guests.countDocuments({ qrSessionToken: { $exists: true, $not: { $type: ['string', 'null'] } } }) // must be 0
```

**B. Branch codes** — must be unique per organisation:
```js
db.hotels.aggregate([
  { $match: { parentHotelId: { $type: 'objectId' }, branchCode: { $gt: '' } } },
  { $group: { _id: { org: '$parentHotelId', code: '$branchCode' }, n: { $sum: 1 }, ids: { $push: '$_id' } } },
  { $match: { n: { $gt: 1 } } },
])
```
If B returns rows: **stop**. Duplicate branch codes need a business decision
(which branch keeps the code). Do not edit them as part of this migration.

## 5. Exact index changes (⚠ WRITE — maintenance window, after steps 1–4)

**A. Guests** — create the new index first, then drop the old one:
```js
// ⚠ WRITE
db.guests.createIndex(
  { qrSessionToken: 1 },
  { unique: true, partialFilterExpression: { qrSessionToken: { $type: 'string' } }, name: 'qrSessionToken_unique_string' }
)
// Only if step 3A found qrSessionToken_1, and the createIndex above succeeded:
// ⚠ WRITE
db.guests.dropIndex('qrSessionToken_1')
```
The old index must **not** be dropped automatically or before the new one exists:
while only the old index exists, real tokens are still protected.

**B. Hotels** (only if step 4B returned nothing):
```js
// ⚠ WRITE
db.hotels.createIndex(
  { parentHotelId: 1, branchCode: 1 },
  { unique: true, partialFilterExpression: { parentHotelId: { $type: 'objectId' }, branchCode: { $gt: '' } }, name: 'parentHotelId_1_branchCode_1' }
)
```

No documents are modified by steps A or B.

## 6. Validation queries

```js
db.guests.getIndexes().map(i => [i.name, i.unique, i.partialFilterExpression])
// expect qrSessionToken_unique_string with partialFilterExpression; no qrSessionToken_1

db.hotels.getIndexes().filter(i => i.name === 'parentHotelId_1_branchCode_1')
// expect exactly one, unique, with partialFilterExpression

// Index is used for token lookups:
db.guests.find({ qrSessionToken: 'x' }).explain('queryPlanner').queryPlanner.winningPlan
```
On **staging only** (write tests):
- create two guests without a token at one table → both succeed;
- bill both guests individually → both succeed;
- create two branches with the same `branchCode` in one org → the second fails with 11000;
- the same `branchCode` in two different orgs → succeeds.

## 7. Rollback / recovery

- Index changes are reversible and touch no documents.
  - Drop the new index: `db.guests.dropIndex('qrSessionToken_unique_string')`,
    `db.hotels.dropIndex('parentHotelId_1_branchCode_1')`.
  - Re-create the old guest index **only if needed**:
    `db.guests.createIndex({ qrSessionToken: 1 }, { unique: true, sparse: true })`
    — this fails if more than one guest has `qrSessionToken: null` (expected), and
    while it exists, billing a second guest fails. Prefer leaving it dropped.
- Application rollback: redeploy the previous release. The new fields are ignored
  by old code; no data clean-up is needed.
- Data recovery: only via the step-1 snapshot (no step in this runbook deletes data).

## 8. Production post-migration checks (first 24 h)

- Error logs: no `E11000` on `guests` / `hotels`.
- Bill at least one table with two guests; place one QR prepaid order and bill the
  table (amount due excludes the online payment).
- Open and close one shift; compare expected cash with the drawer.
- Create a branch (if any org uses multi-branch) with a new code.
- `db.guests.getIndexes()` / `db.hotels.getIndexes()` on every replica-set member
  (same result).

---

## Related indexes that need the same review (NOT changed in this release)

Verified on a disposable MongoDB: a `unique + sparse` index rejects a **second
document whose field is `null`**, and these models store `null` by default. Where
these indexes are built, the second such document fails with E11000:

| Model | Index | Effect where built |
|---|---|---|
| `GRN` | `{hotelId, idempotencyKey}` unique sparse, key default `null` | 2nd GRN per hotel without key fails |
| `VendorPayment` | same pattern | 2nd vendor payment per hotel fails |
| `VendorReturn` | same pattern | 2nd vendor return per hotel fails |
| `LoyaltyTransaction` | `{idempotencyKey}` unique sparse, default `null` | 2nd keyless loyalty tx **across all hotels** fails |
| `CustomerProfile` | `{hotelId, phone}` unique sparse, `phone` default `null` | 2nd phoneless profile per hotel fails |
| `OrganizationCustomer` | `{orgHotelId, canonicalPhone}` same pattern | 2nd phoneless org customer fails |

Check in production (read-only) with `getIndexes()` on each collection. Production
works today most likely because these indexes **failed to build** (duplicates of
`null` already existed) — which also means their uniqueness/idempotency is not
enforced. A fresh environment (staging restore with index build, new region) would
break. Fix pattern (separate change, same runbook shape): replace `sparse` with
`partialFilterExpression: { <field>: { $type: 'string' } }` under a new index name.
