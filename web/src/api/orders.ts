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
  q?: string;
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
  if (params.q)      q.set('q',      params.q);
  return apiFetch<OrdersResponse>(`/orders?${q}`);
}

export async function fetchKitchenOrders(): Promise<KDSOrder[]> {
  return apiFetch<KDSOrder[]>('/orders/kitchen');
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  extras?: { paymentMethod?: string },
): Promise<void> {
  await apiFetch<unknown>(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...extras }),
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
  notes?: string;
  grandTotal: number;
  subtotal: number;
  taxTotal: number;
  discountAmount?: number;
  // Batch 3: everything between the items and what is still owed
  couponDiscount?: number;
  loyaltyDiscount?: number;
  paymentDiscount?: number;
  giftVoucherAmount?: number;
  walletAmount?: number;
  deliveryFee?: number;
  amountSettled?: number;
  redeemedPoints?: number;
  customerPhone?: string;
  status: string;
  orderSource: string;
  isParcel: boolean;
  paymentMethod?: string | null;
  items: {
    productName: string; quantity: number; price: number; total: number;
    variantName?: string;
    selectedModifiers?: { modifierOptionName: string; modifierPrice: number }[];
    notes?: string;
  }[];
  createdAt: string;
  completedAt?: string | null;
  /** Set once the counter has taken payment (the order may still be in the kitchen) */
  paymentTime?: string | null;
}

export async function fetchCashierOrders(): Promise<CashierOrderItem[]> {
  return apiFetch<CashierOrderItem[]>('/orders/cashier');
}

/** Batch 3: bills with money still owed, from the server (not from kitchen status). */
export async function fetchPendingSummary(): Promise<{ orders: number; amount: number }> {
  return apiFetch<{ orders: number; amount: number }>('/orders/cashier/pending-summary');
}

export interface CreateOrderItem {
  product: string;
  productName: string;
  quantity: number;
  price: number;
  taxPercent: number;
  notes?: string;
  variantId?: string;
  variantName?: string;
}

export interface CreateOrderPayload {
  items: CreateOrderItem[];
  orderSource: 'dine-in' | 'takeaway' | 'qr' | 'kiosk' | 'waiter' | 'admin' | 'swiggy' | 'zomato';
  tableId?: string;
  tableNumber?: string;
  sessionId?: string;
  guestId?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  guestCount?: number;   // dine-in covers
  isParcel?: boolean;
  discountAmount?: number;
  couponCode?: string;
  giftVoucherCode?: string;
  redeemedPoints?: number;
  loyaltyDiscount?: number;
  deliveryCharge?: number;
  paymentMethod?: 'cash' | 'upi' | 'card' | 'split';
  splitDetails?: { cash: number; upi: number; card: number };
  offlineId?: string;
  /** Counter took payment while placing the order — it goes to the kitchen already paid */
  payNow?: boolean;
  /** Batch 3: the subtotal on the cashier's screen; the server refuses if prices changed. */
  expectedSubtotal?: number;
}

export async function createOrder(payload: CreateOrderPayload): Promise<CashierOrderItem> {
  return apiFetch<CashierOrderItem>('/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Batch 3 (3C): the reason is sent and stored (it was dropped). `refund: true` confirms that
// money already received for the bill is being refunded at the counter (the server refuses to
// cancel a paid bill otherwise, with code PAID_ORDER).
export async function cancelOrder(orderId: string, reason = '', refund = false): Promise<void> {
  await apiFetch<unknown>(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled', reason, ...(refund ? { refund: true } : {}) }),
  });
}

// Batch 3 (3D): who may discount, as the server enforces it.
export interface DiscountPolicy { role: string; canDiscount: boolean; maxPercent: number; maxCashierDiscountPercent: number }
export function fetchDiscountPolicy(): Promise<DiscountPolicy> {
  return apiFetch<DiscountPolicy>('/orders/discount-policy');
}
/** Admin only: cashier discount limit in % (0 = cashiers cannot discount). */
export function updateDiscountPolicy(maxCashierDiscountPercent: number): Promise<{ maxCashierDiscountPercent: number }> {
  return apiFetch('/orders/discount-policy', { method: 'PATCH', body: JSON.stringify({ maxCashierDiscountPercent }) });
}

// Batch 3 (3D): `reference` (UPI transaction / card approval no.) is stored with the payment —
// the cashier typed it but it was never sent (P4-PAY-01).
export async function completeOrder(orderId: string, reference = ''): Promise<void> {
  await apiFetch<unknown>(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', ...(reference ? { transactionId: reference } : {}) }),
  });
}

export async function updateOrderPayment(
  orderId: string,
  paymentMethod: string,
  splitDetails?: { cash: number; upi: number; card: number },
  transactionId?: string,
  upiApp?: string,
): Promise<void> {
  await apiFetch<unknown>(`/orders/${orderId}`, {
    method: 'PUT',
    body: JSON.stringify({
      paymentMethod,
      ...(splitDetails    ? { splitDetails }    : {}),
      ...(transactionId   ? { transactionId }   : {}),
      ...(upiApp          ? { upiApp }          : {}),
    }),
  });
}

// Bug C3 + H7 fix: use PATCH /orders/:id/payment — accepted by cashier role,
// and carries tipAmount + additionalDiscount that PUT /orders/:id dropped.
export async function patchOrderPayment(
  orderId: string,
  paymentMethod: string,
  splitDetails?: { cash: number; upi: number; card: number },
  tipAmount?: number,
  additionalDiscount?: number,
  redeemPoints?: number,
): Promise<void> {
  await apiFetch<unknown>(`/orders/${orderId}/payment`, {
    method: 'PATCH',
    body: JSON.stringify({
      paymentMethod,
      ...(splitDetails       ? { splitDetails }       : {}),
      ...(tipAmount          ? { tipAmount }          : {}),
      ...(additionalDiscount ? { additionalDiscount } : {}),
      ...(redeemPoints       ? { redeemPoints }       : {}),
    }),
  });
}

/**
 * Take payment at the counter for an order that is not closed yet (POST /orders/:id/pay).
 * A held order (pay before kitchen) is released to the kitchen; an order already in the
 * kitchen is marked paid and stays there until it is handed over / served.
 */
export async function payOrder(
  orderId: string,
  paymentMethod: string,
  splitDetails?: { cash: number; upi: number; card: number },
  reference = '',   // Batch 3 (3D): UPI / card reference, stored with the payment
): Promise<CashierOrderItem> {
  return apiFetch<CashierOrderItem>(`/orders/${orderId}/pay`, {
    method: 'POST',
    body: JSON.stringify({ paymentMethod, ...(splitDetails ? { splitDetails } : {}), ...(reference ? { reference } : {}) }),
  });
}
