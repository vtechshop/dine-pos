import { apiFetch } from './client';
import type {
  SalesReport,
  ProductSalesReport,
  GSTReport,
  ExpensePnL,
  TallyReport,
} from '../types/reports';

function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export async function fetchSalesReport(from: string, to: string): Promise<SalesReport> {
  if (from === to) {
    return apiFetch(`/orders/reports/daily?date=${from}`);
  }
  return apiFetch(`/orders/reports/range?${qs({ from, to })}`);
}

export async function fetchProductSalesReport(date: string): Promise<ProductSalesReport> {
  return apiFetch(`/orders/reports/products?date=${date}`);
}

export async function fetchGSTReport(from: string, to: string): Promise<GSTReport> {
  return apiFetch(`/reports/gst?${qs({ from, to })}`);
}

export async function fetchTallyReport(from: string, to: string): Promise<TallyReport> {
  return apiFetch(`/reports/tally?${qs({ from, to })}`);
}

export async function fetchGSTR1JSON(from: string, to: string): Promise<unknown> {
  return apiFetch(`/reports/gstr1-json?${qs({ from, to })}`);
}

export async function fetchExpensePnL(date: string): Promise<ExpensePnL> {
  return apiFetch(`/expenses/pnl?date=${date}`);
}

export async function fetchOrdersForHourly(
  date: string,
): Promise<{ orders: Array<{ grandTotal: number; createdAt: string }> }> {
  return apiFetch(`/orders?date=${date}&limit=200`);
}
