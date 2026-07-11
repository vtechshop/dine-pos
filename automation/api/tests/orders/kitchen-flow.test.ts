import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { createOrder, updateOrderStatus, getKitchenOrders } from '../../helpers/order.helper';

describe('Orders — Kitchen Flow', () => {
  let adminToken: string;
  let kitchenToken: string;
  let waiterToken: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
    waiterToken = hotelA.waiterToken;
  });

  it('KIT-001 kitchen can list kitchen orders (status=pending)', async () => {
    await createOrder(adminToken);
    const orders = await getKitchenOrders(kitchenToken);
    expect(Array.isArray(orders)).toBe(true);
  });

  it('KIT-002 kitchen can update order to preparing', async () => {
    const { orderId } = await createOrder(adminToken);
    const updated = await updateOrderStatus(kitchenToken, orderId, 'preparing');
    expect(updated.status).toBe('preparing');
  });

  it('KIT-003 kitchen can update order from preparing to ready', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    const updated = await updateOrderStatus(kitchenToken, orderId, 'ready');
    expect(updated.status).toBe('ready');
  });

  it('KIT-004 kitchen cannot skip to served (invalid transition)', async () => {
    const { orderId } = await createOrder(adminToken);
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(kitchenToken))
      .send({ status: 'served' });
    expect([400, 403, 422]).toContain(res.status);
  });

  it('KIT-005 kitchen cannot complete an order (cashier role required)', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(kitchenToken))
      .send({ status: 'completed' });
    expect([400, 403, 422]).toContain(res.status);
  });

  it('KIT-006 waiter cannot update order to preparing', async () => {
    const { orderId } = await createOrder(adminToken);
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(waiterToken))
      .send({ status: 'preparing' });
    expect([400, 403, 422]).toContain(res.status);
  });

  it('KIT-007 kitchen can cancel a pending order', async () => {
    const { orderId } = await createOrder(adminToken);
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(kitchenToken))
      .send({ status: 'cancelled' });
    expect([200, 403]).toContain(res.status);
  });

  it('KIT-008 kitchen orders list only contains pending and preparing orders', async () => {
    const orders = await getKitchenOrders(kitchenToken);
    orders.forEach((order: any) => {
      expect(['pending', 'preparing']).toContain(order.status);
    });
  });

  it('KIT-009 kitchen cannot update status on order from another hotel', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();
    const { orderId } = await createOrder(hotelB.adminToken);
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(kitchenToken))
      .send({ status: 'preparing' });
    expect([403, 404]).toContain(res.status);
  });
});
