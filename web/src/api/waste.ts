import { apiFetch } from './client';
import type { WasteLog, WasteAnalytics } from '../types';

export async function fetchWasteLogs(date: string): Promise<{ logs: WasteLog[]; total: number }> {
  return apiFetch(`/waste?date=${date}&limit=200`);
}

export async function fetchWasteAnalytics(date: string): Promise<WasteAnalytics> {
  return apiFetch(`/waste/analytics?date=${date}`);
}

export async function createWasteLog(body: {
  productName: string;
  quantity: number;
  unit: string;
  reason: WasteLog['reason'];
  estimatedLoss: number;
  date: string;
  notes: string;
}): Promise<WasteLog> {
  return apiFetch('/waste', { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteWasteLog(id: string): Promise<void> {
  return apiFetch(`/waste/${id}`, { method: 'DELETE' });
}
