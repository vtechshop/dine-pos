import { api } from '../../../utils/api-client';
import { getHotelA } from '../../setup/testEnv';

describe('Authentication — Login', () => {
  let hotelA: ReturnType<typeof getHotelA>;

  beforeAll(() => {
    hotelA = getHotelA();
  });

  describe('Admin Login POST /api/auth/login', () => {
    it('LOG-001 admin login with valid credentials returns 200 and accessToken', async () => {
      const res = await api.post('/api/auth/login').send({
        userId: hotelA.adminId,
        password: hotelA.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.token || res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
    });

    it('LOG-002 admin login with wrong password returns 401', async () => {
      const res = await api.post('/api/auth/login').send({
        userId: hotelA.adminId,
        password: 'wrongpassword',
      });
      expect(res.status).toBe(401);
    });

    it('LOG-003 admin login with nonexistent userId returns 401', async () => {
      const res = await api.post('/api/auth/login').send({
        userId: 'NONEXISTENT_ADMIN',
        password: 'anything',
      });
      expect(res.status).toBe(401);
    });

    it('LOG-004 admin login missing password returns 400', async () => {
      const res = await api.post('/api/auth/login').send({ userId: hotelA.adminId });
      expect([400, 401, 422]).toContain(res.status);
    });

    it('LOG-005 admin login missing userId returns 400', async () => {
      const res = await api.post('/api/auth/login').send({ password: hotelA.password });
      expect([400, 401, 422]).toContain(res.status);
    });

    it('LOG-006 admin token has correct role in JWT payload', async () => {
      const res = await api.post('/api/auth/login').send({
        userId: hotelA.adminId,
        password: hotelA.password,
      });
      const token = res.body.token || res.body.accessToken;
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.role).toBe('admin');
      expect(payload.hotelId).toBe(hotelA.hotelId);
    });
  });

  describe('Kitchen Login POST /api/auth/kitchen', () => {
    it('LOG-007 kitchen login with valid hotelId and pin returns 200', async () => {
      const res = await api.post('/api/auth/kitchen').send({
        hotelId: hotelA.hotelId,
        pin: hotelA.kitchenPin,
      });
      expect(res.status).toBe(200);
      expect(res.body.token || res.body.accessToken).toBeTruthy();
    });

    it('LOG-008 kitchen login with wrong pin returns 401', async () => {
      const res = await api.post('/api/auth/kitchen').send({
        hotelId: hotelA.hotelId,
        pin: '9999',
      });
      expect(res.status).toBe(401);
    });

    it('LOG-009 kitchen login with invalid hotelId returns 401, 403, or 404', async () => {
      // 403 is valid here: Settings not found for the given hotelId → "Kitchen PIN not set"
      const res = await api.post('/api/auth/kitchen').send({
        hotelId: '000000000000000000000000',
        pin: '0000',
      });
      expect([401, 403, 404]).toContain(res.status);
    });

    it('LOG-010 kitchen token has role=kitchen in JWT payload', async () => {
      const res = await api.post('/api/auth/kitchen').send({
        hotelId: hotelA.hotelId,
        pin: hotelA.kitchenPin,
      });
      const token = res.body.token || res.body.accessToken;
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.role).toBe('kitchen');
      expect(payload.hotelId).toBe(hotelA.hotelId);
    });
  });

  describe('Waiter Login POST /api/auth/waiter', () => {
    it('LOG-011 waiter login with valid credentials returns 200', async () => {
      const res = await api.post('/api/auth/waiter').send({
        hotelId: hotelA.hotelId,
        employeeCode: hotelA.waiter.employeeCode,
        pin: hotelA.waiter.pin,
      });
      expect(res.status).toBe(200);
      expect(res.body.token || res.body.accessToken).toBeTruthy();
    });

    it('LOG-012 waiter login with wrong pin returns 401', async () => {
      const res = await api.post('/api/auth/waiter').send({
        hotelId: hotelA.hotelId,
        employeeCode: hotelA.waiter.employeeCode,
        pin: '9999',
      });
      expect(res.status).toBe(401);
    });

    it('LOG-013 waiter login with wrong employeeCode returns 401', async () => {
      const res = await api.post('/api/auth/waiter').send({
        hotelId: hotelA.hotelId,
        employeeCode: 'WXXX',
        pin: hotelA.waiter.pin,
      });
      expect(res.status).toBe(401);
    });

    it('LOG-014 waiter token has role=waiter in JWT payload', async () => {
      const res = await api.post('/api/auth/waiter').send({
        hotelId: hotelA.hotelId,
        employeeCode: hotelA.waiter.employeeCode,
        pin: hotelA.waiter.pin,
      });
      const token = res.body.token || res.body.accessToken;
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.role).toBe('waiter');
    });
  });

  describe('Cashier Login POST /api/auth/cashier', () => {
    it('LOG-015 cashier login with valid credentials returns 200', async () => {
      const res = await api.post('/api/auth/cashier').send({
        hotelId: hotelA.hotelId,
        employeeCode: hotelA.cashier.employeeCode,
        pin: hotelA.cashier.pin,
      });
      expect(res.status).toBe(200);
      expect(res.body.token || res.body.accessToken).toBeTruthy();
    });

    it('LOG-016 cashier login with wrong pin returns 401', async () => {
      const res = await api.post('/api/auth/cashier').send({
        hotelId: hotelA.hotelId,
        employeeCode: hotelA.cashier.employeeCode,
        pin: '9999',
      });
      expect(res.status).toBe(401);
    });

    it('LOG-017 cashier token has role=cashier in JWT payload', async () => {
      const res = await api.post('/api/auth/cashier').send({
        hotelId: hotelA.hotelId,
        employeeCode: hotelA.cashier.employeeCode,
        pin: hotelA.cashier.pin,
      });
      const token = res.body.token || res.body.accessToken;
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      expect(payload.role).toBe('cashier');
    });
  });
});
