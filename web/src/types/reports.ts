export interface SalesReport {
  date?: string;
  from?: string;
  to?: string;
  totalSales: number;
  totalTax: number;
  totalDiscount: number;
  totalOrders: number;
  parcelOrders: number;
  parcelRevenue: number;
  paymentBreakdown: {
    cash: number;
    upi: number;
    card: number;
    split: number;
  };
  sourceBreakdown: Record<string, { orders: number; revenue: number }>;
}

export interface ProductSalesRow {
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
}

export interface ProductSalesReport {
  date: string;
  products: ProductSalesRow[];
}

export interface GSTRow {
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
  rows: GSTRow[];
  totalTaxableValue: number;
  totalCGST: number;
  totalSGST: number;
  totalTax: number;
  totalValue: number;
}

export interface ExpensePnL {
  date: string;
  revenue: number;
  orders: number;
  expenses: number;
  profit: number;
  profitMargin: string;
  breakdown: Array<{ _id: string; total: number; count: number }>;
}

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

export interface HourlyBucket {
  hour: number;
  orders: number;
  revenue: number;
}

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'last_week'
  | 'month'
  | 'last_month'
  | 'custom';
