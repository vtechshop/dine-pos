import { apiFetch } from './client';

export interface StaffMember {
  _id: string;
  hotelId: string;
  name: string;
  employeeCode: string;
  mobile: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffInput {
  name: string;
  employeeCode: string;
  pin: string;
  mobile?: string;
}

type StaffUpdateInput = Partial<Pick<StaffInput, 'name' | 'mobile' | 'employeeCode'>>;

// ── Cashiers ──────────────────────────────────────────────────────────────────

export const fetchCashiers = (): Promise<StaffMember[]> =>
  apiFetch('/cashiers');

export const createCashier = (data: StaffInput): Promise<StaffMember> =>
  apiFetch('/cashiers', { method: 'POST', body: JSON.stringify(data) });

export const updateCashier = (id: string, data: StaffUpdateInput): Promise<StaffMember> =>
  apiFetch(`/cashiers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const updateCashierPin = (id: string, pin: string): Promise<{ message: string }> =>
  apiFetch(`/cashiers/${id}/pin`, { method: 'PATCH', body: JSON.stringify({ pin }) });

export const toggleCashier = (id: string): Promise<{ isActive: boolean }> =>
  apiFetch(`/cashiers/${id}/toggle`, { method: 'PATCH' });

export const deleteCashier = (id: string): Promise<{ message: string }> =>
  apiFetch(`/cashiers/${id}`, { method: 'DELETE' });

// ── Waiters ───────────────────────────────────────────────────────────────────

export const fetchWaiters = (): Promise<StaffMember[]> =>
  apiFetch('/waiters');

export const createWaiter = (data: StaffInput): Promise<StaffMember> =>
  apiFetch('/waiters', { method: 'POST', body: JSON.stringify(data) });

export const updateWaiter = (id: string, data: StaffUpdateInput): Promise<StaffMember> =>
  apiFetch(`/waiters/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const updateWaiterPin = (id: string, pin: string): Promise<{ message: string }> =>
  apiFetch(`/waiters/${id}/pin`, { method: 'PATCH', body: JSON.stringify({ pin }) });

export const toggleWaiter = (id: string): Promise<{ isActive: boolean }> =>
  apiFetch(`/waiters/${id}/toggle`, { method: 'PATCH' });

export const deleteWaiter = (id: string): Promise<{ message: string }> =>
  apiFetch(`/waiters/${id}`, { method: 'DELETE' });
