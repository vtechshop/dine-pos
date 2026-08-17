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

export const createCoupon = (data: CouponInput): Promise<{ coupon: Coupon }> =>
  apiFetch<{ coupon: Coupon }>('/coupons', { method: 'POST', body: JSON.stringify(data) });

export const updateCoupon = (id: string, data: Partial<CouponInput>): Promise<{ coupon: Coupon }> =>
  apiFetch<{ coupon: Coupon }>(`/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteCoupon = (id: string): Promise<void> =>
  apiFetch<void>(`/coupons/${id}`, { method: 'DELETE' });

export const deactivateCoupon = (id: string): Promise<{ coupon: Coupon }> =>
  apiFetch<{ coupon: Coupon }>(`/coupons/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) });

export const activateCoupon = (id: string): Promise<{ coupon: Coupon }> =>
  apiFetch<{ coupon: Coupon }>(`/coupons/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) });

export interface CouponValidateResult {
  valid: boolean;
  couponId: string;
  code: string;
  description: string;
  type: 'percent' | 'flat';
  value: number;
  discountAmount: number;
  finalAmount: number;
}

export const validateCoupon = (code: string, orderTotal: number): Promise<CouponValidateResult> =>
  apiFetch<CouponValidateResult>('/coupons/validate', {
    method: 'POST',
    body: JSON.stringify({ code, orderTotal }),
  });

export interface CouponRedemption {
  _id:            string;
  hotelId:        string;
  couponId:       string;
  couponCode:     string;
  orderId:        string;
  customerId:     string | null;
  phone:          string;
  discountAmount: number;
  status:         'redeemed' | 'reversed';
  redeemedAt:     string;
  reversedAt:     string | null;
  reversedReason: string;
}

export interface RedemptionsResponse {
  redemptions:   CouponRedemption[];
  total:         number;
  page:          number;
  limit:         number;
  activeCount:   number;
  reversedCount: number;
}

export const fetchCouponRedemptions = (
  couponId: string,
  params: { page?: number; limit?: number; status?: 'redeemed' | 'reversed'; customerId?: string } = {},
): Promise<RedemptionsResponse> => {
  const p = new URLSearchParams();
  if (params.page)       p.set('page',       String(params.page));
  if (params.limit)      p.set('limit',      String(params.limit));
  if (params.status)     p.set('status',     params.status);
  if (params.customerId) p.set('customerId', params.customerId);
  const q = p.toString();
  return apiFetch<RedemptionsResponse>(`/coupons/${couponId}/redemptions${q ? `?${q}` : ''}`);
};
