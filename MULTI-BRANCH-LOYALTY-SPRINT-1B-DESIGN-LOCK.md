# MULTI-BRANCH LOYALTY — DESIGN LOCK

**Date:** 2026-09-16
**Sprint:** 1B — Business Rule Decision + Design Lock
**Based on:** MULTI-BRANCH-LOYALTY-SPRINT-1-AUDIT.md
**Status:** See Section 25

---

## 1. Current Architecture

### Loyalty settings (per-branch, stored in Settings.loyaltySettings)

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `rewardName` | string | "Points" | Display label |
| `pointsPerHundredRupees` | number | 10 | Earn rate: pts earned per ₹100 spent |
| `minimumRedeemPoints` | number | 50 | Floor: customer must have ≥ this to redeem |
| `maximumRedeemPercent` | number | 10 | Cap: max % of bill that can be paid via points |
| `pointValueInPaisa` | number | 100 | 1 pt = ₹(pointValueInPaisa / 100); 100 = ₹1 per pt |
| `expiryDays` | number | 0 | 0 = never expire; N = expire N days after earn |
| `roundingRule` | floor/round/ceil | floor | Rounding for earned-points calculation |
| `calculationBase` | before_gst/after_gst | before_gst | Base amount for earn calculation |
| `maxEarnPointsPerBill` | number | 0 | 0 = unlimited; N = cap per bill |
| `tierThresholds` | object | 5k/15k/30k | Lifetime spend for Silver/Gold/Platinum tier |

Each hotel (HQ or branch) has its own independent `Settings` document.
There is no org-level loyalty settings document.
`getLoyaltyConfig(hotelId)` always reads `Settings.findOne({ hotelId })` — no inheritance.

### Balance storage

```
CustomerProfile.loyaltyBalance: number
  → per-branch, denormalized from LoyaltyTransaction ledger
  → min: 0 (never negative)
  → NOT shared across branches
```

### Ledger storage

```
LoyaltyTransaction
  customerId   → CustomerProfile._id (branch-scoped)
  hotelId      → Hotel._id (branch)
  transactionType: earn | redeem | adjust | reverse | expire | transfer_in | transfer_out
  points       → signed integer (positive earn, negative redeem/reverse/expire)
  balanceAfter → snapshot after this transaction
  orderId      → sparse reference
  expiresAt    → sparse, for expiry sweep
```

No `orgCustomerId`, no `branchHotelId`, no org-level reference.

### Current redemption arithmetic

```
earnedPts  = floor((billAmount / 100) × pointsPerHundredRupees)
                capped at maxEarnPointsPerBill if > 0

discountRs = (points × pointValueInPaisa) / 100

maxRedeemPts by bill = floor((totalAmount × maximumRedeemPercent) / pointValueInPaisa)
```

### Existing operations

- `earnPoints(customerId, hotelId, pts, config, ctx)` — atomic `$inc` with hotelId guard
- `redeemPoints(customerId, hotelId, pts, config, ctx)` — atomic `$inc: -pts` with `$gte: pts` guard
- `reverseEarnedPoints(customerId, hotelId, pts, config, ctx)` — capped deduction
- `adjustPoints(customerId, hotelId, delta, ...)` — admin manual, hotel-scoped
- All operations: `hotelId` always from JWT (`req.hotelId`), never client-supplied

---

## 2. BR-1 — Loyalty Settings

### The problem

When a customer earns or redeems organization-wide loyalty, the system needs a single
authoritative `LoyaltyConfig` to apply. Three settings are financially critical:

1. `pointsPerHundredRupees` — determines how many points are earned per ₹100
2. `pointValueInPaisa` — determines the monetary value of each point
3. `maximumRedeemPercent` — determines how much of a bill can be covered by points

If these differ between branches, a customer could earn cheap points at Branch A
and redeem expensive points at Branch B — financial inconsistency.

### Options

**OPTION A — HQ settings are authoritative**

All org-loyalty transactions use HQ `Settings.loyaltySettings`.

- Earn at Branch A: uses HQ earn rate
- Redeem at Branch B: uses HQ redemption rate
- Branch-specific settings for loyalty are ignored when org-loyalty is active

Consequence: branches lose the ability to run their own loyalty promotions.
Counter-consideration: org loyalty is explicitly an org-level feature. Branch-specific
promotions can be implemented separately without touching the loyalty ledger.

**OPTION B — Branch settings control each transaction**

Each transaction uses the settings of the branch where it occurs.

Example:
- Branch A: pointValueInPaisa = 100 (1 pt = ₹1)
- Branch B: pointValueInPaisa = 200 (1 pt = ₹2)
- Customer earns 100 pts at Branch A (worth ₹100 at Branch A value)
- Customer redeems 100 pts at Branch B (gets ₹200 discount)

**This is a financial inconsistency.** The organization would pay out ₹200 but only
received business worth ₹100 points. Net loss: ₹100.

This is not safe for org-level loyalty unless a conversion table is maintained —
which is significantly more complex and error-prone.

**OPTION C — HQ default + branch override (selective)**

HQ defines the base. A branch can override individual settings, but the override
only applies to earn or redeem at that branch.

The same financial inconsistency as Option B exists for `pointValueInPaisa`.
A branch that overrides redemption rate can drain the org balance.

Additionally, `calculationBase` divergence (before_gst vs after_gst) at different
branches means a customer earns different points for the same nominal spend.

### Analysis: why only one redemption rate is safe

The key insight is that `pointValueInPaisa` is the monetary denominator:

```
discount = (points × pointValueInPaisa) / 100
```

If two branches have different `pointValueInPaisa` values and they share an org balance:
- Points earned under low-value settings can be redeemed under high-value settings
- The organization has no deterministic liability per point

**A single org-level `pointValueInPaisa` is required for financial correctness.**

