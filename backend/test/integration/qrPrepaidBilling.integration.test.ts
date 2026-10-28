/**
 * QR prepaid orders vs table billing (audit 2026-10, step 4) — integrated with
 * upstream's counterBilling model (commit 5a75093):
 *
 *   • Orders paid online (paymentMethod 'razorpay') and unpaid payment_pending
 *     orders never add to Guest.totalAmount, so the counter never charges them.
 *   • Billing completes counter orders with the counter method, completes
 *     released online orders but keeps 'razorpay', and leaves payment_pending /
 *     cancelled orders untouched.
 *   • Integration additions: completion metadata (paymentTime, settledVia,
 *     cashierId), collected-amount records on Guest / TableSession, and an
 *     atomic claim so a table is settled exactly once.
 *
 * Guests are seeded with the totalAmount the create paths would produce under
 * that model (counter-due orders only).
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
import sessionRoutes from '../../src/routes/sessionRoutes';
import Order from '../../src/models/Order';
import Payment from '../../src/models/Payment';
import Guest from '../../src/models/Guest';
import Table from '../../src/models/Table';
import TableSession from '../../src/models/TableSession';
import { scheduleReceiptPrint } from '../../src/utils/printUtils';

jest.setTimeout(90_000);

const app = makeApp([['/api/sessions', sessionRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => { await clearDb(); (scheduleReceiptPrint as jest.Mock).mockClear(); });

let seq = 0;
async function table() {
  const h = await createHotel({ features: { tableSessions: true } });
  const t = await Table.create({ hotelId: h._id, number: ++seq });
  const s = await TableSession.create({ hotelId: h._id, tableId: t._id, tableNumber: String(t.number), status: 'open' });
  const tok = tokenFor(String(h._id));
  return { h, t, s, tok };
}

async function guest(ctx: any, n: number, totalAmount: number) {
  return Guest.create({
    hotelId: ctx.h._id, sessionId: ctx.s._id, tableId: ctx.t._id, tableNumber: ctx.s.tableNumber,
    guestNumber: n, displayLabel: `Guest ${n}`, status: 'active', totalAmount,
  });
}

async function order(ctx: any, g: any, amount: number, extra: Record<string, unknown> = {}) {
  return Order.create({
    hotelId: ctx.h._id, sessionId: ctx.s._id, guestId: g._id, orderNumber: `ORD-${Math.random()}`,
    status: 'served', orderSource: 'dine-in', paymentMethod: 'cash', tableNumber: ctx.s.tableNumber,
    items: [{ productName: 'Item', quantity: 1, price: amount, total: amount }],
    subtotal: amount, taxTotal: 0, grandTotal: amount, ...extra,
  });
}

const qr = { orderSource: 'qr', paymentMethod: 'razorpay' };

// R1: an order counts as paid online only with a verified successful payment.
async function paidOnline(ctx: any, o: any) {
  return Payment.create({
    hotelId: ctx.h._id, orderId: o._id, internalTransactionId: `TXN-${Math.random()}`, gatewayType: 'razorpay',
    amount: Math.round(o.grandTotal * 100), currency: 'INR', status: 'success', gatewayTransactionId: `pay_${Math.random()}`,
  });
}

describe('prepaid QR order (₹500) + counter order (₹200) on the same guest', () => {
  async function scenario() {
    const ctx = await table();
    const g = await guest(ctx, 1, 200);           // only the counter order is due
    const qrOrder   = await order(ctx, g, 500, qr);
    await paidOnline(ctx, qrOrder);
    const cashOrder = await order(ctx, g, 200);
    return { ctx, g, qrOrder, cashOrder };
  }

  test('GET bill: grand total is the amount due at the counter (200), orders carry status + method', async () => {
    const { ctx } = await scenario();
    const res = await request(app).get(`/api/sessions/${ctx.s._id}/bill`).set(auth(ctx.tok));
    expect(res.status).toBe(200);
    expect(res.body.grandTotal).toBe(200);
    const qrRow = res.body.guests[0].orders.find((o: any) => o.orderSource === 'qr');
    expect(qrRow.paymentMethod).toBe('razorpay');
    expect(qrRow.status).toBe('served');
  });

  test('guest bill: split must equal the amount due (200), not 700', async () => {
    const { ctx, g } = await scenario();
    const url = `/api/sessions/${ctx.s._id}/guests/${g._id}`;
    const wrong = await request(app).patch(url).set(auth(ctx.tok))
      .send({ action: 'bill', paymentMethod: 'split', splitDetails: { cash: 700 } });
    expect(wrong.status).toBe(400);
    const ok = await request(app).patch(url).set(auth(ctx.tok))
      .send({ action: 'bill', paymentMethod: 'split', splitDetails: { cash: 200 } });
    expect(ok.status).toBe(200);
  });

  test('guest bill keeps the prepaid order as razorpay and records payment metadata + collected cash', async () => {
    const { ctx, g, qrOrder, cashOrder } = await scenario();
    const res = await request(app).patch(`/api/sessions/${ctx.s._id}/guests/${g._id}`).set(auth(ctx.tok))
      .send({ action: 'bill', paymentMethod: 'cash' });
    expect(res.status).toBe(200);
    const q = (await Order.findById(qrOrder._id))!.toObject() as any;
    const c = (await Order.findById(cashOrder._id))!.toObject() as any;
    expect(q.status).toBe('completed');
    expect(q.paymentMethod).toBe('razorpay');
    expect(c.status).toBe('completed');
    expect(c.paymentMethod).toBe('cash');
    for (const o of [q, c]) {
      expect(o.settledVia).toBe('guest');
      expect(o.paymentTime).toBeInstanceOf(Date);
    }
    const gDoc = (await Guest.findById(g._id))!.toObject() as any;
    expect(gDoc.collectedAmount).toBe(200);
    expect(gDoc.cashCollected).toBe(200);
  });

  test('bulk bill: split must equal the amount due; prepaid order keeps razorpay; settlement recorded once', async () => {
    const { ctx, qrOrder } = await scenario();
    const url = `/api/sessions/${ctx.s._id}/close`;
    expect((await request(app).patch(url).set(auth(ctx.tok))
      .send({ bulkBill: true, paymentMethod: 'split', splitDetails: { cash: 700 } })).status).toBe(400);
    const ok = await request(app).patch(url).set(auth(ctx.tok))
      .send({ bulkBill: true, paymentMethod: 'split', splitDetails: { cash: 120, upi: 80 } });
    expect(ok.status).toBe(200);
    const q = (await Order.findById(qrOrder._id))!.toObject() as any;
    expect(q.paymentMethod).toBe('razorpay');
    expect(q.settledVia).toBe('session');
    const s = (await TableSession.findById(ctx.s._id))!.toObject() as any;
    expect(s.status).toBe('closed');
    expect(s.collectedAmount).toBe(200);
    expect(s.cashCollected).toBe(120);
    expect(s.billPaymentMethod).toBe('split');
  });
});

test('guest whose orders were all paid online can be closed at ₹0 collected', async () => {
  const ctx = await table();
  const g = await guest(ctx, 1, 0);
  const o = await order(ctx, g, 450, qr);
  await paidOnline(ctx, o);
  const res = await request(app).patch(`/api/sessions/${ctx.s._id}/guests/${g._id}`).set(auth(ctx.tok))
    .send({ action: 'bill', paymentMethod: 'cash' });
  expect(res.status).toBe(200);
  expect((await Order.findById(o._id))!.paymentMethod).toBe('razorpay');
  const gDoc = (await Guest.findById(g._id))!.toObject() as any;
  expect(gDoc.collectedAmount).toBe(0);
  expect(gDoc.cashCollected).toBe(0);
});

test('cancelled orders are not charged and not completed', async () => {
  const ctx = await table();
  const g = await guest(ctx, 1, 200); // the cancel path already removed the 500
  const cancelled = await order(ctx, g, 500, { status: 'cancelled' });
  await order(ctx, g, 200);
  const res = await request(app).patch(`/api/sessions/${ctx.s._id}/guests/${g._id}`).set(auth(ctx.tok))
    .send({ action: 'bill', paymentMethod: 'split', splitDetails: { cash: 200 } });
  expect(res.status).toBe(200);
  expect((await Order.findById(cancelled._id))!.status).toBe('cancelled');
});

describe('unpaid online order (payment_pending) blocks billing — approved decision R2', () => {
  // R2 (approved 2026-10-28): a table / guest cannot be billed while an online
  // order is still waiting for payment — wait for the payment or cancel the order.
  // Full lifecycle coverage: onlinePaymentIntegrity.integration.test.ts.
  test('guest bill is refused (409 ONLINE_PAYMENT_PENDING) and nothing changes', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 150);
    const pending = await order(ctx, g, 400, { ...qr, status: 'payment_pending' });
    await order(ctx, g, 150);
    const res = await request(app).patch(`/api/sessions/${ctx.s._id}/guests/${g._id}`).set(auth(ctx.tok))
      .send({ action: 'bill', paymentMethod: 'split', splitDetails: { cash: 150 } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ONLINE_PAYMENT_PENDING');
    expect((await Guest.findById(g._id))!.status).toBe('active');
    expect((await Order.findById(pending._id))!.status).toBe('payment_pending');
  });

  test('bulk bill is refused; the table stays open and the unpaid order untouched', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);
    const pending = await order(ctx, g, 400, { ...qr, status: 'payment_pending' });
    const res = await request(app).patch(`/api/sessions/${ctx.s._id}/close`).set(auth(ctx.tok))
      .send({ bulkBill: true, paymentMethod: 'cash' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ONLINE_PAYMENT_PENDING');
    expect((await TableSession.findById(ctx.s._id))!.status).toBe('open');
    expect((await Order.findById(pending._id))!.status).toBe('payment_pending');
  });
});

test('concurrent bulk-bill requests settle the table exactly once', async () => {
  const ctx = await table();
  const g1 = await guest(ctx, 1, 200);
  const g2 = await guest(ctx, 2, 300);
  await order(ctx, g1, 200);
  await order(ctx, g2, 300);
  const url = `/api/sessions/${ctx.s._id}/close`;
  const [r1, r2] = await Promise.all([
    request(app).patch(url).set(auth(ctx.tok)).send({ bulkBill: true, paymentMethod: 'cash' }),
    request(app).patch(url).set(auth(ctx.tok)).send({ bulkBill: true, paymentMethod: 'cash' }),
  ]);
  expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  expect(scheduleReceiptPrint).toHaveBeenCalledTimes(2); // one receipt per guest, not per request
  const s = (await TableSession.findById(ctx.s._id))!.toObject() as any;
  expect(s.status).toBe('closed');
  expect(s.collectedAmount).toBe(500);
  expect(s.cashCollected).toBe(500);
});

test('no prepaid orders: billing behaves exactly as before', async () => {
  const ctx = await table();
  const g = await guest(ctx, 1, 250);
  await order(ctx, g, 250);
  const bill = await request(app).get(`/api/sessions/${ctx.s._id}/bill`).set(auth(ctx.tok));
  expect(bill.body.grandTotal).toBe(250);
  const res = await request(app).patch(`/api/sessions/${ctx.s._id}/guests/${g._id}`).set(auth(ctx.tok))
    .send({ action: 'bill', paymentMethod: 'split', splitDetails: { cash: 100, upi: 150 } });
  expect(res.status).toBe(200);
});
