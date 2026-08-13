import { apiFetch } from './client';
import type { WasteLog, WasteAnalytics, WasteReason } from '../types';

export async function fetchWasteLogs(date: string): Promise<{ logs: WasteLog[]; total: number }> {
  return apiFetch(`/waste?date=${date}&limit=200`);
}

export async function fetchWasteAnalytics(date: string): Promise<WasteAnalytics> {
  return apiFetch(`/waste/analytics?date=${date}`);
}

export interface CreateWasteLogInput {
  productName: string;
  ingredientId?: string;   // If set, backend deducts from ingredient stock
  quantity: number;
  unit: string;
  reason: WasteReason;
  estimatedLoss?: number;  // Optional — auto-computed server-side if ingredientId is set
  date: string;
  notes?: string;
}

export async function createWasteLog(body: CreateWasteLogInput): Promise<WasteLog> {
  return apiFetch('/waste', { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteWasteLog(id: string): Promise<void> {
  return apiFetch(`/waste/${id}`, { method: 'DELETE' });
}
