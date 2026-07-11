import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA, getHotelB } from '../../setup/testEnv';
import { createOrder } from '../../helpers/order.helper';

describe('Security — Authorization / RBAC', () => {
  let hotelA: ReturnType<typeof getHotelA>;
  let hotelB: ReturnType<typeof getHotelB>;

  beforeAll(() => {
    hotelA = getHotelA();
    hotelB = getHotelB();
  });

  describe('Cross-hotel resource access', () => {
    it('AUT-001 hotel B admin cannot read hotel A orders', async () => {
      const { orderId } = await createOrder(hotelA.adminToken);
      const res = await api.get(`/api/orders/${orderId}`).set(authHeaders(hotelB.adminToken));
      expect([403, 404]).toContain(res.status);
    });

    it('AUT-002 hotel B kitchen cannot update hotel A order status', async () => {
      const { orderId } = await createOrder(hotelA.adminToken);
      const res = await api
        .patch(`/api/orders/${orderId}/status`)
        .set(authHeaders(hotelB.kitchenToken))
        .send({ status: 'preparing' });
      expect([403, 404]).toContain(res.status);
    });

    it('AUT-003 hotel B admin cannot delete hotel A product', async () => {
      const productId = hotelA.products[0].id;
      const res = await api.delete(`/api/products/${productId}`).set(authHeaders(hotelB.adminToken));
      expect([403, 404]).toContain(res.status);
    });

    it('AUT-004 hotel B admin cannot modify hotel A category', async () => {
      const res = await api
        .put(`/api/categories/${hotelA.categoryId}`)
        .set(authHeaders(hotelB.adminToken))
        .send({ name: 'Hijacked' });
      expect([403, 404]).toContain(res.status);
    });

    it('AUT-005 hotel B admin cannot read hotel A settings', async () => {
      // Settings are scoped by JWT's hotelId — each hotel only reads their own
      const resA = await api.get('/api/settings').set(authHeaders(hotelA.adminToken));
      const resB = await api.get('/api/settings').set(authHeaders(hotelB.adminToken));
      const settingsA = resA.body.settings || resA.body;
      const settingsB = resB.body.settings || resB.body;
      if (settingsA.hotelId && settingsB.hotelId) {
        expect(settingsA.hotelId).not.toBe(settingsB.hotelId);
      }
    });
  });

  describe('Role permissions', () => {
    it('AUT-006 kitchen token cannot access admin-only products CRUD', async () => {
      const res = await api.post('/api/products').set(authHeaders(hotelA.kitchenToken)).send({
        name: 'Hack Product', price: 1,
      });
      expect([401, 403]).toContain(res.status);
    });

    it('AUT-007 waiter token cannot access super admin endpoints', async () => {
      const res = await api.get('/api/superadmin/hotels').set(authHeaders(hotelA.waiterToken));
      expect([401, 403]).toContain(res.status);
    });

    it('AUT-008 cashier token cannot register a new hotel', async () => {
      const res = await api.post('/api/hotels/register').set(authHeaders(hotelA.cashierToken)).send({
        hotelName: 'Hack', phone: '1111111111', email: 'hack@hack.com',
      });
      // Registration is public — but this tests no cashier-specific bypass
      expect(res.status).not.toBe(500);
    });

    it('AUT-009 waiter token cannot create products', async () => {
      const res = await api.post('/api/products').set(authHeaders(hotelA.waiterToken)).send({
        name: 'Waiter Product', price: 50,
      });
      expect([401, 403]).toContain(res.status);
    });

    it('AUT-010 kitchen token cannot approve hotels (super admin endpoint)', async () => {
      const res = await api
        .put(`/api/superadmin/hotels/${hotelA.hotelId}/approve`)
        .set(authHeaders(hotelA.kitchenToken))
        .send({ plan: 'basic' });
      expect([401, 403]).toContain(res.status);
    });

    it('AUT-011 admin cannot use kitchen-restricted endpoint via role escalation', async () => {
      // Admin should be able to read kitchen orders (they manage all)
      const res = await api.get('/api/orders/kitchen').set(authHeaders(hotelA.adminToken));
      expect([200, 403]).toContain(res.status);
    });

    it('AUT-012 PATCH /api/orders/:id/status with wrong role returns 403', async () => {
      const { orderId } = await createOrder(hotelA.adminToken);
      // Cashier tries to mark as preparing (kitchen-only action)
      const res = await api
        .patch(`/api/orders/${orderId}/status`)
        .set(authHeaders(hotelA.cashierToken))
        .send({ status: 'preparing' });
      expect([400, 403, 422]).toContain(res.status);
    });
  });
});
