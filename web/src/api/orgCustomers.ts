import { apiFetch } from './client';

export interface OrgCustomer {
  _id: string;
  orgHotelId: string;
  canonicalPhone: string | null;
  canonicalEmail: string | null;
  displayName: string;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface LinkedProfile {
  _id: string;
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  hotelId: string;
  loyaltyBalance: number;
  visitCount: number;
  lastVisitAt: string | null;
  status: string;
}

export async function searchOrgCustomers(params: {
  phone?: string;
  email?: string;
  page?: number;
  limit?: number;
}): Promise<{ customers: OrgCustomer[]; total: number; page: number; limit: number }> {
  const qs = new URLSearchParams();
  if (params.phone) qs.set('phone', params.phone);
  if (params.email) qs.set('email', params.email);
  if (params.page)  qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  return apiFetch(`/api/org-customers?${qs.toString()}`);
}

export async function getOrgCustomer(id: string): Promise<{
  orgCustomer: OrgCustomer;
  linkedProfiles: LinkedProfile[];
}> {
  return apiFetch(`/api/org-customers/${id}`);
}

export async function getOrgCustomerCandidates(profileId: string): Promise<{
  alreadyLinked: boolean;
  orgCustomerId?: string;
  candidates: OrgCustomer[];
}> {
  return apiFetch(`/api/org-customers/candidates/${profileId}`);
}

export async function createOrgCustomer(data: {
  displayName?: string;
  phone?: string;
  email?: string;
}): Promise<{ orgCustomer: OrgCustomer }> {
  return apiFetch('/api/org-customers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function linkProfileToOrgCustomer(
  orgCustomerId: string,
  profileId: string,
): Promise<{ success: boolean; orgCustomerId: string; profileId: string }> {
  return apiFetch(`/api/org-customers/${orgCustomerId}/link`, {
    method: 'POST',
    body: JSON.stringify({ profileId }),
  });
}

export async function unlinkProfileFromOrgCustomer(
  orgCustomerId: string,
  profileId: string,
): Promise<{ success: boolean }> {
  return apiFetch(`/api/org-customers/${orgCustomerId}/links/${profileId}`, {
    method: 'DELETE',
  });
}
