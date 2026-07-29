// Category
export interface Category {
  _id: string;
  name: string;
  icon: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

// Recipe item (raw material consumed per unit of product sold)
export interface RecipeItem {
  ingredient: string; // Ingredient _id
  quantity: number;
}

// Product variant (e.g. Small, Medium, Large with different prices)
export interface ProductVariant {
  _id:   string;
  name:  string;
  price: number;
}

// Modifier option (e.g. Extra Cheese ₹40)
export interface ModifierOption {
  _id:          string;
  name:         string;
  price:        number;
  sku?:         string;
  isActive:     boolean;
  displayOrder: number;
}

// Modifier group (e.g. Add-ons, Spice Level)
export interface ModifierGroup {
  _id:           string;
  name:          string;
  description?:  string;
  isActive:      boolean;
  displayOrder:  number;
  isRequired:    boolean;
  selectionType: 'single' | 'multi';
  minSelections: number;
  maxSelections: number;
  options:       ModifierOption[];
}

// Selected modifier stored in cart and order
export interface SelectedModifier {
  modifierGroupId:    string;
  modifierGroupName:  string;
  modifierOptionId:   string;
  modifierOptionName: string;
  modifierPrice:      number;
  modifierTotal:      number;
}

// Product
export interface ChannelPrices {
  swiggy?: number;
  zomato?: number;
  qr?: number;
  kiosk?: number;
}

export interface Product {
  _id: string;
  name: string;
  price: number;
  category: Category | string;
  taxPercent: number;
  hsnCode?: string;
  image: string;
  isAvailable: boolean;
  isVeg: boolean;
  shortCode: string;
  description: string;
  stock: number; // -1 = unlimited, 0 = out of stock, >0 = count
  recipe?: RecipeItem[];
  channelPrices?: ChannelPrices;
  variants?: ProductVariant[];
  modifierGroups?: ModifierGroup[];
}

// Ingredient (raw material)
export interface Ingredient {
  _id: string;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  costPerUnit: number;
}

// Cart Item (product + quantity in current order)
export interface CartItem {
  product: Product;
  quantity: number;
  taxAmount: number;
  total: number;
  effectivePrice: number;   // channel-aware / variant unit price (excludes modifiers)
  modifierTotal: number;    // sum of all selected modifier prices (per unit)
  cartLineId: string;       // dedup key: productId:variantId:modKey
  variantId?: string;
  variantName?: string;
  selectedModifiers?: SelectedModifier[];
}

// Order Item (stored in DB)
export interface OrderItem {
  product: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  selectedModifiers?: SelectedModifier[];
  quantity: number;
  price: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
}

// Order
export interface Order {
  _id: string;
  orderNumber: string;
  items: OrderItem[];
  subtotal: number;
  taxTotal: number;
  discountAmount: number;
  grandTotal: number;
  paymentMethod: 'cash' | 'upi' | 'card' | 'split' | 'razorpay';
  splitDetails: {
    cash?: number;
    upi?: number;
    card?: number;
  };
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  orderSource?: 'dine-in' | 'takeaway' | 'swiggy' | 'zomato' | 'qr';
  isParcel: boolean;
  customerName: string;
  customerPhone: string;
  tableNumber: string;
  notes: string;
  // Delivery / aggregator fields (present only for Swiggy/Zomato orders)
  platformOrderId?: string;
  deliveryAddress?: string;
  deliveryFee?: number;
  platformCommission?: number;
  acceptedAt?: string | null;
  deliveryPartnerName?: string;
  createdAt: string;
  updatedAt: string;
}

// Settings
export interface Settings {
  _id?: string;
  hotelName: string;
  address: string;
  phone: string;
  email: string;
  ownerName: string;
  fssaiNumber: string;
  panNumber: string;
  businessType: 'veg' | 'non-veg' | 'both';
  bankName: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  bankAccountHolder: string;
  upiId: string;
  gstNumber: string;
  defaultTaxPercent: number;
  currency: string;
  currencySymbol: string;
  printerWidth: '58mm' | '80mm';
  footerText: string;
  kitchenPin: string;
  isSetupComplete: boolean;
  qrGuestTimeoutMinutes?: number;
  // Phase 7 — dual printer engine
  printerMode?: 'single' | 'dual';
  kitchenPrinterAddress?: string;
  cashierPrinterAddress?: string;
  kotAutoPrint?: boolean;
  features?: FeatureFlags;
  isPremium?: boolean;
  premiumPlan?: string;
  premiumExpiry?: string | null;
  trialEndsAt?: string | null;
  roleImageAdmin?: string;
  roleImageCustomer?: string;
  roleImageStaff?: string;
}

// Daily Report
export interface DailyReport {
  date: string;
  totalSales: number;
  totalTax: number;
  totalOrders: number;
  parcelOrders?: number;
  parcelRevenue?: number;
  totalDiscount?: number;
  paymentBreakdown: {
    cash: number;
    upi: number;
    card: number;
    split: number;
  };
  sourceBreakdown?: {
    'dine-in': { orders: number; revenue: number };
    takeaway:  { orders: number; revenue: number };
    swiggy:    { orders: number; revenue: number };
    zomato:    { orders: number; revenue: number };
    qr:        { orders: number; revenue: number };
  };
}

// Minimal shape needed to print a kitchen ticket (KOT) — the full Order
// satisfies this too, so the same print functions work for live and offline orders
export interface KOTOrderInput {
  orderNumber: string;
  items: { productName: string; quantity: number }[];
  tableNumber: string;
  notes: string;
  createdAt: string;
}

// Customer (aggregated from orders)
export interface Customer {
  phone: string;
  customerName: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: string;
  firstOrderDate: string;
}

// Feature flags per hotel
export interface FeatureFlags {
  payment: boolean;
  reservations: boolean;
  customerChat: boolean;
  qrOrdering: boolean;
  expenses: boolean;
  reports: boolean;
  tables: boolean;
  ingredients: boolean;
  waste: boolean;
  aggregator: boolean;
  loyaltyProgram?: boolean;
}

// Loyalty
export interface LoyaltyConfig {
  rewardName: string;
  pointsPerHundredRupees: number;
  minimumRedeemPoints: number;
  maximumRedeemPercent: number;
  pointValueInPaisa: number;
  expiryDays: number | null;
  roundingRule: 'floor' | 'ceil' | 'round';
  calculationBase: 'before_gst' | 'after_gst';
}

export interface LoyaltyCustomer {
  _id: string;
  customerId: string;
  name: string;
  phone: string;
  loyaltyBalance: number;
  lifetimeSpend: number;
  visitCount: number;
  lastVisitAt: string;
  status: 'active' | 'merged' | 'blocked';
}

export interface LoyaltyTransaction {
  _id: string;
  transactionType: 'earn' | 'redeem' | 'adjust' | 'expire' | 'transfer_in' | 'transfer_out';
  points: number;
  balanceAfter: number;
  orderId?: string;
  remarks?: string;
  expiresAt?: string | null;
  createdAt: string;
}

// Remote Config (system-wide, fetched on startup)
export interface RemoteConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  minimumAppVersion: string;
  minimumAppVersionIos: string;
  forceUpdate: boolean;
  forceUpdateMessage: string;
  trialDays: number;
  paymentEnabled: boolean;
  broadcastMessage: string;
  broadcastMessageType: 'info' | 'warning' | 'success';
}

