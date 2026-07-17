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

export async function createTable(body: {
  number: number;
  name: string;
  capacity: number;
  shape: 'square' | 'round';
}): Promise<Table> {
  return apiFetch<Table>('/tables', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateTable(
  id: string,
  body: Partial<{ number: number; name: string; capacity: number; shape: 'square' | 'round'; status: string }>,
): Promise<Table> {
  return apiFetch<Table>(`/tables/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteTable(id: string): Promise<void> {
  await apiFetch<unknown>(`/tables/${id}`, { method: 'DELETE' });
}
