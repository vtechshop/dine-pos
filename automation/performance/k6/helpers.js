import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.API_URL || 'http://localhost:5000';

export const SUPER_ADMIN_HEADERS = {
  'x-super-admin-id': __ENV.SUPER_ADMIN_ID || '',
  'x-super-admin-pass': __ENV.SUPER_ADMIN_PASS || '',
  'Content-Type': 'application/json',
};

export function jsonHeaders(token) {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function adminLogin(adminId, password) {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ userId: adminId, password }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'admin login 200': r => r.status === 200 });
  const body = JSON.parse(res.body);
  return body.token || body.accessToken || '';
}

export function kitchenLogin(hotelId, pin) {
  const res = http.post(
    `${BASE_URL}/api/auth/kitchen`,
    JSON.stringify({ hotelId, pin }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'kitchen login 200': r => r.status === 200 });
  const body = JSON.parse(res.body);
  return body.token || body.accessToken || '';
}

export function createOrder(token, overrides = {}) {
  const payload = {
    tableNumber: `T${Math.ceil(Math.random() * 20)}`,
    customerName: `Perf Customer ${Date.now()}`,
    orderSource: 'dine-in',
    items: [
      { productName: 'Paneer Masala', quantity: 1, price: 180, total: 180 },
      { productName: 'Naan', quantity: 2, price: 30, total: 60 },
    ],
    subtotal: 240,
    taxTotal: 21.6,
    grandTotal: 261.6,
    paymentMethod: 'cash',
    notes: '',
    offlineId: `perf-${Date.now()}-${Math.random()}`,
    ...overrides,
  };
  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify(payload),
    { headers: jsonHeaders(token) }
  );
  return res;
}

export function getOrders(token) {
  return http.get(`${BASE_URL}/api/orders`, { headers: jsonHeaders(token) });
}

export function getPublicMenu(hotelId) {
  return http.get(`${BASE_URL}/api/public/menu?hotel=${hotelId}`);
}

export function createQROrder(hotelId) {
  const payload = {
    hotelId,
    tableNumber: `T${Math.ceil(Math.random() * 20)}`,
    customerName: `QR Perf ${Date.now()}`,
    items: [{ productName: 'Veg Biryani', quantity: 1, price: 150, total: 150 }],
    subtotal: 150,
    taxTotal: 13.5,
    grandTotal: 163.5,
    orderSource: 'qr',
    offlineId: `qr-perf-${Date.now()}-${Math.random()}`,
  };
  return http.post(
    `${BASE_URL}/api/public/orders`,
    JSON.stringify(payload),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
