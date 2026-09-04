# Dine POS — UAT Execution Plan
**Version:** 1.0 · Pilot UX Patch v1.0.1  
**System:** Dine POS (app.dinepos.com)  
**Prepared by:** QA / Restaurant Operations  
**Document status:** ACTIVE — Do not modify during live pilot

---

## Pilot Information

| Field | Value |
|---|---|
| Restaurant Name | ___________________________ |
| Pilot Start Date | ___________________________ |
| Pilot End Date | ___________________________ |
| Lead Tester | ___________________________ |
| Operations Contact | ___________________________ |
| Environment | [ ] Staging  [ ] Production Pilot |
| Device Under Test (Web) | ___________________________ |
| Device Under Test (Mobile) | ___________________________ |
| Printer Model / IP | ___________________________ |
| Network Type | [ ] Wired  [ ] Wi-Fi  [ ] 4G Hotspot |

---

## Severity Definitions

| Severity | Definition |
|---|---|
| **Critical** | System unusable; data loss risk; payment cannot be completed; blocks service |
| **High** | Major workflow broken; significant staff or guest impact; no workaround |
| **Medium** | Workflow degraded; workaround exists; impacts efficiency |
| **Low** | Cosmetic, labelling, or minor UX issue; no operational impact |

## Result Codes

| Code | Meaning |
|---|---|
| **Pass** | Behaviour matches expected result exactly |
| **Fail** | Behaviour does not match expected result; defect logged |
| **Blocked** | Test cannot be executed due to missing precondition or environment issue |
| **N/A** | Test not applicable to this pilot configuration |

---

## Table of Contents

