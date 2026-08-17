import { apiFetch } from './client';

export type MessagingProviderType = 'msg91';
export type MessagingChannel      = 'whatsapp' | 'sms' | 'both';

export interface MessagingProviderConfig {
  _id:             string;
  hotelId:         string;
  providerType:    MessagingProviderType;
  channel:         MessagingChannel;
  /** true when an API key is stored — the key itself is never returned */
  hasApiKey:       boolean;
  /** WABA phone number with country code — not a secret */
  integratedNumber: string;
  /** DLT-registered SMS sender ID — not a secret */
  senderId:        string;
  /** WA template namespace — may be empty for Cloud API WABA accounts */
  waNamespace:     string;
  /** true when a webhook secret is stored — the secret itself is never returned */
  hasWebhookSecret: boolean;
  isActive:        boolean;
  testResult?: {
    lastTestedAt: string;
    success:      boolean;
    message:      string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SaveMessagingProviderBody {
  providerType:     MessagingProviderType;
  channel:          MessagingChannel;
  /** Write-only. Omit to keep the existing stored key. */
  apiKey?:          string;
  integratedNumber?: string;
  senderId?:         string;
  waNamespace?:      string;
  /** Write-only. Omit to keep the existing stored secret. */
  webhookSecret?:    string;
}

export async function fetchMessagingProvider(): Promise<{ config: MessagingProviderConfig | null }> {
  return apiFetch('/messaging-providers');
}

export async function saveMessagingProvider(
  body: SaveMessagingProviderBody,
): Promise<{ config: MessagingProviderConfig }> {
  return apiFetch('/messaging-providers', {
    method: 'POST',
    body:   JSON.stringify(body),
  });
}

export async function testMessagingProvider(
  id: string,
): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/messaging-providers/${id}/test`, { method: 'POST' });
}

export async function deleteMessagingProvider(
  id: string,
): Promise<{ message: string }> {
  return apiFetch(`/messaging-providers/${id}`, { method: 'DELETE' });
}
