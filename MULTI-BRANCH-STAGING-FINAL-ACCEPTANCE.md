# MULTI-BRANCH STAGING FINAL ACCEPTANCE

**Status:** STAGING BLOCKED — ENVIRONMENT NOT AVAILABLE
**Date:** 2026-09-16
**Report author:** Claude Sonnet 4.6 (automated acceptance run)
**Code sprints covered:** Multi-Branch Sprints 1–7

---

## 1. Environment

| Component | Expected | Actual | Status |
|-----------|----------|--------|--------|
| Frontend staging URL | Dedicated staging URL | `https://api.dinepos.com/api` (production domain, unreachable) | BLOCKED |
| Backend staging URL | Dedicated staging backend | `localhost:5000` — server NOT running | BLOCKED |
| MongoDB staging DB | Separate staging Atlas cluster | `hotelbillingpos` on production Atlas cluster | BLOCKED — production DB; tests prohibited |
| Redis | REDIS_URL for multi-instance Socket.IO | Not configured in .env | NOT AVAILABLE |
| Razorpay sandbox | Test credentials (`rzp_test_`) | Live credentials only (`rzp_live_TTs8Nv6CrZ2M6b`) in .env | BLOCKED — no sandbox |
| MSG91 / WhatsApp | Provider credentials | No MSG91 / WhatsApp credentials in any .env | NOT CONFIGURED |
| Tally | Local TallyPrime bridge | No Tally config in .env | NOT AVAILABLE |
| Printers | Physical thermal printer(s) | No printer config; development machine only | HARDWARE NOT AVAILABLE |
| HQ test hotel | Multi-branch org in staging DB | No staging DB | NOT AVAILABLE |
| Branch A / Branch B | Branch hotels in staging DB | No staging DB | NOT AVAILABLE |
| Test accounts | Admin/staff/cashier accounts | No staging DB | NOT AVAILABLE |

**Critical blocker:** `backend/.env` `MONGODB_URI` connects to the production
MongoDB Atlas cluster (`hotelbillingpos`). Running any real API or browser
tests against a running backend would read/write PRODUCTION DATA. This is
explicitly prohibited. No staging environment can be constructed from the
current configuration without first provisioning a separate staging MongoDB
database, staging backend deployment, and staging frontend deployment.

---

## 2. Automated Baseline (Phase 22 — confirmed 2026-09-16)

| Metric | Result |
|--------|--------|
| Test suites | 25 passed |
| Tests passed | 851 |
| Tests failed | **0** |
| Tests skipped | 2 |
| Tests todo | 15 |
| Backend TypeScript (`npx tsc --noEmit`) | **0 errors** |
| Frontend TypeScript (`npx tsc --noEmit`) | **0 errors** |
| Production build (`npx vite build`) | **PASS** (14s; pre-existing chunk-size warning for jspdf/html2canvas, not Sprint 7) |

Automated baseline is confirmed clean. No regressions from Sprint 7 changes.

---

## 3. Staging Test Matrix

All 40 scenarios from MULTI-BRANCH-STAGING-ACCEPTANCE.md are listed below.
Every scenario is BLOCKED because no staging environment is available.
No fabricated results are recorded.

