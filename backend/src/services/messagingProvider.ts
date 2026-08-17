/**
 * MessagingProvider — hotel-scoped, channel-agnostic interface for WhatsApp/SMS delivery.
 *
 * getMessagingProvider() is async and hotel-scoped: it looks up each hotel's
 * MessagingProviderConfig in the database. Callers must await it.
 *
 * Webhook authentication: MSG91 does NOT sign webhook payloads with HMAC.
 * Instead, operators configure a custom header (x-dinepos-secret) in the MSG91
 * dashboard. The provider's verifyWebhookHeader() method compares that header
 * value against the stored webhookSecretEnc.
 */

import mongoose from 'mongoose';
import MessagingProviderConfig from '../models/MessagingProviderConfig';
import { decrypt } from '../utils/encryption';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface MessageRecipient {
  phone:       string;
  /** Rendered message text — used as-is for SMS */
  message:     string;
  customerId?: string;
  /** Per-recipient variable values for WA template substitution */
  vars?:       Record<string, string>;
}

export interface PerRecipientResult {
  phone:              string;
  customerId?:        string;
  status:             'sent' | 'failed';
  /** Batch-level request ID from MSG91 — shared by all recipients in a chunk */
  requestId?:         string;
  /** Per-message WAMID — NOT available at send time; populated from webhook */
  providerMessageId?: string;
  failureReason?:     string;
}

export interface ProviderResult {
  status:      'no_provider' | 'sent' | 'partial' | 'failed';
  sentCount:   number;
  failedCount: number;
  reason?:     string;
  recipients:  PerRecipientResult[];
}

export interface WaTemplateOptions {
  templateName:      string;
  templateLanguage:  string;
  templateNamespace: string;
  /** Ordered variable names: index 0 → body_1, index 1 → body_2, … */
  templateVars:      string[];
}

export interface MessagingProvider {
  readonly name: string;
  sendMessages(
    campaignId: string,
    channel:    'whatsapp' | 'sms',
    recipients: MessageRecipient[],
    waTemplate?: WaTemplateOptions,
  ): Promise<ProviderResult>;
  /** MSG91 auth: compare x-dinepos-secret header value against stored secret */
  verifyWebhookHeader(headerValue: string, storedSecret: string): boolean;
}

// ── NoOp (default when no provider is configured) ────────────────────────────

class NoOpProvider implements MessagingProvider {
  readonly name = 'none';

  async sendMessages(
    _campaignId: string,
    _channel:    'whatsapp' | 'sms',
    recipients:  MessageRecipient[],
  ): Promise<ProviderResult> {
    return {
      status:      'no_provider',
      sentCount:   0,
      failedCount: recipients.length,
      reason:      'No messaging provider configured. Add MSG91 credentials in Settings → Integrations.',
      recipients:  [],
    };
  }

  verifyWebhookHeader(_headerValue: string, _storedSecret: string): boolean {
    return false;
  }
}

const _noOp = new NoOpProvider();

// ── Hotel-scoped provider resolution ─────────────────────────────────────────

export async function getMessagingProvider(
  hotelId: string,
  channel: 'whatsapp' | 'sms',
): Promise<MessagingProvider> {
  try {
    const cfg = await MessagingProviderConfig.findOne({
      hotelId:  new mongoose.Types.ObjectId(hotelId),
      isActive: true,
      isDeleted: false,
    }).lean();

    if (!cfg || !cfg.apiKeyEnc) return _noOp;

    // Verify this config supports the requested channel
    if (cfg.channel !== 'both' && cfg.channel !== channel) return _noOp;

    const apiKey = decrypt(cfg.apiKeyEnc);

    if (cfg.providerType === 'msg91') {
      // Lazy import to avoid loading provider code when no provider is configured
      const { Msg91Provider } = await import('./providers/Msg91Provider');
      return new Msg91Provider(apiKey, cfg.integratedNumber, cfg.senderId, cfg.waNamespace);
    }

    return _noOp;
  } catch {
    return _noOp;
  }
}
