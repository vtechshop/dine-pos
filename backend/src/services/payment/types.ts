// ── Shared enums ──────────────────────────────────────────────────────────────

export type GatewayType = 'razorpay' | 'cashfree' | 'phonepe' | 'payu' | 'paytm' | 'bharatpe';
export type GatewayEnvironment = 'sandbox' | 'live';
export type PaymentStatus = 'pending' | 'processing' | 'success' | 'failed' | 'cancelled' | 'refunded' | 'partial_refunded';
export type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet' | 'emi' | 'qr' | 'other';
export type RefundStatus = 'none' | 'pending' | 'partial' | 'full';
export type SettlementStatus = 'pending' | 'settled' | 'on_hold';

// ── Params & Results ──────────────────────────────────────────────────────────

export interface CreatePaymentParams {
  amount:                number;   // in paise (e.g. 10000 = ₹100.00)
  currency:              string;   // 'INR'
  orderId:               string;   // internal order _id
  hotelId:               string;
  internalTransactionId: string;   // pre-generated internal TX ID
  customerName?:         string;
  customerEmail?:        string;
  customerPhone?:        string;
  description?:          string;
  callbackUrl?:          string;
  webhookUrl?:           string;
  metadata?:             Record<string, unknown>;
}

export interface CreatePaymentResult {
  gatewayTransactionId: string;
  gatewayOrderId?:      string;
  paymentLink?:         string;
  qrCode?:              string;
  metadata:             Record<string, unknown>;
}

export interface VerifyPaymentParams {
  gatewayTransactionId: string;
  gatewayOrderId?:      string;
  signature?:           string;
  rawPayload?:          string;
}

export interface VerifyPaymentResult {
  success:        boolean;
  status:         PaymentStatus;
  paymentMethod?: PaymentMethod;
  gatewayResponse: Record<string, unknown>;
}

export interface RefundParams {
  gatewayTransactionId: string;
  amount:               number;   // in paise
  reason?:              string;
  notes?:               string;
}

export interface RefundResult {
  refundId:        string;
  status:          RefundStatus;
  amount:          number;
  gatewayResponse: Record<string, unknown>;
}

export interface PaymentStatusResult {
  status:          PaymentStatus;
  paymentMethod?:  PaymentMethod;
  paidAt?:         Date;
  gatewayResponse: Record<string, unknown>;
}

export interface SettlementStatusResult {
  status:            SettlementStatus;
  settledAt?:        Date;
  settlementAmount?: number;
  gatewayResponse:   Record<string, unknown>;
}

// ── Gateway Interface — every provider must implement this ─────────────────────

export interface PaymentGateway {
  readonly type: GatewayType;

  createPayment(params: CreatePaymentParams):              Promise<CreatePaymentResult>;
  verifyPayment(params: VerifyPaymentParams):              Promise<VerifyPaymentResult>;
  initiateRefund(params: RefundParams):                    Promise<RefundResult>;
  getPaymentStatus(gatewayTransactionId: string):          Promise<PaymentStatusResult>;
  getSettlementStatus(settlementId: string):               Promise<SettlementStatusResult>;
  verifyWebhook(payload: string, signature: string, secret: string): boolean;
  testConnection(): Promise<{ success: boolean; message: string }>;
}

// ── Config shape passed to each gateway constructor ────────────────────────────

export interface GatewayRuntimeConfig {
  gatewayType:   GatewayType;
  merchantId:    string;
  apiKey:        string;
  apiSecret:     string;    // already decrypted
  webhookSecret: string;    // already decrypted
  environment:   GatewayEnvironment;
}
