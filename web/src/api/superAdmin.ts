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
    if (res.status === 401) {
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_role');
      window.location.replace('/super-admin/login');
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
  generatedAt: string;
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

// Re-export apiFetch for non-SA paths that need the standard client
export { apiFetch };
