# DINEPOS PRODUCTION RELEASE CHECKLIST
# Final Production Readiness Assessment
# Audit Date: 2026-09-17
# Test Results: 30/30 suites, 1078/1078 tests PASS

Legend: GREEN = verified complete | YELLOW = complete, pending real-world validation | RED = issue found (fixed) | BLOCKED = external dependency required

---

## A. CODE

| Item | Status | Notes |
|------|--------|-------|
| Backend TypeScript clean | GREEN | 0 errors |
| Frontend TypeScript clean | GREEN | 0 errors |
| Vite production build | GREEN | builds in ~11s |
| All regression tests pass | GREEN | 1078/1078 |
| WhatsApp Sprint 1 tests | GREEN | 40/40 |
| WhatsApp Sprint 2 tests | GREEN | 52/52 |
| Tally Sprint 2 tests | GREEN | 52/52 |
| No uncommitted feature work | GREEN | All sprints committed |
| Admin QR payment gate bypass FIXED | GREEN | orderRoutes.ts:1301 |
| Razorpay M13 guard uses existing.paymentMethod | GREEN | orderRoutes.ts:1626 |
| OAuth Razorpay uses server-stored gatewayOrderId | GREEN | publicPaymentRoutes.ts:295 |
| Webhook secret uses timingSafeEqual | GREEN | messagingWebhookRoutes.ts:76 |
| reset-request rate-limited | GREEN | hotelRoutes.ts |
| IFSC/pincode verify rate-limited | GREEN | verifyRoutes.ts |
| Shift actualCash rejects negative values | GREEN | shiftRoutes.ts:267 |

---

## B. SECURITY

| Item | Status | Notes |
|------|--------|-------|
| JWT_SECRET startup validation | GREEN | process.exit(1) if missing or known-bad |
| SUPER_ADMIN_JWT_SECRET validated | GREEN | 32+ chars required, known-bad list |
| SUPER_ADMIN_PASS required | GREEN | process.exit(1) if missing |
| MONGODB_URI required | GREEN | process.exit(1) if missing |
| PAYMENT_ENCRYPTION_KEY validated | GREEN | Exact 64-char hex required |
| ALLOWED_ORIGINS enforced in production | GREEN | process.exit(1) if blank in prod |
| CORS restricted (allowlist) | GREEN | Only /api/public uses * for QR customers |
| Helmet CSP configured | GREEN | full policy including frameAncestors: none |
| Trust proxy set for Render/nginx | GREEN | app.set('trust proxy', 1) |
| Seed endpoint disabled in production | GREEN | NODE_ENV guard |
| Rate limiting on all auth endpoints | GREEN | login 10/15min, register 5/hr, etc. |
| Refresh token rotation with replay detection | GREEN | H-9 family invalidation |
| hotelId always from JWT (never client-controlled) | GREEN | req.hotelId via authMiddleware |
| branchId validated against org before token issue | GREEN | parentHotelId check |
| Payment amount validated server-side | GREEN | recalcOrderTotals discards client values |
| Razorpay signature verified before order release | GREEN | HMAC + live payments.fetch |
| Razorpay webhook HMAC verified | GREEN | validateWebhookSignature before DB write |
| Aggregator webhook HMAC verified | GREEN | timingSafeEqual HMAC per hotel |
| WhatsApp webhook pre-shared secret verified | GREEN | timingSafeEqual |
| Hardcoded secrets in source | GREEN | None found |
| .env committed to git | GREEN | .gitignore covers it |
| SOCKET_ORIGIN set in production env | YELLOW | Needs env var on Render deployment |
| /api/health unauthenticated detail exposure | YELLOW | Node version, heap, socket count visible |
| GEMINI_API_KEY startup guard | YELLOW | No process.exit — AI fails silently if unset |
| CLOUDINARY_* startup guard | YELLOW | No process.exit — image uploads fail silently |
| REDIS_URL for multi-instance deployments | YELLOW | Falls back to in-memory — safe for single instance only |
| RAZORPAY_PARTNER_WEBHOOK_SECRET (local .env) | RED (config) | Local .env has shell command as value — must be regenerated before deployment |

---

## C. DATABASE

