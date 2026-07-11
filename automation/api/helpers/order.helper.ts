import { v4 as uuidv4 } from 'uuid';
import { api } from '../../utils/api-client';
import { authHeaders } from '../../utils/env';

export interface OrderItem {
  productName: string;
  quantity: number;
  price: number;
  total: number;
}

export interface CreateOrderOptions {
  tableNumber?: string;
  customerName?: string;
  orderSource?: 'dine-in' | 'takeaway' | 'qr';
  items?: OrderItem[];
  paymentMethod?: string;
  offlineId?: string;
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
  const items = options.items || defaultItems();
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const taxTotal = Math.round(subtotal * 0.09 * 100) / 100;

  const payload = {
    tableNumber: options.tableNumber || 'T1',
    customerName: options.customerName || 'Test Customer',
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
