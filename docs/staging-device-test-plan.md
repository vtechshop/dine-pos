# Staging device test plan — release 2026-10

**Every item below is NOT RUN.** Automated tests cover server logic and pure client
logic only. Mark an item PASS only after performing it on the stated hardware, and
record who/when/build.

Environment: staging API + DB restored from a production snapshot (see
`docs/migrations/2026-10-index-migration-runbook.md` §2), web POS build of this
release, Android build of this release (not an OTA), test Razorpay keys only, a
paired Bluetooth thermal printer (58 mm and/or 80 mm), test restaurant data only.
No real customers, payments or WhatsApp messages.

| ID | Area | Device(s) |
|----|------|-----------|
| D1 | Billing drawer: amount already paid online | Web POS + phone (QR customer) |
| D2 | HQ branch switching | Web POS |
| D3 | Kiosk ordering (pay at counter / online) | Android kiosk |
| D4 | Bluetooth receipt + KOT output | Android + BT printer |
| D5 | Printer socket reconnect after token expiry | Android + BT printer |
| D6 | Android background heartbeat | Android + BT printer |
| D7 | Offline sync survives restarts | Android cashier device |
| D8 | Offline wallet block | Android cashier device |
| D9 | Shift close reconciliation | Web POS + Android |
| D10 | Tally Bridge end-to-end | Windows PC with TallyPrime + bridge |
| D11 | Printer discovery, pairing, saved selection | Android + BT printer |
| D12 | Print failure and manual retry | Android + BT printer + web |
| D13 | Duplicate-print prevention | Android + BT printer |

---

### D1 — Billing drawer shows the amount already paid online
1. Open a table session; from a phone, scan the table QR, order ₹500, pay with a
   Razorpay **test** card/UPI; wait until the kitchen receives it.
2. Staff add a ₹200 dine-in order to the same guest; mark both served.
3. Open the billing drawer for that table.

**Expected:** drawer shows "₹500 already paid online", amount due ₹200; split
payment must total ₹200; after billing, the QR order still shows payment method
Razorpay; daily report counts ₹500 under online and ₹200 under the counter method.
**Fail if:** due shows ₹700; split of ₹700 is accepted; QR order relabelled cash.
Also: a QR order still "payment pending" → the bill goes through without charging it and
the order stays "payment pending" (current upstream behaviour; blocking billing instead
is an open decision — see docs/release/2026-10-integration-report.md, decision R2).

### D2 — HQ branch switching
1. Log in as HQ admin (multi-branch enabled, ≥2 branches). Switch to branch A,
   then from inside A switch to branch B. Wait > 15 min (token refresh), switch to A.
2. Log in directly as branch A's own admin. Try to switch to B (UI and a direct
   `POST /api/branches/switch` with B's id).

**Expected:** step 1 all succeed; returning to HQ restores HQ data. Step 2 → 403,
no token issued. **Fail if:** branch admin reaches B by any path; HQ loses the
ability to hop after refresh.

### D3 — Kiosk ordering
1. Kiosk device (kiosk feature on): place a pay-at-counter order → kitchen
   receives it once, KOT prints once.
2. Turn on airplane mode, place a pay-at-counter order → "queued" token shown;
   turn network back on → exactly one order reaches the kitchen.
3. Kill the app while offline with a queued order; reopen online → order sent once.
4. On a non-kiosk customer phone (no login), go offline and try to order →
   "Please reconnect" (no fake queued token).
5. Pay online on the kiosk with a Razorpay test method → order released only after
   payment verification.

**Fail if:** duplicates in kitchen/KOT, a queued order never arrives, or an unpaid
online order reaches the kitchen.

### D4 — Bluetooth printer output
Single-printer mode and dual-printer mode separately:
1. Takeaway order with variant + modifiers; print receipt and KOT.
2. Reconnect the cashier printer (toggle Bluetooth) — **no old receipts reprint**
   (single mode).

**Expected:** totals, GST, discount and payment lines match the bill on screen;
KOT shows table, items, quantities. **Known open issue:** server-dispatched KOTs
may omit variant/modifier text (audit P2, not fixed this release) — record what
prints. **Fail if:** wrong amounts, missing items, or a 24-hour reprint burst.

### D5 — Printer socket reconnect after token expiry
1. Kitchen device logged in, printer registered; leave for > 12 h (or shorten JWT
   expiry on staging), then toggle Wi-Fi.
2. Create an order from the POS.

