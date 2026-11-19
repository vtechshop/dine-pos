# DinePOS — final release verification report

Date: 2026-10-28 · Repository: `vtechshop/dine-pos` · Audit performed locally (no
commits, pushes, deploys, production DB access or credential changes).

## Decision: **NO-GO**

Blocking reasons, each verified below:
1. A real MongoDB Atlas credential is in the **public** repository's git history;
   no evidence of rotation.
2. The deployable branch (`origin/main` @ `5a75093`) is **red in CI** (API Tests)
   and still contains confirmed security / financial defects (refund route hangs,
   anonymous sockets receive customer PII, branch admins can take over siblings,
   client-chosen payment currency, staff can cancel the SaaS subscription,
   unauthenticated dine-in orders reach the kitchen, shift cash and sales reports
   miscount).
3. The fixes for most of those exist **only as uncommitted changes** in the local
   checkout, on an **older base** (`7ce4a8f`, 32 commits behind) with **20 files
   changed on both sides** — they are not in any branch and have not run in CI.
4. `main` has **no branch protection**; the new backend test workflow has **never
   run on GitHub**; **no physical-device test** has been performed; the index
   migration has **not been rehearsed** on staging.

---

## 1. Repository state (inspected, nothing modified)

| Item | Finding |
|---|---|
| Local branch / HEAD | `main` @ `7ce4a8f` |
| `origin/main` | `5a75093` — **32 commits ahead** of local (fetched remote refs only) |
| Local changes | 63 modified + 19 untracked paths (≈3,600 lines), uncommitted |
| Overlap | 20 files changed both locally and upstream (merge conflicts expected), incl. `orderRoutes.ts`, `server.ts`, `guestRoutes.ts`, `sessionRoutes.ts`, `authRoutes.ts`, `rateLimiter.ts`, mobile `api.ts`/`syncEngine.ts`/`BillingScreen.tsx` |
| Upstream overlap | Upstream independently fixed: NoSQL injection (strip `$` keys), QR payment reuse, single-mode reprint flood, ticket scoping, Redis reconnect, client-priced lines, prepaid/unpaid/cancelled exclusion from table bills (different design) |

`origin/main` was tested in an isolated, detached git worktree in the session's
temporary directory (unregistered from git afterwards; some long-path files remain
in that temp folder only); the local working tree was never reset, stashed or
merged.

## 2. Required artifacts

| File | Local | `origin/main` |
|---|---|---|
| `docs/migrations/2026-10-index-migration-runbook.md` | present (untracked) | **missing** |
| `docs/staging-device-test-plan.md` | present (untracked; D11–D13 added in this audit) | **missing** |
| `docs/decisions/2026-10-accounting-and-ordering-decisions.md` | present (untracked) | **missing** |
| `.github/workflows/backend-tests.yml` | present (untracked) | **missing** |
| New: `docs/security/atlas-credential-rotation-runbook.md` | prepared in this audit | missing |

## 3. Automated tests — exact commands and results (run 2026-10-28)

### Local working tree (`7ce4a8f` + uncommitted changes)
| Command (dir) | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` (backend) | 0 | clean |
| `NODE_ENV=test REQUIRE_REDIS_TESTS=1 JWT_SECRET=<test> PAYMENT_ENCRYPTION_KEY=<test> npx jest --config jest.config.ts --ci` (backend) | 0 | 45/45 suites; **1280 passed, 0 failed**, 2 skipped, 15 todo (Redis tests ran against a disposable local `redis-server`) |
| `npx tsc --noEmit -p .` (web) | 0 | clean |
| `npx vitest run` (web) | 0 | 2 files, 97 passed |
| `pnpm run build` (web) | 0 | built |
| `npx tsc --noEmit` (mobile) | 0 | clean |
| `npx jest` (mobile, pure modules only) | 0 | 2 suites, 28 passed |

### `origin/main` (`5a75093`, isolated worktree, deps from its own lockfiles)
| Command (dir) | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` (backend) | 0 | clean |
| `NODE_ENV=test npx jest --config jest.config.ts --ci` (backend) | **1** | 38/39 suites; **1211 passed, 2 failed** (`sprintWA02` brittle source-scan test — pre-existing), 2 skipped, 15 todo |
| web `tsc` / `vitest run` / `build` | 0 / 0 / 0 | clean / **100 passed** / built |
| qr, admin, marketing `build` | 0 | built |
| mobile `tsc --noEmit` | 0 | clean (no mobile test suite upstream) |

### Behavioural integration suites against `origin/main`
The local integration suites (real Express routers + in-memory MongoDB replica set)
were copied into the temporary worktree; the harness was pointed at upstream's
`sanitizeRequest` and told to log (not abort on) index build errors.

