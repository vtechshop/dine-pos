import { apiFetch } from './client';
import type { Vendor, VendorReport, PaymentTerms } from '../types';

export type { Vendor, VendorReport, PaymentTerms };

export interface VendorInput {
  businessName:       string;
  contactPerson?:     string;
  mobile:             string;
  alternateMobile?:   string;
  email?:             string;
  gstNumber?:         string;
  pan?:               string;
  address?:           string;
  city?:              string;
  state?:             string;
  pincode?:           string;
  paymentTerms?:      PaymentTerms;
  creditLimit?:       number;
  openingBalance?:    number;
  currentOutstanding?: number;
  notes?:             string;
  isActive?:          boolean;
}

export interface VendorsResponse {
  vendors: Vendor[];
  total:   number;
  limit:   number;
  skip:    number;
}

function qs(params: Record<string, string | number | boolean>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function fetchVendors(params?: {
  search?: string;
  active?: string;
  limit?:  number;
  skip?:   number;
  sort?:   string;
  dir?:    string;
}): Promise<VendorsResponse> {
  return apiFetch<VendorsResponse>(`/vendors${params ? qs(params as Record<string, string | number | boolean>) : ''}`);
}

export function fetchVendor(id: string): Promise<Vendor> {
  return apiFetch<Vendor>(`/vendors/${id}`);
}

export function createVendor(data: VendorInput): Promise<Vendor> {
  return apiFetch<Vendor>('/vendors', {
    method: 'POST',
    body:   JSON.stringify(data),
  });
}

export function updateVendor(id: string, data: Partial<VendorInput>): Promise<Vendor> {
  return apiFetch<Vendor>(`/vendors/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(data),
  });
}

export function deleteVendor(id: string): Promise<void> {
  return apiFetch<void>(`/vendors/${id}`, { method: 'DELETE' });
}

export function adjustOutstanding(id: string, amount: number): Promise<Vendor> {
  return apiFetch<Vendor>(`/vendors/${id}/outstanding`, {
    method: 'PATCH',
    body:   JSON.stringify({ amount }),
  });
}

export function fetchVendorReport(): Promise<VendorReport> {
  return apiFetch<VendorReport>('/vendors/report');
}
