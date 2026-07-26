import { apiFetch } from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GatewayType = 'razorpay' | 'cashfree' | 'phonepe' | 'payu' | 'paytm' | 'bharatpe';
export type GatewayEnvironment = 'sandbox' | 'live';
export type PaymentStatus = 'pending' | 'processing' | 'success' | 'failed' | 'cancelled' | 'refunded' | 'partial_refunded';
export type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet' | 'emi' | 'qr' | 'other';
export type RefundStatus = 'none' | 'pending' | 'partial' | 'full';
export type SettlementStatus = 'pending' | 'settled' | 'on_hold';

export interface GatewayConfig {
  _id:             string;
  hotelId:         string;
  gatewayType:     GatewayType;
  displayName:     string;
  merchantId:      string;
  apiKey:          string;
  apiSecretEnc:    string;       // '[REDACTED]' or ''
  webhookSecretEnc: string;     // '[REDACTED]' or ''
  environment:     GatewayEnvironment;
  isActive:        boolean;
  isDeleted:       boolean;
  isIntegrated:    boolean;
  testResult?: {
    lastTestedAt?: string;
    success?:      boolean;
    message?:      string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  _id:                   string;
  hotelId:               string;
  orderId:               string;
  internalTransactionId: string;
  gatewayTransactionId:  string;
  gatewayOrderId:        string;
  gatewayType:           string;
  status:                PaymentStatus;
  amount:                number;   // in rupees (backend converts from paise)
  currency:              string;
  paymentMethod:         PaymentMethod;
  refundStatus:          RefundStatus;
  refundedAmount:        number;
  refunds:               { refundId: string; amount: number; reason: string; refundedAt: string }[];
  settlementStatus:      SettlementStatus;
  settlementId:          string;
  failureReason:         string;
  createdAt:             string;
  updatedAt:             string;
}

export interface PaymentReport {
  period: { from: string; to: string };
  summary: {
    total: number; totalAmount: number; successAmount: number; successCount: number;
    failedCount: number; pendingCount: number; refundedAmount: number; successRate: number;
  };
  byGateway:  { gatewayType: string; count: number; amount: number; successRate: number }[];
  byMethod:   { method: string; count: number; amount: number }[];
  byStatus:   { status: string; count: number; amount: number }[];
  dailyTrend: { date: string; count: number; amount: number }[];
}

// ── Gateway Config APIs ───────────────────────────────────────────────────────

const GW = '/payment-gateway-configs';

export const fetchGatewayConfigs = (): Promise<GatewayConfig[]> =>
  apiFetch<GatewayConfig[]>(GW);

export const createGatewayConfig = (data: {
  gatewayType: string; displayName: string; merchantId?: string; apiKey?: string;
  apiSecret?: string; webhookSecret?: string; environment?: string;
}): Promise<GatewayConfig> =>
  apiFetch<GatewayConfig>(GW, { method: 'POST', body: JSON.stringify(data) });

export const updateGatewayConfig = (id: string, data: {
  displayName?: string; merchantId?: string; apiKey?: string;
  apiSecret?: string; webhookSecret?: string; environment?: string;
}): Promise<GatewayConfig> =>
  apiFetch<GatewayConfig>(`${GW}/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteGatewayConfig = (id: string): Promise<{ message: string }> =>
  apiFetch<{ message: string }>(`${GW}/${id}`, { method: 'DELETE' });

export const toggleGateway = (id: string): Promise<GatewayConfig> =>
  apiFetch<GatewayConfig>(`${GW}/${id}/toggle`, { method: 'PATCH' });

export const testGatewayConnection = (id: string): Promise<{ success: boolean; message: string }> =>
  apiFetch<{ success: boolean; message: string }>(`${GW}/${id}/test`, { method: 'POST' });

// ── Payment APIs ──────────────────────────────────────────────────────────────

const PM = '/payments';

export const fetchPayments = (params?: {
  from?: string; to?: string; status?: string; gateway?: string; method?: string; page?: number; limit?: number;
}): Promise<{ payments: PaymentRecord[]; total: number; page: number; limit: number }> => {
  const p = new URLSearchParams();
  if (params?.from)    p.set('from',    params.from);
  if (params?.to)      p.set('to',      params.to);
  if (params?.status)  p.set('status',  params.status);
  if (params?.gateway) p.set('gateway', params.gateway);
  if (params?.method)  p.set('method',  params.method);
  if (params?.page)    p.set('page',    String(params.page));
  if (params?.limit)   p.set('limit',   String(params.limit));
  return apiFetch<{ payments: PaymentRecord[]; total: number; page: number; limit: number }>(`${PM}?${p}`);
};

export const fetchPayment = (id: string): Promise<PaymentRecord> =>
  apiFetch<PaymentRecord>(`${PM}/${id}`);

export const initiateRefund = (id: string, amount: number, reason?: string): Promise<{ refundId: string; status: string; message?: string; payment: PaymentRecord }> =>
  apiFetch(`${PM}/${id}/refund`, { method: 'POST', body: JSON.stringify({ amount, reason }) });

export const fetchPaymentReport = (from?: string, to?: string): Promise<PaymentReport> => {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to)   p.set('to', to);
  return apiFetch<PaymentReport>(`${PM}/reports/summary?${p}`);
};

// ── Razorpay Checkout APIs ─────────────────────────────────────────────────────

export interface CreatePaymentIntentResult {
  payment: {
    internalTransactionId: string;
    gatewayType:           string;
    amount:                number;   // rupees
    currency:              string;
    status:                PaymentStatus;
  };
  gatewayData: {
    gatewayTransactionId: string;
    gatewayOrderId:       string;
    metadata: {
      keyId:         string;
      orderId:       string;
      amount:        number;   // paise
      currency:      string;
      customerName:  string;
      customerEmail: string;
      customerPhone: string;
      description:   string;
    };
  };
  gatewayError:      string | null;
  gatewayIntegrated: boolean;
}

export const createPaymentIntent = (
  orderId: string,
  amount:  number,
  opts?: {
    currency?:      string;
    description?:   string;
    customerName?:  string;
    customerEmail?: string;
    customerPhone?: string;
  },
): Promise<CreatePaymentIntentResult> =>
  apiFetch<CreatePaymentIntentResult>(`${PM}/create`, {
    method: 'POST',
    body:   JSON.stringify({ orderId, amount, ...opts }),
  });

export interface VerifyPaymentIntentResult {
  verified:           boolean;
  gatewayIntegrated?: boolean;
  message?:           string;
  payment:            PaymentRecord;
}

export const verifyPaymentIntent = (
  internalTransactionId: string,
  gatewayTransactionId:  string,
  signature?:            string,
): Promise<VerifyPaymentIntentResult> =>
  apiFetch<VerifyPaymentIntentResult>(`${PM}/verify`, {
    method: 'POST',
    body:   JSON.stringify({ internalTransactionId, gatewayTransactionId, signature }),
  });