| ID | Scenario | Result | Blocking reason |
|----|----------|--------|-----------------|
| MB-STAGE-01 | Login as HQ Admin | BLOCKED | No staging backend/DB |
| MB-STAGE-02 | View branches in branch switcher | BLOCKED | No staging backend/DB |
| MB-STAGE-03 | Switch HQ → Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-04 | View products in Branch A / Switch Branch A → Branch B | BLOCKED | No staging backend/DB |
| MB-STAGE-05 | Verify Branch A product price / No stale data after switch | BLOCKED | No staging backend/DB |
| MB-STAGE-06 | Switch Branch B → HQ (switchToOrg) | BLOCKED | No staging backend/DB |
| MB-STAGE-07 | View products in Branch B | BLOCKED | No staging backend/DB |
| MB-STAGE-08 | Verify Branch B product price (₹90) | BLOCKED | No staging backend/DB |
| MB-STAGE-09 | Branch A data absent in Branch B | BLOCKED | No staging backend/DB |
| MB-STAGE-10 | Scan barcode TESTPROD001 in Branch B | BLOCKED | No staging backend/DB |
| MB-STAGE-11 | Verify barcode returns Branch B price | BLOCKED | No staging backend/DB |
| MB-STAGE-12 | Scan barcode TESTPROD001 in Branch C (disabled) | BLOCKED | No staging backend/DB |
| MB-STAGE-13 | View categories at Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-13b | Disable category at Branch A from HQ admin | BLOCKED | No staging backend/DB |
| MB-STAGE-14 | Settings inheritance badge at Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-15 | Override defaultTaxPercent at Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-16 | Reset override at Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-17 | Search customer from Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-18 | Explicit customer linking / no auto-merge | BLOCKED | No staging backend/DB |
| MB-STAGE-19 | Validate TESTCOUPON at Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-20 | Redeem TESTVOUCHER at Branch B | BLOCKED | No staging backend/DB |
| MB-STAGE-21 | Place order at Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-22 | Branch A inventory deduction | BLOCKED | No staging backend/DB |
| MB-STAGE-23 | Open/close shift at Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-24 | KOT prints on Branch A kitchen printer | BLOCKED | No hardware; no staging |
| MB-STAGE-25 | Receipt on Branch A cashier printer | BLOCKED | No hardware; no staging |
| MB-STAGE-26 | Branch B printer isolation | BLOCKED | No hardware; no staging |
| MB-STAGE-27 | Socket isolation: Branch A vs Branch B kitchen view | BLOCKED | No staging backend/DB |
| MB-STAGE-28 | QR order in Branch A context | BLOCKED | No staging backend/DB |
| MB-STAGE-29 | Kiosk cash payment at Branch A | BLOCKED | No staging backend/DB |
| MB-STAGE-30 | Kiosk Razorpay at Branch A | BLOCKED | No Razorpay sandbox credentials; no staging |
| MB-STAGE-31 | Offline order at Branch A queued in IndexedDB | BLOCKED | No staging backend/browser environment |
| MB-STAGE-32 | Offline queue syncs on reconnect; no cross-branch leak | BLOCKED | No staging backend/browser environment |
| MB-STAGE-33 | Tally sync in branch context | BLOCKED | No Tally installation/staging |
| MB-STAGE-34 | WhatsApp receipt in branch context | BLOCKED | No MSG91 credentials |
| MB-STAGE-35 | Long session → switchToOrg; HQ token refresh | BLOCKED | No staging backend/DB |
| MB-STAGE-36 | Cross-org access with Branch A token → 403/404 | BLOCKED | No staging backend/DB |
| MB-STAGE-37 | Branch A cashier cannot access Branch B data | BLOCKED | No staging backend/DB |
| MB-STAGE-38 | Switch to suspended Branch C | BLOCKED | No staging backend/DB |
| MB-STAGE-39 | Standalone single-branch hotel unaffected | BLOCKED | No staging backend/DB |
| MB-STAGE-40 | Browser refresh after branch switch | BLOCKED | No staging backend/browser environment |

**BLOCKED count: 40 / 40**
**PASS count: 0**
**FAIL count: 0**

---

## 4. Security Results

| Check | Method | Result |
|-------|--------|--------|
| JWT hotelId authority | Code audit (Sprint 7 Phase 4) | CLEAN — all backend routes derive hotelId from JWT via auth middleware |
| Client hotelId injection | Code audit (Sprint 7 Phase 4) | CLEAN — only superAdminRoutes uses req.body.hotelId (protected by superAdminAuth) |
| Client branchId injection | Code audit | CLEAN — no routes trust client branchId for authorization |
| Client orgHotelId injection | Code audit | CLEAN — orgHotelId derived from hotel.parentHotelId (DB), never from client |
| Cross-branch access (code) | Pure-logic tests MB-S7-09 to MB-S7-12 | PASS (code level) |
| Cross-org access (code) | Pure-logic tests MB-S7-11, MB-S7-12 | PASS (code level) |
| Branch-only staff API | Not tested | BLOCKED — no staging environment |
| Socket.IO room isolation | Not tested | BLOCKED — no staging environment |
| Live API penetration test | Not tested | BLOCKED — no staging environment |

Security code audit is clean. Live API and socket isolation validation remain PENDING.

---

## 5. Payment Results

