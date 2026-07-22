import { apiFetch } from './client';

const SA_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/superadmin`
  : 'http://localhost:5000/api/superadmin';

async function saFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('pos_token');
  const res = await fetch(`${SA_BASE}${path}`, {
    ...init,
    signal: (init as any).signal ?? AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    if (res.status === 401 && token) {
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

export interface SALoginResponse {
  success: boolean;
  role:    'superadmin';
  token:   string;
}

export function saLogin(userId: string, password: string): Promise<SALoginResponse> {
  return saFetch<SALoginResponse>('/login', {
    method: 'POST',
    body:   JSON.stringify({ userId, password }),
  });
}

// ── Hotel types ───────────────────────────────────────────────────────────────

export interface Hotel {
  _id:                   string;
  hotelName:             string;
  ownerName:             string;
  phone:                 string;
  email:                 string;
  businessType:          string;
  city:                  string;
  state:                 string;
  status:                'pending' | 'trial' | 'active' | 'expired' | 'suspended' | 'rejected';
  adminId:               string;
  trialStartDate:        string | null;
  trialEndDate:          string | null;
  approvedAt:            string | null;
  rejectionReason:       string;
  subscriptionType:      'trial' | 'starter' | 'professional' | 'enterprise';
  subscriptionStartDate: string | null;
  subscriptionEndDate:   string | null;
  createdAt:             string;
  updatedAt:             string;
  features: {
    payment:       boolean;
    reservations:  boolean;
    customerChat:  boolean;
    qrOrdering:    boolean;
    expenses:      boolean;
    reports:       boolean;
    tables:        boolean;
    ingredients:   boolean;
    waste:         boolean;
    aggregator:    boolean;
  };
}

export interface HotelListResponse {
  hotels: Hotel[];
  total:  number;
  page:   number;
  pages:  number;
}

export function getHotels(params?: {
  status?: string;
  search?: string;
  page?:   number;
}): Promise<HotelListResponse> {
  const q = new URLSearchParams();
  if (params?.status && params.status !== 'all') q.set('status', params.status);
  if (params?.search)  q.set('search', params.search);
  if (params?.page)    q.set('page', String(params.page));
  const qs = q.toString();
  return saFetch<HotelListResponse>(`/hotels${qs ? `?${qs}` : ''}`);
}

export function getHotel(id: string): Promise<Hotel> {
  return saFetch<Hotel>(`/hotels/${id}`);
}

export interface ApprovePayload {
  trialDays?: number;
  features?:  Partial<Hotel['features']>;
}

export interface ApproveResponse {
  message:     string;
  hotel:       Hotel;
  credentials: { adminId: string; password: string; kitchenPin: string };
}

export function approveHotel(id: string, payload: ApprovePayload): Promise<ApproveResponse> {
  return saFetch<ApproveResponse>(`/hotels/${id}/approve`, {
    method: 'PUT',
    body:   JSON.stringify(payload),
  });
}

export interface RejectResponse {
  message: string;
  hotel:   Hotel;
}

export function rejectHotel(id: string, reason: string): Promise<RejectResponse> {
  return saFetch<RejectResponse>(`/hotels/${id}/reject`, {
    method: 'PUT',
    body:   JSON.stringify({ reason }),
  });
}

export interface SimpleHotelAction {
  message: string;
  hotel:   Hotel;
}

export interface DashboardSystemHealth {
  mongo:         string;
  redis:         string;
  api:           string;
  memory:        { usedMB: number; totalMB: number; rssMB: number; percentage: number };
  uptimeSeconds: number;
  loadAvg:       number;
}

export interface DashboardData {
  hotelStats: {
    total:     number;
    pending:   number;
    trial:     number;
    active:    number;
    expired:   number;
    suspended: number;
    rejected:  number;
  };
  devices:        { total: number; online: number };
  todayRevenue:   number;
  monthlyRevenue: number;
  churnRisk:      number;
  openTickets:    number;
  latestRegistrations: {
    _id: string; hotelName: string; ownerName: string;
    phone: string; city: string; state: string;
    status: string; createdAt: string;
  }[];
  pendingRenewals: {
    _id: string; hotelName: string; ownerName: string;
    phone: string; status: string; subscriptionType: string;
    trialEndDate: string | null; subscriptionEndDate: string | null;
  }[];
  systemHealth?: DashboardSystemHealth;
  generatedAt:   string;
}

// ── System Health ─────────────────────────────────────────────────────────────

export interface HealthData {
  status:        string;
  mongo:         string;
  api:           string;
  totalHotels:   number;
  totalOrders:   number;
  totalDevices:  number;
  onlineDevices: number;
  checkedAt:     string;
}

export function getHealth(): Promise<HealthData> {
  return saFetch<HealthData>('/health');
}

export function getDashboard(): Promise<DashboardData> {
  return saFetch<DashboardData>('/dashboard');
}

export function suspendHotel(id: string): Promise<SimpleHotelAction> {
  return saFetch<SimpleHotelAction>(`/hotels/${id}/suspend`, { method: 'PUT' });
}

export function activateHotel(id: string): Promise<SimpleHotelAction> {
  return saFetch<SimpleHotelAction>(`/hotels/${id}/activate`, { method: 'PUT' });
}

export function extendTrial(id: string, days: number): Promise<SimpleHotelAction> {
  return saFetch<SimpleHotelAction>(`/hotels/${id}/extend-trial`, {
    method: 'PUT',
    body:   JSON.stringify({ days }),
  });
}

export function setTrial(id: string, trialDays: number): Promise<SimpleHotelAction> {
  return saFetch<SimpleHotelAction>(`/hotels/${id}/trial`, {
    method: 'PUT',
    body:   JSON.stringify({ trialDays }),
  });
}

export interface UpdateFeaturesResponse {
  message:  string;
  features: Hotel['features'];
}

export function updateFeatures(id: string, features: Partial<Hotel['features']>): Promise<UpdateFeaturesResponse> {
  return saFetch<UpdateFeaturesResponse>(`/hotels/${id}/features`, {
    method: 'PUT',
    body:   JSON.stringify(features),
  });
}

export function setPlan(
  id:           string,
  plan:         'starter' | 'professional' | 'enterprise',
  durationDays: number,
): Promise<SimpleHotelAction> {
  return saFetch<SimpleHotelAction>(`/hotels/${id}/plan`, {
    method: 'PUT',
    body:   JSON.stringify({ plan, durationDays }),
  });
}

// ── Subscription Revenue ──────────────────────────────────────────────────────

export interface SubscriptionRevenueData {
  mrr:                    number;
  arr:                    number;
  expectedRenewalRevenue: number;
  renewingCount:          number;
  breakdown: { plan: string; count: number; monthlyPrice: number; contribution: number }[];
  recentSubscriptions:    unknown[];
}

export function getSubscriptionRevenue(): Promise<SubscriptionRevenueData> {
  return saFetch<SubscriptionRevenueData>('/dashboard/subscription-revenue');
}

// ── Hotel Growth ──────────────────────────────────────────────────────────────

export interface HotelGrowthPoint {
  _id:      { year: number; month: number; day?: number };
  total:    number;
  approved: number;
  trial:    number;
  active:   number;
}

export interface HotelGrowthData {
  period:        '7d' | '30d' | '12m';
  data:          HotelGrowthPoint[];
  totalInPeriod: number;
}

export function getHotelGrowth(period: '7d' | '30d' | '12m'): Promise<HotelGrowthData> {
  return saFetch<HotelGrowthData>(`/dashboard/hotel-growth?period=${period}`);
}

// ── Top Hotels ────────────────────────────────────────────────────────────────

export interface TopHotel {
  hotelId:     string;
  hotelName:   string;
  city:        string;
  plan:        string;
  value?:      number;
  lastSeen?:   string;
  deviceCount?: number;
}

export interface TopHotelsData {
  by:     'revenue' | 'orders' | 'activity';
  period: 'today' | 'week' | 'month';
  hotels: TopHotel[];
}

export function getTopHotels(
  by:     'revenue' | 'orders' | 'activity',
  period: 'today' | 'week' | 'month',
): Promise<TopHotelsData> {
  return saFetch<TopHotelsData>(`/dashboard/top-hotels?by=${by}&period=${period}&limit=10`);
}

// ── Failed Payments ───────────────────────────────────────────────────────────

export interface FailedPaymentsData {
  pending: number;
  failed:  number;
  overdue: number;
  total:   number;
  recent:  { _id: string; status: string; updatedAt: string }[];
}

export function getFailedPayments(): Promise<FailedPaymentsData> {
  return saFetch<FailedPaymentsData>('/dashboard/failed-payments');
}

// ── Device Licensing ──────────────────────────────────────────────────────────

export interface DeviceLicensingByPlan {
  plan:            string;
  allowedPerHotel: number;
  hotelCount:      number;
  totalAllowed:    number;
  activeDevices:   number;
}

export interface DeviceLicensingData {
  total:   number;
  active:  number;
  blocked: number;
  byPlan:  DeviceLicensingByPlan[];
}

export function getDeviceLicensing(): Promise<DeviceLicensingData> {
  return saFetch<DeviceLicensingData>('/dashboard/device-licensing');
}

// Re-export apiFetch for non-SA paths that need the standard client
export { apiFetch };
