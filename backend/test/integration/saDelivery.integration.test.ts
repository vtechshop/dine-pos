/**
 * Super Admin · Delivery (Swiggy / Zomato) read-only views.
 * Real superAdmin router + in-memory MongoDB. Checks: super-admin login is
 * required, numbers come from the stored records, credentials and webhook
 * bodies never leak, CSV reports download and are formula-safe.
 */
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});

// Push SDK is ESM-only and unused here
jest.mock('expo-server-sdk', () => ({ Expo: class { static isExpoPushToken() { return false; } chunkPushNotifications() { return []; } async sendPushNotificationsAsync() { return []; } } }));

process.env.SUPER_ADMIN_JWT_SECRET = process.env.SUPER_ADMIN_JWT_SECRET || 'test-only-super-admin-secret-0123456789abcdef';

import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel } from './harness';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Order from '../../src/models/Order';
import AggregatorIntegration from '../../src/models/AggregatorIntegration';
import WebhookLog from '../../src/models/WebhookLog';
import { todayBusinessDate, startOfBusinessDay } from '../../src/utils/businessDate';

jest.setTimeout(120_000);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const superAdminRoutes = require('../../src/routes/superAdminRoutes').default;
const app = makeApp([['/api/superadmin', superAdminRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const SA = { Authorization: `Bearer ${jwt.sign({ role: 'superadmin' }, process.env.SUPER_ADMIN_JWT_SECRET!)}` };
const get = (path: string) => request(app).get(`/api/superadmin/aggregator${path}`).set(SA);

async function deliveryOrder(hotelId: unknown, platform: 'swiggy' | 'zomato', total: number, extra: Record<string, unknown> = {}) {
  const o = await Order.create({
    hotelId, orderNumber: `ORD-${Math.random()}`, status: 'completed', orderSource: platform, paymentMethod: 'upi',
    items: [{ productName: 'Masala Dosa', quantity: 2, price: total / 2, total }],
    subtotal: total, taxTotal: 0, grandTotal: total, platformCommission: total * 0.2,
    platformOrderId: `P-${Math.random()}`, customerName: 'Ravi', customerPhone: '9876543210', ...extra,
  });
  // Mid-day today (India) so "today" figures include it
  await Order.collection.updateOne({ _id: o._id }, { $set: { createdAt: new Date(startOfBusinessDay(todayBusinessDate()).getTime() + 12 * 3600_000) } });
  return o;
}

async function seed() {
  const malu = await createHotel({ hotelName: 'Malu Hotel', city: 'Coimbatore', features: { aggregator: true } });
  const demo = await createHotel({ hotelName: 'Demo Restaurant', city: 'Chennai' });
  await AggregatorIntegration.create({ hotelId: malu._id, platform: 'swiggy', enabled: true, connectionStatus: 'connected',
    storeId: 'SW-1', apiKeyEnc: 'ENC-SECRET-KEY', apiSecretEnc: 'ENC-SECRET-2', webhookSecretEnc: 'ENC-HOOK', lastTestAt: new Date(), lastTestSuccess: true });
  await AggregatorIntegration.create({ hotelId: malu._id, platform: 'zomato', enabled: true, connectionStatus: 'error',
    lastTestAt: new Date(), lastTestSuccess: false, lastTestMessage: 'Invalid store ID' });
  await deliveryOrder(malu._id, 'swiggy', 400);
  await deliveryOrder(malu._id, 'zomato', 200, { status: 'cancelled' });
  await WebhookLog.create({ hotelId: malu._id, platform: 'swiggy', event: 'new_order', rawBody: '{"customer":"PRIVATE-PAYLOAD"}', status: 'failed', errorMessage: 'Bad signature' });
  return { malu, demo };
}

test('super-admin login is required; a hotel admin token is refused', async () => {
  const { malu } = await seed();
  expect((await request(app).get('/api/superadmin/aggregator/dashboard')).status).toBe(401);
  expect((await request(app).get('/api/superadmin/aggregator/dashboard').set(auth(tokenFor(String(malu._id), 'admin')))).status).toBe(401);
});

test('dashboard: today’s delivery numbers and connection counts', async () => {
  await seed();
  const r = await get('/dashboard');
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({
    totalHotels: 1, swiggyConnected: 1, zomatoConnected: 0, failedIntegrations: 1,
    todayOrders: 2, todayRevenue: 400, todayCancelled: 1,
  });
  expect(r.body.todayCommission).toBeCloseTo(120, 2); // 20% of both orders as stored
  expect(r.body.platformHealth).toMatchObject({ swiggyApi: 'up', zomatoApi: 'degraded' });
});

test('hotels list shows status per platform and never returns keys', async () => {
  await seed();
  const r = await get('/hotels');
  expect(r.status).toBe(200);
  const malu = r.body.hotels.find((h: any) => h.hotelName === 'Malu Hotel');
  expect(malu.featureEnabled).toBe(true);
  expect(malu.swiggy).toMatchObject({ status: 'connected', storeId: 'SW-1', orderCount: 1 });
  expect(malu.zomato).toMatchObject({ status: 'error', lastError: 'Invalid store ID' });
  const demo = r.body.hotels.find((h: any) => h.hotelName === 'Demo Restaurant');
  expect(demo).toMatchObject({ featureEnabled: false, swiggy: null, zomato: null });
  expect(JSON.stringify(r.body)).not.toMatch(/ENC-SECRET|ENC-HOOK/);
});

test('orders feed and platform filter', async () => {
  await seed();
  const all = await get('/orders');
  expect(all.body.total).toBe(2);
  const sw = await get('/orders?platform=swiggy');
  expect(sw.body.orders).toHaveLength(1);
  expect(sw.body.orders[0]).toMatchObject({ platform: 'swiggy', hotelName: 'Malu Hotel', grandTotal: 400, city: 'Coimbatore' });
});

test('webhook log shows size, not the customer payload', async () => {
  await seed();
  const r = await get('/webhooks');
  expect(r.status).toBe(200);
  expect(r.body.logs[0]).toMatchObject({ status: 'failed', errorMessage: 'Bad signature', hotelName: 'Malu Hotel' });
  expect(r.body.logs[0].payloadBytes).toBeGreaterThan(0);
  expect(JSON.stringify(r.body)).not.toContain('PRIVATE-PAYLOAD');
});

test('analytics and alerts; settlement is not a Super Admin view', async () => {
  await seed();
  const an = await get('/analytics');
  expect(an.status).toBe(200);
  expect(an.body.topHotels[0]).toMatchObject({ hotelName: 'Malu Hotel', orders: 1, revenue: 400 });
  expect(an.body.cancellationPct).toBe(50);
  // Swiggy/Zomato settle with each hotel directly — no settlement endpoint or report here
  expect((await get('/settlement')).status).toBe(404);
  expect((await get('/reports/generate?type=settlement')).status).toBe(400);
  const a = await get('/alerts');
  const types = a.body.alerts.map((x: any) => x.type);
  expect(types).toEqual(expect.arrayContaining(['hotel_disconnected', 'webhook_failed']));
});

test('CSV report downloads, has rows, and neutralises spreadsheet formulas', async () => {
  const { malu } = await seed();
  await AggregatorIntegration.updateMany({}, {}); // no-op, keeps seed
  await deliveryOrder(malu._id, 'swiggy', 100, { orderNumber: '=HYPERLINK("x")' });
  const r = await get('/reports/generate?type=aggregator&format=csv');
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toMatch(/text\/csv/);
  expect(r.text).toContain('Malu Hotel');
  expect(r.text).toContain(`"'=HYPERLINK`);
  expect((await get('/reports/generate?type=nope')).status).toBe(400);
});
