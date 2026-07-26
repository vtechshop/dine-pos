import { apiFetch } from './client';
import type { GRN, GRNReport, GRNItem } from '../types';

export type { GRN, GRNReport, GRNItem };

export interface GRNItemInput {
  poItemIndex?:      number;
  productId?:        string;
  ingredientId?:     string;
  productName:       string;
  variantId?:        string;
  variantName?:      string;
  orderedQty:        number;
  receivedQty:       number;
  damagedQty?:       number;
  rejectedQty?:      number;
  unit:              string;
  purchasePrice?:    number;
  batchNumber?:      string;
  manufacturingDate?: string;
  expiryDate?:       string;
  warehouse?:        string;
  notes?:            string;
}

export interface GRNInput {
  poId:         string;
  receiveDate?: string;
  notes?:       string;
  items:        GRNItemInput[];
}

export interface GRNsResponse {
  grns:   GRN[];
  total:  number;
  limit:  number;
  skip:   number;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function fetchGRNs(params?: {
  search?:   string;
  status?:   string;
  poId?:     string;
  vendorId?: string;
  from?:     string;
  to?:       string;
  limit?:    number;
  skip?:     number;
  sort?:     string;
  dir?:      string;
}): Promise<GRNsResponse> {
  return apiFetch<GRNsResponse>(`/grn${params ? qs(params as Record<string, string | number | undefined>) : ''}`);
}

export function fetchGRN(id: string): Promise<GRN> {
  return apiFetch<GRN>(`/grn/${id}`);
}

export function createGRN(data: GRNInput): Promise<GRN> {
  return apiFetch<GRN>('/grn', {
    method: 'POST',
    body:   JSON.stringify(data),
  });
}

export function cancelGRN(id: string, reason: string): Promise<GRN> {
  return apiFetch<GRN>(`/grn/${id}/cancel`, {
    method: 'POST',
    body:   JSON.stringify({ reason }),
  });
}

export function fetchGRNReport(params?: { from?: string; to?: string }): Promise<GRNReport> {
  return apiFetch<GRNReport>(`/grn/report${params ? qs(params as Record<string, string | undefined>) : ''}`);
}
