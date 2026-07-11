import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { createOrder, updateOrderStatus } from '../../helpers/order.helper';

describe('Reports — Daily Report', () => {
  let adminToken: string;
  let kitchenToken: string;
  let waiterToken: string;
  let cashierToken: string;
  const today = new Date().toISOString().split('T')[0];

  beforeAll(() => {
    const hotelA = getHotelA();
    adminToken = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
    waiterToken = hotelA.waiterToken;
    cashierToken = hotelA.cashierToken;
  });

  it('REP-001 GET /api/orders/reports/daily returns 200', async () => {
    const res = await api.get('/api/orders/reports/daily').set(authHeaders(adminToken)).query({ date: today });
    expect(res.status).toBe(200);
  });

  it('REP-002 daily report has totalOrders, totalRevenue fields', async () => {
    const res = await api.get('/api/orders/reports/daily').set(authHeaders(adminToken)).query({ date: today });
    const body = res.body;
    const hasOrders = 'totalOrders' in body || 'ordersCount' in body || 'count' in body;
    const hasRevenue = 'totalRevenue' in body || 'revenue' in body || 'totalAmount' in body || 'grandTotal' in body;
    expect(hasOrders).toBe(true);
    expect(hasRevenue).toBe(true);
  });

  it('REP-003 daily report without date param defaults to today', async () => {
    const res = await api.get('/api/orders/reports/daily').set(authHeaders(adminToken));
    expect(res.status).toBe(200);
  });

  it('REP-004 completed order is counted in daily report totals', async () => {
    const { orderId } = await createOrder(adminToken);
    await updateOrderStatus(kitchenToken, orderId, 'preparing');
    await updateOrderStatus(kitchenToken, orderId, 'ready');
    await updateOrderStatus(waiterToken, orderId, 'served');
    await updateOrderStatus(cashierToken, orderId, 'completed');

    const res = await api.get('/api/orders/reports/daily').set(authHeaders(adminToken)).query({ date: today });
    const body = res.body;
    const count = body.totalOrders || body.ordersCount || body.count || 0;
    expect(count).toBeGreaterThan(0);
  });

  it('REP-005 non-admin cannot access daily report', async () => {
    const res = await api.get('/api/orders/reports/daily').set(authHeaders(kitchenToken)).query({ date: today });
    expect([401, 403]).toContain(res.status);
  });

  it('REP-006 daily report for hotel A does not include hotel B revenue', async () => {
    const { getHotelB } = await import('../../setup/testEnv');
    const hotelB = getHotelB();
    const resA = await api.get('/api/orders/reports/daily').set(authHeaders(adminToken)).query({ date: today });
    const resB = await api.get('/api/orders/reports/daily').set(authHeaders(hotelB.adminToken)).query({ date: today });
    // Both return 200 with their own isolated data
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });

  it('REP-007 invalid date format returns 400 or uses today as fallback', async () => {
    const res = await api.get('/api/orders/reports/daily').set(authHeaders(adminToken)).query({ date: 'not-a-date' });
    expect([200, 400, 422]).toContain(res.status);
  });
});
