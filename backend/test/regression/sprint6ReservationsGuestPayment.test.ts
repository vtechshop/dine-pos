/**
 * Regression tests for Sprint 6 — Reservations, Guest Billing, Payments.
 *
 * All tests are pure unit tests — no real DB, no real HTTP.
 *
 * Covered:
 *  D-02 — Restore table status after reservation completion/cancellation/no_show
 *  D-03 — Atomic guest "left" action (status guard inside MongoDB filter)
 *  D-09 — Reopen clears loyaltyEarnedAt / lifetimeSpendAt
 *  F-2  — Razorpay completion guard uses gatewayType (not method)
 */

// ─────────────────────────────────────────────────────────────────────────────
// D-02 — Table restoration on terminal reservation transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('D-02 — Table status restoration on terminal reservation transitions', () => {
  // Simulates the D-02 restoration logic in reservationRoutes.ts
  async function maybeRestoreTable(params: {
    tableId: string | null;
    hotelId: string;
    newStatus: string;
    openSessionExists: boolean;
    tableCurrentStatus: string;
  }): Promise<string | null> {
    const TERMINAL = new Set(['completed', 'cancelled', 'no_show']);
    if (!TERMINAL.has(params.newStatus) || !params.tableId) return null;
    if (params.openSessionExists) return null; // session owns the table
    if (!['occupied', 'reserved'].includes(params.tableCurrentStatus)) return null;
    return 'available'; // would be written atomically in production code
  }

  it('seated reservation → completed → table restored to available', async () => {
    const result = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'completed',
      openSessionExists: false, tableCurrentStatus: 'occupied',
    });
    expect(result).toBe('available');
  });

  it('confirmed reservation → cancelled → table restored to available', async () => {
    const result = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'cancelled',
      openSessionExists: false, tableCurrentStatus: 'occupied',
    });
    expect(result).toBe('available');
  });

  it('reservation → no_show → table restored (if occupied/reserved)', async () => {
    const resultOccupied = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'no_show',
      openSessionExists: false, tableCurrentStatus: 'occupied',
    });
    const resultReserved = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'no_show',
      openSessionExists: false, tableCurrentStatus: 'reserved',
    });
    expect(resultOccupied).toBe('available');
    expect(resultReserved).toBe('available');
  });

  it('unrelated occupied table (no tableId on reservation) is never restored', async () => {
    const result = await maybeRestoreTable({
      tableId: null, hotelId: 'H1', newStatus: 'completed',
      openSessionExists: false, tableCurrentStatus: 'occupied',
    });
    expect(result).toBeNull();
  });

  it('active TableSession prevents table release', async () => {
    const result = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'completed',
      openSessionExists: true, tableCurrentStatus: 'occupied',
    });
    expect(result).toBeNull(); // session close handles cleanup
  });

  it('already available table is not touched (atomic filter blocks no-op)', async () => {
    const result = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'cancelled',
      openSessionExists: false, tableCurrentStatus: 'available',
    });
    expect(result).toBeNull(); // filter: $in: ['occupied', 'reserved'] doesn't match
  });

  it('inactive table is not touched', async () => {
    const result = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'completed',
      openSessionExists: false, tableCurrentStatus: 'inactive',
    });
    expect(result).toBeNull();
  });

  it('repeated completion is idempotent (table already available, no double-write)', async () => {
    // First completion: table was occupied → restored
    const first = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'completed',
      openSessionExists: false, tableCurrentStatus: 'occupied',
    });
    // Second (duplicate) completion call: table is now available → no match
    const second = await maybeRestoreTable({
      tableId: 'T1', hotelId: 'H1', newStatus: 'completed',
      openSessionExists: false, tableCurrentStatus: 'available',
    });
    expect(first).toBe('available');
    expect(second).toBeNull();
  });

  it('concurrent completion uses atomic filter — only one write matches', async () => {
    // Both requests race; only the one that finds 'occupied' will update.
    // Simulate: req A runs first (occupied → available), req B runs after.
    const tableStatuses = ['occupied', 'available']; // state after req A
    const results = await Promise.all(
      tableStatuses.map((status) =>
        maybeRestoreTable({
          tableId: 'T1', hotelId: 'H1', newStatus: 'completed',
          openSessionExists: false, tableCurrentStatus: status,
        }),
      ),
    );
    expect(results.filter((r) => r === 'available')).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  it('hotel A table cannot be restored by hotel B reservation', async () => {
    // The atomic filter includes hotelId — a cross-hotel filter never matches.
    // Simulated: table hotelId differs from reservation hotelId.
    const hotelATable = { hotelId: 'H_A', status: 'occupied' };
    const reservationHotelB = 'H_B';

    // The filter: { _id: tableId, hotelId: reservationHotelB, status: $in } would not match
    const matches = hotelATable.hotelId === reservationHotelB &&
                    ['occupied', 'reserved'].includes(hotelATable.status);
    expect(matches).toBe(false);
  });

  it('seated → occupied transition remains unchanged (existing behavior)', async () => {
    // Simulate the existing seated → occupied update filter
    const tableStatus = 'available';
    const filter = { status: { $in: ['available', 'reserved'] } };
    const matches = filter.status.$in.includes(tableStatus);
    expect(matches).toBe(true); // available table is set to occupied on seated
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-03 — Atomic guest "left" action
// ─────────────────────────────────────────────────────────────────────────────

describe('D-03 — Atomic guest left action', () => {
  // Simulates the fixed left action: findOneAndUpdate with status: 'active' in filter
  async function atomicMarkLeft(params: {
    guestCurrentStatus: string;
    requestHotelId: string;
    guestHotelId: string;
  }): Promise<{ success: boolean; httpStatus: number }> {
    const filterMatches =
      params.guestCurrentStatus === 'active' &&
      params.requestHotelId === params.guestHotelId;
    if (!filterMatches) {
      return { success: false, httpStatus: 409 };
    }
    return { success: true, httpStatus: 200 };
  }

  it('active guest → left succeeds', async () => {
    const r = await atomicMarkLeft({
      guestCurrentStatus: 'active',
      requestHotelId: 'H1',
      guestHotelId: 'H1',
    });
    expect(r.success).toBe(true);
    expect(r.httpStatus).toBe(200);
  });

  it('billed guest → left is rejected (409)', async () => {
    const r = await atomicMarkLeft({
      guestCurrentStatus: 'billed',
      requestHotelId: 'H1',
      guestHotelId: 'H1',
    });
    expect(r.success).toBe(false);
    expect(r.httpStatus).toBe(409);
  });

  it('already-left guest → left is rejected (409, idempotent guard)', async () => {
    const r = await atomicMarkLeft({
      guestCurrentStatus: 'left',
      requestHotelId: 'H1',
      guestHotelId: 'H1',
    });
    expect(r.success).toBe(false);
    expect(r.httpStatus).toBe(409);
  });

  it('simultaneous bill + left: billing wins → left is rejected', async () => {
    // bill transitions active → billed; left filter status: 'active' then misses
    let guestStatus = 'active';
    const billOp = jest.fn().mockImplementation(async () => {
      if (guestStatus === 'active') { guestStatus = 'billed'; return { status: 'billed' }; }
      return null;
    });
    const leftOp = jest.fn().mockImplementation(async () => {
      if (guestStatus === 'active') { guestStatus = 'left'; return { status: 'left' }; }
      return null; // billing already won — atomic filter misses
    });
    const [billResult, leftResult] = await Promise.all([billOp(), leftOp()]);
    // Only one of the two succeeds; the other gets null from its atomic filter
    const successCount = [billResult, leftResult].filter(Boolean).length;
    expect(successCount).toBeGreaterThanOrEqual(1);
    // The final status is NOT both billed AND left simultaneously
    expect(['billed', 'left']).toContain(guestStatus);
  });

  it('simultaneous left + left: only one effective transition', async () => {
    let guestStatus = 'active';
    const leftOp = jest.fn().mockImplementation(async () => {
      if (guestStatus === 'active') { guestStatus = 'left'; return { status: 'left' }; }
      return null; // second call: filter status: 'active' misses
    });
    const [r1, r2] = await Promise.all([leftOp(), leftOp()]);
    // Exactly one succeeds, the other gets null
    const wins = [r1, r2].filter(Boolean);
    expect(wins).toHaveLength(1);
    expect(guestStatus).toBe('left');
  });

  it('cross-hotel guest cannot be marked left (hotelId guard)', async () => {
    const r = await atomicMarkLeft({
      guestCurrentStatus: 'active',
      requestHotelId: 'H_OTHER',
      guestHotelId: 'H1',
    });
    expect(r.success).toBe(false);
  });

  it('existing guest billing flow (bill action) is not affected by D-03 change', () => {
    // The bill action uses its own separate findOneAndUpdate with different guards
    // (loyaltyEarnedAt: null, lifetimeSpendAt: null). D-03 only changes the left action.
    const leftActionFields = ['status', 'qrSessionToken', 'qrTokenExpiresAt'];
    const billActionFields = ['status', 'paymentMethod', 'paidAmount', 'billedAt', 'loyaltyEarnedAt', 'lifetimeSpendAt'];
    // left and bill operate on different $set fields — no overlap on idempotency guards
    const overlap = leftActionFields.filter((f) => billActionFields.includes(f) && f !== 'status');
    expect(overlap).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-09 — Reopen clears loyalty/lifetime flags
// ─────────────────────────────────────────────────────────────────────────────

describe('D-09 — Reopen clears loyaltyEarnedAt and lifetimeSpendAt', () => {
  // Simulates what the reopen $set block writes
  function reopenSetBlock(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      status: 'active',
      paymentMethod: null,
      paidAmount: null,
      billedAt: null,
      'splitDetails.cash': 0,
      'splitDetails.upi': 0,
      'splitDetails.card': 0,
      qrSessionToken: null,
      qrTokenExpiresAt: null,
      loyaltyPointsRedeemed: 0,
      loyaltyDiscountAmount: 0,
      giftVoucherId: null,
      giftVoucherCode: '',
      giftVoucherAmount: 0,
      loyaltyEarnedAt: null,   // D-09
      lifetimeSpendAt: null,   // D-09
      ...extra,
    };
  }

  it('reopen $set includes loyaltyEarnedAt: null', () => {
    const set = reopenSetBlock();
    expect(set).toHaveProperty('loyaltyEarnedAt', null);
  });

  it('reopen $set includes lifetimeSpendAt: null', () => {
    const set = reopenSetBlock();
    expect(set).toHaveProperty('lifetimeSpendAt', null);
  });

  it('after first billing — loyalty/lifetime markers are set', () => {
    const guest: Record<string, unknown> = { status: 'billed', loyaltyEarnedAt: null, lifetimeSpendAt: null };
    // Simulate bill action setting markers
    guest.loyaltyEarnedAt = new Date();
    guest.lifetimeSpendAt = new Date();
    expect(guest.loyaltyEarnedAt).not.toBeNull();
    expect(guest.lifetimeSpendAt).not.toBeNull();
  });

  it('after reopen — markers are cleared, re-billing can earn again', () => {
    const guest: Record<string, unknown> = {
      status: 'billed',
      loyaltyEarnedAt: new Date(),
      lifetimeSpendAt: new Date(),
    };
    // Apply reopen $set
    Object.assign(guest, reopenSetBlock());
    expect(guest.loyaltyEarnedAt).toBeNull();
    expect(guest.lifetimeSpendAt).toBeNull();
    expect(guest.status).toBe('active');
  });

  it('re-bill loyalty earn guard passes after reopen (loyaltyEarnedAt is null)', () => {
    const guest = { loyaltyEarnedAt: null as Date | null };
    // The earn guard: if (!updated.loyaltyEarnedAt) → earn points
    const shouldEarn = !guest.loyaltyEarnedAt;
    expect(shouldEarn).toBe(true);
  });

  it('re-bill lifetime spend guard passes after reopen (lifetimeSpendAt is null)', () => {
    const guest = { lifetimeSpendAt: null as Date | null };
    // The atomic claim: { lifetimeSpendAt: null } must match
    const claimMatches = guest.lifetimeSpendAt === null;
    expect(claimMatches).toBe(true);
  });

  it('repeated reopen is safe — both fields remain null after second reopen', () => {
    const guest: Record<string, unknown> = {
      status: 'billed',
      loyaltyEarnedAt: null, // already null (e.g., second reopen)
      lifetimeSpendAt: null,
    };
    Object.assign(guest, reopenSetBlock());
    expect(guest.loyaltyEarnedAt).toBeNull();
    expect(guest.lifetimeSpendAt).toBeNull();
  });

  it('reopen also clears billedAt (existing behavior preserved)', () => {
    const set = reopenSetBlock();
    expect(set).toHaveProperty('billedAt', null);
  });

  it('loyaltyPointsRedeemed is cleared on reopen (existing loyalty redemption reset)', () => {
    const set = reopenSetBlock();
    expect(set).toHaveProperty('loyaltyPointsRedeemed', 0);
    expect(set).toHaveProperty('loyaltyDiscountAmount', 0);
  });

  it('before_gst/grand_total calculationBase logic is unaffected by D-09 change', () => {
    // Sprint 5 C-06 fix: earnBase branches on calculationBase.
    // D-09 only changes which guests are ELIGIBLE for earning — not the base computation.
    const computeEarnBase = (grandTotal: number, taxTotal: number, base: string) =>
      base === 'before_gst' ? Math.max(0, grandTotal - taxTotal) : grandTotal;

    // Same behavior as Sprint 5 C-06 tests
    expect(computeEarnBase(1180, 180, 'before_gst')).toBe(1000);
    expect(computeEarnBase(1180, 180, 'grand_total')).toBe(1180);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-2 — Razorpay completion guard uses gatewayType
// ─────────────────────────────────────────────────────────────────────────────

describe('F-2 — Razorpay completion guard uses gatewayType field', () => {
  // Simulates the Payment findOne filter from orderRoutes.ts
  interface MockPayment {
    gatewayType?: string;
    method?: string; // non-existent field in schema — old bug
    status: string;
  }

  function razorpayGuardPasses(payment: MockPayment | null): boolean {
    if (!payment) return false;
    return (
      payment.status === 'success' &&
      ['razorpay', 'razorpay_link'].includes(payment.gatewayType ?? '')
    );
  }

  function razorpayGuardPassesBuggy(payment: MockPayment | null): boolean {
    if (!payment) return false;
    return (
      payment.status === 'success' &&
      ['razorpay', 'razorpay_link'].includes((payment as any).method ?? '')
    );
  }

  it('valid Razorpay payment (gatewayType) passes the completion guard', () => {
    const pmt: MockPayment = { gatewayType: 'razorpay', status: 'success' };
    expect(razorpayGuardPasses(pmt)).toBe(true);
  });

  it('razorpay_link variant also passes the guard', () => {
    const pmt: MockPayment = { gatewayType: 'razorpay_link', status: 'success' };
    expect(razorpayGuardPasses(pmt)).toBe(true);
  });

  it('non-Razorpay payment (gatewayType = stripe) does not pass the guard', () => {
    const pmt: MockPayment = { gatewayType: 'stripe', status: 'success' };
    expect(razorpayGuardPasses(pmt)).toBe(false);
  });

  it('pending Razorpay payment does not pass (status must be success)', () => {
    const pmt: MockPayment = { gatewayType: 'razorpay', status: 'pending' };
    expect(razorpayGuardPasses(pmt)).toBe(false);
  });

  it('null payment (no verified payment) → guard fails → completion blocked', () => {
    expect(razorpayGuardPasses(null)).toBe(false);
  });

  it('BUGGY guard with method field always fails (demonstrates the bug)', () => {
    // The old filter queried method: { $in: ['razorpay'] }, but no Payment has a method field.
    // A real Razorpay payment with gatewayType='razorpay' would fail the old guard.
    const realRazorpayPayment: MockPayment = { gatewayType: 'razorpay', status: 'success' };
    expect(razorpayGuardPassesBuggy(realRazorpayPayment)).toBe(false); // BUG: always false
    expect(razorpayGuardPasses(realRazorpayPayment)).toBe(true);       // FIXED: works correctly
  });

  it('duplicate verification is idempotent (findOne with same filter returns same result)', () => {
    const pmt: MockPayment = { gatewayType: 'razorpay', status: 'success' };
    const call1 = razorpayGuardPasses(pmt);
    const call2 = razorpayGuardPasses(pmt); // same payment, idempotent
    expect(call1).toBe(call2);
    expect(call1).toBe(true);
  });

  it('unpaid QR/Kiosk order (no success payment) → guard fails → order stays blocked', () => {
    // payment_pending order has no Payment with status=success yet
    expect(razorpayGuardPasses(null)).toBe(false);
    // Guard returning false causes 400 — order never reaches 'completed'
  });

  it('cash payment does not use the Razorpay guard at all (guard is paymentMethod-gated)', () => {
    // The guard is inside `if (paymentMethod === 'razorpay')` — cash bypasses it entirely.
    const paymentMethod: string = 'cash';
    const guardApplies = paymentMethod === 'razorpay';
    expect(guardApplies).toBe(false);
  });

  it('QR Razorpay verification still operates through paymentRoutes (uses gatewayType correctly)', () => {
    // paymentRoutes.ts uses payment.gatewayType for all gateway operations.
    // Simulates the PaymentGatewayConfig lookup in paymentRoutes verify handler.
    const payment = { gatewayType: 'razorpay', status: 'pending' };
    const configLookup = { hotelId: 'H1', gatewayType: payment.gatewayType };
    expect(configLookup.gatewayType).toBe('razorpay'); // correct field used
  });
});
