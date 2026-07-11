import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { createOrder, updateOrderStatus, getWaiterOrders } from '../../helpers/order.helper';

describe('Orders — Waiter Flow', () => {
  let adminToken: string;
  let kitchenToken: string;
  let waiterToken: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
    waiterToken = hotelA.waiterToken;
  });

  it('WAI-001 waiter can list waiter orders (ready orders)', async () => {
    const orders = await getWaiterOrders(waiterToken);
    expect(Array.isArray(orders)).toBe(true);
  });

  it('WAI-002 waiter can mark ready order as served', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');
    const updated = await updateOrderStatus(waiterToken, orderId, 'served');
    expect(updated.status).toBe('served');
  });

  it('WAI-003 waiter cannot serve a pending order (not yet ready)', async () => {
    const { orderId } = await createOrder(adminToken);
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(waiterToken))
      .send({ status: 'served' });
    expect([400, 403, 422]).toContain(res.status);
  });

  it('WAI-004 waiter cannot complete an order', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');
    await updateOrderStatus(waiterToken, orderId, 'served');
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(waiterToken))
      .send({ status: 'completed' });
    expect([400, 403, 422]).toContain(res.status);
  });

  it('WAI-005 waiter orders list only contains ready orders', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');

    const orders = await getWaiterOrders(waiterToken);
    orders.forEach((order: any) => {
      expect(order.status).toBe('ready');
    });
  });

  it('WAI-006 waiter cannot update order from another hotel', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();
    const { orderId } = await createOrder(hotelB.adminToken);
    await updateOrderStatus(hotelB.kitchenToken, orderId, 'preparing');
    await updateOrderStatus(hotelB.kitchenToken, orderId, 'ready');
    const res = await api
      .patch(`/api/orders/${orderId}/status`)
      .set(authHeaders(waiterToken))
      .send({ status: 'served' });
    expect([403, 404]).toContain(res.status);
  });
});
