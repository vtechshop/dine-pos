# MULTI-BRANCH LOYALTY — SPRINT 1 AUDIT

**Date:** 2026-09-16
**Sprint:** Audit Only — No code changes
**Auditor:** Claude Sonnet 4.6

---

## 1. Executive Summary

The DinePOS loyalty system is architecturally sound for single-branch operation.
Every security invariant (server-authoritative balance, atomic redeem guard, OTP hash,
no-negative-balance enforcement) is correctly implemented.

However, the system is **entirely branch-scoped**. The loyalty balance lives on
`CustomerProfile.loyaltyBalance` — a field tied to a single hotel. `OrganizationCustomer`
has zero loyalty fields. `LoyaltyTransaction` has no `orgCustomerId` or `branchHotelId`.

Cross-branch loyalty redemption (earn at Branch A, redeem at Branch B) cannot be safely
added without:
1. An org-level balance field (on `OrganizationCustomer` or a dedicated ledger)
2. `orgCustomerId` + `branchHotelId` on `LoyaltyTransaction`
3. Org-aware earn/redeem utility functions
4. Offline redemption guard (currently `redeemedPoints` is not blocked in offline queue)
5. Resolution of three ambiguous business rules (settings, opt-out scope, earn-during-unlinked)

**Final verdict:** ARCHITECTURE GAP — DESIGN DECISION REQUIRED

---

## 2. Existing Loyalty Architecture

### Files

| File | Role |
|------|------|
| `backend/src/models/LoyaltyTransaction.ts` | Append-only ledger |
| `backend/src/models/LoyaltyOtp.ts` | OTP for redemption |
| `backend/src/models/CustomerProfile.ts` | Branch customer — holds `loyaltyBalance` |
| `backend/src/models/OrganizationCustomer.ts` | Org identity — NO loyalty fields |
| `backend/src/routes/loyaltyRoutes.ts` | Customer CRUD, adjust, OTP send/verify, stats |
| `backend/src/utils/loyaltyUtils.ts` | earnPoints, redeemPoints, reverseEarnedPoints, adjustPoints |
| `backend/src/workers/loyaltyExpiryWorker.ts` | Daily sweep: expires stale earn transactions |
| `backend/src/routes/orderRoutes.ts` | Earn on order complete; redeem in order transaction |
| `backend/src/routes/guestRoutes.ts` | Earn + redeem on table-service billing |
| `web/src/utils/offlineQueue.ts` | Offline order queue (redeemedPoints not currently blocked) |
| `web/src/api/loyalty.ts` | Frontend loyalty API calls |

### Feature gate

Loyalty is gated by `requireFeature('loyaltyProgram')`. The flag is per-hotel
(`hotel.features.loyaltyProgram`), resolved via `resolveHotelStatus(hotelId)`.

---

## 3. OrganizationCustomer Architecture

### Schema (actual fields)

```
orgHotelId      ObjectId   — HQ hotel
canonicalPhone  string     — normalized digits
canonicalEmail  string     — lowercase trimmed
displayName     string
status          active | suspended
```

**No loyalty-related fields exist on OrganizationCustomer.**

### Linking rules (explicit-only)

- `POST /api/org-customers/:id/link` — sets `CustomerProfile.orgCustomerId`
- `DELETE /api/org-customers/:id/links/:profileId` — clears `orgCustomerId`
- Loyalty balances are NEVER modified on link or unlink
- No auto-link on phone/email match — candidate search only (`GET /candidates/:profileId`)
- Profile must belong to a hotel in the org (HQ or branch) — enforced server-side
- Linking requires admin role

### Gap

`OrganizationCustomer` has no concept of loyalty. An org customer with two linked
profiles (Branch A, Branch B) has two independent `loyaltyBalance` values that can
never be combined or redeemed cross-branch as the model stands.

---

## 4. Current Loyalty Balance Model

```
CustomerProfile (per hotel/branch)
  loyaltyBalance: number   — denormalized snapshot of the ledger sum
```

```
LoyaltyTransaction (per hotel/branch)
  customerId    → CustomerProfile._id
  hotelId       → hotel (branch or standalone)
  transactionType: earn | redeem | adjust | reverse | expire | transfer_in | transfer_out
  points        — positive (earn) or negative (redeem/expire/reverse)
  balanceAfter  — snapshot after this transaction
```

### Critical findings

1. **Balance lives on `CustomerProfile`, not `OrganizationCustomer`.**
   Branch A CustomerProfile has its own `loyaltyBalance`. Branch B has its own.
   They are independent and cannot be combined without a new org-level field.

2. **LoyaltyTransaction has no `orgCustomerId` field.**
   A transaction at Branch A for a linked customer has no reference to the
   OrganizationCustomer. An org-level query must join via CustomerProfile.orgCustomerId,
   which is expensive and not indexed for this pattern.

3. **All `loyaltyBalance` mutation functions in `loyaltyUtils.ts` take `hotelId` as a
   required parameter and filter `CustomerProfile` by `{ _id, hotelId }`.** Cross-branch
   operation would require a different filter and a different balance field.

