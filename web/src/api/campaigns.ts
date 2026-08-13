import { apiFetch } from './client';
import type { Campaign, CampaignAudience } from '../types/customers';

export interface CampaignListResult {
  campaigns: Campaign[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchCampaigns(params?: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<CampaignListResult> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.page)   qs.set('page',   String(params.page));
  if (params?.limit)  qs.set('limit',  String(params.limit));
  return apiFetch(`/campaigns?${qs}`);
}

export async function createCampaign(body: {
  name: string;
  channel: 'whatsapp' | 'sms';
  audience: CampaignAudience;
  customAudience?: string[];
  messageTemplate: string;
  scheduledAt?: string | null;  // ISO string, must be a future datetime if provided
}): Promise<{ campaign: Campaign }> {
  return apiFetch('/campaigns', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchCampaign(id: string): Promise<{ campaign: Campaign }> {
  return apiFetch(`/campaigns/${id}`);
}

export async function updateCampaign(
  id: string,
  body: Partial<Pick<Campaign, 'name' | 'messageTemplate' | 'scheduledAt' | 'audience'>>,
): Promise<{ campaign: Campaign }> {
  return apiFetch(`/campaigns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function sendCampaign(id: string): Promise<{
  status: 'no_provider' | 'sent';
  message: string;
  campaign: { _id: string; name: string; channel: string; recipientCount: number };
}> {
  return apiFetch(`/campaigns/${id}/send`, { method: 'POST' });
}

export async function cancelCampaign(id: string): Promise<{ message: string }> {
  return apiFetch(`/campaigns/${id}`, { method: 'DELETE' });
}
