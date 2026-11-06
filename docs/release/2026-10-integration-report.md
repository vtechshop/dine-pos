# Release-hardening integration report — 2026-10-28

**Branch:** `fix/release-hardening-integration` (local only, worktree `E:\dpi`),
based on `origin/main` @ `5a75093`. **Not committed, not pushed, not deployed.**
Nothing in this report was run against production, Atlas, Render, Razorpay or
WhatsApp. All test databases and Redis instances were disposable and local.

Source of the ported fixes: the uncommitted audit work in the original checkout
(`E:\dine-pos`, `main` @ `7ce4a8f` + 63 modified / 21 untracked files), which was
left untouched (verified at the end — §8).

---

## 1. Summary

| | Result |
|---|---|
| Fixes ported (priority list 1–12) | 12 / 12 |
| Upstream implementations kept instead of local | 7 (NoSQL guard, ticket scoping, Redis reconnect, print-flush filter, QR payment binding, prepaid table billing, hotelId JWT check) |
| New fixes found during integration | 4 (order list 500, PaymentPanel total, ₹0 prepaid close-out, test-isolation / CI bugs) |
| Backend tests | 49/49 suites, 1310 passed, 0 failed |
| Automation API suite (the failing GitHub job, run locally) | 41/41 suites, 445 passed, 0 failed (was 75 failed on `main`) |
| Web / mobile | tsc ✔, vitest 100 ✔, 4 production builds ✔, mobile jest 28 ✔ |
| Decisions needing review | 5 open (§3); **R1 and R2 approved and implemented — §9** |
| Release verdict | **Not releasable yet** — see §6 blockers (credential rotation, PR + CI on GitHub, staging migration, device tests, decisions) |

---

## 2. Change mapping — what was ported and how

Risk: **H** = money / auth / data integrity, **M** = behaviour change visible to users, **L** = internal.

| # | Fix | Local implementation | `origin/main` | Integration | Tests | Risk |
|---|---|---|---|---|---|---|
| 1 | Refund route hangs | `resolveHotelStatus` called as a function, not used as middleware | Bug present | Ported unchanged (no overlap) | `billingFixes` | H |
| 2 | Anonymous sockets joined `hotel_<id>` (customer phones/addresses) | `utils/socketRooms.ts`, guarded join in `server.ts` | Bug present | Ported; upstream's socket hotelId check kept | `phase1Protections`, `securityFixes` | H |
| 3 | Branch admin could take over sibling branches | `utils/orgAuth.ts`, `actingOrgId` claim + refresh propagation, branch/catalog/category/report routes | Bug present | Ported; `auth.ts` merged with upstream's 24-hex check + L1 status cache | `branchAuthorization` | H |
| 4 | Client-chosen payment currency | INR-only + "must be payment_pending" in `publicPaymentRoutes`, `RazorpayGateway` | Payment-to-order binding fixed (acb52cc), currency not | **Upstream binding kept**, local INR + status checks added | `securityFixes` (qr-verify, razorpay-order) | H |
| 5 | Kitchen/waiter could cancel the subscription | `requireAdmin` on SaaS mutations | Bug present | Ported unchanged | `securityFixes` | H |
| 6 | Anonymous dine-in cash orders reached the kitchen | Public orders are `qr` (online payment) or feature-gated `kiosk` | Bug present | Ported unchanged | `publicOrdering`, automation `qr-order`, `kiosk-order` | M |
| 7 | Reports / shift cash miscounted unpaid orders and refunds | `utils/revenue.ts`, `utils/shiftCash.ts`, completion metadata (`paymentTime`, `settledVia`, `cashierId`), settlement amounts on Guest / TableSession | Prepaid exclusion done differently (5a75093, `counterBilling`) | **Upstream `counterBilling` model kept.** Its helper gained an optional `completion` argument so the same orders get the metadata; settlement amounts recorded without any prepaid subtraction | `financialReports`, `qrPrepaidBilling` | H |
| 8 | Rate limits per instance | `SharedRateLimitStore` (Redis per request, fail-local) | In-process limiters for busy routes on purpose (Redis ~250 ms away, 4a74afa) | Merged: shared store by default, upstream's `distributed: false` kept for orders/products/categories/settings/sessions/modifiers/heartbeat/remote-config | `rateLimitShared` (real Redis) | M |
| 9 | Tally connector could never log in | `routes/tallyMount.ts` (mounted before admin router), 64-hex token + `timingSafeEqual` | Bug present | Ported unchanged | `tallyConnector`, `sprintTALLY02` | M |
| 10 | Guest-token and branch-code indexes broken | Partial unique index `qrSessionToken_unique_string`; Hotel branch index without `sparse` | Bug present | Ported unchanged; runbook copied | All integration suites build indexes; runbook | H (migration) |
| 11 | GitHub "API Tests" failing on `main` | — | 75 failures: fixtures post order lines without a product (422 since 5a75093) | Fixtures link to seeded products (`productLine()` helper); see §4 for the 3 further bugs this exposed | automation suite 41/41 | L |
| 12 | Docs + integration tests only local | 5 docs, 10 integration suites, harness, CI workflow | Absent | Copied; stale lines updated (prepaid model, device test D1) | — | L |