1. [Owner UAT](#1-owner-uat)
2. [Cashier UAT](#2-cashier-uat)
3. [Waiter UAT](#3-waiter-uat)
4. [Kitchen UAT](#4-kitchen-uat)
5. [Customer QR UAT](#5-customer-qr-uat)
6. [Printer UAT](#6-printer-uat)
7. [Network Failure UAT](#7-network-failure-uat)
8. [Power Failure UAT](#8-power-failure-uat)
9. [Database Recovery UAT](#9-database-recovery-uat)
10. [Performance UAT](#10-performance-uat)
11. [Pilot Observation Sheet](#11-pilot-observation-sheet)
12. [Daily Bug Log](#12-daily-bug-log)
13. [Feature Request Log](#13-feature-request-log)
14. [Restaurant Feedback Form](#14-restaurant-feedback-form)

---

## Test Summary Tracker

| Section | Total | Pass | Fail | Blocked | N/A |
|---|---|---|---|---|---|
| 1. Owner UAT | 10 | | | | |
| 2. Cashier UAT | 13 | | | | |
| 3. Waiter UAT | 7 | | | | |
| 4. Kitchen UAT | 5 | | | | |
| 5. Customer QR UAT | 5 | | | | |
| 6. Printer UAT | 6 | | | | |
| 7. Network Failure UAT | 6 | | | | |
| 8. Power Failure UAT | 5 | | | | |
| 9. Database Recovery UAT | 4 | | | | |
| 10. Performance UAT | 5 | | | | |
| **TOTAL** | **71** | | | | |


---

## 1. Owner UAT

**Role context:** Owner and Manager share the `admin` JWT role. All OWN tests apply to both. Execute while logged in with Owner-level credentials.

---

### OWN-01 — Login and Role Verification
**Severity:** Critical

**Preconditions:**
- Fresh browser tab (no existing session)
- Valid Owner email and password available
- Hotel is active in the system

**Steps:**
1. Open `app.dinepos.com` in Chrome or Edge (latest)
2. Enter Owner email and password
3. Click **Sign In**
4. Observe the page the system redirects to
5. Check the TopBar: hotel name next to the Dine POS logo
6. Check the role label displayed next to the user avatar icon

**Expected Result:**
> System redirects to `/dashboard`. TopBar shows the hotel name. Role label reads **Admin**. A green **Live** badge is visible. No errors are shown.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-02 — Dashboard Table Grid Accuracy
**Severity:** High

**Preconditions:**
- At least 5 tables configured
- At least 1 table occupied with an open session
- At least 1 table available

**Steps:**
1. View the Dashboard immediately after login
2. Count table cards; verify count matches total configured tables
3. Identify an **Available** card — should show "Tap to seat guests"
4. Identify an **Occupied** card — should show guest count and session duration
5. Verify no blue borders or blue UI elements appear on any table card

**Expected Result:**
> All configured tables are visible. Available tables show an orange-tinted prompt. Occupied tables show guest count and elapsed time. The table grid uses only the orange / cream / near-black colour scheme with no blue.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-03 — Open an Available Table Session
**Severity:** Critical

**Preconditions:**
- At least 1 table with status Available
- Logged in as Owner or Cashier (both can open sessions)

**Steps:**
1. From the Dashboard, click an Available table card
2. Observe the card immediately — should show "Opening..." spinner
3. Observe the BillingDrawer that opens on the right side of the screen
4. Verify the BillingDrawer header shows the correct table number
5. Return to the Dashboard; verify the table card now shows as Occupied

**Expected Result:**
> Clicking the card triggers a brief loading state on the card itself. The BillingDrawer opens without a page reload. The table transitions to Occupied on the grid. If two staff click the same table simultaneously (race condition), one receives the session; the other sees the table refresh as occupied.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-04 — Daily Revenue Report
**Severity:** High

**Preconditions:**
- At least 3 transactions completed today across different payment methods (Cash, Card, UPI)
- Owner logged in

**Steps:**
1. Navigate to **Reports** via the sidebar
2. Confirm **Daily** view is active and today's date is shown
3. Record Total Revenue, Order Count, and Average Order Value
4. Verify CGST and SGST are shown as separate line items
5. Verify a payment method breakdown (Cash / Card / UPI) is present

**Expected Result:**
> Daily report shows correct totals that match the transactions processed. Tax is split into CGST and SGST lines. All payment methods used today appear in the breakdown. No unexplained gaps or duplicate counts.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-05 — Date Range Report
**Severity:** High

**Preconditions:**
- At least 3 days of historical transaction data

**Steps:**
1. Navigate to **Reports**; switch to **Range** view
2. Set start date to 7 days ago and end date to today
3. Generate / apply the range
4. Verify revenue total is greater than a single day's total from OWN-04
5. Verify the report loads without timeout or error

**Expected Result:**
> Report aggregates all transactions in the selected range. Revenue total is the sum of all days. The date picker accepts past dates without validation errors. Report renders within 5 seconds.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-06 — Product Performance Report
**Severity:** Medium

**Preconditions:**
- At least 5 distinct menu items sold

**Steps:**
1. Navigate to **Reports** > **Products** tab
2. Observe the top-selling items list
3. Verify item names match the product catalogue exactly
4. Verify quantity sold and revenue per item are shown
5. Check the sort order (expected: by revenue or quantity, descending)

**Expected Result:**
> Items are listed with correct names, quantities, and revenue figures. The highest-performing item appears first. No duplicate entries. Items with zero sales are absent or clearly separated.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-07 — Staff Management: Deactivate a Staff Member
**Severity:** Critical

**Preconditions:**
- At least 1 active Waiter or Cashier staff record
- A second device available to test the login denial
- Owner logged in

**Steps:**
1. Navigate to **Settings** > **Staff**
2. Select the target Waiter or Cashier
3. Toggle their status to **Inactive** and save
4. On the second device, attempt to log in with that staff member's PIN via the staff login screen
5. Observe the response

**Expected Result:**
> Login is rejected for the deactivated staff member. An error message is shown (e.g., "Account inactive" or similar). No authenticated session is created. Reactivating the staff member in Settings restores login ability.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-08 — Logout Confirmation Modal
**Severity:** High

**Preconditions:**
- Owner is logged in with an active session

**Steps:**
1. Click the **logout icon** (arrow/door icon) in the top-right TopBar
2. Observe: a confirmation modal should appear
3. Click **Cancel** — verify the session continues and the Dashboard is still visible
4. Click the logout icon again; this time click **Sign out**
5. Observe the browser redirect

**Expected Result:**
> A modal appears asking "Sign out?" with Cancel and Sign out buttons. Cancel dismisses the modal with no session change. Sign out ends the session and returns to the login page. Clicking the icon alone does not immediately log the user out.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-09 — Settings: General Configuration Save
**Severity:** Medium

**Preconditions:**
- Owner logged in, Settings page accessible

**Steps:**
1. Navigate to **Settings** > **Profile** or **General**
2. Change the displayed hotel name to append " - UAT" (e.g., "Hotel Sunrise - UAT")
3. Save the change
4. Return to the Dashboard
5. Verify the updated name appears in the TopBar
6. Revert the name to the original and save again

**Expected Result:**
> The updated hotel name reflects in the TopBar without requiring a logout or page reload. Both the change and the revert save successfully with a confirmation indicator.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### OWN-10 — Branding Consistency Audit
**Severity:** Low

**Preconditions:**
- Owner logged in; navigate through all major pages during this test

**Steps:**
1. Visit each page in turn: Dashboard, Orders, Tables, Customers, Products, Inventory, Reports, Settings
2. On each page, scan for any **blue** colours in buttons, borders, icons, or active/selected states
3. Verify primary action buttons use orange (#E8380D)
4. Verify the sidebar active-page indicator uses orange, not blue
5. Verify the page background is cream (#FFF6EE), not white

**Expected Result:**
> No blue branding elements appear on any page. All interactive elements follow the orange / near-black / cream palette. The sidebar highlights the active page in orange. Page backgrounds are warm cream throughout.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 2. Cashier UAT

**Role context:** Cashier JWT role (`cashier`). After login, redirected to `/dashboard`. Execute on a dedicated cashier device or a shared terminal. All payment and billing tests run here.

---

### CSH-01 — Cashier Login
**Severity:** Critical

**Preconditions:**
- Active Cashier staff record with a 4-digit PIN
- No active session on the device

**Steps:**
1. Open `app.dinepos.com`
2. Select **Cashier** on the role selection screen
3. Enter the 4-digit PIN
4. Tap / click **Sign In**
5. Observe the landing page and TopBar role label

**Expected Result:**
> System redirects to `/dashboard`. TopBar role label reads **Cashier**. The full dashboard table grid is visible. No admin-only navigation is highlighted or required for daily cashier tasks.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-02 — Open BillingDrawer for an Occupied Table
**Severity:** Critical

**Preconditions:**
- At least 1 occupied table with active guests and placed orders
- Cashier is logged in

**Steps:**
1. From the Dashboard, click an **Occupied** table card
2. Observe the BillingDrawer opening on the right
3. Verify the table number in the BillingDrawer header matches the card clicked
4. Verify guest cards are listed with their names and order totals
5. Verify the elapsed session time is shown in the header

**Expected Result:**
> BillingDrawer opens without a page reload. Correct table label is in the header. All guests for that session are listed with their current order amounts. Session duration (e.g., "Open 14m") is visible.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-03 — Single Guest: Cash Payment
**Severity:** Critical

**Preconditions:**
- BillingDrawer open, at least 1 active guest with items ordered

**Steps:**
1. In the BillingDrawer, locate an active guest card
2. Click the **Pay** button on that guest card
3. Verify the PaymentPanel switches to "Single Guest" mode and shows the guest's name and total
4. Verify the **Confirm Payment** button flashes briefly (green pulse animation)
5. Select payment method **Cash** (or confirm it is already selected)
6. Click **Confirm Payment**

**Expected Result:**
> Guest is marked as **Billed**. A receipt view appears in the right panel showing itemised orders, CGST/SGST split, and grand total. Payment method shows "Cash". A print job is dispatched to the printer.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-04 — Single Guest: Card Payment
**Severity:** Critical

**Preconditions:**
- BillingDrawer open, at least 1 active guest with items ordered

**Steps:**
1. Click **Pay** on a guest card
2. Select payment method **Card**
3. Click **Confirm Payment**
4. Verify receipt shows "Card" as the payment method

**Expected Result:**
> Same success flow as CSH-03. Receipt correctly labels payment as Card. Guest status updates to Billed.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-05 — Single Guest: UPI Payment
**Severity:** High

**Preconditions:**
- BillingDrawer open, at least 1 active guest with items ordered

**Steps:**
1. Click **Pay** on a guest card
2. Select payment method **UPI**
3. Click **Confirm Payment**
4. Verify receipt shows "UPI" as the payment method

**Expected Result:**
> Same success flow. Receipt labels payment as UPI. Guest marked Billed.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-06 — Single Guest: Split Payment
**Severity:** High

**Preconditions:**
- Active guest with a total greater than 200
- BillingDrawer open

**Steps:**
1. Click **Pay** on the guest card
2. Select payment method **Split**
3. Enter partial amounts in Cash, Card, and UPI fields
4. Verify: **Confirm Payment** button remains disabled while amounts do not sum to the total
5. Adjust amounts until they sum exactly to the guest total
6. Confirm: **Confirm Payment** button becomes enabled
7. Click **Confirm Payment**
8. Verify receipt shows all three payment components

**Expected Result:**
> The Confirm Payment button enables only when the split amounts balance to the cent. Receipt itemises each split component (Cash, Card, UPI with individual amounts). Guest is marked Billed.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-07 — Complimentary Bill
**Severity:** Medium

**Preconditions:**
- Active guest with items ordered
- Owner has authorised a complimentary write-off for this test

**Steps:**
1. Click **Pay** on a guest card
2. Select payment method **Complimentary**
3. Observe the amber notice: "Complimentary — no charge will be recorded"
4. Click **Confirm Payment**
5. Verify guest is marked Billed
6. Verify the revenue report does NOT include this amount in today's takings

**Expected Result:**
> Guest is billed with zero charge. Receipt reflects the Complimentary method. Daily revenue report total is unchanged from before this transaction.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-08 — Bill Entire Table (Bulk Close)
**Severity:** Critical

**Preconditions:**
- Session with at least 2 active guests, each with at least 1 order
- Cashier or Owner logged in

**Steps:**
1. Open the BillingDrawer for the target table
2. Switch to **Entire Table** mode in the PaymentPanel (top toggle)
3. Verify the total shown is the sum of all active guests
4. Select a payment method
5. Click **Confirm Payment**
6. Read the close-session confirmation dialog that appears
7. Click **Confirm & Close**
8. Verify the table returns to Available on the Dashboard

**Expected Result:**
> All active guests are billed simultaneously. The session closes. Table card on the Dashboard immediately transitions to Available. A receipt view for the full table is shown. Print job is dispatched.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-09 — Mark Guest as Left (No Bill)
**Severity:** High

**Preconditions:**
- Active guest in an open session

**Steps:**
1. Open the BillingDrawer for the session
2. On the guest card, click **Left**
3. Observe: a two-step confirmation appears ("Mark as left? They won't be billed.")
4. Click **Cancel** — verify the guest is still shown as Active
5. Click **Left** again
6. This time click **Yes, Mark Left**
7. Observe the guest card updates to Left status

**Expected Result:**
> First click on Left shows the inline confirmation. Cancel aborts with no change. Confirming marks the guest as Left. The guest's orders remain visible but no payment is processed. The guest's amount is excluded from the session total.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-10 — Merge Guests
**Severity:** High

**Preconditions:**
- Session with at least 2 active guests
- BillingDrawer open

**Steps:**
1. On an active guest card, click the **...** (overflow) button
2. Click **Merge** from the overflow menu
3. Follow the merge flow to select the target guest
4. Verify the merged guest's orders now appear under the surviving guest
5. Verify the original guest no longer appears as Active

**Expected Result:**
> The merge flow completes without error. The surviving guest card shows the combined order history. The merged guest's items are preserved and visible. The session total reflects the combined amount.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-11 — Transfer Guest to Another Table
**Severity:** High

**Preconditions:**
- Session with at least 1 active guest
- At least 1 other occupied table (open session) to transfer to
- BillingDrawer open

**Steps:**
1. On an active guest card, click the **...** (overflow) button
2. Click **Move** from the overflow menu
3. Select the target session from the available sessions list
4. Complete the transfer
5. Open the BillingDrawer for the target table and verify the guest appears there

**Expected Result:**
> Guest and their orders are transferred to the new session. The original session no longer shows the guest. The target session shows the guest with all their orders intact. Totals on both sessions update correctly.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-12 — Receipt View Accuracy
**Severity:** High

**Preconditions:**
- A guest has just been successfully billed (continue from CSH-03 or CSH-04)

**Steps:**
1. After payment confirmation, observe the receipt view in the right panel
2. Verify all ordered items appear with correct names, quantities, and individual totals
3. Verify Subtotal, CGST, and SGST are on separate lines
4. Verify Grand Total equals Subtotal + CGST + SGST (±0.01 rounding)
5. Verify the payment method label is correct
6. Verify the timestamp is accurate (within 1 minute of actual billing time)

**Expected Result:**
> Receipt is itemised and arithmetically correct. Tax is split into CGST and SGST (not a single "GST" line). Grand total matches. Payment method and timestamp are accurate.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### CSH-13 — Payment Method Keyboard Shortcuts
**Severity:** Medium

**Preconditions:**
- BillingDrawer is open with at least 1 active guest

**Steps:**
1. With the BillingDrawer focused (not typing in a text field), press **C**
2. Verify payment method switches to Cash
3. Press **K** — verify Card is selected
4. Press **U** — verify UPI is selected
5. Press **S** — verify Split is selected
6. Press **M** — verify Complimentary is selected
7. Press **Enter** — if guest and method are valid, verify Confirm Payment is triggered

**Expected Result:**
> Each key switches the payment method without requiring a mouse click. Enter triggers confirmation only when the payment is valid (guest selected in guest mode, amounts balanced in split mode). No shortcuts fire when the user is typing in a text/search input.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 3. Waiter UAT

**Role context:** Waiter JWT role (`waiter`). Waiters can open sessions and place orders. They cannot bill guests or access Reports / Settings.

---

### WAI-01 — Waiter Login
**Severity:** Critical

**Preconditions:**
- Active Waiter staff record with PIN
- Clean device / browser tab

**Steps:**
1. Open `app.dinepos.com`
2. Select **Waiter** on the role selection screen
3. Enter the 4-digit PIN
4. Observe landing page and TopBar

**Expected Result:**
> Redirected to `/dashboard`. TopBar role label reads **Waiter**. The full table grid is visible. No billing/payment options are accessible without first selecting a table.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### WAI-02 — Open New Session by Clicking Available Table
**Severity:** Critical

**Preconditions:**
- At least 1 table with Available status
- Waiter is logged in

**Steps:**
1. From the Dashboard, identify an Available table card
2. Observe: card should display "Tap to seat guests"
3. Click the card
4. Observe the card transitions to a loading / "Opening..." state
5. Observe the BillingDrawer opens showing the new (empty) session

**Expected Result:**
> Clicking an available table opens a new session and shows the BillingDrawer. The table transitions to Occupied on the grid. The BillingDrawer header shows the correct table number. No page reload occurs.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### WAI-03 — Add a Guest to an Open Session
**Severity:** High

**Preconditions:**
- BillingDrawer open for an active session (continue from WAI-02 or an existing session)

**Steps:**
1. In the BillingDrawer guest list, find and click **Add Guest** (or equivalent button)
2. Enter a guest display label (e.g., "Table 3 - Seat 1" or "Mr. Sharma")
3. Save / confirm
4. Verify the guest card appears in the BillingDrawer guest list

**Expected Result:**
> A new guest card appears with the entered label and an Active status badge. Guest total is 0 until orders are placed. The session guest count in the header increments.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### WAI-04 — Place an Order for a Guest
**Severity:** Critical

**Preconditions:**
- Session open with at least 1 active guest
- At least 1 product in at least 1 category

**Steps:**
1. Select a guest from the BillingDrawer
2. Navigate to the order / menu section
3. Select a product and specify quantity
4. Submit / confirm the order
5. Verify the order appears on the guest card with the correct amount
6. On a separate device (cashier/kitchen), verify the order appears in real time

**Expected Result:**
> Order is placed and immediately visible on the guest card. The kitchen display shows the new order within 3 seconds (real-time socket push). The guest total updates to reflect the ordered items.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### WAI-05 — Waiter Cannot Bill a Guest
**Severity:** Critical

**Preconditions:**
- Active session with at least 1 active guest and placed orders

**Steps:**
1. In the BillingDrawer, locate an active guest card
2. Verify there is NO **Pay** button visible on the guest card for a Waiter role
3. Attempt to navigate directly to `/cashier` in the browser address bar
4. Observe the result

**Expected Result:**
> The Pay/Bill button is not accessible to a Waiter. Attempting to access `/cashier` either redirects to the Dashboard or shows a "Coming soon" / access-denied state. No payment confirmation flow can be initiated by the Waiter role.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### WAI-06 — Waiter Cannot Access Reports or Settings
**Severity:** Critical

**Preconditions:**
- Waiter is logged in

**Steps:**
1. Click **Reports** in the sidebar
2. Observe: does the page load, or is access denied?
3. Attempt to browse to `/reports` directly via browser address bar
4. Click **Settings** in the sidebar
5. Observe similarly

**Expected Result:**
> Reports and Settings pages either (a) redirect to Dashboard, or (b) load the page shell but all API calls return 403 so no sensitive data is displayed. The waiter cannot view revenue figures, staff lists, or configuration options.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### WAI-07 — Logout Confirmation
**Severity:** High

**Preconditions:**
- Waiter is logged in

**Steps:**
1. Click the logout icon in the TopBar
2. Observe the confirmation modal
3. Click **Sign out**
4. Verify redirect to login page

**Expected Result:**
> Confirmation modal appears. Sign out ends the Waiter session and returns to the login page. Open sessions and orders placed during this session are unaffected and remain visible to the Cashier.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 4. Kitchen UAT

**Role context:** Kitchen JWT role (`kitchen`). Kitchen staff access the kitchen order display only. They receive real-time order notifications and mark items as prepared.

---

### KIT-01 — Kitchen Login
**Severity:** Critical

**Preconditions:**
- Active Kitchen record with a PIN (kitchenPin must be set in the hotel configuration)
- Kitchen display device available (tablet or wall-mounted screen recommended)

**Steps:**
1. On the kitchen device, open `app.dinepos.com`
2. Select **Kitchen** on the role selection screen
3. Enter the kitchen PIN
4. Observe the landing screen

**Expected Result:**
> System redirects to the Kitchen display view. Only kitchen-relevant order information is shown. The TopBar role label reads **Kitchen**. No billing, reports, or settings options are accessible.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### KIT-02 — New Order Appears in Real Time
**Severity:** Critical

**Preconditions:**
- Kitchen display logged in and visible (KIT-01 complete)
- A second device (waiter or cashier) available to place an order

**Steps:**
1. On the kitchen display, note the current state (number of pending orders)
2. On the second device, log in as Waiter or Owner and place a new order for any guest
3. Watch the kitchen display without refreshing

**Expected Result:**
> The new order appears on the kitchen display within 3 seconds of being placed, without any manual page refresh. The order shows the table number, guest label, item names, and quantities. The live socket connection (Live badge) is green.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### KIT-03 — Order Details Accuracy
**Severity:** High

**Preconditions:**
- At least 1 order displayed on the kitchen screen (continue from KIT-02)

**Steps:**
1. On the kitchen display, read the order details for the new order
2. On the ordering device, verify the item names, quantities, and table label match exactly what was ordered
3. If modifiers or notes were added to the order, verify they appear on the kitchen ticket

**Expected Result:**
> Every item, quantity, and table/guest label on the kitchen display matches what was entered by the waiter. No truncation of item names. Correct quantities shown. No items from other tables appear on this ticket.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### KIT-04 — Multiple Concurrent Orders Display
**Severity:** High

**Preconditions:**
- At least 3 different tables with active sessions
- Orders placed simultaneously from multiple devices

**Steps:**
1. Have 2-3 staff place orders from different tables within 30 seconds of each other
2. Observe the kitchen display
3. Verify all orders appear, sorted by arrival time (oldest first)
4. Verify orders from different tables do not merge or overwrite each other
5. Note whether the display becomes unreadable or overflows at high order volume

**Expected Result:**
> All concurrent orders appear as distinct tickets. Each ticket is clearly labelled with its table and guest. Orders are sorted by time received. The display handles 5+ simultaneous orders without layout breakage.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### KIT-05 — Kitchen Logout
**Severity:** Medium

**Preconditions:**
- Kitchen is logged in

**Steps:**
1. Click the logout icon in the TopBar
2. Confirm the logout modal (if present)
3. Verify redirect to the login page
4. Verify pending orders are unaffected (visible again upon re-login)

**Expected Result:**
> Logout ends the kitchen session. Pending orders remain in the system and reappear on the kitchen display upon the next login. No orders are lost or cancelled by the act of logging out.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 5. Customer QR UAT

**Role context:** No login required. Customers scan a table QR code on their personal mobile device to browse the menu and place orders. This flow is entirely browser-based on the customer's phone.

---

### QR-01 — QR Code Scan and Menu Load
**Severity:** Critical

**Preconditions:**
- QR codes printed or displayed for at least 2 tables
- Customer device: Android or iOS phone with camera
- Hotel Wi-Fi available for customer (or adequate mobile data signal)

**Steps:**
1. Using the customer phone camera, scan the QR code for Table 1
2. Observe whether the phone prompts to open a link or a browser
3. Tap the link / open in browser
4. Measure time from scan to menu visible (target: under 5 seconds on good signal)
5. Verify the correct table number appears on the page

**Expected Result:**
> The QR code resolves to the customer-facing menu page. The menu loads within 5 seconds on Wi-Fi. The correct table number is shown so the customer knows they are ordering for the right table. No login or account creation is required.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### QR-02 — Menu Browsing: Categories and Items
**Severity:** High

**Preconditions:**
- QR-01 complete; customer is on the menu page
- At least 3 categories with at least 2 items each are configured

**Steps:**
1. On the customer menu page, browse the category list
2. Tap a category to filter items
3. Verify item names, descriptions, and prices match the current menu
4. Check that unavailable or out-of-stock items are either hidden or clearly marked
5. Scroll to verify all items in a category load (no pagination errors)

**Expected Result:**
> All active menu categories and items are visible and accurately reflect the current product configuration. Prices are correct. Item descriptions are legible on a phone screen. No broken images appear (or placeholder is shown cleanly if image not set).

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### QR-03 — Add Items and Place Order
**Severity:** Critical

**Preconditions:**
- Customer is on the menu page (QR-02 complete)
- Kitchen display is visible on a separate device for verification

**Steps:**
1. Add 2-3 items to the cart with varying quantities
2. Review the cart: verify item names, quantities, and subtotal are correct
3. Tap **Place Order** (or equivalent)
4. Observe the confirmation response on the customer's screen
5. On the kitchen display, verify the order appears within 3 seconds

**Expected Result:**
> Order is submitted and a confirmation is shown on the customer's phone. The kitchen display receives the order in real time with correct item names, quantities, and table number. The order is linked to the correct session for that table.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### QR-04 — Order Total Accuracy: Tax Calculation
**Severity:** High

**Preconditions:**
- Customer has placed an order; order is visible in the system
- Tax rates are configured for the hotel (e.g., 5% GST split as 2.5% CGST + 2.5% SGST)

**Steps:**
1. After placing the order, view the order summary on the customer screen
2. Note the subtotal and tax shown
3. On the Cashier device, open the BillingDrawer for this table and guest
4. Compare the tax breakdown (CGST/SGST) with what the customer sees
5. Verify the grand total matches across both views

**Expected Result:**
> Tax calculation is consistent: the customer view and the cashier billing view show the same totals. Grand total = Subtotal + CGST + SGST. No rounding discrepancy greater than 0.01.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### QR-05 — Customer Device: No Mobile Data (Graceful Failure)
**Severity:** Medium

**Preconditions:**
- Customer phone has the menu page already loaded in the browser
- Disable Wi-Fi and mobile data on the customer phone after the page loads

**Steps:**
1. With the menu page already loaded, disable all network on the customer phone
2. Attempt to add items to the cart (may succeed from cached state)
3. Attempt to tap **Place Order**
4. Observe the error presented to the customer

**Expected Result:**
> The order submission fails gracefully. A user-readable error message is shown (e.g., "Network unavailable — please reconnect and try again"). No partial/corrupted order is created on the server. Re-enabling network and retrying successfully places the order.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 6. Printer UAT

**Role context:** Printer tests require a physical thermal receipt printer on the same network as the POS server. Run these tests with the Cashier or Owner role. Note the printer IP and model in the Pilot Information block.

---

### PRT-01 — Print Receipt: Printer Online
**Severity:** Critical

**Preconditions:**
- Thermal printer is powered on, loaded with paper, and connected to the network
- Printer IP is configured in Settings > Printers
- At least 1 guest has been billed (use CSH-03 or CSH-04 result)

**Steps:**
1. After a successful payment, observe the receipt view in the BillingDrawer
2. Wait for the printer status to resolve (the receipt view shows "Checking..." briefly)
3. Observe the printer status — it should show "Print Receipt" button (not "Queued")
4. Click **Print Receipt**
5. Observe the receipt printing on the physical printer

**Expected Result:**
> The printer status resolves to "ready" within 2 seconds. Clicking Print Receipt dispatches the job immediately. The physical printer outputs the receipt with: hotel name, table number, guest label, itemised orders, CGST/SGST split, grand total, payment method, and timestamp. No garbled characters appear.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PRT-02 — Print Receipt: Printer Offline at Billing Time
**Severity:** Critical

**Preconditions:**
- Printer is powered OFF or disconnected from the network before billing
- Active guest with orders ready to bill

**Steps:**
1. Power off or unplug the printer from the network
2. Bill a guest (Cash payment) via the BillingDrawer
3. In the receipt view, observe the printer status area
4. Note the amber banner and the button state

**Expected Result:**
> The receipt view shows an **amber banner**: "Printer offline — receipt queued. It will print automatically when the printer reconnects." The print button is replaced by a "Queued for printing" indicator. No error requiring user action is shown. The payment is processed successfully regardless of printer state.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PRT-03 — Printer Reconnects: Queue Drains Automatically
**Severity:** Critical

**Preconditions:**
- PRT-02 complete (at least 1 receipt job queued with printer offline)

**Steps:**
1. Power the printer back on and reconnect it to the network
2. Wait up to 60 seconds without any manual action
3. Observe the physical printer
4. If no automatic print occurs within 60 seconds, manually trigger a retry from the receipt view

**Expected Result:**
> The queued receipt prints automatically when the printer comes back online, without any staff intervention. If the automatic drain does not occur, tapping Retry in the receipt view successfully sends the job. No receipts are permanently lost.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PRT-04 — Receipt Content Accuracy
**Severity:** High

**Preconditions:**
- A receipt has been printed (PRT-01 or PRT-03 complete)
- The original order details are known

**Steps:**
1. Pick up the printed receipt
2. Verify: Hotel name at the top
3. Verify: Table number and guest label
4. Verify: Each ordered item listed with correct name, quantity, and line total
5. Verify: Subtotal, CGST (with rate %), SGST (with rate %), and Grand Total
6. Verify: Payment method
7. Verify: Date and time of billing (within 2 minutes of actual transaction)
8. Verify: No items from other tables appear

**Expected Result:**
> All fields are present and accurate. Tax lines show CGST and SGST separately with the applicable rate percentage. Grand total = Subtotal + CGST + SGST. Date and time are correct. Receipt is readable with no garbled or missing characters.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PRT-05 — Reprint Receipt
**Severity:** Medium

**Preconditions:**
- Printer is online
- A guest was billed at least 5 minutes ago (prior session)

**Steps:**
1. In the BillingDrawer (or receipt history if available), locate the completed guest's receipt view
2. Click **Print Receipt** or **Reprint**
3. Observe the physical printer

**Expected Result:**
> The reprint job is sent to the printer and the same receipt (with the original billing time, not the reprint time) is output. A "Sent to printer" confirmation appears in the UI.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PRT-06 — Multiple Queued Jobs
**Severity:** High

**Preconditions:**
- Printer is offline
- At least 3 guests can be billed in sequence

**Steps:**
1. With the printer offline, bill 3 guests across 2 different tables
2. Verify each billing shows the "Queued for printing" amber state
3. Power the printer back on
4. Observe the printer as it processes the queue
5. Verify 3 receipts are printed, one for each guest, in billing order

**Expected Result:**
> All 3 receipts print automatically in the order they were billed. No receipts are dropped. Receipts are distinct and attributed to the correct guests. Print queue is empty after all jobs complete.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 7. Network Failure UAT

**Role context:** These tests simulate real restaurant network conditions — router reboots, Wi-Fi drops, and intermittent connectivity. Run with Cashier and Waiter accounts on separate devices.

---

### NET-01 — Socket Disconnect Visual Indicator
**Severity:** High

**Preconditions:**
- Staff device logged in (Cashier or Owner)
- Stable network connection established (Live badge visible)

**Steps:**
1. Confirm the green **Live** badge is visible in the TopBar
2. Disconnect the device from the network (disable Wi-Fi or unplug network cable)
3. Observe the badge within 5-10 seconds
4. Note the label and colour that appears
5. Reconnect the network
6. Observe the badge return to Live

**Expected Result:**
> The badge transitions from **Live** (green) to **Reconnecting** (yellow/amber, animated pulse) to **Offline** (grey) as the connection state changes. Upon reconnect, the badge returns to **Live** (green) automatically without a page refresh.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### NET-02 — Loss of Network During Order Entry
**Severity:** Critical

**Preconditions:**
- Waiter is mid-order (items selected, order not yet submitted)
- Network is about to be interrupted

**Steps:**
1. Open an order form with 2 items selected but the order NOT yet submitted
2. Disconnect the network on the waiter device
3. Attempt to submit / confirm the order
4. Observe the error response
5. Reconnect the network
6. Attempt to submit the same order again

**Expected Result:**
> Order submission fails with a user-readable error (e.g., "Network unavailable — please retry"). The partially entered order data is preserved so the waiter does not lose their selections. After reconnection, re-submitting the same order succeeds and the kitchen receives it.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### NET-03 — Loss of Network During Payment
**Severity:** Critical

**Preconditions:**
- Cashier has a guest selected and payment method chosen; the Confirm Payment button is enabled
- Network is about to be interrupted

**Steps:**
1. Position at the payment confirmation step with all fields valid
2. Disconnect the network on the cashier device
3. Click **Confirm Payment**
4. Observe the error response (the payment API call will fail)
5. Reconnect the network
6. Verify the guest is still in Active status (not partially billed)
7. Retry the payment

**Expected Result:**
> The payment fails gracefully with an error message visible in the BillingDrawer. The guest remains in Active status — no partial billed/unbilled state is created. After reconnection, the payment can be retried and succeeds. No duplicate billing occurs.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### NET-04 — Socket Reconnect: Live Events Resume
**Severity:** High

**Preconditions:**
- Two devices logged in (Waiter on device A, Kitchen display on device B)
- Network has been disconnected and reconnected (continue from NET-01)

**Steps:**
1. After reconnecting the network, confirm the Live badge is green on both devices
2. Place a new order from the Waiter device
3. Observe the Kitchen display on device B

**Expected Result:**
> Real-time order delivery resumes immediately after reconnection. The new order appears on the kitchen display within 3 seconds. No stale or duplicate orders from the disconnection period appear.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### NET-05 — Data Consistency After Reconnect
**Severity:** Critical

**Preconditions:**
- A session was active during the network disruption
- Orders were placed just before and just after the disruption

**Steps:**
1. After the network has fully reconnected, open the BillingDrawer for the session active during the disruption
2. Verify all orders placed before the disruption are present
3. Verify any orders placed during the disruption (that succeeded on retry) are also present
4. Verify no duplicate order entries exist
5. Verify guest totals are correct

**Expected Result:**
> Session data is fully consistent after reconnection. No orders are missing; no orders are duplicated. Guest totals reflect exactly what was ordered. The session can proceed to billing without discrepancies.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### NET-06 — Mobile App Offline Order Queue (if mobile ordering enabled)
**Severity:** High

**Preconditions:**
- Mobile POS app installed and logged in (mobile offline ordering feature)
- Network disconnected on the mobile device

**Steps:**
1. Disconnect the mobile device from all networks
2. Add items to a cart in the mobile app
3. Submit the order — observe it enter the offline queue
4. Reconnect the network
5. Observe the offline queue drain automatically

**Expected Result:**
> Orders queued while offline are stored locally and sent to the server when connectivity is restored. The kitchen display receives the orders upon sync. No duplicate orders are created. The sync is automatic without staff action.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 8. Power Failure UAT

**Role context:** These tests simulate sudden power loss to the server, the client devices, or both. They validate that no data is lost and service can resume after an unexpected shutdown. Coordinate with a technician who can safely restart the server.

> **Safety note:** Do not run these tests during active service. Schedule during off-hours or on a staging server with mirrored production data.

---

### PWR-01 — Client Browser Refresh: Session State Preserved
**Severity:** Critical

**Preconditions:**
- Active session with guests and placed orders visible in the BillingDrawer
- No payment has been initiated

**Steps:**
1. With the BillingDrawer open showing an active session, press **F5** or perform a hard browser refresh (Ctrl+Shift+R)
2. After the page reloads, navigate back to the Dashboard
3. Click the same occupied table
4. Verify the BillingDrawer shows the same guests and orders as before the refresh

**Expected Result:**
> All session data, guests, and orders are preserved through a browser refresh. The server holds the state; the client reloads cleanly. No data is lost. No duplicate sessions are created.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PWR-02 — Server Restart: Open Sessions Preserved
**Severity:** Critical

**Preconditions:**
- At least 2 active sessions with guests and orders in the database
- Access to the server to perform a controlled restart (systemctl restart, PM2 restart, or equivalent)
- All current session data noted (table numbers, guest names, order totals)

**Steps:**
1. Record the state of all open sessions (table, guest count, approximate total)
2. Restart the backend server process (not the database — just the application server)
3. Wait for the server to come back online (check health endpoint or login page)
4. Log in as Owner
5. Navigate to the Dashboard
6. Verify occupied tables are still shown as occupied
7. Open BillingDrawer for each previously active table
8. Verify all guests and orders are intact

**Expected Result:**
> All open sessions, guests, and orders are fully restored from the database after the server restart. No sessions are lost or corrupted. Occupied tables remain occupied. Order totals match pre-restart values exactly.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PWR-03 — Server Restart: In-Progress Orders Preserved
**Severity:** Critical

**Preconditions:**
- An order was placed and visible on the kitchen display before the server restart
- Server has been restarted (continue from PWR-02)

**Steps:**
1. After the server restarts, log in as Kitchen on the kitchen device
2. Verify pending orders are still displayed on the kitchen screen
3. Compare the order list with the pre-restart state

**Expected Result:**
> All orders that were pending (not yet prepared) before the restart reappear on the kitchen display after the server comes back online. No orders are silently dropped. Kitchen staff can continue serving without re-entering lost orders.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PWR-04 — Client Reconnects After Server Restart
**Severity:** High

**Preconditions:**
- A client device (Cashier or Waiter) had an open browser session during the server restart
- Server is now back online

**Steps:**
1. On the client that was open during the restart, observe the TopBar badge (should show Offline or Reconnecting)
2. Without refreshing the page, wait up to 60 seconds for automatic reconnection
3. Observe whether the Live badge returns to green
4. If it does not reconnect automatically within 60 seconds, manually refresh the page
5. Verify the session and workflow continue normally after reconnect / refresh

**Expected Result:**
> The client attempts automatic reconnection. After the server is available, the Live badge returns to green (or after a manual refresh). The staff member can continue their workflow without losing data.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PWR-05 — Payment Not Double-Billed After Server Restart
**Severity:** Critical

**Preconditions:**
- A payment was being processed (Confirm Payment clicked) at the exact moment the server lost power
- Server has been restarted and is back online

**Steps:**
1. Log in as Cashier after the server restart
2. Navigate to the table and guest that was being billed during the outage
3. Check the guest status: Active, Billed, or unknown

**Scenario A — Guest shows as Billed:**
4. Verify the payment record exists in the database
5. Verify no duplicate payment record exists
6. Proceed without re-billing

**Scenario B — Guest shows as Active:**
4. Retry the payment
5. Verify billing completes successfully and only 1 payment record is created

**Expected Result:**
> The system is in a consistent state: the guest is either clearly Billed (with one payment record) or clearly Active (safe to re-bill). No zombie state exists where the guest appears billed but no record exists, or unbilled but a payment record was already created.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 9. Database Recovery UAT

**Role context:** These tests verify data integrity following a database backup and restore operation. Run only when a full database backup is available. Coordinate with the system administrator. These tests are typically run once at the start of the pilot and once before go-live.

> **Safety note:** Perform DB recovery tests on a staging environment using a copy of production data. Never restore over live production data during an active service period.

---

### DB-01 — Session and Guest Data Integrity Post-Restore
**Severity:** Critical

**Preconditions:**
- A database backup taken at a known point in time (T0)
- At least 5 sessions with guests and orders existed at T0
- Database has been restored from the T0 backup on a staging server

**Steps:**
1. Log in to the staging environment as Owner
2. Navigate to the Dashboard
3. Verify the occupied/available table states match the T0 snapshot
4. Open BillingDrawer for 3 previously active sessions
5. Verify guest names, order items, and totals match the T0 reference data
6. Check for any sessions that show guests but have null/empty order arrays

**Expected Result:**
> All sessions present at T0 are intact after restore. Guest records, order references, and billing states are accurate. No sessions have orphaned guests. No guests have missing order references. Data matches the pre-backup record exactly.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### DB-02 — Revenue Report Figures Match Pre-Backup Totals
**Severity:** Critical

**Preconditions:**
- Daily revenue report totals recorded before the backup was taken (T0 figures)
- DB-01 complete (staging environment restored)

**Steps:**
1. Log in as Owner on the staging environment
2. Navigate to Reports > Daily for the date of the T0 backup
3. Compare Total Revenue, Order Count, and Tax totals against the T0 reference figures
4. Repeat for the 3 days preceding T0

**Expected Result:**
> Report figures on the restored database match the T0 reference values exactly. No revenue is missing; no transactions are duplicated in the report. Tax totals are consistent.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### DB-03 — Loyalty Points Audit Trail
**Severity:** High

**Preconditions:**
- At least 3 customers enrolled in the loyalty programme with earned points
- Points balances recorded before the backup (T0 figures)
- DB-01 complete

**Steps:**
1. Log in as Owner and navigate to Customers
2. Select each of the 3 loyalty customers
3. Compare their current point balance on the restored DB against the T0 reference
4. Verify earning and redemption history is intact for each customer

**Expected Result:**
> Loyalty point balances match T0 figures exactly. Transaction history (earn/redeem events) is complete. No points have been silently erased or duplicated. Customers can earn and redeem points normally after the restore.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### DB-04 — Staff Records and Credentials Post-Restore
**Severity:** High

**Preconditions:**
- Staff records existed at T0 with known PINs and active/inactive states
- DB-01 complete

**Steps:**
1. Log in as Owner and navigate to Settings > Staff
2. Verify all staff records present at T0 are still present
3. Verify active/inactive states match the T0 snapshot
4. On a test device, log in with one Waiter PIN and one Cashier PIN
5. Verify login succeeds for active staff

**Expected Result:**
> All staff records are intact. Active/inactive status is preserved. Staff PINs continue to work. Any staff deactivated before T0 are still inactive on the restored database. No accounts have been unintentionally re-activated.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 10. Performance UAT

**Role context:** Performance tests measure system behaviour under realistic restaurant load. Run during a simulated busy lunch or dinner service using multiple devices and real staff. Establish baseline times before the pilot and compare at the end of the first week.

---

### PERF-01 — Dashboard Cold Load Time
**Severity:** High

**Preconditions:**
- 10 tables configured; at least 5 are occupied with active sessions
- Staff device has a cleared browser cache (Ctrl+Shift+Delete, clear cache and cookies)
- Reliable network connection (Wi-Fi, not mobile data)

**Steps:**
1. Clear the browser cache on the test device
2. Start a stopwatch
3. Navigate to `app.dinepos.com` and log in as Owner
4. Stop the stopwatch when the Dashboard is fully visible (table grid loaded, no spinners)
5. Record the time
6. Repeat 3 times and note the average

**Expected Result:**
> Dashboard cold load (including login) completes in under **4 seconds** on a local Wi-Fi network. Repeat loads (warm cache) complete in under **2 seconds**. No spinner persists beyond 5 seconds. No JavaScript errors appear in the browser console.

**Observed times:** T1: ____s  T2: ____s  T3: ____s  Average: ____s  
**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PERF-02 — BillingDrawer Open Response Time
**Severity:** High

**Preconditions:**
- Occupied table with 3 guests and at least 5 orders each (simulate a real table mid-service)
- Cashier is logged in

**Steps:**
1. Start a stopwatch
2. Click an Occupied table card
3. Stop the stopwatch when the BillingDrawer is fully open and all guest cards are visible
4. Record the time
5. Repeat on 3 different tables (varying guest/order counts)

**Expected Result:**
> BillingDrawer opens and populates within **2 seconds** for a typical table (3 guests, 5 orders each). Tables with more than 10 orders per guest load within **3 seconds**. No partial rendering where some guest cards appear before others.

**Observed times:** Table A: ____s  Table B: ____s  Table C: ____s  
**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PERF-03 — Concurrent Sessions: System Stability Under Load
**Severity:** Critical

**Preconditions:**
- 3 separate devices (Waiter, Cashier, Kitchen) all logged in simultaneously
- At least 8 tables occupied or to be opened during the test

**Steps:**
1. Have the Waiter open 3 new sessions and place orders on each simultaneously
2. Have the Cashier open the BillingDrawer on 2 occupied tables and process payments
3. Have the Kitchen display receive and display all incoming orders
4. All three roles perform their tasks concurrently for 10 minutes
5. After 10 minutes, verify: all orders are recorded, all payments completed, kitchen display shows accurate state
6. Check the browser console on each device for JavaScript errors

**Expected Result:**
> The system handles all 3 roles working concurrently without degradation. No requests time out. No data is lost across sessions. The kitchen display continues to receive real-time events. No JavaScript errors occur during the test period. Page load and action response times remain within PERF-01 and PERF-02 targets.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PERF-04 — High Order Volume in 30 Minutes
**Severity:** High

**Preconditions:**
- Simulated busy service: 8 tables, 2 waiters placing orders, 1 cashier billing

**Steps:**
1. Over a 30-minute period, simulate full lunch service:
   - Open sessions for all 8 tables
   - Place 4-6 orders per table
   - Bill at least 4 tables during the window
2. At the end of 30 minutes, run the Daily Report
3. Verify order count, revenue, and item counts in the report match what was ordered

**Expected Result:**
> The system processes approximately 50+ orders and 4+ billing events in 30 minutes without errors, slowdowns, or data loss. The Daily Report accurately reflects all transactions. No duplicate orders appear. Response times remain within acceptable targets throughout.

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________

---

### PERF-05 — Real-Time Event Latency Under Load
**Severity:** High

**Preconditions:**
- PERF-03 or PERF-04 in progress (system under concurrent load)
- Kitchen display and a Waiter device both connected

**Steps:**
1. While the system is under load (multiple sessions, active billing), place a new order from the Waiter device
2. Measure the time between order submission and the order appearing on the kitchen display
3. Repeat 5 times during the busy period
4. Record each latency

**Expected Result:**
> Real-time order events are delivered to the kitchen display in under **3 seconds** even under full service load. No events are dropped or delayed by more than 5 seconds. The Live badge remains green throughout (no socket disconnections under normal load).

**Observed latencies:** T1: ____s  T2: ____s  T3: ____s  T4: ____s  T5: ____s  
**Result:** [ ] Pass  [ ] Fail  [ ] Blocked  [ ] N/A  
**Notes:** _______________________________________________


---

## 11. Pilot Observation Sheet

**Purpose:** Completed by an observer (Operations Consultant or QA Lead) during a live service shift. One sheet per shift. Attach to the Daily Bug Log at end of day.

---

**Observer Name:** ___________________________  
**Date:** ___________________________  
**Shift:** [ ] Breakfast  [ ] Lunch  [ ] Dinner  [ ] Full Day  
**Service Start Time:** ___________  **Service End Time:** ___________  
**Tables in Service:** _________  **Peak Concurrent Tables:** _________  
**Staff On Shift:** Owner/Manager: ___  Cashier: ___  Waiter: ___  Kitchen: ___

---

### Observation Log

Record each observation as it happens. Use the Type codes below.

**Type Codes:**
- **BUG** — System behaved incorrectly; a defect
- **UX** — Usability issue; staff confused or slowed by the interface
- **PERF** — Slowness, lag, or timeout
- **NET** — Network or connectivity related
- **PRT** — Printer issue
- **OPS** — Operational / process issue (not a system defect)
- **SUGG** — Staff suggestion or feature request

| # | Time | Type | Role Affected | Description | Severity |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |
| 12 | | | | | |

*(Add rows as needed)*

---

### Shift Summary

**Total observations recorded:** _______  
**Bugs found:** _______  **UX issues:** _______  **Suggestions:** _______

**Highest-severity incident this shift:**
```
Time: ____________
Description:


Impact on service:


Resolution / workaround used:

```

**Staff sentiment at end of shift:**  
[ ] Very positive — system helped the team  
[ ] Positive — minor friction but manageable  
[ ] Neutral — no strong reaction either way  
[ ] Negative — system caused slowdowns  
[ ] Very negative — significant service impact

**Observer comments:**
```




```

**Sign-off:** ___________________________  **Date:** ___________


---

## 12. Daily Bug Log

**Purpose:** Log every defect found during UAT execution or live pilot observation. One log per day. Each entry must be cross-referenced to the UAT test case that exposed it (if applicable).

---

**Restaurant:** ___________________________  
**Log Date:** ___________________________  
**Logged by:** ___________________________  
**Environment:** [ ] Staging  [ ] Pilot Production  
**App Version:** Pilot UX Patch v1.0.1 (commit d7c52ce)

---

### Bug Entry Template

Copy and fill in one block per defect.

---

**BUG-[DATE]-[###]**  
*(e.g., BUG-20260718-001)*

| Field | Value |
|---|---|
| **Date / Time** | |
| **Reporter** | |
| **Reporter Role** | [ ] Owner  [ ] Manager  [ ] Cashier  [ ] Waiter  [ ] Kitchen  [ ] QA |
| **UAT Test Case** | (e.g., CSH-06) or "Live service — unscripted" |
| **Severity** | [ ] Critical  [ ] High  [ ] Medium  [ ] Low |
| **Status** | [ ] New  [ ] In Review  [ ] Fix Confirmed  [ ] Closed  [ ] Won't Fix |
| **Device / Browser** | |
| **Network Condition** | |

**Title (one line):**
```
[Short title describing what went wrong]
```

**Steps to Reproduce:**
```
1. 
2. 
3. 
```

**Expected Result:**
```
[What should have happened]
```

**Actual Result:**
```
[What actually happened]
```

**Screenshot / Error Message (paste or attach):**
```
[Paste error text here, or write "Screenshot attached: filename.png"]
```

**Workaround available?**
[ ] Yes: ___________________________ [ ] No

**Impact on service:**
[ ] Blocked service completely  
[ ] Caused significant delay (>5 min per occurrence)  
[ ] Minor inconvenience  
[ ] Cosmetic only

**Resolution notes (filled in by developer):**
```
[Fix description and commit hash when resolved]
```

---

### Daily Summary Table

| Bug ID | Title | Severity | Status |
|---|---|---|---|
| BUG- | | | |
| BUG- | | | |
| BUG- | | | |
| BUG- | | | |
| BUG- | | | |

**Total new bugs today:** _______  
**Bugs resolved today:** _______  
**Outstanding Critical bugs:** _______

---

### Severity Escalation Protocol

| Severity | Action Required |
|---|---|
| **Critical** | Immediately notify the technical lead. Do not continue live service until resolved or a confirmed workaround is in place. Document all affected transactions manually. |
| **High** | Notify the technical lead by end of shift. Document any affected transactions. Shift can continue if a workaround exists. |
| **Medium** | Log in the daily bug log. Review with the team at the next morning stand-up. |
| **Low** | Log and review at the end of the pilot week. |


---

## 13. Feature Request Log

**Purpose:** Capture staff and management suggestions without acting on them during the pilot. All entries are deferred for post-pilot review. The application is **feature frozen** during the pilot period — this log is the holding area only.

---

**Restaurant:** ___________________________  
**Log maintained by:** ___________________________  
**Pilot Period:** ___________________________ to ___________________________

---

### Feature Request Entry Template

---

**FR-[DATE]-[###]**

| Field | Value |
|---|---|
| **Date** | |
| **Requested by** | |
| **Requester Role** | [ ] Owner  [ ] Manager  [ ] Cashier  [ ] Waiter  [ ] Kitchen  [ ] Customer |
| **Category** | [ ] Billing  [ ] Orders  [ ] Reporting  [ ] Printing  [ ] Staff Mgmt  [ ] Menu  [ ] Loyalty  [ ] Other |
| **Priority Vote** | [ ] Nice to have  [ ] Would significantly improve workflow  [ ] Cannot go live without this |

**Request Title (one line):**
```
[Short title]
```

**Description:**
```
[What the staff member wants the system to do, in their own words]
```

**Business Justification:**
```
[Why this matters: time saved, errors prevented, guest experience improved, etc.]
```

**How it works today (workaround, if any):**
```
[Current process without this feature]
```

**Estimated frequency of need:**
[ ] Multiple times per service  [ ] Once per service  [ ] Weekly  [ ] Rarely

**Status:** [ ] Logged  [ ] Under consideration  [ ] Approved for backlog  [ ] Declined (reason: _______________)

---

### Feature Request Summary Table

| FR ID | Title | Requester Role | Priority | Status |
|---|---|---|---|---|
| FR- | | | | |
| FR- | | | | |
| FR- | | | | |
| FR- | | | | |
| FR- | | | | |
| FR- | | | | |
| FR- | | | | |
| FR- | | | | |

---

### Review Guidelines (Post-Pilot)

The following criteria govern which requests proceed to the product backlog after the pilot ends:

1. **Requested by 2+ staff members independently** — strong signal of real need
2. **Directly impacts revenue, speed of service, or error rate** — prioritise operational impact
3. **Consistent with the established role model** (Owner / Manager / Cashier / Waiter / Kitchen) — no new role types without architecture review
4. **Does not require backend redesign or schema changes** without explicit technical approval
5. **Does not duplicate existing functionality** accessible via a different workflow

Requests that do not meet criteria 1 or 2 are filed for future product roadmap discussion and are not committed to the backlog automatically.


---

## 14. Restaurant Feedback Form

**Purpose:** Completed by the Restaurant Owner or Manager at the end of the pilot period (minimum 5 days of live use). This is the primary signal for go/no-go decision for full deployment.

---

**Restaurant Name:** ___________________________  
**Owner / Manager Name:** ___________________________  
**Pilot Period:** ___________________________ to ___________________________  
**Number of Service Days Using the System:** _______  
**Average Covers Per Day:** _______  
**Average Tables Turned Per Shift:** _______

---

### Section A: Overall System Impressions

*Rate each item from 1 (very poor) to 5 (excellent).*

| Area | 1 | 2 | 3 | 4 | 5 | Comments |
|---|---|---|---|---|---|---|
| Overall ease of use | | | | | | |
| Speed during service | | | | | | |
| Reliability (uptime, no crashes) | | | | | | |
| Accuracy of billing | | | | | | |
| Printer reliability | | | | | | |
| Real-time kitchen notifications | | | | | | |
| Reports and daily summary | | | | | | |
| Staff training time required | | | | | | |
| Customer QR ordering experience | | | | | | |
| Overall confidence in the system | | | | | | |

---

### Section B: Role-Specific Feedback

**Cashier staff feedback:**
```
[How did cashiers find the billing and payment flow?]


```

**Waiter staff feedback:**
```
[How did waiters find the session opening and order placement flow?]


```

**Kitchen staff feedback:**
```
[How did kitchen staff find the order display and real-time notifications?]


```

**Management feedback:**
```
[Were the reports useful? Was the staff management workflow adequate?]


```

---

### Section C: Critical Incidents

**Did any system issue directly impact a guest experience during the pilot?**  
[ ] No [ ] Yes — describe:
```




```

**Did any system issue result in a billing error or revenue discrepancy?**  
[ ] No [ ] Yes — describe:
```




```

**Were there any situations where staff had to revert to a manual (paper) process?**  
[ ] No [ ] Yes — describe:
```




```

---

### Section D: Specific Workflow Ratings

*How well does the system support each workflow?*  
*(1 = does not support  5 = fully supports)*

| Workflow | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Seating guests quickly at a new table | | | | | |
| Splitting a bill between guests | | | | | |
| Handling a complimentary or void | | | | | |
| Billing a guest who wants to leave early | | | | | |
| Closing an entire table at end of the meal | | | | | |
| Handling a printer going offline mid-service | | | | | |
| Recovering from a browser refresh or crash | | | | | |
| Training a new staff member on the system | | | | | |
| Reviewing yesterday's revenue over morning coffee | | | | | |

---

### Section E: Pilot Go/No-Go Assessment

**Would you recommend deploying this system to your full restaurant operation?**

[ ] **Yes, immediately** — system is production-ready as-is  
[ ] **Yes, with minor fixes** — list the fixes required below  
[ ] **Yes, after a second pilot** — the following must be resolved first  
[ ] **Not at this time** — significant issues remain

**Required fixes or conditions before approval:**
```
1. 
2. 
3. 
```

---

### Section F: Open Feedback

**What did your team like most about the system?**
```




```

**What was the biggest pain point during the pilot?**
```




```

**What one change would have the highest impact on your daily service?**
```



```

**Any other comments for the development team?**
```




```

---

**Signature:** ___________________________  
**Date:** ___________________________  
**Position:** [ ] Owner  [ ] Manager  [ ] Operations Manager

---

*Thank you for participating in the Dine POS pilot programme. Your feedback directly shapes the product roadmap.*

---

*End of UAT Execution Plan — Dine POS Pilot UX Patch v1.0.1*  
*Document version 1.0 · Generated 2026-07-17*

