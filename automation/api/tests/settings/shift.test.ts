/**
 * Shift Management — Integration Tests (SHF)
 *
 * Covers the full shift lifecycle: open, active stats, movements, close,
 * variance, history, permissions, and cross-hotel isolation.
 *
 * SHF-A: Open shift
 * SHF-B: Duplicate active shift prevention (409 on second open)
 * SHF-C: Opening cash validation (missing field → 400)
 * SHF-D: Cash sale attributed to active shift (stats reflect completed cash order)
 * SHF-E: Cash-in movement (happy path)
 * SHF-F: Cash-out movement (happy path)
 * SHF-G: Expected cash formula: openingCash + cashSales + cashIn - cashOut
 * SHF-H: Close shift (happy path — status closed, closedAt set)
 * SHF-I: Closing variance: difference = actualCash - expectedCash
 * SHF-J: Double-close protection (400 on second close attempt)
 * SHF-K: Cross-hotel access rejection (Hotel B cannot read Hotel A shift)
 * SHF-L: Permission checks (kitchen/waiter cannot open or close)
 * SHF-M: Historical shift retrieval (GET /api/shifts paginates)
 */

import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA, getHotelB } from '../../setup/testEnv';
import { createOrder, updateOrderStatus } from '../../helpers/order.helper';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function closeActiveShift(token: string): Promise<void> {
  const res = await api.get('/api/shifts/active').set(authHeaders(token));
  if (res.status === 200 && res.body.shift?._id) {
    await api
      .post(`/api/shifts/${res.body.shift._id}/close`)
      .set(authHeaders(token))
      .send({ actualCash: 0, closingNote: 'test cleanup' })
      .catch(() => {});
  }
}

