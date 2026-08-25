/**
 * MSG91Provider — WhatsApp + SMS delivery via MSG91.
 *
 * WhatsApp: POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/
 *   - Requires pre-approved Meta template name + language + namespace
 *   - Variables: body_1, body_2, ... (positional)
 *   - Returns batch-level request_id; per-message WAMIDs arrive via webhook
 *
 * SMS: POST https://api.msg91.com/api/v2/sendsms
 *   - Free-text with personalized messages per recipient in `sms[]` array
 *   - Returns request ID in `message` field
 *   - India DLT compliance is the operator's responsibility (use registered sender ID)
 *
 * Webhook auth: MSG91 does NOT sign payloads. Configure a custom header
 * (x-dinepos-secret) in MSG91 dashboard. verifyWebhookHeader() compares it.
 *
 * Batching: recipients are chunked at CHUNK_SIZE per API call.
 * Each chunk gets its own request_id for webhook-to-message correlation.
 */

import https from 'https';
import http  from 'http';
import type {
  MessagingProvider, MessageRecipient, ProviderResult,
  PerRecipientResult, WaTemplateOptions,
} from '../messagingProvider';
import { logger } from '../../utils/logger';

const WA_ENDPOINT  = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';
const SMS_ENDPOINT = 'https://api.msg91.com/api/v2/sendsms';
const CHUNK_SIZE   = 50;
const TIMEOUT_MS   = 12_000;

export class Msg91Provider implements MessagingProvider {
  readonly name = 'msg91';

  constructor(
    private readonly apiKey:           string,   // decrypted MSG91 authkey
    private readonly integratedNumber: string,   // WABA phone with country code
    private readonly senderId:         string,   // DLT-registered SMS sender ID
    private readonly waNamespace:      string,   // WA template namespace (may be '')
  ) {}

  verifyWebhookHeader(headerValue: string, storedSecret: string): boolean {
    return !!storedSecret && headerValue === storedSecret;
  }

  async sendMessages(
    campaignId: string,
    channel:    'whatsapp' | 'sms',
    recipients: MessageRecipient[],
    waTemplate?: WaTemplateOptions,
  ): Promise<ProviderResult> {
    if (channel === 'whatsapp') {
      return this._sendWhatsApp(campaignId, recipients, waTemplate);
    }
    return this._sendSms(campaignId, recipients);
  }

  // ── WhatsApp ────────────────────────────────────────────────────────────────

  private async _sendWhatsApp(
    campaignId: string,
    recipients: MessageRecipient[],
    waTemplate?: WaTemplateOptions,
  ): Promise<ProviderResult> {
    if (!waTemplate?.templateName) {
      return {
        status:      'failed',
        sentCount:   0,
        failedCount: recipients.length,
        reason:      'WhatsApp template name is required. Set it when creating the campaign.',
        recipients:  [],
      };
    }

    const allResults: PerRecipientResult[] = [];
    const chunks = _chunk(recipients, CHUNK_SIZE);

    for (const batch of chunks) {
      const toAndComponents = batch.map(r => ({
        to:         [r.phone],
        components: _buildComponents(r.vars ?? {}, waTemplate.templateVars),
      }));

      const payload = {
        integrated_number: this.integratedNumber,
        content_type:      'template',
        payload: {
          messaging_product: 'whatsapp',
          type:              'template',
          template: {
            name:      waTemplate.templateName,
            language:  { code: waTemplate.templateLanguage || 'en', policy: 'deterministic' },
            namespace: waTemplate.templateNamespace ?? this.waNamespace ?? '',
            to_and_components: toAndComponents,
          },
        },
      };

      try {
        const response = await _postJson(WA_ENDPOINT, payload, { authkey: this.apiKey });

        if (response.hasError || response.status !== 'success') {
          const reason = String(response.data ?? response.message ?? 'MSG91 WA API error');
          logger.warn('[Msg91] WA batch failed', { campaignId, reason });
          batch.forEach(r => allResults.push({
            phone: r.phone, customerId: r.customerId,
            status: 'failed', failureReason: reason,
          }));
        } else {
          const requestId: string = response.request_id ?? '';
          batch.forEach(r => allResults.push({
            phone: r.phone, customerId: r.customerId,
            status: 'sent', requestId,
          }));
        }
      } catch (err) {
        const reason = String(err);
        logger.warn('[Msg91] WA batch threw', { campaignId, reason });
        batch.forEach(r => allResults.push({
          phone: r.phone, customerId: r.customerId,
          status: 'failed', failureReason: reason,
        }));
      }
    }

    return _buildResult(allResults);
  }

  // ── SMS ─────────────────────────────────────────────────────────────────────

  private async _sendSms(
    campaignId: string,
    recipients: MessageRecipient[],
  ): Promise<ProviderResult> {
    const allResults: PerRecipientResult[] = [];
    const chunks = _chunk(recipients, CHUNK_SIZE);

    for (const batch of chunks) {
      const payload = {
        sender:  this.senderId,
        route:   '4',   // transactional route for India
        country: '91',
        sms:     batch.map(r => ({ message: r.message, to: [r.phone] })),
      };

      try {
        const response = await _postJson(SMS_ENDPOINT, payload, { authkey: this.apiKey });

        if (response.type !== 'success') {
          const reason = String(response.message ?? 'MSG91 SMS API error');
          logger.warn('[Msg91] SMS batch failed', { campaignId, reason });
          batch.forEach(r => allResults.push({
            phone: r.phone, customerId: r.customerId,
            status: 'failed', failureReason: reason,
          }));
        } else {
          // v2 API: the `message` field IS the batch-level request ID
          const requestId: string = String(response.message ?? '');
          batch.forEach(r => allResults.push({
            phone: r.phone, customerId: r.customerId,
            status: 'sent', requestId,
          }));
        }
      } catch (err) {
        const reason = String(err);
        logger.warn('[Msg91] SMS batch threw', { campaignId, reason });
        batch.forEach(r => allResults.push({
          phone: r.phone, customerId: r.customerId,
          status: 'failed', failureReason: reason,
        }));
      }
    }

    return _buildResult(allResults);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function _buildComponents(
  vars: Record<string, string>,
  templateVars: string[],
): Record<string, { type: 'text'; value: string }> {
  const components: Record<string, { type: 'text'; value: string }> = {};
  templateVars.forEach((varName, idx) => {
    components[`body_${idx + 1}`] = { type: 'text', value: vars[varName] ?? '' };
  });
  return components;
}

function _buildResult(recipients: PerRecipientResult[]): ProviderResult {
  const sentCount   = recipients.filter(r => r.status === 'sent').length;
  const failedCount = recipients.filter(r => r.status === 'failed').length;
  const status =
    failedCount === 0 ? 'sent' :
    sentCount   === 0 ? 'failed' : 'partial';
  return { status, sentCount, failedCount, recipients };
}

function _postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const data   = JSON.stringify(body);
    const parsed = new URL(url);
    const opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    };

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(opts, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`Non-JSON response (${res.statusCode}): ${raw.slice(0, 200)}`)); }
      });
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`MSG91 request timed out after ${TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
