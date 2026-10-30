import { apiFetch } from './client';
import { apiGetActiveShiftStats } from './shifts';
import type { DailyReport, PrinterDeviceStatus } from '../types';

export async function fetchDailyReport(): Promise<DailyReport> {
  return apiFetch<DailyReport>('/orders/reports/daily');
}

export async function fetchPrinterDevices(): Promise<PrinterDeviceStatus[]> {
  const res = await apiFetch<{ devices: PrinterDeviceStatus[] }>('/print-jobs/devices');
  return res.devices;
}

export interface TopProduct {
  productName:   string;
  totalQuantity: number;
  totalRevenue:  number;
}

export async function fetchTopProducts(): Promise<TopProduct[]> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await apiFetch<{ products: TopProduct[] }>(`/orders/reports/products?date=${today}`);
  return res.products;
}

/**
 * Sales numbers the signed-in role is allowed to see, in the daily-report shape.
 * - admin: the hotel's whole day (/orders/reports/daily — admin only).
 * - cashier: their open shift's totals (/shifts/active/stats). Cashiers get 403 on the
 *   daily report, so asking for it only produced errors and ₹0 figures.
 * - other roles: null (no sales data).
 */
export async function fetchSalesSummary(role: string | null | undefined): Promise<DailyReport | null> {
  if (role === 'admin') return fetchDailyReport();
  if (role !== 'cashier') return null;
  const s = await apiGetActiveShiftStats();
  return {
    date: new Date().toISOString().slice(0, 10),
    totalSales: s.totalSales,
    totalTax: 0,
    totalDiscount: 0,
    totalOrders: s.totalOrders,
    parcelOrders: 0,
    parcelRevenue: 0,
    paymentBreakdown: { cash: s.cashSales, upi: s.upiSales, card: s.cardSales, split: 0 },
    sourceBreakdown: {},
  };
}
