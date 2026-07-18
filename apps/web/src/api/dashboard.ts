import { apiFetch } from './client';
import type { DailyReport, PrinterDeviceStatus } from '../types';

export async function fetchDailyReport(): Promise<DailyReport> {
  return apiFetch<DailyReport>('/orders/reports/daily');
}

export async function fetchPrinterDevices(): Promise<PrinterDeviceStatus[]> {
  const res = await apiFetch<{ devices: PrinterDeviceStatus[] }>('/print-jobs/devices');
  return res.devices;
}
