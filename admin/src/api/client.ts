const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenUpdatedFn = (token: string, refreshToken: string) => void;
type AuthExpiredFn  = () => void;

let _onTokenUpdated: TokenUpdatedFn | null = null;
let _onAuthExpired:  AuthExpiredFn  | null = null;

export function configureAuth(opts: {
  onTokenUpdated: TokenUpdatedFn;
  onAuthExpired:  AuthExpiredFn;
}): void {
  _onTokenUpdated = opts.onTokenUpdated;
  _onAuthExpired  = opts.onAuthExpired;
}

let _refreshPromise: Promise<boolean> | null = null;

async function silentRefresh(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async (): Promise<boolean> => {
    const rt = localStorage.getItem('admin_refresh_token');
    if (!rt) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token: string; refreshToken: string };
      localStorage.setItem('admin_token', data.token);
      localStorage.setItem('admin_refresh_token', data.refreshToken);
      _onTokenUpdated?.(data.token, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  })().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

export function getStoredToken(): string | null {
  return localStorage.getItem('admin_token');
}

interface ExtendedInit extends RequestInit {
  _isRetry?: boolean;
}

export async function apiFetch<T>(path: string, init: ExtendedInit = {}): Promise<T> {
  const { _isRetry = false, ...fetchInit } = init;
  const token = localStorage.getItem('admin_token');

  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchInit,
    signal: fetchInit.signal ?? AbortSignal.timeout(20_000),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fetchInit.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    if (res.status === 401 && !_isRetry) {
      const refreshed = await silentRefresh();
      if (refreshed) return apiFetch<T>(path, { ...init, _isRetry: true });
      _onAuthExpired?.();
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_refresh_token');
      localStorage.removeItem('admin_hotel_id');
      localStorage.removeItem('admin_role');
      window.location.replace('/login');
      throw new ApiError(401, 'Session expired');
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
