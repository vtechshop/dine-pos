# Decisions needed — accounting and ordering policy (2026-10)

Status: **OPEN — no code has been changed for these.** Each item needs an
owner's decision (ideally confirmed with the restaurant's CA) before it is
implemented. Line references are to the working tree on 2026-10-28.

> Legal notes below are a summary for discussion, not tax advice. Confirm with a
> Chartered Accountant before changing invoice or GST behaviour.

---

## A. GST on discounted bills

### Current implementation
- Order creation (`backend/src/routes/orderRoutes.ts`, `recalcOrderTotals`):
  tax is **exclusive**, computed **per line on the undiscounted price**
  (`lineBase = round2(unit × qty)`, `tax = round2(lineBase × taxPercent / 100)`).
- Discounts (manual → coupon → loyalty) are subtracted **after** tax from
  `subtotal + taxTotal`. Tax is never recomputed on the discounted value.
  `items[].discountAllocated` is display-only.
- The post-order `additionalDiscount` (PATCH `/orders/:id/payment`) reduces
  `grandTotal` only; `taxTotal` is unchanged.
- GST report / GSTR-1 export (`reportRoutes.ts` ~line 66 and ~200):
  `taxableValue = Σ items.price × items.quantity` — **ignores all discounts**;
  `taxAmount = Σ items.taxAmount` (pre-discount tax).
- CGST/SGST = tax ÷ 2 (intra-state only).

### Consequence today
On any discounted bill the invoice shows (and reports declare) GST on the full
pre-discount value, while the customer pays less. Taxable value and tax in GSTR-1
are overstated relative to the actual transaction value.

### Relevant rules (India)
- CGST Act s.15(3)(a): a discount given **before or at the time of supply** and
  **recorded in the invoice** is excluded from the value of supply — GST is
  charged on the net value.
- Post-supply discounts (s.15(3)(b)) need a prior agreement and credit notes.
- Treatment can differ by discount type: manual/coupon discounts shown on the
  invoice qualify; loyalty-point redemption is commonly treated as a discount when
  shown on the invoice, but confirm with the CA. Paid gift vouchers and wallet
  balances are **not** discounts (see B).

### Options
1. **Keep as is.** Simple; over-declares GST on discounted bills.
2. **Discount before tax (recommended).** Allocate invoice-time discounts
   (manual, coupon, loyalty, additionalDiscount) pro-rata to lines, compute
   `taxableValue = lineBase − discountAllocated` and tax on that.
   Changes printed bills, `taxTotal`, GST reports, Tally export.
3. **Report-only fix.** Keep billing as is but report taxable value net of
   discounts — inconsistent with the printed invoice; not recommended.

### Affected areas (for option 2)
`recalcOrderTotals`, `PATCH /:id/payment` (additionalDiscount must re-allocate
tax), public/QR order pricing (`menuRoutes.ts`, `qrRoutes.ts`), web
`CashierContext.calcCartTotals` / `PaymentModal`, mobile cart totals, receipt
templates (web + mobile + `printUtils`), `reportRoutes` GST/GSTR-1/HSN,
`tallyXmlBuilder`, daily snapshots. Needs regression tests for each rounding
path and a cut-over date (old orders keep their stored values).

---

## B. Wallet and gift-voucher redemption — payment or discount?

### Current implementation
- POS orders (`orderRoutes.ts` ~line 1014–1030): voucher and wallet amounts are
  **subtracted from `grandTotal`** (`grandTotalBeforeWallet`, `finalGrandTotal`).
  The stored order total is therefore the cash collected, not the invoice value.
- Dine-in guest/table billing (`guestRoutes.ts`, `sessionRoutes.ts`): the voucher
  is applied to the **Guest** bill only; `Order.grandTotal` is **not** reduced.
- Reports sum `Order.grandTotal`, so the same sale is reported differently
  depending on channel, and POS sales paid by voucher/wallet are **understated**.
- Wallet top-ups (`walletRoutes.ts`) are not recorded in shift cash.

### Why this matters
A paid gift voucher or wallet balance is money the customer already gave the
restaurant (a liability until redeemed). Redeeming it is a **means of payment**,
not a price reduction. GST: vouchers are treated as instruments of
consideration, with GST arising on the underlying supply when redeemed (see
CBIC circular on vouchers, Dec 2024, and the CGST provisions on vouchers) — so the
full sale value remains taxable. Treating redemption as a discount understates
revenue and taxable value.

Exception: **promotional/free vouchers** (not purchased) are economically a
discount — they should be modelled separately from purchased vouchers.

### Options
1. **Keep as is** — inconsistent between channels; revenue understated.
2. **Tender model (recommended).** `grandTotal` = invoice value always. Wallet and
   purchased-voucher redemptions become payment lines (`payments[]` with
   `mode: 'wallet' | 'gift_voucher'`). Revenue/GST from invoice value; cash/UPI
   reconciliation from payment lines; voucher/wallet balances reported as
   liabilities. Promotional vouchers become a discount type (falls under A).
