/**
 * R1 — no order is treated as paid online without a verified payment.
 * R2 — unresolved online orders cannot disappear during table billing, and late
 *      payment callbacks cannot release an order onto a closed table.
 *
 * Real routers + in-memory MongoDB replica set. The payment gateway is mocked
 * (no network, no real Razorpay); Payment amounts are in paise.
 */
import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel, createProduct } from './harness';

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
// Fake gateway: signature / webhook checks pass; nothing leaves the process.
jest.mock('../../src/services/payment/GatewayFactory', () => ({
  __esModule: true,
  default: {
    create:            () => ({
      verifyPayment: async () => ({ success: true, status: 'success', paymentMethod: 'upi', gatewayResponse: {} }),
      verifyWebhook: () => true,
    }),
    isRegistered:      () => true,
    getSupportedTypes: () => ['razorpay'],
    register:          () => undefined,
  },
}));
jest.mock('../../src/utils/encryption', () => ({
  ...jest.requireActual('../../src/utils/encryption'),
  decrypt: () => 'test-webhook-secret',
}));

import request from 'supertest';
import mongoose from 'mongoose';
import orderRoutes from '../../src/routes/orderRoutes';
import sessionRoutes from '../../src/routes/sessionRoutes';
import publicPaymentRoutes from '../../src/routes/publicPaymentRoutes';
import paymentWebhookRoutes from '../../src/routes/paymentWebhookRoutes';
import Order from '../../src/models/Order';
import Payment from '../../src/models/Payment';
import Guest from '../../src/models/Guest';
import Table from '../../src/models/Table';
import TableSession from '../../src/models/TableSession';
import PaymentGatewayConfig from '../../src/models/PaymentGatewayConfig';
import AuditLog from '../../src/models/AuditLog';
import { scheduleKOTPrint, scheduleOrderReceiptPrint } from '../../src/utils/printUtils';

jest.setTimeout(90_000);

const app = makeApp([
  ['/api/orders', orderRoutes],
  ['/api/sessions', sessionRoutes],
  ['/api/public/payments', publicPaymentRoutes],
  ['/api/payment-webhooks', paymentWebhookRoutes],
]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  await clearDb();
  (scheduleKOTPrint as jest.Mock).mockClear();
  (scheduleOrderReceiptPrint as jest.Mock).mockClear();
});

let seq = 0;
const rnd = () => `${Date.now()}-${++seq}-${Math.random()}`;

async function payment(hotelId: unknown, orderId: unknown, rupees: number, extra: Record<string, unknown> = {}) {
  return Payment.create({
    hotelId, orderId, internalTransactionId: `TXN-${rnd()}`, gatewayType: 'razorpay',
    amount: Math.round(rupees * 100), currency: 'INR', status: 'success',
    gatewayTransactionId: `pay_${rnd()}`, gatewayOrderId: `order_${rnd()}`, ...extra,
  });
}

// ── R1: staff orders and "paid online" ──────────────────────────────────────

