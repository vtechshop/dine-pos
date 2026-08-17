// Shared types — imported from @dinepos/shared so apps/qr and apps/admin
// use the same definitions. All existing imports in this app are unchanged.
export type {
  FeatureFlags, Category, Product, ProductVariant, ModifierOption, ModifierGroup,
  OrderItem, PaymentMethod, SelectedModifier, KitchenStation, RecipeItem,
} from '@dinepos/shared/types';

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
  maxEarnPointsPerBill?: number;
  tierThresholds?: {
    silver?:   number;
    gold?:     number;
    platinum?: number;
  };
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
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
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
  items: {
    product?: string;
    productName: string;
    quantity: number;
    selectedModifiers?: import('@dinepos/shared/types').SelectedModifier[];
  }[];
  createdAt: string;
}

// ── Reservation ───────────────────────────────────────────────────────────────

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'arrived'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface Reservation {
  _id: string;
  tableId?: string | null;
  tableNumber?: number | null;
  customerId?: string | null;
  customerName: string;
  phone: string;
  email?: string;
  partySize: number;
  date: string;
  time: string;
  startMinutes?: number;
  durationMinutes?: number;
  status: ReservationStatus;
  occasion?: string;
  source?: 'walk_in' | 'phone' | 'website' | 'whatsapp' | 'instagram' | 'other';
  depositAmount?: number;
  depositStatus?: 'none' | 'pending' | 'paid';
  notes: string;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  noShowAt?: string | null;
  confirmedAt?: string | null;
  arrivedAt?: string | null;
  createdAt: string;
}

// ── Waitlist ──────────────────────────────────────────────────────────────────

export interface WaitlistEntry {
  _id: string;
  guestName: string;
  phone: string;
  partySize: number;
  seatingPreference?: string;
  priority?: number;
  estimatedWaitMinutes?: number;
  status: 'waiting' | 'notified' | 'seated' | 'cancelled' | 'expired';
  notifiedAt?: string | null;
  notes?: string;
  createdAt: string;
}

