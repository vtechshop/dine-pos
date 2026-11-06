/**
 * When a dish goes in / out of stock on the POS, Swiggy / Zomato follow:
 * kitchen or admin switch, admin edit/delete, stock sold out by an order, and an
 * order cancel that puts stock back. Only enabled platforms where the dish has been
 * synced (has a platform item id) are told; an admin per-platform override wins.
 * The platform call itself is stubbed — nothing leaves the machine.
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
import productRoutes from '../../src/routes/productRoutes';
import orderRoutes from '../../src/routes/orderRoutes';
import AggregatorIntegration from '../../src/models/AggregatorIntegration';
import Settings from '../../src/models/Settings';
import { AggregatorService } from '../../src/services/aggregator/AggregatorService';
import { deliveryAvailable } from '../../src/utils/deliveryAvailabilitySync';

jest.setTimeout(90_000);

const app = makeApp([['/api/products', productRoutes], ['/api/orders', orderRoutes]]);
const push = jest.spyOn(AggregatorService, 'updateItemAvailability').mockResolvedValue(undefined);

beforeAll(startDb);
afterAll(stopDb);
afterEach(async () => { await clearDb(); push.mockClear(); });

/** The push runs in the background after the response — wait for it. */
async function pushes(n: number) {
  for (let i = 0; i < 100 && push.mock.calls.length < n; i++) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 50));   // and make sure no extra ones follow
  return push.mock.calls.map(([integ, itemId, available]) => [(integ as any).platform, itemId, available]);
}

async function setup(productOverrides: Record<string, unknown> = {}) {
  const h = await createHotel();
  await AggregatorIntegration.create({ hotelId: h._id, platform: 'swiggy', enabled: true, storeId: 'S1' });
  await AggregatorIntegration.create({ hotelId: h._id, platform: 'zomato', enabled: false, storeId: 'Z1' });
  const p = await createProduct(h._id, { name: 'Egg Puff', price: 30, taxPercent: 0, platformIds: { swiggy: 'sw-1', zomato: 'zo-1' }, ...productOverrides });
  return { h, p, admin: tokenFor(String(h._id), 'admin') };
}

test('rules: override wins, else POS availability, deleted or 0 stock is off', () => {
  expect(deliveryAvailable({ isAvailable: true, stock: -1 }, 'swiggy')).toBe(true);
  expect(deliveryAvailable({ isAvailable: false }, 'swiggy')).toBe(false);
  expect(deliveryAvailable({ isAvailable: true, stock: 0 }, 'swiggy')).toBe(false);
  expect(deliveryAvailable({ isAvailable: true, isDeleted: true }, 'swiggy')).toBe(false);
  expect(deliveryAvailable({ isAvailable: false, channelAvailability: { swiggy: true } }, 'swiggy')).toBe(true);
  expect(deliveryAvailable({ isAvailable: true, channelAvailability: { swiggy: false, zomato: null } }, 'zomato')).toBe(true);
});

test('kitchen marks a dish out of stock and back: Swiggy follows, disabled Zomato is not called', async () => {
  const { h, p } = await setup();
  await Settings.create({ hotelId: h._id, kitchenPin: 'hashed-pin' });
  const kitchen = tokenFor(String(h._id), 'kitchen');
  expect((await request(app).patch(`/api/products/${p._id}/availability`).set(auth(kitchen)).send({ isAvailable: false })).status).toBe(200);
  expect(await pushes(1)).toEqual([['swiggy', 'sw-1', false]]);
  push.mockClear();
  expect((await request(app).patch(`/api/products/${p._id}/availability`).set(auth(kitchen)).send({ isAvailable: true })).status).toBe(200);
  expect(await pushes(1)).toEqual([['swiggy', 'sw-1', true]]);
});

test('dish not yet on the Swiggy menu, or no platform connected: nothing is sent', async () => {
  const { h, admin } = await setup();
  const local = await createProduct(h._id, { name: 'House Special' });
  await request(app).patch(`/api/products/${local._id}/availability`).set(auth(admin)).send({ isAvailable: false });
  expect(await pushes(0)).toEqual([]);

  const h2 = await createHotel();
  const q = await createProduct(h2._id, { platformIds: { swiggy: 'sw-9' } });
  await request(app).patch(`/api/products/${q._id}/availability`).set(auth(tokenFor(String(h2._id), 'admin'))).send({ isAvailable: false });
  expect(await pushes(0)).toEqual([]);
});

test('admin per-platform override wins over the POS switch', async () => {
  const { p, admin } = await setup({ channelAvailability: { swiggy: true } });
  await request(app).patch(`/api/products/${p._id}/availability`).set(auth(admin)).send({ isAvailable: false });
  expect(await pushes(1)).toEqual([['swiggy', 'sw-1', true]]);
});

test('admin edit of stock / availability and delete are sent; a price edit is not', async () => {
  const { p, admin } = await setup();
  await request(app).put(`/api/products/${p._id}`).set(auth(admin)).send({ price: 35 });
  expect(await pushes(0)).toEqual([]);
  await request(app).put(`/api/products/${p._id}`).set(auth(admin)).send({ stock: 0 });
  expect(await pushes(1)).toEqual([['swiggy', 'sw-1', false]]);
  push.mockClear();
  await request(app).delete(`/api/products/${p._id}`).set(auth(admin));
  expect(await pushes(1)).toEqual([['swiggy', 'sw-1', false]]);
});

test('an order that sells the last one takes it off Swiggy; cancelling puts it back', async () => {
  const { p, admin } = await setup({ stock: 2 });
  const order = (qty: number) => request(app).post('/api/orders').set(auth(admin)).send({
    orderSource: 'takeaway', customerName: 'Ravi', customerPhone: '9876543210',
    items: [{ product: String(p._id), productName: 'Egg Puff', quantity: qty }],
  });
  const first = await order(1);
  expect(first.status).toBe(201);
  expect(await pushes(0)).toEqual([]);            // 1 left — still on sale, nothing sent

  const last = await order(1);
  expect(last.status).toBe(201);
  expect(await pushes(1)).toEqual([['swiggy', 'sw-1', false]]);
  push.mockClear();

  const cancel = await request(app).patch(`/api/orders/${last.body._id}/status`).set(auth(admin)).send({ status: 'cancelled' });
  expect(cancel.status).toBe(200);
  expect(await pushes(1)).toEqual([['swiggy', 'sw-1', true]]);
});
