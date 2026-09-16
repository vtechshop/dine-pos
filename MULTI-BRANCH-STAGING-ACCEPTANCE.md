# Multi-Branch Staging Acceptance Checklist

**Status:** PENDING STAGING VALIDATION
**Code branch:** main
**Last code update:** 2026-09-16 (Sprint 6 hardening complete)

---

## Environment Setup

| Item | Value | Status |
|---|---|---|
| Staging URL | TBD | PENDING |
| Staging DB | Separate staging MongoDB (NOT production) | PENDING |
| Org / HQ Hotel | "Test HQ Hotel" | PENDING |
| Branch A | "Test Branch A" | PENDING |
| Branch B | "Test Branch B" | PENDING |
| Branch C | "Test Branch C (Disabled Products)" | PENDING |

---

## Test Accounts

| Role | Username / Code | Hotel Context |
|---|---|---|
| HQ Admin | hq-admin / testpass | Test HQ Hotel |
| Branch A Admin | branch-a-admin / testpass | Test Branch A |
| Branch B Admin | branch-b-admin / testpass | Test Branch B |
| Cashier A | CashierA / PIN 1234 | Test Branch A |
| Cashier B | CashierB / PIN 1234 | Test Branch B |
| Kitchen A | KitchenA / PIN 1234 | Test Branch A |
| Kitchen B | KitchenB / PIN 1234 | Test Branch B |

---

## Test Data

### Products
| Product | Org Price | Branch A Price | Branch B Price | Branch C |
|---|---|---|---|---|
| Test Product (barcode: TESTPROD001) | ₹100 | ₹80 | ₹90 | Disabled |

### Category
- "Test Category" — enabled at all branches by default

### Customer
- "Test Customer" — phone 9876500001

### Coupon
- "TESTCOUPON" — org-scope, all branches

### Gift Voucher
- "TESTVOUCHER" — org-scope, ₹500 value

### Settings
- HQ: `businessType = "Restaurant"`, `defaultTaxPercent = 5`
- Branch A: no override (inherits from HQ)
- Branch B: `defaultTaxPercent = 12` (override)

---

## Staging Test Plan

### Authentication & Branch Switching

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-01 | Login as HQ Admin | Logged in to HQ context; branch switcher visible | PENDING |
| MB-STAGE-02 | View branches in branch switcher | Branch A, B, C listed | PENDING |
| MB-STAGE-03 | Switch HQ → Branch A | Branch A token issued; page reloads; header shows "Branch A" | PENDING |
| MB-STAGE-04 | Switch Branch A → Branch B | Branch B token issued; page reloads; header shows "Branch B" | PENDING |
| MB-STAGE-05 | Verify no Branch A data visible in Branch B | Cart empty; no stale Branch A shift data | PENDING |
| MB-STAGE-06 | Switch Branch B → HQ (switch to org) | HQ context restored; HQ token refreshed; no branch data | PENDING |
| MB-STAGE-35 | Long branch session → switchToOrg | Stay in branch 20+ min; switch back to HQ; verify HQ token is fresh (no 401 on first API call) | PENDING |
| MB-STAGE-40 | Browser refresh after branch switch | After reload, correct branch context shown; no stale data | PENDING |

### Product Catalog & Pricing

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-04 | View products in Branch A | Only Branch A-enabled products shown at Branch A prices | PENDING |
| MB-STAGE-05 | Verify Branch A product price | Test Product = ₹80 | PENDING |
| MB-STAGE-07 | View products in Branch B | Only Branch B-enabled products shown at Branch B prices | PENDING |
| MB-STAGE-08 | Verify Branch B product price | Test Product = ₹90 | PENDING |
| MB-STAGE-09 | Branch A data absent in Branch B | ₹80 price not visible in Branch B | PENDING |

### Barcode Scanning

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-10 | Scan barcode TESTPROD001 in Branch B | Found; price = ₹90 | PENDING |
| MB-STAGE-11 | Verify barcode returns Branch B price | ₹90 (not ₹100 org price, not ₹80 Branch A price) | PENDING |
| MB-STAGE-12 | Scan barcode TESTPROD001 in Branch C context | Not found (product disabled at Branch C) | PENDING |

### Category Visibility

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-13 | View categories at Branch A | Test Category visible (default-ENABLED) | PENDING |
| MB-STAGE-13b | Disable Test Category at Branch A from HQ admin | Category hidden in Branch A POS; still visible at Branch B | PENDING |

### Settings Inheritance

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-14 | View settings at Branch A | `defaultTaxPercent` shows "Inherited from Organization" badge | PENDING |
| MB-STAGE-15 | Override `defaultTaxPercent` at Branch A | Override saved; badge disappears | PENDING |
| MB-STAGE-16 | Reset `defaultTaxPercent` override at Branch A | Badge reappears; HQ value restored | PENDING |