---

## 5. Current Earning Flow

### Staff POS (orderRoutes.ts — order completion)

```
PATCH /api/orders/:id  (action: 'complete' or equivalent)
  → atomic claim: Order.findOneAndUpdate({ _id, loyaltyEarnedAt: null }, $set loyaltyEarnedAt: now)
  → skip if Payment.loyaltyEarnedAt already set (gateway-paid orders)
  → CustomerProfile.findOne({ hotelId: req.hotelId, phone, status: { $ne: 'merged' } })
  → calculateEarnedPoints(earnBase, loyaltyCfg)
  → earnPoints(profile._id, req.hotelId, pts, config, ctx)
    → CustomerProfile.findOneAndUpdate({ _id, hotelId, status: 'active', loyaltyOptOut: $ne true }, $inc loyaltyBalance: pts)
    → LoyaltyTransaction.create({ customerId, hotelId, ... })
```

**Earn base:** Configurable — `calculationBase === 'before_gst'` uses `grandTotal - taxTotal`;
`after_gst` uses `grandTotal`.

**Idempotency:** `Order.loyaltyEarnedAt` — set atomically via `findOneAndUpdate({ loyaltyEarnedAt: null })`.
A race or retry gets null back and skips. Sound for single-branch.

### Table service (guestRoutes.ts — guest billing)

```
PATCH /api/sessions/:sessionId/guests/:guestId  (action: 'bill')
  → H-07 atomic guard: Guest.findOneAndUpdate({ _id, status: 'active' }, $set billing fields)
  → earn points fire-and-forget after guard
  → Guest.loyaltyEarnedAt used as idempotency guard
  → earnPoints(guest.customerId, req.hotelId, pts, config, ctx)
```

**Redemption in table billing:** Pre-computed before H-07 guard; actual deduction (`redeemLoyaltyPts`)
happens after H-07 atomically on the Guest record.

---

## 6. Current Redemption Flow

### Staff POS (orderRoutes.ts — order creation)

```
POST /api/orders
  → H1: server cap: verifiedLoyaltyDiscount = min(client loyalty discount, points × rate)
  → H1: prefetch CustomerProfile { hotelId: req.hotelId, phone, status: 'active' }
  → MongoDB session (transaction):
      → order.save()
      → redeemPoints(profile._id, req.hotelId, points, config, ctx)
          → CustomerProfile.findOneAndUpdate({
              _id, hotelId, status: 'active', loyaltyOptOut: $ne true,
              loyaltyBalance: { $gte: points }   ← atomic guard: no negative balance
            }, $inc loyaltyBalance: -points)
          → LoyaltyTransaction.create({ customerId, hotelId, transactionType: 'redeem', ... })
```

**Security note:** `loyaltyDiscount` from client is capped server-side. The actual balance
deduction is inside a MongoDB transaction — if the order save fails, the points are not deducted.

### OTP verification (loyaltyRoutes.ts)

`POST /api/loyalty/otp/verify` does NOT deduct points. It only:
- Validates OTP hash
- Marks OTP as used (`usedAt = now`)
- Returns `discountValue` preview

The actual deduction happens in `orderRoutes.ts` when the order is created with
`redeemedPoints > 0`. This means an OTP verify does not atomically guarantee a reservation
of points — there is a window between OTP verify and order creation where another
concurrent request could deplete the balance. This is handled by the `$gte: points`
guard in `redeemPoints()` — the deduction will fail with "Insufficient" if balance was
depleted concurrently. This is correct but does mean the cashier may need to re-verify.

---

## 7. Current Refund/Cancellation Flow

### Order cancellation (orderRoutes.ts)

```
PATCH /api/orders/:id  (action: 'cancel')
  → fire-and-forget async block:
      → 1. Reverse earned points:
           a. Via Payment.loyaltyEarnPoints (Razorpay path):
              atomic claim: Payment.findOneAndUpdate({ _id, loyaltyReversedAt: null }, $set loyaltyReversedAt: now)
              → reverseEarnedPoints(profile, hotelId, points, ...)
           b. Via Order.loyaltyEarnedAt (non-gateway path):
              atomic claim: Order.findOneAndUpdate({ _id, loyaltyEarnedAt: $ne null }, $set loyaltyEarnedAt: null)
              → reverseEarnedPoints(profile, hotelId, points, ...)
      → 2. Restore redeemed points:
           → earnPoints(profile, hotelId, redeemedPts, ...) — re-credits the deducted amount
```

**Fire-and-forget:** Cancellation loyalty reversal is non-blocking. If it fails,
it logs a warning but does not roll back the cancellation. This is a known gap for
failure recovery but is documented.

**reverseEarnedPoints():** Caps deduction to current balance (never goes below 0).

### Guest reopen (guestRoutes.ts)