// Device
export interface Device {
  _id: string;
  deviceId: string;
  hotelId: string | { _id: string; hotelName: string };
  deviceName: string;
  platform: 'android' | 'ios' | 'web';
  appVersion: string;
  osVersion: string;
  lastSeen: string;
  isOnline: boolean;
  createdAt: string;
}

// Broadcast Notification
export interface AppNotification {
  _id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'maintenance' | 'update' | 'success';
  isRead: boolean;
  createdAt: string;
  expiresAt: string | null;
}

// Hotel (SaaS tenant)
export type BusinessType =
  | 'restaurant' | 'hotel' | 'bakery' | 'cafe' | 'sweet-shop'
  | 'juice-shop' | 'fast-food' | 'cloud-kitchen' | 'food-court' | 'mess' | 'catering'
  | 'veg' | 'non-veg' | 'both';

export interface Hotel {
  _id: string;
  hotelName: string;
  ownerName: string;
  businessType: BusinessType;
  referralCode?: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  fssaiNumber: string;
  fssaiVerified: boolean;
  gstNumber: string;
  gstVerified: boolean;
  panNumber: string;
  panVerified: boolean;
  bankName: string;
  bankBranch: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  upiId: string;
  ifscVerified: boolean;
  adminId?: string;
  status: 'pending' | 'trial' | 'active' | 'expired' | 'suspended' | 'rejected';
  rejectionReason: string;
  approvedAt: string | null;
  resetRequested?: boolean;
  resetRequestedAt?: string | null;
  resetFulfilledAt?: string | null;
  trialStartDate?: string | null;
  trialEndDate?: string | null;
  subscriptionPlan?: 'none' | 'starter' | 'professional' | 'enterprise';
  planStartDate?: string | null;
  planExpiryDate?: string | null;
  subscriptionType?: 'trial' | 'starter' | 'professional' | 'enterprise';
  subscriptionStartDate?: string | null;
  subscriptionEndDate?: string | null;
  features?: FeatureFlags;
  isPremium?: boolean;
  premiumPlan?: string;
  premiumExpiry?: string | null;
  trialEndsAt?: string | null;
  createdAt: string;
}

