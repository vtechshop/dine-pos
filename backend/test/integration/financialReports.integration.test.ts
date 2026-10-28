/**
 * Financial reports and shift cash (audit 2026-10, phase 2).
 *
 * Rules exercised (from existing code/docs — see src/utils/revenue.ts):
 *   - revenue = completed, non-complimentary orders; unpaid orders reported apart
 *   - refunds reported separately and deducted from net sales (by refund date)
 *   - shift cash = cash actually received in the shift window, each payment once
 */
import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel } from './harness';

jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), in: () => ({ allSockets: async () => new Set() }), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});
jest.mock('../../src/utils/printUtils', () => ({
  ...jest.requireActual('../../src/utils/printUtils'),
  scheduleKOTPrint:          jest.fn().mockResolvedValue(undefined),
  scheduleOrderReceiptPrint: jest.fn().mockResolvedValue(undefined),
  scheduleReceiptPrint:      jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/whatsappReceiptService', () => ({
  createWhatsAppReceiptJob:         jest.fn().mockResolvedValue(undefined),
  createWhatsAppReceiptJobForGuest: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import mongoose from 'mongoose';
import orderRoutes from '../../src/routes/orderRoutes';
import shiftRoutes from '../../src/routes/shiftRoutes';
import sessionRoutes from '../../src/routes/sessionRoutes';
import Order from '../../src/models/Order';
import Payment from '../../src/models/Payment';
import Guest from '../../src/models/Guest';
import Table from '../../src/models/Table';
import TableSession from '../../src/models/TableSession';

jest.setTimeout(90_000);

const app = makeApp([
  ['/api/orders', orderRoutes],
  ['/api/shifts', shiftRoutes],
  ['/api/sessions', sessionRoutes],
]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const today = () => new Date().toISOString().slice(0, 10);

async function rawOrder(hotelId: unknown, amount: number, extra: Record<string, unknown> = {}) {
  // Inserted directly so status/paymentMethod/createdAt can be set exactly.
  const doc = {
    hotelId, orderNumber: `ORD-${Math.random()}`, status: 'completed', orderSource: 'takeaway',
    paymentMethod: 'cash', completedAt: new Date(),
    items: [{ productName: 'Item', quantity: 1, price: amount, total: amount, taxPercent: 0, taxAmount: 0 }],
    subtotal: amount, taxTotal: 0, discountAmount: 0, grandTotal: amount,
    customerName: 'C', customerPhone: '9999999999',
    createdAt: new Date(), updatedAt: new Date(),
    ...extra,
  };
  const { insertedId } = await Order.collection.insertOne(doc as any);
  return insertedId;
}

// ── Daily report ──────────────────────────────────────────────────────────────

describe('daily sales report', () => {
  test('unpaid, cancelled and complimentary orders are not revenue; refunds reduce net sales', async () => {
    const h = await createHotel();
    const t = tokenFor(String(h._id));
    await rawOrder(h._id, 100);                                                   // cash, paid
    await rawOrder(h._id, 200, { status: 'pending', completedAt: null });         // unpaid
    await rawOrder(h._id, 300, { status: 'payment_pending', orderSource: 'qr', paymentMethod: 'razorpay', completedAt: null }); // unpaid online
    await rawOrder(h._id, 400, { status: 'cancelled', completedAt: null });       // cancelled
    await rawOrder(h._id, 500, { paymentMethod: 'upi', refundedAt: new Date(), refundAmount: 500, refundMethod: 'upi' }); // refunded today
    await rawOrder(h._id, 250, { paymentMethod: 'razorpay', orderSource: 'qr' }); // paid online
    await rawOrder(h._id, 150, { paymentMethod: 'complimentary' });               // comp (UAT CSH-07)
    await rawOrder(h._id, 300, { paymentMethod: 'split', splitDetails: { cash: 100, upi: 200, card: 0 } });

    const res = await request(app).get(`/api/orders/reports/daily?date=${today()}`).set(auth(t));
    expect(res.status).toBe(200);
    expect(res.body.grossSales).toBe(1150);          // 100 + 500 + 250 + 300
    expect(res.body.refunds).toEqual({ count: 1, amount: 500, cashAmount: 0 });
    expect(res.body.totalSales).toBe(650);           // 1150 − 500 refunded
    expect(res.body.totalOrders).toBe(4);
    expect(res.body.openOrders).toEqual({ count: 2, value: 500 });
    expect(res.body.cancelledOrders).toBe(1);
    expect(res.body.paymentBreakdown).toMatchObject({ cash: 100, upi: 500, online: 250, split: 300 });

    // Reconciles with the underlying records
    const hid = new mongoose.Types.ObjectId(String(h._id));
    const [paid] = await Order.aggregate([
      { $match: { hotelId: hid, status: 'completed', paymentMethod: { $ne: 'complimentary' } } },
      { $group: { _id: null, s: { $sum: '$grandTotal' } } },
    ]);
    const [ref] = await Order.aggregate([
      { $match: { hotelId: hid, refundedAt: { $ne: null } } },
      { $group: { _id: null, s: { $sum: '$refundAmount' } } },
    ]);
    expect(res.body.totalSales).toBe(paid.s - ref.s);
  });

  test('refund recorded through the real route is reported once', async () => {
    const h = await createHotel();
    const t = tokenFor(String(h._id));
    const id = await rawOrder(h._id, 800);
    expect((await request(app).post(`/api/orders/${id}/refund`).set(auth(t)).send({ reason: 'cold food', refundAmount: 300, refundMethod: 'cash' })).status).toBe(200);
    expect((await request(app).post(`/api/orders/${id}/refund`).set(auth(t)).send({ reason: 'again', refundMethod: 'cash' })).status).toBe(409);
    const res = await request(app).get(`/api/orders/reports/daily?date=${today()}`).set(auth(t));
    expect(res.body.refunds).toEqual({ count: 1, amount: 300, cashAmount: 300 });
    expect(res.body.totalSales).toBe(500);
  });

  test('invalid refundMethod is rejected', async () => {
    const h = await createHotel();
    const id = await rawOrder(h._id, 100);
    const r = await request(app).post(`/api/orders/${id}/refund`).set(auth(tokenFor(String(h._id)))).send({ reason: 'x', refundMethod: 'bitcoin' });
    expect(r.status).toBe(400);
  });
});

// ── Split payment details ────────────────────────────────────────────────────

test('PATCH /:id/payment stores the {cash, upi, card} split the web client sends (was dropped)', async () => {
  const h = await createHotel();
  const t = tokenFor(String(h._id));
  const id = await rawOrder(h._id, 600, { status: 'served', completedAt: null });
  const bad = await request(app).patch(`/api/orders/${id}/payment`).set(auth(t))
    .send({ paymentMethod: 'split', splitDetails: { cash: 100, upi: 100, card: 0 } });
  expect(bad.status).toBe(400); // does not add up to 600
  const ok = await request(app).patch(`/api/orders/${id}/payment`).set(auth(t))
    .send({ paymentMethod: 'split', splitDetails: { cash: 200, upi: 400, card: 0 } });
  expect(ok.status).toBe(200);
  const o = await Order.findById(id).lean() as any;
  expect(o.splitDetails).toMatchObject({ cash: 200, upi: 400, card: 0 });
});

// ── Shift cash ───────────────────────────────────────────────────────────────

describe('shift expected cash reflects cash actually received', () => {
  test('full shift scenario reconciles to the rupee', async () => {
    const h = await createHotel({ features: { shift: true, tableSessions: true } });
    const admin   = tokenFor(String(h._id));
    const cashier = tokenFor(String(h._id), 'cashier', { cashierId: 'c-1', cashierName: 'Asha' });

    // Order created BEFORE the shift opened, paid during it (old code missed it).
    const early = await rawOrder(h._id, 400, {
      status: 'served', completedAt: null, createdAt: new Date(Date.now() - 3 * 3600_000),
    });
    // Completed before the shift — must NOT be counted.
    await rawOrder(h._id, 999, { completedAt: new Date(Date.now() - 2 * 3600_000), createdAt: new Date(Date.now() - 2 * 3600_000) });

    const open = await request(app).post('/api/shifts/open').set(auth(cashier)).send({ openingCash: 1000 });
    expect(open.status).toBe(201);
    const shiftId = open.body.shift._id;

    // 1. pay the early order in cash during the shift (real route)
    expect((await request(app).patch(`/api/orders/${early}/status`).set(auth(admin)).send({ status: 'completed', paymentMethod: 'cash' })).status).toBe(200);
    // 2. split bill: 200 cash + 400 UPI (real routes)
    const split = await rawOrder(h._id, 600, { status: 'served', completedAt: null });
    await request(app).patch(`/api/orders/${split}/payment`).set(auth(admin)).send({ paymentMethod: 'split', splitDetails: { cash: 200, upi: 400, card: 0 } });
    expect((await request(app).patch(`/api/orders/${split}/status`).set(auth(admin)).send({ status: 'completed' })).status).toBe(200);
    // 3. UPI order — not cash; a stale splitDetails.cash on it must be ignored
    await rawOrder(h._id, 300, { paymentMethod: 'upi', splitDetails: { cash: 300, upi: 0, card: 0 } });
    // 4. QR order paid online — never in the drawer
    await rawOrder(h._id, 250, { paymentMethod: 'razorpay', orderSource: 'qr' });
    // 5. unpaid order — nothing collected
    await rawOrder(h._id, 777, { status: 'pending', completedAt: null });
    // 6. guest bill paid in cash (orders total 500) — counted once, from the Guest record
    const table = await Table.create({ hotelId: h._id, number: 1 });
    const sess  = await TableSession.create({ hotelId: h._id, tableId: table._id, tableNumber: '1', status: 'open' });
    const g = await Guest.create({ hotelId: h._id, sessionId: sess._id, tableId: table._id, tableNumber: '1', guestNumber: 1, displayLabel: 'G1', status: 'active', totalAmount: 500 });
    await rawOrder(h._id, 500, { status: 'served', completedAt: null, sessionId: sess._id, guestId: g._id, orderSource: 'dine-in' });
    expect((await request(app).patch(`/api/sessions/${sess._id}/guests/${g._id}`).set(auth(admin)).send({ action: 'bill', paymentMethod: 'cash' })).status).toBe(200);
    // 7. cash out 50; 8. a cash refund recorded on the order (reported, not auto-subtracted)
    expect((await request(app).post(`/api/shifts/${shiftId}/movements`).set(auth(cashier)).send({ type: 'cash_out', amount: 50, reason: 'Petty cash' })).status).toBeLessThan(300);
    const refundable = await rawOrder(h._id, 120);
    await request(app).post(`/api/orders/${refundable}/refund`).set(auth(admin)).send({ reason: 'wrong item', refundMethod: 'cash' });

    // expected = 1000 + 400 (early) + 200 (split cash) + 500 (guest) + 120 (refundable cash sale) − 50 = 2170
    const stats = await request(app).get('/api/shifts/active/stats').set(auth(cashier));
    expect(stats.status).toBe(200);
    expect(stats.body.cashSales).toBe(1020);       // 400 + 500 + 120
    expect(stats.body.splitCashSales).toBe(200);
    expect(stats.body.onlineSales).toBe(250);
    expect(stats.body.upiSales).toBe(700);         // 300 + split 400
    expect(stats.body.refunds).toEqual({ count: 1, amount: 120, cashAmount: 120 });
    expect(stats.body.expectedCash).toBe(2170);

    const close = await request(app).post(`/api/shifts/${shiftId}/close`).set(auth(cashier)).send({ actualCash: 2170 });
    expect(close.status).toBe(200);
    expect(close.body.shift.expectedCash).toBe(2170);
    expect(close.body.shift.difference).toBe(0);
    expect(close.body.shift.cashSales).toBe(1220); // 1020 + 200 split cash

    // Guest-billed orders carry completion metadata and are not double counted
    const guestOrder = await Order.findOne({ guestId: g._id }).lean() as any;
    expect(guestOrder.settledVia).toBe('guest');
    expect(guestOrder.completedAt).toBeTruthy();
    expect((await Guest.findById(g._id).lean() as any).cashCollected).toBe(500);
  });

  test('table bulk bill with a prepaid QR order: only the counter cash enters the drawer', async () => {
    const h = await createHotel({ features: { shift: true, tableSessions: true } });
    const admin   = tokenFor(String(h._id));
    const cashier = tokenFor(String(h._id), 'cashier', { cashierId: 'c-2', cashierName: 'Ravi' });
    const open = await request(app).post('/api/shifts/open').set(auth(cashier)).send({ openingCash: 0 });

    const table = await Table.create({ hotelId: h._id, number: 2 });
    const sess  = await TableSession.create({ hotelId: h._id, tableId: table._id, tableNumber: '2', status: 'open' });
    const g = await Guest.create({ hotelId: h._id, sessionId: sess._id, tableId: table._id, tableNumber: '2', guestNumber: 1, displayLabel: 'G1', status: 'active', totalAmount: 200 });
    // totalAmount = counter-due only: the prepaid QR order never adds to it (counterBilling).
    const qr = await rawOrder(h._id, 500, { status: 'served', completedAt: null, sessionId: sess._id, guestId: g._id, orderSource: 'qr', paymentMethod: 'razorpay' });
    await rawOrder(h._id, 200, { status: 'served', completedAt: null, sessionId: sess._id, guestId: g._id, orderSource: 'dine-in' });
    await Payment.create({ hotelId: h._id, orderId: qr, internalTransactionId: `T-${Math.random()}`, gatewayType: 'razorpay', amount: 50000, status: 'success' });

    expect((await request(app).patch(`/api/sessions/${sess._id}/close`).set(auth(admin)).send({ bulkBill: true, paymentMethod: 'cash' })).status).toBe(200);
    const s = await TableSession.findById(sess._id).lean() as any;
    expect(s.collectedAmount).toBe(200);
    expect(s.cashCollected).toBe(200);

    const stats = await request(app).get('/api/shifts/active/stats').set(auth(cashier));
    expect(stats.body.cashSales).toBe(200);           // not 700
    expect(stats.body.expectedCash).toBe(200);
    expect(open.status).toBe(201);
  });
});
