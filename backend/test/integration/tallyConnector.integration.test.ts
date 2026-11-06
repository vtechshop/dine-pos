/**
 * Tally connector authentication (audit 2026-10, phase 5).
 *
 * Root cause: /api/integrations/tally (admin router: authMiddleware + requireAdmin
 * at router level) was mounted BEFORE /api/integrations/tally/connector, so every
 * connector request was rejected as an invalid JWT and the bridge could never
 * authenticate. Routers are mounted here via the SAME helper server.ts uses.
 *
 * Mocked: no Tally installation, no bridge, no network. The backend never calls
 * Tally itself — the bridge POSTs the XML to TallyPrime locally.
 */
process.env.PAYMENT_ENCRYPTION_KEY = process.env.PAYMENT_ENCRYPTION_KEY || 'a'.repeat(64);

import { startDb, stopDb, clearDb, tokenFor, auth, createHotel } from './harness';

jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});

import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { sanitizeRequest } from '../../src/utils/sanitizeRequest';
import { mountTallyRoutes } from '../../src/routes/tallyMount';
import { TallyConfig } from '../../src/models/TallyConfig';
import { TallySyncJob } from '../../src/models/TallySyncJob';

jest.setTimeout(60_000);

const app = express();
app.use(express.json());
app.use(sanitizeRequest);
mountTallyRoutes(app);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupConnector(enabled = true) {
  const h = await createHotel({ features: { tally: true } });
  const admin = tokenFor(String(h._id));
  const gen = await request(app).post('/api/integrations/tally/connector-token').set(auth(admin));
  expect(gen.status).toBe(200);
  const connectorToken: string = gen.body.token ?? gen.body.connectorToken;
  expect(connectorToken).toMatch(/^[a-f0-9]{64}$/);
  if (enabled) {
    expect((await request(app).put('/api/integrations/tally/config').set(auth(admin)).send({ enabled: true, companyName: 'Test Co' })).status).toBe(200);
  }
  return { h, admin, connectorToken };
}

describe('connector authentication through the real mount order', () => {
  test('heartbeat with a valid connector token succeeds (was 401 "Invalid or expired session")', async () => {
    const { h, connectorToken } = await setupConnector();
    const res = await request(app).post('/api/integrations/tally/connector/heartbeat').set(bearer(connectorToken));
    expect(res.status).toBe(200);
    const cfg = await TallyConfig.findOne({ hotelId: h._id }).lean();
    expect((cfg as any).connectorLastSeenAt).toBeTruthy();
  });

  test('token is stored encrypted, never in plain text', async () => {
    const { h, connectorToken } = await setupConnector();
    const cfg = await TallyConfig.findOne({ hotelId: h._id }).lean() as any;
    expect(cfg.connectorToken).not.toContain(connectorToken);
  });

  test('poll with nothing pending returns { job: null }', async () => {
    const { connectorToken } = await setupConnector();
    const res = await request(app).post('/api/integrations/tally/connector/poll').set(bearer(connectorToken));
    expect(res.status).toBe(200);
    expect(res.body.job).toBeNull();
  });

  test.each([
    ['wrong token', { Authorization: `Bearer ${'b'.repeat(64)}` }],
    ['malformed token', { Authorization: 'Bearer not-a-token' }],
    ['missing header', {}],
  ])('%s → 401 "Invalid connector token"', async (_n, headers) => {
    await setupConnector();
    const res = await request(app).post('/api/integrations/tally/connector/heartbeat').set(headers as any);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid connector token');
  });

  test('an admin JWT is NOT accepted as a connector token', async () => {
    const { admin } = await setupConnector();
    const res = await request(app).post('/api/integrations/tally/connector/poll').set(auth(admin));
    expect(res.status).toBe(401);
  });

  test('regenerating the token invalidates the old one', async () => {
    const { admin, connectorToken: oldTok } = await setupConnector();
    await request(app).post('/api/integrations/tally/connector-token').set(auth(admin));
    expect((await request(app).post('/api/integrations/tally/connector/heartbeat').set(bearer(oldTok))).status).toBe(401);
  });

  test('a token for a hotel with Tally sync disabled is refused (documents current behaviour)', async () => {
    const { connectorToken } = await setupConnector(false);
    expect((await request(app).post('/api/integrations/tally/connector/heartbeat').set(bearer(connectorToken))).status).toBe(401);
  });

  test("hotel A's connector cannot ack hotel B's job", async () => {
    const a = await setupConnector();
    const b = await setupConnector();
    const jobB = await TallySyncJob.create({
      hotelId: b.h._id, entityType: 'order', entityId: new mongoose.Types.ObjectId(),
      operation: 'create', status: 'syncing', idempotencyKey: `k-${Math.random()}`,
    });
    const res = await request(app).post('/api/integrations/tally/connector/ack').set(bearer(a.connectorToken))
      .send({ jobId: String(jobB._id), success: true });
    expect(res.status).toBe(404);
    expect((await TallySyncJob.findById(jobB._id))!.status).toBe('syncing');
  });

  test('ack success marks the job synced for the owning hotel', async () => {
    const a = await setupConnector();
    const job = await TallySyncJob.create({
      hotelId: a.h._id, entityType: 'order', entityId: new mongoose.Types.ObjectId(),
      operation: 'create', status: 'syncing', idempotencyKey: `k-${Math.random()}`,
    });
    const res = await request(app).post('/api/integrations/tally/connector/ack').set(bearer(a.connectorToken))
      .send({ jobId: String(job._id), success: true, voucherNumber: 'V1' });
    expect(res.status).toBe(200);
    expect((await TallySyncJob.findById(job._id))!.status).toBe('synced');
  });
});

describe('admin Tally routes stay protected', () => {
  test('no JWT → 401; cashier → 403; tally feature off → 403', async () => {
    const h = await createHotel({ features: { tally: true } });
    expect((await request(app).get('/api/integrations/tally/config')).status).toBe(401);
    expect((await request(app).get('/api/integrations/tally/config').set(auth(tokenFor(String(h._id), 'cashier')))).status).toBe(403);
    const off = await createHotel({ features: { tally: false } });
    expect((await request(app).get('/api/integrations/tally/config').set(auth(tokenFor(String(off._id))))).status).toBe(403);
  });

  test('admin can read config without the token ever being returned', async () => {
    const { admin } = await setupConnector();
    const res = await request(app).get('/api/integrations/tally/config').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.connectorTokenSet).toBe(true);
    expect(res.body.connectorToken).toBeUndefined();
  });
});
