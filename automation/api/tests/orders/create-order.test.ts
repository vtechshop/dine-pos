import { v4 as uuidv4 } from 'uuid';
import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { createOrder } from '../../helpers/order.helper';

describe('Orders — Create', () => {
  let adminToken: string;
  let waiterToken: string;
  let kitchenToken: string;
  let cashierToken: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    waiterToken = hotelA.waiterToken;
    kitchenToken = hotelA.kitchenToken;
    cashierToken = hotelA.cashierToken;
  });

  it('ORD-001 admin can create an order and receives 201 with orderNumber', async () => {
    const { orderId, orderNumber } = await createOrder(adminToken);
    expect(orderId).toBeTruthy();
    expect(orderNumber).toMatch(/^ORD-\d{8}-\d+$/);
  });

  it('ORD-002 waiter can create an order', async () => {
    const { orderId } = await createOrder(waiterToken);
    expect(orderId).toBeTruthy();
  });

  it('ORD-003 kitchen role cannot create an order', async () => {
    const res = await api.post('/api/orders').set(authHeaders(kitchenToken)).send({
      tableNumber: 'T1',
      customerName: 'Test',
      orderSource: 'dine-in',
      items: [{ productName: 'X', quantity: 1, price: 100, total: 100 }],
      subtotal: 100,
      taxTotal: 9,
      grandTotal: 109,
      paymentMethod: 'cash',
      offlineId: uuidv4(),
    });
    expect([401, 403]).toContain(res.status);
  });

  it('ORD-004 order without items returns 400', async () => {
    const res = await api.post('/api/orders').set(authHeaders(adminToken)).send({
      tableNumber: 'T1',
      orderSource: 'dine-in',
      items: [],
      subtotal: 0,
      taxTotal: 0,
      grandTotal: 0,
      offlineId: uuidv4(),
    });
    expect([400, 422]).toContain(res.status);
  });

  it('ORD-005 order number follows ORD-YYYYMMDD-NNN format', async () => {
    const { orderNumber } = await createOrder(adminToken);
    expect(orderNumber).toMatch(/^ORD-\d{8}-\d+$/);
    const datePart = orderNumber.split('-')[1];
    expect(datePart).toHaveLength(8);
    expect(Number(datePart)).toBeGreaterThan(20240101);
  });

  it('ORD-006 order counter increments per hotel per day', async () => {
    const { orderNumber: on1 } = await createOrder(adminToken);
    const { orderNumber: on2 } = await createOrder(adminToken);
    const seq1 = parseInt(on1.split('-')[2]);
    const seq2 = parseInt(on2.split('-')[2]);
    expect(seq2).toBeGreaterThan(seq1);
  });

  it('ORD-007 idempotency: same offlineId returns existing order on retry', async () => {
    const offlineId = uuidv4();
    const res1 = await createOrder(adminToken, { offlineId });
    const res2 = await createOrder(adminToken, { offlineId });
    expect(res1.orderId).toBe(res2.orderId);
  });

  it('ORD-008 order without offlineId returns 400 or still works depending on implementation', async () => {
    const res = await api.post('/api/orders').set(authHeaders(adminToken)).send({
      tableNumber: 'T1',
      customerName: 'Test',
      orderSource: 'dine-in',
      items: [{ productName: 'Naan', quantity: 1, price: 30, total: 30 }],
      subtotal: 30,
      taxTotal: 2.7,
      grandTotal: 32.7,
      paymentMethod: 'cash',
    });
    // offlineId may or may not be required — just ensure no 500
    expect(res.status).not.toBe(500);
  });

  it('ORD-009 created order has status=pending', async () => {
    const { orderId } = await createOrder(adminToken);
    const res = await api.get(`/api/orders/${orderId}`).set(authHeaders(adminToken));
    const order = res.body.order || res.body;
    expect(order.status).toBe('pending');
  });

  it('ORD-010 unauthenticated cannot create order', async () => {
    const res = await api.post('/api/orders').send({
      tableNumber: 'T1', items: [{ productName: 'X', quantity: 1, price: 10, total: 10 }],
      subtotal: 10, taxTotal: 0.9, grandTotal: 10.9, offlineId: uuidv4(),
    });
    expect(res.status).toBe(401);
  });

  it('ORD-011 orders from hotelA not visible to hotelB', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();
    const { orderId } = await createOrder(adminToken);
    const res = await api.get(`/api/orders/${orderId}`).set(authHeaders(hotelB.adminToken));
    expect([403, 404]).toContain(res.status);
  });

  it('ORD-012 cashier role can create order', async () => {
    const { orderId } = await createOrder(cashierToken);
    expect(orderId).toBeTruthy();
  });
});
