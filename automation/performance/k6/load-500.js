import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import { adminLogin, createOrder, getOrders, getPublicMenu, createQROrder } from './helpers.js';

const errorRate = new Rate('errors');
const orderCounter = new Counter('orders_created');
const p95 = new Trend('p95_response_ms');

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '2m', target: 300 },
    { duration: '3m', target: 500 },
    { duration: '5m', target: 500 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.05'],
    errors: ['rate<0.05'],
  },
};

export function setup() {
  const token = adminLogin(__ENV.ADMIN_ID, __ENV.ADMIN_PASSWORD);
  return { token, hotelId: __ENV.HOTEL_ID };
}

export default function (data) {
  const { token, hotelId } = data;
  const r = Math.random();

  let res;
  if (r < 0.3) {
    res = getOrders(token);
    check(res, { 'get orders 200': x => x.status === 200 });
  } else if (r < 0.55) {
    res = createOrder(token);
    const ok = check(res, { 'create order 2xx': x => [200, 201].includes(x.status) });
    if (ok) orderCounter.add(1);
  } else if (r < 0.75) {
    res = getPublicMenu(hotelId);
    check(res, { 'menu 200': x => x.status === 200 });
  } else {
    res = createQROrder(hotelId);
    check(res, { 'qr order 2xx': x => [200, 201].includes(x.status) });
  }

  p95.add(res.timings.duration);
  errorRate.add(res.status >= 400);

  sleep(Math.random() * 2 + 0.2);
}
