/**
 * Branch authorization (audit 2026-10, step 2).
 *
 * Business rules preserved:
 *   - An HQ admin may switch into any active branch of their org.
 *   - While acting in a branch (token minted by /switch), the HQ admin may hop to
 *     a sibling branch (web BranchSwitcher; MB-S5-11), including after refresh.
 * Fixed:
 *   - A branch's OWN admin (normal branch login) may not switch into siblings,
 *     edit sibling catalog/category config, or read the org-wide sales summary.
 */
import { startDb, stopDb, clearDb, makeApp, tokenFor, auth, createHotel } from './harness';

jest.mock('../../src/server', () => {
  const chain: any = { emit: jest.fn() };
  chain.to = jest.fn(() => chain);
  return { io: { to: jest.fn(() => chain), sockets: { sockets: new Map(), adapter: { rooms: new Map() } } } };
});

import request from 'supertest';
import jwt from 'jsonwebtoken';
import branchRoutes from '../../src/routes/branchRoutes';
import authRoutes from '../../src/routes/authRoutes';
import catalogRoutes from '../../src/routes/catalogRoutes';
import categoryConfigRoutes from '../../src/routes/categoryConfigRoutes';
import reportRoutes from '../../src/routes/reportRoutes';
import Product from '../../src/models/Product';
import Category from '../../src/models/Category';
import BranchProductConfig from '../../src/models/BranchProductConfig';

jest.setTimeout(90_000);

const app = makeApp([
  ['/api/branches', branchRoutes],
  ['/api/auth', authRoutes],
  ['/api/catalog', catalogRoutes],
  ['/api/category-config', categoryConfigRoutes],
  ['/api/reports', reportRoutes],
]);

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

async function org() {
  const hq = await createHotel({ hotelName: 'HQ', features: { multiBranch: true } });
  const a  = await createHotel({ hotelName: 'Branch A', parentHotelId: hq._id, branchCode: 'A1' });
  const b  = await createHotel({ hotelName: 'Branch B', parentHotelId: hq._id, branchCode: 'B1' });
  return { hq, a, b, hqTok: tokenFor(String(hq._id)), aOwnTok: tokenFor(String(a._id)) };
}

describe('POST /api/branches/switch', () => {
  test('HQ admin can switch into a branch', async () => {
    const { a, hqTok } = await org();
    const res = await request(app).post('/api/branches/switch').set(auth(hqTok)).send({ branchId: String(a._id) });
    expect(res.status).toBe(200);
    expect((jwt.decode(res.body.branchToken) as any).hotelId).toBe(String(a._id));
  });

  test('HQ admin acting in branch A can hop to sibling branch B', async () => {
    const { a, b, hqTok } = await org();
    const toA = await request(app).post('/api/branches/switch').set(auth(hqTok)).send({ branchId: String(a._id) });
    const toB = await request(app).post('/api/branches/switch').set(auth(toA.body.branchToken)).send({ branchId: String(b._id) });
    expect(toB.status).toBe(200);
    expect((jwt.decode(toB.body.branchToken) as any).hotelId).toBe(String(b._id));
  });

  test("branch A's own admin cannot switch into sibling branch B", async () => {
    const { b, aOwnTok } = await org();
    const res = await request(app).post('/api/branches/switch').set(auth(aOwnTok)).send({ branchId: String(b._id) });
    expect(res.status).toBe(403);
    expect(res.body.branchToken).toBeUndefined();
  });

  test('an actingOrgId claim for a different org is not honoured', async () => {
    const { a, b } = await org();
    const other = await createHotel({ features: { multiBranch: true } });
    // Even a validly signed claim must match the caller's real parent in the DB.
    const t = tokenFor(String(a._id), 'admin', { actingOrgId: String(other._id) });
    const res = await request(app).post('/api/branches/switch').set(auth(t)).send({ branchId: String(b._id) });
    expect(res.status).toBe(403);
  });

  test('HQ acting authority survives an access-token refresh', async () => {
    const { a, b, hqTok } = await org();
    const toA = await request(app).post('/api/branches/switch').set(auth(hqTok)).send({ branchId: String(a._id) });
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: toA.body.branchRefreshToken });
    expect(refreshed.status).toBe(200);
    const toB = await request(app).post('/api/branches/switch').set(auth(refreshed.body.token)).send({ branchId: String(b._id) });
    expect(toB.status).toBe(200);
  });

  test("a branch's own login refresh does not gain HQ authority", async () => {
    const { a, b } = await org();
    const { generateRefreshToken } = await import('../../src/middleware/auth');
    const { token: rt } = await generateRefreshToken(String(a._id));
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(refreshed.status).toBe(200);
    const res = await request(app).post('/api/branches/switch').set(auth(refreshed.body.token)).send({ branchId: String(b._id) });
    expect(res.status).toBe(403);
  });

  test('cannot switch to a branch of another org', async () => {
    const { hqTok } = await org();
    const otherHq = await createHotel({ features: { multiBranch: true } });
    const foreign = await createHotel({ parentHotelId: otherHq._id, branchCode: 'Z1' });
    const res = await request(app).post('/api/branches/switch').set(auth(hqTok)).send({ branchId: String(foreign._id) });
    expect(res.status).toBe(403);
  });
});

describe('org-level catalog / category config / reports', () => {
  async function hqProduct(hqId: unknown) {
    const cat = await Category.create({ hotelId: hqId, name: 'Mains' });
    const p = await Product.create({ hotelId: hqId, name: 'Dosa', price: 80, taxPercent: 5, category: cat._id, isDeleted: false });
    return { cat, p };
  }

  test("branch A's own admin cannot set sibling B's selling price", async () => {
    const { hq, b, aOwnTok } = await org();
    const { p } = await hqProduct(hq._id);
    const res = await request(app).put(`/api/catalog/branches/${b._id}/products/${p._id}`).set(auth(aOwnTok))
      .send({ enabled: true, sellingPrice: 1 });
    expect(res.status).toBe(403);
    expect(await BranchProductConfig.countDocuments({ branchHotelId: b._id })).toBe(0);
  });

  test("HQ admin can still set a branch's selling price", async () => {
    const { hq, b, hqTok } = await org();
    const { p } = await hqProduct(hq._id);
    const res = await request(app).put(`/api/catalog/branches/${b._id}/products/${p._id}`).set(auth(hqTok))
      .send({ enabled: true, sellingPrice: 90 });
    expect(res.status).toBe(200);
  });

  test("branch A's own admin can read its own branch catalog but not B's", async () => {
    const { a, b, aOwnTok } = await org();
    expect((await request(app).get(`/api/catalog/branches/${a._id}/products`).set(auth(aOwnTok))).status).toBe(200);
    expect((await request(app).get(`/api/catalog/branches/${b._id}/products`).set(auth(aOwnTok))).status).toBe(403);
  });

  test("branch A's own admin cannot change B's category config", async () => {
    const { hq, b, aOwnTok } = await org();
    const { cat } = await hqProduct(hq._id);
    const res = await request(app).put(`/api/category-config/branches/${b._id}/categories/${cat._id}`).set(auth(aOwnTok))
      .send({ enabled: false });
    expect(res.status).toBe(403);
  });

  test("branch A's own admin cannot read the org-wide sales summary; HQ can", async () => {
    const { aOwnTok, hqTok } = await org();
    expect((await request(app).get('/api/reports/org-summary').set(auth(aOwnTok))).status).toBe(403);
    expect((await request(app).get('/api/reports/org-summary').set(auth(hqTok))).status).toBe(200);
  });
});