export interface SuperAdminStats {
  total: number;
  pending: number;
  trial: number;
  active: number;
  expired: number;
  suspended: number;
  rejected: number;
  resetRequests: number;
  todayRegistrations: number;
}

// Table
export interface Table {
  _id: string;
  number: number;
  name: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'inactive';
  currentOrderId?: string;
  x: number;
  y: number;
  shape: 'square' | 'round';
}

// Reservation
export interface Reservation {
  _id: string;
  tableId?: string;
  tableNumber?: number;
  customerName: string;
  phone: string;
  partySize: number;
  date: string;
  time: string;
  status: 'confirmed' | 'seated' | 'cancelled' | 'no-show';
  notes: string;
  createdAt: string;
}

// Expense
export interface Expense {
  _id: string;
  description: string;
  amount: number;
  category: 'ingredients' | 'utilities' | 'staff' | 'maintenance' | 'rent' | 'other';
  date: string;
  notes: string;
  createdAt: string;
}

// Waste Log
export interface WasteLog {
  _id: string;
  productId?: string;
  productName: string;
  quantity: number;
  unit: string;
  reason: 'expired' | 'damaged' | 'overcooked' | 'returned' | 'other';
  estimatedLoss: number;
  date: string;
  notes: string;
  createdAt: string;
}

// GST Report
export interface GSTReportRow {
  taxPercent: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  totalValue: number;
  totalItems: number;
}

export interface GSTReport {
  from: string;
  to: string;
  rows: GSTReportRow[];
  totalTaxableValue: number;
  totalCGST: number;
  totalSGST: number;
  totalTax: number;
  totalValue: number;
}

// Tally Export
export interface TallyRow {
  date: string;
  voucherNo: string;
  party: string;
  paymentMode: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  discount: number;
  grandTotal: number;
  narration: string;
}

export interface TallyReport {
  from: string;
  to: string;
  rows: TallyRow[];
  totalOrders: number;
  totalRevenue: number;
  totalTax: number;
}

// GSTR-1 JSON (portal upload format)
export interface GSTR1B2CSEntry {
  camt: number; csamt: number; iamt: number;
  pos: string; rt: number; samt: number;
  sply_ty: string; txval: number; typ: string;
}
export interface GSTR1HsnEntry {
  num: number; hsn_sc: string; desc: string; uqc: string;
  qty: number; val: number; txval: number;
  iamt: number; camt: number; samt: number; csamt: number; rt: number;
}
export interface GSTR1Json {
  gstin: string;
  fp: string;
  version: string;
  hash: string;
  b2b: any[];
  b2cs: GSTR1B2CSEntry[];
  hsn: { hsn_b2b: GSTR1HsnEntry[]; hsn_b2c: GSTR1HsnEntry[] };
}

// P&L Report
export interface PnLReport {
  date: string;
  revenue: number;
  orders: number;
  expenses: number;
  profit: number;
  profitMargin: string;
  breakdown: { _id: string; total: number; count: number }[];
}

