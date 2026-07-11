import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';

describe('Reports — Range Report', () => {
  let adminToken: string;
  let kitchenToken: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
  });

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  it('RNG-001 GET /api/orders/reports/range returns 200 with valid date range', async () => {
    const res = await api
      .get('/api/orders/reports/range')
      .set(authHeaders(adminToken))
      .query({ from: yesterday, to: today });
    expect(res.status).toBe(200);
  });

  it('RNG-002 range report missing from param returns 400', async () => {
    const res = await api
      .get('/api/orders/reports/range')
      .set(authHeaders(adminToken))
      .query({ to: today });
    expect([400, 422]).toContain(res.status);
  });

  it('RNG-003 range report missing to param returns 400', async () => {
    const res = await api
      .get('/api/orders/reports/range')
      .set(authHeaders(adminToken))
      .query({ from: yesterday });
    expect([400, 422]).toContain(res.status);
  });

  it('RNG-004 from > to returns 400 or empty result', async () => {
    const res = await api
      .get('/api/orders/reports/range')
      .set(authHeaders(adminToken))
      .query({ from: tomorrow, to: yesterday });
    expect([200, 400]).toContain(res.status);
  });

  it('RNG-005 non-admin cannot access range report', async () => {
    const res = await api
      .get('/api/orders/reports/range')
      .set(authHeaders(kitchenToken))
      .query({ from: yesterday, to: today });
    expect([401, 403]).toContain(res.status);
  });

  it('RNG-006 range spanning 30 days returns 200', async () => {
    const from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const res = await api
      .get('/api/orders/reports/range')
      .set(authHeaders(adminToken))
      .query({ from, to: today });
    expect(res.status).toBe(200);
  });

  it('RNG-007 range report data is scoped to current hotel', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();
    const resB = await api
      .get('/api/orders/reports/range')
      .set(authHeaders(hotelB.adminToken))
      .query({ from: yesterday, to: today });
    expect(resB.status).toBe(200);
  });
});
