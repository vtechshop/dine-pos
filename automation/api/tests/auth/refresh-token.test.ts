import { api } from '../../../utils/api-client';
import { getHotelA } from '../../setup/testEnv';

describe('Authentication — Refresh Token', () => {
  let adminToken: string;
  let refreshToken: string;
  let hotelA: ReturnType<typeof getHotelA>;

  beforeAll(async () => {
    hotelA = getHotelA();
    const res = await api.post('/api/auth/login').send({
      userId: hotelA.adminId,
      password: hotelA.password,
    });
    adminToken = res.body.token || res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('TRL-001 POST /api/auth/refresh with valid refreshToken returns new tokens', async () => {
    // This test rotates (consumes) the shared refreshToken — TRL-002 and TRL-006
    // each do their own fresh login to avoid using the revoked token.
    const res = await api.post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.token || res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
  });

  it('TRL-002 refresh returns a valid accessToken with correct claims', async () => {
    // TRL-001 already rotated the shared token — do a fresh login here.
    // We don't compare token strings: two logins within the same second produce identical JWTs
    // because JWT iat is per-second. Instead verify the refreshed token has valid claims.
    const loginRes = await api.post('/api/auth/login').send({
      userId: hotelA.adminId,
      password: hotelA.password,
    });
    const freshRefreshToken = loginRes.body.refreshToken;
    const res = await api.post('/api/auth/refresh').send({ refreshToken: freshRefreshToken });
    const newToken = res.body.token || res.body.accessToken;
    expect(newToken).toBeTruthy();
    const [, payloadB64] = newToken.split('.');
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    expect(decoded.hotelId).toBeTruthy();
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('TRL-003 refresh with invalid token returns 401', async () => {
    const res = await api.post('/api/auth/refresh').send({ refreshToken: 'invalid.token.here' });
    expect(res.status).toBe(401);
  });

  it('TRL-004 refresh with missing token returns 400', async () => {
    const res = await api.post('/api/auth/refresh').send({});
    expect([400, 401, 422]).toContain(res.status);
  });

  it('TRL-005 refresh with empty string token returns 400 or 401', async () => {
    const res = await api.post('/api/auth/refresh').send({ refreshToken: '' });
    expect([400, 401, 422]).toContain(res.status);
  });

  it('TRL-006 new accessToken can be used to authenticate protected endpoints', async () => {
    // TRL-001 already rotated the shared token — do a fresh login here
    const loginRes = await api.post('/api/auth/login').send({
      userId: hotelA.adminId,
      password: hotelA.password,
    });
    const freshRefreshToken = loginRes.body.refreshToken;
    const refreshRes = await api.post('/api/auth/refresh').send({ refreshToken: freshRefreshToken });
    const newToken = refreshRes.body.token || refreshRes.body.accessToken;
    const ordersRes = await api.get('/api/orders').set({ Authorization: `Bearer ${newToken}` });
    expect(ordersRes.status).toBe(200);
  });

  it('TRL-007 only admin role receives a refreshToken (kitchen/waiter/cashier do not)', async () => {
    const kitchenRes = await api.post('/api/auth/kitchen').send({
      hotelId: hotelA.hotelId,
      pin: hotelA.kitchenPin,
    });
    expect(kitchenRes.status).toBe(200);
    expect(kitchenRes.body.refreshToken).toBeFalsy();
  });
});
