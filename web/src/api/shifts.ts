const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/shifts`
  : 'http://localhost:5000/api/shifts';

async function shiftFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('pos_token');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ShiftMovementData {
  _id: string;
  type: 'cash_in' | 'cash_out';
  amount: number;
  reason: string;
  cashierName: string;
  timestamp: string;
}

export interface ShiftData {
  _id: string;
  hotelId: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  openingCash: number;
  openingNote: string;
  status: 'open' | 'closed';
  cashSales: number;
  upiSales: number;
  cardSales: number;
  otherSales: number;
  totalSales: number;
  totalOrders: number;
  cashIn: number;
  cashOut: number;
  closedAt: string | null;
  closingNote: string;
  actualCash: number | null;
  expectedCash: number | null;
  difference: number | null;
  movements: ShiftMovementData[];
  createdAt: string;
  updatedAt: string;
}

export function apiOpenShift(payload: {
  cashierName: string;
  cashierId: string;
  openedAt: string;
  openingCash: number;
  openingNote: string;
}): Promise<{ shift: ShiftData }> {
  return shiftFetch('/open', { method: 'POST', body: JSON.stringify(payload) });
}

export function apiGetActiveShift(): Promise<{ shift: ShiftData | null }> {
  return shiftFetch('/active');
}

export function apiCloseShift(
  id: string,
  actualCash: number,
  closingNote: string,
): Promise<{ shift: ShiftData }> {
  return shiftFetch(`/${id}/close`, {
    method: 'POST',
    body: JSON.stringify({ actualCash, closingNote }),
  });
}

export function apiAddMovement(
  shiftId: string,
  payload: { type: 'cash_in' | 'cash_out'; amount: number; reason: string; cashierName: string },
): Promise<{ movement: ShiftMovementData; shift: ShiftData }> {
  return shiftFetch(`/${shiftId}/movements`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function apiGetShiftHistory(
  page = 1,
): Promise<{ shifts: ShiftData[]; total: number; page: number; pages: number }> {
  return shiftFetch(`?page=${page}`);
}

export function apiGetShift(id: string): Promise<{ shift: ShiftData }> {
  return shiftFetch(`/${id}`);
}

export interface ShiftStats {
  totalOrders: number;
  totalSales: number;
  cashSales: number;
  upiSales: number;
  cardSales: number;
}

export function apiGetActiveShiftStats(): Promise<ShiftStats> {
  return shiftFetch('/active/stats');
}
