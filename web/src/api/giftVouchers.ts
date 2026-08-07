import { apiFetch } from './client';

export interface GiftVoucher {
  _id: string;
  code: string;
  amount: number;
  balance: number;
  issuedToName?: string;
  issuedToPhone?: string;
  issuedToCustomerId?: string;
  expiresAt?: string;
  isActive: boolean;
  createdAt: string;
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

export const checkGiftVoucher = (code: string): Promise<{ balance: number; isActive: boolean; expiresAt?: string }> =>
  apiFetch(`/gift-vouchers/${encodeURIComponent(code)}/check`);

export const topupGiftVoucher = (code: string, amount: number): Promise<GiftVoucher> =>
  apiFetch<GiftVoucher>('/gift-vouchers/topup', { method: 'POST', body: JSON.stringify({ code, amount }) });

export const redeemGiftVoucher = (code: string, amount: number): Promise<GiftVoucher> =>
  apiFetch<GiftVoucher>('/gift-vouchers/redeem', { method: 'POST', body: JSON.stringify({ code, amount }) });

export const deactivateGiftVoucher = (id: string): Promise<GiftVoucher> =>
  apiFetch<GiftVoucher>(`/gift-vouchers/${id}/deactivate`, { method: 'POST' });