| Scenario | Result | Reason |
|----------|--------|--------|
| Normal POS (cash/UPI/card) | BLOCKED | No staging backend/DB |
| QR Razorpay end-to-end | BLOCKED | No Razorpay sandbox; no staging |
| Kiosk cash | BLOCKED | No staging backend |
| Kiosk Razorpay | BLOCKED | No Razorpay sandbox; no staging |
| Duplicate verification idempotency | BLOCKED | No staging backend |
| Server-authoritative price (code) | PASS (code level) — MB-S7-13 | Pure-logic test only |

---

## 6. Printer Results

| Scenario | Result | Reason |
|----------|--------|--------|
| Single printer: NO KOT on order | BLOCKED | No physical printer; no staging |
| Single printer: receipt on payment | BLOCKED | No physical printer; no staging |
| Dual printer: KOT on order | BLOCKED | No physical printer; no staging |
| Dual printer: receipt on payment | BLOCKED | No physical printer; no staging |
| Reconnect behavior | BLOCKED | No physical printer; no staging |
| Branch isolation (no cross-branch jobs) | BLOCKED | No physical printer; no staging |

Printer architecture code (single: no KOT; dual: KOT on order) was audited in
Sprint 7 and confirmed unchanged. Physical validation remains PENDING.

---

## 7. Offline Results

| Scenario | Result | Reason |
|----------|--------|--------|
| Product cache in IndexedDB | BLOCKED | No staging browser environment |
| Cart persistence across refresh | BLOCKED | No staging browser environment |
| Order queue in IndexedDB | BLOCKED | No staging browser environment |
| FIFO sync on reconnect | BLOCKED | No staging browser environment |
| Duplicate prevention | BLOCKED | No staging browser environment |
| Razorpay/QR blocked offline | BLOCKED | No staging browser environment |
| Multi-tab Web Lock | BLOCKED | No staging browser environment |
| Browser refresh while offline | BLOCKED | No staging browser environment |

Offline architecture (IndexedDB, Web Lock, FIFO sync, hotel isolation) was
not modified in Sprints 5–7. Code is unchanged from its original implementation.
Real browser validation remains PENDING.

---

## 8. Provider Results

| Provider | Result | Reason |
|----------|--------|--------|
| Razorpay (sandbox) | BLOCKED | No sandbox credentials; only live (`rzp_live_`) keys present |
| MSG91 / WhatsApp | BLOCKED | No MSG91 credentials in any environment file |
| Tally | BLOCKED | No TallyPrime installation or local bridge configured |

---

## 9. Browser Results

No browser testing was possible (no staging environment, no running backend).

| Category | Result |
|----------|--------|
| Console errors | NOT TESTED |
| Network errors / 4xx/5xx | NOT TESTED |
| Auth loops (401 refresh loop) | NOT TESTED |
| Socket reconnect loops | NOT TESTED |
| IndexedDB errors | NOT TESTED |
| React render errors | NOT TESTED |

---

## 10. Remaining Issues

### BLOCKER: No staging environment exists

- **Severity:** Critical
- **Reproduction:** Attempt to run any live staging test — backend is not running,
  no staging MongoDB database, no staging URL
- **Impact:** 40/40 staging scenarios cannot be executed
- **Workaround:** None — requires environment provisioning (see Section 11)
- **Production blocker:** YES

### NON-BLOCKER: backend/.env NODE_ENV=production on development machine

- **Severity:** Low operational risk (no staging safety, not a code bug)
- **Reproduction:** `cat backend/.env | grep NODE_ENV` → `production`
- **Impact:** If the backend were accidentally started locally and connected to Atlas,
  any test data operations would hit the production cluster
- **Workaround:** Do not start the backend locally without a dedicated staging `.env`
- **Production blocker:** NO (code is correct; configuration hygiene issue)

### NON-BLOCKER: Chunk size warning (jspdf/html2canvas)

- **Severity:** Cosmetic / build warning only
- **Reproduction:** `npx vite build` — warns on `jspdf.es.min` (357 KB) and `index` (733 KB)
- **Impact:** None for correctness; slightly slower initial load on slow connections
- **Workaround:** Pre-existing; out of Multi-Branch scope
- **Production blocker:** NO

### KNOWN CODE ITEM: PATCH /api/products/:id no BranchProductConfig enforcement