// Aggregator Integration
export interface AggregatorIntegration {
  _id: string;
  platform: 'swiggy' | 'zomato';
  enabled: boolean;
  storeId: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  autoAccept: boolean;
  connectionStatus: 'disconnected' | 'connected' | 'error';
  menuSyncStatus: 'idle' | 'syncing' | 'success' | 'failed';
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncedItemCount: number;
  failedItemCount: number;
  lastOrderAt: string | null;
}

export interface AggregatorSyncStatus {
  menuSyncStatus: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncedItemCount: number;
  failedItemCount: number;
  connectionStatus: string;
  lastOrderAt: string | null;
}

export interface WebhookLog {
  _id: string;
  platform: string;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  orderId: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  nextRetryAt: string | null;
}

// Settings additions
export interface SubscriptionInfo {
  subscriptionStatus: string;
  subscriptionType: string;
  trialEndDate: string | null;
  subscriptionEndDate: string | null;
  daysRemaining: number;
  isExpired: boolean;
  hotelName: string;
}

// Vendor
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
  createdAt:          string;
  updatedAt:          string;
}

// GRN
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

// Purchase Orders
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
  isReversed:      boolean;
  reversalReason:  string;
  createdAt:       string;
}

export interface VendorLedgerEntry {
  _id:             string;
  vendorId:        string;
  entryType:       LedgerEntryType;
  referenceNumber: string;
  debit:           number;
  credit:          number;
  runningBalance:  number;
  description:     string;
  createdAt:       string;
}

export interface VendorLedgerStatement {
  vendor:             Vendor;
  entries:            VendorLedgerEntry[];
  totalDebit:         number;
  totalCredit:        number;
  currentOutstanding: number;
}

export interface FinanceDashboard {
  period: { from: string; to: string };
  revenue: number;
  orderCount: number;
  cogs: number;
  foodCostPct: number;
  grossProfit: number;
  grossMarginPct: number;
  totalExpenses: number;
  wasteTotal: number;
  netProfit: number;
  netMarginPct: number;
}

export interface MenuProfitabilityItem {
  productId: string;
  productName: string;
  qtySold: number;
  revenue: number;
  totalCOGS: number;
  grossProfit: number;
  avgSellingPrice: number;
  avgRecipeCostPerUnit: number;
  grossProfitPerUnit: number;
  marginPct: number;
  contributionMarginPerUnit: number;
}

export interface MenuProfitabilityReport {
  items: MenuProfitabilityItem[];
  total: number;
  summary: {
    totalRevenue: number;
    totalCOGS: number;
    totalGrossProfit: number;
    overallMarginPct: number;
  };
}

export type RootStackParamList = {
  Splash: undefined;
  RoleSelect: undefined;
  AdminLogin: { sessionExpired?: boolean } | undefined;
  BusinessSetup: { resubmit?: boolean; rejectionReason?: string; phone?: string } | undefined;
  HotelStatus: { status: 'pending' | 'trial' | 'expired' | 'suspended'; hotelName?: string; trialDaysRemaining?: number };
  ForceUpdate: { minimumVersion: string; message?: string };
  MaintenanceMode: { message?: string };
  MainTabs: undefined;
  CustomerTabs: undefined;
  SuperAdminLogin: undefined;
  SuperAdminDashboard: undefined;
  Support: undefined;
  CustomerOrderConfirm: { orderNumber: string; grandTotal: number; paymentMethod: string };
  AddProduct: { product?: Product };
  Categories: undefined;
  Products: undefined;
  TableLayout: undefined;
  Reservations: undefined;
  Expenses: undefined;
  QRMenu: undefined;
  Customers: undefined;
  Ingredients: undefined;
  Chat: undefined;
  LoyaltyProgram: undefined;
  KitchenLogin: undefined;
  KitchenDisplay: undefined;
  OnlineOrders: undefined;
  WaiterLogin: undefined;
  WaiterDisplay: undefined;
  WaiterManagement: undefined;
  CashierLogin: undefined;
  CashierDashboard: undefined;
  CashierManagement: undefined;
  StaffRole: undefined;
  TrustedDevices: undefined;
  SubscriptionExpired: { hotelName: string; expiredOn: string; subscriptionType: string };
  HotelRegister: undefined;
  HotelRegisterSuccess: undefined;
  Notifications: undefined;
  AggregatorConfig: undefined;
  Vendors: undefined;
  PurchaseOrders: undefined;
  GoodsReceive:   undefined;
  VendorLedger:          undefined;
  InventoryIntelligence: undefined;
  PaymentSettings: undefined;
  AIHome: undefined;
  MorningBrief: undefined;
  AIReports: undefined;
  AIChat: undefined;
  AIForecast: undefined;
  AIAlerts: undefined;
  AIRecommendations: undefined;
  StaffKitchen: undefined;
  PurchaseAssistant: undefined;
};

