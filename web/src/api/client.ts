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

// ── Module-level auth callbacks registered by AuthContext on mount ─────────────
// Using a module singleton avoids passing callbacks through React props/context
// while keeping the API client free of React dependencies.
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

// ── Silent token refresh — singleton promise prevents concurrent refresh storms ─
let _refreshPromise: Promise<boolean> | null = null;

async function silentRefresh(): Promise<boolean> {
  // Reuse an in-flight refresh rather than firing multiple concurrent ones
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async (): Promise<boolean> => {
    const rt = localStorage.getItem('pos_refresh_token');
    if (!rt) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token: string; refreshToken: string };
      localStorage.setItem('pos_token',         data.token);
      localStorage.setItem('pos_refresh_token', data.refreshToken);
      _onTokenUpdated?.(data.token, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  })().finally(() => { _refreshPromise = null; });

  return _refreshPromise;
}

// Exposed so SocketContext can read the current token without importing React context
export function getStoredToken(): string | null {
  return localStorage.getItem('pos_token');
}

// ── Extended RequestInit — internal flag prevents recursive refresh on retry ───
interface ExtendedInit extends RequestInit {
  _isRetry?: boolean;
}

export async function apiFetch<T>(path: string, init: ExtendedInit = {}): Promise<T> {
  const { _isRetry = false, ...fetchInit } = init;
  const token = localStorage.getItem('pos_token');

  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchInit,
    signal: fetchInit.signal ?? AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fetchInit.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    // ── H-03: 401 interception — attempt silent refresh then retry once ─────
    if (res.status === 401 && !_isRetry) {
      const refreshed = await silentRefresh();
      if (refreshed) {
        // Retry the original request with the new token now in localStorage
        return apiFetch<T>(path, { ...init, _isRetry: true });
      }
      // Refresh failed: clear auth state and force back to login
      _onAuthExpired?.();
      // Hard navigation ensures the user lands on /login even if the React
      // tree has partially unmounted (e.g., error boundaries caught a throw)
      window.location.replace('/login');
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
