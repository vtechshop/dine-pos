import { apiFetch, getStoredToken } from './client';

const _API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5000/api';
import type {
  CustomerProfile,
  LoyaltyConfig,
  CustomerSearchResult,
  CustomerTransactionsResult,
  LoyaltyStats,
  LoyaltyActivityEntry,
  CustomerSegment,
} from '../types/customers';

export async function fetchLoyaltyConfig(): Promise<{ config: LoyaltyConfig }> {
  return apiFetch('/loyalty/config');
}

export async function searchCustomers(params?: {
  phone?: string;
  name?: string;
  page?: number;
  limit?: number;
}): Promise<CustomerSearchResult> {
  const qs = new URLSearchParams();
  if (params?.phone) qs.set('phone', params.phone);
  if (params?.name)  qs.set('name',  params.name);
  if (params?.page)  qs.set('page',  String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return apiFetch(`/loyalty/customers${q ? `?${q}` : ''}`);
}

export async function fetchCustomer(customerId: string): Promise<{ customer: CustomerProfile }> {
  return apiFetch(`/loyalty/customers/${customerId}`);
}

export async function fetchCustomerTransactions(
  customerId: string,
  params?: { page?: number; limit?: number },
): Promise<CustomerTransactionsResult> {
  const qs = new URLSearchParams();
  if (params?.page)  qs.set('page',  String(params.page));
  if (params?.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return apiFetch(`/loyalty/customers/${customerId}/transactions${q ? `?${q}` : ''}`);
}

// Backend endpoint required: POST /loyalty/customers
// Body: { name, phone, email?, birthday? }
// Returns: { customer: CustomerProfile }
export async function createCustomer(body: {
  name: string;
  phone: string;
  email?: string;
  birthday?: string;
}): Promise<{ customer: CustomerProfile }> {
  return apiFetch('/loyalty/customers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateLoyaltyConfig(
  body: Partial<LoyaltyConfig>,
): Promise<{ config: LoyaltyConfig }> {
  return apiFetch('/loyalty/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function adjustPoints(
  customerId: string,
  body: { points: number; remarks: string },
): Promise<{ newBalance: number; customerId: string; customer: CustomerProfile }> {
  return apiFetch(`/loyalty/customers/${customerId}/adjust`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateCustomer(
  customerId: string,
  body: Partial<Pick<CustomerProfile, 'name' | 'email' | 'birthday' | 'anniversary' | 'tags' | 'notes' | 'marketingOptIn' | 'gstCustomer' | 'companyName' | 'gstin'>>,
): Promise<{ customer: CustomerProfile }> {
  return apiFetch(`/loyalty/customers/${customerId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function setCustomerStatus(
  customerId: string,
  status: 'active' | 'blocked',
): Promise<{ customer: { customerId: string; name: string; status: string } }> {
  return apiFetch(`/loyalty/customers/${customerId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function fetchLoyaltyStats(): Promise<LoyaltyStats> {
  return apiFetch('/loyalty/stats');
}

export async function fetchLoyaltyActivity(
  page = 1, limit = 20,
): Promise<{ transactions: LoyaltyActivityEntry[]; total: number; page: number; limit: number }> {
  return apiFetch(`/loyalty/activity?page=${page}&limit=${limit}`);
}

export async function searchCustomersBySegment(params: {
  segment?: CustomerSegment | string;
  phone?: string;
  name?: string;
  page?: number;
  limit?: number;
  export?: boolean;
}): Promise<CustomerSearchResult> {
  const qs = new URLSearchParams();
  if (params.segment) qs.set('segment', params.segment);
  if (params.phone)   qs.set('phone',   params.phone);
  if (params.name)    qs.set('name',    params.name);
  if (params.page)    qs.set('page',    String(params.page));
  if (params.limit)   qs.set('limit',   String(params.limit));
  if (params.export)  qs.set('export',  'true');
  return apiFetch(`/loyalty/customers?${qs}`);
}

/**
 * Streams a server-generated CSV of customers matching the given filter and
 * triggers a browser download. Uses the streaming /export endpoint so there is
 * no record-count ceiling.
 *
 * Security: auth token is always read from localStorage; hotelId is never sent
 * from the client.
 */
export async function downloadCustomerExport(params: {
  segment?: string;
  phone?:   string;
  name?:    string;
}): Promise<void> {
  const token = getStoredToken();
  const qs    = new URLSearchParams();
  if (params.segment) qs.set('segment', params.segment);
  if (params.phone)   qs.set('phone',   params.phone);
  if (params.name)    qs.set('name',    params.name);

  const res = await fetch(`${_API_BASE}/loyalty/customers/export?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, string>);
    throw new Error((body as { message?: string }).message ?? `Export failed: HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;

  const cd    = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  a.download  = match?.[1] ?? 'customers-export.csv';

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
