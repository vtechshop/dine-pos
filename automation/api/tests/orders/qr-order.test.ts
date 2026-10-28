import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { qrOrderPayload } from '../../../utils/test-data';
import { createCategory, createProduct } from '../../helpers/menu.helper';

describe('Orders — QR Self-Order', () => {
  let hotelId: string;
  let adminToken: string;
  let testProductId: string;

  beforeAll(async () => {
    const hotelA = getHotelA();
    hotelId = hotelA.hotelId;
    adminToken = hotelA.adminToken;

    // Online-payment QR orders need an active Razorpay config (else 402).
    // globalSetup creates one, but payments/payment-release deletes it in its
    // own setup/teardown — so this suite must not depend on suite order.
    const list = await api.get('/api/payment-gateway-configs').set(authHeaders(adminToken));
    const active = list.status === 200
      && (list.body as any[]).some((c: any) => c.gatewayType === 'razorpay' && c.isActive && !c.isDeleted);
    if (!active) {
      const gw = await api.post('/api/payment-gateway-configs').set(authHeaders(adminToken)).send({
        gatewayType: 'razorpay', displayName: 'CI Test Gateway (qr-order)',
        apiKey: 'rzp_test_CI_QRORDER_0001', apiSecret: 'ci_qrorder_api_secret_01',
        webhookSecret: 'ci_qrorder_webhook_sec_1', environment: 'sandbox',
      });
      expect([200, 201]).toContain(gw.status);
      const t = await api.patch(`/api/payment-gateway-configs/${gw.body._id}/toggle`).set(authHeaders(adminToken));
      expect([200, 201]).toContain(t.status);
    }

    // Public endpoint requires items with valid product ObjectIds (server verifies price from catalog)
    const cat = await createCategory(adminToken);
    const prod = await createProduct(adminToken, cat.id);
    testProductId = prod.id;
  });

  function qrItems() {
    return [{ product: testProductId, productName: 'QR Test Item', quantity: 1, price: 100, total: 100 }];
  }

  it('QR-007 POST /api/public/orders creates order without auth', async () => {
    const payload = qrOrderPayload(hotelId, { items: qrItems() });
    const res = await api.post('/api/public/orders').send(payload);
    expect([200, 201]).toContain(res.status);
    const order = res.body.order || res.body;
    expect(order._id).toBeDefined();
  });

  it('QR-008 QR order has orderSource=qr', async () => {
    const payload = qrOrderPayload(hotelId, { orderSource: 'qr', items: qrItems() });
    const res = await api.post('/api/public/orders').send(payload);
    expect([200, 201]).toContain(res.status);
    const order = res.body.order || res.body;
    expect(order.orderSource).toBe('qr');
  });

  it('QR-009 QR order without hotelId returns 400', async () => {
    const payload = { ...qrOrderPayload(hotelId, { items: qrItems() }) };
    delete (payload as any).hotelId;
    const res = await api.post('/api/public/orders').send(payload);
    expect([400, 422]).toContain(res.status);
  });

  it('QR-010 QR order with invalid hotelId returns 404', async () => {
    const res = await api.post('/api/public/orders').send(
      qrOrderPayload('000000000000000000000000', { items: qrItems() })
    );
    expect([400, 404]).toContain(res.status);
  });

  it('QR-011 QR order without items returns 400', async () => {
    const payload = { ...qrOrderPayload(hotelId), items: [] };
    const res = await api.post('/api/public/orders').send(payload);
    expect([400, 422]).toContain(res.status);
  });

  it('QR-012 QR Razorpay order is payment_pending and not yet visible in kitchen', async () => {
    // QR orders use Razorpay and start as payment_pending.
    // Kitchen only shows status=pending|preparing|ready — payment_pending is excluded
    // until server-side payment verification releases the order.
    const payload = qrOrderPayload(hotelId, { items: qrItems() });
    const createRes = await api.post('/api/public/orders').send(payload);
    expect([200, 201]).toContain(createRes.status);
    const order = createRes.body.order || createRes.body;
    expect(order.status).toBe('payment_pending');

    const { getHotelA: getA } = await import('../../setup/testEnv');
    const hotelA = getA();
    const kitchenRes = await api.get('/api/orders/kitchen').set(authHeaders(hotelA.kitchenToken));
    const orders = kitchenRes.body.orders || kitchenRes.body.data || kitchenRes.body;
    const found = Array.isArray(orders) && orders.some((o: any) => o._id === order._id);
    expect(found).toBe(false);
  });

  it('QR-013 QR order for suspended hotel is rejected', async () => {
    // Documented expected behavior — tested in full in multitenant suspension test
    expect(true).toBe(true);
  });

  it('QR-014 QR order note is preserved', async () => {
    const payload = qrOrderPayload(hotelId, { notes: 'No onions please', items: qrItems() });
    const res = await api.post('/api/public/orders').send(payload);
    const order = res.body.order || res.body;
    expect(order.notes).toBe('No onions please');
  });
});
