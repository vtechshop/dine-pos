/**
 * DinePOS SaaS Billing API
 * Calls /api/saas/* endpoints (backend: saasBillingRoutes.ts)
 *
 * Backend uses requireHotelJwt — expired hotels CAN call these endpoints.
 * Do NOT mix with billing.ts which handles per-hotel table/session billing.
 */

import { apiFetch } from './client';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SaasStatus {
  status: string;                    // hotel status: trial | active | expired | suspended
  subscriptionType: string;
  subscriptionPlan: string;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  annualPrice: number;               // INR
  rzpSubscriptionStatus: string;     // Razorpay subscription status
  rzpNextBillingAt: string | null;
  hasActiveSubscription: boolean;
  printerEntitlement: {
    granted: boolean;
    fulfilledAt: string | null;
    skipped: boolean;
  };
}

export interface SaasPlan {
  name: string;
  annualPrice: number;
  currency: string;
  billingCycle: string;
  features: {
    devices: string;
    support: string;
    printerBonus: string;
  };
}

export interface SaasSubscribeResponse {
  subscriptionId: string;
  checkoutUrl: string;   // Razorpay hosted checkout URL
  status: string;
}

export interface SaasInvoice {
  _id: string;
  plan: string;
  status: string;
  startDate: string;
  endDate: string;
  amount: number;
  currency: string;
  paidAt: string | null;
  isRenewal: boolean;
  billingCycle: string;
  createdAt: string;
  rzpInvoiceId: string;
}

// ── API calls ──────────────────────────────────────────────────────────────────

export const getSaasStatus = (): Promise<SaasStatus> =>
  apiFetch<SaasStatus>('/saas/status');

export const getSaasPlan = (): Promise<SaasPlan> =>
  apiFetch<SaasPlan>('/saas/plan');

export const createSaasSubscription = (): Promise<SaasSubscribeResponse> =>
  apiFetch<SaasSubscribeResponse>('/saas/subscribe', { method: 'POST' });

export const cancelSaasSubscription = (): Promise<{ message: string }> =>
  apiFetch<{ message: string }>('/saas/cancel', { method: 'POST' });

export const getSaasInvoices = (page = 1, limit = 10): Promise<{
  invoices: SaasInvoice[];
  pagination: { page: number; limit: number; total: number; pages: number };
}> => apiFetch(`/saas/invoices?page=${page}&limit=${limit}`);
