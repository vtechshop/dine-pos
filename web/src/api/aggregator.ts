import { apiFetch } from './client';

export type AggregatorPlatform = 'swiggy' | 'zomato';

export interface AggregatorIntegration {
  _id:                     string;
  platform:                AggregatorPlatform;
  enabled:                 boolean;
  storeId:                 string;
  /** Secrets are write-only — server never returns actual values */
  hasApiKey:               boolean;
  hasApiSecret:            boolean;
  hasWebhookSecret:        boolean;
  menuSyncStatus:          'idle' | 'syncing' | 'success' | 'partial' | 'failed';
  lastSyncAt:              string | null;
  lastSyncError:           string | null;
  syncedItemCount:         number;
  failedItemCount:         number;
  lastOrderAt:             string | null;
  connectionStatus:        'connected' | 'disconnected' | 'error';
  autoAccept:              boolean;
  lastTestAt:              string | null;
  lastTestSuccess:         boolean | null;
  lastTestMessage:         string;
  autoSyncEnabled:         boolean;
  autoSyncIntervalMinutes: number;
  nextAutoSyncAt:          string | null;
  lastAutoSyncAt:          string | null;
  todayOrderCount:         number;
  updatedAt:               string;
}

/** Fields accepted by PUT /integrations/:platform — secrets are write-only */
export interface SaveIntegrationBody {
  enabled?:       boolean;
  storeId?:       string;
  apiKey?:        string;       // encrypted on server, never returned
  apiSecret?:     string;       // encrypted on server, never returned
  webhookSecret?: string;       // encrypted on server, never returned
  autoAccept?:    boolean;
}

export interface OnlineOrder {
  _id:                 string;
  orderNumber:         string;
  orderSource:         'swiggy' | 'zomato';
  platformOrderId:     string;
  status:              'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  customerName:        string;
  customerPhone:       string;
  deliveryAddress:     string;
  grandTotal:          number;
  subtotal?:           number;
  taxTotal?:           number;
  discountAmount?:     number;
  platformCommission?: number;
  deliveryFee:         number;
  deliveryPartnerName?: string;
  items: { productName: string; quantity: number; price: number; total: number }[];
  notes:               string;
  acceptedAt:          string | null;
  rejectedAt:          string | null;
  rejectionReason:     string;
  estimatedPickupTime: string | null;
  createdAt:           string;
}

export interface WebhookLog {
  _id:              string;
  platform:         string;
  event:            string;
  status:           'success' | 'failed' | 'retrying';
  platformOrderId:  string;
  errorMessage:     string | null;
  retryCount:       number;
  processingTimeMs: number | null;
  createdAt:        string;
}

// ── Integration settings ──────────────────────────────────────────────────────

export const fetchIntegrations = () =>
  apiFetch<{ integrations: AggregatorIntegration[] }>('/aggregator/integrations');

export const fetchIntegration = (platform: AggregatorPlatform) =>
  apiFetch<{ integration: AggregatorIntegration }>(`/aggregator/integrations/${platform}`);

export const saveIntegration = (platform: AggregatorPlatform, data: SaveIntegrationBody) =>
  apiFetch<{ integration: AggregatorIntegration }>(`/aggregator/integrations/${platform}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const disconnectIntegration = (platform: AggregatorPlatform) =>
  apiFetch<{ success: boolean; integration: AggregatorIntegration }>(
    `/aggregator/integrations/${platform}/disconnect`, { method: 'POST' },
  );

export const testIntegration = (platform: AggregatorPlatform) =>
  apiFetch<{ success: boolean | null; message: string; integration: AggregatorIntegration }>(
    `/aggregator/integrations/${platform}/test`, { method: 'POST' },
  );

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
}) => {
  const q = new URLSearchParams();
  if (params?.platform) q.set('platform', params.platform);
  if (params?.status)   q.set('status',   params.status);
  if (params?.date)     q.set('date',     params.date);
  return apiFetch<{ orders: OnlineOrder[]; total: number; page: number; pages: number }>(`/aggregator/orders?${q}`);
};

export const acceptDeliveryOrder = (orderId: string, prepMin?: number) =>
  apiFetch<{ message: string }>(`/aggregator/orders/${orderId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ prepMin: prepMin ?? 20 }),
  });

