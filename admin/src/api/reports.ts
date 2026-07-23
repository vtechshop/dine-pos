import { apiFetch } from './client';

function qs(p: Record<string, string>): string {
  return new URLSearchParams(p).toString();
}

export interface SalesReportRow {
  date:         string;
  totalOrders:  number;
  totalRevenue: number;
  totalGST:     number;
  netRevenue:   number;
}

export interface ProductSalesRow {
  productId:   string;
  productName: string;
  quantity:    number;
  revenue:     number;
}

export const fetchSalesReport = (from: string, to: string) =>
  from === to
    ? apiFetch<{ orders: SalesReportRow[]; summary: Record<string, number> }>(`/orders/reports/daily?date=${from}`)
    : apiFetch<{ orders: SalesReportRow[]; summary: Record<string, number> }>(`/orders/reports/range?${qs({ from, to })}`);

export const fetchProductSalesReport = (date: string) =>
  apiFetch<{ products: ProductSalesRow[] }>(`/orders/reports/products?date=${date}`);

export const fetchGSTReport = (from: string, to: string) =>
  apiFetch<unknown>(`/reports/gst?${qs({ from, to })}`);

// ── Reports NOT YET IMPLEMENTED IN BACKEND ────────────────────────────────────
// Required endpoints:
//   GET /reports/staff?from=&to=          — staff performance report
//   GET /reports/attendance?from=&to=     — attendance report
//   GET /reports/salary?month=            — salary report
//   GET /aggregator/reports/settlement?from=&to=   — settlement report
//   GET /aggregator/reports/commission?from=&to=   — commission breakdown
//   GET /aggregator/reports/menu-sync?platform=    — menu sync report
//   GET /aggregator/reports/webhooks?from=&to=     — webhook error report
//   GET /qr/reports?from=&to=             — QR usage report