describe('R1 — staff orders are paid online only with a verified payment', () => {
  async function setup() {
    const h = await createHotel();
    const p = await createProduct(h._id, { price: 300, taxPercent: 0 });
    const t = tokenFor(String(h._id));
    const res = await request(app).post('/api/orders').set(auth(t)).send({
      customerName: 'Asha', customerPhone: '9876543210', orderSource: 'takeaway', paymentMethod: 'razorpay',
      items: [{ product: String(p._id), productName: 'X', quantity: 1 }],
    });
    expect(res.status).toBe(201);
    return { h, t, order: res.body };
  }
  const complete = (t: string, id: string, pm = 'razorpay') =>
    request(app).patch(`/api/orders/${id}/status`).set(auth(t)).send({ status: 'completed', paymentMethod: pm });

  test('creating a non-table razorpay order is allowed, but it is NOT paid: missing payment blocks completion', async () => {
    const { t, order } = await setup();
    expect(order.status).toBe('pending');
    const r = await complete(t, order._id);
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('missing');
    expect((await Order.findById(order._id))!.status).toBe('pending');
  });

  test.each([
    ['pending',    { status: 'pending' },    'not_successful'],
    ['processing', { status: 'processing' }, 'not_successful'],
    ['failed',     { status: 'failed' },     'not_successful'],
    ['refunded',   { status: 'refunded' },   'refunded'],
  ])('a %s payment does not verify the order', async (_l, extra, reason) => {
    const { h, t, order } = await setup();
    await payment(h._id, order._id, 300, extra);
    const r = await complete(t, order._id);
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe(reason);
  });

  test('a successful payment for the wrong amount does not verify the order', async () => {
    const { h, t, order } = await setup();
    await payment(h._id, order._id, 30); // ₹30 for a ₹300 order
    const r = await complete(t, order._id);
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('amount_mismatch');
  });

  test('a successful payment in another currency does not verify the order', async () => {
    const { h, t, order } = await setup();
    await payment(h._id, order._id, 300, { currency: 'USD' });
    const r = await complete(t, order._id);
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('currency_mismatch');
  });

  test("another order's (or another hotel's) successful payment does not verify this order", async () => {
    const { h, t, order } = await setup();
    const other = await setup();
    await payment(h._id, new mongoose.Types.ObjectId(), 300);       // same hotel, other order
    await payment(other.h._id, order._id, 300);                     // other hotel, this order id
    const r = await complete(t, order._id);
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('missing');
  });

  test('a verified payment completes the order once; a repeated completion is idempotent', async () => {
    const { h, t, order } = await setup();
    await payment(h._id, order._id, 300);
    const r1 = await complete(t, order._id);
    const r2 = await complete(t, order._id);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const o = (await Order.findById(order._id))!;
    expect(o.status).toBe('completed');
    expect(o.paymentMethod).toBe('razorpay');
    expect(scheduleOrderReceiptPrint).toHaveBeenCalledTimes(1);
  });

  test('a verified online order cannot be completed (relabelled) as cash', async () => {
    const { h, t, order } = await setup();
    await payment(h._id, order._id, 300);
    const r = await complete(t, order._id, 'cash');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ONLINE_PAYMENT_CAPTURED');
    expect((await Order.findById(order._id))!.paymentMethod).toBe('razorpay');
  });

  test('a second successful payment for the same order is rejected by the database', async () => {
    const { h, order } = await setup();
    await payment(h._id, order._id, 300);
    await expect(payment(h._id, order._id, 300)).rejects.toMatchObject({ code: 11000 });
  });

  test('a failed staff checkout can be switched to cash and then completed as cash', async () => {
    const { h, t, order } = await setup();
    await payment(h._id, order._id, 300, { status: 'failed' });
    const sw = await request(app).patch(`/api/orders/${order._id}/payment`).set(auth(t)).send({ paymentMethod: 'cash' });
    expect(sw.status).toBe(200);
    const r = await complete(t, order._id, 'cash');
    expect(r.status).toBe(200);
    expect((await Order.findById(order._id))!.paymentMethod).toBe('cash');
  });

  test('switching a cash order to razorpay needs a verified payment (cashier PATCH and admin PUT)', async () => {
    const h = await createHotel();
    const p = await createProduct(h._id, { price: 300, taxPercent: 0 });
    const t = tokenFor(String(h._id));
    const created = await request(app).post('/api/orders').set(auth(t)).send({
      customerName: 'B', customerPhone: '9876543211', orderSource: 'takeaway', paymentMethod: 'cash',
      items: [{ product: String(p._id), productName: 'X', quantity: 1 }],
    });
    const id = created.body._id;
    const patch = await request(app).patch(`/api/orders/${id}/payment`).set(auth(t)).send({ paymentMethod: 'razorpay' });
    expect(patch.status).toBe(400);
    expect(patch.body.code).toBe('ONLINE_PAYMENT_UNVERIFIED');
    const put = await request(app).put(`/api/orders/${id}`).set(auth(t)).send({ paymentMethod: 'razorpay' });
    expect(put.status).toBe(400);
    expect((await Order.findById(id))!.paymentMethod).toBe('cash');

    await payment(h._id, id, 300);
    const ok = await request(app).patch(`/api/orders/${id}/payment`).set(auth(t)).send({ paymentMethod: 'razorpay' });
    expect(ok.status).toBe(200);
    // …and once paid online it cannot be switched back to cash
    const back = await request(app).put(`/api/orders/${id}`).set(auth(t)).send({ paymentMethod: 'cash' });
    expect(back.status).toBe(400);
    expect(back.body.code).toBe('ONLINE_PAYMENT_CAPTURED');
  });
});