When a billed guest is reopened (for correction), loyalty is reversed:
1. Redeemed points are restored (`$inc loyaltyBalance: +redeemed`)
2. Earned points are deducted (`$gte: earnTx.points` guard)
Both use direct `CustomerProfile.findByIdAndUpdate` (not the utility functions).

---

## 8. Current OTP/Identity Flow

### OTP send (`POST /api/loyalty/otp/send`)

- Looks up `CustomerProfile.findOne({ hotelId: req.hotelId, phone, status: 'active', loyaltyOptOut: $ne true })`
- Rate limit: 3 OTPs per customer per 10 minutes
- Invalidates all pending OTPs before issuing new one (prevents multiple valid OTPs)
- 6-digit random OTP, SHA-256 hashed, never logged or returned
- 5-minute TTL via `expiresAt` + MongoDB TTL index
- Delivered via configured SMS/WhatsApp provider

**Current binding:** OTP is bound to `LoyaltyOtp.customerId` (CustomerProfile._id) and
`LoyaltyOtp.hotelId` — strictly single-branch.

### OTP verify (`POST /api/loyalty/otp/verify`)

- Same branch-scoped `CustomerProfile` lookup
- Atomic findOneAndUpdate: `{ _id: otpDoc._id, usedAt: null, otp: hashedInput, attempts: { $lt: 5 } }`
- Increments attempts on failure
- After 5 failures: no more attempts (OTP effectively invalidated)
- Returns `discountValue` preview only — no point deduction here

---

## 9. Multi-Branch Compatibility

### Gap matrix

| Component | Single-branch | Multi-branch (current) | Needed for cross-branch |
|-----------|:---:|:---:|------|
| LoyaltyTransaction schema | ✓ | ✗ | Add `orgCustomerId`, `branchHotelId` |
| CustomerProfile.loyaltyBalance | ✓ | ✗ (branch-only) | Org-level balance needed |
| OrganizationCustomer loyalty fields | N/A | ✗ (none) | Add `orgLoyaltyBalance` |
| earnPoints() utility | ✓ | ✗ (hotelId filter) | Org-aware variant |
| redeemPoints() utility | ✓ | ✗ (hotelId filter) | Org-aware variant |
| OTP flow | ✓ | ✗ (branch CustomerProfile) | Resolve via org identity |
| LoyaltyConfig source | ✓ | ✗ (branch settings) | Decide: HQ or branch settings |
| Offline redemption guard | ✓ (single only) | ✗ | Block redeemedPoints in offline queue |
| loyaltyExpiryWorker | ✓ | ✗ (no org context) | Extend for org transactions |
| LoyaltyTransaction indexes | ✓ | ✗ | Add orgCustomerId index |

### What happens today at a branch (multi-branch mode)

When a customer tries to redeem loyalty at Branch B after earning at Branch A:

1. `GET /loyalty/customers/lookup?phone=X` — queries `CustomerProfile` for Branch B's
   hotelId. If the customer visited Branch A but never Branch B, this returns 404.
2. Even if the customer exists at Branch B, `loyaltyBalance` is Branch B's own counter.
   Points earned at Branch A are not visible.
3. Redemption is scoped to Branch B's `CustomerProfile` — Branch A's points cannot be used.

This is the current correct (if limited) behavior. No cross-branch data is leaking.

---

## 10. Security Audit

### Loyalty routes authorization

| Route | Auth | Role | hotelId source | Client ID trusted? |
|-------|------|------|----------------|-------------------|
| GET /loyalty/config | JWT | cashier/admin | req.hotelId | No |
| PUT /loyalty/config | JWT | admin | req.hotelId | No |
| GET /loyalty/customers | JWT | cashier/admin | req.hotelId | No |
| POST /loyalty/customers | JWT | cashier/admin | req.hotelId | No |
| PATCH /loyalty/customers/:id | JWT | cashier/admin | req.hotelId | No — profileId from param; hotelId from JWT |
| GET /loyalty/customers/lookup | JWT | cashier/admin | req.hotelId | No |
| GET /loyalty/customers/:id | JWT | cashier/admin | req.hotelId | No — resolveCustomer filters by hotelId |
| GET /loyalty/customers/:id/transactions | JWT | cashier/admin | req.hotelId | No |
| POST /loyalty/customers/:id/adjust | JWT | admin | req.hotelId | No |
| POST /loyalty/otp/send | JWT | cashier/admin | req.hotelId | No — phone looked up in hotelId scope |
| POST /loyalty/otp/verify | JWT | cashier/admin | req.hotelId | No — CustomerProfile filtered by hotelId |

### earnPoints() security

```typescript
CustomerProfile.findOneAndUpdate(
  { _id: customerId, hotelId: hotelOid, status: 'active', loyaltyOptOut: { $ne: true } },
  { $inc: { loyaltyBalance: points } }
)
```

`hotelId` is always from JWT — never client-supplied. Cross-hotel earn impossible.

### redeemPoints() security

