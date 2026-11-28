// Phase 5 · Batch 7 (P4-CATALOG-01): use the shared client so the login token is sent
// (a bare fetch went out without it and always got 401).
import { apiFetch as clientFetch } from './client';

const BASE = '/integrations/tally';

export interface TallyLedgerMap {
  salesLedger:       string;
  cgstLedger:        string;
  sgstLedger:        string;
  cashLedger:        string;
  bankLedger:        string;
  discountLedger:    string;
  roundOffLedger:    string;
  expenseLedger:     string;
  purchaseLedger:    string;
  stockInHandLedger: string;
  walletLedger:      string;
}

export interface TallyConfig {
  _id?:                string;
  hotelId?:            string;
  enabled:             boolean;
  companyName:         string;
  connectorTokenSet:   boolean;
  connectorLastSeenAt: string | null;
  ledgerMap:           Partial<TallyLedgerMap>;
  syncSales:           boolean;
  syncPurchases:       boolean;
  syncExpenses:        boolean;
  syncCancellations:   boolean;
}

export type TallySyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'skipped';
export type TallyEntityType = 'order' | 'cancellation' | 'purchase_invoice' | 'expense';

export interface TallySyncJob {
  _id:               string;
  entityType:        TallyEntityType;
  entityId:          string;
  operation:         string;
  status:            TallySyncStatus;
  idempotencyKey:    string;
  attemptCount:      number;
  lastAttemptAt:     string | null;
  nextAttemptAt:     string | null;
  syncedAt:          string | null;
  externalReference: string;
  voucherNumber:     string;
  errorCode:         string;
  errorReason:       string;
  createdAt:         string;
}

export interface TallySyncJobsResponse {
  jobs:  TallySyncJob[];
  total: number;
  page:  number;
  pages: number;
}

function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return clientFetch<T>(`${BASE}${path}`, init);
}

export function fetchTallyConfig(): Promise<TallyConfig> {
  return apiFetch<TallyConfig>('/config');
}

export function saveTallyConfig(data: Partial<Omit<TallyConfig, '_id' | 'hotelId' | 'connectorTokenSet' | 'connectorLastSeenAt'>>): Promise<TallyConfig> {
  return apiFetch<TallyConfig>('/config', { method: 'PUT', body: JSON.stringify(data) });
}

export function generateConnectorToken(): Promise<{ token: string; message: string }> {
  return apiFetch<{ token: string; message: string }>('/connector-token', { method: 'POST' });
}

export function fetchTallyJobs(params?: {
  status?:     TallySyncStatus;
  entityType?: TallyEntityType;
  page?:       number;
  limit?:      number;
}): Promise<TallySyncJobsResponse> {
  const qs = new URLSearchParams();
  if (params?.status)     qs.set('status', params.status);
  if (params?.entityType) qs.set('entityType', params.entityType);
  if (params?.page)       qs.set('page', String(params.page));
  if (params?.limit)      qs.set('limit', String(params.limit));
  const q = qs.toString();
  return apiFetch<TallySyncJobsResponse>(`/jobs${q ? `?${q}` : ''}`);
}

export function retryTallyJob(jobId: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/jobs/${jobId}/retry`, { method: 'POST' });
}

export function fetchTallyStats(): Promise<Record<TallySyncStatus, number>> {
  return apiFetch<Record<TallySyncStatus, number>>('/stats');
}
