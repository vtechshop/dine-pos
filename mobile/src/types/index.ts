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
  isParcel: boolean;
  customerName: string;
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
}

// Daily Report
export interface DailyReport {
  date: string;
  totalSales: number;
  totalTax: number;
  totalOrders: number;
  paymentBreakdown: {
    cash: number;
    upi: number;
    card: number;
    split: number;
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
  createdAt: string;
}

export interface SuperAdminStats {
  total: number;
  pending: number;
  active: number;
  suspended: number;
  rejected: number;
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
