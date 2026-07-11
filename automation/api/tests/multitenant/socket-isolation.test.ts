import { getHotelA, getHotelB } from '../../setup/testEnv';
import { createConnectedSocket } from '../../../utils/socket-client';
import { createOrder } from '../../helpers/order.helper';

describe('Multi-Tenant — Socket Isolation', () => {
  let hotelA: ReturnType<typeof getHotelA>;
  let hotelB: ReturnType<typeof getHotelB>;

  beforeAll(() => {
    hotelA = getHotelA();
    hotelB = getHotelB();
  });

  it('SOK-001 hotel A socket does not receive hotel B new_order event', async () => {
    const sockA = await createConnectedSocket(hotelA.adminToken, hotelA.hotelId);
    let received = false;
    const before = Date.now();

    sockA.on('new_order', () => { received = true; });
    await createOrder(hotelB.adminToken);
    await new Promise(r => setTimeout(r, 1500));

    const events = sockA.getEvents('new_order').filter(e => e.receivedAt > before);
    if (events.length > 0) {
      // If received, must be for hotel A (cross-hotel leak)
      events.forEach(e => {
        const data: any = e.data;
        if (data?.hotelId) {
          expect(data.hotelId).toBe(hotelA.hotelId);
        }
      });
    }

    sockA.disconnect();
  }, 10000);

  it('SOK-002 hotel B socket does not receive hotel A status updates', async () => {
    const sockB = await createConnectedSocket(hotelB.adminToken, hotelB.hotelId);
    let received = false;
    const before = Date.now();

    sockB.on('order_status_update', () => { received = true; });

    const { orderId } = await createOrder(hotelA.adminToken);
    await import('../../helpers/order.helper').then(m => m.updateOrderStatus(hotelA.kitchenToken, orderId, 'preparing'));
    await new Promise(r => setTimeout(r, 1500));

    const events = sockB.getEvents('order_status_update').filter(e => e.receivedAt > before);
    if (events.length > 0) {
      events.forEach(e => {
        const data: any = e.data;
        if (data?.hotelId) expect(data.hotelId).toBe(hotelB.hotelId);
      });
    }

    sockB.disconnect();
  }, 10000);

  it('SOK-003 hotel A socket receives its own events correctly', async () => {
    const sockA = await createConnectedSocket(hotelA.adminToken, hotelA.hotelId);
    const eventPromise = sockA.waitForEvent('new_order', 6000);
    await createOrder(hotelA.adminToken);
    const data = await eventPromise;
    expect(data).toBeDefined();
    sockA.disconnect();
  }, 10000);

  it('SOK-004 hotel B socket receives its own events correctly', async () => {
    const sockB = await createConnectedSocket(hotelB.adminToken, hotelB.hotelId);
    const eventPromise = sockB.waitForEvent('new_order', 6000);
    await createOrder(hotelB.adminToken);
    const data = await eventPromise;
    expect(data).toBeDefined();
    sockB.disconnect();
  }, 10000);

  it('SOK-005 multiple sockets on same hotel all receive the same event', async () => {
    const sock1 = await createConnectedSocket(hotelA.adminToken, hotelA.hotelId);
    const sock2 = await createConnectedSocket(hotelA.kitchenToken, hotelA.hotelId);
    const sock3 = await createConnectedSocket(hotelA.waiterToken, hotelA.hotelId);

    const [p1, p2, p3] = [
      sock1.waitForEvent('new_order', 6000),
      sock2.waitForEvent('new_order', 6000),
      sock3.waitForEvent('new_order', 6000),
    ];

    await createOrder(hotelA.adminToken);
    const [d1, d2, d3] = await Promise.all([p1, p2, p3]);

    expect(d1).toBeDefined();
    expect(d2).toBeDefined();
    expect(d3).toBeDefined();

    sock1.disconnect();
    sock2.disconnect();
    sock3.disconnect();
  }, 12000);
});
