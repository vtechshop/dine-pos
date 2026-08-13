/**
 * MessagingProvider — channel-agnostic interface for WhatsApp/SMS delivery.
 *
 * Currently returns a NoOp stub (no_provider). When a real provider is
 * configured, implement MessagingProvider and return it from
 * getMessagingProvider() based on the appropriate env vars.
 *
 * Integration points:
 *   - WhatsApp Business Cloud API: WABA_TOKEN, WABA_PHONE_ID
 *   - MSG91 (WhatsApp + SMS):      MSG91_KEY, MSG91_SENDER
 *   - Twilio:                      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 */

export interface MessageRecipient {
  phone:      string;
  message:    string;
  customerId?: string;
}

export interface ProviderResult {
  status:      'no_provider' | 'sent' | 'failed';
  sentCount:   number;
  failedCount: number;
  reason?:     string;
}

export interface MessagingProvider {
  readonly name: string;
  sendMessages(
    campaignId: string,
    channel:    'whatsapp' | 'sms',
    recipients: MessageRecipient[],
  ): Promise<ProviderResult>;
}

// ── NoOp implementation (default until a provider is wired in) ───────────────

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
      reason:      'No WhatsApp/SMS provider configured. Configure a provider in Settings → Integrations.',
    };
  }
}

const _noOp = new NoOpProvider();

/**
 * Returns the active messaging provider for the given channel.
 * Add provider implementations here as environment credentials are configured.
 */
export function getMessagingProvider(_channel: 'whatsapp' | 'sms'): MessagingProvider {
  // if (process.env.WABA_TOKEN && _channel === 'whatsapp') return new WhatsAppBusinessProvider();
  // if (process.env.MSG91_KEY)                             return new Msg91Provider();
  return _noOp;
}
