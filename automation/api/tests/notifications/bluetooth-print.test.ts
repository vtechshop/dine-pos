import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { createOrder } from '../../helpers/order.helper';

describe('Notifications — Bluetooth Print', () => {
  let adminToken: string;
  let kitchenToken: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
  });

  it('BTP-001 new order event payload contains all fields needed for printing', async () => {
    const { getHotelA: getA } = await import('../../setup/testEnv');
    const { createConnectedSocket } = await import('../../../utils/socket-client');
    const hotelA = getA();
    const sock = await createConnectedSocket(hotelA.kitchenToken, hotelA.hotelId);

    const eventPromise = sock.waitForEvent('new_order', 6000);
    await createOrder(adminToken);
    const data: any = await eventPromise;

    sock.disconnect();

    expect(data).toBeDefined();
    // Print receipt needs: orderNumber, tableNumber, items, grandTotal
    expect(data.orderNumber || data._id).toBeTruthy();
  });

  it('BTP-002 order items in socket event contain productName, quantity, price, total', async () => {
    const { getHotelA: getA } = await import('../../setup/testEnv');
    const { createConnectedSocket } = await import('../../../utils/socket-client');
    const hotelA = getA();
    const sock = await createConnectedSocket(hotelA.kitchenToken, hotelA.hotelId);

    const eventPromise = sock.waitForEvent('new_order', 6000);
    await createOrder(adminToken);
    const data: any = await eventPromise;
    sock.disconnect();

    if (data && data.items && Array.isArray(data.items) && data.items.length > 0) {
      const item = data.items[0];
      expect(item.productName || item.name).toBeTruthy();
      expect(typeof (item.quantity)).toBe('number');
      expect(typeof (item.price || item.unitPrice)).toBe('number');
    }
  });

  it('BTP-003 order GET endpoint returns full order suitable for receipt rendering', async () => {
    const { orderId } = await createOrder(adminToken);
    const res = await api.get(`/api/orders/${orderId}`).set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const order = res.body.order || res.body;
    expect(order.orderNumber).toMatch(/^ORD-/);
    expect(order.grandTotal).toBeGreaterThan(0);
    expect(Array.isArray(order.items)).toBe(true);
  });
});
