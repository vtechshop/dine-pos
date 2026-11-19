/**
 * Kitchen Display "Mark Served": the kitchen may hand a READY order over (→ served),
 * which takes it off the kitchen list. It still cannot serve an order that is not
 * ready, and cannot complete or cancel orders.
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
import Order from '../../src/models/Order';
import Settings from '../../src/models/Settings';

jest.setTimeout(90_000);

const app = makeApp([['/api/orders', orderRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

async function setup() {
  const h = await createHotel();
  await Settings.create({ hotelId: h._id, kitchenPin: 'hashed-pin' });
  const p = await createProduct(h._id, { name: 'Egg Puff', price: 30, taxPercent: 0 });
  const admin = tokenFor(String(h._id), 'admin');
  const kitchen = tokenFor(String(h._id), 'kitchen');
  const created = await request(app).post('/api/orders').set(auth(admin)).send({
    orderSource: 'takeaway', customerName: 'Ravi', customerPhone: '9876543210',
    items: [{ product: String(p._id), productName: 'Egg Puff', quantity: 1 }],
  });
  expect(created.status).toBe(201);
  return { id: String(created.body._id), kitchen };
}

const setStatus = (id: string, token: string, status: string) =>
  request(app).patch(`/api/orders/${id}/status`).set(auth(token)).send({ status });

test('kitchen cooks and then marks the order served — it leaves the kitchen list', async () => {
  const { id, kitchen } = await setup();
  expect((await setStatus(id, kitchen, 'preparing')).status).toBe(200);
  expect((await setStatus(id, kitchen, 'ready')).status).toBe(200);

  const served = await setStatus(id, kitchen, 'served');
  expect(served.status).toBe(200);
  const doc = await Order.findById(id).lean();
  expect(doc?.status).toBe('served');
  expect(doc?.servedBy).toBe('Kitchen');
  expect(doc?.servedAt).toBeTruthy();

  const list = await request(app).get('/api/orders/kitchen').set(auth(kitchen));
  expect(list.status).toBe(200);
  expect(list.body.map((o: { _id: string }) => String(o._id))).not.toContain(id);
});

test('kitchen cannot serve an order that is not ready yet', async () => {
  const { id, kitchen } = await setup();
  const res = await setStatus(id, kitchen, 'served');
  expect(res.status).toBe(400);
  expect((await Order.findById(id).lean())?.status).toBe('pending');
});

test('kitchen still cannot complete, cancel, or move a served order back', async () => {
  const { id, kitchen } = await setup();
  expect((await setStatus(id, kitchen, 'completed')).status).toBe(403);
  expect((await setStatus(id, kitchen, 'cancelled')).status).toBe(403);
  await setStatus(id, kitchen, 'preparing');
  await setStatus(id, kitchen, 'ready');
  await setStatus(id, kitchen, 'served');
  expect((await setStatus(id, kitchen, 'preparing')).status).toBe(400);
  expect((await setStatus(id, kitchen, 'served')).status).toBe(400);
});
