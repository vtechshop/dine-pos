/**
 * Public ordering → kitchen release (audit 2026-10, step 3).
 *
 * Policy as implemented by the newer route (/api/public/qr/orders) and the
 * customer UI (mobile CustomerCartScreen, qr app):
 *   - 'qr'    (customer's own device): online payment required. Order is
 *             'payment_pending' — no KOT, no kitchen event — until the payment
 *             is verified (qr-verify / webhook).
 *   - 'kiosk' (hotel device, premium kiosk feature): pay-at-counter cash allowed
 *             → 'pending', KOT + kitchen event immediately; or Razorpay.
 * Defect: the legacy /api/public/orders route also accepted 'dine-in' + cash,
 * sending unpaid anonymous orders straight to the kitchen.
 */
import { startDb, stopDb, clearDb, makeApp, createHotel, createProduct } from './harness';

const emitted: Array<{ room: string; event: string }> = [];
jest.mock('../../src/server', () => {
  const mk = (room: string): any => ({
    emit: (event: string) => { emitted.push({ room, event }); },
    to: (r: string) => mk(r),
  });
  return {
    io: {
      to: (room: string) => mk(room),
      in: () => ({ allSockets: async () => new Set() }),
      sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    },
  };
});
jest.mock('../../src/utils/printUtils', () => ({
  ...jest.requireActual('../../src/utils/printUtils'),
  scheduleKOTPrint:          jest.fn().mockResolvedValue(undefined),
  scheduleOrderReceiptPrint: jest.fn().mockResolvedValue(undefined),
  scheduleReceiptPrint:      jest.fn().mockResolvedValue(undefined),
}));

import request from 'supertest';
import menuRoutes from '../../src/routes/menuRoutes';
import qrRoutes from '../../src/routes/qrRoutes';
import Order from '../../src/models/Order';
import PaymentGatewayConfig from '../../src/models/PaymentGatewayConfig';
import { scheduleKOTPrint } from '../../src/utils/printUtils';

jest.setTimeout(90_000);

const app = makeApp([
  ['/api/public/qr', qrRoutes],
  ['/api/public', menuRoutes],
]);

beforeAll(async () => {
  await startDb();
  // server.ts registers the Razorpay gateway at boot; server.ts is mocked here.
  const GatewayFactory = (await import('../../src/services/payment/GatewayFactory')).default;
  const { RazorpayGateway } = await import('../../src/services/payment/providers/RazorpayGateway');
  GatewayFactory.register('razorpay', RazorpayGateway as any);
});
afterAll(stopDb);
afterEach(async () => {
  await clearDb();
  emitted.length = 0;
  (scheduleKOTPrint as jest.Mock).mockClear();
});

const kitchenEvents = () => emitted.filter(e => e.event === 'new_order');

async function setup(features: Record<string, unknown> = {}) {
  const h = await createHotel({ features: { qrOrdering: true, ...features } });
  const p = await createProduct(h._id, { price: 150, taxPercent: 5 });
  const item = { product: String(p._id), productName: 'Paneer Tikka', quantity: 1, price: 1 };
  return { h, item };
}

describe('legacy POST /api/public/orders', () => {
  test("anonymous 'dine-in' cash order is NOT released to the kitchen", async () => {
    const { h, item } = await setup();
    const res = await request(app).post('/api/public/orders').send({
      hotel: String(h._id), orderSource: 'dine-in', paymentMethod: 'cash',
      tableNumber: '7', customerName: 'X', items: [item],
    });
    expect(res.status).toBe(400);
    expect(await Order.countDocuments({ hotelId: h._id })).toBe(0);
    expect(scheduleKOTPrint).not.toHaveBeenCalled();
    expect(kitchenEvents()).toHaveLength(0);
  });

  test("legacy 'source: dine-in' field (no orderSource) is treated as QR too", async () => {
    const { h, item } = await setup();
    const res = await request(app).post('/api/public/orders').send({
      hotel: String(h._id), source: 'dine-in', customerName: 'X', items: [item],
    });
    expect(res.status).toBe(400);
    expect(scheduleKOTPrint).not.toHaveBeenCalled();
  });

  test('malicious body cannot set status/paid fields on a public order', async () => {
    const { h, item } = await setup({ kiosk: true });
    const res = await request(app).post('/api/public/orders').send({
      hotel: String(h._id), orderSource: 'kiosk', paymentMethod: 'cash', customerName: 'X',
      items: [item], status: 'completed', grandTotal: 1, paymentStatus: 'paid',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.grandTotal).toBeCloseTo(157.5); // server price 150 + 5% GST
  });

  test('QR order with online payment stays payment_pending: no KOT, no kitchen event', async () => {
    const { h, item } = await setup();
    await PaymentGatewayConfig.collection.insertOne({
      hotelId: h._id, gatewayType: 'razorpay', displayName: 'RZP', isActive: true, isDeleted: false,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await request(app).post('/api/public/orders').send({
      hotel: String(h._id), orderSource: 'qr', paymentMethod: 'razorpay', customerName: 'X', items: [item],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('payment_pending');
    expect(scheduleKOTPrint).not.toHaveBeenCalled();
    expect(kitchenEvents()).toHaveLength(0);
  });

  test('kiosk pay-at-counter (feature enabled) still goes to the kitchen exactly once, even on retry', async () => {
    const { h, item } = await setup({ kiosk: true });
    const body = { hotel: String(h._id), orderSource: 'kiosk', paymentMethod: 'cash', customerName: 'X', items: [item], offlineId: 'kiosk-retry-0001' };
    const first  = await request(app).post('/api/public/orders').send(body);
    const second = await request(app).post('/api/public/orders').send(body);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('pending');
    expect(second.status).toBe(200);
    expect(String(second.body._id)).toBe(String(first.body._id));
    expect(await Order.countDocuments({ hotelId: h._id })).toBe(1);
    expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
    expect(kitchenEvents()).toHaveLength(1);
  });

  test('kiosk cash is refused when the kiosk feature is off', async () => {
    const { h, item } = await setup({ kiosk: false });
    const res = await request(app).post('/api/public/orders').send({
      hotel: String(h._id), orderSource: 'kiosk', paymentMethod: 'cash', customerName: 'X', items: [item],
    });
    expect(res.status).toBe(403);
    expect(scheduleKOTPrint).not.toHaveBeenCalled();
  });

  test('kitchen events from public orders go to the staff room, not the public room', async () => {
    const { h, item } = await setup({ kiosk: true });
    await request(app).post('/api/public/orders').send({
      hotel: String(h._id), orderSource: 'kiosk', paymentMethod: 'cash', customerName: 'X', items: [item],
    });
    expect(kitchenEvents().every(e => e.room === `hotel_${h._id}`)).toBe(true);
  });
});

describe('POST /api/public/qr/orders', () => {
  test("'dine-in' + cash is treated as QR and refused without online payment", async () => {
    const { h, item } = await setup();
    const res = await request(app).post('/api/public/qr/orders').send({
      hotelId: String(h._id), tableNumber: '3', orderSource: 'dine-in', paymentMethod: 'cash',
      name: 'X', phone: '9876543210', items: [item],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(scheduleKOTPrint).not.toHaveBeenCalled();
    expect(kitchenEvents()).toHaveLength(0);
  });
});
