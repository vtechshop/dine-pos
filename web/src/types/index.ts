// Shared types — imported from @dinepos/shared so apps/qr and apps/admin
// use the same definitions. All existing imports in this app are unchanged.
export type { FeatureFlags, Category, Product, OrderItem, PaymentMethod }
  from '@dinepos/shared/types';

// ── Hotel Settings ────────────────────────────────────────────────────────────

export interface LoyaltySettings {
  rewardName: string;
  pointsPerHundredRupees: number;
  minimumRedeemPoints: number;
  maximumRedeemPercent: number;
  pointValueInPaisa: number;
  expiryDays: number;
  roundingRule: 'floor' | 'round' | 'ceil';
  calculationBase: 'before_gst' | 'after_gst';
}

export interface Settings {
  _id?: string;
  hotelName: string;
  address?: string;
  phone?: string;
  email?: string;
  ownerName?: string;
  businessType?: 'veg' | 'non-veg' | 'both';
  gstNumber?: string;
  fssaiNumber?: string;
  panNumber?: string;
  footerText?: string;
  upiId?: string;
  currencySymbol: string;
  defaultTaxPercent: number;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfscCode?: string;
  bankAccountHolder?: string;
  printerWidth?: '58mm' | '80mm';
  printerMode?: 'single' | 'dual';
  kitchenPrinterAddress?: string;
  cashierPrinterAddress?: string;
  kotAutoPrint?: boolean;
  qrGuestTimeoutMinutes?: number;
  roleImageAdmin?: string;
  isSetupComplete?: boolean;
  loyaltySettings?: LoyaltySettings;
  isPremium?: boolean;
  premiumPlan?: string;
  premiumExpiry?: string | null;
  trialEndsAt?: string | null;
  features?: import('@dinepos/shared/types').FeatureFlags;
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
  guestCount: number;
  activeGuestCount: number;
  runningTotal: number;
}

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

export interface BillingOrder {
  _id: string;
  orderNumber: string;
  tableNumber: string;
  guestId: string;
  sessionId: string;
  items: import('@dinepos/shared/types').OrderItem[];
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

// ── Inventory ────────────────────────────────────────────────────────────────

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

// ── Orders (admin list view) ──────────────────────────────────────────────────

export interface OrderListItem {
  _id: string;
  orderNumber: string;
  tableNumber: string;
  customerName?: string;
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';
  paymentMethod?: string | null;
  grandTotal: number;
  subtotal: number;
  taxTotal: number;
  discountAmount?: number;
  orderSource: string;
  isParcel: boolean;
  items: { productName: string; quantity: number; price: number; total: number }[];
  createdAt: string;
  completedAt?: string | null;
}

export interface OrdersResponse {
  orders: OrderListItem[];
  total: number;
  page: number;
  pages: number;
}

// ── KDS Order ────────────────────────────────────────────────────────────────

export interface KDSOrder {
  _id: string;
  orderNumber: string;
  tableNumber: string;
  customerName?: string;
  notes?: string;
  status: 'pending' | 'preparing' | 'ready';
  isParcel: boolean;
  items: { productName: string; quantity: number }[];
  createdAt: string;
}

// ── Reservation ───────────────────────────────────────────────────────────────

export interface Reservation {
  _id: string;
  tableId?: string | null;
  tableNumber?: number | null;
  customerName: string;
  phone: string;
  partySize: number;
  date: string;
  time: string;
  status: 'confirmed' | 'seated' | 'cancelled' | 'no-show';
  notes: string;
  createdAt: string;
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