| Suite | Result on `origin/main` | Meaning |
|---|---|---|
| securityFixes | 11 pass / **8 fail** | Missing upstream: INR-only + "awaiting payment" checks on QR payment creation; SaaS cancel/subscribe owner-only; super-admin header auth gated in production; PIN login code-enumeration message; hotelId case normalisation |
| billingFixes | 5 pass / **6 fail** | Refund route **hangs** (broken middleware); concurrent refunds both succeed; wallet not restored on refund; completed orders can be reopened/edited; post-order discount stacks |
| publicOrdering | 6 pass / **2 fail** | Anonymous `dine-in` cash orders still reach kitchen/KOT |
| branchAuthorization | 5 pass / **7 fail** | Branch admin can switch into siblings, edit sibling prices/categories, read org-wide sales |
| qrPrepaidBilling | 1 pass / 10 fail | Mostly **design difference** (upstream excludes prepaid when building the guest total; fixture assumed old semantics) → *not verified either way*. Confirmed upstream: billing proceeds while an online payment is pending; prepaid determined by `paymentMethod` without payment evidence; **guest token index breaks billing a 2nd guest** (E11000) |
| financialReports | **0 / 6** | Reports count unpaid orders; refunds ignored; shift cash by `createdAt`, split cash for any method (also confirmed in source) |
| offlineIdempotency | **3 / 3 pass** | Server-side offlineId idempotency (orders + wallet + kiosk KOT) works upstream |
| phase1Protections, rateLimitShared, tallyConnector | not runnable | Depend on modules absent upstream; source inspection confirms: anonymous sockets join the PII room; rate limiter still per-instance; Tally connector still mounted after the admin router (cannot authenticate); Hotel branch-code index spec still invalid (never built) |

## 4. Security and Atlas
| Finding | Severity | Evidence / action |
|---|---|---|
| Real Atlas credential in git history (`d12cb92` → removed `acb52cc`); **repo is PUBLIC** (`gh repo view`: visibility PUBLIC) | **Critical** | Rotate now — `docs/security/atlas-credential-rotation-runbook.md`. Rotation status: **not verifiable from here; no evidence it happened**. |
| Current trees: no credentialed URIs (only `<user>:<password>` placeholders in `.env.example`) | OK | `git grep` both trees |
| Razorpay **live key id** in `MULTI-BRANCH-STAGING-FINAL-ACCEPTANCE.md` | Low | Public identifier, not a secret; remove from docs |
| No private keys / cloud keys / hard-coded app secrets found | OK | pattern scan of tree + history |
| TLS: `mongodb+srv` (TLS default), no TLS-weakening options in code/config | OK (code only) | Render env not inspectable; this audit machine's shell has `NODE_TLS_REJECT_UNAUTHORIZED=0` — must not exist on servers |
| Logging: no passwords/tokens/OTPs logged; phone numbers logged on OTP failure; morgan logs URL query strings | Low | — |
| `npm audit --omit=dev` (origin/main) | High | backend 1 critical (`proxy-addr`), 13 high (incl. direct `compression`, `multer`); mobile 1 critical (`shell-quote`), 17 high (incl. `expo`); web workspace 2 critical (`jspdf` ×2), 9 high |
| Secret scanning / push protection on GitHub | unknown | Not checked (needs repo admin) — recommend enabling |

## 5. Migrations and indexes
- **Not executed anywhere.** Offline validation only: on an in-memory MongoDB the
  new guest-token partial index allows many `null` tokens (bulk-bill test bills
  two token-less guests) and the new branch index rejects duplicate codes
  (`phase1Protections`). Upstream's definitions were shown to fail (invalid Hotel
  index spec; guest index E11000 on 2nd null).
- `backend/migrate.js` (upstream) still wipes target collections with only an env
  var guard (local version adds `--confirm-wipe-target`). `migrate-hotelid-to-objectid.js`
  is idempotent (filters `$type: 'string'`); `preflight-atlas-inspect.js` is read-only.
- Runbook covers backup/verify, staging rehearsal, inspection, duplicate detection,
  exact index commands, validation, rollback and post-checks. Five more
  `unique+sparse` indexes on null-default fields (GRN, VendorPayment, VendorReturn,
  LoyaltyTransaction, CustomerProfile, OrganizationCustomer) were proven (disposable
  DB) to reject a second `null` where built — production state must be checked
  read-only with `getIndexes()`.
- **Requires staging:** every write step, autoIndex behaviour on deploy, data
  duplicate checks on real data. Not production-safe until rehearsed.

## 6. Accounting decisions

