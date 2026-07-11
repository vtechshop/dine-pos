import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { adminLogin, createOrder, getOrders, getPublicMenu } from './helpers.js';

const responseTime = new Trend('response_time_ms');
const errorRate = new Rate('errors');
const orderCounter = new Counter('orders_created');

export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '3m', target: 100 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.02'],
    errors: ['rate<0.02'],
  },
};

export function setup() {
  const token = adminLogin(__ENV.ADMIN_ID, __ENV.ADMIN_PASSWORD);
  return { token, hotelId: __ENV.HOTEL_ID };
}

export default function (data) {
  const { token, hotelId } = data;
  const scenario = Math.random();

  if (scenario < 0.4) {
    // 40% — read orders
    const res = getOrders(token);
    check(res, { 'get orders 200': r => r.status === 200 });
    responseTime.add(res.timings.duration, { type: 'read' });
    errorRate.add(res.status !== 200);
  } else if (scenario < 0.7) {
    // 30% — create order
    const res = createOrder(token);
    const ok = check(res, { 'create order 2xx': r => [200, 201].includes(r.status) });
    responseTime.add(res.timings.duration, { type: 'write' });
    errorRate.add(!ok);
    if (ok) orderCounter.add(1);
  } else {
    // 30% — public menu (QR customers)
    const res = getPublicMenu(hotelId);
    check(res, { 'public menu 200': r => r.status === 200 });
    responseTime.add(res.timings.duration, { type: 'public' });
    errorRate.add(res.status !== 200);
  }

  sleep(Math.random() * 1 + 0.5);
}
