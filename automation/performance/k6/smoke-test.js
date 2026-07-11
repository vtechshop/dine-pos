import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { BASE_URL, jsonHeaders, adminLogin, createOrder, getOrders } from './helpers.js';

const responseTime = new Trend('response_time_ms');
const errorRate = new Rate('errors');
const orderCounter = new Counter('orders_created');

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};

export function setup() {
  const adminId = __ENV.ADMIN_ID;
  const adminPassword = __ENV.ADMIN_PASSWORD;
  if (!adminId || !adminPassword) {
    throw new Error('ADMIN_ID and ADMIN_PASSWORD must be set in env');
  }
  const token = adminLogin(adminId, adminPassword);
  return { token };
}

export default function (data) {
  const { token } = data;

  // GET /api/orders
  const ordersRes = getOrders(token);
  check(ordersRes, { 'orders 200': r => r.status === 200 });
  responseTime.add(ordersRes.timings.duration, { endpoint: 'get_orders' });
  errorRate.add(ordersRes.status !== 200);

  sleep(0.5);

  // POST /api/orders
  const createRes = createOrder(token);
  const created = check(createRes, { 'create order 201': r => [200, 201].includes(r.status) });
  responseTime.add(createRes.timings.duration, { endpoint: 'create_order' });
  errorRate.add(!created);
  if (created) orderCounter.add(1);

  sleep(0.5);
}
