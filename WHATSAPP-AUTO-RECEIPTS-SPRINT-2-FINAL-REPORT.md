# WHATSAPP AUTO-RECEIPTS — SPRINT 2 FINAL REPORT
# Deep Production Hardening + Integration Audit
# Date: 2026-09-16

---

## 1. Sprint Objective

Production-harden the Sprint 1 WhatsApp Auto-Receipts implementation by performing a
complete code audit across all layers (model, worker, service, routes, scheduler,
provider, frontend callsites), identifying genuine bugs, fixing them, and adding a
comprehensive regression test suite. No new features. No fake functionality. No
breaking of Sprint 1 tests.

---

## 2. Audit Scope — Files Examined

### Backend
- backend/src/models/WhatsAppReceipt.ts
- backend/src/services/whatsappReceiptService.ts
- backend/src/workers/whatsappReceiptWorker.ts
- backend/src/routes/messagingWebhookRoutes.ts
- backend/src/routes/whatsappSettingsRoutes.ts
- backend/src/routes/whatsappReceiptRoutes.ts
- backend/src/services/messagingProvider.ts
- backend/src/services/scheduler.ts
- backend/src/utils/phoneUtils.ts
- backend/src/routes/orderRoutes.ts (WhatsApp callsite)
- backend/src/routes/guestRoutes.ts (WhatsApp callsite)
- backend/test/regression/sprintWA01WhatsAppReceipts.test.ts

### Frontend
- web/src/api/whatsappReceipts.ts
- web/src/pages/IntegrationsPage.tsx (WhatsApp section)
- web/src/components/cashier/NewOrderPanel.tsx

---

## 3. Bugs Found and Fixed

### BUG 1 (HIGH SEVERITY) — No Stale Recovery for `sending` Status
File: backend/src/workers/whatsappReceiptWorker.ts
File: backend/src/services/scheduler.ts

**Description:** The worker atomically claims a receipt by setting status → 'sending'.
If the Node.js process crashes after the claim but before _sendReceipt() completes,
the job is permanently stuck in 'sending' with no recovery path:
- The normal sweep only queries status = 'queued' — stuck jobs are never re-swept
- The manual retry API only accepts status 'failed' | 'skipped' — operators cannot
  manually recover 'sending' jobs either

Tally had the same architecture and was already fixed with recoverStaleTallySyncJobs().
WhatsApp had no equivalent.

**Fix:**
- Added recoverStaleWhatsAppSendingJobs() to whatsappReceiptWorker.ts
  - Queries: { status: 'sending', lastAttemptAt: { $lte: 10-min-ago } }
  - Action: updateMany → status = 'queued', nextRetryAt = null
  - Errors caught and logged at WARN (never propagated to crash the scheduler)
  - Logs count of recovered jobs when > 0
- Added scheduleWhatsAppReceiptRecovery() to scheduler.ts
  - Runs every 5 minutes (same cadence as Tally recovery)
  - Imported recoverStaleWhatsAppSendingJobs alongside processQueuedWhatsAppReceipts
  - Added waReceiptRecoveryTick to startScheduler() and stopScheduler()

---

### BUG 2 (MEDIUM SEVERITY) — Worker Success Update Can Regress Status from 'delivered'/'read'
File: backend/src/workers/whatsappReceiptWorker.ts

**Description:** In _sendReceipt(), after the provider accepts the message, the worker
unconditionally calls:

    WhatsAppReceipt.findByIdAndUpdate(rec._id, { $set: { status: 'sent', ... } })

findByIdAndUpdate always writes regardless of current document state. In a race where:
1. Worker sends to MSG91 (HTTP call — takes ~200–500ms)
2. MSG91 delivers message to customer instantly
3. MSG91 fires 'delivered' webhook before the worker's HTTP response returns
4. Webhook handler updates receipt → 'delivered'
5. Worker's API call returns, writes status = 'sent'
→ Status regresses from 'delivered' back to 'sent'

This is unlikely but non-zero, particularly on low-latency networks or when MSG91 processes
a batch queue. The receipt would show 'sent' rather than 'delivered' in the hotel dashboard.

**Fix:**
Changed findByIdAndUpdate to findOneAndUpdate with a query guard:

    WhatsAppReceipt.findOneAndUpdate(
      { _id: rec._id, status: { $nin: ['delivered', 'read'] } },
      { $set: { status: 'sent', sentAt: now, requestId, attemptCount: ... } },
    )

If the webhook has already advanced the receipt to 'delivered' or 'read', the findOneAndUpdate
matches nothing and writes nothing — the advanced status is preserved.

---

### BUG 3 (LOW SEVERITY) — Full Customer Phone Numbers Exposed in Webhook Logs
File: backend/src/routes/messagingWebhookRoutes.ts

**Description:** Three logger calls in _processEvent() logged the raw `phone` variable
(from the webhook payload) without masking:
- logger.warn('[messaging-webhook] Incomplete payload', { ..., phone, ... })
- logger.info('[messaging-webhook] Campaign message status updated', { ..., phone, ... })
- logger.info('[messaging-webhook] WhatsApp receipt status updated', { ..., phone, ... })

The whatsappSettingsRoutes.ts test-send endpoint already masked phones (last 4 digits),
and whatsappReceiptRoutes.ts masks with _maskPhone() before returning to the client.
The webhook logs were inconsistently exposed.

**Fix:**
- Added _maskPhone() helper to messagingWebhookRoutes.ts:
    function _maskPhone(phone: string): string {
      if (!phone || phone.length <= 4) return '****';
      return phone.slice(0, Math.max(phone.length - 4, 2)) + '****';
    }
- Applied _maskPhone(phone) to all three logger calls

---

