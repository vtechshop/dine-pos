import { apiFetch } from './client';
import type { Reservation } from '../types';

export interface ReservationsResponse {
  reservations: Reservation[];
  total: number;
}

export async function fetchReservations(date?: string): Promise<ReservationsResponse> {
  const q = date ? `?date=${date}` : '';
  return apiFetch<ReservationsResponse>(`/reservations${q}`);
}

export async function createReservation(body: {
  customerName: string;
  phone: string;
  partySize: number;
  date: string;
  time: string;
  notes?: string;
  tableNumber?: number | null;
}): Promise<Reservation> {
  return apiFetch<Reservation>('/reservations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateReservation(
  id: string,
  body: Partial<{
    customerName: string;
    phone: string;
    partySize: number;
    date: string;
    time: string;
    notes: string;
    tableNumber: number | null;
  }>,
): Promise<Reservation> {
  return apiFetch<Reservation>(`/reservations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function updateReservationStatus(
  id: string,
  status: Reservation['status'],
): Promise<Reservation> {
  return apiFetch<Reservation>(`/reservations/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function deleteReservation(id: string): Promise<void> {
  await apiFetch<unknown>(`/reservations/${id}`, { method: 'DELETE' });
}
