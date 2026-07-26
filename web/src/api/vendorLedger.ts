import { apiFetch } from './client';
import type {
  VendorPayment, VendorLedgerEntry, VendorLedgerReport, Vendor, VendorPaymentMethod,
} from '../types';

export type { VendorPayment, VendorLedgerEntry, VendorLedgerReport, VendorPaymentMethod };

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Vendor Payments ───────────────────────────────────────────────────────────

export interface PaymentInput {
  vendorId:         string;
  paymentDate?:     string;
  paymentMethod:    string;
  amount:           number;
  referenceNumber?: string;
  notes?:           string;
  attachment?:      string;
}

export interface PaymentsResponse {
  payments: VendorPayment[];
  total:    number;
  limit:    number;
  skip:     number;
}

export interface PaymentReportResponse {
  totalPayments:          number;
  paymentCount:           number;
  paymentThisMonth:       number;
  paymentCountThisMonth:  number;
  totalOutstanding:       number;
  vendorsWithOutstanding: number;
  byMethod: Array<{ _id: string; total: number; count: number }>;
  outstandingVendors: Array<{
    _id: string; businessName: string; vendorCode: string;
    mobile: string; email: string; currentOutstanding: number;
    creditLimit: number; paymentTerms: string;
  }>;
}

export function fetchPaymentReport(params?: { from?: string; to?: string }): Promise<PaymentReportResponse> {
  return apiFetch<PaymentReportResponse>(`/vendor-payments/report${params ? qs(params as Record<string, string | undefined>) : ''}`);
}

export function fetchPayments(params?: {
  vendorId?: string; from?: string; to?: string; method?: string;
  reversed?: string; search?: string; sort?: string; dir?: string;
  limit?: number; skip?: number;
}): Promise<PaymentsResponse> {
  return apiFetch<PaymentsResponse>(`/vendor-payments${params ? qs(params as Record<string, string | number | undefined>) : ''}`);
}

export function fetchPayment(id: string): Promise<VendorPayment> {
  return apiFetch<VendorPayment>(`/vendor-payments/${id}`);
}

export function createPayment(data: PaymentInput): Promise<VendorPayment> {
  return apiFetch<VendorPayment>('/vendor-payments', {
    method: 'POST',
    body:   JSON.stringify(data),
  });
}

export function updatePayment(id: string, data: Partial<PaymentInput> & { amount?: number }): Promise<VendorPayment> {
  return apiFetch<VendorPayment>(`/vendor-payments/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(data),
  });
}

export function deletePayment(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/vendor-payments/${id}`, { method: 'DELETE' });
}

export function reversePayment(id: string, reason?: string): Promise<VendorPayment> {
  return apiFetch<VendorPayment>(`/vendor-payments/${id}/reverse`, {
    method: 'POST',
    body:   JSON.stringify({ reason }),
  });
}

// ── Vendor Ledger ─────────────────────────────────────────────────────────────

export interface LedgerResponse {
  vendor:             Vendor;
  entries:            VendorLedgerEntry[];
  total:              number;
  limit:              number;
  skip:               number;
  currentOutstanding: number;
  openingBalance:     number;
}

export interface StatementResponse {
  vendor:             Vendor;
  entries:            VendorLedgerEntry[];
  totalDebit:         number;
  totalCredit:        number;
  openingBalance:     number;
  currentOutstanding: number;
  generatedAt:        string;
}

export function fetchLedgerReport(): Promise<VendorLedgerReport> {
  return apiFetch<VendorLedgerReport>('/vendor-ledger/report');
}

export function fetchLedger(vendorId: string, params?: {
  from?: string; to?: string; type?: string; limit?: number; skip?: number;
}): Promise<LedgerResponse> {
  return apiFetch<LedgerResponse>(`/vendor-ledger/${vendorId}${params ? qs(params as Record<string, string | number | undefined>) : ''}`);
}

export function fetchStatement(vendorId: string, params?: { from?: string; to?: string }): Promise<StatementResponse> {
  return apiFetch<StatementResponse>(`/vendor-ledger/${vendorId}/statement${params ? qs(params as Record<string, string | undefined>) : ''}`);
}

export function setOpeningBalance(vendorId: string, amount: number, notes?: string): Promise<{ success: boolean; openingBalance: number; currentOutstanding: number }> {
  return apiFetch(`/vendor-ledger/${vendorId}/opening-balance`, {
    method: 'POST',
    body:   JSON.stringify({ amount, notes }),
  });
}
