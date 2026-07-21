import { apiFetch } from './client';
import type { SessionBill, Guest, PaymentMethod, PrintJob } from '../types';

export interface SplitDetails {
  cash: number;
  card: number;
  upi: number;
}

export interface BillGuestPayload {
  action: 'bill';
  paymentMethod: PaymentMethod;
  splitDetails?: SplitDetails;
  paidAmount?: number;
  redeemPoints?: number;
}

export async function fetchSessionBill(sessionId: string): Promise<SessionBill> {
  return apiFetch<SessionBill>(`/sessions/${sessionId}/bill`);
}

export async function billGuest(
  sessionId: string,
  guestId: string,
  payload: BillGuestPayload,
): Promise<{ guest: Guest }> {
  return apiFetch<{ guest: Guest }>(`/sessions/${sessionId}/guests/${guestId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function bulkBillAndClose(
  sessionId: string,
  paymentMethod: PaymentMethod,
  splitDetails?: SplitDetails,
): Promise<void> {
  await apiFetch<void>(`/sessions/${sessionId}/close`, {
    method: 'PATCH',
    body: JSON.stringify({ bulkBill: true, paymentMethod, splitDetails }),
  });
}

export async function mergeGuests(
  sessionId: string,
  sourceGuestId: string,
  targetGuestId: string,
  reason?: string,
): Promise<{ target: Guest }> {
  return apiFetch<{ target: Guest }>(`/sessions/${sessionId}/guests/merge`, {
    method: 'POST',
    body: JSON.stringify({ sourceGuestId, targetGuestId, reason }),
  });
}

export async function splitGuest(
  sessionId: string,
  sourceGuestId: string,
  orderIds: string[],
): Promise<{ newGuest: Guest; source: Guest }> {
  return apiFetch<{ newGuest: Guest; source: Guest }>(`/sessions/${sessionId}/guests/split`, {
    method: 'POST',
    body: JSON.stringify({ sourceGuestId, orderIds }),
  });
}

export async function transferGuest(
  sessionId: string,
  guestId: string,
  targetSessionId: string,
): Promise<{ guest: Guest }> {
  return apiFetch<{ guest: Guest }>(`/sessions/${sessionId}/guests/${guestId}/transfer`, {
    method: 'PATCH',
    body: JSON.stringify({ targetSessionId }),
  });
}

export async function markGuestLeft(
  sessionId: string,
  guestId: string,
): Promise<{ guest: Guest }> {
  return apiFetch<{ guest: Guest }>(`/sessions/${sessionId}/guests/${guestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'left' }),
  });
}

export async function fetchReceiptJobs(): Promise<PrintJob[]> {
  const res = await apiFetch<{ jobs: PrintJob[] }>('/print-jobs?jobType=receipt');
  return res.jobs;
}

export async function reprintJob(jobId: string): Promise<void> {
  await apiFetch<void>(`/print-jobs/${jobId}/reprint`, { method: 'POST' });
}
