import { apiFetch } from './client';

export interface GiftVoucher {
  _id: string;
  voucherCode: string;
  originalAmount: number;
  balance: number;
  issuedToName?: string;
  issuedToPhone?: string;
  issuedToCustomerId?: string;
  expiresAt?: string;
  isActive: boolean;
  createdAt: string;
}

export interface GiftVoucherStats {
  total: number;
  active: number;
  inactive: number;
  totalIssuedValue: number;
  totalTopupValue: number;
  totalRedeemedValue: number;
  totalRestoredValue: number;
  outstandingLiability: number;
}

export interface GiftVoucherTransaction {
  _id: string;
  type: 'issue' | 'topup' | 'redeem' | 'refund' | 'expire';
  amount: number;
  balanceAfter: number;
  orderId?: string | null;
  remarks?: string;
  createdBy?: string;
  createdAt: string;
}

export interface GiftVoucherTransactionPage {
  voucherCode: string;
  balance: number;
  transactions: GiftVoucherTransaction[];
  total: number;
  page: number;
  limit: number;
}

export interface IssueVoucherInput {
  amount: number;
  issuedToName?: string;
  issuedToPhone?: string;
  issuedToCustomerId?: string;
  expiresAt?: string;
}

interface GiftVouchersResponse {
  vouchers: GiftVoucher[];
  total: number;
  page: number;
  pages: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const fetchGiftVouchers = (params?: {
  page?: number;
  limit?: number;
  active?: 'true' | 'false' | '';
}): Promise<GiftVouchersResponse> =>
  apiFetch<GiftVouchersResponse>(`/gift-vouchers${qs(params ?? {})}`);

export const issueGiftVoucher = (data: IssueVoucherInput): Promise<GiftVoucher> =>
  apiFetch<GiftVoucher>('/gift-vouchers', { method: 'POST', body: JSON.stringify(data) });

export interface GiftVoucherCheckResult {
  valid: boolean;
  voucher: {
    voucherCode: string;
    balance: number;
    originalAmount: number;
    issuedToName: string;
    issuedToPhone: string;
    expiresAt?: string;
    isActive: boolean;
  };
}

export const checkGiftVoucher = (code: string): Promise<GiftVoucherCheckResult> =>
  apiFetch<GiftVoucherCheckResult>(`/gift-vouchers/${encodeURIComponent(code)}/check`);

export const topupGiftVoucher = (code: string, amount: number): Promise<GiftVoucher> =>
  apiFetch<GiftVoucher>('/gift-vouchers/topup', { method: 'POST', body: JSON.stringify({ code, amount }) });

export const redeemGiftVoucher = (code: string, amount: number): Promise<GiftVoucher> =>
  apiFetch<GiftVoucher>('/gift-vouchers/redeem', { method: 'POST', body: JSON.stringify({ code, amount }) });

export const deactivateGiftVoucher = (id: string): Promise<GiftVoucher> =>
  apiFetch<GiftVoucher>(`/gift-vouchers/${id}/deactivate`, { method: 'POST' });

export const reactivateGiftVoucher = (id: string): Promise<{ success: boolean }> =>
  apiFetch<{ success: boolean }>(`/gift-vouchers/${id}/reactivate`, { method: 'POST' });

export const fetchGiftVoucherStats = (): Promise<GiftVoucherStats> =>
  apiFetch<GiftVoucherStats>('/gift-vouchers/stats');

export const fetchGiftVoucherTransactions = (
  id: string,
  params?: { page?: number; limit?: number },
): Promise<GiftVoucherTransactionPage> =>
  apiFetch<GiftVoucherTransactionPage>(
    `/gift-vouchers/${encodeURIComponent(id)}/transactions${qs(params ?? {})}`,
  );
