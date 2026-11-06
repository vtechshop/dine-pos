import { v4 as uuidv4 } from 'uuid';
import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA, HotelState } from '../../setup/testEnv';
import { productLine } from '../../helpers/order.helper';

describe('Orders — Offline Idempotency', () => {
  let adminToken: string;
  let hotelId: string;

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    hotelId = hotelA.hotelId;
  });

  function orderBody(offlineId: string, hotel: HotelState = getHotelA()) {
    const line = productLine(hotel, 0, 1); // Paneer Masala ₹180
    return {
      tableNumber: 'T5',
      customerName: 'Offline Test',
      customerPhone: '9999999999',
      orderSource: 'dine-in',
      items: [line],
      subtotal: line.total,
      taxTotal: 0,
      grandTotal: line.total,
      paymentMethod: 'cash',
      notes: '',
      offlineId,
    };
  }

  it('OFF-001 sending same offlineId twice returns same orderId both times', async () => {
    const offlineId = uuidv4();
    const res1 = await api.post('/api/orders').set(authHeaders(adminToken)).send(orderBody(offlineId));
    const res2 = await api.post('/api/orders').set(authHeaders(adminToken)).send(orderBody(offlineId));

    expect([200, 201]).toContain(res1.status);
    expect([200, 201]).toContain(res2.status);

    const id1 = (res1.body.order || res1.body)._id;
    const id2 = (res2.body.order || res2.body)._id;
    expect(id1).toBe(id2);
  });

  it('OFF-002 duplicate offlineId does not increment daily counter', async () => {
    const offlineId = uuidv4();
    const res1 = await api.post('/api/orders').set(authHeaders(adminToken)).send(orderBody(offlineId));
    const res2 = await api.post('/api/orders').set(authHeaders(adminToken)).send(orderBody(offlineId));

    const on1 = (res1.body.order || res1.body).orderNumber;
    const on2 = (res2.body.order || res2.body).orderNumber;
    expect(on1).toBe(on2);
  });

  it('OFF-003 unique offlineIds create unique orders', async () => {
    const res1 = await api.post('/api/orders').set(authHeaders(adminToken)).send(orderBody(uuidv4()));
    const res2 = await api.post('/api/orders').set(authHeaders(adminToken)).send(orderBody(uuidv4()));
    const id1 = (res1.body.order || res1.body)._id;
    const id2 = (res2.body.order || res2.body)._id;
    expect(id1).not.toBe(id2);
  });

  it('OFF-004 same offlineId from different hotel creates separate orders', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();
    const offlineId = uuidv4();
    const res1 = await api.post('/api/orders').set(authHeaders(adminToken)).send(orderBody(offlineId));
    const res2 = await api.post('/api/orders').set(authHeaders(hotelB.adminToken)).send(orderBody(offlineId, hotelB));
    const id1 = (res1.body.order || res1.body)._id;
    const id2 = (res2.body.order || res2.body)._id;
    expect(id1).not.toBe(id2);
  });

  it('OFF-005 retried order returns original order data unchanged', async () => {
    const offlineId = uuidv4();
    const original = orderBody(offlineId);
    await api.post('/api/orders').set(authHeaders(adminToken)).send(original);
    const modified = { ...original, customerName: 'Modified Name' };
    const res2 = await api.post('/api/orders').set(authHeaders(adminToken)).send(modified);
    const returnedOrder = res2.body.order || res2.body;
    // Should return original, not modified
    expect(returnedOrder.customerName).toBe('Offline Test');
  });
});
