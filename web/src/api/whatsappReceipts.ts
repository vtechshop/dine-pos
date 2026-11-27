/**
 * WhatsApp Auto-Receipts — frontend API client
 *
 * All functions require the caller to be authenticated (JWT in cookie/header).
 * No WhatsApp credentials or provider secrets are returned by any endpoint.
 */

// Phase 5 · Batch 7 (P4-CATALOG-01): every call goes through the shared client so the login
// token is sent (a bare fetch went out without it and always got 401).
import { apiFetch } from './client';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WhatsAppReceiptConfig {
  autoSend:         boolean;
  templateName:     string;
  templateLanguage: string;
  templateVars:     string[];
}

export interface WhatsAppProviderStatus {
  configured:       boolean;
  providerType?:    string;
  integratedNumber?: string;
  lastTested?:      {
    lastTestedAt: string;
    success:      boolean;
    message:      string;
  } | null;
}

export interface WhatsAppSettingsResponse {
  config:   WhatsAppReceiptConfig;
  provider: WhatsAppProviderStatus;
}

export type WARStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

export interface WhatsAppReceiptRecord {
  _id:               string;
  orderId?:          string | null;
  guestId?:          string | null;
  customerId?:       string | null;
  maskedPhone:       string;
  status:            WARStatus;
  attemptCount:      number;
  maxAttempts:       number;
  sentAt?:           string | null;
  deliveredAt?:      string | null;
  readAt?:           string | null;
  failedAt?:         string | null;
  failureReason?:    string | null;
  providerMessageId?: string | null;
  purpose:           string;
  createdAt:         string;
  updatedAt:         string;
}

export interface WhatsAppReceiptListResponse {
  receipts: WhatsAppReceiptRecord[];
  total:    number;
  page:     number;
  pages:    number;
}

export interface AvailableVar {
  name:        string;
  description: string;
}

// ── Settings endpoints ────────────────────────────────────────────────────────

export function fetchWhatsAppReceiptSettings(): Promise<WhatsAppSettingsResponse> {
  return apiFetch<WhatsAppSettingsResponse>('/settings/whatsapp-receipts');
}

export function saveWhatsAppReceiptSettings(
  data: Partial<WhatsAppReceiptConfig>,
): Promise<{ config: WhatsAppReceiptConfig }> {
  return apiFetch<{ config: WhatsAppReceiptConfig }>('/settings/whatsapp-receipts', {
    method: 'PATCH',
    body:   JSON.stringify(data),
  });
}

export async function testWhatsAppReceipt(
  phone: string,
): Promise<{ success: boolean; message: string }> {
  try {
    return await apiFetch<{ success: boolean; message: string }>('/settings/whatsapp-receipts/test', {
      method: 'POST',
      body:   JSON.stringify({ phone }),
    });
  } catch (e) {
    return { success: false, message: errMsg(e, 'Test failed') };
  }
}

export async function fetchAvailableVars(): Promise<AvailableVar[]> {
  try {
    const body = await apiFetch<{ vars?: AvailableVar[] }>('/settings/whatsapp-receipts/available-vars');
    return body.vars ?? [];
  } catch {
    return [];
  }
}

export async function fetchWhatsAppReceiptStats(): Promise<{
  total: number; sent: number; delivered: number; read: number; failed: number; queued: number;
}> {
  try {
    return await apiFetch('/settings/whatsapp-receipts/stats');
  } catch {
    return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 };
  }
}

// ── Receipt history endpoints ─────────────────────────────────────────────────

export function fetchWhatsAppReceipts(params?: {
  page?:    number;
  limit?:   number;
  status?:  WARStatus;
  orderId?: string;
  from?:    string;
  to?:      string;
}): Promise<WhatsAppReceiptListResponse> {
  const qs = new URLSearchParams();
  if (params?.page)    qs.set('page',    String(params.page));
  if (params?.limit)   qs.set('limit',   String(params.limit));
  if (params?.status)  qs.set('status',  params.status);
  if (params?.orderId) qs.set('orderId', params.orderId);
  if (params?.from)    qs.set('from',    params.from);
  if (params?.to)      qs.set('to',      params.to);
  return apiFetch<WhatsAppReceiptListResponse>(`/whatsapp-receipts?${qs}`);
}

export function fetchWhatsAppReceipt(id: string): Promise<WhatsAppReceiptRecord> {
  return apiFetch<WhatsAppReceiptRecord>(`/whatsapp-receipts/${id}`);
}

export async function retryWhatsAppReceipt(
  id: string,
): Promise<{ success: boolean; message: string; status: string }> {
  try {
    return await apiFetch<{ success: boolean; message: string; status: string }>(`/whatsapp-receipts/${id}/retry`, { method: 'POST' });
  } catch (e) {
    return { success: false, message: errMsg(e, 'Retry failed'), status: '' };
  }
}
