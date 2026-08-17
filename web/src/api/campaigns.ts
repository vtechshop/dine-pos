import { apiFetch } from './client';
import type { Campaign, CampaignAudience } from '../types/customers';

export interface CampaignListResult {
  campaigns: Campaign[];
  total:     number;
  page:      number;
  limit:     number;
}

export async function fetchCampaigns(params?: {
  status?: string;
  page?:   number;
  limit?:  number;
}): Promise<CampaignListResult> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.page)   qs.set('page',   String(params.page));
  if (params?.limit)  qs.set('limit',  String(params.limit));
  return apiFetch(`/campaigns?${qs}`);
}

export async function createCampaign(body: {
  name:                string;
  channel:             'whatsapp' | 'sms';
  audience:            CampaignAudience;
  customAudience?:     string[];
  messageTemplate:     string;
  scheduledAt?:        string | null;
  waTemplateName?:     string | null;
  waTemplateLanguage?: string;
  waTemplateNamespace?: string;
  waTemplateVars?:     string[];
}): Promise<{ campaign: Campaign }> {
  return apiFetch('/campaigns', {
    method: 'POST',
    body:   JSON.stringify(body),
  });
}

export async function fetchCampaign(id: string): Promise<{ campaign: Campaign }> {
  return apiFetch(`/campaigns/${id}`);
}

export async function sendCampaign(id: string): Promise<{
  status:   'dispatching' | 'no_provider' | 'no_wa_template' | 'sent';
  message:  string;
  campaign?: { _id: string; name: string; channel: string; recipientCount: number; eligibleCount?: number };
}> {
  return apiFetch(`/campaigns/${id}/send`, { method: 'POST' });
}

export async function fetchProviderStatus(): Promise<{
  configured:   { whatsapp: boolean; sms: boolean };
  providerType: string | null;
}> {
  return apiFetch('/campaigns/provider-status');
}

export async function cancelCampaign(id: string): Promise<{ message: string }> {
  return apiFetch(`/campaigns/${id}`, { method: 'DELETE' });
}

export async function duplicateCampaign(id: string): Promise<{ campaign: Campaign }> {
  return apiFetch(`/campaigns/${id}/duplicate`, { method: 'POST' });
}

export async function testSendCampaign(
  id:   string,
  body: { phone: string },
): Promise<{ status: 'sent' | 'failed' | 'no_provider' | 'no_wa_template'; message: string }> {
  return apiFetch(`/campaigns/${id}/test-send`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
}

export type CampaignMessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface CampaignMessageRecord {
  _id:               string;
  campaignId:        string;
  hotelId:           string;
  customerId:        string | null;
  phone:             string;
  channel:           'whatsapp' | 'sms';
  provider:          string;
  requestId:         string | null;
  providerMessageId: string | null;
  status:            CampaignMessageStatus;
  failureReason:     string;
  queuedAt:          string;
  sentAt:            string | null;
  deliveredAt:       string | null;
  readAt:            string | null;
  failedAt:          string | null;
}

export interface CampaignMessageStats {
  total:     number;
  queued:    number;
  sent:      number;
  delivered: number;
  read:      number;
  failed:    number;
}

export interface CampaignMessagesResult {
  stats:    CampaignMessageStats;
  messages: CampaignMessageRecord[];
  total:    number;
  page:     number;
  limit:    number;
}

export async function fetchCampaignMessages(
  id:      string,
  params?: { page?: number; limit?: number; status?: CampaignMessageStatus },
): Promise<CampaignMessagesResult> {
  const qs = new URLSearchParams();
  if (params?.page)   qs.set('page',   String(params.page));
  if (params?.limit)  qs.set('limit',  String(params.limit));
  if (params?.status) qs.set('status', params.status);
  return apiFetch(`/campaigns/${id}/messages?${qs}`);
}

export interface UpdateCampaignBody {
  name?:                string;
  messageTemplate?:     string;
  audience?:            CampaignAudience;
  customAudience?:      string[];
  scheduledAt?:         string | null;
  waTemplateName?:      string | null;
  waTemplateLanguage?:  string;
  waTemplateNamespace?: string;
  waTemplateVars?:      string[];
}

export async function updateCampaign(
  id:   string,
  body: UpdateCampaignBody,
): Promise<{ campaign: Campaign }> {
  return apiFetch(`/campaigns/${id}`, {
    method: 'PATCH',
    body:   JSON.stringify(body),
  });
}

export async function fetchAudienceCount(
  audience: CampaignAudience,
): Promise<{ count: number; eligibleCount: number }> {
  const qs = new URLSearchParams({ audience });
  return apiFetch(`/campaigns/audience-count?${qs}`);
}
