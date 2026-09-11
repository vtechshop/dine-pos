import { apiFetch } from './client';
import type {
  PurchaseInvoice, PurchaseInvoicesResponse,
  InvoiceAttachment, InvoiceTaxBreakupItem,
} from '../types';

export type { PurchaseInvoice, PurchaseInvoicesResponse, InvoiceAttachment, InvoiceTaxBreakupItem };

export interface PurchaseInvoiceInput {
  vendorId:        string;
  vendorInvoiceNo?: string;
  invoiceDate?:    string;
  grnIds?:         string[];
  subtotal:        number;
  taxBreakup?:     InvoiceTaxBreakupItem[];
  taxTotal?:       number;
  freight?:        number;
  otherCharges?:   number;
  discount?:       number;
  grandTotal:      number;
  notes?:          string;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function fetchPurchaseInvoices(params?: {
  status?:   string;
  vendorId?: string;
  from?:     string;
  to?:       string;
  page?:     number;
  limit?:    number;
}): Promise<PurchaseInvoicesResponse> {
  return apiFetch<PurchaseInvoicesResponse>(
    `/purchase-invoices${params ? qs(params as Record<string, string | number | boolean | undefined>) : ''}`,
  );
}

export function fetchPurchaseInvoice(id: string): Promise<{ invoice: PurchaseInvoice }> {
  return apiFetch<{ invoice: PurchaseInvoice }>(`/purchase-invoices/${id}`);
}

export function createPurchaseInvoice(data: PurchaseInvoiceInput): Promise<{ invoice: PurchaseInvoice }> {
  return apiFetch<{ invoice: PurchaseInvoice }>('/purchase-invoices', {
    method: 'POST',
    body:   JSON.stringify(data),
  });
}

export function updatePurchaseInvoice(
  id: string,
  data: Partial<PurchaseInvoiceInput>,
): Promise<{ invoice: PurchaseInvoice }> {
  return apiFetch<{ invoice: PurchaseInvoice }>(`/purchase-invoices/${id}`, {
    method: 'PATCH',
    body:   JSON.stringify(data),
  });
}

export function verifyPurchaseInvoice(id: string): Promise<{ invoice: PurchaseInvoice }> {
  return apiFetch<{ invoice: PurchaseInvoice }>(`/purchase-invoices/${id}/verify`, { method: 'POST' });
}

export function markPurchaseInvoicePaid(
  id: string,
  paymentRef?: string,
): Promise<{ invoice: PurchaseInvoice }> {
  return apiFetch<{ invoice: PurchaseInvoice }>(`/purchase-invoices/${id}/mark-paid`, {
    method: 'POST',
    body:   JSON.stringify({ paymentRef: paymentRef ?? '' }),
  });
}

export function cancelPurchaseInvoice(id: string, reason?: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/purchase-invoices/${id}`, {
    method: 'DELETE',
    body:   JSON.stringify({ reason: reason ?? '' }),
  });
}

export function addPurchaseInvoiceAttachment(
  id: string,
  attachment: { filename: string; url: string; fileSize: number; mimeType: string },
): Promise<{ attachments: InvoiceAttachment[] }> {
  return apiFetch<{ attachments: InvoiceAttachment[] }>(`/purchase-invoices/${id}/attachments`, {
    method: 'POST',
    body:   JSON.stringify(attachment),
  });
}
