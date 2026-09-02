import Razorpay from 'razorpay';
import crypto from 'crypto';
import type {
  PaymentGateway,
  GatewayRuntimeConfig,
  CreatePaymentParams,
  CreatePaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  RefundParams,
  RefundResult,
  PaymentStatusResult,
  SettlementStatusResult,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
} from '../types';

export class RazorpayGateway implements PaymentGateway {
  readonly type = 'razorpay' as const;
  private readonly client: Razorpay;
  private readonly config: GatewayRuntimeConfig;

  constructor(config: GatewayRuntimeConfig) {
    this.config = config;
    // OAuth-connected: Razorpay SDK accepts { oauthToken } in place of key_id/key_secret.
    // Standard: use the hotel's own API key pair from PaymentGatewayConfig.
    if (config.oauthAccessToken) {
      this.client = new Razorpay({ oauthToken: config.oauthAccessToken } as ConstructorParameters<typeof Razorpay>[0]);
    } else {
      this.client = new Razorpay({ key_id: config.apiKey, key_secret: config.apiSecret });
    }
  }

  // ── Create a Razorpay Order (step 1 of checkout flow) ─────────────────────────
  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    // Test bypass: skip live API call when running under the integration test harness.
    // NODE_ENV=test is set by start-test.js; RAZORPAY_TEST_BYPASS gates this branch
    // so it is never reachable in production or staging builds.
    if (process.env.NODE_ENV === 'test' && process.env.RAZORPAY_TEST_BYPASS === 'true') {
      const fakeId = `order_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        gatewayTransactionId: fakeId,
        gatewayOrderId:       fakeId,
        metadata: {
          keyId:         this.config.apiKey,
          orderId:       fakeId,
          amount:        params.amount,
          currency:      params.currency ?? 'INR',
          customerName:  params.customerName  ?? '',
          customerEmail: '',
          customerPhone: '',
          description:   params.description  ?? '',
        },
      };
    }

    // Razorpay receipt max = 40 chars
    const receipt = params.internalTransactionId.slice(0, 40);

    const order = await this.client.orders.create({
      amount:   params.amount,          // paise
      currency: params.currency || 'INR',
      receipt,
      notes: {
        hotelId:               params.hotelId,
        orderId:               params.orderId,
        internalTransactionId: params.internalTransactionId,
        ...(params.description ? { description: params.description.slice(0, 255) } : {}),
      },
    });

    return {
      gatewayTransactionId: order.id,   // Razorpay order id (becomes payment id after capture)
      gatewayOrderId:       order.id,
      metadata: {
        // OAuth: public_token replaces key_id for client-side Checkout.js (web + mobile).
        // Standard: use the hotel's own key_id directly.
        keyId:         this.config.publicToken || this.config.apiKey,
        orderId:       order.id,
        amount:        order.amount,
        currency:      order.currency,
        customerName:  params.customerName  ?? '',
        customerEmail: params.customerEmail ?? '',
        customerPhone: params.customerPhone ?? '',
        description:   params.description   ?? '',
      },
    };
  }

  // ── Verify payment after Razorpay Checkout completes ──────────────────────────
  // params.gatewayTransactionId = razorpay_payment_id
  // params.gatewayOrderId       = razorpay_order_id
  // params.signature            = razorpay_signature
  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const { gatewayTransactionId, gatewayOrderId, signature } = params;

    // Standard configs: verify Razorpay signature locally using key_secret.
    // OAuth configs: key_secret is not available — skip local HMAC.
    // Security is maintained by the authenticated live payments.fetch() below,
    // which uses the OAuth access_token and returns Razorpay's live payment state.
    if (!this.config.oauthAccessToken && signature && gatewayOrderId && gatewayTransactionId) {
      const expected = crypto
        .createHmac('sha256', this.config.apiSecret)
        .update(`${gatewayOrderId}|${gatewayTransactionId}`)
        .digest('hex');

      if (expected !== signature) {
        return {
          success:         false,
          status:          'failed',
          gatewayResponse: { error: 'Signature verification failed', payment_id: gatewayTransactionId },
        };
      }
    }

    // Test bypass: HMAC verified above; skip live fetch in test harness.
    if (process.env.NODE_ENV === 'test' && process.env.RAZORPAY_TEST_BYPASS === 'true') {
      return { success: true, status: 'success', paymentMethod: 'upi', gatewayResponse: { bypass: true } };
    }

    // Fetch live payment status from Razorpay
    const payment = await this.client.payments.fetch(gatewayTransactionId);
    const raw     = payment as unknown as Record<string, unknown>;

    // Cross-check order_id: ties the payment to the expected order.
    // Primary integrity check for OAuth configs (where local HMAC is skipped).
    if (gatewayOrderId && raw.order_id && raw.order_id !== gatewayOrderId) {
      return {
        success:         false,
        status:          'failed',
        gatewayResponse: { error: 'Order ID mismatch — payment does not belong to expected order', payment_id: gatewayTransactionId },
      };
    }

    return {
      success:         payment.status === 'captured',
      status:          this.mapStatus(payment.status),
      paymentMethod:   this.mapMethod(String(raw.method ?? '')),
      gatewayResponse: raw,
    };
  }

  // ── Initiate a refund ─────────────────────────────────────────────────────────
  async initiateRefund(params: RefundParams): Promise<RefundResult> {
    const refund = await this.client.payments.refund(params.gatewayTransactionId, {
      amount: params.amount,  // paise
      speed:  'normal',
      notes:  { reason: params.reason ?? '' },
    });

    return {
      refundId:        refund.id,
      status:          this.mapRefundStatus(refund.status),
      amount:          typeof refund.amount === 'number' ? refund.amount : Number(refund.amount ?? 0),
      gatewayResponse: refund as unknown as Record<string, unknown>,
    };
  }

  // ── Fetch live payment status ─────────────────────────────────────────────────
  async getPaymentStatus(gatewayTransactionId: string): Promise<PaymentStatusResult> {
    const payment = await this.client.payments.fetch(gatewayTransactionId);
    const raw     = payment as unknown as Record<string, unknown>;
    return {
      status:          this.mapStatus(payment.status),
      paymentMethod:   this.mapMethod(String(raw.method ?? '')),
      paidAt:          raw.created_at ? new Date(Number(raw.created_at) * 1000) : undefined,
      gatewayResponse: raw,
    };
  }

  // ── Fetch settlement status ───────────────────────────────────────────────────
  async getSettlementStatus(settlementId: string): Promise<SettlementStatusResult> {
    const s = await this.client.settlements.fetch(settlementId);
    return {
      status:           s.status === 'processed' ? 'settled' : 'pending',
      settledAt:        s.processed_at ? new Date(s.processed_at * 1000) : undefined,
      settlementAmount: s.amount_settled ?? undefined,
      gatewayResponse:  s as unknown as Record<string, unknown>,
    };
  }

  // ── Verify webhook signature ──────────────────────────────────────────────────
  // Uses Razorpay's static validateWebhookSignature utility.
  // Falls back to this.config.webhookSecret if secret is not provided.
  verifyWebhook(payload: string, signature: string, secret: string): boolean {
    const webhookSecret = secret || this.config.webhookSecret;
    if (!webhookSecret || !signature) return false;
    try {
      return Razorpay.validateWebhookSignature(payload, signature, webhookSecret);
    } catch {
      return false;
    }
  }

  // ── Test connection by listing 1 order ────────────────────────────────────────
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.client.orders.all({ count: 1 });
      return { success: true, message: 'Razorpay connection successful. Key ID is valid.' };
    } catch (e: unknown) {
      return { success: false, message: (e as Error).message ?? 'Connection failed' };
    }
  }

  // ── Status mappers ────────────────────────────────────────────────────────────

  private mapStatus(status: string): PaymentStatus {
    switch (status) {
      case 'captured':   return 'success';
      case 'failed':     return 'failed';
      case 'created':    return 'pending';
      case 'authorized': return 'processing';
      case 'refunded':   return 'refunded';
      default:           return 'pending';
    }
  }

  private mapMethod(method: string): PaymentMethod {
    switch (method) {
      case 'card':       return 'card';
      case 'netbanking': return 'netbanking';
      case 'wallet':     return 'wallet';
      case 'emi':        return 'emi';
      case 'upi':        return 'upi';
      default:           return 'other';
    }
  }

  private mapRefundStatus(status: string): RefundStatus {
    return status === 'processed' ? 'full' : 'pending';
  }
}