```typescript
CustomerProfile.findOneAndUpdate(
  { _id, hotelId, status: 'active', loyaltyOptOut: $ne true, loyaltyBalance: { $gte: points } },
  { $inc: { loyaltyBalance: -points } }
)
```

Atomic guard: `{ $gte: points }` prevents negative balance under any concurrency.
No check-then-act — this is correct.

### adjustPoints() security

Credit path is hotel-scoped: `{ _id, hotelId }` — C-10 fix confirmed in comments.
Debit path uses `{ loyaltyBalance: { $gte: -delta } }` guard — correct.

### Attack scenario assessment (conceptual)

| Scenario | Current defense | Status |
|----------|----------------|--------|
| Branch A token + Branch B loyalty balance | hotelId in all lookups | SAFE |
| Client inflated loyaltyDiscount | H1 cap: min(client, pts × rate) | SAFE |
| Concurrent double-redeem | $gte: points atomic guard | SAFE |
| OTP replay | usedAt stamp atomic via findOneAndUpdate | SAFE |
| Client-supplied customerId in order | Phone-based lookup, not client ID | SAFE |
| Cross-org customer access | resolveCustomer filters by hotelId from JWT | SAFE |

No cross-branch or cross-org loyalty vulnerability exists in the current single-branch model.

---

## 11. Concurrency / Race Conditions

### Current protections (single-branch)

1. **redeemPoints**: `loyaltyBalance: { $gte: points }` — atomic, no TOCTOU
2. **earnPoints**: idempotency via `Order.loyaltyEarnedAt` (findOneAndUpdate null→now)
3. **OTP verify**: `{ usedAt: null, otp: hash, attempts: $lt 5 }` — atomic mark-used
4. **Guest billing**: H-07 guard: `Guest.findOneAndUpdate({ _id, status: 'active' })` — only one winner

### New races introduced by cross-branch redemption

If org balance is introduced on `OrganizationCustomer`:

**Race 1 — Concurrent redemption at two branches:**
Customer is at Branch A and Branch B simultaneously (e.g., family members).
Both call redeemPoints. Without a single atomic org-balance field and the same
`$gte` guard, a double-spend is possible.

**Mitigation:** The `$gte: points` pattern must be applied to `orgLoyaltyBalance`
on `OrganizationCustomer`, not to branch `CustomerProfile.loyaltyBalance`.

**Race 2 — Earn at Branch A + redeem at Branch B (ordering race):**
Earn transaction completes at Branch A. Before the org balance is updated (if
using eventual consistency), a redemption at Branch B sees a stale balance.

**Mitigation:** The org balance update must be atomic in the same MongoDB operation
as the LoyaltyTransaction create. No eventual consistency.

**Race 3 — Linked customer earn while not yet org-linked:**
Customer earns points at Branch A before their profiles are org-linked. After linking,
the branch balance is on `CustomerProfile.loyaltyBalance` (Branch A), not on
`OrganizationCustomer.orgLoyaltyBalance`. These cannot be combined without a migration
or a "starting balance transfer" operation.

This is a data migration problem, not a runtime race.

---

## 12. Idempotency

### Current patterns

| Operation | Idempotency mechanism |
|-----------|----------------------|
| Earn on order complete | `Order.loyaltyEarnedAt`: null → now (atomic, one-winner) |
| Earn on guest bill | `Guest.loyaltyEarnedAt`: null → now (atomic, one-winner) |
| Earn on Razorpay payment | `Payment.loyaltyEarnedAt`: null → now |
| Redeem in order creation | Inside MongoDB transaction with order — if order rolls back, redeem rolls back |
| Reverse earn (cancel) | `Payment.loyaltyReversedAt` or `Order.loyaltyEarnedAt: null` claim |
| OTP verify | `LoyaltyOtp.usedAt` stamp — atomic findOneAndUpdate |
| Manual adjust | No idempotency — admin-gated, one-time action |

### Gap for cross-branch

`LoyaltyTransaction` has no `idempotencyKey` field. For org-level operations where
the same earn or redeem could be submitted from different branches in a retry scenario,
a dedicated `idempotencyKey` on LoyaltyTransaction would be safer than relying on
the parent record's flag alone.

The existing Order/Guest/Payment flag pattern is still the primary guard and remains
correct. The gap is specifically for org-level auditing and de-duplication.

---

## 13. Offline Compatibility

### What the offline queue allows today

`offlineQueue.ts:assertOfflineQueueable()` blocks:
- QR, kiosk, aggregator orders (`ONLINE_ONLY_SOURCES`)
- Gateway payment fields (`ONLINE_PAYMENT_FIELDS`): razorpayOrderId, walletAmount, etc.
- Empty bills

`ONLINE_PAYMENT_FIELDS` does NOT include `redeemedPoints` or `loyaltyDiscount`.

**This means an offline order with `redeemedPoints > 0` can currently be queued
and will be processed when connectivity is restored.**

For single-branch, this is safe: the server will re-validate the redemption against
the branch `CustomerProfile.loyaltyBalance` when syncing. If insufficient, the sync
fails with "Insufficient loyalty points" — the order sync fails but the customer
record is never corrupted.