- **Severity:** Low (admin-only operation; products are HQ-managed)
- **Impact:** Branch admins editing org products via PATCH — not a supported workflow;
  branch staff tokens do not have product-edit permissions
- **Production blocker:** NO

---

## 11. GREEN / YELLOW / RED

### GREEN (confirmed by code audit + automated tests)

- All three product-lookup paths apply BranchProductConfig overlay consistently
- JWT-derived hotelId/orgHotelId — no client bypass vectors
- Branch switching: stale state cleared by page reload; HQ token proactively refreshed
- menuRoutes catch-block scope fix: server-validated hotelId in duplicate-key recovery
- TypeScript compiles clean on both backend and frontend (0 errors)
- Vite production build passes
- 851 pure-logic regression tests pass, 0 fail

### YELLOW (cannot confirm without staging)

- Socket.IO cross-branch room isolation (code logic correct; live behavior unverified)
- Browser console/network health during branch switching
- Auth token refresh under long-session real conditions
- Offline mode FIFO sync and Web Lock under real network interruptions
- Settings inheritance UI badges and overrides (code correct; UX unverified)

### RED (production blockers)

1. **No staging environment** — 40/40 mandatory real-world acceptance tests cannot be executed
2. **No physical printer validation** — KOT/receipt behavior unverified with real hardware
3. **No Razorpay sandbox validation** — QR/kiosk payment lifecycle unverified
4. **No Socket.IO live isolation test** — cross-branch event leak cannot be ruled out
5. **No offline mode real-browser validation** — IndexedDB/FIFO sync unverified
6. **No provider testing** — MSG91 WhatsApp receipts, Tally sync unverified

---

## 12. What Is Needed Before Staging Can Proceed

The following must be provisioned before any of the 40 acceptance tests can run:

1. **Separate MongoDB staging database** — a fresh Atlas cluster or database
   named `dinepos_staging` (or equivalent), isolated from production `hotelbillingpos`

2. **Staging backend deployment** — e.g., a separate Render service, Railway,
   or a staging `.env` pointing to the staging DB. Must NOT share the production
   `MONGODB_URI`.

3. **Staging frontend deployment** — a `VITE_API_URL` pointing to the staging backend

4. **Razorpay test/sandbox credentials** — `rzp_test_` key ID and secret for
   QR/kiosk payment lifecycle tests (Phases 13–14)

5. **Multi-branch test data setup** — HQ hotel + 2 branches, test accounts,
   test products with branch configs, category configs, coupons, vouchers
   (can be seeded from the staging checklist in MULTI-BRANCH-STAGING-ACCEPTANCE.md)

6. **Physical printer(s)** — at least one thermal printer for KOT/receipt
   validation (Phase 11)

7. **MSG91 test credentials** — for WhatsApp receipt flow (Phase 17) — optional
   for initial staging acceptance if receipts are not core to the billing flow

8. **TallyPrime** — local installation and bridge configuration (Phase 16) —
   optional for initial staging acceptance if Tally is not in scope for launch

---

## 13. Production Decision

**NOT PRODUCTION READY — STAGING VALIDATION INCOMPLETE**

The code is complete at the automated test level (851/25 pass, 0 fail, clean
TypeScript, clean Vite build). All identified code-level gaps across Sprints 1–7
have been fixed. The security audit is clean at the code level.

However, real-world validation has not been performed. The 40 mandatory acceptance
scenarios are ALL BLOCKED due to the absence of a staging environment. The following
categories have never been exercised against a real running system:

- Branch switching in a real browser
- Real Socket.IO cross-branch isolation
- Physical KOT/receipt printer behavior
- Razorpay payment lifecycle (QR and kiosk)
- Offline mode with real network interruption
- Long-session HQ token refresh
- MSG91 WhatsApp receipt delivery
- Tally sync

Claiming PRODUCTION READY based on automated tests alone is explicitly prohibited
by the project's non-negotiable constraints. This report will not do so.

**Next required action by the team:**
Provision a staging environment per Section 12 above, then re-execute this
acceptance run against that environment. All 40 scenarios must reach PASS or
an agreed YELLOW status before any production deployment.

---

*Report generated: 2026-09-16*
*Automated baseline run: 2026-09-16*
*Staging run: NOT EXECUTED — environment unavailable*
*Final verdict: NOT PRODUCTION READY — STAGING VALIDATION INCOMPLETE*
