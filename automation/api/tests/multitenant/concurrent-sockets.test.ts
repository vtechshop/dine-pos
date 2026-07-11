import { getHotelA } from '../../setup/testEnv';
import { createMultipleSockets, disconnectAll } from '../../../utils/socket-client';
import { createOrder } from '../../helpers/order.helper';

describe('Multi-Tenant — Concurrent Sockets', () => {
  let hotelA: ReturnType<typeof getHotelA>;

  beforeAll(() => {
    hotelA = getHotelA();
  });

  it('CON-001 10 concurrent sockets for same hotel all connect successfully', async () => {
    const sockets = await createMultipleSockets(10, hotelA.adminToken, hotelA.hotelId);
    sockets.forEach(s => expect(s.isConnected()).toBe(true));
    disconnectAll(sockets);
  }, 20000);

  it('CON-002 all 10 concurrent sockets receive new_order event', async () => {
    const sockets = await createMultipleSockets(10, hotelA.kitchenToken, hotelA.hotelId);
    const promises = sockets.map(s => s.waitForEvent('new_order', 8000));
    await createOrder(hotelA.adminToken);
    const results = await Promise.all(promises);
    results.forEach(r => expect(r).toBeDefined());
    disconnectAll(sockets);
  }, 30000);

  it('CON-003 socket from hotel A and hotel B coexist without interference', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();

    const [sockA, sockB] = await Promise.all([
      import('../../../utils/socket-client').then(m => m.createConnectedSocket(hotelA.adminToken, hotelA.hotelId)),
      import('../../../utils/socket-client').then(m => m.createConnectedSocket(hotelB.adminToken, hotelB.hotelId)),
    ]);

    expect(sockA.isConnected()).toBe(true);
    expect(sockB.isConnected()).toBe(true);
    expect(sockA.getId()).not.toBe(sockB.getId());

    sockA.disconnect();
    sockB.disconnect();
  }, 10000);

  it('CON-004 reconnecting socket rejoins hotel room and receives events', async () => {
    const sock = await createMultipleSockets(1, hotelA.adminToken, hotelA.hotelId);
    const s = sock[0];
    s.disconnect();
    await new Promise(r => setTimeout(r, 500));

    const { createConnectedSocket } = await import('../../../utils/socket-client');
    const reconnected = await createConnectedSocket(hotelA.adminToken, hotelA.hotelId);
    expect(reconnected.isConnected()).toBe(true);

    const eventPromise = reconnected.waitForEvent('new_order', 6000);
    await createOrder(hotelA.adminToken);
    const data = await eventPromise;
    expect(data).toBeDefined();
    reconnected.disconnect();
  }, 15000);

  it('CON-005 rapidly connecting and disconnecting 20 sockets does not crash server', async () => {
    const batch: Promise<void>[] = [];
    const { createConnectedSocket } = await import('../../../utils/socket-client');
    for (let i = 0; i < 20; i++) {
      batch.push(
        createConnectedSocket(hotelA.adminToken, hotelA.hotelId).then(s => {
          setTimeout(() => s.disconnect(), 100);
        })
      );
    }
    await Promise.all(batch);
    // If server is still up, next request succeeds
    const { api } = await import('../../../utils/api-client');
    const { authHeaders } = await import('../../../utils/env');
    const res = await api.get('/api/orders').set(authHeaders(hotelA.adminToken));
    expect(res.status).toBe(200);
  }, 20000);
});