### Gap for cross-branch

If org-level loyalty is implemented, offline redemption against an org balance is
inherently unsafe:
- The org balance could have been depleted at another branch between when the
  offline order was queued and when it syncs.
- There is no local authority for the org balance.

**Required fix:** Add `redeemedPoints` to the offline block list (or to
`ONLINE_PAYMENT_FIELDS`), OR add a runtime check that rejects offline queuing
when `redeemedPoints > 0`. This must be done before org loyalty goes live.

### What CAN work offline (earning)

Earning points is a server-side operation triggered on order completion. The offline
order is synced, the server creates the order, the server triggers earn on the server.
**Earning points offline is safe as-is** — the earn happens server-side on sync,
not client-side.

---

## 14. QR/Kiosk/POS Compatibility

### Loyalty support by channel

| Channel | Loyalty earn | Loyalty redeem | OTP | Status |
|---------|:---:|:---:|:---:|--------|
| Staff POS (orderRoutes) | ✓ (on complete) | ✓ (OTP + create order) | ✓ | Fully implemented |
| Table service (guestRoutes) | ✓ (on bill) | ✓ (on bill) | ✓ (pre-bill) | Fully implemented |
| QR ordering (menuRoutes) | ✗ | ✗ | ✗ | No loyalty hooks in menuRoutes |
| Kiosk | ✗ | ✗ | ✗ | No loyalty hooks in kiosk paths |
| Aggregator (Swiggy/Zomato) | ✗ | ✗ | ✗ | Intentionally excluded |

**QR and kiosk do not currently support loyalty** — neither earning nor redemption.
This is not a cross-branch issue; it's a feature gap in the current single-branch system.

Cross-branch loyalty should NOT enable QR/kiosk loyalty as a side effect.

---

## 15. Reporting Impact

### Current reports (all branch-scoped)

- `GET /api/orders/reports/daily` — aggregates `Guest.loyaltyDiscountAmount` by hotelId
- `GET /api/loyalty/stats` — aggregates `CustomerProfile` and `LoyaltyTransaction` by hotelId
- `GET /api/loyalty/activity` — `LoyaltyTransaction.find({ hotelId })` paginated
- `GET /api/loyalty/customers/:id/transactions` — `LoyaltyTransaction.find({ customerId, hotelId })`

### Gap for cross-branch

- A transaction made at Branch B for a customer linked to org identity has no
  `branchHotelId` on the LoyaltyTransaction — only `hotelId` (which equals branchHotelId
  once the transaction is written correctly).
- HQ has no report of "total org loyalty issued and redeemed across branches".
- A branch admin can currently only see their own branch's transactions. After
  org loyalty, the customer's org-level history should be visible but must not
  expose other branches' financial data.

### Required reporting additions

1. HQ org-level loyalty report: total earn/redeem/expire across all branches, aggregated
   by orgCustomerId.
2. Branch loyalty report: unchanged — own transactions only.
3. Customer org history view: all transactions across all linked branches, visible to HQ
   admin; branch admin sees their own branch transactions only.

---

## 16. Database / Index Audit

### Current indexes on LoyaltyTransaction

```
{ customerId: 1, createdAt: -1 }         — customer history (paginated)
{ hotelId: 1, transactionType: 1, createdAt: -1 }  — hotel-level reports
{ hotelId: 1, createdAt: -1 }            — hotel audit trail
{ orderId: 1 } sparse                    — order lookup
{ expiresAt: 1 } sparse                  — expiry sweep
```

### Proposed additions (only when needed)

| Index | Query it serves | Justification |
|-------|----------------|---------------|
| `{ orgCustomerId: 1, createdAt: -1 }` | Org loyalty history | Required for customer org-history view |
| `{ orgCustomerId: 1, branchHotelId: 1, createdAt: -1 }` | Branch contribution to org | Required for HQ report |

**Do not add these until `orgCustomerId` and `branchHotelId` fields are added to the schema.**

### Current indexes on OrganizationCustomer

```
{ orgHotelId: 1, canonicalPhone: 1 } unique sparse
{ orgHotelId: 1, canonicalEmail: 1 } sparse
{ orgHotelId: 1, status: 1 }
```

No loyalty-related indexes needed until loyalty fields are added.

### Current indexes on CustomerProfile

The index `{ hotelId: 1, loyaltyBalance: -1 }` (top loyalty customers report)
continues to be correct for branch-scoped reports. No change needed.

---

## 17. Backward Compatibility

### Standalone hotels

All existing standalone hotels (parentHotelId: null, no multiBranch feature flag):
- Continue using `CustomerProfile.loyaltyBalance`
- Continue using branch-scoped `LoyaltyTransaction`
- No migration required
- All existing loyalty routes, earn, redeem, OTP flows unchanged

### Multi-branch HQ without org loyalty

