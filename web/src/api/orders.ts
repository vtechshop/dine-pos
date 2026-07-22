import { apiFetch } from './client';
import type { OrdersResponse, KDSOrder } from '../types';

export interface OrderCustomer {
  phone: string;
  customerName: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: string;
  firstOrderDate: string;
}

export interface FetchOrdersParams {
  date?: string;
  from?: string;
  to?: string;
  status?: string;
  source?: string;
  page?: number;
  limit?: number;
}

export async function fetchOrders(params: FetchOrdersParams = {}): Promise<OrdersResponse> {
  const q = new URLSearchParams();
  if (params.date)   q.set('date',   params.date);
  if (params.from)   q.set('from',   params.from);
  if (params.to)     q.set('to',     params.to);
  if (params.status) q.set('status', params.status);
  if (params.source) q.set('source', params.source);
  if (params.page)   q.set('page',   String(params.page));
  if (params.limit)  q.set('limit',  String(params.limit));
  return apiFetch<OrdersResponse>(`/orders?${q}`);
}

export async function fetchKitchenOrders(): Promise<KDSOrder[]> {
  return apiFetch<KDSOrder[]>('/orders/kitchen');
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
): Promise<void> {
  await apiFetch<unknown>(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function fetchOrderCustomers(): Promise<{ customers: OrderCustomer[]; total: number }> {
  return apiFetch('/orders/customers');
}

export interface CashierOrderItem {
  _id: string;
  orderNumber: string;
  tableNumber: string;
  customerName?: string;
  grandTotal: number;
  subtotal: number;
  taxTotal: number;
  discountAmount?: number;
  status: string;
  orderSource: string;
  isParcel: boolean;
  paymentMethod?: string | null;
  items: { productName: string; quantity: number; price: number; total: number }[];
  createdAt: string;
  completedAt?: string | null;
}

export async function fetchCashierOrders(): Promise<CashierOrderItem[]> {
  return apiFetch<CashierOrderItem[]>('/orders/cashier');
}
