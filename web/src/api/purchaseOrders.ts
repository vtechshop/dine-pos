import { apiFetch } from './client';
import type { PurchaseOrder, POReport, POItem } from '../types';

export type { PurchaseOrder, POReport, POItem };

export interface POInput {
  vendorId:             string;
  status?:              string;
  orderDate?:           string;
  expectedDeliveryDate?: string;
  currency?:            string;
  notes?:               string;
  items:                Omit<POItem, '_id' | 'lineTotal'>[];
  discount?:            number;
  tax?:                 number;
  shipping?:            number;
}

export interface POsResponse {
  purchaseOrders: PurchaseOrder[];
  total:          number;
  limit:          number;
  skip:           number;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function fetchPurchaseOrders(params?: {
  search?:   string;
  status?:   string;
  vendorId?: string;
  from?:     string;
  to?:       string;
  limit?:    number;
  skip?:     number;
  sort?:     string;
  dir?:      string;
}): Promise<POsResponse> {
  return apiFetch<POsResponse>(`/purchase-orders${params ? qs(params as any) : ''}`);
}

export function fetchPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}`);
}

export function createPurchaseOrder(data: POInput): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>('/purchase-orders', {
    method: 'POST',
    body:   JSON.stringify(data),
  });
}

export function updatePurchaseOrder(id: string, data: Partial<POInput>): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(data),
  });
}

export function deletePurchaseOrder(id: string): Promise<void> {
  return apiFetch<void>(`/purchase-orders/${id}`, { method: 'DELETE' });
}

export function submitPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/submit`, { method: 'POST' });
}

export function approvePurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/approve`, { method: 'POST' });
}

export function sendPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/send`, { method: 'POST' });
}

export function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/cancel`, {
    method: 'POST',
    body:   JSON.stringify({ reason }),
  });
}

export function duplicatePurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/purchase-orders/${id}/duplicate`, { method: 'POST' });
}

export function fetchPOReport(params?: { from?: string; to?: string }): Promise<POReport> {
  return apiFetch<POReport>(`/purchase-orders/report${params ? qs(params as any) : ''}`);
}