export type TabParamList = {
  Home: undefined;
  Billing: undefined;
  Orders: undefined;
  Reports: undefined;
  Settings: undefined;
};

export type CustomerTabParamList = {
  Menu: undefined;
  Cart: undefined;
  OrderStatus: undefined;
};

// ── AI Platform Types ─────────────────────────────────────────────────────────

export interface AIAlertItem {
  type:      string;
  severity:  'critical' | 'warning' | 'info';
  title:     string;
  message:   string;
  value:     number;
  baseline:  number;
  changePct: number;
}

export interface AIAlertResult {
  date:       string;
  dataSource: 'realtime' | 'snapshot';
  checkedAt:  string;
  alerts:     AIAlertItem[];
}

export interface AIMenuItemScore {
  productId:      string;
  productName:    string;
  qty:            number;
  revenue:        number;
  revenuePerUnit: number;
  quadrant:       'star' | 'plow_horse' | 'puzzle' | 'dog';
}

export interface AIUpsellTarget {
  productName:    string;
  revenuePerUnit: number;
  currentOrders:  number;
  reason:         string;
}

export interface AICrossSell {
  triggerItem: string;
  suggestItem: string;
  reason:      string;
}

export interface AICombo {
  items:  string[];
  reason: string;
}

export interface AISlowMover {
  productName: string;
  qty:         number;
  revenue:     number;
  suggestion:  string;
}

export interface AIRecommendationSet {
  date:            string;
  generatedAt:     string;
  insightSource:   'cache' | 'gemini' | 'unavailable';
  insight:         string | null;
  menuEngineering: AIMenuItemScore[];
  stars:           AIMenuItemScore[];
  plowHorses:      AIMenuItemScore[];
  puzzles:         AIMenuItemScore[];
  dogs:            AIMenuItemScore[];
  upsellTargets:   AIUpsellTarget[];
  crossSell:       AICrossSell[];
  combos:          AICombo[];
  slowMovers:      AISlowMover[];
  highMarginItems: AIMenuItemScore[];
}

export interface ForecastPoint {
  date:  string;
  value: number;
}

export interface ForecastMeta {
  method:     string;
  confidence: number;
  mape:       number;
}

export interface PeakHourPoint {
  hour:          number;
  avgRevShare:   number;
  avgOrderShare: number;
}

export interface ItemDemandForecast {
  productId:   string;
  productName: string;
  forecastQty: number;
  avgQty7d:    number;
  trend:       'rising' | 'falling' | 'stable';
}

export interface SalesForecast {
  generatedAt:          string;
  dataPoints:           number;
  revenueNext7d:        ForecastPoint[];
  revenueNext30d:       ForecastPoint[];
  revenueForecastMeta:  ForecastMeta;
  ordersNext7d:         ForecastPoint[];
  ordersNext30d:        ForecastPoint[];
  ordersForecastMeta:   ForecastMeta;
  forecastWeekRevenue:  number;
  forecastWeekOrders:   number;
  avgForecastAOV:       number;
  peakHourDistribution: PeakHourPoint[];
  topPeakHours:         number[];
  itemDemand:           ItemDemandForecast[];
  tableUtilNext7d:      ForecastPoint[];
  narrative:            string | null;
  narrativeSource:      'cache' | 'gemini' | 'unavailable';
}

export interface IngredientPrediction {
  ingredientId:        string;
  name:                string;
  unit:                string;
  currentStock:        number;
  lowStockThreshold:   number;
  costPerUnit:         number;
  estimatedDailyUsage: number;
  daysRemaining:       number;
  status:              'critical' | 'warning' | 'ok' | 'overstock';
  reorderQty:          number;
  reorderCost:         number;
  usageSource:         'grn' | 'heuristic';
}

export interface InventoryCoverage {
  criticalCount:  number;
  warningCount:   number;
  okCount:        number;
  overstockCount: number;
}

