import { apiFetch } from './client';

export interface Coupon {
  _id: string;
  code: string;
  description?: string;
  type: 'percent' | 'flat';
  value: number;
  minOrderValue: number;
  maxDiscount?: number;
  validFrom?: string;
  validUntil?: string;
  usageLimit?: number;
  perCustomerLimit?: number;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
}

export interface CouponInput {
  code: string;
  description?: string;
  type: 'percent' | 'flat';
  value: number;
  minOrderValue?: number;
  maxDiscount?: number;
  validFrom?: string;
  validUntil?: string;
  usageLimit?: number;
  perCustomerLimit?: number;
}

interface CouponsResponse {
  coupons: Coupon[];
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

export const fetchCoupons = (params?: {
  page?: number;
  limit?: number;
  active?: 'true' | 'false' | '';
}): Promise<CouponsResponse> =>
  apiFetch<CouponsResponse>(`/coupons${qs(params ?? {})}`);

export const createCoupon = (data: CouponInput): Promise<Coupon> =>
  apiFetch<Coupon>('/coupons', { method: 'POST', body: JSON.stringify(data) });

export const updateCoupon = (id: string, data: Partial<CouponInput>): Promise<Coupon> =>
  apiFetch<Coupon>(`/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteCoupon = (id: string): Promise<void> =>
  apiFetch<void>(`/coupons/${id}`, { method: 'DELETE' });

export const deactivateCoupon = (id: string): Promise<Coupon> =>
  apiFetch<Coupon>(`/coupons/${id}/deactivate`, { method: 'POST' });

export const activateCoupon = (id: string): Promise<Coupon> =>
  apiFetch<Coupon>(`/coupons/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) });
