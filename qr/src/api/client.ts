// Public API client — no JWT, no refresh interceptor.
// All QR endpoints are under /api/public/* which the backend serves
// with cors({ origin: '*' }). No authentication is required.

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code:   string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function publicFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    // Phase 5 · Batch 4 (P4-QR-01): the browser's raw "Failed to fetch" is not for guests
    throw new ApiError(0, 'NETWORK', 'Could not connect. Please check your internet connection and try again.');
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?:   string;
      code?:    string;
    };
    throw new ApiError(
      res.status,
      body.code,
      body.message ?? body.error ?? `Something went wrong (error ${res.status}). Please try again or ask staff.`,
    );
  }

  return res.json() as Promise<T>;
}
