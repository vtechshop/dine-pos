import { apiFetch } from './client';
import type { Table, SessionSummary } from '../types';

export async function fetchTables(): Promise<Table[]> {
  // GET /api/tables — returns array (not wrapped)
  return apiFetch<Table[]>('/tables');
}

export async function fetchOpenSessions(): Promise<SessionSummary[]> {
  // GET /api/sessions?status=open — returns { sessions, total } enriched with
  // guestCount, activeGuestCount, runningTotal aggregated on the backend.
  const res = await apiFetch<{ sessions: SessionSummary[] }>('/sessions?status=open');
  return res.sessions;
}

export async function openSession(tableId: string): Promise<{ session: SessionSummary & { _id: string } }> {
  return apiFetch<{ session: SessionSummary & { _id: string } }>('/sessions', {
    method: 'POST',
    body: JSON.stringify({ tableId }),
  });
}
