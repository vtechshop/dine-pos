import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { createOrder, updateOrderStatus, getCashierOrders } from '../../helpers/order.helper';

describe('Orders — Cashier Flow', () => {
  let adminToken: string;
  let kitchenToken: string;
  let waiterToken: string;
  let cashierToken: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
    waiterToken = hotelA.waiterToken;
    cashierToken = hotelA.cashierToken;
  });

  it('CAS-001 cashier can list cashier orders (served orders)', async () => {
    const orders = await getCashierOrders(cashierToken);
    expect(Array.isArray(orders)).toBe(true);
  });

  it('CAS-002 cashier can mark served order as completed', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');
    await updateOrderStatus(waiterToken, orderId, 'served');
    const updated = await updateOrderStatus(cashierToken, orderId, 'completed');
    expect(updated.status).toBe('completed');
  });

  it('CAS-003 cashier cannot complete a pending order (must be served first)', async () => {
    const { orderId } = await createOrder(adminToken);
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(cashierToken))
      .send({ status: 'completed' });
    expect([400, 403, 422]).toContain(res.status);
  });

  it('CAS-004 cashier can update payment method on completion', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');
    await updateOrderStatus(waiterToken, orderId, 'served');
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(cashierToken))
      .send({ status: 'completed', paymentMethod: 'upi' });
    expect(res.status).toBe(200);
    const order = res.body.order || res.body;
    expect(order.paymentMethod).toBe('upi');
  });

  it('CAS-005 cashier orders list only contains served orders', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');
    await updateOrderStatus(waiterToken, orderId, 'served');

    const orders = await getCashierOrders(cashierToken);
    orders.forEach((order: any) => {
      expect(order.status).toBe('served');
    });
  });

  it('CAS-006 cashier cannot update order from another hotel', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();
    const { orderId } = await createOrder(hotelB.adminToken);
    await updateOrderStatus(hotelB.kitchenToken, orderId, 'preparing');
    await updateOrderStatus(hotelB.kitchenToken, orderId, 'ready');
    await updateOrderStatus(hotelB.waiterToken, orderId, 'served');
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(cashierToken))
      .send({ status: 'completed' });
    expect([403, 404]).toContain(res.status);
  });

  it('CAS-007 completed order appears in daily report', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');
    await updateOrderStatus(waiterToken, orderId, 'served');
    await updateOrderStatus(cashierToken, orderId, 'completed');

    const today = new Date().toISOString().split('T')[0];
    const res = await api
      .get('/api/orders/reports/daily')
      .set(authHeaders(adminToken))
      .query({ date: today });
    expect(res.status).toBe(200);
    const report = res.body;
    expect(report.totalOrders || report.ordersCount || report.count).toBeGreaterThan(0);
  });
});
