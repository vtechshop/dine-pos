// ── Hotel Settings ────────────────────────────────────────────────────────────

export interface Settings {
  _id?: string;
  hotelName: string;
  address?: string;
  phone?: string;
  gstNumber?: string;
  footerText?: string;
  upiId?: string;
  currencySymbol: string;
  defaultTaxPercent: number;
  printerWidth?: '58mm' | '80mm';
  printerMode?: 'single' | 'dual';
  kitchenPrinterAddress?: string;
  cashierPrinterAddress?: string;
  kotAutoPrint?: boolean;
}

// ── Tables ────────────────────────────────────────────────────────────────────

export interface Table {
  _id: string;
  number: number;
  name: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'inactive';
  currentSessionId: string | null;
  shape: 'square' | 'round';
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface SessionSummary {
  _id: string;
  tableNumber: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
  // Aggregated by the backend — always present for open sessions
  guestCount: number;
  activeGuestCount: number;
  runningTotal: number;
}

// Joined model used by the Table Grid — one record per physical table
export interface TableGridItem extends Table {
  session?: SessionSummary;
}

// ── Live Orders (socket-driven) ───────────────────────────────────────────────

export interface LiveOrderItem {
  productName: string;
  quantity: number;
  price?: number;
}

export interface LiveOrder {
  id: string;
  orderNumber: string;
  tableNumber: string;
  guestLabel?: string;
  items: LiveOrderItem[];
  totalAmount?: number;
  orderSource?: string;
  timestamp: string;
  isNew: boolean;
}

// ── Reports ───────────────────────────────────────────────────────────────────

export interface PaymentBreakdown {
  cash: number;
  upi: number;
  card: number;
  split: number;
}

export interface DailyReport {
  date: string;
  totalSales: number;
  totalTax: number;
  totalDiscount: number;
  totalOrders: number;
  parcelOrders: number;
  parcelRevenue: number;
  paymentBreakdown: PaymentBreakdown;
  sourceBreakdown: Record<string, number>;
}

// ── Billing ───────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'card' | 'upi' | 'split' | 'complimentary';

export interface Guest {
  _id: string;
  sessionId: string;
  hotelId: string;
  tableNumber: string;
  guestNumber: number;
  displayLabel: string;
  status: 'active' | 'billed' | 'left' | 'cancelled';
  totalAmount: number;
  paymentMethod?: string | null;
  billedAt?: string | null;
  paidAmount?: number | null;
  splitDetails?: { cash: number; upi: number; card: number };
  loyaltyPointsRedeemed?: number;
  loyaltyDiscountAmount?: number;
  customerId?: string | null;
  notes?: string;
  createdAt: string;
}

export interface OrderItem {
  productName: string;
  quantity: number;
  price: number;
  total: number;
}

export interface BillingOrder {
  _id: string;
  orderNumber: string;
  tableNumber: string;
  guestId: string;
  sessionId: string;
  items: OrderItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  orderSource: string;
  createdAt: string;
}

export interface GuestBill {
  guest: Guest;
  orders: BillingOrder[];
}

export interface SessionBill {
  session: SessionSummary & { tableNumber: string };
  guests: GuestBill[];
  grandTotal: number;
}

// ── Print Jobs ────────────────────────────────────────────────────────────────

export interface PrintJob {
  _id: string;
  jobType: 'kot' | 'receipt';
  status: 'pending' | 'sent' | 'success' | 'failed';
  printerTarget: 'kitchen' | 'cashier';
  guestId?: string | null;
  sessionId?: string | null;
  orderId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  sentAt?: string | null;
  printedAt?: string | null;
  attemptCount: number;
}

// ── Products & Categories (W4) ────────────────────────────────────────────────

export interface Category {
  _id: string;
  name: string;
  icon: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  _id: string;
  name: string;
  price: number;
  category: { _id: string; name: string; color: string } | null;
  taxPercent: number;
  hsnCode: string;
  image: string;
  isAvailable: boolean;
  isVeg: boolean;
  shortCode: string;
  description: string;
  stock: number;   // -1 = unlimited
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Inventory (W4) ────────────────────────────────────────────────────────────

export interface Ingredient {
  _id: string;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  costPerUnit: number;
  createdAt: string;
  updatedAt: string;
}

// ── Printer ───────────────────────────────────────────────────────────────────

export interface PrinterDeviceStatus {
  _id: string;
  deviceId: string;
  printerName: string | null;
  printerRole: 'kitchen' | 'cashier';
  online: boolean;
  lastHeartbeat: string | null;
  lastSeen: string | null;
}
