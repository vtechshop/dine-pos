import { apiFetch } from './client';
import type { Reservation, ReservationStats, WaitlistEntry } from '../types';

export interface ReservationsResponse {
  reservations: Reservation[];
  total: number;
  limit: number;
  skip: number;
}

export interface WaitlistResponse {
  entries: WaitlistEntry[];
  total: number;
  limit: number;
  skip: number;
}

export interface AvailabilityResponse {
  taken: Array<{
    tableId: string;
    tableNumber?: number | null;
    time: string;
    startMinutes?: number;
    durationMinutes?: number;
    status: string;
    customerName?: string;
    partySize?: number;
  }>;
}

export interface CreateReservationInput {
  customerName: string;
  phone: string;
  email?: string;
  partySize: number;
  date: string;
  time: string;
  notes?: string;
  occasion?: string;
  source?: string;
  tableNumber?: number | null;
  tableId?: string | null;
  durationMinutes?: number;
  depositAmount?: number;
  depositStatus?: string;
}

export type UpdateReservationInput = Partial<CreateReservationInput>;

// ── Reservations ──────────────────────────────────────────────────────────────

export async function fetchReservations(params?: {
  date?: string;
  status?: string;
  tableId?: string;
  limit?: number;
  skip?: number;
}): Promise<ReservationsResponse> {
  const q = new URLSearchParams();
  if (params?.date)    q.set('date', params.date);
  if (params?.status)  q.set('status', params.status);
  if (params?.tableId) q.set('tableId', params.tableId);
  if (params?.limit)   q.set('limit', String(params.limit));
  if (params?.skip)    q.set('skip', String(params.skip));
  const qs = q.toString();
  return apiFetch<ReservationsResponse>(`/reservations${qs ? '?' + qs : ''}`);
}

export async function fetchReservationStats(date?: string): Promise<ReservationStats> {
  const q = date ? `?date=${date}` : '';
  return apiFetch<ReservationStats>(`/reservations/stats${q}`);
}

export async function fetchAvailability(date: string): Promise<AvailabilityResponse> {
  return apiFetch<AvailabilityResponse>(`/reservations/availability?date=${date}`);
}

export async function createReservation(body: CreateReservationInput): Promise<Reservation> {
  return apiFetch<Reservation>('/reservations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateReservation(id: string, body: UpdateReservationInput): Promise<Reservation> {
  return apiFetch<Reservation>(`/reservations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function updateReservationStatus(
  id: string,
  status: Reservation['status'],
  extra?: { cancellationReason?: string },
): Promise<Reservation> {
  return apiFetch<Reservation>(`/reservations/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...extra }),
  });
}

export async function deleteReservation(id: string, hard = false): Promise<void> {
  const q = hard ? '?hard=1' : '';
  await apiFetch<unknown>(`/reservations/${id}${q}`, { method: 'DELETE' });
}

// ── Waitlist ──────────────────────────────────────────────────────────────────

export async function fetchWaitlist(params?: {
  status?: string;
  limit?: number;
  skip?: number;
}): Promise<WaitlistResponse> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.limit)  q.set('limit', String(params.limit));
  if (params?.skip)   q.set('skip', String(params.skip));
  const qs = q.toString();
  return apiFetch<WaitlistResponse>(`/waitlist${qs ? '?' + qs : ''}`);
}

export async function addToWaitlist(body: {
  guestName: string;
  phone: string;
  partySize: number;
  seatingPreference?: string;
  notes?: string;
  estimatedWaitMinutes?: number;
}): Promise<WaitlistEntry> {
  return apiFetch<WaitlistEntry>('/waitlist', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateWaitlistStatus(
  id: string,
  status: WaitlistEntry['status'],
  estimatedWaitMinutes?: number,
): Promise<WaitlistEntry> {
  return apiFetch<WaitlistEntry>(`/waitlist/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(estimatedWaitMinutes !== undefined ? { estimatedWaitMinutes } : {}) }),
  });
}

export async function removeFromWaitlist(id: string): Promise<void> {
  await apiFetch<unknown>(`/waitlist/${id}`, { method: 'DELETE' });
}