| Item | Status | Notes |
|------|--------|-------|
| MongoDB Atlas cluster configured | BLOCKED | Requires production MONGODB_URI |
| Connection pool size tuned | YELLOW | Review for production load |
| Indexes on all high-query fields | GREEN | Partial unique indexes, compound indexes present |
| Multi-tenant isolation (hotelId on all models) | GREEN | Verified across all route files |
| Atomic operations for race-sensitive writes | GREEN | findOneAndUpdate patterns throughout |
| MongoDB transactions for stock/cancel | GREEN | Mongoose sessions used |
| Offline idempotency index | GREEN | Unique partial index on offlineId |
| Payment unique partial index | GREEN | Prevents duplicate successful payments |
| Backup schedule configured | BLOCKED | Atlas automated backup needs configuration |

---

## D. PAYMENTS

| Item | Status | Notes |
|------|--------|-------|
| Razorpay SDK integrated | GREEN | RazorpayGateway.ts |
| Standard credentials HMAC verification | GREEN | Verified before order release |
| OAuth credentials live payment.fetch verification | GREEN | Cross-checks server-stored gatewayOrderId |
| Duplicate payment prevention | GREEN | Partial unique index + early check |
| Cash payment immediate release | GREEN | No gateway required |
| UPI counter-scan payment (offline cashier) | GREEN | Cashier-recorded, no gateway |
| Kiosk cash: immediate KOT | GREEN | qrRoutes.ts |
| Kiosk Razorpay: KOT only after verified payment | GREEN | payment_pending guard |
| QR Razorpay: KOT only after verified payment | GREEN | payment_pending → qr-verify → pending |
| Admin cannot bypass payment_pending status | GREEN | FIXED: added guard in orderRoutes.ts |
| Razorpay webhook idempotency | GREEN | Early return on status=success |
| Loyalty earn atomic claim (no double-earn) | GREEN | loyaltyEarnedAt null check |
| Payment amount validates within ₹1 of order | GREEN | Server-side check |
| RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in prod | BLOCKED | Requires Render env var configuration |
| Real Razorpay payment test on pilot hotel | YELLOW | End-to-end live test required |
| SaaS billing Razorpay configuration | BLOCKED | RAZORPAY_SAAS_KEY_ID/SECRET needed |

---

## E. PRINTING

| Item | Status | Notes |
|------|--------|-------|
| Single-printer: KOT suppressed (not redirected) | GREEN | printUtils.ts:180 returns early |
| Dual-printer: KOT to kitchen, receipt to cashier | GREEN | Separate device addresses |
| Duplicate KOT prevention | GREEN | Single callsite after transaction |
| Offline print queue with retry | GREEN | Implemented |
| Manual reprint (explicit) | GREEN | printRoutes.ts increments attemptCount |
| Printer registration and token auth | GREEN | Device tokens, hotelId-scoped |
| Real-device printer test (thermal) | YELLOW | Requires physical thermal printer validation |
| Real-device dual-printer test | YELLOW | Requires two-printer setup test |

---

## F. KITCHEN/KDS

| Item | Status | Notes |
|------|--------|-------|
| KOT only after payment for QR/kiosk | GREEN | payment_pending gate verified |
| KOT on immediate cash/UPI orders | GREEN | Emitted on order creation |
| Kitchen role can only update preparing/ready | GREEN | Role guard in orderRoutes.ts |
| Socket.IO kitchen updates hotelId-scoped | GREEN | room = hotel_{hotelId} |
| KDS page authentication | GREEN | Kitchen JWT required |

---

## G. INVENTORY

| Item | Status | Notes |
|------|--------|-------|
| Stock deducted at order creation (transactional) | GREEN | MongoDB session |
| Stock cannot go negative | GREEN | filter {stock: {$gt:0}} + $max clamp |
| Stock restored on order cancellation | GREEN | Transactional restore |
| Ingredient deduction with shortfall tracking | GREEN | stockUtils.ts |
| Stock shortfall does not block order (by design) | GREEN | Physical visibility at counter |

---

## H. MULTI-BRANCH

| Item | Status | Notes |
|------|--------|-------|
| Branch JWT issued only after parentHotelId check | GREEN | branchRoutes.ts:286 |
| Branch data queries use req.hotelId (JWT) | GREEN | All route files verified |
| Shared category config HQ-controlled | GREEN | HQ-only write access |
| Product overlay per-branch | GREEN | Implemented |
| Organization loyalty cross-branch earn/redeem | GREEN | Org loyalty tests pass |
| Invoice numbering per-branch | GREEN | DailyCounter keyed by hotelId |
| Branch A cannot read Branch B orders | GREEN | hotelId scoping |
| Real multi-branch pilot with 2+ branches | YELLOW | Requires live hotel test |

---

## I. OFFLINE