**Expected:** KOT prints, or the device clearly shows "printer offline / login
required" and queued jobs print after re-login. **Known open issue (audit P7, not
fixed):** the socket uses a fixed token and may not reconnect after expiry — this
item is expected to FAIL until fixed; record the actual behaviour.

### D6 — Android background heartbeat
1. Printer device registered; lock the screen / put the app in background for
   10 min with battery saver on and off.
2. Create orders every 2 minutes from the POS.

**Expected:** KOTs print, or jobs queue and the "printer offline" toast appears and
they print on resume. Record Android version, OEM, battery settings.
**Fail if:** jobs are silently lost or marked printed without printing.

### D7 — Offline sync survives restarts
1. Cashier device (admin login): airplane mode, create 3 cash bills.
2. Force-stop the app; reopen (still offline) → 3 pending bills visible.
3. Go online → all 3 sync once; each is **completed** on the server (not just served).
4. Repeat with the cashier session expired before going online → bills stay
   pending ("login required"), user is not logged out by the background sync; after
   login they sync.
5. Repeat with network flapping during sync (toggle airplane mode while syncing).

**Expected:** server has exactly 3 completed orders per run, no duplicates; none
marked synced while still "served" on the server. **Fail if:** duplicates, lost
bills, or "synced" locally but not completed on the server.

### D8 — Offline wallet block
Customer with wallet balance; go offline; enable "Use wallet"; try to save the bill.
**Expected:** "Wallet needs internet" — bill not queued. Disable wallet → saves.
Online again: wallet use works and the balance drops by exactly the amount used.

### D9 — Shift close reconciliation
Open a shift with ₹1000; during it: cash bill, UPI bill, split bill (cash+UPI), a
guest bill in cash, a QR prepaid order, a ₹50 cash-out, one cash refund recorded
with method "cash" and a matching cash-out "Refund to customer".
**Expected:** expected cash = 1000 + cash bills + split cash + guest cash − cash-outs;
QR/UPI amounts not in cash; the refund appears in the refunds line (not deducted
twice). Count the drawer; difference = 0.

### D10 — Tally Bridge end-to-end (needs real TallyPrime)
1. Web: Settings → Tally: enable, save company name/ledgers, generate connector token.
2. Configure the bridge on a Windows PC running TallyPrime (port 9000).
3. Complete an order → bridge polls, Tally imports the voucher, bridge acks.
4. Regenerate the token → old bridge token is refused.

**Expected:** voucher appears in Tally with correct ledgers and amounts; job shows
"synced". **Not verifiable without a real Tally installation and the bridge
application (not in this repository).**

### D11 — Printer discovery, pairing and saved selection
1. Fresh install: Settings → Printer → scan; pair the thermal printer; select it
   for Receipt (and KOT in dual mode). Force-stop and reopen the app.
2. Turn the printer off, then on; print again without re-selecting.

**Expected:** printer found and paired; selection survives restart; printing works
after the printer power-cycles. **Fail if:** selection is lost or the app prints to
the wrong printer/role.

### D12 — Print failure and manual retry
1. Printer off (or out of paper): complete an order in dual mode.
2. Check the Printer panel (web) / app toast; turn the printer on; tap Retry.

**Expected:** the job shows FAILED (never "success"); Retry prints exactly once.
**Known open issues:** a retry of the same job within 60 s can be skipped and still
reported as success (audit P3); failed **KOT** jobs are not listed on web (P9).
Record actual behaviour.

### D13 — Duplicate-print prevention
1. Complete an order, then immediately toggle Wi-Fi off/on on the printer device.
2. Bill a table with 3 guests in dual mode.

**Expected:** each receipt/KOT prints once; all 3 guest receipts print.
**Known open issue (P4):** guest receipts share one dedup key, so only the first may
print. Record actual behaviour.

---

## Sign-off

| ID | Result (PASS/FAIL/NOT RUN) | Tester | Date | Build | Notes |
|----|----------------------------|--------|------|-------|-------|
| D1 | NOT RUN | | | | |
| D2 | NOT RUN | | | | |
| D3 | NOT RUN | | | | |
| D4 | NOT RUN | | | | |
| D5 | NOT RUN | | | | expected FAIL (P7 open) |
| D6 | NOT RUN | | | | |
| D7 | NOT RUN | | | | |
| D8 | NOT RUN | | | | |
| D9 | NOT RUN | | | | |
| D10 | NOT RUN | | | | needs TallyPrime + bridge |
| D11 | NOT RUN | | | | |
| D12 | NOT RUN | | | | P3/P9 open |
| D13 | NOT RUN | | | | P4 open |