3. **Discount model everywhere** — consistent but wrong for purchased value.

### Affected areas (for option 2)
`Order` schema (payment `mode` enum), `orderRoutes` create/cancel/refund,
guest/session billing, shift expected-cash (wallet top-up as cash-in), all
revenue reports, daily snapshot, Tally export, receipts. Historical orders need
a reporting adjustment (`grandTotal + walletAmount + giftVoucherAmount`) rather
than a data rewrite.

---

## C. Audit-log retention vs. GST record retention

### Current implementation
`backend/src/models/AuditLog.ts` line 26:
`{ createdAt: 1 }, { expireAfterSeconds: 7_776_000 }` — **every audit entry is
deleted after 90 days**, including order voids, refunds, discount changes and
payment edits.

### Relevant rules (India)
- CGST Act s.36: accounts and records must be kept for **72 months** from the due
  date of the annual return for the year.
- Companies Act s.128(5) (for companies): books of account for 8 years.
- Audit logs are supporting evidence for voids/refunds/discounts on invoices.

### Options
1. **Keep 90 days** — evidence for older refunds/voids is lost.
2. **Split retention (recommended).** Keep financial actions (`order.*`,
   `refund`, `discount`, `payment*`, `shift.*`, `guest.billed`, `session.closed`)
   for ≥ 8 years (no TTL, or archive monthly to cold storage); keep TTL for
   non-financial noise (logins, settings views).
3. **No TTL at all** — simplest; storage grows unbounded.

### Migration notes
Changing a TTL is done with `collMod` (no data loss) or by dropping/re-creating
the index. Dropping the TTL index **stops** deletion; entries older than 90 days
are already gone and cannot be recovered. Not destructive, but run in a
maintenance window after a backup.

---

## D. Kiosk "pay at counter" orders are unauthenticated

### Current implementation
The public order routes (`/api/public/orders`, `/api/public/qr/orders`) accept
`orderSource: 'kiosk'` with cash when the hotel's premium `kiosk` feature is on.
These go straight to the kitchen (KOT + `new_order`). The kiosk device is not
authenticated — anyone who knows the hotelId (it is in QR URLs) can send such an
order to a kiosk-enabled hotel. (Anonymous `dine-in` cash orders were closed in
this round; QR orders already require verified online payment.)

### Options
1. **Keep** — rely on the feature flag and rate limits.
2. **Kiosk device token (recommended).** Register kiosk devices (existing
   `Device`/`deviceRoutes`) and require a signed device token for kiosk cash
   orders. Needs a mobile/kiosk app change and a rollout window.
3. **Hold for acceptance.** Kiosk cash orders stay unreleased until a cashier
   accepts them (new status). Adds a staff step during busy hours.

---

## E. Reports and shift cash — defaults chosen in release 2026-10 (confirm)

Implemented as **policy-neutral fixes** (from existing code comments, UAT plan and
the GST/Tally reports that already used them): revenue = completed orders only;
complimentary bills excluded (UAT CSH-07); unpaid orders shown separately as
"open orders"; shift cash = cash actually received, by payment time, each payment
once. The following **defaults** need confirmation:

1. **Refund period.** Refunds are deducted in the period they were **issued**
   (`refundedAt`), not the period of the original sale — no closed period is
   rewritten. Alternative: deduct from the sale's period (retroactive). GST/GSTR-1/
   Tally are unchanged until credit-note treatment is decided.
2. **Cash refunds in the drawer.** The refund route now records an optional
   `refundMethod` (cash / upi / card / original / other). Cash refunds are **shown**
   in shift stats but **not auto-subtracted**, because staff currently record them
   as a manual cash-out ("Refund to customer"); auto-subtracting both would count
   them twice. Option: auto-subtract and remove the manual cash-out step.
3. **Order refunds vs gateway refunds** are separate records (`Order.refundAmount`
   vs `Payment.refundedAmount`) and are not linked; a Razorpay order could be
   refunded in both places. Option: link them or allow only one path per order.
4. **Tips** are not part of expected cash (unchanged). Decide whether cash tips
   go into the drawer total.
5. **Sales date for GST/Tally.** Reports still bucket sales by order creation
   date. Moving to payment date (`completedAt`) would move orders across
   already-filed periods — needs a cut-over date and CA sign-off.
6. **Hourly / daily snapshot workers** still count non-cancelled orders (they
   aggregate before most orders are paid). Switching them needs a re-aggregation
   design; until then AI insights / executive dashboard may differ from the
   daily sales report.

## Decision log
| Item | Decision | Owner | Date |
|------|----------|-------|------|
| A. GST after discounts | _pending_ | | |
| B. Wallet / voucher treatment | _pending_ | | |
| C. Audit-log retention | _pending_ | | |
| D. Kiosk order authentication | _pending_ | | |
| E1–E6. Report / shift defaults | _pending confirmation_ | | |