| Item | Status | Notes |
|------|--------|-------|
| Products cached in IndexedDB | GREEN | Offline queue reads local cache |
| Cart persistence across page refresh | GREEN | localStorage |
| Offline orders synced FIFO | GREEN | syncEngine.ts |
| Sync idempotency (offlineId unique index) | GREEN | Prevents duplicate on retry |
| Stale syncing recovery | GREEN | recoverStaleSyncing() |
| Multi-tab exclusive Web Lock | GREEN | navigator.locks.request |
| Razorpay blocked offline | GREEN | assertOfflineQueueable |
| QR/kiosk blocked offline | GREEN | ONLINE_ONLY_SOURCES check |
| Real-device offline test (airplane mode) | YELLOW | Not yet performed on physical device |
| Real-device slow network degraded test | YELLOW | Not yet performed |

---

## J. WHATSAPP

| Item | Status | Notes |
|------|--------|-------|
| Sprint 1 implementation complete | GREEN | 40/40 tests |
| Sprint 2 hardening complete | GREEN | 52/52 tests |
| Stale sending recovery | GREEN | recoverStaleWhatsAppSendingJobs |
| Worker success non-regression guard | GREEN | $nin ['delivered','read'] |
| Phone masking in webhook logs | GREEN | _maskPhone applied |
| Webhook timing-safe comparison | GREEN | FIXED this audit |
| Hotel isolation (hotelId in all lookups) | GREEN | Verified |
| No billing blocked by WhatsApp | GREEN | All callsites fire-and-forget |
| Real MSG91 credentials configured | BLOCKED | Requires hotel-level MSG91 setup |
| Real end-to-end WhatsApp delivery test | YELLOW | Pending MSG91 credentials |
| Status: COMING SOON for marketing | GREEN | HomePage correctly shows Coming Soon |

---

## K. TALLY

| Item | Status | Notes |
|------|--------|-------|
| Sprint 1 + Sprint 2 implementation complete | GREEN | 52/52 tests |
| Admin-only access | GREEN | requireAdmin on tallyRoutes |
| Encrypted connector token | GREEN | AES-256-GCM |
| validateBalance guard on all XML builders | GREEN | All 4 builders + BUILD_FAILED guard |
| Correct debit/credit accounting signs | GREEN | FIXED Sprint 2 |
| All 4 callsites wired (order/cancel/invoice/expense) | GREEN | FIXED Sprint 2 |
| Stale syncing recovery | GREEN | recoverStaleTallySyncJobs |
| Retry with exponential backoff | GREEN | calcTallyBackoff |
| Real TallyPrime end-to-end test | YELLOW | Pending TallyPrime instance |
| Status: COMING SOON for marketing | GREEN | HomePage correctly shows Coming Soon |

---

## L. AI FEATURES

| Item | Status | Notes |
|------|--------|-------|
| Menu import (OCR) | GREEN | Code complete |
| Morning brief | GREEN | Code complete |
| BI chat | GREEN | Code complete |
| Product image detection | GREEN | Code complete |
| AI endpoints rate-limited | GREEN | 10-30/min depending on cost |
| GEMINI_API_KEY required in production | YELLOW | No startup guard — fails silently if unset |
| Real AI test with production Gemini API | YELLOW | Requires GEMINI_API_KEY on Render |

---

## M. REPORTS/GST

| Item | Status | Notes |
|------|--------|-------|
| Daily revenue report | GREEN | Server-side aggregation |
| Shift reports | GREEN | Server-side totals |
| P&L by category/date range | GREEN | Expense + revenue aggregate |
| GST components (CGST/SGST/IGST) | GREEN | Computed server-side |
| GST number stored and validated | GREEN | GSTIN format validation |
| Invoice number sequential | GREEN | DailyCounter per hotel |
| Tally voucher GST alignment | GREEN | CGST/SGST split in XML |

---

## N. BACKUP/RECOVERY

| Item | Status | Notes |
|------|--------|-------|
| MongoDB Atlas automated backup | BLOCKED | Must be configured on Atlas dashboard |
| Redis persistence | YELLOW | Rate limit state lost on restart (acceptable) |
| Offline queue IndexedDB — browser storage | YELLOW | No server-side backup of pending offline orders |
| Point-in-time recovery tested | BLOCKED | Requires Atlas setup |

---

## O. MONITORING

| Item | Status | Notes |
|------|--------|-------|
| SENTRY_DSN configured | YELLOW | Optional but strongly recommended |
| LOGTAIL_SOURCE_TOKEN configured | YELLOW | Optional but strongly recommended |
| /api/health liveness probe | GREEN | Returns 200 for Render health checks |
| /api/health/live and /api/health/ready | GREEN | Separate lightweight probes |
| Error logging to console (minimum) | GREEN | Winston logger |
| Production log aggregation | BLOCKED | Requires LOGTAIL or equivalent |

