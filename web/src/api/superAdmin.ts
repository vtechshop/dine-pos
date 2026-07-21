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
  _id:              string;
  hotelName:        string;
  ownerName:        string;
  phone:            string;
  email:            string;
  businessType:     string;
  city:             string;
  state:            string;
  status:           'pending' | 'trial' | 'active' | 'expired' | 'suspended' | 'rejected';
  adminId:          string;
  trialStartDate:   string | null;
  trialEndDate:     string | null;
  approvedAt:       string | null;
  rejectionReason:  string;
  createdAt:        string;
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

// Re-export apiFetch for non-SA paths that need the standard client
export { apiFetch };
