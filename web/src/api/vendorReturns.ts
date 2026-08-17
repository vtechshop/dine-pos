import { apiFetch } from './client';
import type { VendorReturn, VendorReturnsResponse, VendorReturnItem } from '../types';

export type { VendorReturn, VendorReturnsResponse, VendorReturnItem };

export interface VendorReturnInput {
  vendorId: string;
  grnId:    string;
  items: Array<{
    grnItemIndex:  number;
    returnQty:     number;
    reason?:       string;
    notes?:        string;
  }>;
  notes?: string;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function fetchVendorReturns(params?: {
  vendorId?: string;
  grnId?:    string;
  status?:   string;
  from?:     string;
  to?:       string;
  search?:   string;
  limit?:    number;
  skip?:     number;
  sort?:     string;
  dir?:      string;
}): Promise<VendorReturnsResponse> {
  return apiFetch<VendorReturnsResponse>(
    `/vendor-returns${params ? qs(params as Record<string, string | number | undefined>) : ''}`,
  );
}

export function fetchVendorReturn(id: string): Promise<VendorReturn> {
  return apiFetch<VendorReturn>(`/vendor-returns/${id}`);
}

export function createVendorReturn(data: VendorReturnInput, idempotencyKey?: string): Promise<VendorReturn> {
  return apiFetch<VendorReturn>('/vendor-returns', {
    method:  'POST',
    headers: idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : undefined,
    body:    JSON.stringify(data),
  });
}

export function approveVendorReturn(id: string): Promise<VendorReturn> {
  return apiFetch<VendorReturn>(`/vendor-returns/${id}/approve`, { method: 'POST' });
}

export function completeVendorReturn(id: string): Promise<VendorReturn> {
  return apiFetch<VendorReturn>(`/vendor-returns/${id}/complete`, { method: 'POST' });
}

export function cancelVendorReturn(id: string, reason?: string): Promise<VendorReturn> {
  return apiFetch<VendorReturn>(`/vendor-returns/${id}/cancel`, {
    method: 'POST',
    body:   JSON.stringify({ reason: reason || '' }),
  });
}