async function openShift(
  token: string,
  openingCash = 0,
  note = 'shift test',
): Promise<{ shiftId: string }> {
  const res = await api
    .post('/api/shifts/open')
    .set(authHeaders(token))
    .send({ openingCash, openingNote: note });
  if (res.status !== 201) {
    throw new Error(`openShift failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { shiftId: res.body.shift._id as string };
}

async function closeShift(
  token: string,
  shiftId: string,
  actualCash = 0,
  note = 'closed',
): Promise<any> {
  return api
    .post(`/api/shifts/${shiftId}/close`)
    .set(authHeaders(token))
    .send({ actualCash, closingNote: note });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Shift Management (SHF)', () => {
  let adminToken:   string;
  let cashierToken: string;
  let kitchenToken: string;
  let waiterToken:  string;
  let cashierTokenB: string;

  beforeAll(async () => {
    const hotelA = getHotelA();
    const hotelB = getHotelB();
    adminToken    = hotelA.adminToken;
    cashierToken  = hotelA.cashierToken;
    kitchenToken  = hotelA.kitchenToken;
    waiterToken   = hotelA.waiterToken;
    cashierTokenB = hotelB.cashierToken;

    // Close any lingering open shift left by a previous test run
    await closeActiveShift(adminToken);
  });

  afterEach(async () => {
    // Safety net: ensure no open shift bleeds into the next test
    await closeActiveShift(adminToken);
  });

  // ── SHF-A ──────────────────────────────────────────────────────────────────
  it('SHF-A: open shift returns 201 with correct fields', async () => {
    const res = await api
      .post('/api/shifts/open')
      .set(authHeaders(cashierToken))
      .send({ openingCash: 1000, openingNote: 'SHF-A morning shift' });

    expect(res.status).toBe(201);
    const s = res.body.shift;
    expect(s._id).toBeDefined();
    expect(s.status).toBe('open');
    expect(s.openingCash).toBe(1000);
    expect(s.openingNote).toBe('SHF-A morning shift');
    expect(s.openedAt).toBeDefined();
    expect(s.closedAt).toBeNull();
    expect(s.cashIn).toBe(0);
    expect(s.cashOut).toBe(0);
  }, 15_000);

  // ── SHF-B ──────────────────────────────────────────────────────────────────
  it('SHF-B: opening a second shift while one is active returns 409', async () => {
    await openShift(cashierToken, 500, 'SHF-B first');

    const res = await api
      .post('/api/shifts/open')
      .set(authHeaders(cashierToken))
      .send({ openingCash: 200 });

    expect(res.status).toBe(409);
  }, 15_000);

  // ── SHF-C ──────────────────────────────────────────────────────────────────
  it('SHF-C: opening shift without openingCash returns 400', async () => {
    const res = await api
      .post('/api/shifts/open')
      .set(authHeaders(cashierToken))
      .send({ openingNote: 'no cash field' });

    expect(res.status).toBe(400);
  }, 10_000);

  // ── SHF-D ──────────────────────────────────────────────────────────────────
  it('SHF-D: completing a cash order updates active shift stats', async () => {
    const { shiftId } = await openShift(cashierToken, 0, 'SHF-D');
    try {
      // Create and complete a cash order during this shift window
      const { orderId } = await createOrder(adminToken, {
        tableNumber: 'SHFD',
        paymentMethod: 'cash',
        items: [{ productName: 'Samosa', quantity: 2, price: 30, total: 60 }],
      });
      await updateOrderStatus(kitchenToken, orderId, 'preparing');
      await updateOrderStatus(kitchenToken, orderId, 'ready');
      await updateOrderStatus(waiterToken,  orderId, 'served');
      await updateOrderStatus(cashierToken, orderId, 'completed');

      const statsRes = await api
        .get('/api/shifts/active/stats')
        .set(authHeaders(cashierToken));

      expect(statsRes.status).toBe(200);
      expect(statsRes.body.totalOrders).toBeGreaterThanOrEqual(1);
      // cashSales counts direct cash orders; splitCashSales counts split-cash portions
      const totalCashInDrawer =
        (statsRes.body.cashSales    ?? 0) +
        (statsRes.body.splitCashSales ?? 0);
      expect(totalCashInDrawer).toBeGreaterThan(0);
    } finally {
      await closeShift(cashierToken, shiftId, 0).catch(() => {});
    }
  }, 40_000);

  // ── SHF-E ──────────────────────────────────────────────────────────────────
  it('SHF-E: cash-in movement is recorded on the shift', async () => {
    const { shiftId } = await openShift(cashierToken, 0, 'SHF-E');
    try {
      const res = await api
        .post(`/api/shifts/${shiftId}/movements`)
        .set(authHeaders(cashierToken))
        .send({ type: 'cash_in', amount: 200, reason: 'Float refill' });

      expect(res.status).toBe(201);
      expect(res.body.movement.type).toBe('cash_in');
      expect(res.body.movement.amount).toBe(200);
      expect(res.body.shift.cashIn).toBe(200);
      expect(res.body.shift.movements).toHaveLength(1);
    } finally {
      await closeShift(cashierToken, shiftId, 0).catch(() => {});
    }
  }, 15_000);

  // ── SHF-F ──────────────────────────────────────────────────────────────────
  it('SHF-F: cash-out movement is recorded on the shift', async () => {
    const { shiftId } = await openShift(cashierToken, 500, 'SHF-F');
    try {
      const res = await api
        .post(`/api/shifts/${shiftId}/movements`)
        .set(authHeaders(cashierToken))
        .send({ type: 'cash_out', amount: 50, reason: 'Petty cash' });

      expect(res.status).toBe(201);
      expect(res.body.movement.type).toBe('cash_out');
      expect(res.body.movement.amount).toBe(50);
      expect(res.body.shift.cashOut).toBe(50);
    } finally {
      await closeShift(cashierToken, shiftId, 0).catch(() => {});
    }
  }, 15_000);

  // ── SHF-G ──────────────────────────────────────────────────────────────────
  it('SHF-G: expectedCash = openingCash + cashSales + cashIn - cashOut', async () => {
    // No orders are created in this test — cashSales = 0 — so the formula is deterministic
    const { shiftId } = await openShift(cashierToken, 1000, 'SHF-G');

    await api.post(`/api/shifts/${shiftId}/movements`).set(authHeaders(cashierToken))
      .send({ type: 'cash_in',  amount: 200, reason: 'SHF-G in' });
    await api.post(`/api/shifts/${shiftId}/movements`).set(authHeaders(cashierToken))
      .send({ type: 'cash_out', amount: 50,  reason: 'SHF-G out' });

    // expectedCash = 1000 + 0 + 200 - 50 = 1150
    const closeRes = await closeShift(cashierToken, shiftId, 1150, 'SHF-G close');

    expect(closeRes.status).toBe(200);
    const s = closeRes.body.shift;
    expect(s.expectedCash).toBe(1150);
    expect(s.actualCash).toBe(1150);
    expect(s.difference).toBe(0);
  }, 20_000);

  // ── SHF-H ──────────────────────────────────────────────────────────────────
  it('SHF-H: closing an open shift returns 200 with status=closed', async () => {
    const { shiftId } = await openShift(cashierToken, 500, 'SHF-H');

    const res = await closeShift(cashierToken, shiftId, 500, 'SHF-H close');

    expect(res.status).toBe(200);
    const s = res.body.shift;
    expect(s.status).toBe('closed');
    expect(s.closedAt).toBeTruthy();
    expect(s.actualCash).toBe(500);
    expect(s.expectedCash).toBeGreaterThanOrEqual(0);
    expect(typeof s.difference).toBe('number');
  }, 15_000);

  // ── SHF-I ──────────────────────────────────────────────────────────────────
  it('SHF-I: difference = actualCash - expectedCash (variance)', async () => {
    // openingCash=500, cashIn=100, no cashOut, no cash orders
    // → expectedCash = 500 + 0 + 100 - 0 = 600
    const { shiftId } = await openShift(cashierToken, 500, 'SHF-I');
    await api.post(`/api/shifts/${shiftId}/movements`).set(authHeaders(cashierToken))
      .send({ type: 'cash_in', amount: 100, reason: 'SHF-I in' });

    // Close with actualCash = 400 — short by 200
    const res = await closeShift(cashierToken, shiftId, 400, 'SHF-I close');

    expect(res.status).toBe(200);
    const s = res.body.shift;
    expect(s.expectedCash).toBe(600);
    expect(s.actualCash).toBe(400);
    expect(s.difference).toBe(-200); // actual - expected = 400 - 600
  }, 20_000);

  // ── SHF-J ──────────────────────────────────────────────────────────────────
  it('SHF-J: closing an already-closed shift returns 400', async () => {
    const { shiftId } = await openShift(cashierToken, 0, 'SHF-J');
    await closeShift(cashierToken, shiftId, 0, 'SHF-J first close');

    const res = await closeShift(cashierToken, shiftId, 0, 'SHF-J second close');
    expect(res.status).toBe(400);
  }, 15_000);

  // ── SHF-K ──────────────────────────────────────────────────────────────────
  it('SHF-K: Hotel B cashier cannot access Hotel A shift by ID', async () => {
    const { shiftId } = await openShift(cashierToken, 0, 'SHF-K');
    try {
      const res = await api
        .get(`/api/shifts/${shiftId}`)
        .set(authHeaders(cashierTokenB));

      // Hotel B JWT scopes the query to Hotel B — Hotel A shift not found
      expect(res.status).toBe(404);
    } finally {
      await closeShift(cashierToken, shiftId, 0).catch(() => {});
    }
  }, 15_000);

  // ── SHF-L ──────────────────────────────────────────────────────────────────
  it('SHF-L: kitchen and waiter tokens cannot open a shift', async () => {
    const [kitchenRes, waiterRes] = await Promise.all([
      api.post('/api/shifts/open').set(authHeaders(kitchenToken)).send({ openingCash: 0 }),
      api.post('/api/shifts/open').set(authHeaders(waiterToken)).send({ openingCash: 0 }),
    ]);

    expect([401, 403]).toContain(kitchenRes.status);
    expect([401, 403]).toContain(waiterRes.status);
  }, 15_000);

  // ── SHF-M ──────────────────────────────────────────────────────────────────
  it('SHF-M: GET /api/shifts returns paginated history including closed shifts', async () => {
    const { shiftId } = await openShift(cashierToken, 100, 'SHF-M');
    await closeShift(cashierToken, shiftId, 100, 'SHF-M close');

    const res = await api.get('/api/shifts').set(authHeaders(adminToken));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.shifts)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.page).toBe('number');
    expect(typeof res.body.pages).toBe('number');
    expect(res.body.total).toBeGreaterThanOrEqual(1);

    const found = (res.body.shifts as any[]).some(s => s._id === shiftId);
    expect(found).toBe(true);
  }, 15_000);
});