HQ hotels with multi-branch enabled but without the new org loyalty feature:
- Continue working as before
- Each branch has its own `CustomerProfile` records and `loyaltyBalance`
- `OrganizationCustomer` exists for linking but has no loyalty meaning

### Multi-branch with org loyalty (new)

Only activated when:
1. `OrganizationCustomer.orgLoyaltyBalance` exists and
2. A new feature flag (e.g., `features.orgLoyalty`) is enabled at HQ level

The new org-aware paths run only for linked customers in org-loyalty-enabled organizations.
Unlinked customers at a multi-branch branch continue using branch-scoped loyalty.

---

## 18. Required Changes

### RED — Architecture changes required before Sprint 2

**R1. Add `orgLoyaltyBalance` to `OrganizationCustomer`**

```typescript
orgLoyaltyBalance: { type: Number, default: 0, min: 0 }
```

This is the single source of truth for cross-branch redemption. Must be updated
atomically using the same `$gte: points` guard used on `CustomerProfile.loyaltyBalance`.

**R2. Add `orgCustomerId` and `branchHotelId` to `LoyaltyTransaction`**

```typescript
orgCustomerId: { type: ObjectId, ref: 'OrganizationCustomer', default: null }
branchHotelId: { type: ObjectId, ref: 'Hotel', default: null }
```

- `orgCustomerId`: set when the CustomerProfile has an orgCustomerId at transaction time
- `branchHotelId`: always = `hotelId` (the branch where the transaction occurred)
  Redundant with `hotelId` but explicitly named for query clarity

**R3. Org-aware earn and redeem utility functions**

New `earnOrgPoints()` function:
- Updates `CustomerProfile.loyaltyBalance` (branch) AND `OrganizationCustomer.orgLoyaltyBalance`
- Both increments must be in the same MongoDB session (transaction) to stay consistent
- Creates LoyaltyTransaction with `orgCustomerId` set

New `redeemOrgPoints()` function:
- Deducts from `OrganizationCustomer.orgLoyaltyBalance` with `$gte: points` guard
- Does NOT deduct from branch `CustomerProfile.loyaltyBalance` (the org balance is the authority)
- Creates LoyaltyTransaction with `orgCustomerId` and `branchHotelId` set

**R4. Business rule decisions (design decisions — see Section 19)**

Three business rules must be decided before any code is written.

### YELLOW — Small modifications

**Y1. Offline queue: block `redeemedPoints > 0` in offline orders**

In `offlineQueue.ts:assertOfflineQueueable()`:
```typescript
if ((order as any).redeemedPoints > 0) {
  throw new OfflineQueueError('Loyalty redemption requires an internet connection.');
}
```

This applies to both single-branch and multi-branch. For single-branch, the server
already validates and would reject a stale redemption; this guard improves UX.

**Y2. OTP flow: support org-level customer lookup**

`POST /api/loyalty/otp/send` currently looks up `CustomerProfile` by phone in the
calling branch. For cross-branch redemption, the lookup should first try branch
profile, then fall back to org customer (via `OrganizationCustomer.canonicalPhone`),
then find the org balance.

**Y3. LoyaltyConfig: decide which settings apply (see Section 19)**

**Y4. loyaltyExpiryWorker: org-level extension**

The worker currently groups by `customerId` (CustomerProfile). It must also
process org-level `earn` transactions (those with `orgCustomerId` set) and
deduct from `OrganizationCustomer.orgLoyaltyBalance`. Can be added as a second
loop in the same worker.

### GREEN — No changes needed

- Append-only LoyaltyTransaction design — correct, preserve
- Atomic `$gte` redeem guard — correct, preserve
- OTP hash (SHA-256) and TTL — correct, preserve
- Order.loyaltyEarnedAt idempotency — correct, preserve
- Guest.loyaltyEarnedAt idempotency — correct, preserve
- Payment.loyaltyReversedAt idempotency — correct, preserve
- WalletBalance architecture — separate from loyalty, no changes
- reverseEarnedPoints() capping at current balance — correct, preserve
- All existing single-branch routes — unchanged
- Standalone hotel backward compat — zero migration needed

---

## 19. Deferred / Ambiguous Business Rules

The following three rules must be decided by the business before Sprint 2 code is written.

### BR-1: Which loyalty settings apply for cross-branch operations?

**The problem:** Each hotel (HQ and branches) can have its own `loyaltySettings` in
`Settings`. Branch A might earn at 10 pts/₹100. Branch B might earn at 5 pts/₹100.

**Options:**
- A. **HQ settings always** — one consistent earn/redeem rate across the organization
- B. **Branch settings for earn, HQ settings for redeem** — earn rate where you dine,
  redeem rate is consistent at point of use
- C. **Branch settings for both** — earn rate where you earn, redeem rate where you redeem
  (most complex, can produce confusing customer experience)

**Recommendation:** Option A (HQ settings always) — simplest, most consistent customer
experience, easiest to implement and audit. Requires a new `getLoyaltyConfig(orgHotelId)`
path for org-loyalty operations.

