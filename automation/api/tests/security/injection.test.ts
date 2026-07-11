import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { nosqlInjectionPayloads, sqlInjectionStrings } from '../../../utils/test-data';

describe('Security — Injection Attacks', () => {
  let adminToken: string;
  let hotelId: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    hotelId = hotelA.hotelId;
  });

  describe('NoSQL Injection', () => {
    it('INJ-001 NoSQL operator in login userId is sanitized or rejected', async () => {
      for (const payload of nosqlInjectionPayloads()) {
        const res = await api.post('/api/auth/login').send({ userId: payload, password: 'anything' });
        expect([400, 401, 422]).toContain(res.status);
        expect(res.status).not.toBe(200);
      }
    });

    it('INJ-002 NoSQL operator in hotel registration phone is rejected', async () => {
      const res = await api.post('/api/hotels/register').send({
        hotelName: 'Test Hotel',
        ownerName: 'Test Owner',
        phone: { $gt: '' },
        email: 'test@test.com',
        businessType: 'restaurant',
        state: 'MH',
        city: 'Mumbai',
        address: 'Test',
      });
      expect([400, 422]).toContain(res.status);
    });

    it('INJ-003 NoSQL operator in order filter query is sanitized', async () => {
      const res = await api
        .get('/api/orders')
        .set(authHeaders(adminToken))
        .query({ status: { $ne: null } });
      // Should either return 200 with safe results or 400
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        const orders = res.body.orders || res.body.data || res.body;
        expect(Array.isArray(orders)).toBe(true);
      }
    });

    it('INJ-004 $where operator in hotel status check is rejected', async () => {
      const res = await api.get('/api/hotels/status/$where:this.phone!=""');
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('SQL-like Injection in String Fields', () => {
    for (const injection of sqlInjectionStrings()) {
      it(`INJ-005 SQL injection string in customerName is stored safely: ${injection.substring(0, 30)}`, async () => {
        const res = await api.post('/api/orders').set(authHeaders(adminToken)).send({
          tableNumber: 'T1',
          customerName: injection,
          orderSource: 'dine-in',
          items: [{ productName: 'Dish', quantity: 1, price: 100, total: 100 }],
          subtotal: 100,
          taxTotal: 9,
          grandTotal: 109,
          paymentMethod: 'cash',
          offlineId: `inj-test-${Date.now()}-${Math.random()}`,
        });
        // Should succeed (MongoDB is not SQL) or reject with 400 — never 500
        expect(res.status).not.toBe(500);
        if (res.status === 200 || res.status === 201) {
          const order = res.body.order || res.body;
          // Data must be stored verbatim (not executed)
          expect(order.customerName).toBe(injection);
        }
      });
    }
  });

  describe('Parameter Pollution', () => {
    it('INJ-006 duplicate query params do not break the endpoint', async () => {
      const res = await api
        .get('/api/orders?status=pending&status=completed')
        .set(authHeaders(adminToken));
      expect([200, 400]).toContain(res.status);
      expect(res.status).not.toBe(500);
    });
  });
});
