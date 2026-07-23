// Super Admin Aggregator API
// Base: /api/superadmin/aggregator/*
// Auth: uses SA JWT (pos_token with role=superadmin)
//
// IMPORTANT: Most cross-hotel endpoints below do NOT yet exist in the backend.
// Endpoints marked with [SA-BACKEND-REQUIRED] need to be implemented
// in the super admin Express router before the UI can display live data.
// Feature flags (enable/disable aggregator per hotel) use the EXISTING
// /superadmin/hotels/:id/features endpoint and work today.

const SA_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/superadmin`
  : 'http://localhost:5000/api/superadmin';

async function saFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('pos_token');
  const res   = await fetch(`${SA_BASE}${path}`, {
    ...init,
    signal: (init as RequestInit & { signal?: AbortSignal }).signal ?? AbortSignal.timeout(20_000),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_role');
      window.location.replace('/super-admin/login');
      throw new Error('Session expired');
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AggPlatform = 'swiggy' | 'zomato';
export type AggConnStatus = 'connected' | 'disconnected' | 'error' | 'pending' | 'disabled';

export interface HotelAggStatus {
  hotelId:    string;
  hotelName:  string;
  city:       string;
  state:      string;
  plan:       string;
  featureEnabled: boolean;  // from hotel.features.aggregator
  swiggy: {
    status:       AggConnStatus;
    storeId:      string;
    lastSync:     string | null;
    lastOrder:    string | null;
    lastError:    string | null;
    webhookOk:    boolean;
    apiOk:        boolean;
    orderCount:   number;
  } | null;
  zomato: {
    status:       AggConnStatus;
    storeId:      string;
    lastSync:     string | null;
    lastOrder:    string | null;
    lastError:    string | null;
    webhookOk:    boolean;
    apiOk:        boolean;
    orderCount:   number;
  } | null;
}

export interface AggDashboard {
  totalHotels:        number;
  swiggyConnected:    number;
  zomatoConnected:    number;
  bothConnected:      number;
  disconnected:       number;
  pendingVerification:number;
  failedIntegrations: number;
  todayOrders:        number;
  todayRevenue:       number;
  todayCommission:    number;
  todayRefunds:       number;
  todayCancelled:     number;
  avgAcceptancePct:   number;
  avgPrepMins:        number;
  platformHealth: {
    swiggyApi:    'up' | 'down' | 'degraded';
    zomatoApi:    'up' | 'down' | 'degraded';
    webhookServer:'up' | 'down' | 'degraded';
  };
}

export interface SAWebhookLog {
  _id:             string;
  hotelId:         string;
  hotelName:       string;
  platform:        string;
  event:           string;
  status:          'success' | 'failed' | 'retrying';
  platformOrderId: string;
  errorMessage:    string | null;
  retryCount:      number;
  latencyMs:       number;
  payloadBytes:    number;
  createdAt:       string;
}

export interface SAGlobalOrder {
  _id:          string;
  hotelId:      string;
  hotelName:    string;
  orderNumber:  string;
  platform:     AggPlatform;
  status:       string;
  grandTotal:   number;
  commission:   number;
  createdAt:    string;
  city:         string;
  state:        string;
}

export interface AggSettlementSummary {
  platform:    string;
  revenue:     number;
  commission:  number;
  pending:     number;
  complete:    number;
  refunds:     number;
  netPayout:   number;
}

export interface SyncStatus {
  hotelId:        string;
  hotelName:      string;
  platform:       AggPlatform;
  syncedProducts: number;
  syncedCategories:number;
  failedProducts: number;
  retryPending:   number;
  lastSync:       string | null;
  status:         'idle' | 'syncing' | 'success' | 'failed';
}

export interface AggGlobalSettings {
  webhookTimeoutMs:  number;
  retryCount:        number;
  retryDelayMs:      number;
  syncIntervalMins:  number;
  queueSizeLimit:    number;
  swiggyRateLimit:   number;
  zomatoRateLimit:   number;
  maintenanceMode:   boolean;
}

// ── LIVE: Feature flag per hotel (uses existing endpoint) ─────────────────────

export function setHotelAggregatorFeature(
  hotelId:   string,
  enabled:   boolean,
): Promise<{ message: string; features: Record<string, boolean> }> {
  return saFetch(`/hotels/${hotelId}/features`, {
    method: 'PUT',
    body:   JSON.stringify({ aggregator: enabled }),
  });
}

export function setHotelPlatformEnabled(
  hotelId:  string,
  platform: AggPlatform,
  enabled:  boolean,
): Promise<{ message: string }> {
  // [SA-BACKEND-REQUIRED] POST /superadmin/aggregator/hotels/:hotelId/platform
  // Body: { platform, enabled }
  return Promise.reject(new Error(`SA-BACKEND-REQUIRED: POST /superadmin/aggregator/hotels/${hotelId}/platform { platform: "${platform}", enabled: ${enabled} }`));
}

// ── SA-BACKEND-REQUIRED endpoints ─────────────────────────────────────────────

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/dashboard
export function getAggDashboard(): Promise<AggDashboard> {
  return saFetch<AggDashboard>('/aggregator/dashboard');
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/hotels?status=&platform=&page=
export function getHotelAggStatuses(params?: {
  status?:   AggConnStatus | 'all';
  platform?: AggPlatform | 'all';
  search?:   string;
  page?:     number;
}): Promise<{ hotels: HotelAggStatus[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.status   && params.status   !== 'all') q.set('status',   params.status);
  if (params?.platform && params.platform !== 'all') q.set('platform', params.platform);
  if (params?.search)  q.set('search',  params.search);
  if (params?.page)    q.set('page',    String(params.page));
  return saFetch<{ hotels: HotelAggStatus[]; total: number }>(`/aggregator/hotels?${q}`);
}

// [SA-BACKEND-REQUIRED] POST /superadmin/aggregator/hotels/:hotelId/force-sync
export function forceHotelSync(hotelId: string, platform: AggPlatform): Promise<{ message: string }> {
  return saFetch<{ message: string }>(`/aggregator/hotels/${hotelId}/force-sync`, {
    method: 'POST',
    body:   JSON.stringify({ platform }),
  });
}

// [SA-BACKEND-REQUIRED] POST /superadmin/aggregator/hotels/:hotelId/reset-api
export function resetHotelApi(hotelId: string, platform: AggPlatform): Promise<{ message: string }> {
  return saFetch<{ message: string }>(`/aggregator/hotels/${hotelId}/reset-api`, {
    method: 'POST',
    body:   JSON.stringify({ platform }),
  });
}

// [SA-BACKEND-REQUIRED] POST /superadmin/aggregator/hotels/:hotelId/clear-queue
export function clearHotelQueue(hotelId: string): Promise<{ message: string }> {
  return saFetch<{ message: string }>(`/aggregator/hotels/${hotelId}/clear-queue`, { method: 'POST' });
}

// [SA-BACKEND-REQUIRED] POST /superadmin/aggregator/hotels/:hotelId/retry-queue
export function retryHotelQueue(hotelId: string): Promise<{ message: string }> {
  return saFetch<{ message: string }>(`/aggregator/hotels/${hotelId}/retry-queue`, { method: 'POST' });
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/orders?date=&status=&platform=&hotel=&page=
export function getGlobalOrders(params?: {
  date?:     string;
  status?:   string;
  platform?: AggPlatform | 'all';
  hotelId?:  string;
  page?:     number;
}): Promise<{ orders: SAGlobalOrder[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.date)    q.set('date',     params.date);
  if (params?.status)  q.set('status',   params.status);
  if (params?.platform && params.platform !== 'all') q.set('platform', params.platform);
  if (params?.hotelId) q.set('hotelId',  params.hotelId);
  if (params?.page)    q.set('page',     String(params.page));
  return saFetch<{ orders: SAGlobalOrder[]; total: number }>(`/aggregator/orders?${q}`);
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/webhooks?platform=&status=&from=&to=&page=
export function getGlobalWebhooks(params?: {
  platform?: AggPlatform | 'all';
  status?:   string;
  from?:     string;
  to?:       string;
  page?:     number;
}): Promise<{ logs: SAWebhookLog[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.platform && params.platform !== 'all') q.set('platform', params.platform);
  if (params?.status)  q.set('status', params.status);
  if (params?.from)    q.set('from',   params.from);
  if (params?.to)      q.set('to',     params.to);
  if (params?.page)    q.set('page',   String(params.page));
  return saFetch<{ logs: SAWebhookLog[]; total: number }>(`/aggregator/webhooks?${q}`);
}

// [SA-BACKEND-REQUIRED] POST /superadmin/aggregator/webhooks/:id/retry
export function retryGlobalWebhook(id: string): Promise<{ message: string }> {
  return saFetch<{ message: string }>(`/aggregator/webhooks/${id}/retry`, { method: 'POST' });
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/sync-status?platform=&status=
export function getGlobalSyncStatus(params?: {
  platform?: AggPlatform | 'all';
  status?:   string;
}): Promise<{ syncs: SyncStatus[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.platform && params.platform !== 'all') q.set('platform', params.platform);
  if (params?.status)  q.set('status', params.status);
  return saFetch<{ syncs: SyncStatus[]; total: number }>(`/aggregator/sync-status?${q}`);
}

// [SA-BACKEND-REQUIRED] POST /superadmin/aggregator/retry-all-sync
export function retryAllSync(): Promise<{ message: string; queued: number }> {
  return saFetch<{ message: string; queued: number }>('/aggregator/retry-all-sync', { method: 'POST' });
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/settlement?from=&to=&platform=
export function getGlobalSettlement(params?: {
  from?: string;
  to?:   string;
}): Promise<{ byPlatform: AggSettlementSummary[]; byHotel: { hotelId: string; hotelName: string; revenue: number; commission: number; net: number }[] }> {
  const q = new URLSearchParams();
  if (params?.from) q.set('from', params.from);
  if (params?.to)   q.set('to',   params.to);
  return saFetch(`/aggregator/settlement?${q}`);
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/analytics?from=&to=
export function getAggAnalytics(from: string, to: string): Promise<{
  revenueByDay: { date: string; swiggy: number; zomato: number }[];
  orderGrowth:  { date: string; count: number }[];
  acceptancePct: number;
  cancellationPct: number;
  refundPct: number;
  avgPrepMins: number;
  topHotels: { hotelId: string; hotelName: string; orders: number; revenue: number }[];
  topCities:  { city: string; orders: number; revenue: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
}> {
  return saFetch(`/aggregator/analytics?from=${from}&to=${to}`);
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/alerts
export function getAggAlerts(): Promise<{
  alerts: { id: string; type: string; severity: 'critical' | 'warning' | 'info'; hotelId?: string; hotelName?: string; message: string; createdAt: string; resolved: boolean }[];
}> {
  return saFetch('/aggregator/alerts');
}

// [SA-BACKEND-REQUIRED] GET/PUT /superadmin/aggregator/settings
export function getAggSettings(): Promise<AggGlobalSettings> {
  return saFetch<AggGlobalSettings>('/aggregator/settings');
}

export function updateAggSettings(patch: Partial<AggGlobalSettings>): Promise<{ message: string; settings: AggGlobalSettings }> {
  return saFetch<{ message: string; settings: AggGlobalSettings }>('/aggregator/settings', {
    method: 'PUT',
    body:   JSON.stringify(patch),
  });
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/audit?from=&to=&type=
export function getAggAudit(params?: { from?: string; to?: string; type?: string }): Promise<{
  entries: { id: string; action: string; hotelId?: string; hotelName?: string; detail: string; actorId: string; createdAt: string }[];
}> {
  const q = new URLSearchParams();
  if (params?.from) q.set('from', params.from);
  if (params?.to)   q.set('to',   params.to);
  if (params?.type) q.set('type', params.type);
  return saFetch(`/aggregator/audit?${q}`);
}

// [SA-BACKEND-REQUIRED] GET /superadmin/aggregator/reports/generate?type=&from=&to=&format=
export function getAggReport(type: string, from: string, to: string): Promise<Blob> {
  const token = localStorage.getItem('pos_token');
  return fetch(`${SA_BASE}/aggregator/reports/generate?type=${type}&from=${from}&to=${to}&format=csv`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  });
}

// ── Missing endpoint documentation ────────────────────────────────────────────
export const SA_AGG_REQUIRED_ENDPOINTS = [
  'GET  /superadmin/aggregator/dashboard                   — global KPI summary across all hotels',
  'GET  /superadmin/aggregator/hotels                      — per-hotel Swiggy/Zomato status, store IDs, webhook health',
  'POST /superadmin/aggregator/hotels/:id/platform         — enable/disable specific platform per hotel',
  'POST /superadmin/aggregator/hotels/:id/force-sync       — force menu sync for a hotel',
  'POST /superadmin/aggregator/hotels/:id/reset-api        — rotate/reset API keys',
  'POST /superadmin/aggregator/hotels/:id/clear-queue      — clear order retry queue',
  'POST /superadmin/aggregator/hotels/:id/retry-queue      — retry failed queue items',
  'GET  /superadmin/aggregator/orders                      — global order feed across hotels',
  'GET  /superadmin/aggregator/webhooks                    — global webhook log with retry',
  'POST /superadmin/aggregator/webhooks/:id/retry          — retry individual webhook',
  'GET  /superadmin/aggregator/sync-status                 — global menu sync status',
  'POST /superadmin/aggregator/retry-all-sync              — retry all failed syncs',
  'GET  /superadmin/aggregator/settlement                  — cross-hotel settlement data',
  'GET  /superadmin/aggregator/analytics                   — aggregator analytics (charts, KPIs)',
  'GET  /superadmin/aggregator/alerts                      — active alert engine output',
  'GET  /superadmin/aggregator/settings                    — global aggregator settings',
  'PUT  /superadmin/aggregator/settings                    — update global settings',
  'GET  /superadmin/aggregator/audit                       — cross-hotel aggregator audit log',
  'GET  /superadmin/aggregator/reports/generate            — report CSV/PDF generation',
];
