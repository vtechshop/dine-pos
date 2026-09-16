import { apiFetch } from './client';

const AUTH_API_BASE = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:5000/api';

export interface LoginResponse {
  token:         string;
  refreshToken?: string;
  hotelId?:      string;
  role?:         string;
  hotelName?:    string;
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function loginApi(userId: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body:   JSON.stringify({ userId, password }),
  });
}

export interface CashierLoginResponse {
  token:   string;
  cashier: { _id: string; name: string; employeeCode: string; mobile?: string };
}

export function loginCashierApi(
  hotelId:      string,
  employeeCode: string,
  pin:          string,
): Promise<CashierLoginResponse> {
  return apiFetch<CashierLoginResponse>('/auth/cashier', {
    method: 'POST',
    body:   JSON.stringify({ hotelId, employeeCode, pin }),
  });
}

// H-02: revoke the refresh token on the server so it cannot generate new access tokens
export async function logoutApi(refreshToken: string): Promise<void> {
  await apiFetch('/auth/logout', {
    method: 'POST',
    body:   JSON.stringify({ refreshToken }),
  });
}

export interface RefreshResponse {
  token:        string;
  refreshToken: string;
}

// Direct refresh call — intentionally bypasses apiFetch and its H-03 retry logic
// so it can be used with the HQ refresh token (pos_org_refresh_token) during switchToOrg.
export async function refreshTokenApi(refreshToken: string): Promise<RefreshResponse> {
  const res = await fetch(`${AUTH_API_BASE}/auth/refresh`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`HQ token refresh failed: ${res.status}`);
  }
  return res.json() as Promise<RefreshResponse>;
}