The earn rate (`pointsPerHundredRupees`) is less dangerous if different per branch —
it affects how quickly the balance grows, not the monetary value of each point.
But inconsistent earn rates create customer confusion ("I get more points at Branch B
for the same spend") and are difficult to support.

The safest and simplest design is: all org-loyalty economics come from HQ settings.

### Final Decision

**OPTION A: HQ settings are authoritative for all org-loyalty transactions.**

### Exact Rule

```
BR-1 RULE: When org-loyalty is active for an organization, ALL loyalty transactions
(earn, redeem, adjust, reverse, expire) for linked customers use the HQ hotel's
Settings.loyaltySettings.

Branch-specific Settings.loyaltySettings are used ONLY for:
  - Standalone hotels (parentHotelId: null, no org-loyalty feature)
  - Branches where org-loyalty is NOT active
  - Branch-only customers who are NOT linked to an OrganizationCustomer

When a branch customer (CustomerProfile) has orgCustomerId set AND the organization
has features.orgLoyalty = true, the config MUST be loaded via
getLoyaltyConfig(orgHotelId) — not getLoyaltyConfig(req.hotelId).

Implementation point:
  getOrgLoyaltyConfig(orgCustomer.orgHotelId) → LoyaltyConfig from HQ Settings
```

**Sprint 2 implication:**
New `getOrgLoyaltyConfig(orgHotelId: string): Promise<LoyaltyConfig>` that reads
`Settings.findOne({ hotelId: orgHotelId })`. Same structure as `getLoyaltyConfig`,
but reads the HQ hotel's settings. The `enabled` flag also comes from the HQ hotel's
`features.orgLoyalty` (new flag, separate from `features.loyaltyProgram`).

---

## 3. BR-2 — Branch Opt-Out

### The problem

Should a branch be able to opt out of org-wide loyalty? If yes, what does that mean
precisely for earning and redemption?

### Options

**MODEL A — Org loyalty is all-or-nothing at org level**

If the HQ enables `features.orgLoyalty`, all branches participate.
No branch can opt out individually.

**MODEL B — HQ controls per-branch enable/disable**

HQ admin can toggle a `orgLoyaltyEnabled` flag on individual branches.
Branch admins cannot change this flag.

**MODEL C — Branch admin can disable for their own branch**

Branch admin toggles their own participation.

**MODEL D — Separate earn/redeem flags per branch**

Each branch can independently enable/disable earning and redemption.

### Analysis

**MODEL C** creates a permissions problem: a branch admin could disable loyalty
redemption during a promotion to avoid cost, then re-enable it — manipulating
customer experience without org oversight. Not acceptable.

**MODEL D** (separate earn/redeem flags) is complex and creates confusing staff
experience. A cashier who sees "loyalty available" but only for earning (not redemption)
will confuse customers. Avoidable complexity.

**MODEL B** is the right balance: HQ has control, branch cannot self-exempt.

**Critical question: Can a customer redeem org points at a branch where loyalty is disabled?**

If Branch A has opted out (per HQ decision), and a customer has 1,000 org points:

- Option 1: No earning AND no redemption → loyalty completely unavailable at Branch A
- Option 2: No earning, but redemption allowed → asymmetric and confusing
- Option 3: No redemption, but earning allowed → points accumulate, never redeemable there

The simplest rule with lowest financial confusion:

> If org-loyalty is disabled at a branch, neither earning nor redemption is available
> at that branch. The customer's org balance is not affected. They can transact at
> other enabled branches.

**MODEL B with a single boolean flag is safest and simplest.**

### Final Decision

**MODEL B: HQ controls org-loyalty participation per branch via a single flag.
Branch admins cannot change this flag. The flag controls both earning and redemption
simultaneously.**

### Exact Rule

```
BR-2 RULE: Org-loyalty participation is controlled by TWO flags:

1. features.orgLoyalty on the HQ Hotel document
   → Master switch: if false, no branch in the org participates in org-loyalty
   → Only HQ admin can set this

2. features.orgLoyaltyEnabled on each Branch Hotel document (new field)
   → Branch-level switch: if false, this branch does not participate, even if HQ orgLoyalty is true
   → Only HQ admin can set this; branch admin cannot change it

For a transaction at Branch X to use org-loyalty:
  → Hotel(HQ).features.orgLoyalty === true
  → Hotel(Branch X).features.orgLoyaltyEnabled === true (default: true when parentHotelId is set)
  → CustomerProfile.orgCustomerId is set (customer is linked)

If org-loyalty is inactive at a branch:
  → Fall back to branch-scoped loyalty if Hotel(Branch X).features.loyaltyProgram === true
  → This means a branch can still run its own loyalty independently

The two systems (org-loyalty and branch-loyalty) are mutually exclusive per customer:
  → If a customer is linked (has orgCustomerId) AND orgLoyalty is active at the branch:
     → Use org-loyalty. Branch balance is irrelevant for earning/redemption.
  → If a customer is linked but orgLoyalty is NOT active at the branch:
     → Fall back to branch loyalty (use branch CustomerProfile.loyaltyBalance)
  → If a customer is NOT linked:
     → Always use branch loyalty

Sprint 2 must NOT implement the mutual-exclusivity fallback in the first pass.
Sprint 2 only handles the case: linked customer + orgLoyalty active.
Unlinked customers always use branch loyalty (unchanged behavior).
```

**Implication for staff UX (Sprint 2 scope):**
When org-loyalty is not active at the current branch, the cashier sees the same
loyalty UI as today (branch points). When org-loyalty IS active and the customer
is linked, the cashier sees "Org Points: 1,234 pts" instead of branch points.
This requires no new UI component — only the balance source changes.

---

## 4. BR-3 — Existing Branch Balances

### The problem

When an organization introduces org-loyalty after some customers already have
branch-scoped `CustomerProfile.loyaltyBalance`, what happens to the pre-existing
balances when those customers get linked to an `OrganizationCustomer`?

Scenario:
- Customer has been dining at Branch A for 6 months
- Branch A CustomerProfile: loyaltyBalance = 500 pts
- Customer also visited Branch B twice: loyaltyBalance = 80 pts
- Organization now launches org-loyalty
- HQ staff links both profiles to a new OrganizationCustomer

### Options

**OPTION A — Do not migrate (branch balances stay branch-scoped)**

Pre-link balances remain on `CustomerProfile.loyaltyBalance`.
They are redeemable at the branch where they exist, using branch loyalty.
Only points earned after linking are org-scoped and tracked on `OrganizationCustomer.orgLoyaltyBalance`.

- Can the same points be redeemed twice? No — pre-link use branch loyalty, post-link use org loyalty.
- Can balances disappear? No.
- Can a customer gain unexpected points? No.
- Historical reports remain accurate (ledger is unchanged).
- No migration required — zero data change on linking.

Risk: Customer may be confused why their "old points" aren't visible in the new org loyalty view.
Mitigation: Staff or UI can explain "Your pre-existing points at each branch are still redeemable
there. New points earned from today are shared across all branches."

**OPTION B — Automatic merge on linking**

Sum of all linked `CustomerProfile.loyaltyBalance` values is written to
`OrganizationCustomer.orgLoyaltyBalance`. Branch balances are zeroed.

Critical problems:
1. **Double-spend window:** Between reading branch balances and zeroing them,
   an ongoing redemption at one branch could succeed, and then the migration adds
   those same points to the org balance. Points redeemed twice.
2. **Concurrency hazard:** If two branch profiles are linked concurrently
   (unlikely but possible), both migrations run simultaneously, reading
   stale balances.
3. **Irreversible:** If the linking was a mistake, the original branch balances
   are gone. Unlinking cannot restore them (no audit trail of what was merged).
4. **Report inaccuracy:** Branch reports show loyaltyBalance = 0 for previously
   active customers, making historical reports misleading.

Unless implemented within a carefully designed multi-document MongoDB transaction
that atomically zeros branch balances and sets the org balance in one operation,
this is not safe. Even then, the transaction would lock potentially large documents
and creates downtime risk at scale.

**OPTION C — Explicit admin migration**

After linking, HQ admin sees each customer's linked profiles with their current
branch balances. Admin explicitly approves which balances to transfer.
Each approved transfer is an atomic operation: deduct from branch, credit to org,
create LoyaltyTransaction entries for both.

This is safe but operationally expensive for large existing customer bases.

**OPTION D — Preserve old balances, freeze them after linking**

After linking, existing branch balances become "legacy" — visible but not redeemable.
Only org-balance (post-link earn) is usable.

This silently destroys customer value. Customers who earned real loyalty points at
a branch lose them. Not acceptable.

### Data integrity analysis for OPTION A

| Question | Answer |
|----------|--------|
| Can the same points be redeemed twice? | No — different balance fields, different redemption paths |
| Can balances disappear? | No — branch balances remain on CustomerProfile |
| Can a customer gain unexpected points? | No — zero migration, zero automatic transfer |
| Can historical reports remain accurate? | Yes — LoyaltyTransaction ledger unchanged |
| Can refunds/cancellations reverse old points? | Yes — they use CustomerProfile.hotelId, same as before |
| Can original branch ledger remain auditable? | Yes — LoyaltyTransaction unchanged |
| Can migration be done without downtime? | Yes — linking creates OrganizationCustomer, no balance change |
| Can migration be rolled back? | Yes — unlink clears orgCustomerId, nothing changed |
| Concurrent linking + order completion at same branch | Safe — no balance change on linking |
| Two branch profiles linked concurrently | Safe — no balance change on linking |

### Final Decision

**OPTION A: Pre-existing branch balances remain branch-scoped. No automatic migration.**

### Migration Rule

```
BR-3 RULE: When a CustomerProfile is linked to an OrganizationCustomer:

1. CustomerProfile.orgCustomerId is set (existing behavior, no change)
2. CustomerProfile.loyaltyBalance is NOT modified
3. OrganizationCustomer.orgLoyaltyBalance is NOT modified
4. No LoyaltyTransaction is created for the linking event
5. The pre-link branch balance remains redeemable at that branch only,
   using branch loyalty (CustomerProfile.loyaltyBalance), until it is
   exhausted through normal redemption

Post-link behavior for the linked customer:
  → Points earned after linking are credited to OrganizationCustomer.orgLoyaltyBalance
  → Points earned after linking are also separately tracked at branch level IF the
     branch still runs independent loyalty (see BR-2) — but the canonical balance is the org balance
  → Redemption post-link uses OrganizationCustomer.orgLoyaltyBalance only

Pre-link balance handling:
  → The existing branch balance (CustomerProfile.loyaltyBalance for Branch A)
     remains on that document
  → When the customer visits Branch A and org-loyalty is active, the cashier sees
     org balance (post-link points only) for org redemption
  → The pre-link branch balance is accessible if the cashier explicitly uses
     branch loyalty mode (future admin feature, not Sprint 2 scope)
  → In Sprint 2, the pre-link balance is visible-but-not-in-scope for org-loyalty operations

NO FUTURE SPRINT shall automatically migrate pre-link balances without:
  1. An explicit admin confirmation per customer
  2. An atomic MongoDB transaction zeroing branch balance + crediting org balance
  3. LoyaltyTransaction entries for the transfer (type: 'transfer_out' on branch, 'transfer_in' on org)
  4. A reversal mechanism if the transfer was erroneous
```

---

## 5. OrganizationCustomer Identity

### Current model (audited)

```
OrganizationCustomer:
  orgHotelId      ObjectId → HQ Hotel
  canonicalPhone  string | null → normalized digits
  canonicalEmail  string | null → lowercase trimmed
  displayName     string
  status          active | suspended
```

**No loyalty fields exist.** The model was intentionally kept identity-only.

### Linking model (audited)

- `CustomerProfile.orgCustomerId` links a branch profile to an org customer
- One `CustomerProfile` can belong to exactly one `OrganizationCustomer`
  (orgCustomerId is a single ObjectId, not an array)
- Multiple `CustomerProfile` records (one per branch) can reference the same `OrganizationCustomer`
- Duplicate linking prevention: orgCustomerId is a single nullable field —
  setting it twice for the same profile requires an unlink first
- Cross-org linking prevention: `orgCustomerRoutes.ts resolveOrg()` verifies the profile's
  `hotelId` belongs to the org (either HQ or a branch of HQ) before allowing link

### Historical loyalty association

Current LoyaltyTransaction records have no `orgCustomerId`. Post-linking, they remain
associated with `CustomerProfile._id` and the branch `hotelId`. The relationship
to the org customer is derivable by: `CustomerProfile._id` → `CustomerProfile.orgCustomerId`
→ `OrganizationCustomer._id`. This join is sufficient for historical reporting but not
efficient for real-time balance aggregation.

### Identity invariants (must be preserved forever)

1. No auto-link based on phone/email match alone
2. No auto-merge of CustomerProfile records
3. No loyalty balance change on link or unlink
4. Explicit staff action required for every link

---

## 6. Organization Loyalty Ledger

### Required LoyaltyTransaction extensions (Sprint 2 schema)

```typescript
// Add to LoyaltyTransaction:
orgCustomerId:  { type: ObjectId, ref: 'OrganizationCustomer', default: null }
branchHotelId:  { type: ObjectId, ref: 'Hotel', default: null }
idempotencyKey: { type: String, default: null } // sparse unique
```

**`orgCustomerId`** — set when the CustomerProfile has orgCustomerId at transaction time.
Null for standalone hotel transactions and branch-only transactions.

**`branchHotelId`** — set equal to `hotelId` for org-loyalty transactions.
Redundant with `hotelId` but named explicitly for query clarity in org-level reports.
Always null for standalone transactions.

**`idempotencyKey`** — composite key for org-level earn/redeem operations.
Format: `{orgCustomerId}:{orderId|guestId|paymentId}:{transactionType}`
Provides a unique constraint to prevent duplicate org-level transactions on retry.
Nullable (null for single-branch transactions that use the existing idempotency approach).

### Organization balance field (Sprint 2 schema)

```typescript
// Add to OrganizationCustomer:
orgLoyaltyBalance: { type: Number, default: 0, min: 0 }
```

This is the single source of truth for org-wide point redemption.
Updated atomically using the same `$gte: points` guard as `CustomerProfile.loyaltyBalance`.

### Required indexes (Sprint 2)

```
LoyaltyTransaction:
  { orgCustomerId: 1, createdAt: -1 }  — customer org-history view
  { orgCustomerId: 1, branchHotelId: 1, createdAt: -1 }  — HQ branch breakdown
  { idempotencyKey: 1 } unique, sparse  — duplicate prevention

OrganizationCustomer:
  No new indexes needed (existing orgHotelId + status indexes are sufficient)
```

### Financial model

```
OrganizationCustomer
  orgLoyaltyBalance: number  ← canonical org balance

Each org-loyalty LoyaltyTransaction:
  orgCustomerId      — which org customer
  branchHotelId      — which branch triggered this transaction
  transactionType    — earn | redeem | reverse | adjust | expire
  points             — signed (positive earn, negative redeem/reverse/expire)
  balanceAfter       — snapshot after (org balance, not branch balance)
  orderId            — reference to order
  idempotencyKey     — prevents double-processing
  createdBy          — cashier/system
  createdAt          — immutable timestamp
```

---

## 7. Earning Rules

### When org-loyalty earn triggers

An org-loyalty earn happens when ALL of the following are true:
1. `Hotel(HQ).features.orgLoyalty === true`
2. `Hotel(branch).features.orgLoyaltyEnabled === true`
3. `CustomerProfile.orgCustomerId` is set
4. `CustomerProfile.loyaltyOptOut !== true`
5. `OrganizationCustomer.status === 'active'`
6. Order/guest billing completes successfully

### Earn operation

```
1. Load HQ loyalty config: getOrgLoyaltyConfig(orgCustomer.orgHotelId)
2. Calculate earn: calculateEarnedPoints(billBase, hqConfig)
   → billBase: use hqConfig.calculationBase (before_gst or after_gst)
3. Atomic: OrganizationCustomer.findOneAndUpdate(
     { _id: orgCustomerId, status: 'active' },
     { $inc: { orgLoyaltyBalance: pts } }
   )
4. Create LoyaltyTransaction (org-scoped):
   { customerId, hotelId: branchHotelId, orgCustomerId, branchHotelId,
     transactionType: 'earn', points: +pts, balanceAfter: newOrgBalance,
     orderId, idempotencyKey, ... }
5. Idempotency: Order.loyaltyEarnedAt remains the outer guard (existing pattern preserved)
```

**Branch CustomerProfile.loyaltyBalance is NOT updated on org-loyalty earn.**
This simplifies the model. Branch balance is only used for branch-only customers.

### Earn idempotency

Reuse existing pattern: `Order.loyaltyEarnedAt: null → now` via atomic `findOneAndUpdate`.
Additionally, `LoyaltyTransaction.idempotencyKey` provides a secondary guard.

---

## 8. Redemption Rules

### When org-loyalty redemption is valid

1. `Hotel(HQ).features.orgLoyalty === true`
2. `Hotel(branch).features.orgLoyaltyEnabled === true`
3. `CustomerProfile.orgCustomerId` is set
4. `CustomerProfile.loyaltyOptOut !== true`
5. `OrganizationCustomer.status === 'active'`
6. `OrganizationCustomer.orgLoyaltyBalance >= requestedPoints`
7. `requestedPoints >= hqConfig.minimumRedeemPoints`
8. `loyaltyDiscount <= billTotal × (hqConfig.maximumRedeemPercent / 100)`
9. OTP has been verified (for cashier POS; same OTP flow as today)
10. Request is online (not from offline queue — see Section 10)

### Redemption operation

```
1. Load HQ loyalty config: getOrgLoyaltyConfig(orgCustomer.orgHotelId)
2. Server cap: verifiedPoints = min(requestedPoints, maxByPercent, orgBalance)
3. Inside MongoDB session (same as existing order transaction):
   a. Order.save()
   b. Atomic: OrganizationCustomer.findOneAndUpdate(
        { _id: orgCustomerId, status: 'active', orgLoyaltyBalance: { $gte: points } },
        { $inc: { orgLoyaltyBalance: -points } }
      )
      → Throws 'Insufficient org loyalty points' if guard fails
   c. Create LoyaltyTransaction (org-scoped):
      { customerId, hotelId: branchHotelId, orgCustomerId, branchHotelId,
        transactionType: 'redeem', points: -pts, balanceAfter: newOrgBalance,
        orderId, idempotencyKey, ... }
4. Return discountAmount to caller
```

### Concurrent redemption guarantee

100 org points available. Request A = 80 pts. Request B = 50 pts.

```
MongoDB operation for Request A:
  filter: { orgLoyaltyBalance: { $gte: 80 } } ← 100 >= 80 → succeeds
  update: $inc: -80
  → orgLoyaltyBalance becomes 20

MongoDB operation for Request B (concurrent):
  filter: { orgLoyaltyBalance: { $gte: 50 } } ← 20 < 50 → FAILS
  → throws 'Insufficient org loyalty points'
  → cashier sees error; must re-verify balance before attempting again
```

Balance never goes below 0.

---

## 9. Refund / Cancellation Rules

### Order cancellation — reverse earned org points

```
1. Check: Order.loyaltyEarnedAt was set (earn happened)
2. Atomic claim: Order.findOneAndUpdate({ _id, loyaltyEarnedAt: $ne null }, $set loyaltyEarnedAt: null)
3. If claim succeeds, reverse via:
   OrganizationCustomer.findOneAndUpdate(
     { _id: orgCustomerId },
     [ { $set: { orgLoyaltyBalance: { $max: [0, { $subtract: ['$orgLoyaltyBalance', pts] }] } } } ]
   )
4. Create LoyaltyTransaction: { transactionType: 'reverse', points: -actualReversed, ... }
```

### Order cancellation — restore redeemed org points

If the cancelled order contained a redemption:
```
OrganizationCustomer.findOneAndUpdate(
  { _id: orgCustomerId },
  { $inc: { orgLoyaltyBalance: +redeemedPoints } }
)
Create LoyaltyTransaction: { transactionType: 'earn', ... remarks: 'Redemption restored on cancellation' }
```

Idempotency: `Payment.loyaltyReversedAt` for Razorpay path (existing, preserved).
`Order.loyaltyEarnedAt` set-to-null pattern (existing, preserved).

### Guest reopen (table billing)

Same pattern: reverse earned, restore redeemed. Use `OrganizationCustomer._id`
instead of `CustomerProfile._id` for the balance update.

---

## 10. Offline Rules

### Current gap

`redeemedPoints` and `loyaltyDiscount` are not in `ONLINE_PAYMENT_FIELDS` in
`offlineQueue.ts`. This means an offline order with loyalty redemption can be queued.

For single-branch, this is recoverable at sync time (server re-validates).
For org-loyalty, this is a double-spend risk: the org balance may have been depleted
at another branch while the order was queued offline.

### Decision

```
OFFLINE RULE: Any order containing redeemedPoints > 0 MUST be rejected at the
offline queue level before being stored in IndexedDB.

Defense in depth: four layers (UI → queue → backend validation → ledger guard)
```

### Layer 1: UI (NewOrderPanel.tsx)

When the device detects it is offline (existing `isOnline` check):
- Disable the "Apply Loyalty" button
- Show tooltip: "Loyalty redemption requires an internet connection"
- Clear any pending `loyaltyRedemption` state

This is the first UX gate, not the security gate.

### Layer 2: Offline queue guard (offlineQueue.ts)

```typescript
// Add to assertOfflineQueueable():
const payload = order as any;
if ((payload.redeemedPoints ?? 0) > 0) {
  throw new OfflineQueueError(
    'LOYALTY_REDEMPTION_ONLINE_ONLY',
    'Loyalty redemption requires an active internet connection. Please reconnect and retry.'
  );
}
```

This is the primary technical gate. It prevents any offline order with loyalty
redemption from ever reaching IndexedDB.

### Layer 3: Sync worker (backend — order creation)

When syncing offline orders, the backend's order creation handler already validates
loyalty redemption server-side (H1 cap, redeemPoints guard). If a queued order somehow
contained redemption data (e.g., from a legacy client), the server will reject it with
"Insufficient loyalty points" or "Customer not found for redemption."

This layer is already correct and requires no change.

### Layer 4: Ledger guard (MongoDB atomic)

The `$gte: points` atomic guard is the final line of defence. Cannot be circumvented.

### Offline earning (safe — no change needed)

Earning points is server-side only. An offline order syncs → server creates order →
server triggers earn on completion. No client-side balance change. No risk.

The offline queue does not need a block on earning.

### Definition of "online" for this purpose

The existing `isOnline` flag in `offlineQueue.ts` / `OfflineBanner.tsx` is the reference.
When `navigator.onLine === false` OR when the backend health check fails, the device is
considered offline and loyalty redemption is unavailable.

---

## 11. QR / Kiosk / POS Rules

### Current state

| Channel | Org-loyalty earn | Org-loyalty redeem | Decision |
|---------|:---:|:---:|---------|
| Staff POS (orderRoutes) | Yes (Sprint 2) | Yes (Sprint 2) | In scope |
| Table service (guestRoutes) | Yes (Sprint 2) | Yes (Sprint 2) | In scope |
| QR ordering (menuRoutes) | No | No | Out of scope |
| Kiosk | No | No | Out of scope |
| Aggregator (Swiggy/Zomato) | No | No | Always excluded |

QR and kiosk remain loyalty-free in Sprint 2. Adding loyalty to QR/kiosk is a
separate sprint decision and must not be a side effect of org-loyalty changes.

---

## 12. Reporting Rules

### Branch report (per-hotel admin)

Shows only transactions where `hotelId === this branch`. Unchanged from today.
The only addition: transactions with `orgCustomerId` set are labeled
"Org Loyalty" in the transaction list (display-only, no behavior change).

Metrics:
- Points earned at this branch (sum of `points` where type='earn' and hotelId=branch)
- Points redeemed at this branch (sum of abs(points) where type='redeem' and hotelId=branch)
- Net loyalty liability change at this branch

### HQ report (new, org-level admin)

Shows:
- Total org loyalty issued (sum of earn transactions with orgCustomerId set)
- Total org loyalty redeemed (sum of redeem transactions with orgCustomerId set)
- Current org liability: sum of all `OrganizationCustomer.orgLoyaltyBalance` where orgHotelId = HQ
- Branch-by-branch breakdown: group by `branchHotelId`

Requires index `{ orgCustomerId: 1, branchHotelId: 1, createdAt: -1 }`.

### Customer org-history view

Shows for a linked customer:
- `OrganizationCustomer.orgLoyaltyBalance` (current org balance)
- All LoyaltyTransaction where `orgCustomerId = this customer`, sorted by `createdAt desc`
- Each transaction shows `branchHotelId` → resolved branch name
- Pre-link branch transactions (no orgCustomerId) visible via existing branch profile view

Branch admin sees only:
- Transactions where `hotelId = their branch`

HQ admin sees:
- All transactions across all branches (via orgCustomerId lookup)

### Pre-link branch history

Pre-link transactions have no `orgCustomerId`. They are visible in the branch's
own loyalty history under the original `CustomerProfile._id`. They are accessible
via `GET /api/loyalty/customers/:profileId/transactions` at the branch.

---

## 13. Security Rules

### JWT authority (preserved)

`req.hotelId` from JWT remains the authoritative branch identifier.
No org-loyalty operation is possible without a valid branch JWT.

### What must never be trusted from the client

| Field | Where rejected |
|-------|----------------|
| `orgCustomerId` | Never from client body; always resolved server-side from CustomerProfile.orgCustomerId |
| `orgHotelId` | Never from client; always resolved via hotel.parentHotelId (DB) |
| `branchHotelId` | Never from client; always equals req.hotelId (JWT) |
| `redeemedPoints` | Accepted as a hint only; server caps to min(client, orgBalance, maxByPercent) |
| `loyaltyDiscount` | Accepted as a hint only; server recalculates via calculateRedeemValue(verifiedPoints, hqConfig) |
| `orgLoyaltyBalance` | Never from client; read from OrganizationCustomer at time of operation |
| `pointValueInPaisa` | Never from client; always from getLoyaltyConfig(hqHotelId) |

### Cross-org access prevention

`resolveOrg()` in `orgCustomerRoutes.ts` verifies: `OrganizationCustomer.orgHotelId` must
belong to the same organization as `req.hotelId` (via hotel.parentHotelId chain).
This prevents a Branch A staff member from accessing an OrganizationCustomer that belongs
to a different organization.

### Attack scenarios

| Scenario | Defence |
|----------|---------|
| Branch A JWT used to redeem org points at Branch B | Not possible: each request uses its own JWT; org balance deducted by server regardless of which branch |
| Client sends inflated `redeemedPoints` | H1 cap: server ignores client value, recalculates |
| Client sends own `orgCustomerId` | Ignored; server resolves from CustomerProfile.orgCustomerId |
| Offline order with loyalty redemption | Layer 2 offline guard blocks at queue level |
| Concurrent double-redeem at two branches | $gte atomic guard on orgLoyaltyBalance |
| Staff at Branch A adjusting org balance of another org | resolveOrg() hotelId chain verification |

---

## 14. Concurrency Rules

### Redemption concurrency model

The concurrency model is identical to the existing single-branch model, applied to
`OrganizationCustomer.orgLoyaltyBalance` instead of `CustomerProfile.loyaltyBalance`.

```
Step 1: Authenticate (JWT)
Step 2: Resolve branch hotel (req.hotelId from JWT)
Step 3: Resolve org: hotel.parentHotelId → HQ hotel
Step 4: Resolve OrganizationCustomer: CustomerProfile.orgCustomerId
Step 5: Verify OrganizationCustomer.orgHotelId matches HQ hotel
Step 6: Load HQ loyalty config: getOrgLoyaltyConfig(hqHotelId)
Step 7: Validate: points >= minimumRedeemPoints, points <= maxByPercent
Step 8: Inside MongoDB session (same as order transaction):
         a. order.save()
         b. findOneAndUpdate({orgLoyaltyBalance: {$gte: points}}, {$inc: -points})
            → FAILS atomically if insufficient (never goes below 0)
         c. LoyaltyTransaction.create(...)
Step 9: Return discountAmount to order handler
```

### No pessimistic locking

Do not use pessimistic locks (`findOneAndUpdate` with `$set: { locked: true }` or
similar). The `$gte: points` conditional update is the lock — it is atomic and
non-blocking. This is the existing DinePOS pattern; preserve it.

---

## 15. Idempotency Rules

### Earn idempotency

```
Primary guard:   Order.loyaltyEarnedAt: null → now (atomic findOneAndUpdate)
Secondary guard: LoyaltyTransaction.idempotencyKey unique sparse index

Key format: "{orgCustomerId.toString()}:earn:{orderId.toString()}"
```

A retry of the same earn finds `Order.loyaltyEarnedAt` already set → skips.
If the primary guard is bypassed (rare race), the unique index rejects the duplicate
LoyaltyTransaction create.

### Redemption idempotency

Redemption is inside a MongoDB transaction. If the transaction rolls back (order save fails),
the org balance deduction rolls back. No partial state.

The `LoyaltyTransaction.idempotencyKey` is only needed if the transaction commits
partially — which MongoDB transactions prevent. The key is added as an extra safety layer.

```
Key format: "{orgCustomerId.toString()}:redeem:{orderId.toString()}"
```

### Cancellation reversal idempotency

```
For earn reversal:  Order.loyaltyEarnedAt: $ne null → set to null (atomic claim, existing)
For redeem restore: Payment.loyaltyReversedAt: null → now (existing pattern)
```

Same as today; no change for org-loyalty. The claim pattern prevents double-reversal.

### Manual adjustment

Admin-only, no idempotency key needed. One-time action, audited.

### Migration (BR-3 Option A = no migration)

No migration required. No idempotency concern.

---

## 16. Backward Compatibility

### Standalone hotel (parentHotelId: null)

No change to any behavior. `getLoyaltyConfig(hotelId)` unchanged.
`CustomerProfile.loyaltyBalance` unchanged. All loyalty routes unchanged.
`features.orgLoyalty` is absent → org-loyalty code path never activates.

### Multi-branch hotel before org-loyalty is enabled

`Hotel.features.orgLoyalty === false` (default). No org-loyalty code path activates.
Each branch continues with its own `CustomerProfile.loyaltyBalance`.
`OrganizationCustomer` records exist for identity linking but have no loyalty meaning.

### Multi-branch hotel after org-loyalty is enabled

**Only for customers who are explicitly linked (CustomerProfile.orgCustomerId is set)
and whose branch has `orgLoyaltyEnabled === true`:**

- Earn uses `orgLoyaltyBalance` on OrganizationCustomer
- Redeem uses `orgLoyaltyBalance` on OrganizationCustomer
- Pre-existing `CustomerProfile.loyaltyBalance` is frozen (not modified by org-loyalty operations)

**Unlinked customers at any branch:**
Unchanged. Branch loyalty works exactly as today.

**This means Sprint 2 can be deployed to a multi-branch org and only linked customers
are affected. Unlinked customers see zero change.**

---

## 17. Required Database Changes

### OrganizationCustomer (add one field)

```typescript
orgLoyaltyBalance: { type: Number, default: 0, min: 0 }
```

Default 0 — no migration needed. Existing documents get 0 on first access.

### LoyaltyTransaction (add three fields)

```typescript
orgCustomerId:  { type: Schema.Types.ObjectId, ref: 'OrganizationCustomer', default: null }
branchHotelId:  { type: Schema.Types.ObjectId, ref: 'Hotel', default: null }
idempotencyKey: { type: String, default: null, maxlength: 200 }
```

All nullable. Existing records remain valid (null values).

### LoyaltyTransaction (add three indexes)

```javascript
{ orgCustomerId: 1, createdAt: -1 }
{ orgCustomerId: 1, branchHotelId: 1, createdAt: -1 }
{ idempotencyKey: 1 }  // unique: true, sparse: true
```

### Hotel (add one field, used for BR-2)

```typescript
// In Hotel model, features sub-document:
orgLoyalty:        { type: Boolean, default: false }   // HQ: master switch
orgLoyaltyEnabled: { type: Boolean, default: true }    // branch: per-branch toggle
```

`orgLoyalty` is meaningful only on HQ hotels (parentHotelId: null).
`orgLoyaltyEnabled` is meaningful only on branch hotels (parentHotelId: set).
No migration needed — defaults are safe (false for HQ = feature off by default).

---

## 18. Required Backend Changes

### New utility functions

**`getOrgLoyaltyConfig(orgHotelId: string): Promise<LoyaltyConfig>`**

```typescript
// Same structure as getLoyaltyConfig, but:
// - reads Settings for the HQ hotel
// - reads features.orgLoyalty from the HQ Hotel document
// - returns LoyaltyConfig with enabled = hotel.features.orgLoyalty
```

**`earnOrgPoints(orgCustomerId, orgHotelId, branchHotelId, points, config, ctx): Promise<void>`**

```typescript
// 1. Atomic $inc on OrganizationCustomer.orgLoyaltyBalance
// 2. LoyaltyTransaction.create with orgCustomerId + branchHotelId + idempotencyKey
// Does NOT touch CustomerProfile.loyaltyBalance
```

**`redeemOrgPoints(orgCustomerId, orgHotelId, branchHotelId, points, config, ctx): Promise<number>`**

```typescript
// 1. Atomic $gte: points guard → $inc: -points on OrganizationCustomer.orgLoyaltyBalance
// 2. LoyaltyTransaction.create with orgCustomerId + branchHotelId + idempotencyKey
// Returns discountAmount
// Does NOT touch CustomerProfile.loyaltyBalance
```

**`reverseOrgEarnedPoints(orgCustomerId, orgHotelId, branchHotelId, points, config, ctx): Promise<void>`**

```typescript
// Capped deduction (same pattern as reverseEarnedPoints)
// Uses $max: [0, orgBalance - points]
```

**`resolveOrgCustomer(customerProfile, reqHotelId): Promise<{orgCustomer, hqConfig} | null>`**

```typescript
// Given a CustomerProfile, determine if org-loyalty applies:
// 1. profile.orgCustomerId must be set
// 2. HQ hotel must have features.orgLoyalty === true
// 3. Branch hotel (reqHotelId) must have features.orgLoyaltyEnabled !== false
// Returns {orgCustomer, hqConfig} or null (fall back to branch loyalty)
```

### Route changes

**`loyaltyRoutes.ts`**

- `GET /loyalty/customers/lookup` — add `orgLoyaltyBalance` to response when customer is linked
- `POST /loyalty/otp/send` — unchanged (branch CustomerProfile lookup is correct)
- `POST /loyalty/otp/verify` — return `orgLoyaltyBalance` instead of `loyaltyBalance`
  when customer is linked and org-loyalty is active
- New: `GET /api/org-customers/:id/loyalty` — org loyalty summary + transaction history

**`orderRoutes.ts`** (earn + redeem)

```
In order creation (redemption):
  1. Try resolveOrgCustomer(profile, req.hotelId)
  2. If org-loyalty active: use redeemOrgPoints()
  3. Else: use existing redeemPoints() (unchanged)

In order completion (earning):
  1. Try resolveOrgCustomer(profile, req.hotelId)
  2. If org-loyalty active: use earnOrgPoints()
  3. Else: use existing earnPoints() (unchanged)
```

**`guestRoutes.ts`** — same pattern as orderRoutes for earn and redeem.

### No changes to

- Payment routes (Razorpay, UPI, QR) — untouched
- menuRoutes — no loyalty
- Kiosk routes — no loyalty
- Printer architecture — untouched
- walletRoutes — separate, untouched
- Existing `earnPoints()`, `redeemPoints()`, `reverseEarnedPoints()`, `adjustPoints()`
  — all unchanged, called as fallback for non-org-loyalty paths

---

## 19. Required Frontend Changes

### NewOrderPanel.tsx

- When org-loyalty is active and customer is linked, display `orgLoyaltyBalance`
  instead of `loyaltyBalance`
- Label: "Org Points" vs "Points" (controlled by response field, not hardcoded)
- Disable loyalty redemption UI when `isOnline === false` (Layer 1 offline guard)
- No other loyalty UI changes in Sprint 2

### offlineQueue.ts

Add one block in `assertOfflineQueueable()`:

```typescript
if (((order as CreateOrderPayload).redeemedPoints ?? 0) > 0) {
  throw new OfflineQueueError(
    'LOYALTY_REDEMPTION_ONLINE_ONLY',
    'Loyalty redemption requires an internet connection.'
  );
}
```

This is a safety fix applicable to all loyalty (not just org-loyalty) and should be
shipped as a standalone fix before org-loyalty goes live.

### No other frontend changes in Sprint 2

No new loyalty UI components. No customer-facing org loyalty pages.
No local loyalty balance computation. No client-side point arithmetic changes.

---

## 20. Required Tests

### Pure-logic tests (ts-jest, no DB/HTTP)

Minimum 25 tests for Sprint 2:

**Org-loyalty config (3 tests)**
- `getOrgLoyaltyConfig` returns HQ settings when HQ has orgLoyalty enabled
- `getOrgLoyaltyConfig` returns disabled when HQ has orgLoyalty disabled
- `resolveOrgCustomer` returns null when branch has orgLoyaltyEnabled = false

**Org earn arithmetic (4 tests)**
- Earn rate uses HQ pointsPerHundredRupees, not branch rate
- `calculationBase: 'before_gst'` uses subtotal
- `maxEarnPointsPerBill` cap applied
- Customer with loyaltyOptOut → 0 points earned

**Org redeem arithmetic (5 tests)**
- Correct discountAmount = (points × HQ.pointValueInPaisa) / 100
- maximumRedeemPercent cap applied using HQ config
- requestedPoints > orgBalance → throws Insufficient
- Two concurrent redeem requests: only one wins ($gte guard)
- redeemedPoints client value capped server-side

**Offline guard (3 tests)**
- Order with redeemedPoints > 0 throws LOYALTY_REDEMPTION_ONLINE_ONLY
- Order with redeemedPoints = 0 passes (earning not blocked)
- Order with redeemedPoints undefined passes

**BR-2 opt-out (3 tests)**
- orgLoyalty = false at HQ → returns null from resolveOrgCustomer
- orgLoyaltyEnabled = false at branch → returns null from resolveOrgCustomer
- No orgCustomerId → returns null (branch loyalty fallback)

**BR-3 pre-link balance (3 tests)**
- Linking a profile does NOT change CustomerProfile.loyaltyBalance
- Linking a profile does NOT change OrganizationCustomer.orgLoyaltyBalance
- Unlinking a profile does NOT change any loyalty balance

**Backward compatibility (4 tests)**
- Standalone hotel order: existing earnPoints() called, not earnOrgPoints()
- Branch customer without orgCustomerId: existing redeemPoints() called
- Multi-branch + orgLoyalty disabled: existing branch loyalty unchanged
- All Sprint 1 tests (MB-S7-01..20) continue to pass

### Integration tests (optional Sprint 2, strongly recommended)

- Concurrent redemption: two simultaneous redeemOrgPoints calls, only one succeeds
- Earn + immediate cancel: org balance returns to pre-earn value
- Idempotency: duplicate earn request (same idempotencyKey) → single LoyaltyTransaction

---

## 21. Migration Plan

### Schema migration (no downtime)

MongoDB schema changes are additive (new nullable fields, new indexes).
The Mongoose model changes deploy hot — existing documents continue to work with null values.

**Order of operations:**

1. Deploy updated Hotel model (adds `features.orgLoyalty`, `features.orgLoyaltyEnabled`)
2. Deploy updated LoyaltyTransaction model (adds `orgCustomerId`, `branchHotelId`, `idempotencyKey`)
3. Deploy updated OrganizationCustomer model (adds `orgLoyaltyBalance`)
4. Build new indexes in the background (MongoDB background index build, no lock)
5. Deploy backend route and utility changes
6. Deploy frontend changes (offlineQueue guard + org balance display)
7. HQ admin manually enables `features.orgLoyalty` when ready to go live

**The org-loyalty feature is gated by `features.orgLoyalty = false` (default).
No customer behavior changes until the HQ admin explicitly enables it.**

### Customer data migration (none required)

Per BR-3 decision: no balance migration on linking. Zero data to migrate.

### Rollback

If Sprint 2 has a defect:
1. Set `features.orgLoyalty = false` on HQ hotel → org-loyalty immediately deactivated
2. All linked customers fall back to branch loyalty (unchanged behavior)
3. Any `orgLoyaltyBalance` accrued can be left in place (idempotent, won't affect branch operations)
4. Roll back backend deployment

The feature flag makes rollback instantaneous without data loss.

---

## 22. Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Concurrent redemption at two branches draining org balance | HIGH | `$gte: points` atomic guard on orgLoyaltyBalance — identical to existing branch guard |
| Staff enables orgLoyalty before linked customers exist | LOW | orgLoyaltyBalance = 0 → no points to earn/redeem yet; no harm |
| Customer confusion: pre-link branch points not visible in org view | MEDIUM | Sprint 2 doc: explain to staff; future UI shows pre-link balance separately |
| Offline guard not deployed before orgLoyalty goes live | HIGH | Deploy offline guard (Section 10) as standalone change before enabling orgLoyalty |
| Branch opt-out (orgLoyaltyEnabled = false) confuses cashiers | MEDIUM | Cashiers see branch loyalty UI when org-loyalty is not active — no new confusion |
| Admin accidentally enables orgLoyalty before Sprint 2 is deployed | LOW | Feature flag check is in code; flag is meaningless without the new code paths |
| Different `rewardName` at HQ vs branch confuses display | LOW | Display always uses HQ config.rewardName when org-loyalty is active |
| loyaltyExpiryWorker not updated in Sprint 2 | MEDIUM | Org-loyalty earn transactions with expiresAt will not be swept → org balance will not expire. Acceptable for Sprint 2 (most orgs set expiryDays = 0). Worker extension is Sprint 3. |
| Pre-link LoyaltyTransaction records have no orgCustomerId | LOW | These are branch records; join via CustomerProfile.orgCustomerId for historical view |
| New indexes cause performance impact | LOW | Background index build; no lock; compound indexes are efficient |

---

## 23. Sprint 2 Exact Scope

### In scope

| Item | Type |
|------|------|
| `Hotel.features.orgLoyalty` (HQ flag) | Schema |
| `Hotel.features.orgLoyaltyEnabled` (branch flag) | Schema |
| `OrganizationCustomer.orgLoyaltyBalance` | Schema |
| `LoyaltyTransaction.orgCustomerId` | Schema |
| `LoyaltyTransaction.branchHotelId` | Schema |
| `LoyaltyTransaction.idempotencyKey` | Schema |
| Three new LoyaltyTransaction indexes | Schema |
| `getOrgLoyaltyConfig(orgHotelId)` | Utility |
| `resolveOrgCustomer(profile, reqHotelId)` | Utility |
| `earnOrgPoints(orgCustomerId, ...)` | Utility |
| `redeemOrgPoints(orgCustomerId, ...)` | Utility |
| `reverseOrgEarnedPoints(orgCustomerId, ...)` | Utility |
| orderRoutes: org-aware earn + redeem | Route |
| guestRoutes: org-aware earn + redeem | Route |
| loyaltyRoutes: orgLoyaltyBalance in lookup + verify | Route |
| New: `GET /api/org-customers/:id/loyalty` | Route |
| offlineQueue.ts: block redeemedPoints > 0 | Frontend |
| NewOrderPanel: display orgLoyaltyBalance when linked | Frontend |
| ≥25 pure-logic tests | Tests |

### Out of scope (explicitly deferred)

| Item | Reason |
|------|--------|
| Pre-link balance migration tool | BR-3 decision: no migration in Sprint 2 |
| QR/kiosk loyalty | Separate sprint |
| loyaltyExpiryWorker org extension | Sprint 3 |
| Org-level tier system | Not in current design |
| Branch admin org-loyalty settings | HQ settings only (BR-1) |
| Manual balance transfer tool (Option C from BR-3) | Future admin feature |
| Org loyalty reports UI | Sprint 3 (data model ready in Sprint 2) |
| WhatsApp receipt for org loyalty | No change to WhatsApp flow |
| Tally sync for org loyalty | No change to Tally flow |

The audit suggested: one field on OrganizationCustomer + two on LoyaltyTransaction +
two utility functions + one offline guard + worker extension.

Revised scope: three fields on LoyaltyTransaction + three indexes + one field on
OrganizationCustomer + three fields on Hotel + five utility/helper functions + route
changes in two files + two frontend changes + ≥25 tests.

Worker extension is deferred to Sprint 3.

---

## 24. GREEN / YELLOW / RED

### GREEN — Decisions made, no ambiguity

| Decision | Rule |
|----------|------|
| BR-1: Which settings | HQ settings authoritative for all org-loyalty transactions |
| BR-2: Branch opt-out | HQ-controlled per-branch flag; branch admins cannot override |
| BR-2: What opt-out means | Neither earning nor redemption at opted-out branch |
| BR-3: Existing balances | No migration; pre-link balances stay branch-scoped |
| Offline redemption | Blocked at queue level + UI level; Layer 1 + Layer 2 |
| Concurrent safety | $gte atomic guard on orgLoyaltyBalance |
| Identity | Explicit linking only, existing invariants preserved |
| Backward compat | Standalone and pre-orgLoyalty behavior completely unchanged |
| Rollback | Feature flag makes instant rollback possible |

### YELLOW — Implementable, low risk, monitor

| Item | Note |
|------|------|
| loyaltyExpiryWorker org extension | Deferred to Sprint 3; orgs using expiryDays > 0 will accumulate non-expiring org-loyalty points until Sprint 3 |
| Pre-link balance confusion | Communication/UX issue, not a data integrity issue |
| Staff UI for pre-link vs post-link points | Not addressed in Sprint 2; acceptable for initial release |

### RED — Must be resolved before Sprint 2 ships

| Item | Note |
|------|------|
| Offline guard (Section 10) | Must be deployed and tested before `features.orgLoyalty` is enabled in production |
| loyaltyExpiryWorker does NOT expire org points | Acceptable for Sprint 2 only if all orgs have `expiryDays = 0`; must be confirmed before enabling orgLoyalty at any org with expiryDays > 0 |

---

## 25. FINAL DESIGN VERDICT

**DESIGN LOCKED — READY FOR SPRINT 2**

All three business rules have been analyzed and resolved:

**BR-1:** HQ Settings.loyaltySettings are authoritative for all org-loyalty
transactions. Branch settings are ignored for org-loyalty. `getOrgLoyaltyConfig(hqHotelId)`
is the new config loader for org-loyalty paths.

**BR-2:** Organization loyalty participation is HQ-controlled. HQ enables the master
switch (`features.orgLoyalty`). HQ can disable individual branches (`features.orgLoyaltyEnabled`).
Branch admins cannot override. Opt-out means neither earning nor redemption at that branch.

**BR-3:** No automatic migration of pre-existing branch balances. Pre-link balances
remain on `CustomerProfile.loyaltyBalance` and are redeemable at the original branch.
Only post-link earnings accumulate on `OrganizationCustomer.orgLoyaltyBalance`. Linking
is safe, reversible, and makes zero changes to any loyalty balance.

**Condition:** The offline redemption guard (Section 10 Layer 2, `offlineQueue.ts`)
MUST be deployed and confirmed working before `features.orgLoyalty` is enabled in
any production organization.

**Sprint 2 scope is defined in Section 23.** The schema changes are additive (all
new fields nullable with safe defaults), the feature is gated behind `features.orgLoyalty = false`,
and rollback is instantaneous via the feature flag.

---

*Design Lock complete. No production code was modified.*
*Pending: Sprint 2 implementation pending team review of this document.*