export const rejectDeliveryOrder = (orderId: string, reason: string) =>
  apiFetch<{ message: string }>(`/aggregator/orders/${orderId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const markOrderReady = (orderId: string) =>
  apiFetch<{ success: boolean }>(`/aggregator/orders/${orderId}/ready`, { method: 'POST' });

export const dispatchDeliveryOrder = (orderId: string) =>
  apiFetch<{ message: string }>(`/aggregator/orders/${orderId}/dispatch`, { method: 'POST' });

// ── Webhook logs ──────────────────────────────────────────────────────────────

export const fetchWebhookLogs = (params?: {
  platform?: string;
  status?:   string;
  search?:   string;
  page?:     number;
  limit?:    number;
}) => {
  const q = new URLSearchParams();
  if (params?.platform) q.set('platform', params.platform);
  if (params?.status)   q.set('status',   params.status);
  if (params?.search)   q.set('search',   params.search);
  if (params?.page)     q.set('page',     String(params.page));
  if (params?.limit)    q.set('limit',    String(params.limit));
  return apiFetch<{ logs: WebhookLog[]; total: number; page: number; pages: number }>(`/aggregator/webhook-logs?${q}`);
};

export const retryWebhook = (logId: string) =>
  apiFetch<{ message: string }>(`/aggregator/webhook-logs/${logId}/retry`, { method: 'POST' });

// ── Item channel availability ─────────────────────────────────────────────────

export interface ProductChannelAvailability {
  _id:         string;
  name:        string;
  price:       number;
  isAvailable: boolean;
  isVeg:       boolean;
  categoryId:  string;
  categoryName: string;
  channelPrices: { swiggy?: number | null; zomato?: number | null };
  channelAvailability: { swiggy: boolean | null; zomato: boolean | null };
  platformIds: { swiggy: string; zomato: string };
}

export const fetchMenuItems = () =>
  apiFetch<{ products: ProductChannelAvailability[] }>('/aggregator/items');

export const updateItemAvailability = (
  productId: string,
  data: { platform: AggregatorPlatform; available: boolean | null },
) =>
  apiFetch<{ product: ProductChannelAvailability }>(`/aggregator/items/${productId}/availability`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const bulkUpdateAvailability = (data: {
  productIds: string[];
  platform:   AggregatorPlatform;
  available:  boolean | null;
}) =>
  apiFetch<{ updated: number }>('/aggregator/items/bulk-availability', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// ── Sync history ──────────────────────────────────────────────────────────────

export type MenuSyncHistoryStatus = 'running' | 'success' | 'partial' | 'failed';

export interface MenuSyncHistoryRecord {
  _id:             string;
  platform:        AggregatorPlatform;
  syncType:        'full' | 'availability' | 'item' | 'scheduled';
  triggeredBy:     'manual' | 'scheduled' | 'system';
  status:          MenuSyncHistoryStatus;
  startedAt:       string;
  completedAt:     string | null;
  durationMs:      number | null;
  totalItems:      number;
  syncedItems:     number;
  failedItems:     number;
  errorCount:      number;
  externalSynced:  boolean;
  failureSummary?: { itemName: string; error: string }[];
  createdAt:       string;
}

export const fetchSyncHistory = (params?: {
  platform?: string;
  status?:   string;
  syncType?: string;
  from?:     string;
  to?:       string;
  page?:     number;
  limit?:    number;
}) => {
  const q = new URLSearchParams();
  if (params?.platform) q.set('platform', params.platform);
  if (params?.status)   q.set('status',   params.status);
  if (params?.syncType) q.set('syncType', params.syncType);
  if (params?.from)     q.set('from',     params.from);
  if (params?.to)       q.set('to',       params.to);
  if (params?.page)     q.set('page',     String(params.page));
  if (params?.limit)    q.set('limit',    String(params.limit));
  return apiFetch<{
    records: MenuSyncHistoryRecord[];
    total:   number;
    page:    number;
    pages:   number;
  }>(`/aggregator/sync-history?${q}`);
};

export const fetchSyncHistoryRecord = (id: string) =>
  apiFetch<{ record: MenuSyncHistoryRecord }>(`/aggregator/sync-history/${id}`);

// ── Auto-sync config ──────────────────────────────────────────────────────────

export const saveAutoSyncConfig = (
  platform: AggregatorPlatform,
  data: { enabled: boolean; intervalMinutes?: number },
) =>
  apiFetch<{ integration: AggregatorIntegration }>(`/aggregator/integrations/${platform}/auto-sync`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
