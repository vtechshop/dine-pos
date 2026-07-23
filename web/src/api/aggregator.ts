import { apiFetch } from './client';

export type AggregatorPlatform = 'swiggy' | 'zomato';

export interface AggregatorIntegration {
  _id: string;
  platform: AggregatorPlatform;
  enabled: boolean;
  storeId: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  menuSyncStatus: 'idle' | 'syncing' | 'success' | 'failed';
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncedItemCount: number;
  failedItemCount: number;
  lastOrderAt: string | null;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  autoAccept: boolean;
  updatedAt: string;
}

export interface OnlineOrder {
  _id: string;
  orderNumber: string;
  orderSource: 'swiggy' | 'zomato';
  platformOrderId: string;
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  grandTotal: number;
  subtotal?: number;
  taxTotal?: number;
  discountAmount?: number;
  platformCommission?: number;
  deliveryFee: number;
  deliveryPartnerName?: string;
  items: { productName: string; quantity: number; price: number; total: number }[];
  notes: string;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string;
  estimatedPickupTime: string | null;
  createdAt: string;
}

export interface WebhookLog {
  _id: string;
  platform: string;
  event: string;
  status: 'success' | 'failed' | 'retrying';
  platformOrderId: string;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
}

// ── Integration settings ──────────────────────────────────────────────────────

export const fetchIntegrations = () =>
  apiFetch<AggregatorIntegration[]>('/aggregator/integrations');

export const fetchIntegration = (platform: AggregatorPlatform) =>
  apiFetch<AggregatorIntegration>(`/aggregator/integrations/${platform}`);

export const saveIntegration = (platform: AggregatorPlatform, data: Partial<AggregatorIntegration>) =>
  apiFetch<AggregatorIntegration>(`/aggregator/integrations/${platform}`, {
    method: 'PUT',
    body: JSON.stringify(data),
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
  status?: string;
  date?: string;
}) => {
  const q = new URLSearchParams();
  if (params?.platform) q.set('platform', params.platform);
  if (params?.status)   q.set('status',   params.status);
  if (params?.date)     q.set('date',     params.date);
  return apiFetch<OnlineOrder[]>(`/aggregator/orders?${q}`);
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

export const dispatchDeliveryOrder = (orderId: string) =>
  apiFetch<{ message: string }>(`/aggregator/orders/${orderId}/dispatch`, { method: 'POST' });

// ── Webhook logs ──────────────────────────────────────────────────────────────

export const fetchWebhookLogs = (params?: { platform?: string; status?: string }) => {
  const q = new URLSearchParams();
  if (params?.platform) q.set('platform', params.platform);
  if (params?.status)   q.set('status',   params.status);
  return apiFetch<WebhookLog[]>(`/aggregator/webhook-logs?${q}`);
};

export const retryWebhook = (logId: string) =>
  apiFetch<{ message: string }>(`/aggregator/webhook-logs/${logId}/retry`, { method: 'POST' });