### BR-2: Can a branch opt out of organization loyalty?

**The problem:** A branch may want to offer branch-only loyalty to its own customers,
not participate in the org pool. The `loyaltyProgram` feature flag is currently per-hotel.

**Options:**
- A. **Opt-out per branch** — a branch can set `features.orgLoyalty = false` to remain
  branch-scoped only
- B. **All-or-nothing at org level** — if HQ enables org loyalty, all branches participate
- C. **Branch opt-in** — branches actively enable org loyalty

**Recommendation:** Option B (org-level all-or-nothing) — simpler, avoids partial state.
Requires a new feature flag `features.orgLoyalty` at HQ level.

### BR-3: Unlinked customers — earn policy

**The problem:** A customer dines at Branch A and earns points. They are NOT yet linked
to an `OrganizationCustomer`. Later, a staff member links their Branch A profile to an
org customer. What happens to their pre-link branch balance?

**Options:**
- A. **Pre-link points stay on branch balance, inaccessible org-wide** — simplest,
  no data migration, customer may be confused
- B. **Migration on link** — on explicit linking, atomically transfer branch balance
  to org balance, zero out branch balance
- C. **Cumulative view only** — show org balance as sum of linked branch balances
  (read-only aggregation, no transfer); redemption uses org total

**Recommendation:** Option A initially — avoids migration complexity and financial risk.
Document clearly that org loyalty applies from the moment of linking forward. Migration
(Option B) can be a manual admin operation later.

---

## 20. GREEN / YELLOW / RED Matrix

### GREEN — works correctly for single-branch, no change needed

| Area | Status |
|------|--------|
| Single-branch earn flow | GREEN |
| Single-branch redeem flow (OTP + order) | GREEN |
| Atomic no-negative-balance guard | GREEN |
| OTP security (hash, TTL, attempt limit) | GREEN |
| Idempotency (earn/redeem/reverse) | GREEN |
| Refund/cancellation reversal | GREEN |
| loyaltyExpiryWorker (single-branch) | GREEN |
| WalletBalance (separate, untouched) | GREEN |
| Backward compat for standalone hotels | GREEN |
| Cross-hotel data isolation | GREEN |
| Client hotelId bypass security | GREEN |

### YELLOW — needs small modification

| Area | Status | Change |
|------|--------|--------|
| Offline queue loyalty block | YELLOW | Add `redeemedPoints > 0` to block list |
| OTP send/verify for cross-branch | YELLOW | Add org-customer fallback path |
| loyaltyExpiryWorker | YELLOW | Add org-balance leg |
| LoyaltyConfig resolution | YELLOW | Add HQ-settings path for org operations |
| LoyaltyTransaction idempotency key | YELLOW | Add field for org-level robustness |

### RED — architecture gap: cannot safely proceed without resolution

| Area | Status | Required change |
|------|--------|----------------|
| Org-level loyalty balance | RED | Add `orgLoyaltyBalance` to OrganizationCustomer |
| LoyaltyTransaction org context | RED | Add `orgCustomerId`, `branchHotelId` fields |
| Org-aware earn/redeem utilities | RED | New functions with org atomic update |
| Business rule: which settings apply | RED | BR-1 must be decided |
| Business rule: branch opt-out | RED | BR-2 must be decided |
| Business rule: pre-link balance | RED | BR-3 must be decided |
| Offline block for org redemption | RED | Y1 becomes RED for org loyalty |

---

## 21. Recommended Sprint 2 Implementation Plan

### Prerequisites (must be done before Sprint 2 starts)

1. Resolve BR-1, BR-2, BR-3 (business rule decisions)
2. The rest of Sprint 2 is blocked until these are decided

### Sprint 2 scope (assuming BR-1=A, BR-2=B, BR-3=A)

**Phase 1 — Schema changes (no breaking changes)**
- Add `orgLoyaltyBalance: Number` (default 0, min 0) to OrganizationCustomer
- Add `orgCustomerId: ObjectId | null` and `branchHotelId: ObjectId | null` to LoyaltyTransaction
- Add `idempotencyKey: String | null` (sparse) to LoyaltyTransaction
- Add indexes: `{ orgCustomerId: 1, createdAt: -1 }` and `{ orgCustomerId: 1, branchHotelId: 1, createdAt: -1 }`
- Add feature flag `features.orgLoyalty` to Hotel model (boolean, default false)

**Phase 2 — New utility functions**
- `earnOrgPoints(orgCustomerId, orgHotelId, branchHotelId, points, config, ctx)`:
  - MongoDB session: inc `OrganizationCustomer.orgLoyaltyBalance` + create LoyaltyTransaction
  - Separate: inc `CustomerProfile.loyaltyBalance` at branch (for branch report continuity)
- `redeemOrgPoints(orgCustomerId, orgHotelId, branchHotelId, points, config, ctx)`:
  - Atomic: dec `OrganizationCustomer.orgLoyaltyBalance` with `$gte: points` guard
  - Create LoyaltyTransaction with orgCustomerId + branchHotelId
  - Do NOT touch branch CustomerProfile.loyaltyBalance