export interface InventoryForecast {
  generatedAt:      string;
  totalIngredients: number;
  totalReorderCost: number;
  coverageSummary:  InventoryCoverage;
  criticalItems:    IngredientPrediction[];
  warningItems:     IngredientPrediction[];
  healthyItems:     IngredientPrediction[];
  overstockItems:   IngredientPrediction[];
  topReorderItems:  IngredientPrediction[];
}

export interface AIChatMessage {
  role:      'user' | 'assistant';
  content:   string;
  timestamp: string;
}

export interface AIChatResponse {
  sessionId:    string;
  reply:        string;
  timestamp:    string;
  isNewSession: boolean;
  contextAge:   'cache' | 'fresh';
}

export interface AIChatHistoryResponse {
  sessionId: string;
  messages:  AIChatMessage[];
}

export interface AIHealthScore {
  score: number;
  grade: string;
}

export interface AIDailyReportSnapshot {
  totalRevenue:            number;
  totalOrders:             number;
  avgOrderValue:           number;
  cancelledOrders:         number;
  cancelledRevenue:        number;
  paymentBreakdown:        { cash: number; upi: number; card: number; split: number };
  sourceBreakdown:         { dineIn: number; takeaway: number; qr: number; swiggy: number; zomato: number; other: number };
  topItems:                Array<{ productName: string; qty: number; revenue: number }>;
  peakHour:                number;
  peakHourRevenue:         number;
  hourlyRevenue:           number[];
  hourlyOrders:            number[];
  uniqueTables:            number;
  revenueVs7DayAvgPct:     number | null;
  ordersVs7DayAvgPct:      number | null;
  revenueVsSameWeekdayPct: number | null;
}

export interface AIDailyReport {
  date:            string;
  hotelId:         string;
  snapshot:        AIDailyReportSnapshot;
  health:          AIHealthScore;
  narrative:       string | null;
  narrativeSource: 'cache' | 'gemini' | 'unavailable';
  generatedAt:     string;
}

export interface AIDashboardTrend {
  date:         string;
  totalRevenue: number;
  totalOrders:  number;
  healthScore:  number;
}

export interface AIWeekComparison {
  thisWeekRevenue: number;
  lastWeekRevenue: number;
  changePct:       number | null;
}

export interface ExecutiveDashboard {
  today: {
    revenue:   number;
    orders:    number;
    updatedAt: string;
    topItems:  Array<{ productId: string; productName: string; revenue: number }>;
    source:    'cache' | 'mongodb';
  };
  trend:             AIDashboardTrend[];
  weekComparison:    AIWeekComparison;
  latestHealthScore: { date: string; score: number; grade: string } | null;
}

export interface AIStaffHotelAvg {
  ordersPerStaff:  number;
  revenuePerStaff: number;
  aov:             number;
  cancelRate:      number;
  discountPct:     number;
}

export interface AIStaffMemberStats {
  cashierId:        string;
  totalOrders:      number;
  completedOrders:  number;
  cancelledOrders:  number;
  cancelRate:       number;
  totalRevenue:     number;
  avgOrderValue:    number;
  totalDiscount:    number;
  avgDiscountPct:   number;
  revenueShare:     number;
  performanceScore: number;
  rank:             number;
}

export interface AIStaffAnalyticsReport {
  hotelId:      string;
  windowDays:   number;
  generatedAt:  string;
  hotelAvg:     AIStaffHotelAvg;
  staff:        AIStaffMemberStats[];
  totalRevenue: number;
  totalOrders:  number;
  activeStaff:  number;
  topPerformer: string | null;
  summary:      string;
}

export interface AIHourlyKitchenStats {
  hour:              number;
  orderCount:        number;
  avgFulfillmentMin: number;
  minFulfillmentMin: number;
  maxFulfillmentMin: number;
  p90FulfillmentMin: number;
}

export interface AIItemThroughputStats {
  productName: string;
  orderCount:  number;
  share:       number;
}

