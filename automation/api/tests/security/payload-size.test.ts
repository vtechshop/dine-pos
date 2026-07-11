import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { oversizedPayload } from '../../../utils/test-data';

describe('Security — Payload Size', () => {
  let adminToken: string;

  beforeAll(() => {
    adminToken = getHotelA().adminToken;
  });

  it('PAY-001 oversized JSON body (11KB+ customerName) returns 400 or 413', async () => {
    const res = await api.post('/api/orders').set(authHeaders(adminToken)).send({
      tableNumber: 'T1',
      customerName: oversizedPayload(11),
      orderSource: 'dine-in',
      items: [{ productName: 'X', quantity: 1, price: 10, total: 10 }],
      subtotal: 10,
      taxTotal: 0.9,
      grandTotal: 10.9,
      paymentMethod: 'cash',
    });
    expect([400, 413, 422]).toContain(res.status);
  });

  it('PAY-002 oversized product description (11KB) returns 400 or 413', async () => {
    const res = await api.post('/api/products').set(authHeaders(adminToken)).send({
      name: 'Test',
      price: 50,
      description: oversizedPayload(11),
    });
    expect([400, 413, 422]).toContain(res.status);
  });

  it('PAY-003 deeply nested JSON object does not crash the server', async () => {
    let nested: any = { value: 'deepest' };
    for (let i = 0; i < 100; i++) nested = { layer: nested };
    const res = await api.post('/api/orders').set(authHeaders(adminToken)).send({ nested });
    expect(res.status).not.toBe(500);
  });

  it('PAY-004 array with 10,000 order items returns 400 or 422 (not 500)', async () => {
    const items = Array.from({ length: 10000 }, (_, i) => ({
      productName: `Item ${i}`, quantity: 1, price: 10, total: 10,
    }));
    const res = await api.post('/api/orders').set(authHeaders(adminToken)).send({
      tableNumber: 'T1',
      orderSource: 'dine-in',
      items,
      subtotal: 100000,
      taxTotal: 9000,
      grandTotal: 109000,
      paymentMethod: 'cash',
    });
    expect([400, 413, 422]).toContain(res.status);
  }, 15000);

  it('PAY-005 normal-sized request (< 1KB) is accepted', async () => {
    const res = await api.post('/api/products').set(authHeaders(adminToken)).send({
      name: 'Normal Product',
      price: 100,
      isAvailable: true,
      category: getHotelA().categoryId,
    });
    expect([200, 201]).toContain(res.status);
  });
});
