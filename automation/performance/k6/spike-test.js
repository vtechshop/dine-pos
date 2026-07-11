import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { adminLogin, createOrder, getOrders, getPublicMenu } from './helpers.js';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '30s', target: 500 },
    { duration: '1m', target: 500 },
    { duration: '10s', target: 10 },
    { duration: '30s', target: 500 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.15'],
    errors: ['rate<0.15'],
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

  if (r < 0.5) {
    res = getOrders(token);
  } else if (r < 0.75) {
    res = createOrder(token);
  } else {
    res = getPublicMenu(hotelId);
  }

  const ok = check(res, { 'status < 500': x => x.status < 500 });
  errorRate.add(!ok);

  sleep(0.1);
}