### Customer Management

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-17 | Search for Test Customer from Branch A | Customer found (scoped to Branch A) | PENDING |
| MB-STAGE-18 | Explicit customer linking to org identity | Link only sets orgCustomerId; loyaltyBalance unchanged | PENDING |

### Coupons & Vouchers

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-19 | Validate TESTCOUPON at Branch A | Accepted (org-scope coupon, all branches) | PENDING |
| MB-STAGE-20 | Redeem TESTVOUCHER at Branch B | Balance deducted; correct branch context maintained | PENDING |

### Orders & Inventory

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-21 | Place order at Branch A | Order created with Branch A hotelId; price = ₹80 (server-resolved) | PENDING |
| MB-STAGE-22 | Verify Branch A inventory deducted (if configured) | Inventory deducted only from Branch A | PENDING |
| MB-STAGE-23 | Open shift at Branch A; close shift | Shift reports scoped to Branch A only | PENDING |

### Printer / KOT

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-24 | Place order at Branch A; verify KOT | KOT prints on Branch A's configured printer ONLY | HARDWARE VALIDATION — PENDING |
| MB-STAGE-25 | Complete payment at Branch A; verify receipt | Cashier receipt from Branch A printer | HARDWARE VALIDATION — PENDING |
| MB-STAGE-26 | Verify Branch B printer isolation | Branch A order never reaches Branch B printer | HARDWARE VALIDATION — PENDING |

### Socket Isolation

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-27 | Branch A and Branch B in separate browser sessions | Order placed at Branch A appears in Branch A kitchen view ONLY; not in Branch B kitchen | PENDING |

### QR / Kiosk Ordering

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-28 | QR order in Branch A context | Order created with Branch A hotelId | PENDING |
| MB-STAGE-29 | Kiosk cash payment at Branch A | Order completes with Branch A context | PENDING |
| MB-STAGE-30 | Kiosk Razorpay at Branch A | Razorpay initiated; payment verified; order released with Branch A context | PROVIDER VALIDATION — PENDING |

### Offline Branch Switching

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-31 | Go offline; place order at Branch A | Order queued with Branch A hotelId | PENDING |
| MB-STAGE-32 | Switch branch while offline; come back online | Offline queue from Branch A syncs with Branch A; no cross-branch leakage | PENDING |

### External Integrations

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-33 | Tally sync in branch context | Tally receives branch-scoped ledger entries | PENDING |
| MB-STAGE-34 | WhatsApp receipt in branch context | WhatsApp receipt sent from branch identity | PENDING |

### Security

| ID | Test | Expected Result | Status |
|---|---|---|---|
| MB-STAGE-36 | Attempt cross-org access via API with Branch A token | 403/404 — no cross-org data | PENDING |
| MB-STAGE-37 | Branch A cashier cannot access Branch B data | 401/403 | PENDING |
| MB-STAGE-38 | Switch to suspended Branch C | UI shows "suspended" badge; switch rejected | PENDING |
| MB-STAGE-39 | Standalone single-branch hotel | All Multi-Branch features invisible; existing behavior unchanged | PENDING |

---

## Printer Physical Test (Hardware Required)

> **HARDWARE VALIDATION — PENDING** — No hardware available in development environment.

### Single printer (cashier receipt only):
1. Place order → verify NO KOT fires
2. Complete payment → cashier receipt prints
3. Verify branch name on receipt

### Dual printer (kitchen + cashier):
1. Place order → Kitchen KOT prints on Branch's kitchen printer
2. Complete payment → Cashier receipt prints on Branch's cashier printer
3. Verify Branch A printer NEVER receives Branch B jobs

---

## Razorpay Provider Test (Provider Credentials Required)

> **PROVIDER VALIDATION — PENDING** — Use Razorpay test/sandbox credentials only. Do NOT use production credentials for this test.

1. Initiate Razorpay QR payment from Branch A context
2. Simulate successful payment in Razorpay sandbox
3. Verify: server verification → atomic order release → `new_order` socket event
4. Verify NO kitchen release before server verification
5. Send duplicate webhook → verify exactly one release (idempotency)
6. Verify branch context is preserved throughout payment lifecycle

---

## Final Acceptance Signature

| Tester | Role | Date | Signature |
|---|---|---|---|
| | HQ Admin | | |
| | Branch A Admin | | |
| | Branch B Admin | | |
| | QA Lead | | |
| | Tech Lead | | |

**Staging sign-off required before production deployment.**
