// Category
export interface Category {
  _id: string;
  name: string;
  icon: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

// Product
export interface Product {
  _id: string;
  name: string;
  price: number;
  category: Category | string;
  taxPercent: number;
  image: string;
  isAvailable: boolean;
  isVeg: boolean;
  shortCode: string;
  description: string;
  stock: number; // -1 = unlimited, 0 = out of stock, >0 = count
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
  isSetupComplete: boolean;
  isPremium?: boolean;
  premiumPlan?: string;
  premiumExpiry?: string | null;
  trialEndsAt?: string | null;
}

// Daily Report
export interface DailyReport {
  date: string;
  totalSales: number;
  totalTax: number;
  totalOrders: number;
  parcelOrders?: number;
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

// Navigation
// Hotel (SaaS tenant)
export interface Hotel {
  _id: string;
  hotelName: string;
  ownerName: string;
  businessType: 'veg' | 'non-veg' | 'both';
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
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  rejectionReason: string;
  approvedAt: string | null;
  resetRequested?: boolean;
  resetRequestedAt?: string | null;
  resetFulfilledAt?: string | null;
  isPremium?: boolean;
  premiumPlan?: string;
  premiumExpiry?: string | null;
  trialEndsAt?: string | null;
  createdAt: string;
}

export interface SuperAdminStats {
  total: number;
  pending: number;
  active: number;
  suspended: number;
  rejected: number;
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
  AdminLogin: undefined;
  BusinessSetup: { resubmit?: boolean; rejectionReason?: string; phone?: string } | undefined;
  HotelStatus: { status: 'pending' | 'suspended'; hotelName?: string };
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
};

export type TabParamList = {
  Home: undefined;
  Billing: undefined;
  Orders: undefined;
  Reports: undefined;
  Products: undefined;
  Settings: undefined;
};

export type CustomerTabParamList = {
  Menu: undefined;
  Cart: undefined;
};
