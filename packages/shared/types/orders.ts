// Shared order-domain types — used by apps/web, apps/qr, apps/admin.

export interface SelectedModifier {
  modifierGroupId:    string;
  modifierGroupName:  string;
  modifierOptionId:   string;
  modifierOptionName: string;
  modifierPrice:      number;
  modifierTotal:      number;
}

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
  | 'upi_intent'
  | 'upi_qr'
  | 'upi_collect'
  | 'split'
  | 'complimentary';

// An item line inside an order — shape returned by the API in all order responses.
export interface OrderItem {
  productName:       string;
  variantName?:      string;
  selectedModifiers?: SelectedModifier[];
  quantity:          number;
  price:             number;
  total:             number;
}
