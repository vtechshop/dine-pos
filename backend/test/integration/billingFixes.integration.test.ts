/**
 * Billing / order-integrity regression tests (audit 2026-10) — real orderRoutes
 * against an in-memory MongoDB replica set (transactions enabled).
 */
import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel, createProduct } from './harness';

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
jest.mock('../../src/services/whatsappReceiptService', () => ({
  createWhatsAppReceiptJob: jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import mongoose from 'mongoose';
import orderRoutes from '../../src/routes/orderRoutes';
import Order from '../../src/models/Order';
import CustomerProfile from '../../src/models/CustomerProfile';
import WalletTransaction from '../../src/models/WalletTransaction';

jest.setTimeout(60_000);

const app = makeApp([['/api/orders', orderRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const customer = { customerName: 'Ravi', customerPhone: '9876543210' };

async function completedOrder(hotelId: unknown, extra: Record<string, unknown> = {}) {
  return Order.create({
    hotelId, orderNumber: `ORD-${Math.random()}`, status: 'completed', orderSource: 'takeaway',
    paymentMethod: 'cash', completedAt: new Date(),
    items: [{ productName: 'Paneer Tikka', quantity: 1, price: 1000, total: 1000 }],
    subtotal: 1000, taxTotal: 0, grandTotal: 1000, ...customer, ...extra,
  });
}

describe('order creation trusts only DB prices', () => {
  test('a line without a product reference is rejected (no client-set price)', async () => {
    const h = await createHotel();
    const res = await request(app).post('/api/orders').set(auth(tokenFor(String(h._id))))
      .send({ ...customer, items: [{ productName: 'Chicken Biryani', price: 1, taxPercent: 0, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(await Order.countDocuments({ hotelId: h._id })).toBe(0);
  });

  test('a malformed product id is rejected', async () => {
    const h = await createHotel();
    const res = await request(app).post('/api/orders').set(auth(tokenFor(String(h._id))))
      .send({ ...customer, items: [{ product: 'abc', productName: 'X', price: 1, quantity: 1 }] });
    expect(res.status).toBe(422);
  });

  test('client price/tax are overridden by the product record', async () => {
    const h = await createHotel();
    const p = await createProduct(h._id, { price: 200, taxPercent: 5 });
    const res = await request(app).post('/api/orders').set(auth(tokenFor(String(h._id))))
      .send({ ...customer, orderSource: 'takeaway', items: [{ product: String(p._id), productName: 'X', price: 1, taxPercent: 0, quantity: 2 }] });
    expect(res.status).toBe(201);
    // current rule: exclusive tax, per-line rounding — 2 × 200 = 400, 5% = 20
    expect(res.body.subtotal).toBe(400);
    expect(res.body.taxTotal).toBe(20);
    expect(res.body.grandTotal).toBe(420);
  });

  test('an object offlineId is rejected', async () => {
    const h = await createHotel();
    const res = await request(app).post('/api/orders').set(auth(tokenFor(String(h._id))))
      .send({ ...customer, offlineId: ['x'], items: [] });
    // items check runs first for an empty list; use a valid-looking body instead
    const p = await createProduct(h._id);
    const res2 = await request(app).post('/api/orders').set(auth(tokenFor(String(h._id))))
      .send({ ...customer, offlineId: ['x'], items: [{ product: String(p._id), productName: 'X', quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res2.status).toBe(400);
  });
});

describe('PATCH /:id/payment additionalDiscount', () => {
  async function openOrder(hotelId: unknown) {
    return Order.create({
      hotelId, orderNumber: `ORD-${Math.random()}`, status: 'served', orderSource: 'dine-in',
      items: [{ productName: 'Thali', quantity: 1, price: 1000, total: 1000 }],
      subtotal: 1000, taxTotal: 0, grandTotal: 1000, ...customer,
    });
  }

  test('repeating the same discount does not stack', async () => {
    const h = await createHotel({ maxCashierDiscountPercent: 10 });
    const o = await openOrder(h._id);
    const t = tokenFor(String(h._id));
    for (let i = 0; i < 3; i++) {
      const r = await request(app).patch(`/api/orders/${o._id}/payment`).set(auth(t)).send({ additionalDiscount: 100 });
      expect(r.status).toBe(200);
    }
    const after = await Order.findById(o._id);
    expect(after!.grandTotal).toBe(900);
    expect((after as any).additionalDiscount).toBe(100);
  });

  test("cashier cap is checked against the pre-discount total, so repeated calls can't exceed it", async () => {
    const h = await createHotel({ maxCashierDiscountPercent: 10 });
    const o = await openOrder(h._id);
    const cashierId = new mongoose.Types.ObjectId();
    const Cashier = (await import('../../src/models/Cashier')).default;
    await Cashier.create({ _id: cashierId, hotelId: h._id, name: 'C', employeeCode: 'C1', pin: 'x', isActive: true });
    const t = tokenFor(String(h._id), 'cashier', { cashierId: String(cashierId), cashierName: 'C' });

    expect((await request(app).patch(`/api/orders/${o._id}/payment`).set(auth(t)).send({ additionalDiscount: 100 })).status).toBe(200);
    // 150 of the ORIGINAL 1000 is 15% → over the 10% cap (old code compared to the reduced 900)
    expect((await request(app).patch(`/api/orders/${o._id}/payment`).set(auth(t)).send({ additionalDiscount: 150 })).status).toBe(403);
    expect((await Order.findById(o._id))!.grandTotal).toBe(900);
  });
});

describe('completed orders are final', () => {
  test('admin cannot move a completed order back (completed → served)', async () => {
    const h = await createHotel();
    const o = await completedOrder(h._id);
    const res = await request(app).patch(`/api/orders/${o._id}/status`).set(auth(tokenFor(String(h._id)))).send({ status: 'served' });
    expect(res.status).toBe(400);
    expect((await Order.findById(o._id))!.status).toBe('completed');
  });

  test('admin PUT cannot change discountAmount or payment fields of a completed order', async () => {
    const h = await createHotel();
    const o = await completedOrder(h._id);
    const t = tokenFor(String(h._id));
    await request(app).put(`/api/orders/${o._id}`).set(auth(t)).send({ discountAmount: 500 });
    expect((await Order.findById(o._id))!.discountAmount).toBe(0);
    const r = await request(app).put(`/api/orders/${o._id}`).set(auth(t)).send({ paymentMethod: 'upi' });
    expect(r.status).toBe(400);
    expect((await Order.findById(o._id))!.paymentMethod).toBe('cash');
    // non-money fields are still editable
    expect((await request(app).put(`/api/orders/${o._id}`).set(auth(t)).send({ notes: 'ok' })).status).toBe(200);
  });
});

describe('POST /:id/refund', () => {
  test('responds (no hang) and records the refund', async () => {
    const h = await createHotel();
    const o = await completedOrder(h._id);
    const res = await request(app).post(`/api/orders/${o._id}/refund`).set(auth(tokenFor(String(h._id))))
      .send({ reason: 'Wrong item' });
    expect(res.status).toBe(200);
    expect((await Order.findById(o._id) as any).refundAmount).toBe(1000);
  });

  test('concurrent refunds: exactly one succeeds', async () => {
    const h = await createHotel();
    const o = await completedOrder(h._id);
    const t = tokenFor(String(h._id));
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/orders/${o._id}/refund`).set(auth(t)).send({ reason: 'dup' }),
      request(app).post(`/api/orders/${o._id}/refund`).set(auth(t)).send({ reason: 'dup' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  test('wallet money used on the order is credited back with a valid WalletTransaction', async () => {
    const h = await createHotel();
    const prof = await CustomerProfile.create({ hotelId: h._id, customerId: 'CUST-T-1', phone: '+919876543210', name: 'Ravi', walletBalance: 0 });
    const o = await completedOrder(h._id, { walletAmount: 250, walletCustomerId: prof._id });
    const res = await request(app).post(`/api/orders/${o._id}/refund`).set(auth(tokenFor(String(h._id))))
      .send({ reason: 'Refund' });
    expect(res.status).toBe(200);

    // reversal runs in the background after the response — wait for it
    let balance = 0;
    for (let i = 0; i < 40 && balance === 0; i++) {
      await new Promise(r => setTimeout(r, 100));
      balance = ((await CustomerProfile.findById(prof._id)) as any).walletBalance;
    }
    expect(balance).toBe(250);
    const tx = await WalletTransaction.findOne({ customerId: prof._id, source: 'refund' });
    expect(tx).not.toBeNull();
    expect(tx!.amount).toBe(250);
  });
});
