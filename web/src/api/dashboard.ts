import { apiFetch } from './client';
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
