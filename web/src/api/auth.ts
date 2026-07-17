import { apiFetch } from './client';

export interface LoginResponse {
  token: string;
  hotelId?: string;
  role?: string;
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
    body: JSON.stringify({ userId, password }),
  });
}
