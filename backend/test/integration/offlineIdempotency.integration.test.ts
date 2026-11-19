/**
 * Server-side idempotency that the mobile offline queues rely on (phase 4).
 * A retried request with the same offlineId must never create a second order or
 * a second wallet debit — sequentially (lost response) or concurrently.
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
import orderRoutes from '../../src/routes/orderRoutes';
import menuRoutes from '../../src/routes/menuRoutes';
import Order from '../../src/models/Order';
import CustomerProfile from '../../src/models/CustomerProfile';
import WalletTransaction from '../../src/models/WalletTransaction';
import { scheduleKOTPrint } from '../../src/utils/printUtils';

jest.setTimeout(90_000);

const app = makeApp([['/api/orders', orderRoutes], ['/api/public', menuRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => { await clearDb(); (scheduleKOTPrint as jest.Mock).mockClear(); });

async function walletSetup() {
  const h = await createHotel();
  const p = await createProduct(h._id, { price: 200, taxPercent: 0 });
  const prof = await CustomerProfile.create({ hotelId: h._id, customerId: 'CUST-W-1', phone: '+919876543210', name: 'Ravi', walletBalance: 500 });
  const body = {
    customerName: 'Ravi', customerPhone: '9876543210', orderSource: 'takeaway',
    items: [{ product: String(p._id), productName: 'X', quantity: 1 }],
    walletCustomerId: String(prof._id), walletAmount: 150,
    offlineId: 'cashier_1700000000000_abcdef',
  };
  return { h, prof, body, t: tokenFor(String(h._id)) };
}

test('same offlineId sent twice (lost response): one order, one wallet debit', async () => {
  const { h, prof, body, t } = await walletSetup();
  const first  = await request(app).post('/api/orders').set(auth(t)).send(body);
  const second = await request(app).post('/api/orders').set(auth(t)).send(body);
  expect(first.status).toBe(201);
  expect(second.status).toBe(200);
  expect(String(second.body._id)).toBe(String(first.body._id));
  expect(await Order.countDocuments({ hotelId: h._id })).toBe(1);
  expect((await CustomerProfile.findById(prof._id) as any).walletBalance).toBe(350);
  expect(await WalletTransaction.countDocuments({ customerId: prof._id })).toBe(1);
});

test('same offlineId sent concurrently: still one order and one wallet debit', async () => {
  const { h, prof, body, t } = await walletSetup();
  const results = await Promise.all([1, 2, 3].map(() => request(app).post('/api/orders').set(auth(t)).send(body)));
  expect(results.every(r => r.status === 200 || r.status === 201)).toBe(true);
  expect(new Set(results.map(r => String(r.body._id))).size).toBe(1);
  expect(await Order.countDocuments({ hotelId: h._id })).toBe(1);
  expect((await CustomerProfile.findById(prof._id) as any).walletBalance).toBe(350);
  expect(await WalletTransaction.countDocuments({ customerId: prof._id })).toBe(1);
});

test('kiosk queue retry with the same offlineId: one order, one KOT', async () => {
  const h = await createHotel({ features: { qrOrdering: true, kiosk: true } });
  const p = await createProduct(h._id, { price: 100, taxPercent: 0 });
  const body = {
    hotel: String(h._id), orderSource: 'kiosk', paymentMethod: 'cash', customerName: 'K',
    items: [{ product: String(p._id), productName: 'X', quantity: 1 }],
    offlineId: 'kq_1700000000000_abc12345',
  };
  const results = await Promise.all([1, 2].map(() => request(app).post('/api/public/orders').send(body)));
  expect(results.map(r => r.status).sort()).toEqual([200, 201]);
  expect(await Order.countDocuments({ hotelId: h._id })).toBe(1);
  expect(scheduleKOTPrint).toHaveBeenCalledTimes(1);
});
