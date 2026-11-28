import { v4 as uuidv4 } from 'uuid';
import { api } from '../../utils/api-client';
import { authHeaders } from '../../utils/env';
import { getHotelA, getHotelB } from '../setup/testEnv';

export interface OrderItem {
  productName: string;
  quantity: number;
  price: number;
  total: number;
}

export interface CreateOrderOptions {
  tableNumber?: string;
  customerName?: string;
  customerPhone?: string;
  orderSource?: 'dine-in' | 'takeaway' | 'qr';
  items?: OrderItem[];
  paymentMethod?: string;
  offlineId?: string;
}

// ── Product linking ──────────────────────────────────────────────────────────
// POST /api/orders requires every line to reference a product of the hotel
// (price and tax come from the DB). Tests describe items by name, so each name
// is resolved to a real product of the token's hotel, created on first use.
// Products are created with the admin token of that hotel and taxPercent 0, so
// server totals equal the item prices the tests send.

const productIds = new Map<string, Promise<string>>(); // `${hotelId}|${name}|${price}` -> product id
const categoryIds = new Map<string, Promise<string>>(); // hotelId -> category id

function hotelIdOf(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return String(payload.hotelId || '');
  } catch {
    return '';
  }
}

function adminTokenFor(hotelId: string, fallback: string): string {
  for (const h of [getHotelA(), getHotelB()]) {
    if (h && h.hotelId === hotelId) return h.adminToken;
  }
  return fallback;
}

async function categoryFor(hotelId: string, adminToken: string): Promise<string> {
  if (!categoryIds.has(hotelId)) {
    categoryIds.set(hotelId, (async () => {
      const res = await api.post('/api/categories').set(authHeaders(adminToken))
        .send({ name: `Order Test Items ${uuidv4().slice(0, 8)}`, color: '#888888', icon: '🍽️' });
      const id = res.body.category?._id || res.body._id;
      if (!id) throw new Error(`linkItems: category create failed: ${res.status} ${JSON.stringify(res.body)}`);
      return id;
    })());
  }
  return categoryIds.get(hotelId)!;
}

async function productFor(hotelId: string, adminToken: string, name: string, price: number): Promise<string> {
  const key = `${hotelId}|${name}|${price}`;
  if (!productIds.has(key)) {
    productIds.set(key, (async () => {
      const category = await categoryFor(hotelId, adminToken);
      const res = await api.post('/api/products').set(authHeaders(adminToken))
        .send({ name, price, category, taxPercent: 0, isAvailable: true });
      const id = res.body.product?._id || res.body._id;
      if (!id) throw new Error(`linkItems: product "${name}" create failed: ${res.status} ${JSON.stringify(res.body)}`);
      return id;
    })());
  }
  return productIds.get(key)!;
}

/** Adds a real `product` id to every item that has none. */
export async function linkItems<T extends { productName?: string; price?: number; product?: string }>(
  token: string,
  items: T[],
): Promise<T[]> {
  const hotelId = hotelIdOf(token);
  if (!hotelId || !Array.isArray(items)) return items;
  const adminToken = adminTokenFor(hotelId, token);
  return Promise.all(items.map(async (it) => {
    if (!it || it.product || !it.productName) return it;
    const price = typeof it.price === 'number' && it.price > 0 ? it.price : 1;
    return { ...it, product: await productFor(hotelId, adminToken, it.productName, price) };
  }));
}

function defaultItems(): OrderItem[] {
  return [
    { productName: 'Paneer Masala', quantity: 2, price: 180, total: 360 },
    { productName: 'Naan', quantity: 2, price: 30, total: 60 },
  ];
}

export async function createOrder(
  token: string,
  options: CreateOrderOptions = {}
): Promise<{ orderId: string; orderNumber: string; body: any }> {
  const items = await linkItems(token, options.items || defaultItems());
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const taxTotal = Math.round(subtotal * 0.09 * 100) / 100;

  const payload = {
    tableNumber: options.tableNumber || 'T1',
    customerName: options.customerName || 'Test Customer',
    customerPhone: options.customerPhone || '9999999999',
    orderSource: options.orderSource || 'dine-in',
    items,
    subtotal,
    taxTotal,
    grandTotal: subtotal + taxTotal,
    paymentMethod: options.paymentMethod || 'cash',
    notes: '',
    offlineId: options.offlineId || uuidv4(),
  };

  const res = await api.post('/api/orders').set(authHeaders(token)).send(payload);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createOrder failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const order = res.body.order || res.body;
  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    body: res.body,
  };
}

export async function updateOrderStatus(
  token: string,
  orderId: string,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<any> {
  const res = await api
    .patch(`/api/orders/${orderId}/status`)
    .set(authHeaders(token))
    .send({ status, ...extra });
  if (res.status !== 200) {
    throw new Error(`updateOrderStatus to "${status}" failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.order || res.body;
}

export async function createCompletedOrder(
  adminToken: string,
  kitchenToken: string,
  waiterToken: string,
  cashierToken: string
): Promise<{ orderId: string; orderNumber: string }> {
  const { orderId, orderNumber } = await createOrder(adminToken);
  await updateOrderStatus(kitchenToken, orderId, 'preparing');
  await updateOrderStatus(kitchenToken, orderId, 'ready');
  await updateOrderStatus(waiterToken, orderId, 'served');
  await updateOrderStatus(cashierToken, orderId, 'completed');
  return { orderId, orderNumber };
}

export async function getOrders(token: string, query: Record<string, string> = {}): Promise<any[]> {
  const res = await api.get('/api/orders').set(authHeaders(token)).query(query);
  if (res.status !== 200) throw new Error(`getOrders failed: ${res.status}`);
  return res.body.orders || res.body.data || res.body;
}

export async function getOrder(token: string, orderId: string): Promise<any> {
  const res = await api.get(`/api/orders/${orderId}`).set(authHeaders(token));
  if (res.status !== 200) throw new Error(`getOrder failed: ${res.status}`);
  return res.body.order || res.body;
}

export async function getKitchenOrders(token: string): Promise<any[]> {
  const res = await api.get('/api/orders/kitchen').set(authHeaders(token));
  if (res.status !== 200) throw new Error(`getKitchenOrders failed: ${res.status}`);
  return res.body.orders || res.body.data || res.body;
}

export async function getWaiterOrders(token: string): Promise<any[]> {
  const res = await api.get('/api/orders/waiter').set(authHeaders(token));
  if (res.status !== 200) throw new Error(`getWaiterOrders failed: ${res.status}`);
  return res.body.orders || res.body.data || res.body;
}

export async function getCashierOrders(token: string): Promise<any[]> {
  const res = await api.get('/api/orders/cashier').set(authHeaders(token));
  if (res.status !== 200) throw new Error(`getCashierOrders failed: ${res.status}`);
  return res.body.orders || res.body.data || res.body;
}
