import { api } from '../../../utils/api-client';
import { superAdminHeaders } from '../../../utils/env';
import { hotelRegistrationPayload } from '../../../utils/test-data';
import { freshPhone, freshEmail } from '../../setup/testEnv';

describe('Hotel Registration', () => {
  describe('POST /api/hotels/register', () => {
    it('REG-001 registers a new hotel and returns 201 with hotelId', async () => {
      const payload = hotelRegistrationPayload({ phone: freshPhone(), email: freshEmail() });
      const res = await api.post('/api/hotels/register').send(payload);
      expect(res.status).toBe(201);
      // Registration returns { message, hotelId } — not a hotel object
      const id = res.body.hotelId || res.body.hotel?._id || res.body._id;
      expect(id).toBeDefined();
    });

    it('REG-002 returns 409 when phone already registered', async () => {
      const phone = freshPhone();
      const payload = hotelRegistrationPayload({ phone, email: freshEmail() });
      await api.post('/api/hotels/register').send(payload);
      const res = await api.post('/api/hotels/register').send(
        hotelRegistrationPayload({ phone, email: freshEmail() })
      );
      expect(res.status).toBe(409);
    });

    it('REG-003 returns 400 when required fields are missing', async () => {
      const res = await api.post('/api/hotels/register').send({ hotelName: 'Only Name' });
      expect(res.status).toBe(400);
    });

    it('REG-004 returns 400 for invalid phone format', async () => {
      const res = await api.post('/api/hotels/register').send(
        hotelRegistrationPayload({ phone: 'abc', email: freshEmail() })
      );
      expect([400, 422]).toContain(res.status);
    });

    it('REG-005 returns 400 for invalid email format', async () => {
      const res = await api.post('/api/hotels/register').send(
        hotelRegistrationPayload({ phone: freshPhone(), email: 'not-an-email' })
      );
      expect([400, 422]).toContain(res.status);
    });

    it('REG-006 registered hotel status is pending (not active)', async () => {
      const phone = freshPhone();
      const payload = hotelRegistrationPayload({ phone, email: freshEmail() });
      await api.post('/api/hotels/register').send(payload);
      const res = await api.get(`/api/hotels/status/${phone}`);
      expect(res.status).toBe(200);
      const status = res.body.status || res.body.hotel?.status;
      expect(status).toBe('pending');
    });

    it('REG-007 new hotel cannot login before approval', async () => {
      const payload = hotelRegistrationPayload({ phone: freshPhone(), email: freshEmail() });
      const regRes = await api.post('/api/hotels/register').send(payload);
      // Registration returns { message, hotelId } at top level
      const hotelId = regRes.body.hotelId || regRes.body.hotel?._id || regRes.body._id;
      const res = await api.post('/api/auth/kitchen').send({ hotelId, pin: '0000' });
      expect([400, 401, 403, 404]).toContain(res.status);
    });

    it('REG-008 hotel status endpoint returns correct data for pending hotel', async () => {
      const phone = freshPhone();
      const payload = hotelRegistrationPayload({ phone, email: freshEmail() });
      await api.post('/api/hotels/register').send(payload);
      const res = await api.get(`/api/hotels/status/${phone}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'pending' });
    });

    it('REG-009 hotel status returns 404 for unknown phone', async () => {
      const res = await api.get('/api/hotels/status/0000000001');
      expect(res.status).toBe(404);
    });

    it('REG-010 payload with extra unknown fields is accepted or stripped gracefully', async () => {
      const payload = {
        ...hotelRegistrationPayload({ phone: freshPhone(), email: freshEmail() }),
        hackerField: 'inject',
        __proto__: { polluted: true },
      };
      const res = await api.post('/api/hotels/register').send(payload);
      expect([200, 201, 400]).toContain(res.status);
      if (res.status === 200 || res.status === 201) {
        const body = res.body.hotel || res.body;
        expect(body.hackerField).toBeUndefined();
      }
    });
  });

  describe('Super Admin: Approve / Reject', () => {
    it('REG-011 super admin can approve pending hotel and receives credentials', async () => {
      const payload = hotelRegistrationPayload({ phone: freshPhone(), email: freshEmail() });
      const regRes = await api.post('/api/hotels/register').send(payload);
      // Registration returns { message, hotelId } at top level
      const hotelId = regRes.body.hotelId || regRes.body.hotel?._id || regRes.body._id;

      const approveRes = await api
        .put(`/api/superadmin/hotels/${hotelId}/approve`)
        .set(superAdminHeaders)
        .send({ plan: 'basic', trialDays: 14 });
      expect(approveRes.status).toBe(200);
      // Approve returns { message, hotel, credentials: { adminId, password, kitchenPin }, ... }
      const creds = approveRes.body.credentials || approveRes.body;
      expect(creds.adminId || creds.admin?.userId).toBeDefined();
      expect(creds.password || creds.admin?.password).toBeDefined();
      expect(creds.kitchenPin || creds.kitchen?.pin).toBeDefined();
    });

    it('REG-012 approved hotel status becomes trial', async () => {
      const phone = freshPhone();
      const payload = hotelRegistrationPayload({ phone, email: freshEmail() });
      const regRes = await api.post('/api/hotels/register').send(payload);
      const hotelId = regRes.body.hotelId || regRes.body.hotel?._id || regRes.body._id;
      await api.put(`/api/superadmin/hotels/${hotelId}/approve`).set(superAdminHeaders).send({ plan: 'basic', trialDays: 14 });
      const statusRes = await api.get(`/api/hotels/status/${phone}`);
      expect(['trial', 'active']).toContain(statusRes.body.status || statusRes.body.hotel?.status);
    });

    it('REG-013 super admin can reject pending hotel', async () => {
      const payload = hotelRegistrationPayload({ phone: freshPhone(), email: freshEmail() });
      const regRes = await api.post('/api/hotels/register').send(payload);
      const hotelId = regRes.body.hotelId || regRes.body.hotel?._id || regRes.body._id;
      const res = await api
        .put(`/api/superadmin/hotels/${hotelId}/reject`)
        .set(superAdminHeaders)
        .send({ reason: 'Test rejection' });
      expect(res.status).toBe(200);
      const body = res.body.hotel || res.body;
      expect(body.status).toBe('rejected');
    });

    it('REG-014 approve without super admin headers returns 401 or 403', async () => {
      const payload = hotelRegistrationPayload({ phone: freshPhone(), email: freshEmail() });
      const regRes = await api.post('/api/hotels/register').send(payload);
      const hotelId = regRes.body.hotelId || regRes.body.hotel?._id || regRes.body._id;
      const res = await api.put(`/api/superadmin/hotels/${hotelId}/approve`).send({ plan: 'basic' });
      expect([401, 403]).toContain(res.status);
    });

    it('REG-015 approve nonexistent hotelId returns 404', async () => {
      const res = await api
        .put('/api/superadmin/hotels/000000000000000000000000/approve')
        .set(superAdminHeaders)
        .send({ plan: 'basic' });
      expect([404, 400]).toContain(res.status);
    });
  });
});
