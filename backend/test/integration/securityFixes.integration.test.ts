/**
 * Security regression tests (audit 2026-10) — run against real routers + an
 * in-memory MongoDB replica set. See test/integration/harness.ts.
 */
import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel } from './harness';

// Routes import `io` from server.ts; never boot the real server in tests.
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});
jest.mock('../../src/utils/printUtils', () => ({
  ...jest.requireActual('../../src/utils/printUtils'),
  scheduleKOTPrint:          jest.fn().mockResolvedValue(undefined),
  scheduleOrderReceiptPrint: jest.fn().mockResolvedValue(undefined),
  scheduleReceiptPrint:      jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import authRoutes from '../../src/routes/authRoutes';
import ticketRoutes from '../../src/routes/ticketRoutes';
import saasBillingRoutes from '../../src/routes/saasBillingRoutes';
import publicPaymentRoutes from '../../src/routes/publicPaymentRoutes';
import Order from '../../src/models/Order';
import Payment from '../../src/models/Payment';
import Waiter from '../../src/models/Waiter';
import Ticket from '../../src/models/Ticket';
import PrintJob from '../../src/models/PrintJob';
import { flushablePrintJobsFilter } from '../../src/utils/printFlush';
import { stripOperators } from '../../src/utils/sanitizeRequest';

jest.setTimeout(60_000);

const app = makeApp([
  ['/api/auth', authRoutes],
  ['/api/tickets', ticketRoutes],
  ['/api/saas', saasBillingRoutes],
  ['/api/public/payments', publicPaymentRoutes],
]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

// ── Operator injection ────────────────────────────────────────────────────────

describe('Mongo operator injection', () => {
  test('stripOperators removes nested $ keys and keeps normal data', () => {
    expect(stripOperators({ a: { b: [{ $gt: 1, ok: 2 }] } })).toEqual({ a: { b: [{ ok: 2 }] } });
    const data = { price: 10, note: '$5 off', tags: ['$x'] };
    expect(stripOperators(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  test('staff PIN login rejects an object hotelId (no JWT with an operator is minted)', async () => {
    const a = await createHotel();
    await Waiter.create({ hotelId: a._id, name: 'W', employeeCode: 'ZQ91', pin: await bcrypt.hash('1234', 4) });

    const res = await request(app).post('/api/auth/waiter').send({
      hotelId: { $in: [String(a._id), new mongoose.Types.ObjectId().toString()] },
      employeeCode: 'ZQ91', pin: '1234',
    });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test('staff PIN login rejects a non-string hotelId even without $ keys', async () => {
    const res = await request(app).post('/api/auth/waiter').send({
      hotelId: ['aaaaaaaaaaaaaaaaaaaaaaaa'], employeeCode: 'X', pin: '1234',
    });
    expect(res.status).toBe(400);
  });

  test('normal waiter login still works, and hotelId case/whitespace is normalised', async () => {
    const a = await createHotel();
    await Waiter.create({ hotelId: a._id, name: 'W', employeeCode: 'ZQ91', pin: await bcrypt.hash('1234', 4) });
    const res = await request(app).post('/api/auth/waiter').send({
      hotelId: ` ${String(a._id).toUpperCase()} `, employeeCode: ' zq91 ', pin: '1234',
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  test('wrong employee code and wrong PIN return the same message (no code enumeration)', async () => {
    const a = await createHotel();
    await Waiter.create({ hotelId: a._id, name: 'W', employeeCode: 'ZQ91', pin: await bcrypt.hash('1234', 4) });
    const badCode = await request(app).post('/api/auth/waiter').send({ hotelId: String(a._id), employeeCode: 'NOPE', pin: '1234' });
    const badPin  = await request(app).post('/api/auth/waiter').send({ hotelId: String(a._id), employeeCode: 'ZQ91', pin: '9999' });
    expect(badCode.status).toBe(401);
    expect(badPin.status).toBe(401);
    expect(badCode.body.message).toBe(badPin.body.message);
  });

  test('authMiddleware rejects a token whose hotelId is not a plain id string', async () => {
    const a = await createHotel();
    const evil = tokenFor({ $ne: null }, 'waiter', { waiterId: 'x' });
    const res = await request(app).get(`/api/tickets/hotel/${a.phone}`).set(auth(evil));
    expect(res.status).toBe(401);
  });

  test('query-string operators are neutralised globally (?x[$ne]=1 never reaches a query)', async () => {
    const res = await request(app).get('/api/saas/status-public?hotelId[$ne]=1');
    expect(res.status).toBe(400);
  });
});

// ── QR payment verification ──────────────────────────────────────────────────

describe('qr-verify payment binding', () => {
  async function makeOrder(hotelId: unknown, status: string) {
    return Order.create({
      hotelId, orderNumber: `ORD-${Math.random()}`, status, orderSource: 'qr', paymentMethod: 'razorpay',
      items: [{ productName: 'Biryani', quantity: 1, price: 500, total: 500 }],
      subtotal: 500, taxTotal: 0, grandTotal: 500,
    });
  }

  test("a successful payment for order A cannot release unpaid order B", async () => {
    const h = await createHotel();
    const orderA = await makeOrder(h._id, 'pending');          // A was paid and released
    const orderB = await makeOrder(h._id, 'payment_pending');  // B was never paid
    await Payment.create({
      hotelId: h._id, orderId: orderA._id, internalTransactionId: 'TXN-A',
      gatewayType: 'razorpay', amount: 50000, status: 'success', gatewayTransactionId: 'pay_A',
    });

    const res = await request(app).post('/api/public/payments/qr-verify').send({
      hotelId: String(h._id), orderId: String(orderB._id), internalTransactionId: 'TXN-A',
      razorpay_payment_id: 'x', razorpay_order_id: 'x', razorpay_signature: 'x',
    });
    expect(res.status).toBe(422);
    expect((await Order.findById(orderB._id))!.status).toBe('payment_pending');
  });

  test('crash-recovery still releases the order the payment belongs to', async () => {
    const h = await createHotel();
    const orderA = await makeOrder(h._id, 'payment_pending');
    await Payment.create({
      hotelId: h._id, orderId: orderA._id, internalTransactionId: 'TXN-A2',
      gatewayType: 'razorpay', amount: 50000, status: 'success', gatewayTransactionId: 'pay_A2',
    });
    const res = await request(app).post('/api/public/payments/qr-verify').send({
      hotelId: String(h._id), orderId: String(orderA._id), internalTransactionId: 'TXN-A2',
      razorpay_payment_id: 'x', razorpay_order_id: 'x', razorpay_signature: 'x',
    });
    expect(res.status).toBe(200);
    expect((await Order.findById(orderA._id))!.status).toBe('pending');
  });

  test('operator-object internalTransactionId is rejected', async () => {
    const h = await createHotel();
    const o = await makeOrder(h._id, 'payment_pending');
    const res = await request(app).post('/api/public/payments/qr-verify').send({
      hotelId: String(h._id), orderId: String(o._id), internalTransactionId: { $gt: '' },
      razorpay_payment_id: 'x', razorpay_order_id: 'x', razorpay_signature: 'x',
    });
    expect(res.status).toBe(400);
  });

  test('non-string payment fields are rejected', async () => {
    const h = await createHotel();
    const o = await makeOrder(h._id, 'payment_pending');
    const res = await request(app).post('/api/public/payments/qr-verify').send({
      hotelId: String(h._id), orderId: String(o._id), internalTransactionId: 12345,
      razorpay_payment_id: 'x', razorpay_order_id: 'x', razorpay_signature: 'x',
    });
    expect(res.status).toBe(400);
  });

  test('razorpay-order rejects a non-INR currency', async () => {
    const h = await createHotel();
    const o = await makeOrder(h._id, 'payment_pending');
    const res = await request(app).post('/api/public/payments/razorpay-order').send({
      hotelId: String(h._id), orderId: String(o._id), amount: 500, currency: 'IDR',
    });
    expect(res.status).toBe(400);
    expect(await Payment.countDocuments({ orderId: o._id })).toBe(0);
  });

  test('razorpay-order refuses orders that are not awaiting payment', async () => {
    const h = await createHotel();
    const o = await makeOrder(h._id, 'completed');
    const res = await request(app).post('/api/public/payments/razorpay-order').send({
      hotelId: String(h._id), orderId: String(o._id), amount: 500,
    });
    expect(res.status).toBe(409);
    expect(await Payment.countDocuments({ orderId: o._id })).toBe(0);
  });
});

// ── Support tickets ──────────────────────────────────────────────────────────

describe('support tickets are tenant-scoped', () => {
  test("hotel B cannot read or reply to hotel A's tickets", async () => {
    const a = await createHotel();
    const b = await createHotel();
    const created = await request(app).post('/api/tickets').set(auth(tokenFor(String(a._id))))
      .send({ subject: 'Printer', description: 'Not printing', hotelName: 'SPOOF', hotelPhone: b.phone });
    expect(created.status).toBe(201);
    // identity comes from the DB, not the body
    expect(created.body.hotelPhone).toBe(a.phone);
    expect(created.body.hotelName).toBe('Test Hotel');

    const bRead = await request(app).get(`/api/tickets/hotel/${a.phone}`).set(auth(tokenFor(String(b._id))));
    expect(bRead.status).toBe(200);
    expect(bRead.body).toHaveLength(0);

    const bReply = await request(app).post(`/api/tickets/${created.body._id}/reply`)
      .set(auth(tokenFor(String(b._id)))).send({ message: 'hijack' });
    expect(bReply.status).toBe(404);

    const aRead = await request(app).get('/api/tickets/hotel/ignored').set(auth(tokenFor(String(a._id))));
    expect(aRead.body).toHaveLength(1);
  });

  test('legacy tickets without hotelId stay visible to their own hotel (matched by phone)', async () => {
    const a = await createHotel();
    await Ticket.collection.insertOne({
      hotelName: 'Old', hotelPhone: a.phone, subject: 's', description: 'd',
      status: 'open', replies: [], createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await request(app).get('/api/tickets/hotel/x').set(auth(tokenFor(String(a._id))));
    expect(res.body).toHaveLength(1);
  });

  test('super-admin credential headers are refused in production', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.SUPER_ADMIN_ID = 'sa'; process.env.SUPER_ADMIN_PASS = 'pw';
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).get('/api/tickets').set({ 'x-super-admin-id': 'sa', 'x-super-admin-pass': 'pw' });
      expect(res.status).toBe(401);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});

// ── SaaS billing ─────────────────────────────────────────────────────────────

describe('SaaS billing mutations are owner-only', () => {
  test.each(['kitchen', 'waiter', 'cashier'] as const)('%s token cannot cancel or subscribe', async role => {
    const h = await createHotel();
    const t = tokenFor(String(h._id), role);
    expect((await request(app).post('/api/saas/cancel').set(auth(t))).status).toBe(403);
    expect((await request(app).post('/api/saas/subscribe').set(auth(t))).status).toBe(403);
    expect((await request(app).get('/api/saas/invoices').set(auth(t))).status).toBe(403);
  });
});

// ── Printer reconnect flush ──────────────────────────────────────────────────

describe('printer reconnect flush', () => {
  test('single-mode audit receipts are never re-sent; dual-mode pending jobs are', async () => {
    const h = await createHotel();
    const base = { hotelId: h._id, jobType: 'receipt', printerTarget: 'cashier', payload: { x: 1 } };
    await PrintJob.create({ ...base, printerMode: 'single', status: 'pending' });
    const dual = await PrintJob.create({ ...base, printerMode: 'dual', status: 'pending' });
    const failedDual = await PrintJob.create({ ...base, printerMode: 'dual', status: 'failed', attemptCount: 1 });
    await PrintJob.create({ ...base, printerMode: 'dual', status: 'failed', attemptCount: 3 }); // exhausted

    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const jobs = await PrintJob.find(flushablePrintJobsFilter(String(h._id), 'cashier', since)).lean();
    expect(jobs.map(j => String(j._id)).sort()).toEqual([String(dual._id), String(failedDual._id)].sort());
  });
});