// ── Table fixtures ──────────────────────────────────────────────────────────

async function table() {
  const h = await createHotel({ features: { tableSessions: true } });
  const t = await Table.create({ hotelId: h._id, number: ++seq });
  const s = await TableSession.create({ hotelId: h._id, tableId: t._id, tableNumber: String(t.number), status: 'open' });
  return { h, t, s, tok: tokenFor(String(h._id)) };
}
async function guest(ctx: any, n: number, totalAmount: number) {
  return Guest.create({
    hotelId: ctx.h._id, sessionId: ctx.s._id, tableId: ctx.t._id, tableNumber: ctx.s.tableNumber,
    guestNumber: n, displayLabel: `Guest ${n}`, status: 'active', totalAmount,
  });
}
async function order(ctx: any, g: any, amount: number, extra: Record<string, unknown> = {}) {
  return Order.create({
    hotelId: ctx.h._id, sessionId: ctx.s._id, guestId: g._id, orderNumber: `ORD-${rnd()}`,
    status: 'served', orderSource: 'dine-in', paymentMethod: 'cash', tableNumber: ctx.s.tableNumber,
    items: [{ productName: 'Item', quantity: 1, price: amount, total: amount }],
    subtotal: amount, taxTotal: 0, grandTotal: amount, ...extra,
  });
}
const qr = { orderSource: 'qr', paymentMethod: 'razorpay' };
const billGuest = (ctx: any, g: any, body: Record<string, unknown> = { action: 'bill', paymentMethod: 'cash' }) =>
  request(app).patch(`/api/sessions/${ctx.s._id}/guests/${g._id}`).set(auth(ctx.tok)).send(body);
const bulkBill = (ctx: any, body: Record<string, unknown> = { bulkBill: true, paymentMethod: 'cash' }) =>
  request(app).patch(`/api/sessions/${ctx.s._id}/close`).set(auth(ctx.tok)).send(body);

describe('R1 — table orders', () => {
  test('a table order cannot be created as razorpay (explicit guest and auto-linked table)', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);
    const p = await createProduct(ctx.h._id, { price: 100, taxPercent: 0 });
    const base = { customerName: 'C', customerPhone: '9876543212', orderSource: 'dine-in', paymentMethod: 'razorpay',
      items: [{ product: String(p._id), productName: 'X', quantity: 1 }] };
    const r1 = await request(app).post('/api/orders').set(auth(ctx.tok)).send({ ...base, sessionId: String(ctx.s._id), guestId: String(g._id) });
    expect(r1.status).toBe(400);
    expect(r1.body.code).toBe('ONLINE_PAYMENT_NOT_ALLOWED');
    const r2 = await request(app).post('/api/orders').set(auth(ctx.tok)).send({ ...base, tableId: String(ctx.t._id) });
    expect(r2.status).toBe(400);
    expect(await Order.countDocuments({ hotelId: ctx.h._id })).toBe(0);
    expect((await Guest.findById(g._id))!.totalAmount).toBe(0);
  });

  test('legacy unverified "razorpay" order on a guest blocks billing; switching it to cash makes it payable', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);                     // legacy: never added to the amount due
    const o = await order(ctx, g, 250, { paymentMethod: 'razorpay' });
    const blocked = await billGuest(ctx, g);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ONLINE_PAYMENT_UNVERIFIED');
    expect((await Guest.findById(g._id))!.status).toBe('active');
    expect((await Order.findById(o._id))!.status).toBe('served');

    const sw = await request(app).patch(`/api/orders/${o._id}/payment`).set(auth(ctx.tok)).send({ paymentMethod: 'cash' });
    expect(sw.status).toBe(200);
    expect((await Guest.findById(g._id))!.totalAmount).toBe(250);   // now due at the counter
    const ok = await billGuest(ctx, g, { action: 'bill', paymentMethod: 'split', splitDetails: { cash: 250 } });
    expect(ok.status).toBe(200);
    expect(((await Guest.findById(g._id))!.toObject() as any).collectedAmount).toBe(250);
  });

  test('bulk bill is also blocked by an unverified online order, before the table is claimed', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);
    await order(ctx, g, 250, { paymentMethod: 'razorpay' });
    const r = await bulkBill(ctx);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ONLINE_PAYMENT_UNVERIFIED');
    const s = (await TableSession.findById(ctx.s._id))!.toObject() as any;
    expect(s.status).toBe('open');
    expect(s.billingStartedAt ?? null).toBeNull();
  });
});

