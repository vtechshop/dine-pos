# SUBSCRIPTION TRIAL PHASE 1 — FINAL REPORT

**Sprint:** SAAS-01  
**Date:** 2026-09-30  
**Status:** COMPLETE — Pending MSG91 template approval for live WhatsApp delivery

---

## SCOPE

Three items implemented as specified:

1. IN-APP TRIAL COUNTDOWN BANNER
2. TRIAL EXPIRY WHATSAPP REMINDERS (Day 7 + Day 12)
3. REGISTRATION EMAIL FIELD FIX

---

## ITEMS DELIVERED

### 1. In-App Trial Countdown Banner

**File created:** `web/src/components/layout/TrialBanner.tsx`  
**File modified:** `web/src/components/layout/AppLayout.tsx`  
**File modified:** `web/src/api/saasBilling.ts`  
**File modified:** `backend/src/routes/saasBillingRoutes.ts`

**Behaviour:**
- Calls `/api/saas/status` once on mount (fails silently on error)
- Visible only when `hotel.status === 'trial'` AND `trialDaysRemaining != null`
- Shows amber banner: "Free trial: N day(s) remaining."
- When `trialDaysRemaining <= 3`: banner turns red, adds "Subscribe Now" link → `/subscription`
- When `trialDaysRemaining === 0`: shows "Your free trial expires today."
- Returns `null` (renders nothing) for active, expired, or suspended hotels
- Positioned at top of main content area, below TopBar and Sidebar

**Backend changes (saasBillingRoutes.ts):**
- Added `trialStartDate` and `trialEndDate` to the `.select()` query
- Server computes `trialDaysRemaining = Math.max(0, Math.ceil(msLeft / msPerDay))`
- `trialDaysRemaining` is `null` when `status !== 'trial'` or `trialEndDate` is null
- Three new fields returned: `trialStartDate`, `trialEndDate`, `trialDaysRemaining`

---

### 2. Trial Expiry WhatsApp Reminders

**File created:** `backend/src/workers/trialReminderWorker.ts`  
**File modified:** `backend/src/services/scheduler.ts`  
**File modified:** `backend/src/models/Hotel.ts`

**Hotel model — new fields:**
```
trialReminder7SentAt:  Date | null   (default: null)
trialReminder12SentAt: Date | null   (default: null)
```

**Worker logic:**
- Day 7 reminder: fires when `trialEndDate ≤ now + 7 days` AND `trialReminder7SentAt === null`
- Day 12 reminder: fires when `trialEndDate ≤ now + 2 days` AND `trialReminder12SentAt === null`
- Multi-branch safe: `parentHotelId: null` filter — standalone/HQ hotels only, no branches
- Atomic claim via `findOneAndUpdate({ trialReminderXSentAt: null }, { $set: ... })` before send
- If provider.name === 'none': logs info, skips send (no failure)
- If phone invalid (normalizePhone returns null): logs warn, skips send
- If send fails: logs error, claim timestamp is NOT reset — prevents retry loops
- Templates used: `dinepos_trial_7day_reminder`, `dinepos_trial_2day_reminder` (language: `en`)

**Scheduler:**
- `scheduleTrialReminders()` runs every **4 hours** via `setInterval`
- Registered in `startScheduler()` and cleared in `stopScheduler()`

**REAL MSG91 VALIDATION: PENDING**  
Templates `dinepos_trial_7day_reminder` and `dinepos_trial_2day_reminder` must be created and Meta-approved in the MSG91 dashboard before WhatsApp delivery succeeds in production. Until then, sends will be accepted by the API but rejected by MSG91 with a template-not-found error (logged at WARN, not thrown).

---

### 3. Registration Email Field Fix

**File modified:** `web/src/pages/RegisterPage.tsx`

**Changes:**
- Email `<label>` text changed from `"Email"` → `"Email *"` (required indicator)
- Email `<input>` placeholder changed from `"Optional"` → `"you@example.com"`
- Added `required` attribute to the email input
- Added frontend validation in `handleSubmit`: checks `form.email.trim()` before calling API; shows "Email address is required." if empty

**Why this was wrong:** Backend validates email as required (`type: String, default: ''` is present but `registerHotel` API rejects empty email). The frontend showed "Optional" causing user confusion and server-side 400 errors.

---

