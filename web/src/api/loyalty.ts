import { apiFetch } from './client';
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
  segment?: CustomerSegment;
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
