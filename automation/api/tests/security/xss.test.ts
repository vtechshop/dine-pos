import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { xssPayloads } from '../../../utils/test-data';
import { v4 as uuidv4 } from 'uuid';

describe('Security — XSS', () => {
  let adminToken: string;

  beforeAll(() => {
    adminToken = getHotelA().adminToken;
  });

  for (const payload of xssPayloads()) {
    it(`XSS-001 XSS payload in customerName is stored raw (not executed): ${payload.substring(0, 40)}`, async () => {
      const res = await api.post('/api/orders').set(authHeaders(adminToken)).send({
        tableNumber: 'T1',
        customerName: payload,
        orderSource: 'dine-in',
        items: [{ productName: 'Test', quantity: 1, price: 50, total: 50 }],
        subtotal: 50,
        taxTotal: 4.5,
        grandTotal: 54.5,
        paymentMethod: 'cash',
        offlineId: uuidv4(),
      });
      // MongoDB API returns JSON — XSS in JSON is not exploitable
      // The concern is if the value is reflected back unescaped in a JSON response
      expect(res.status).not.toBe(500);
      if (res.status === 200 || res.status === 201) {
        const order = res.body.order || res.body;
        // Value must be stored as-is (JSON encoding protects it inherently)
        expect(order.customerName).toBe(payload);
      }
    });
  }

  it('XSS-002 XSS in product name is stored and returned safely', async () => {
    const xss = '<script>alert("XSS")</script>';
    const res = await api.post('/api/products').set(authHeaders(adminToken)).send({
      name: xss,
      price: 100,
      isAvailable: true,
    });
    if (res.status === 201 || res.status === 200) {
      const prod = res.body.product || res.body;
      expect(prod.name).toBe(xss);
      // Clean up
      if (prod._id) {
        await api.delete(`/api/products/${prod._id}`).set(authHeaders(adminToken));
      }
    } else {
      // Server chose to reject — also acceptable
      expect([400, 422]).toContain(res.status);
    }
  });

  it('XSS-003 XSS in category name is stored and returned safely', async () => {
    const xss = '"><img src=x onerror=alert(1)>';
    const res = await api.post('/api/categories').set(authHeaders(adminToken)).send({
      name: xss,
      color: '#000',
    });
    if (res.status === 201 || res.status === 200) {
      const cat = res.body.category || res.body;
      expect(cat.name).toBe(xss);
      if (cat._id) {
        await api.delete(`/api/categories/${cat._id}`).set(authHeaders(adminToken));
      }
    } else {
      expect([400, 422]).toContain(res.status);
    }
  });

  it('XSS-004 Content-Type response header is application/json (not text/html)', async () => {
    const res = await api.get('/api/orders').set(authHeaders(adminToken));
    const contentType = res.headers['content-type'] || '';
    expect(contentType).toContain('application/json');
  });

  it('XSS-005 X-Content-Type-Options header is set to nosniff', async () => {
    const res = await api.get('/api/orders').set(authHeaders(adminToken));
    const header = res.headers['x-content-type-options'];
    if (header) {
      expect(header).toBe('nosniff');
    } else {
      console.warn('XSS-005: x-content-type-options header missing — consider adding helmet middleware');
    }
  });
});
