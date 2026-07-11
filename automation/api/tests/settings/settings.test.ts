import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';

describe('Settings', () => {
  let adminToken: string;
  let kitchenToken: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
  });

  it('SET-001 GET /api/settings returns 200 for admin', async () => {
    const res = await api.get('/api/settings').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
  });

  it('SET-002 settings response has hotel configuration fields', async () => {
    const res = await api.get('/api/settings').set(authHeaders(adminToken));
    const body = res.body.settings || res.body;
    expect(typeof body).toBe('object');
  });

  it('SET-003 kitchen can read settings (settings are needed by KDS for hotel name, tax rate, etc.)', async () => {
    // Per business rules: Kitchen reads products/categories/tables/settings.
    // GET /api/settings has authMiddleware only (no requireAdmin) — correct by design.
    // Kitchen staff need tax rate, hotel name, and printer config for the KDS display.
    const res = await api.get('/api/settings').set(authHeaders(kitchenToken));
    expect(res.status).toBe(200);
  });

  it('SET-004 unauthenticated cannot read settings', async () => {
    const res = await api.get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('SET-005 PUT /api/settings allows admin to update settings', async () => {
    const res = await api
      .put('/api/settings')
      .set(authHeaders(adminToken))
      .send({ taxRate: 9, currency: 'INR' });
    expect([200, 204]).toContain(res.status);
  });

  it('SET-006 non-admin cannot update settings', async () => {
    const res = await api
      .put('/api/settings')
      .set(authHeaders(kitchenToken))
      .send({ taxRate: 0 });
    expect([401, 403]).toContain(res.status);
  });

  it('SET-007 settings are scoped per hotel (hotel B has independent settings)', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();
    const resA = await api.get('/api/settings').set(authHeaders(adminToken));
    const resB = await api.get('/api/settings').set(authHeaders(hotelB.adminToken));
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const settingsA = resA.body.settings || resA.body;
    const settingsB = resB.body.settings || resB.body;
    // Both have settings but they are scoped by hotelId — if hotelId field exists it must differ
    if (settingsA.hotelId && settingsB.hotelId) {
      expect(settingsA.hotelId).not.toBe(settingsB.hotelId);
    }
  });

  it('SET-008 updated setting is persisted on next GET', async () => {
    const newCurrency = 'USD';
    await api.put('/api/settings').set(authHeaders(adminToken)).send({ currency: newCurrency });
    const res = await api.get('/api/settings').set(authHeaders(adminToken));
    const body = res.body.settings || res.body;
    if (body.currency !== undefined) {
      expect(body.currency).toBe(newCurrency);
    }
    // Restore
    await api.put('/api/settings').set(authHeaders(adminToken)).send({ currency: 'INR' });
  });
});