**Phase 3 — Route changes**
- loyaltyRoutes: `GET /customers/lookup` — add org balance view when customer is linked
- loyaltyRoutes: `POST /otp/send` — add org customer fallback
- loyaltyRoutes: `POST /otp/verify` — verify against org customer when linked
- orderRoutes: earn path — if customer has orgCustomerId, use earnOrgPoints()
- orderRoutes: redeem path — if customer has orgCustomerId, use redeemOrgPoints()
- guestRoutes: same pattern for table billing
- New route: `GET /api/org-customers/:id/loyalty` — org loyalty summary + transactions

**Phase 4 — Offline guard**
- offlineQueue.ts: block `redeemedPoints > 0` in `assertOfflineQueueable()`

**Phase 5 — Tests**
- Pure-logic tests for all new utility functions
- Cross-branch earn/redeem scenarios
- Concurrent redemption race test
- Negative balance prevention
- Offline block test
- Backward compat: standalone hotel unchanged

**Phase 6 — loyaltyExpiryWorker**
- Add org-balance expiry leg

### What Sprint 2 must NOT include

- Migration of existing branch balances to org balances (BR-3 deferred)
- QR/kiosk loyalty (separate sprint if needed)
- Wallet architecture changes
- Changes to any payment flow
- Changes to any Razorpay/payment verification logic

---

## 22. Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Concurrent redemption across two branches depleting org balance | HIGH | `$gte: points` guard on orgLoyaltyBalance — same pattern as current |
| Business rules not decided before Sprint 2 | HIGH | Sprint 2 cannot start without BR-1, BR-2, BR-3 decisions |
| Pre-link balance confusion (customers with branch points unaware they don't transfer) | MEDIUM | Clear UX messaging; Option A (no transfer) is explicit |
| loyaltyExpiryWorker expiring org points while branch balance is non-zero | MEDIUM | Worker must run org-balance leg after branch leg, same session |
| Offline order with redeemedPoints syncing after org balance depleted | HIGH | Offline block (Y1/RED) must be deployed before org loyalty goes live |
| LoyaltyConfig divergence (branch settings vs HQ settings) | MEDIUM | BR-1 decision eliminates this if HQ settings chosen |
| Test coverage for org loyalty | MEDIUM | Sprint 2 must include >20 pure-logic tests for new functions |

---

## 23. Final Verdict

**ARCHITECTURE GAP — DESIGN DECISION REQUIRED**

The current loyalty system is correct and secure for single-branch and standalone
operation. No existing loyalty invariant is broken. No existing customer data is
at risk.

Cross-branch loyalty cannot be safely added in Sprint 2 without:

1. Three business rule decisions (BR-1, BR-2, BR-3 above)
2. `orgLoyaltyBalance` on OrganizationCustomer
3. `orgCustomerId` + `branchHotelId` on LoyaltyTransaction
4. New org-aware atomic earn/redeem utility functions
5. Offline redemption block

Once those decisions are made and the schema changes are designed, Sprint 2
implementation can proceed safely with the patterns already proven in the
existing loyalty engine.

---

## Concise Final Summary

**Current loyalty architecture:**
Append-only ledger (`LoyaltyTransaction`) + denormalized balance (`CustomerProfile.loyaltyBalance`).
Both are strictly branch-scoped. All atomic guards are correct. OTP is sound. Idempotency
via parent-record flags is solid.

**Biggest limitation:**
`loyaltyBalance` lives on `CustomerProfile` (branch), not on `OrganizationCustomer` (org).
There is no org-level balance field and no way to atomically deduct from an org-level source.

**Is OrganizationCustomer sufficient?**
Not yet. It needs one new field: `orgLoyaltyBalance: Number`. With that field and the
`$gte: points` atomic guard applied to it, the financial model becomes safe.

**Does the loyalty ledger need redesign?**
No redesign — additive changes only. Two new nullable fields on LoyaltyTransaction
(`orgCustomerId`, `branchHotelId`), two new indexes. The existing schema and append-only
design are correct and must be preserved.

**Can cross-branch redemption be safely added?**
Yes, but not before:
1. Business rules BR-1/BR-2/BR-3 are decided by the team
2. Schema changes (orgLoyaltyBalance, orgCustomerId, branchHotelId) are implemented
3. Offline redemption is blocked
4. New org-aware utility functions are built and tested

**Exact Sprint 2 scope:**
Schema changes → new utility functions → route extensions → offline guard →
pure-logic tests → worker extension. See Section 21 for full plan.

**Anything that must NOT change:**
- Existing single-branch `earnPoints()` and `redeemPoints()` behavior
- `loyaltyBalance` on `CustomerProfile` (branch reports depend on it)
- Append-only `LoyaltyTransaction` design
- Any payment flow, Razorpay integration, or offline architecture

*Audit complete. No code was modified.*
