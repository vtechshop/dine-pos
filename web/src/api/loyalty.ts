import { apiFetch } from './client';
import type {
  CustomerProfile,
  LoyaltyConfig,
  CustomerSearchResult,
  CustomerTransactionsResult,
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

export async function adjustPoints(
  customerId: string,
  body: { points: number; remarks: string },
): Promise<{ newBalance: number; customerId: string }> {
  return apiFetch(`/loyalty/customers/${customerId}/adjust`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
