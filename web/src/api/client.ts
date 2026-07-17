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

export function getStoredToken(): string | null {
  return localStorage.getItem('pos_token');
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const body: { message?: string } = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
