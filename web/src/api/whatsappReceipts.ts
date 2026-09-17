/**
 * WhatsApp Auto-Receipts — frontend API client
 *
 * All functions require the caller to be authenticated (JWT in cookie/header).
 * No WhatsApp credentials or provider secrets are returned by any endpoint.
 */

const BASE = `${import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'}`;

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

export async function fetchWhatsAppReceiptSettings(): Promise<WhatsAppSettingsResponse> {
  const res = await fetch(`${BASE}/settings/whatsapp-receipts`, { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Failed to load settings');
  return res.json();
}

export async function saveWhatsAppReceiptSettings(
  data: Partial<WhatsAppReceiptConfig>,
): Promise<{ config: WhatsAppReceiptConfig }> {
  const res = await fetch(`${BASE}/settings/whatsapp-receipts`, {
    method:      'PATCH',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Failed to save settings');
  return res.json();
}

export async function testWhatsAppReceipt(
  phone: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE}/settings/whatsapp-receipts/test`, {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ phone }),
  });
  const body = await res.json().catch(() => ({ success: false, message: 'Unknown error' }));
  if (!res.ok) return { success: false, message: body.message ?? 'Test failed' };
  return body;
}

export async function fetchAvailableVars(): Promise<AvailableVar[]> {
  const res = await fetch(`${BASE}/settings/whatsapp-receipts/available-vars`, { credentials: 'include' });
  if (!res.ok) return [];
  const body = await res.json();
  return body.vars ?? [];
}

export async function fetchWhatsAppReceiptStats(): Promise<{
  total: number; sent: number; delivered: number; read: number; failed: number; queued: number;
}> {
  const res = await fetch(`${BASE}/settings/whatsapp-receipts/stats`, { credentials: 'include' });
  if (!res.ok) return { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 };
  return res.json();
}

// ── Receipt history endpoints ─────────────────────────────────────────────────

export async function fetchWhatsAppReceipts(params?: {
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

  const res = await fetch(`${BASE}/whatsapp-receipts?${qs}`, { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Failed to load receipts');
  return res.json();
}

export async function fetchWhatsAppReceipt(id: string): Promise<WhatsAppReceiptRecord> {
  const res = await fetch(`${BASE}/whatsapp-receipts/${id}`, { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Failed to load receipt');
  return res.json();
}

export async function retryWhatsAppReceipt(
  id: string,
): Promise<{ success: boolean; message: string; status: string }> {
  const res = await fetch(`${BASE}/whatsapp-receipts/${id}/retry`, {
    method:      'POST',
    credentials: 'include',
  });
  const body = await res.json().catch(() => ({ success: false, message: 'Unknown error' }));
  if (!res.ok) return { success: false, message: body.message ?? 'Retry failed', status: '' };
  return body;
}