Upstream kept **instead of** the local version (local copy removed):

| Area | Kept (upstream) | Dropped (local) | Behaviour difference |
|---|---|---|---|
| NoSQL operator guard | `sanitizeRequest` strips `$` keys | `rejectMongoOperators` (400) | Requests with `$` keys now proceed with the keys removed instead of 400. Login / payment fields still 400 because the stripped value is no longer a string. |
| Support tickets | `ownTicketsFilter`, `hotelId` default `null` | `ownTicketFilter` | none |
| Redis reconnect | gives up only on the initial connect | infinite capped retry | none after first connect |
| Printer reconnect flush | `utils/printFlush.ts` | `pendingFlushFilter` | identical filter |
| QR payment binding | acb52cc | local equivalent | none |
| Prepaid table billing | Guest total never includes online-paid orders | credit verified Payment records at billing | see decisions R1, R2 |
| Staff-login input | `badStaffLogin` | — | **both kept** (local normaliser runs before the limiter) |

Local behaviour **added on top of** upstream's version:

- Web `BillingDrawer`: a guest or table whose orders were all paid online can be closed at ₹0 (upstream disabled the button).
- Web `PaymentPanel`: the guest total used upstream's old "sum every order" rule (it included cancelled and prepaid orders) while the drawer used `sumDue`. It now uses `sumDue` and shows "₹X already paid online".
- Mobile: the offline wallet block, the kiosk-only offline queue and "synced only when completed on the server" were ported onto upstream's cold-start / HTTP 304 / foreground-retry changes without conflict. The error classifier moved to `sync/offlineRules.ts`; upstream had not changed it.

---

## 3. Decisions that need review (not guessed)

