/**
 * GET /api/aggregator/status — Swiggy / Zomato on/off for the cashier top bar.
 * Real router + in-memory MongoDB. Cashier and admin may read it; it returns
 * status only (never keys or store settings) and never creates records.
 */
jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});

import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel } from './harness';
import request from 'supertest';
import AggregatorIntegration from '../../src/models/AggregatorIntegration';
import Cashier from '../../src/models/Cashier';

jest.setTimeout(90_000);

// The router refuses to load without a webhook secret; a test-only placeholder
process.env.AGGREGATOR_SECRET = process.env.AGGREGATOR_SECRET || 'test-only-aggregator-secret';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const aggregatorRoutes = require('../../src/routes/aggregatorRoutes').default;

const app = makeApp([['/api/aggregator', aggregatorRoutes]]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const get = (token: string) => request(app).get('/api/aggregator/status').set(auth(token));

async function cashierToken(hotelId: unknown) {
  const c = await Cashier.create({ hotelId, name: 'Ravi', employeeCode: 'C01', pin: 'x', mobile: '9876543210', isActive: true });
  return tokenFor(String(hotelId), 'cashier', { cashierId: String(c._id), cashierName: 'Ravi' });
}

test('cashier sees Swiggy online and Zomato offline — no keys in the reply', async () => {
  const h = await createHotel({ features: { aggregator: true } });
  await AggregatorIntegration.create({
    hotelId: h._id, platform: 'swiggy', enabled: true, connectionStatus: 'connected',
    storeId: 'STORE-123', apiKeyEnc: 'enc-api-key', apiSecretEnc: 'enc-secret', webhookSecretEnc: 'enc-hook',
  });

  const r = await get(await cashierToken(h._id));
  expect(r.status).toBe(200);
  const by = Object.fromEntries(r.body.platforms.map((p: any) => [p.platform, p]));
  expect(by.swiggy).toMatchObject({ enabled: true, connectionStatus: 'connected', todayOrderCount: 0 });
  expect(by.zomato).toMatchObject({ enabled: false, connectionStatus: 'disconnected' });

  const text = JSON.stringify(r.body);
  for (const secret of ['enc-api-key', 'enc-secret', 'enc-hook', 'STORE-123']) expect(text).not.toContain(secret);
  // Reading status must not create the missing Zomato record
  expect(await AggregatorIntegration.countDocuments({ hotelId: h._id })).toBe(1);
});

test('admin can read it too', async () => {
  const h = await createHotel({ features: { aggregator: true } });
  const r = await get(tokenFor(String(h._id), 'admin'));
  expect(r.status).toBe(200);
  expect(r.body.platforms).toHaveLength(2);
});

test('waiters and kitchen staff cannot', async () => {
  const h = await createHotel({ features: { aggregator: true } });
  expect((await get(tokenFor(String(h._id), 'waiter'))).status).toBe(403);
  expect((await get(tokenFor(String(h._id), 'kitchen'))).status).toBe(403);
});

test('hotels without the Swiggy / Zomato feature get 403 (chips stay hidden)', async () => {
  const h = await createHotel();
  const r = await get(tokenFor(String(h._id), 'admin'));
  expect(r.status).toBe(403);
});

test('another hotel’s integration is never shown', async () => {
  const mine  = await createHotel({ features: { aggregator: true } });
  const other = await createHotel({ features: { aggregator: true } });
  await AggregatorIntegration.create({ hotelId: other._id, platform: 'zomato', enabled: true, connectionStatus: 'connected' });
  const r = await get(tokenFor(String(mine._id), 'admin'));
  const zomato = r.body.platforms.find((p: any) => p.platform === 'zomato');
  expect(zomato).toMatchObject({ enabled: false, connectionStatus: 'disconnected' });
});
