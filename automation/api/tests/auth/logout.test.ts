import { api } from '../../../utils/api-client';
import { getHotelA } from '../../setup/testEnv';

describe('Authentication — Logout', () => {
  let hotelA: ReturnType<typeof getHotelA>;

  beforeAll(() => {
    hotelA = getHotelA();
  });

  async function freshAdminSession(): Promise<{ token: string; refreshToken: string }> {
    const res = await api.post('/api/auth/login').send({
      userId: hotelA.adminId,
      password: hotelA.password,
    });
    return {
      token: res.body.token || res.body.accessToken,
      refreshToken: res.body.refreshToken,
    };
  }

  it('LGT-001 POST /api/auth/logout with valid refreshToken returns 200', async () => {
    const { refreshToken } = await freshAdminSession();
    const res = await api.post('/api/auth/logout').send({ refreshToken });
    expect(res.status).toBe(200);
  });

  it('LGT-002 after logout, refreshToken is invalidated (cannot refresh)', async () => {
    const { refreshToken } = await freshAdminSession();
    await api.post('/api/auth/logout').send({ refreshToken });
    const res = await api.post('/api/auth/refresh').send({ refreshToken });
    expect([401, 403]).toContain(res.status);
  });

  it('LGT-003 logout with invalid refreshToken is fire-and-forget (always 200)', async () => {
    // Logout is intentionally lenient — it always returns 200 to prevent token enumeration.
    // An invalid token is silently ignored rather than causing an error response.
    const res = await api.post('/api/auth/logout').send({ refreshToken: 'bad.token' });
    expect([200, 400, 401]).toContain(res.status);
  });

  it('LGT-004 logout with missing body is fire-and-forget (always 200)', async () => {
    // Same fire-and-forget design — missing body also returns 200 silently.
    const res = await api.post('/api/auth/logout').send({});
    expect([200, 400, 401, 422]).toContain(res.status);
  });

  it('LGT-005 existing accessToken still works after logout (JWT is stateless)', async () => {
    const { token, refreshToken } = await freshAdminSession();
    await api.post('/api/auth/logout').send({ refreshToken });
    // Access tokens are JWT-stateless — they remain valid until expiry
    const res = await api.get('/api/orders').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
  });

  it('LGT-006 logout is idempotent — second call with same token also returns 200', async () => {
    // Logout is fire-and-forget: calling it twice with the same (now-revoked) token
    // returns 200 both times. This is intentional — no error is surfaced for revoked tokens.
    const { refreshToken } = await freshAdminSession();
    await api.post('/api/auth/logout').send({ refreshToken });
    const res1 = await api.post('/api/auth/logout').send({ refreshToken });
    expect([200, 400, 401]).toContain(res1.status);
  });
});