## 4. Confirmed Non-Bugs (Investigated, No Fix Required)

### STATUS_RANK Discrepancy — Webhook vs Sprint 1 Test
The webhook file uses STATUS_RANK = { queued:0, sent:1, failed:1, delivered:2, read:3 }.
The Sprint 1 test uses STATUS_RANK = { queued:0, sending:1, sent:2, failed:2, delivered:3, read:4 }.

These are intentionally different rank systems for different contexts:
- Webhook rank tracks externally-reportable delivery states (MSG91 never reports 'sending')
- Sprint 1 test rank tracks the full lifecycle including the internal 'sending' state
Both are internally consistent. Not a bug.

### Guest Phone Lookup via CustomerProfile
In guestRoutes.ts, the WhatsApp callsite does not pass guest.phone:
    void createWhatsAppReceiptJobForGuest(req.hotelId!, { _id: guest._id, customerId: guest.customerId });

This is correct because:
- The Guest model has no phone field (confirmed by grep)
- createWhatsAppReceiptJobForGuest() looks up CustomerProfile by customerId to get the phone
- Walk-in guests with no customerId → phone = null → _createJob silently returns (correct behavior)
Not a bug.

### No stale recovery for WhatsApp worker — Sprint 1 status-machine design
The normal queue sweep only picks up 'queued' records. This was intentional in Sprint 1
(avoid double-sends). The stale recovery added in BUG 1 fix handles the crash case.
Not an additional bug.

---

## 5. Files Changed

```
backend/src/workers/whatsappReceiptWorker.ts
  - Added recoverStaleWhatsAppSendingJobs() (BUG 1)
  - Changed success path findByIdAndUpdate → findOneAndUpdate with $nin guard (BUG 2)

backend/src/services/scheduler.ts
  - Imported recoverStaleWhatsAppSendingJobs (BUG 1)
  - Added waReceiptRecoveryTick variable (BUG 1)
  - Added scheduleWhatsAppReceiptRecovery() function (BUG 1)
  - Called it in startScheduler() and stopScheduler() (BUG 1)

backend/src/routes/messagingWebhookRoutes.ts
  - Added _maskPhone() helper (BUG 3)
  - Applied masking to 3 logger calls (BUG 3)

backend/test/regression/sprintWA02.test.ts
  - CREATED: 52 new regression tests (WA-S2-01 through WA-S2-52)
```

### Files NOT changed (Sprint 1 preserved exactly)
```
backend/src/models/WhatsAppReceipt.ts          — no change
backend/src/services/whatsappReceiptService.ts  — no change
backend/src/routes/whatsappSettingsRoutes.ts    — no change
backend/src/routes/whatsappReceiptRoutes.ts     — no change
backend/src/services/messagingProvider.ts       — no change
backend/src/utils/phoneUtils.ts                 — no change
backend/src/routes/orderRoutes.ts               — no change
backend/src/routes/guestRoutes.ts               — no change
web/src/api/whatsappReceipts.ts                 — no change
backend/test/regression/sprintWA01WhatsAppReceipts.test.ts — no change
```

---

## 6. Test Suite — sprintWA02.test.ts

Total: 52 tests, all passing.

WA-S2-01–07   Stale recovery (recoverStaleWhatsAppSendingJobs)
WA-S2-08–15   Status non-regression guard (worker success path $nin)
WA-S2-16–22   Webhook phone masking (_maskPhone applied everywhere)
WA-S2-23–29   Worker atomic claim invariants
WA-S2-30–36   Permanent failure keyword detection
WA-S2-37–43   Backoff schedule correctness
WA-S2-44–52   Design invariants (fire-and-forget, scheduler wiring, security)

---

## 7. Full Regression Results

### Test Suites
  30 suites passed, 0 failed
  1078 tests passed, 2 skipped (pre-existing), 15 todo (pre-existing), 0 failed

### TypeScript (both projects)
  backend: npx tsc --noEmit → clean (0 errors)
  web:     npx tsc --noEmit → clean (0 errors)

### Vite Production Build
  npx vite build → ✓ built in ~11s
  (chunk size warning is pre-existing, unrelated to WhatsApp)

### Sprint 1 tests — zero regressions
  sprintWA01WhatsAppReceipts.test.ts: 40/40 pass (unchanged)

---

## 8. Security Invariants Verified (All Preserved)

- hotelId from authenticated tenant context, never from request body
- Provider API keys AES-256-GCM encrypted, never logged, never returned in API responses
- Webhook requires x-dinepos-secret header before any DB write
- CampaignMessage and WhatsAppReceipt updates include hotelId scope (cross-tenant isolation)
- All log entries now mask customer phone numbers (BUG 3 fix)
- No WhatsApp failure can block billing, payment, or KOT
- All WhatsApp callsites use void (fire-and-forget)
- Marketing channel remains OFFLINE — no change to MSG91 environment mode
- No real MSG91 API calls made during audit or testing
- No customer data sent during audit or testing

---

## 9. Non-Negotiable Constraints — All Preserved

- No automatic merging of customer records
- No automatic changes to historical loyalty balances
- Wallet remains hotel-scoped
- Server remains authoritative for all financial fields
- hotelId from authenticated tenant context
- No fake/mock functionality added
- No artifact/HTML pages produced
- No deployment, no push, no commit performed
- Razorpay, UPI, QR ordering, Kiosk Razorpay, payment verification untouched
- Existing offline architecture preserved
- Offline org loyalty redemption still blocked
- Production safety > feature count

---

## 10. Sprint 2 Status: COMPLETE

DO NOT COMMIT until explicitly instructed.
DO NOT DEPLOY.
DO NOT PUSH.
DO NOT send messages to real customers.
DO NOT use production MSG91 credentials.
