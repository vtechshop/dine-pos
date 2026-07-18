// Shared order-domain types — used by apps/web, apps/qr, apps/admin.

export type OrderStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'paid'
  | 'cancelled';

export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'upi'
  | 'split'
  | 'complimentary';

// An item line inside an order — shape returned by the API in all order responses.
export interface OrderItem {
  productName: string;
  quantity:    number;
  price:       number;
  total:       number;
}
