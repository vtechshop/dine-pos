import supertest from 'supertest';
import { ENV, superAdminHeaders, authHeaders } from './env';

export const api = supertest(ENV.API_URL);

// ── Auth shortcuts ─────────────────────────────────────────────────────────────

export const adminLogin = (userId: string, password: string) =>
  api.post('/api/auth/login').send({ userId, password });

export const kitchenLogin = (hotelId: string, pin: string) =>
  api.post('/api/auth/kitchen').send({ hotelId, pin });

export const waiterLogin = (hotelId: string, employeeCode: string, pin: string) =>
  api.post('/api/auth/waiter').send({ hotelId, employeeCode, pin });

export const cashierLogin = (hotelId: string, employeeCode: string, pin: string) =>
  api.post('/api/auth/cashier').send({ hotelId, employeeCode, pin });

export const refreshTokens = (refreshToken: string) =>
  api.post('/api/auth/refresh').send({ refreshToken });

export const logout = (refreshToken: string) =>
  api.post('/api/auth/logout').send({ refreshToken });

// ── Hotel registration ────────────────────────────────────────────────────────

export const registerHotel = (data: Record<string, unknown>) =>
  api.post('/api/hotels/register').send(data);

export const getHotelStatus = (phone: string) =>
  api.get(`/api/hotels/status/${phone}`);

// ── Super admin ───────────────────────────────────────────────────────────────

export const superAdminGetHotels = (query: Record<string, string> = {}) =>
  api.get('/api/superadmin/hotels').set(superAdminHeaders).query(query);

export const superAdminApproveHotel = (hotelId: string, body: Record<string, unknown> = {}) =>
  api.put(`/api/superadmin/hotels/${hotelId}/approve`).set(superAdminHeaders).send(body);

export const superAdminRejectHotel = (hotelId: string, reason: string) =>
  api.put(`/api/superadmin/hotels/${hotelId}/reject`).set(superAdminHeaders).send({ reason });

export const superAdminSuspendHotel = (hotelId: string) =>
  api.put(`/api/superadmin/hotels/${hotelId}/suspend`).set(superAdminHeaders);

export const superAdminActivateHotel = (hotelId: string) =>
  api.put(`/api/superadmin/hotels/${hotelId}/activate`).set(superAdminHeaders);

export const superAdminSetPlan = (hotelId: string, plan: string, durationDays: number) =>
  api.put(`/api/superadmin/hotels/${hotelId}/plan`).set(superAdminHeaders).send({ plan, durationDays });

export const superAdminExtendTrial = (hotelId: string, days: number) =>
  api.put(`/api/superadmin/hotels/${hotelId}/extend-trial`).set(superAdminHeaders).send({ days });

export const superAdminGetStats = () =>
  api.get('/api/superadmin/stats').set(superAdminHeaders);

export const superAdminHealth = () =>
  api.get('/api/superadmin/health').set(superAdminHeaders);

// ── Orders ────────────────────────────────────────────────────────────────────

export const getOrders = (token: string, query: Record<string, string> = {}) =>
  api.get('/api/orders').set(authHeaders(token)).query(query);

export const getOrder = (token: string, orderId: string) =>
  api.get(`/api/orders/${orderId}`).set(authHeaders(token));

export const createOrder = (token: string, body: Record<string, unknown>) =>
  api.post('/api/orders').set(authHeaders(token)).send(body);

export const updateOrderStatus = (token: string, orderId: string, status: string, extra: Record<string, unknown> = {}) =>
  api.patch(`/api/orders/${orderId}/status`).set(authHeaders(token)).send({ status, ...extra });

export const getKitchenOrders = (token: string) =>
  api.get('/api/orders/kitchen').set(authHeaders(token));

export const getWaiterOrders = (token: string) =>
  api.get('/api/orders/waiter').set(authHeaders(token));

export const getCashierOrders = (token: string) =>
  api.get('/api/orders/cashier').set(authHeaders(token));

export const getDailyReport = (token: string, date?: string) =>
  api.get('/api/orders/reports/daily').set(authHeaders(token)).query(date ? { date } : {});

export const getRangeReport = (token: string, from: string, to: string) =>
  api.get('/api/orders/reports/range').set(authHeaders(token)).query({ from, to });

export const getProductReport = (token: string, date?: string) =>
  api.get('/api/orders/reports/products').set(authHeaders(token)).query(date ? { date } : {});

// ── Products ──────────────────────────────────────────────────────────────────

export const getProducts = (token: string, query: Record<string, string> = {}) =>
  api.get('/api/products').set(authHeaders(token)).query(query);

export const getProduct = (token: string, productId: string) =>
  api.get(`/api/products/${productId}`).set(authHeaders(token));

export const createProduct = (token: string, body: Record<string, unknown>) =>
  api.post('/api/products').set(authHeaders(token)).send(body);

export const updateProduct = (token: string, productId: string, body: Record<string, unknown>) =>
  api.put(`/api/products/${productId}`).set(authHeaders(token)).send(body);

export const deleteProduct = (token: string, productId: string) =>
  api.delete(`/api/products/${productId}`).set(authHeaders(token));

// ── Categories ────────────────────────────────────────────────────────────────

export const getCategories = (token: string) =>
  api.get('/api/categories').set(authHeaders(token));

export const createCategory = (token: string, body: Record<string, unknown>) =>
  api.post('/api/categories').set(authHeaders(token)).send(body);

export const updateCategory = (token: string, categoryId: string, body: Record<string, unknown>) =>
  api.put(`/api/categories/${categoryId}`).set(authHeaders(token)).send(body);

export const deleteCategory = (token: string, categoryId: string) =>
  api.delete(`/api/categories/${categoryId}`).set(authHeaders(token));

// ── Tables ────────────────────────────────────────────────────────────────────

export const getTables = (token: string) =>
  api.get('/api/tables').set(authHeaders(token));

export const createTable = (token: string, body: Record<string, unknown>) =>
  api.post('/api/tables').set(authHeaders(token)).send(body);

// ── Public QR ─────────────────────────────────────────────────────────────────

export const getPublicMenu = (hotelId: string) =>
  api.get('/api/public/menu').query({ hotel: hotelId });

export const createQROrder = (body: Record<string, unknown>) =>
  api.post('/api/public/orders').send(body);

// ── Settings ──────────────────────────────────────────────────────────────────

export const getSettings = (token: string) =>
  api.get('/api/settings').set(authHeaders(token));

export const updateSettings = (token: string, body: Record<string, unknown>) =>
  api.put('/api/settings').set(authHeaders(token)).send(body);

// ── Subscription ──────────────────────────────────────────────────────────────

export const getSubscription = (token: string) =>
  api.get('/api/hotels/subscription').set(authHeaders(token));

// ── Waiters ───────────────────────────────────────────────────────────────────

export const getWaiters = (token: string) =>
  api.get('/api/waiters').set(authHeaders(token));

export const createWaiter = (token: string, body: Record<string, unknown>) =>
  api.post('/api/waiters').set(authHeaders(token)).send(body);

// ── Cashiers ──────────────────────────────────────────────────────────────────

export const getCashiers = (token: string) =>
  api.get('/api/cashiers').set(authHeaders(token));

export const createCashier = (token: string, body: Record<string, unknown>) =>
  api.post('/api/cashiers').set(authHeaders(token)).send(body);