export interface AIKitchenAnalyticsReport {
  hotelId:              string;
  windowDays:           number;
  generatedAt:          string;
  totalOrdersAnalyzed:  number;
  avgFulfillmentMin:    number;
  medianFulfillmentMin: number;
  p90FulfillmentMin:    number;
  fastestHour:          number | null;
  slowestHour:          number | null;
  peakLoadHour:         number | null;
  hourly:               AIHourlyKitchenStats[];
  topItems:             AIItemThroughputStats[];
  slaBreachPct:         number;
  slaDurationMin:       number;
  summary:              string;
}

export type OcrJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'rejected';

export interface OcrVendorMatch {
  vendorId:     string;
  businessName: string;
  gstNumber:    string;
  confidence:   number;
}

export interface OcrDuplicateWarning {
  isDuplicate:  boolean;
  reason:       string;
  matchedJobId: string | null;
  matchedPoId:  string | null;
}

export interface OcrExtractedInvoice {
  invoiceNumber?: string;
  invoiceDate?:   string;
  vendorName?:    string;
  vendorGST?:     string;
  totalAmount?:   number;
  taxAmount?:     number;
  lineItems?:     Array<{
    description: string;
    qty:         number;
    unit?:       string;
    unitPrice:   number;
    total:       number;
  }>;
}

export interface OcrJob {
  _id:               string;
  hotelId:           string;
  status:            OcrJobStatus;
  fileName:          string;
  fileType:          string;
  fileSizeBytes:     number;
  fileMimeType:      string;
  createdAt:         string;
  updatedAt:         string;
  extractedData?:    OcrExtractedInvoice;
  reviewedData?:     OcrExtractedInvoice;
  vendorMatches?:    OcrVendorMatch[];
  duplicateWarning?: OcrDuplicateWarning;
  createdPoId?:      string | null;
  errorMessage?:     string;
}

export interface OcrJobsResponse {
  jobs:  OcrJob[];
  total: number;
  limit: number;
  skip:  number;
}

export interface OcrReviewScreen {
  jobId:              string;
  status:             OcrJobStatus;
  fileName:           string;
  extractedData:      OcrExtractedInvoice;
  reviewedData:       OcrExtractedInvoice | null;
  vendorMatches:      OcrVendorMatch[];
  duplicateWarning:   OcrDuplicateWarning | null;
  purchaseSuggestion: unknown;
}

export interface MorningBriefBusiness {
  revenue:                  number;
  orders:                   number;
  estimatedProfit:          number;
  estimatedProfitMarginPct: number;
  avgBill:                  number;
  healthScore:              number;
  healthGrade:              'A' | 'B' | 'C' | 'D' | 'F';
  topSellingItem:           string | null;
  topSellingItemRevenue:    number;
  topSellingItemQty:        number;
  peakHour:                 number;
  topPaymentMethod:         string;
  revenueVs7DayAvgPct:     number | null;
  ordersVs7DayAvgPct:      number | null;
  cancelledOrders:          number;
  cancelRate:               number;
}

export interface MorningBriefMenuItem {
  name:    string;
  revenue: number;
  qty:     number;
}

export interface MorningBriefMenu {
  topMenuItems: MorningBriefMenuItem[];
  slowMovers:   string[];
}

export interface MorningBriefInventory {
  criticalItems:        string[];
  warningItems:         string[];
  overstockItems:       string[];
  reorderRequiredNames: string[];
  totalReorderCost:     number;
  criticalCount:        number;
  warningCount:         number;
}

export interface MorningBriefForecast {
  expectedRevenue:    number;
  expectedOrders:     number;
  expectedAov:        number;
  topBusyHours:       number[];
  forecastConfidence: number;
  method:             string;
}

export interface MorningBrief {
  _id:              string;
  date:             string;
  generatedAt:      string;
  business:         MorningBriefBusiness;
  menu:             MorningBriefMenu;
  inventory:        MorningBriefInventory;
  forecast:         MorningBriefForecast;
  executiveSummary: string;
  recommendations:  string[];
  opportunity:      string;
  warning:          string | null;
}

export interface BriefHistoryItem {
  _id:             string;
  date:            string;
  generatedAt:     string;
  business: {
    revenue:         number;
    orders:          number;
    healthScore:     number;
    healthGrade:     string;
    topSellingItem:  string | null;
  };
  executiveSummary: string;
  warning:          string | null;
}

export interface BriefHistoryResponse {
  briefs: BriefHistoryItem[];
  total:  number;
  limit:  number;
  skip:   number;
}
