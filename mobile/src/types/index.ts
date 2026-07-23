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

// Product
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
}

// Order Item (stored in DB)
export interface OrderItem {
  product: string;
  productName: string;
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
  paymentMethod: 'cash' | 'upi' | 'card' | 'split';
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
  // Phase 7 — dual printer engine
  printerMode?: 'single' | 'dual';
  kitchenPrinterAddress?: string;
  cashierPrinterAddress?: string;
  kotAutoPrint?: boolean;
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
};
