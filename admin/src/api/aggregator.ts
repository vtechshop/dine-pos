import { apiFetch } from './client';

export type AggregatorPlatform = 'swiggy' | 'zomato';

export interface AggregatorIntegration {
  _id:               string;
  platform:          AggregatorPlatform;
  enabled:           boolean;
  storeId:           string;
  apiKey:            string;
  apiSecret:         string;
  webhookSecret:     string;
  menuSyncStatus:    'idle' | 'syncing' | 'success' | 'failed';
  lastSyncAt:        string | null;
  lastSyncError:     string | null;
  syncedItemCount:   number;
  failedItemCount:   number;
  lastOrderAt:       string | null;
  connectionStatus:  'connected' | 'disconnected' | 'error';
  autoAccept:        boolean;
  updatedAt:         string;
}

export interface OnlineOrder {
  _id:                string;
  orderNumber:        string;
  orderSource:        AggregatorPlatform;
  platformOrderId:    string;
  status:             'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  customerName:       string;
  customerPhone:      string;
  deliveryAddress:    string;
  grandTotal:         number;
  subtotal?:          number;
  taxTotal?:          number;
  discountAmount?:    number;
  platformCommission?: number;
  deliveryFee:        number;
  deliveryPartnerName?: string;
  items:              { productName: string; quantity: number; price: number; total: number }[];
  notes:              string;
  acceptedAt:         string | null;
  rejectedAt:         string | null;
  rejectionReason:    string;
  estimatedPickupTime: string | null;
  createdAt:          string;
}

export interface WebhookLog {
  _id:             string;
  platform:        string;
  event:           string;
  status:          'success' | 'failed' | 'retrying';
  platformOrderId: string;
  errorMessage:    string | null;
  retryCount:      number;
  createdAt:       string;
}

// ── Integration settings ──────────────────────────────────────────────────────
export const fetchIntegrations = () =>
  apiFetch<AggregatorIntegration[]>('/aggregator/integrations');

export const fetchIntegration = (platform: AggregatorPlatform) =>
  apiFetch<AggregatorIntegration>(`/aggregator/integrations/${platform}`);

export const saveIntegration = (platform: AggregatorPlatform, data: Partial<AggregatorIntegration>) =>
  apiFetch<AggregatorIntegration>(`/aggregator/integrations/${platform}`, {
    method: 'PUT',
    body:   JSON.stringify(data),
  });

export const disconnectIntegration = (platform: AggregatorPlatform) =>
  apiFetch<{ message: string }>(`/aggregator/integrations/${platform}/disconnect`, { method: 'POST' });

export const syncMenu = (platform: AggregatorPlatform) =>
  apiFetch<{ syncedCount: number; failedCount: number; failedItems: { name: string; error: string }[] }>(
    `/aggregator/integrations/${platform}/sync-menu`, { method: 'POST' },
  );

export const fetchSyncStatus = (platform: AggregatorPlatform) =>
  apiFetch<Pick<AggregatorIntegration, 'menuSyncStatus' | 'lastSyncAt' | 'lastSyncError' | 'syncedItemCount' | 'failedItemCount'>>(
    `/aggregator/integrations/${platform}/sync-status`,
  );

// ── Online orders ─────────────────────────────────────────────────────────────
export const fetchOnlineOrders = (params?: {
  platform?: AggregatorPlatform;
  status?:   string;
  date?:     string;
  limit?:    number;
}) => {
  const q = new URLSearchParams();
  if (params?.platform) q.set('platform', params.platform);
  if (params?.status)   q.set('status',   params.status);
  if (params?.date)     q.set('date',     params.date);
  if (params?.limit)    q.set('limit',    String(params.limit));
  return apiFetch<{ orders: OnlineOrder[]; total?: number }>(`/aggregator/orders?${q}`);
};

// ── Webhook logs ──────────────────────────────────────────────────────────────
export const fetchWebhookLogs = (params?: { platform?: string; status?: string; limit?: number }) => {
  const q = new URLSearchParams();
  if (params?.platform) q.set('platform', params.platform);
  if (params?.status)   q.set('status',   params.status);
  if (params?.limit)    q.set('limit',    String(params.limit));
  return apiFetch<WebhookLog[]>(`/aggregator/webhook-logs?${q}`);
};

export const retryWebhook = (logId: string) =>
  apiFetch<{ message: string }>(`/aggregator/webhook-logs/${logId}/retry`, { method: 'POST' });

// ── Store status — NOT YET IMPLEMENTED IN BACKEND ────────────────────────────
// Required endpoints:
//   POST /aggregator/integrations/:platform/store-status  { status: 'open'|'closed'|'busy'|'holiday' }
//   POST /aggregator/integrations/:platform/pause-orders
//   POST /aggregator/integrations/:platform/resume-orders
//   GET  /aggregator/integrations/:platform/validate      — credential validation