// ── R2: unresolved online orders and table billing ───────────────────────────

describe('R2 — unresolved online orders block table billing', () => {
  async function pendingScenario() {
    const ctx = await table();
    const g = await guest(ctx, 1, 200);
    const counter = await order(ctx, g, 200);
    const pending = await order(ctx, g, 400, { ...qr, status: 'payment_pending' });
    return { ctx, g, counter, pending };
  }

  test('guest bill with a payment_pending order → 409 with the order and actions; nothing changes', async () => {
    const { ctx, g, counter, pending } = await pendingScenario();
    const r = await billGuest(ctx, g);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ONLINE_PAYMENT_PENDING');
    expect(r.body.orders.map((o: any) => o._id)).toEqual([String(pending._id)]);
    expect(r.body.actions).toEqual(['wait_for_payment', 'cancel_unpaid_order']);
    expect((await Guest.findById(g._id))!.status).toBe('active');
    expect((await Order.findById(counter._id))!.status).toBe('served');
  });

  test('bulk bill with a payment_pending order → 409; table not claimed or closed', async () => {
    const { ctx } = await pendingScenario();
    const r = await bulkBill(ctx);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ONLINE_PAYMENT_PENDING');
    const s = (await TableSession.findById(ctx.s._id))!.toObject() as any;
    expect(s.status).toBe('open');
    expect(s.billingStartedAt ?? null).toBeNull();
  });

  test('a failed payment leaves the order unresolved — billing stays blocked', async () => {
    const { ctx, g, pending } = await pendingScenario();
    await payment(ctx.h._id, pending._id, 400, { status: 'failed' });
    expect((await billGuest(ctx, g)).status).toBe(409);
  });

  test('a guest with a payment_pending order cannot be marked left', async () => {
    const { ctx, g } = await pendingScenario();
    const r = await billGuest(ctx, g, { action: 'left' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ONLINE_PAYMENT_PENDING');
    expect((await Guest.findById(g._id))!.status).toBe('active');
  });

  test('a guest with a paid online order cannot be marked left (the paid order would never be recorded)', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);
    const o = await order(ctx, g, 300, qr);
    await payment(ctx.h._id, o._id, 300);
    const r = await billGuest(ctx, g, { action: 'left' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('GUEST_HAS_PAID_ONLINE_ORDERS');
  });

  test('cancel the unpaid order, then retry: bill succeeds and the cancelled order is not charged or completed', async () => {
    const { ctx, g, counter, pending } = await pendingScenario();
    expect((await billGuest(ctx, g)).status).toBe(409);
    const c = await request(app).patch(`/api/orders/${pending._id}/status`).set(auth(ctx.tok)).send({ status: 'cancelled' });
    expect(c.status).toBe(200);
    const r = await billGuest(ctx, g, { action: 'bill', paymentMethod: 'split', splitDetails: { cash: 200 } });
    expect(r.status).toBe(200);
    expect((await Order.findById(pending._id))!.status).toBe('cancelled');
    expect((await Order.findById(counter._id))!.status).toBe('completed');
    expect(((await Guest.findById(g._id))!.toObject() as any).collectedAmount).toBe(200);
  });

  test('payment succeeds while waiting (qr-verify): order is released, then billed once as razorpay, payment time kept', async () => {
    const { ctx, g, counter, pending } = await pendingScenario();
    await PaymentGatewayConfig.create({ hotelId: ctx.h._id, gatewayType: 'razorpay', displayName: 'Test', isActive: true, isDeleted: false });
    const pay = await payment(ctx.h._id, pending._id, 400, { status: 'processing', gatewayTransactionId: '' });
    const v = await request(app).post('/api/public/payments/qr-verify').send({
      hotelId: String(ctx.h._id), orderId: String(pending._id), internalTransactionId: pay.internalTransactionId,
      razorpay_payment_id: 'pay_live_1', razorpay_order_id: pay.gatewayOrderId, razorpay_signature: 'sig',
    });
    expect(v.status).toBe(200);
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
    const paidAt = (await Order.findById(pending._id))!.toObject() as any;
    expect(paidAt.status).toBe('pending');
    await Order.updateOne({ _id: pending._id }, { $set: { status: 'served', paymentTime: new Date('2026-01-01T10:00:00Z') } });

    const r = await billGuest(ctx, g, { action: 'bill', paymentMethod: 'split', splitDetails: { cash: 200 } });
    expect(r.status).toBe(200);
    const q = (await Order.findById(pending._id))!.toObject() as any;
    expect(q.status).toBe('completed');
    expect(q.paymentMethod).toBe('razorpay');
    expect(q.settledVia).toBe('guest');
    expect(new Date(q.paymentTime).toISOString()).toBe('2026-01-01T10:00:00.000Z'); // online time, not bill time
    expect((await Order.findById(counter._id))!.paymentMethod).toBe('split'); // counter method of this bill
    expect(((await Guest.findById(g._id))!.toObject() as any).collectedAmount).toBe(200); // prepaid not collected again
    // a second bill request is refused — no second completion
    expect((await billGuest(ctx, g)).status).toBe(409);
  });

  test('duplicate callbacks (webhook twice + qr-verify) release the order exactly once', async () => {
    const { ctx, pending } = await pendingScenario();
    await PaymentGatewayConfig.create({ hotelId: ctx.h._id, gatewayType: 'razorpay', displayName: 'Test', isActive: true, isDeleted: false, webhookSecretEnc: 'x' });
    const pay = await payment(ctx.h._id, pending._id, 400, { status: 'processing', gatewayTransactionId: '' });
    const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_dup_1', order_id: pay.gatewayOrderId, method: 'upi' } } } };
    const hook = () => request(app).post(`/api/payment-webhooks/razorpay/${ctx.h._id}`).send(event);
    expect((await hook()).status).toBe(200);
    expect((await hook()).status).toBe(200);
    const v = await request(app).post('/api/public/payments/qr-verify').send({
      hotelId: String(ctx.h._id), orderId: String(pending._id), internalTransactionId: pay.internalTransactionId,
      razorpay_payment_id: 'pay_dup_1', razorpay_order_id: pay.gatewayOrderId, razorpay_signature: 'sig',
    });
    expect(v.status).toBe(200);
    expect((await Order.findById(pending._id))!.status).toBe('pending');
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
    expect(await Payment.countDocuments({ orderId: pending._id, status: 'success' })).toBe(1);
  });

  test('late success after the guest was billed: not released, kept for reconciliation (qr-verify + webhook)', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);
    const late = await order(ctx, g, 400, { ...qr, status: 'payment_pending' });
    // The race the billing check cannot see: the guest got billed anyway.
    await Guest.updateOne({ _id: g._id }, { $set: { status: 'billed' } });
    await PaymentGatewayConfig.create({ hotelId: ctx.h._id, gatewayType: 'razorpay', displayName: 'Test', isActive: true, isDeleted: false, webhookSecretEnc: 'x' });
    const pay = await payment(ctx.h._id, late._id, 400, { status: 'processing', gatewayTransactionId: '' });

    const v = await request(app).post('/api/public/payments/qr-verify').send({
      hotelId: String(ctx.h._id), orderId: String(late._id), internalTransactionId: pay.internalTransactionId,
      razorpay_payment_id: 'pay_late_1', razorpay_order_id: pay.gatewayOrderId, razorpay_signature: 'sig',
    });
    expect(v.status).toBe(409);
    expect(v.body.code).toBe('PAYMENT_RECEIVED_ORDER_NOT_RELEASED');
    const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_late_1', order_id: pay.gatewayOrderId } } } };
    expect((await request(app).post(`/api/payment-webhooks/razorpay/${ctx.h._id}`).send(event)).status).toBe(200);

    expect((await Order.findById(late._id))!.status).toBe('payment_pending'); // never cooked, never completed
    expect(scheduleKOTPrint).not.toHaveBeenCalled();
    expect((await Payment.findById(pay._id))!.status).toBe('success');       // money recorded truthfully
    await new Promise(r => setTimeout(r, 200));                              // audit is fire-and-forget
    expect(await AuditLog.countDocuments({ action: 'payment.late_success_needs_reconciliation', targetId: String(late._id) })).toBeGreaterThanOrEqual(1);
  });

  test('a new online payment cannot be started for an order whose table guest is already billed', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);
    const late = await order(ctx, g, 400, { ...qr, status: 'payment_pending' });
    await Guest.updateOne({ _id: g._id }, { $set: { status: 'billed' } });
    await PaymentGatewayConfig.create({ hotelId: ctx.h._id, gatewayType: 'razorpay', displayName: 'Test', isActive: true, isDeleted: false });
    const r = await request(app).post('/api/public/payments/razorpay-order').send({
      hotelId: String(ctx.h._id), orderId: String(late._id), amount: 400, currency: 'INR',
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TABLE_ALREADY_BILLED');
    expect(await Payment.countDocuments({ orderId: late._id })).toBe(0);
  });

  test('success after the order was cancelled: not released, flagged for reconciliation', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);
    const o = await order(ctx, g, 400, { ...qr, status: 'cancelled' });
    await PaymentGatewayConfig.create({ hotelId: ctx.h._id, gatewayType: 'razorpay', displayName: 'Test', isActive: true, isDeleted: false });
    const pay = await payment(ctx.h._id, o._id, 400, { status: 'processing', gatewayTransactionId: '' });
    const v = await request(app).post('/api/public/payments/qr-verify').send({
      hotelId: String(ctx.h._id), orderId: String(o._id), internalTransactionId: pay.internalTransactionId,
      razorpay_payment_id: 'pay_c_1', razorpay_order_id: pay.gatewayOrderId, razorpay_signature: 'sig',
    });
    expect(v.status).toBe(409);
    expect(v.body.reason).toBe('order_cancelled');
    expect((await Order.findById(o._id))!.status).toBe('cancelled');
  });

  test('repeated concurrent bulk-bill requests settle the table exactly once', async () => {
    const ctx = await table();
    const g1 = await guest(ctx, 1, 200);
    await order(ctx, g1, 200);
    const prepaid = await order(ctx, g1, 300, qr);
    await payment(ctx.h._id, prepaid._id, 300);
    const [a, b] = await Promise.all([bulkBill(ctx), bulkBill(ctx)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const s = (await TableSession.findById(ctx.s._id))!.toObject() as any;
    expect(s.status).toBe('closed');
    expect(s.collectedAmount).toBe(200);
    expect((await Order.findById(prepaid._id))!.paymentMethod).toBe('razorpay');
  });

  test('plain close is refused while an unpaid online order remains on the table', async () => {
    const ctx = await table();
    const g = await guest(ctx, 1, 0);
    await order(ctx, g, 400, { ...qr, status: 'payment_pending' });
    await Guest.updateOne({ _id: g._id }, { $set: { status: 'left' } }); // legacy / race
    const r = await request(app).patch(`/api/sessions/${ctx.s._id}/close`).set(auth(ctx.tok)).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ONLINE_PAYMENT_PENDING');
    expect((await TableSession.findById(ctx.s._id))!.status).toBe('open');
  });
});
