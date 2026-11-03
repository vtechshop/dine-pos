// Super Admin Aggregator API
// Base: /api/superadmin/aggregator/*
// Auth: uses SA JWT (pos_token with role=superadmin)
//
// This release is READ-ONLY. The GET endpoints below (dashboard, hotels, orders,
// webhooks, sync-status, settlement, analytics, alerts, audit, settings and
// reports) exist on the server. Actions that need live Swiggy/Zomato partner
// API access (per-platform enable/disable, force sync, reset API, clear/retry
// queue, webhook retry, retry-all-sync, settings update) are not available yet,
// so there are no client functions for them.
// The per-hotel aggregator on/off switch uses the existing
// PUT /superadmin/hotels/:id/features endpoint.

const SA_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/superadmin`
  : 'http://localhost:5000/api/superadmin';

async function saFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('sa_token');
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
      localStorage.removeItem('sa_token');
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

export interface AggAlert {
  id:         string;
  type:       string;
  severity:   'critical' | 'warning' | 'info';
  hotelId?:   string;
  hotelName?: string;
  message:    string;
  createdAt:  string;
  resolved:   boolean;
}

export interface AggAuditEntry {
  id:         string;
  action:     string;
  hotelId?:   string;
  hotelName?: string;
  detail:     string;
  actorId:    string;
  createdAt:  string;
}

export interface AggAnalytics {
  revenueByDay: { date: string; swiggy: number; zomato: number }[];
  orderGrowth:  { date: string; count: number }[];
  acceptancePct: number;
  cancellationPct: number;
  refundPct: number;
  avgPrepMins: number;
  topHotels: { hotelId: string; hotelName: string; orders: number; revenue: number }[];
  topCities:  { city: string; orders: number; revenue: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
}

// ── Per-hotel aggregator on/off (existing endpoint) ───────────────────────────

export function setHotelAggregatorFeature(
  hotelId:   string,
  enabled:   boolean,
): Promise<{ message: string; features: Record<string, boolean> }> {
  return saFetch(`/hotels/${hotelId}/features`, {
    method: 'PUT',
    body:   JSON.stringify({ aggregator: enabled }),
  });
}

// ── Read-only endpoints ───────────────────────────────────────────────────────

// GET /superadmin/aggregator/dashboard
export function getAggDashboard(): Promise<AggDashboard> {
  return saFetch<AggDashboard>('/aggregator/dashboard');
}

// GET /superadmin/aggregator/hotels?status=&platform=&search=&page=
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

// GET /superadmin/aggregator/orders?date=&status=&platform=&hotelId=&page=
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

// GET /superadmin/aggregator/webhooks?platform=&status=&from=&to=&page=
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

// GET /superadmin/aggregator/sync-status?platform=&status=
export function getGlobalSyncStatus(params?: {
  platform?: AggPlatform | 'all';
  status?:   string;
}): Promise<{ syncs: SyncStatus[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.platform && params.platform !== 'all') q.set('platform', params.platform);
  if (params?.status)  q.set('status', params.status);
  return saFetch<{ syncs: SyncStatus[]; total: number }>(`/aggregator/sync-status?${q}`);
}

// GET /superadmin/aggregator/analytics?from=&to=
export function getAggAnalytics(from: string, to: string): Promise<AggAnalytics> {
  const q = new URLSearchParams({ from, to });
  return saFetch<AggAnalytics>(`/aggregator/analytics?${q}`);
}

// GET /superadmin/aggregator/alerts
export function getAggAlerts(): Promise<{ alerts: AggAlert[] }> {
  return saFetch<{ alerts: AggAlert[] }>('/aggregator/alerts');
}

// GET /superadmin/aggregator/settings (read-only in this release)
export function getAggSettings(): Promise<AggGlobalSettings> {
  return saFetch<AggGlobalSettings>('/aggregator/settings');
}

// GET /superadmin/aggregator/audit?from=&to=&type=
export function getAggAudit(params?: { from?: string; to?: string; type?: string }): Promise<{
  entries: AggAuditEntry[];
}> {
  const q = new URLSearchParams();
  if (params?.from) q.set('from', params.from);
  if (params?.to)   q.set('to',   params.to);
  if (params?.type) q.set('type', params.type);
  return saFetch<{ entries: AggAuditEntry[] }>(`/aggregator/audit?${q}`);
}

// GET /superadmin/aggregator/reports/generate?type=&from=&to=&format=csv → CSV file
export async function getAggReport(type: string, from: string, to: string): Promise<Blob> {
  const token = localStorage.getItem('sa_token');
  const q = new URLSearchParams({ type, from, to, format: 'csv' });
  const res = await fetch(`${SA_BASE}/aggregator/reports/generate?${q}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal:  AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('sa_token');
      localStorage.removeItem('pos_role');
      window.location.replace('/super-admin/login');
      throw new Error('Session expired');
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.blob();
}
