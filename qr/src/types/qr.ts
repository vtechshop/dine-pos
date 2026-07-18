// QR-app-specific types — not shared with other apps.

// One item in the customer's in-memory cart
export interface CartEntry {
  productId: string;
  name:      string;
  price:     number;
  quantity:  number;
  isVeg:     boolean;
  notes:     string;
}

// Shape returned by POST /api/public/qr/session
export interface QrSessionConfig {
  isReturning:            boolean;
  guestToken:             string | null;
  displayLabel?:          string;
  tableNumber?:           string;
  customerIdentification: 'disabled' | 'name_only' | 'name_mobile';
  requiresName:           boolean;
  requiresPhone:          boolean;
}

// One item in an order returned by /bill
export interface QrOrderLine {
  productName: string;
  quantity:    number;
  price:       number;
  taxPercent?: number;
  taxAmount?:  number;
  total:       number;
}

// One order inside the bill response
export interface QrOrder {
  _id:         string;
  orderNumber: string;
  status:      'pending' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';
  items:       QrOrderLine[];
  grandTotal:  number;
  createdAt:   string;
}

// Shape returned by GET /api/public/qr/bill
export interface QrBill {
  tableNumber:            string;
  displayLabel:           string;
  guestStatus:            'active' | 'billed' | 'left' | 'cancelled';
  orders:                 QrOrder[];
  subtotal:               number;
  taxTotal:               number;
  grandTotal:             number;
  isBilled:               boolean;
  paymentMethod?:         string | null;
  loyaltyBalance?:        number;
  loyaltyPointsRedeemed?: number;
  loyaltyDiscountAmount?: number;
  fetchedAt:              string;
}

// Guest identification form data
export interface GuestInfo {
  name:  string;
  phone: string;
}