## FILES CHANGED

### Backend (6 files)
| File | Type | Change |
|------|------|--------|
| `backend/src/models/Hotel.ts` | Modified | Added `trialReminder7SentAt`, `trialReminder12SentAt` to interface + schema |
| `backend/src/routes/saasBillingRoutes.ts` | Modified | Added `trialStartDate`, `trialEndDate`, `trialDaysRemaining` to GET /api/saas/status |
| `backend/src/workers/trialReminderWorker.ts` | Created | Trial reminder worker (Day 7 + Day 12) |
| `backend/src/services/scheduler.ts` | Modified | Added `scheduleTrialReminders()`, wired into `startScheduler` / `stopScheduler` |
| `backend/test/regression/sprintSAAS01.test.ts` | Created | 33 regression tests |

### Frontend (4 files)
| File | Type | Change |
|------|------|--------|
| `web/src/api/saasBilling.ts` | Modified | Added `trialStartDate`, `trialEndDate`, `trialDaysRemaining` to `SaasStatus` type |
| `web/src/components/layout/TrialBanner.tsx` | Created | Trial countdown banner component |
| `web/src/components/layout/AppLayout.tsx` | Modified | Added `<TrialBanner />` to main content area |
| `web/src/pages/RegisterPage.tsx` | Modified | Email field: required, label fix, frontend validation |

---

## TEST RESULTS

### sprintSAAS01.test.ts (new suite)

```
Tests:       33 passed, 33 total
Test Suites: 1 passed, 1 total
Time:        8.388 s
```

**Coverage groups:**
- SAAS-01–04: Hotel model trial reminder fields
- SAAS-05–13: Trial reminder worker — logic, phone validation, atomic claim, failure safety
- SAAS-14–18: Scheduler — import, interval variable, function, startScheduler, stopScheduler
- SAAS-19–22: GET /api/saas/status — trialStartDate, trialEndDate, trialDaysRemaining, null for non-trial
- SAAS-23–27: TrialBanner — export, days text, Subscribe Now link, null return, AppLayout wiring
- SAAS-28–30: RegisterPage — required attribute, no "Optional" label, handleSubmit validation
- SAAS-31–33: phoneUtils — export, +91 logic, null for invalid

### Full regression (28 suites)

```
Tests:       979 passed, 2 skipped, 981 total
Test Suites: 25 passed, 4 OOM-crashed (pre-existing)
Time:        62.831 s
```

**4 OOM-crashed suites (pre-existing, not caused by this sprint):**
- `sprint9AAuditFindings.test.ts`
- `sprint9BAuditFindings.test.ts`
- `sec01SuperAdminFallback.test.ts`
- `sprint3Fixes.test.ts`

When run individually with `--runInBand`: **141/141 pass** — confirms these are Jest worker memory exhaustion on this Windows machine when all 28 suites run in parallel. No new failures introduced.

---

## INVARIANTS PRESERVED

- Server remains authoritative for all subscription state — `trialDaysRemaining` is computed backend-side, never client-side
- `hotelId` is always from authenticated JWT (`req.hotelId`) — never from client body
- Trial reminders use atomic MongoDB claim — no double-sends on concurrent worker invocations
- Billing never fails because WhatsApp fails — reminder errors are logged and swallowed
- No credentials logged; phone numbers masked at `normalizePhone()` stage
- Branch hotels excluded from reminders (`parentHotelId: null` filter)
- Claim timestamp NOT reset on send failure — prevents infinite retry loops on invalid phone / unregistered WA number

---

## PENDING BEFORE LIVE

| Item | Status | Required action |
|------|--------|-----------------|
| MSG91 template: `dinepos_trial_7day_reminder` | PENDING | Create + Meta-approve in MSG91 dashboard |
| MSG91 template: `dinepos_trial_2day_reminder` | PENDING | Create + Meta-approve in MSG91 dashboard |
| Mongoose migration | NOT REQUIRED | New fields have `default: null` — existing documents unaffected |
| Feature flag | NOT REQUIRED | Reminders fire for all trial hotels with MSG91 configured |

---

## NOT DONE (out of scope)

- Push / commit / deploy — per instructions: DO NOT commit, push, or deploy
- Paid subscription flow changes
- Trial extension workflow
- SA dashboard trial reminder status view