| ID | Status | Evidence |
|---|---|---|
| A GST after discount | **BLOCKED** (no decision) | Current behaviour verified: exclusive per-line tax on pre-discount price (`recalcOrderTotals`; billingFixes "client price/tax overridden": 2×200 → tax 20) |
| B Wallet/voucher | **BLOCKED** | Verified: POS subtracts voucher/wallet from `grandTotal` (`orderRoutes` `finalGrandTotal`) |
| C Audit-log retention | **BLOCKED** | Verified: `AuditLog` TTL 90 days (`models/AuditLog.ts:26`), both trees |
| D Kiosk auth | **BLOCKED** | Verified: kiosk cash orders accepted unauthenticated → kitchen (publicOrdering "kiosk pay-at-counter" passes) |
| E1 Refund by issue date | **PARTIALLY VERIFIED** | Local: financialReports tests; origin/main: not implemented |
| E2 Cash refunds shown, not subtracted | **PARTIALLY VERIFIED** | Local shift test (expected cash 2170 incl. refund line); not upstream |
| E3 Order vs gateway refunds unlinked | **VERIFIED (open gap)** | No link between `Order.refundAmount` and `Payment.refundedAmount` |
| E4 Tips excluded from drawer | **VERIFIED** | `utils/shiftCash.ts` has no tip term |
| E5 Sales dated by `createdAt` | **VERIFIED** | report `$match` on `createdAt` |
| E6 Snapshot workers unchanged | **VERIFIED (open gap)** | `hourlyAggregator`/`dailySnapshotBuilder` still `$ne:'cancelled'` |

Order lifecycle (local tree; upstream gaps in §3):
- State transitions: completed is final, cancel race closed — verified (billingFixes).
- Payment reconciliation: QR binding, INR-only, prepaid credit from verified payments — verified (securityFixes, qrPrepaidBilling).
- Refunds/cancellation: atomic, wallet+voucher restored — verified; **cancel restores stock never deducted** for public/aggregator/QR orders — **not fixed** (open).
- Idempotency: offlineId (orders, wallet, kiosk KOT) — verified both trees.
- Inventory: transactional deduction on POS create — existing tests; restore-on-cancel gap above.
- Tax/invoice: server-side prices — verified; GST policy blocked (A).
- Recovery/audit: refund + shift tests; audit TTL blocked (C).
- Not addressed: loyalty redemption outside the order transaction; raw `redeemedPoints`; coupon scope.

## 7. Physical devices and printers
**No physical-device or printer test has been performed.** `docs/staging-device-test-plan.md`
(D1–D13, all NOT RUN) now covers discovery/pairing (D11), failure + manual retry
(D12), reconnect/token expiry (D5), network interruption (D3/D7), duplicate-print
prevention (D13), restart recovery (D7). Simulated coverage only: print flush
filter, offline queue logic (28 mobile unit tests), server idempotency. Known open
printer defects expected to fail: P7 (socket token expiry), P3, P4, P9, P2.

## 8. GitHub Actions
| Workflow | Status |
|---|---|
| API Tests | **Executed on GitHub — FAILED** on `5a75093` (run 40463435323): order fixtures send product-less lines → 422 after the "no client-priced lines" change. Local tree has the same rule → would also fail |
| Web (Playwright) Tests | executed — success |
| Security Scan (ZAP), Performance (k6) | executed — "success" in 8–11 s, consistent with the workflow's skip branch when `PERF_API_URL` is unset → **no scan performed** |
| Backend Tests (`backend-tests.yml`) | **inspected locally only** (YAML parses; triggers, `permissions: contents: read`, `npm ci`, tsc, jest, Redis service, no prod env). **Never executed by GitHub** (untracked) |
| Branch protection on `main` | **none** (`gh api …/protection` → 404) → no required checks |
| actionlint | **not run** (download of the linter binary was not permitted in this environment) |
| Missing | web type-check/build job, mobile type-check/test job, required-check configuration |

## 9. Path to GO (in order)
1. Rotate the Atlas credential and review access history (runbook).
2. Create a branch from `origin/main`, port the local changes, resolve the 20
   conflicts (keep upstream's equivalents where they are complete), re-run all
   suites; fix `automation/api` order fixtures to send product ids.
3. Open a PR so `backend-tests.yml` actually runs; protect `main` and require it.
4. Upgrade the critical/high dependencies (`proxy-addr`/express, `jspdf`, `multer`,
   `compression`, expo) and re-test.
5. Rehearse the index migration on staging; check the six null-default indexes.
6. Run device plan D1–D13 on staging; fix P7 before relying on printer sockets.
7. Record decisions A–D and confirm E1–E6.
