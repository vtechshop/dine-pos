/**
 * Pay before kitchen — real routers + in-memory MongoDB replica set.
 *
 * With Settings.payBeforeKitchen on, an unpaid order is held in 'payment_pending': not in
 * the kitchen list, no KOT, no new_order. POST /orders/:id/pay records the payment and
 * releases it to the kitchen. payNow places an order already paid. A paid order is never
 * charged again when the table is billed. With the setting off nothing changes.
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

import request from 'supertest';
import mongoose from 'mongoose';
import orderRoutes from '../../src/routes/orderRoutes';
import Order from '../../src/models/Order';
import Settings from '../../src/models/Settings';
import { io } from '../../src/server';
import { scheduleKOTPrint } from '../../src/utils/printUtils';
import { counterBillingOrderUpdates } from '../../src/utils/counterBilling';

jest.setTimeout(90_000);

const app = makeApp([['/api/orders', orderRoutes]]);
const emitMock = () => (io.to('x') as any).emit as jest.Mock;
const newOrderEmits = () => emitMock().mock.calls.filter(c => c[0] === 'new_order').length;

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => {
  await clearDb();
  (scheduleKOTPrint as jest.Mock).mockClear();
  emitMock().mockClear();
});

async function setup(payBeforeKitchen: boolean) {
  const h = await createHotel();
  await Settings.create({ hotelId: h._id, payBeforeKitchen });
  const p = await createProduct(h._id, { price: 200, taxPercent: 0 });
  const t = tokenFor(String(h._id));
  const place = (extra: Record<string, unknown> = {}) =>
    request(app).post('/api/orders').set(auth(t)).send({
      customerName: 'Asha', customerPhone: '9876543210', orderSource: 'takeaway', isParcel: true,
      paymentMethod: 'cash', items: [{ product: String(p._id), productName: 'Paneer', quantity: 1 }], ...extra,
    });
  const pay = (id: string, body: Record<string, unknown> = { paymentMethod: 'cash' }) =>
    request(app).post(`/api/orders/${id}/pay`).set(auth(t)).send(body);
  const kitchenIds = async () =>
    ((await request(app).get('/api/orders/kitchen').set(auth(t))).body as any[]).map(o => String(o._id));
  const cashierList = async () => (await request(app).get('/api/orders/cashier').set(auth(t))).body as any[];
  return { h, t, place, pay, kitchenIds, cashierList };
}

describe('setting off — unchanged', () => {
  test('an unpaid order goes straight to the kitchen with its KOT and new_order', async () => {
    const s = await setup(false);
    const r = await s.place();
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    expect(r.body.paymentTime ?? null).toBeNull();
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
    expect(newOrderEmits()).toBe(1);
    expect(await s.kitchenIds()).toContain(String(r.body._id));
  });

  test('paying an order already in the kitchen records it as paid and keeps it in the kitchen', async () => {
    const s = await setup(false);
    const { body: o } = await s.place();
    const r = await s.pay(o._id, { paymentMethod: 'upi' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('pending');
    expect(r.body.paymentMethod).toBe('upi');
    expect(r.body.paymentTime).toBeTruthy();
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);   // only the one from placing it
    expect(await s.kitchenIds()).toContain(String(o._id));
  });
});

describe('setting on — pay before kitchen', () => {
  test('an unpaid order is held: no kitchen list, no KOT, no new_order; Pending Bills shows it', async () => {
    const s = await setup(true);
    const r = await s.place();
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('payment_pending');
    expect(scheduleKOTPrint).not.toHaveBeenCalled();
    expect(newOrderEmits()).toBe(0);
    expect(await s.kitchenIds()).not.toContain(String(r.body._id));
    const listed = (await s.cashierList()).find(o => String(o._id) === String(r.body._id));
    expect(listed).toBeTruthy();
    expect(listed.status).toBe('payment_pending');
  });

  test('taking payment releases it to the kitchen with its KOT and new_order, once', async () => {
    const s = await setup(true);
    const { body: o } = await s.place();
    const r = await s.pay(o._id, { paymentMethod: 'card' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('pending');
    expect(r.body.paymentMethod).toBe('card');
    expect(r.body.paymentTime).toBeTruthy();
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
    expect(newOrderEmits()).toBe(1);
    expect(await s.kitchenIds()).toContain(String(o._id));

    const again = await s.pay(o._id);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_PAID');
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
  });

  test('two payments at the same moment: exactly one wins', async () => {
    const s = await setup(true);
    const { body: o } = await s.place();
    const results = await Promise.all([s.pay(o._id), s.pay(o._id), s.pay(o._id)]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(2);
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
  });

  test('payNow places an order already paid, straight into the kitchen', async () => {
    const s = await setup(true);
    const r = await s.place({ payNow: true, paymentMethod: 'upi' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    expect(r.body.paymentTime).toBeTruthy();
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
    expect(newOrderEmits()).toBe(1);
    expect(await s.kitchenIds()).toContain(String(r.body._id));
  });

  test('payNow needs a counter payment method', async () => {
    const s = await setup(true);
    const r = await s.place({ payNow: true, paymentMethod: 'razorpay' });
    expect(r.status).toBe(400);
    expect(await Order.countDocuments()).toBe(0);
  });

  test('split must add up to the bill; invalid methods are refused', async () => {
    const s = await setup(true);
    const { body: o } = await s.place();
    expect((await s.pay(o._id, { paymentMethod: 'split', splitDetails: { cash: 50, upi: 50, card: 0 } })).status).toBe(400);
    expect((await s.pay(o._id, { paymentMethod: 'bitcoin' })).status).toBe(400);
    const ok = await s.pay(o._id, { paymentMethod: 'split', splitDetails: { cash: 100, upi: 100, card: 0 } });
    expect(ok.status).toBe(200);
    expect(ok.body.splitDetails).toMatchObject({ cash: 100, upi: 100, card: 0 });
  });

  test('online orders and closed orders cannot be paid at the counter', async () => {
    const s = await setup(true);
    const { body: o } = await s.place();
    await Order.updateOne({ _id: o._id }, { $set: { paymentMethod: 'razorpay' } });
    const online = await s.pay(o._id);
    expect(online.status).toBe(409);
    expect(online.body.code).toBe('ONLINE_PAYMENT_PENDING');

    await Order.updateOne({ _id: o._id }, { $set: { paymentMethod: 'cash', status: 'completed' } });
    const closed = await s.pay(o._id);
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('ORDER_CLOSED');
    expect(scheduleKOTPrint).not.toHaveBeenCalled();
  });

  test('another hotel cannot pay this order', async () => {
    const s = await setup(true);
    const { body: o } = await s.place();
    const other = await createHotel();
    const r = await request(app).post(`/api/orders/${o._id}/pay`).set(auth(tokenFor(String(other._id)))).send({ paymentMethod: 'cash' });
    expect(r.status).toBe(404);
    expect((await Order.findById(o._id).lean())!.status).toBe('payment_pending');
  });
});

describe('table billing never charges an order paid ahead', () => {
  test('a paid-ahead order is closed with its own method; an unpaid one takes the bill method', async () => {
    const h = await createHotel();
    const sessionId = new mongoose.Types.ObjectId();
    const base = {
      hotelId: h._id, sessionId, items: [{ productName: 'X', quantity: 1, price: 100, total: 100 }],
      subtotal: 100, taxTotal: 0, grandTotal: 100, orderSource: 'dine-in', status: 'served',
    };
    const paid   = await Order.create({ ...base, orderNumber: 'ORD-1', paymentMethod: 'upi',  paymentTime: new Date('2026-10-31T09:00:00Z') });
    const unpaid = await Order.create({ ...base, orderNumber: 'ORD-2', paymentMethod: 'cash', paymentTime: null });

    const u = counterBillingOrderUpdates({ sessionId }, 'card', { paymentTime: new Date('2026-10-31T12:00:00Z') });
    await Order.updateMany(u.counter.filter, u.counter.update as any);
    await Order.updateMany(u.prepaid.filter, u.prepaid.update as any);

    const p = await Order.findById(paid._id).lean() as any;
    const q = await Order.findById(unpaid._id).lean() as any;
    expect(p.status).toBe('completed');
    expect(p.paymentMethod).toBe('upi');                                        // not re-charged as card
    expect(new Date(p.paymentTime).toISOString()).toBe('2026-10-31T09:00:00.000Z'); // keeps when it was paid
    expect(q.status).toBe('completed');
    expect(q.paymentMethod).toBe('card');
  });
});
