import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import { getPublicMenu, createQROrder } from './helpers.js';

const errorRate = new Rate('qr_errors');
const ordersPlaced = new Counter('qr_orders_placed');
const menuLoadTime = new Trend('menu_load_ms');
const orderCreateTime = new Trend('qr_order_create_ms');

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    qr_errors: ['rate<0.03'],
    menu_load_ms: ['p(95)<1000'],
    qr_order_create_ms: ['p(95)<2000'],
    qr_orders_placed: ['count>0'],
  },
};

export function setup() {
  return { hotelId: __ENV.HOTEL_ID };
}

export default function (data) {
  const { hotelId } = data;

  // Load menu (customer browses)
  const menuRes = getPublicMenu(hotelId);
  check(menuRes, { 'menu 200': r => r.status === 200 });
  menuLoadTime.add(menuRes.timings.duration);
  errorRate.add(menuRes.status !== 200);

  sleep(Math.random() * 2 + 1);

  // Place QR order
  const orderRes = createQROrder(hotelId);
  const ok = check(orderRes, { 'qr order 2xx': r => [200, 201].includes(r.status) });
  orderCreateTime.add(orderRes.timings.duration);
  errorRate.add(!ok);
  if (ok) ordersPlaced.add(1);

  sleep(Math.random() * 1 + 0.5);
}