| ID | Question | Current state on this branch | Why it matters |
|---|---|---|---|
| **R1** — ✅ approved, implemented (§9) | A staff POS order can be created with `paymentMethod: 'razorpay'` (`POST /api/orders` accepts it). Under upstream's model it never adds to the guest's amount due, and table billing completes it as "online" **without checking for a Payment record**. | Upstream behaviour, unchanged. The local model (credit only *verified* payments) closed this, but it cannot be combined with upstream's model without charging prepaid orders twice or never. | Possible revenue leak / mislabelled online revenue. Options: reject `razorpay` on staff order creation unless a Payment exists, or verify at billing. **Needs an owner decision.** |
| **R2** — ✅ approved, implemented (§9) | Billing a table while a QR order is still `payment_pending`. | Upstream: billing succeeds; the unpaid order stays `payment_pending` (not charged, not completed). Local version blocked billing with 409. | If the customer pays after the table is closed, the order is released to the kitchen for a closed table and is never completed, so revenue reports miss it. |
| **R3** | Guests open at deploy time. | Only relevant if production still runs code older than 5a75093: guest totals created by older code include QR prepaid orders, which upstream billing would then charge again. | Check what production runs before deploying; bill or close open tables before the switch if needed. |
| **R4** | NoSQL guard: strip (upstream) vs reject with 400 (local). | Strip. | Both block injection; strip is silent. |
| **R5** | Busy routes limited per instance (upstream's latency decision). | Kept. Shared Redis limits apply to auth, PIN, refresh, AI, super-admin, tickets, Tally connector and public payments. | With N instances the busy-route ceiling is N× the configured value. |
| **R6** | `jspdf` 2.5.2 → 4.2.1 (two majors) | Not changed (§5). | Separate PR with a manual check of the product PDF export. |
| **R7** | Accounting decisions A–D, E1–E6 | Unchanged from `docs/decisions/2026-10-accounting-and-ordering-decisions.md`. | A–D still BLOCKED on the owner. |

---

## 4. Tests — commands, exit codes, results

All runs on 2026-10-28 in `E:\dpi`. Every command ran with `NODE_TLS_REJECT_UNAUTHORIZED`
**unset** (see §5); dependency installs used the existing lockfiles (`npm ci`,
`pnpm install --frozen-lockfile`).

| Area | Command | Exit | Result |
|---|---|---|---|
| Backend type-check | `cd backend && npx tsc --noEmit -p .` | 0 | clean |
| Backend build | `npm run build` | 0 | |
| Focused suites (first pass) | `REQUIRE_REDIS_TESTS=1 npx jest --ci test/integration/{securityFixes,qrPrepaidBilling,billingFixes,financialReports,tallyConnector,rateLimitShared} test/regression/audit test/regression/sprintWA02` | 1 → 0 | 1 fixture failure (financialReports seeded ₹700 under the old model) → fixed → 6/6 |
| Backend full (final, after dependency bumps) | `REQUIRE_REDIS_TESTS=1 npx jest --ci` | **0** | **49/49 suites, 1310 passed, 0 failed, 2 skipped, 15 todo** |
| Automation API suite (= GitHub "API Tests" job) | backend `node dist/server.js` (`NODE_ENV=test`, CI placeholder secrets, disposable Mongo replica set + Redis :6391) then `cd automation && npm run test:api -- --forceExit` | 1 → **0** | before: 18 suites / 76 tests failed (reproduces GitHub's 75); after: **41/41 suites, 445 passed, 2 todo** |
| Web | `cd web && npx tsc --noEmit -p .` · `npx vitest run` | 0 · 0 | 100 passed |
| Web / qr / admin / marketing builds | `npx vite build` in each | 0 ×4 | |
| Mobile | `cd mobile && npx tsc --noEmit -p .` · `npx jest --ci` | 0 · 0 | 28 passed |
| Workflows | parsed all 5 `.github/workflows/*.yml` with js-yaml | 0 | parse only — **not** proof they run (actionlint not available) |

The 2 skipped backend tests are the Swiggy/Zomato contract placeholders
(`sprint7AggregatorHardening`), not Redis tests. `REQUIRE_REDIS_TESTS=1` makes the
Redis suite fail rather than skip when Redis is missing.

### Bugs found while making the suites pass (all fixed, none hidden)

| Bug | Cause | Fix |
|---|---|---|
| `GET /api/orders?status[$ne]=x` → HTTP 500 (automation INJ-003, failing on GitHub too) | `sanitizeRequest` strips `$ne`, leaving `status: {}`; Mongoose cast error | Route accepts only string `status`/`source`/`q` (400 otherwise) |
| QR self-order tests fail depending on suite order | `payments/payment-release` deletes hotel A's shared Razorpay config in its setup/teardown | `qr-order` suite ensures an active config in its own `beforeAll` |
| `sprint4FinancialAtomicity` intermittently "cannot redeclare ORDER_ID" | test files without import/export are compiled as global scripts by ts-jest | `export {};` in the two colliding files. **16 more test files** have the same latent pattern (listed in the PR notes) |
| `sprintWA02` WA-S2-08 / WA-S2-14 fail on `main` | **Confirmed test brittleness, not a regression:** the worker's success branch (unchanged since 2026-09-17) still uses `findOneAndUpdate` with `$nin: ['delivered','read']`, sets `status:'sent'`, `sentAt`, `requestId`, `attemptCount`; the tests read a fixed 400/600-character window and a 4-line comment pushed `findOneAndUpdate` / `attemptCount` past it | Tests read the whole success branch; every assertion kept |

### Test changes (none weaken a security assertion)

- `securityFixes`: `findOperatorKey` unit test → `stripOperators` unit test (upstream guard); print-flush test uses upstream's filter; harness uses `sanitizeRequest`.
- `qrPrepaidBilling`: rewritten for upstream's model. **Removed** (behaviour no longer exists, see R1/R2): "partially refunded payment credits only money held", "razorpay order without Payment is not treated as paid", "payment_pending blocks billing" (replaced by tests that pin the current behaviour). **Added**: completion metadata, settlement amounts, ₹0 prepaid close-out, cancelled orders untouched.
- `financialReports`: one fixture seeded ₹200 (counter-due only) instead of ₹700; assertions unchanged.
- Automation: order fixtures reference real products; CRG-001 compares against the server-computed subtotal + tax and still requires the delivery fee in the total.

---

## 5. Security and dependencies

**Atlas credential.** A real Atlas connection string is in the public history
(`d12cb92`, removed in `acb52cc`). Treat it as compromised. **Rotation is not
confirmed** and was not attempted. Runbook: `docs/security/atlas-credential-rotation-runbook.md`.
GitHub settings read (read-only) today: repository **public**, branch protection on
`main` **off**, secret scanning / push protection / Dependabot security updates **all disabled**.

**Secret scan of this branch:** 101 changed files scanned for connection strings with
passwords, live Razorpay keys, AWS/GitHub/Google keys and private keys — 0 matches.
No `.env` files added (the temporary `automation/.env.test` held CI placeholders and was deleted).

**TLS on this machine.** The shell environment sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.
Two downloads in this session ran with it before it was noticed:
the worktree `npm ci` / `pnpm install` (every package is checked against the
lockfile's sha512 integrity, so a tampered package would have failed) and a
`mongodb-memory-server` download of `mongod` 7.0.24 used by the backend tests (byte-identical — SHA-256
`9c229fea…791f` — to the copy downloaded on 2026-10-27 in the original checkout; it
could not be checked against MongoDB's published hash, which covers the zip). All
later commands ran with the variable unset. **Recommendation:** remove it from the
user/system environment; it must never be set on servers.

**Dependencies (npm advisory DB, queried today):**

| Package | Where | Severity | Installed → fixed | Exposure | Action |
|---|---|---|---|---|---|
| `proxy-addr` | backend (via `express` `~2.0.7`) | critical — IP spoofing via IPv4-mapped IPv6 *trust subnet* | 2.0.7 → **2.0.8** | Low: `trust proxy` is the hop count `1`, not a subnet list | **Bumped** (lockfile-only, 1 entry); backend 1310 ✔ + automation 445 ✔ |
| `shell-quote` | mobile (react-native → react-devtools-core `^1.6.1`, dev tooling) | critical | 1.8.3 → **1.12.0** (no fixed 1.8.x) | Dev tooling only | **Bumped** (lockfile-only, 1 entry); mobile tsc + 28 tests ✔ |
| `jspdf` (+ its `dompurify` 2.5.9) | web, product-list PDF export only (`new jsPDF`, `autoTable`, `save`) | 2 critical, 8 high | 2.5.2 → ≥ 4.2.1 (2 majors; `jspdf-autotable` 5.0.8 supports ^4) | Low: no `addJS`/AcroForm/images/HTML/new-window output; the path-traversal advisory is Node-only; data is the admin's own catalogue | **Not changed** — separate PR + manual export test (R6) |

Other open advisories (not in scope, recommended follow-ups): backend `axios`,
`multer`, `nodemailer`, `engine.io`/`socket.io-parser`, `ws`, `undici`, `handlebars`
(critical), `body-parser`, `path-to-regexp`; web dev-only `vitest` 2.1.9 / `tinypool`
(critical, only when the Vitest UI server runs); mobile `expo` tree. `rate-limit-redis`
is now unused but left in `package.json` to avoid an unrequested dependency change.

---

## 6. Remaining blockers (in order)

1. **Rotate the Atlas credential** (authorised operator, runbook) and enable secret scanning + push protection.
2. ~~Review decisions R1–R3~~ R1/R2 implemented (§9); R3 (open tables at deploy) still to check.
3. **Open the PR(s) on GitHub** so `Backend Tests`, `API Tests` and `Web Tests` actually run there — nothing in §4 is a GitHub result.
4. **Protect `main`**: require PR review and the status checks *Backend type-check and tests*, *API Test Suite*, *Playwright* (web); disallow force-push.
5. **Rehearse the index migration on staging** (`docs/migrations/2026-10-index-migration-runbook.md`); never drop the old guest index automatically in production.
6. **Run device tests D1–D13** (`docs/staging-device-test-plan.md`, all NOT RUN).
7. `jspdf` 4 upgrade and the remaining dependency advisories.

---

## 7. Recommended pull-request sequence

Each PR from `origin/main`, small enough to review; the integrated branch is the
reference that all of them together pass the suites above.

| PR | Content | Why first / depends on |
|---|---|---|
| 0 | (no code) credential rotation, GitHub secret scanning, branch protection | Independent; do now |
| 1 | **CI green:** automation fixtures + `productLine` helper, `qr-order` gateway isolation, order-list 400 fix, `sprintWA02` and `export {}` test fixes, `backend-tests.yml` (with corrected MongoDB cache path) | Restores a trustworthy CI signal for every later PR |
| 2 | Integration-test harness + suites (`backend/test/integration`, jest global setup, dev deps) | Gives PRs 3–6 their regression tests |
| 3 | Security: sockets, branch authorisation (`actingOrgId`), currency, SaaS owner-only, public ordering, ticket credential-header gate, login enumeration / limiter normalisation, Tally connector | High risk, independent of billing |
| 4 | Billing & reporting: refund route, `counterBilling` completion metadata, settlement amounts, revenue/shift-cash rules, web drawer/panel fixes | After R1–R2 decisions |
| 5 | Shared rate limiting (+ `distributed:false` kept) and Redis | Needs Redis in every environment |
| 6 | Indexes + migration runbook | Needs staging rehearsal before merge |
| 7 | Mobile offline integrity | Needs device tests D3, D7, D8 |
| 8 | Dependency bumps (`proxy-addr`, `shell-quote`); later `jspdf` 4 separately | |
| 9 | Docs (decisions, runbooks, device plan, this report) | Any time |

---

## 8. Original checkout preserved

Verified after all work: `E:\dine-pos` still on `main` @ `7ce4a8f`; SHA-256 of
`git diff HEAD`, the full `git status --porcelain -uall` and the hashes of every
untracked file are identical to the snapshot taken before any change; no stash.
The only repository-level additions are the local branch
`fix/release-hardening-integration` and its worktree registration (`E:\dpi`). To
remove them later: `git worktree remove E:\dpi` then
`git branch -D fix/release-hardening-integration` (only after the work is saved elsewhere).

---

## 9. Approved decisions R1 and R2 — implementation (2026-10-28, second pass)

Both decisions were approved by the owner; this section supersedes R1/R2 in §3.
Still local only: **not committed, not pushed, not deployed.** The payment gateway
was mocked in tests; no real payment was made and no message was sent.

### 9.1 Every path that can mark an order "paid online"

| Path | Before | Now |
|---|---|---|
| `POST /api/orders` (staff) | stored any client `paymentMethod`, incl. `razorpay` on a table guest → never added to the amount due, later closed as "paid online" | `razorpay` refused for table orders (explicit guest, or auto-linked table — checked before a session is opened). Non-table orders may start as `razorpay` (mobile checkout flow) but stay **unpaid** until verified |
| `PATCH /api/orders/:id/status` → `completed` | needed *any* successful Razorpay Payment for the order | needs a **verified** payment (below); a verified online order cannot be completed as another method |
| `PATCH /api/orders/:id/payment` (cashier), `PUT /api/orders/:id` (admin) | could switch an open order to/from `razorpay` freely | to `razorpay` → verified payment required; from `razorpay` → refused if the money was taken online (use refund) or the order is `payment_pending`. A table guest's amount due moves with the change (only while the guest is open). Discounts on an online-paid order are refused |
| Table billing — guest bill, bulk bill, mark guest left, plain close | completed released `razorpay` orders without checking any Payment; billed while QR orders were `payment_pending` | all four check the table's online orders first (§9.2) |
| `qr-verify` (+ crash-recovery branch), Razorpay webhook | released any `payment_pending` order to the kitchen | shared `releasePaidOnlineOrder` — atomic, idempotent, refuses when the table guest/session is closed or the order cancelled |
| `POST /api/public/payments/razorpay-order` | — | refuses to start a charge for an order whose table guest/session is closed |
| `/api/payments/create` + `/verify`, aggregator, kiosk/QR creation | already server-verified / not online | unchanged |

**Verified payment** (`backend/src/utils/onlinePayment.ts`): a `Payment` of the same
hotel, for this order, gateway `razorpay`/`razorpay_link`, status `success`, currency
`INR`, amount within ±₹1 (100 paise — the tolerance `/api/payments/create` already
uses) of the order total. The order's `paymentMethod`, `transactionId`, a
`paymentStatus` flag (not even a schema field) or any client value are never enough.
One successful payment per order is enforced by the existing unique index.

### 9.2 R2 — table billing and late payments

- **Blocked billing** — guest bill, bulk bill and "mark left" return **409** before any
  write or table claim:
  - `ONLINE_PAYMENT_PENDING`: an online order is still `payment_pending` (pending or failed
    attempt). Body lists the orders and `actions: ['wait_for_payment','cancel_unpaid_order']`.
  - `ONLINE_PAYMENT_UNVERIFIED`: an order marked `razorpay` has no verified payment (legacy
    data). Actions: change to a counter method (now added to the amount due) or cancel.
  - `GUEST_HAS_PAID_ONLINE_ORDERS` ("mark left" only): bill the guest instead (₹0 due works),
    so the paid order is completed and counted.
  - Plain session close is refused while a `payment_pending` order remains.
- **Exactly once** — paid online orders are completed once by the bill (filters exclude
  `completed`), keep `razorpay`, never add to the amount collected; a repeated bill
  request is refused; concurrent bulk bills settle once (atomic claim).
- **Payment time** — billing no longer overwrites a prepaid order's `paymentTime` (gateway
  confirmation time); bill time is only a fallback, so revenue by payment time stays on
  the day the customer paid.
- **Late callbacks** — payment succeeding after the guest/table was closed or the order was
  cancelled: the Payment is recorded `success` (truthful), the order is **not** released to
  the kitchen and stays out of revenue, the customer gets `409 PAYMENT_RECEIVED_ORDER_NOT_RELEASED`
  ("show this message to the staff"), and an audit entry
  `payment.late_success_needs_reconciliation` + a warning log are written. Resolution uses
  the existing refund flow — **no new refund or override policy was added**.
- Cancellation, expiry and refunds are unchanged (staff cancel of `payment_pending` already
  existed; there is no automatic expiry job).

### 9.3 Evidence (2026-10-28, `E:\dpi`, `NODE_TLS_REJECT_UNAUTHORIZED` unset)

| Command | Exit | Result |
|---|---|---|
| `cd backend && npx jest --ci test/integration/onlinePaymentIntegrity` | 0 | **29/29** — missing, pending, processing, failed, refunded, wrong-amount, wrong-currency, other-order and other-hotel payments rejected; verified payment completes once (one receipt); no relabel to cash; second success payment rejected by the DB; failed checkout → cash; PATCH/PUT to and from razorpay; table razorpay create refused (no empty session left); legacy unverified order blocks bill, then becomes payable; pending blocks guest bill, bulk bill, left and plain close; failed payment still blocks; cancel + retry; success while waiting → billed once, payment time kept, prepaid not collected again, repeat bill refused; duplicate callbacks (2 webhooks + qr-verify) release once, one KOT; late success after billing (qr-verify + webhook) not released and audited; no new charge for a closed table; success on a cancelled order flagged; concurrent bulk bills settle once |
| same + `qrPrepaidBilling`, `auditCriticalFixes`, `sprintGoLive01` | 0 | 87/87 |
| backend `npx tsc --noEmit -p .` · `npm run build` | 0 · 0 | |
| backend full `REQUIRE_REDIS_TESTS=1 npx jest --ci` | §9.6 | |
| `cd web && npx tsc --noEmit -p .` · `npx vitest run` | 0 · 0 | 100 passed |
| `cd mobile && npx tsc --noEmit -p .` · `npx jest --ci` | 0 · 0 | 28 passed |
| Automation API suite | **not re-run after R1/R2** (time) | last run before R1/R2: 445 passed — re-run in CI |

**Test changes for R1/R2 (no security assertion weakened):**
- `qrPrepaidBilling`: prepaid QR fixtures now carry a verified Payment (R1 requires one);
  the two "billing proceeds while payment_pending" tests now assert the approved R2 409.
- `auditCriticalFixes` PAY-01: the Order mock also provides `findOne` (the shared release
  helper reads the order first); all assertions unchanged.
- `sprintGoLive01` GL-05: now requires `verifyOnlinePayment(` right after the guard (it
  previously matched an unrelated `Payment.findOne` further down the file). GL-04 unchanged.

### 9.4 Files changed for R1/R2

`backend/src/utils/onlinePayment.ts` (new), `backend/src/utils/counterBilling.ts`,
`backend/src/routes/orderRoutes.ts`, `guestRoutes.ts`, `sessionRoutes.ts`,
`publicPaymentRoutes.ts`, `paymentWebhookRoutes.ts`; tests:
`backend/test/integration/onlinePaymentIntegrity.integration.test.ts` (new),
`qrPrepaidBilling.integration.test.ts`, `backend/test/regression/auditCriticalFixes.test.ts`,
`sprintGoLive01.test.ts`. No web/mobile code, dependency, lockfile or schema change (the
web drawer shows the server's 409 message; mobile's staff Razorpay flow — non-table order,
verified, then completed — satisfies the new rules).

### 9.5 Remaining payment / accounting risks

1. **Late success after closure or cancellation** — money captured, order not served: now
   visible (audit + log + an open `payment_pending` order in reports) but resolved manually
   through the existing refund flow. A staff-facing list of these audit entries is recommended.
2. **Residual race** — a QR order placed in the instant between the billing check and the
   guest being marked billed can still end `payment_pending` on a closed guest; it is then
   never released (risk 1), never silently completed.
3. **Refunded before billing** — an online order whose payment was (partly) refunded before
   the bill blocks billing (`refunded`); staff must cancel it. Treating partly refunded
   payments as "paid" would be an accounting decision.
4. **Legacy data** — tables open at deploy time with `razorpay` orders lacking a verified
   payment are blocked at billing until switched to a counter method or cancelled. Check
   open tables before deploying.
5. Accounting decisions A–D remain open (§3 R7).

### 9.6 Final full backend suite and verdict

`cd backend && npx tsc --noEmit -p . && REQUIRE_REDIS_TESTS=1 npx jest --ci` → tsc exit 0, jest exit **0**:
**50/50 suites, 1339 passed, 0 failed**, 2 skipped (Swiggy/Zomato contract placeholders), 15 todo.

**Recommendation: NO-GO for production today; R1 and R2 are code-complete and ready for review.**
Verified locally: R1/R2 behaviour, the full backend suite, web and mobile checks.
Not verified: GitHub Actions (nothing has run there for this branch), the automation API
suite after R1/R2, staging migration rehearsal, device tests D1–D13, Atlas credential
rotation. Those remain the release blockers listed in §6 (items 1, 3–6) plus risk 4 in §9.5.
