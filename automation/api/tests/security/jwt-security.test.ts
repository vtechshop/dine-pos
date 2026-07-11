import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';

describe('Security — JWT', () => {
  let adminToken: string;

  beforeAll(() => {
    adminToken = getHotelA().adminToken;
  });

  it('SEC-001 request without Authorization header returns 401', async () => {
    const res = await api.get('/api/orders');
    expect(res.status).toBe(401);
  });

  it('SEC-002 request with malformed JWT returns 401', async () => {
    const res = await api.get('/api/orders').set({ Authorization: 'Bearer not.a.jwt' });
    expect(res.status).toBe(401);
  });

  it('SEC-003 request with "Bearer" prefix missing returns 401', async () => {
    const res = await api.get('/api/orders').set({ Authorization: adminToken });
    expect(res.status).toBe(401);
  });

  it('SEC-004 expired token returns 401', async () => {
    // Expired token (exp = 1) — already expired
    const expiredToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(JSON.stringify({ role: 'admin', hotelId: 'fakeid', exp: 1 })).toString('base64url') +
      '.invalidsignature';
    const res = await api.get('/api/orders').set({ Authorization: `Bearer ${expiredToken}` });
    expect(res.status).toBe(401);
  });

  it('SEC-005 token with tampered payload returns 401', async () => {
    const parts = adminToken.split('.');
    // Tamper payload: change role to superadmin
    const tamperedPayload = Buffer.from(
      JSON.stringify({ role: 'superadmin', hotelId: 'anything' })
    ).toString('base64url');
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const res = await api.get('/api/orders').set({ Authorization: `Bearer ${tampered}` });
    expect(res.status).toBe(401);
  });

  it('SEC-006 JWT signed with wrong secret returns 401', async () => {
    const fakeHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const fakePayload = Buffer.from(JSON.stringify({ role: 'admin', exp: 9999999999 })).toString('base64url');
    const fakeToken = `${fakeHeader}.${fakePayload}.fakesignature`;
    const res = await api.get('/api/orders').set({ Authorization: `Bearer ${fakeToken}` });
    expect(res.status).toBe(401);
  });

  it('SEC-007 none algorithm JWT is rejected', async () => {
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ role: 'admin', hotelId: 'fakeid', exp: 9999999999 })).toString('base64url');
    const noneToken = `${noneHeader}.${payload}.`;
    const res = await api.get('/api/orders').set({ Authorization: `Bearer ${noneToken}` });
    expect(res.status).toBe(401);
  });

  it('SEC-008 super admin endpoint without custom headers returns 401 or 403', async () => {
    const res = await api.get('/api/superadmin/hotels');
    expect([401, 403]).toContain(res.status);
  });

  it('SEC-009 super admin endpoint with JWT (not custom headers) returns 401 or 403', async () => {
    const res = await api.get('/api/superadmin/hotels').set(authHeaders(adminToken));
    expect([401, 403]).toContain(res.status);
  });
});
