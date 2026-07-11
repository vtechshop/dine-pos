import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { adminLogin, createOrder } from './helpers.js';

const ordersCreated = new Counter('total_orders_created');
const failureRate = new Rate('order_failures');

export const options = {
  scenarios: {
    create_10k_orders: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 10000,
      maxDuration: '30m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.02'],
    order_failures: ['rate<0.02'],
    total_orders_created: ['count>=9800'],
  },
};

export function setup() {
  const token = adminLogin(__ENV.ADMIN_ID, __ENV.ADMIN_PASSWORD);
  return { token };
}

export default function (data) {
  const res = createOrder(data.token);
  const ok = check(res, { 'order 2xx': r => [200, 201].includes(r.status) });
  if (ok) {
    ordersCreated.add(1);
    failureRate.add(false);
  } else {
    failureRate.add(true);
  }
  sleep(0.05);
}