export interface ReservationStats {
  pending: number;
  confirmed: number;
  arrived: number;
  seated: number;
  completed: number;
  cancelled: number;
  no_show: number;
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

// ── Vendors ───────────────────────────────────────────────────────────────────

export type PaymentTerms = 'immediate' | 'net15' | 'net30' | 'net45' | 'net60' | 'custom';

export interface Vendor {
  _id:                string;
  vendorCode:         string;
  businessName:       string;
  contactPerson:      string;
  mobile:             string;
  alternateMobile:    string;
  email:              string;
  gstNumber:          string;
  pan:                string;
  address:            string;
  city:               string;
  state:              string;
  pincode:            string;
  paymentTerms:       PaymentTerms;
  creditLimit:        number;
  openingBalance:     number;
  currentOutstanding: number;
  notes:              string;
  isActive:           boolean;
  isDeleted:          boolean;
  createdBy:          string;
  updatedBy:          string;
  createdAt:          string;
  updatedAt:          string;
}

export interface VendorReport {
  totalVendors:     number;
  activeVendors:    number;
  inactiveVendors:  number;
  totalOutstanding: number;
  totalCreditLimit: number;
  topVendors: Array<{
    _id:                string;
    businessName:       string;
    vendorCode:         string;
    currentOutstanding: number;
    mobile:             string;
    creditLimit:        number;
  }>;
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

export type POStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface POItem {
  _id?:        string;
  productId?:  string;
  productName: string;
  variantId?:  string;
  variantName?: string;
  orderedQty:  number;
  receivedQty: number;
  unit:        string;
  unitPrice:   number;
  discount:    number;
  taxPercent:  number;
  lineTotal:   number;
  notes?:      string;
}

export interface PurchaseOrder {
  _id:          string;
  poNumber:     string;
  vendorId:     string;
  vendorSnapshot: {
    businessName: string;
    vendorCode:   string;
    mobile:       string;
    gstNumber:    string;
  };
  status:               POStatus;
  orderDate:            string;
  expectedDeliveryDate: string | null;
  currency:             string;
  notes:                string;
  items:                POItem[];
  subtotal:             number;
  taxTotal:             number;
  discount:             number;
  tax:                  number;
  shipping:             number;
  total:                number;
  createdBy:            string;
  approvedBy:           string;
  approvedAt:           string | null;
  cancelReason:         string;
  isDeleted:            boolean;
  createdAt:            string;
  updatedAt:            string;
}

export interface POReport {
  totalPOs:       number;
  draftCount:     number;
  pendingCount:   number;
  approvedCount:  number;
  sentCount:      number;
  partialCount:   number;
  receivedCount:  number;
  cancelledCount: number;
  totalValue:     number;
  pendingValue:   number;
  byVendor: Array<{
    _id:          string;
    businessName: string;
    poCount:      number;
    totalValue:   number;
  }>;
  byMonth: Array<{
    _id:        string;
    poCount:    number;
    totalValue: number;
  }>;
}

// ── GRN ───────────────────────────────────────────────────────────────────────

export type GRNStatus = 'pending' | 'partial' | 'completed' | 'cancelled';

export interface GRNItem {
  _id?:              string;
  poItemIndex?:      number;
  productId?:        string;
  ingredientId?:     string;
  productName:       string;
  variantId?:        string;
  variantName?:      string;
  orderedQty:        number;
  receivedQty:       number;
  damagedQty:        number;
  rejectedQty:       number;
  pendingQty:        number;
  returnedQty?:      number;
  unit:              string;
  purchasePrice:     number;
  batchNumber?:      string;
  manufacturingDate?: string;
  expiryDate?:       string;
  warehouse?:        string;
  notes?:            string;
}

export interface GRN {
  _id:          string;
  grnNumber:    string;
  poId:         string;
  poNumber:     string;
  vendorId:     string;
  vendorSnapshot: { businessName: string; vendorCode: string; mobile: string; gstNumber: string };
  receiveDate:  string;
  status:       GRNStatus;
  items:        GRNItem[];
  notes:        string;
  receivedBy:   string;
  cancelReason: string;
  isDeleted:    boolean;
  createdAt:    string;
  updatedAt:    string;
}

export interface GRNReport {
  totalGRNs:      number;
  pendingCount:   number;
  partialCount:   number;
  completedCount: number;
  cancelledCount: number;
  totalReceived:  number;
  totalDamaged:   number;
  totalRejected:  number;
  pendingPOs:     number;
  byVendor: Array<{ _id: string; businessName: string; grnCount: number; totalReceived: number; totalDamaged: number }>;
  byMonth:  Array<{ _id: string; grnCount: number; totalReceived: number }>;
}

// ── Vendor Payments & Ledger ──────────────────────────────────────────────────

export type VendorPaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque' | 'card';
export type LedgerEntryType =
  | 'purchase' | 'grn' | 'payment' | 'debit_note'
  | 'credit_note' | 'opening_balance' | 'adjustment';

export interface VendorPayment {
  _id:             string;
  paymentNumber:   string;
  vendorId:        string;
  vendorSnapshot:  { businessName: string; vendorCode: string; mobile: string };
  paymentDate:     string;
  paymentMethod:   VendorPaymentMethod;
  amount:          number;
  referenceNumber: string;
  notes:           string;
  attachment:      string;
  createdBy:       string;
  approvedBy:      string;
  isReversed:      boolean;
  reversedBy:      string;
  reversedAt:      string | null;
  reversalReason:  string;
  isDeleted:       boolean;
  createdAt:       string;
  updatedAt:       string;
}

export interface VendorLedgerEntry {
  _id:             string;
  hotelId:         string;
  vendorId:        string;
  entryType:       LedgerEntryType;
  referenceId:     string | null;
  referenceNumber: string;
  debit:           number;
  credit:          number;
  runningBalance:  number;
  description:     string;
  createdAt:       string;
  updatedAt:       string;
}

export interface VendorLedgerReport {
  totalVendors:           number;
  vendorsWithOutstanding: number;
  totalOutstanding:       number;
  paymentThisMonth:       number;
  paymentCountThisMonth:  number;
  outstandingVendors: Array<{
    _id: string; businessName: string; vendorCode: string;
    mobile: string; email: string; currentOutstanding: number;
    creditLimit: number; paymentTerms: string;
  }>;
  recentPayments: VendorPayment[];
  aging: { current: number; days31_60: number; days61_90: number; over90: number };
}

// ── Vendor Returns ────────────────────────────────────────────────────────────

export type VendorReturnStatus = 'draft' | 'approved' | 'completed' | 'cancelled';

export interface VendorReturnItem {
  _id?:          string;
  grnItemIndex:  number;
  ingredientId?: string;
  productName:   string;
  unit:          string;
  purchasePrice: number;
  returnQty:     number;
  reason:        string;
  notes?:        string;
}

export interface VendorReturn {
  _id:          string;
  returnNumber: string;
  vendorId:     string;
  vendorSnapshot: { businessName: string; vendorCode: string; mobile: string };
  poId:         string;
  poNumber:     string;
  grnId:        string;
  grnNumber:    string;
  status:       VendorReturnStatus;
  items:        VendorReturnItem[];
  returnValue:  number;
  notes:        string;
  createdBy:    string;
  approvedBy:   string;
  approvedAt:   string | null;
  completedBy:  string;
  completedAt:  string | null;
  cancelledBy:  string;
  cancelledAt:  string | null;
  cancelReason: string;
  isDeleted:    boolean;
  createdAt:    string;
  updatedAt:    string;
}

export interface VendorReturnsResponse {
  returns: VendorReturn[];
  total:   number;
  limit:   number;
  skip:    number;
}

// ── Expenses ──────────────────────────────────────────────────────────────────

export interface Expense {
  _id: string;
  description: string;
  amount: number;
  category: 'ingredients' | 'utilities' | 'staff' | 'maintenance' | 'rent' | 'other';
  date: string;
  notes: string;
  createdAt: string;
}

// ── Waste Logs ────────────────────────────────────────────────────────────────

export type WasteReason =
  | 'expired'
  | 'spoiled'
  | 'damaged'
  | 'overcooked'
  | 'returned'
  | 'overproduction'
  | 'preparation'
  | 'spillage'
  | 'other';

export interface WasteLog {
  _id: string;
  productId?: string;
  ingredientId?: string;
  productName: string;
  quantity: number;
  unit: string;
  reason: WasteReason;
  estimatedLoss: number;
  date: string;
  notes: string;
  createdAt: string;
}

export interface WasteAnalytics {
  date: string;
  totalLoss: number;
  totalEntries: number;
  topItems: Array<{ productName: string; totalQty: number; totalLoss: number }>;
  byReason: Array<{ _id: string; count: number; totalLoss: number }>;
}

// ── Stock Movements ───────────────────────────────────────────────────────────

export type StockMovementType =
  | 'stock_in'
  | 'restock'
  | 'sale'
  | 'sale_reversal'
  | 'waste'
  | 'adjustment'
  | 'opening_stock'
  | 'grn';

export interface StockMovement {
  _id: string;
  hotelId: string;
  ingredientId: string;
  ingredientName: string;
  type: StockMovementType;
  delta: number;
  previousStock: number;
  resultingStock: number;
  costPerUnit: number | null;
  totalCost: number | null;
  referenceId: string;
  referenceType: 'order' | 'grn' | 'waste' | 'manual' | null;
  reason: string;
  notes: string;
  supplier: string;
  invoiceNumber: string;
  performedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventorySummary {
  total: number;
  lowStock: number;
  outOfStock: number;
  stockValue: number;
  todayWasteLoss: number;
}