---

## P. PRODUCTION ENVIRONMENT

Required environment variables for deployment (set on Render/hosting platform):

MUST set (server will not start without these):
- NODE_ENV=production
- MONGODB_URI=<Atlas production URI>
- JWT_SECRET=<64-char hex, openssl rand -hex 32>
- SUPER_ADMIN_JWT_SECRET=<64-char hex, distinct from JWT_SECRET>
- SUPER_ADMIN_ID=<admin ObjectId>
- SUPER_ADMIN_PASS=<strong password>
- ALLOWED_ORIGINS=<comma-separated production frontend URLs>
- PAYMENT_ENCRYPTION_KEY=<64-char hex>

MUST set (features will fail silently at runtime without these):
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET
- GEMINI_API_KEY
- RAZORPAY_CLIENT_ID
- RAZORPAY_CLIENT_SECRET
- RAZORPAY_SAAS_KEY_ID
- RAZORPAY_SAAS_KEY_SECRET
- RAZORPAY_PARTNER_WEBHOOK_SECRET  ← REGENERATE (current local value is invalid)

STRONGLY RECOMMENDED:
- REDIS_URL=<Redis URL> (required for multi-instance; in-memory fallback for single instance)
- SOCKET_ORIGIN=wss://<api-domain> (permissive WebSocket CSP without this)
- SENTRY_DSN=<Sentry DSN>
- LOGTAIL_SOURCE_TOKEN=<Logtail token>

OPTIONAL:
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, LEAD_ALERT_EMAIL (for lead/demo emails)
- AGGREGATOR_SECRET (if Swiggy/Zomato pilot is active)

---

## Q. REAL-DEVICE TESTING

| Item | Status | Notes |
|------|--------|-------|
| Android/iOS QR ordering flow | YELLOW | Pending |
| Physical thermal printer (Epson/Star) | YELLOW | Pending |
| Dual-printer kitchen + cashier | YELLOW | Pending |
| Kiosk touchscreen flow (cash + Razorpay) | YELLOW | Pending |
| Offline mode on mobile (airplane mode) | YELLOW | Pending |
| Customer Display screen | YELLOW | Pending |
| Slow 2G/3G network degraded mode | YELLOW | Pending |
| Multi-tab concurrent cashier scenario | YELLOW | Pending |

---

## R. CUSTOMER ONBOARDING

| Item | Status | Notes |
|------|--------|-------|
| Hotel registration flow | GREEN | Code complete |
| Super admin approval workflow | GREEN | Code complete |
| First-login credential setup | GREEN | Code complete |
| Staff PIN creation flow | GREEN | Code complete |
| Printer registration wizard | GREEN | Code complete |
| Payment gateway setup (Razorpay OAuth) | GREEN | Code complete |
| Onboarding documentation for pilot customer | YELLOW | Needs written guide |
| Support escalation process | BLOCKED | Internal process needed |

---

## FINAL VERDICT

**YELLOW — PILOT READY WITH EXPLICIT PENDING VALIDATIONS**

### CODE STATUS: GREEN

All identified production bugs have been fixed:
- 7 code fixes applied this audit session
- 30/30 test suites pass
- 1078/1078 tests pass
- TypeScript: clean
- Vite build: clean

### REAL ENVIRONMENT VALIDATION STATUS: YELLOW

The following real-world validations have NOT been performed and are required before
moving beyond a single-hotel pilot:

1. RAZORPAY_PARTNER_WEBHOOK_SECRET must be regenerated (local .env has invalid value)
2. End-to-end Razorpay payment on real hardware
3. Physical thermal printer test (single and dual)
4. WhatsApp delivery test with real MSG91 credentials
5. TallyPrime connector test with real TallyPrime instance
6. Offline mode test on physical device (airplane mode)
7. All required Render environment variables configured correctly

### RECOMMENDATION

NO NEW FEATURE DEVELOPMENT RECOMMENDED AT THIS STAGE.

The codebase is feature-complete and production-hardened. The remaining work is
entirely operational: configure the production environment, run real-device acceptance
tests on a pilot hotel, and validate the integrations (Razorpay, WhatsApp, Tally)
with live credentials.

Move to: SINGLE-HOTEL PRIVATE PILOT
After pilot validation: MULTI-HOTEL GA ROLLOUT
