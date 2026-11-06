import { v4 as uuidv4 } from 'uuid';
import { api } from '../../utils/api-client';
import { authHeaders } from '../../utils/env';
import { getTestState, HotelState } from '../setup/testEnv';

export interface OrderItem {
  /** Product id — required: POS order lines must reference a product of the hotel. */
  product?: string;
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

/** Hotel (A or B) the JWT belongs to. Payload is decoded, not verified — test helper only. */
export function hotelForToken(token: string): HotelState {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const state = getTestState();
  const hotel = [state.hotelA, state.hotelB].find(h => h.hotelId === payload.hotelId);
  if (!hotel) throw new Error(`[order.helper] token does not belong to a seeded test hotel (${payload.hotelId})`);
  return hotel;
}

/**
 * An order line linked to one of the hotel's seeded products (globalSetup:
 * [0] Paneer Masala ₹180, [1] Naan ₹30). The server prices lines from the DB
 * and rejects lines without a product (422).
 */
export function productLine(hotel: HotelState, index: 0 | 1, quantity = 1): OrderItem {
  const p = hotel.products[index];
  return { product: p.id, productName: p.name, quantity, price: p.price, total: p.price * quantity };
}

function defaultItems(token: string): OrderItem[] {
  const hotel = hotelForToken(token);
  return [productLine(hotel, 0, 2), productLine(hotel, 1, 2)];
}

export async function createOrder(
  token: string,
  options: CreateOrderOptions = {}
): Promise<{ orderId: string; orderNumber: string; body: any }> {
  const items = options.items || defaultItems(token);
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
