/**
 * Standard DinePOS subscription price — decided by Super Admin.
 *
 * Super Admin saves a yearly price → a Razorpay plan is created for it → new
 * subscriptions use that plan. Before Super Admin has set one, the price comes
 * from the plan in RAZORPAY_PLAN_ID_STANDARD (read from Razorpay), so screens
 * always show what checkout will actually charge.
 */
import SaasPricing from '../models/SaasPricing';
import { SAAS_STANDARD_PRICE_INR } from '../utils/planLimits';
import { createRazorpayPlan, getPlanAmountInr } from './razorpaySubscriptionService';
import type { IHotel } from '../models/Hotel';

export interface StandardPricing {
  annualPrice: number;
  planId:      string | null;
  /** superadmin = set in Super Admin; env = old server setting; default = nothing set up yet */
  source:      'superadmin' | 'env' | 'default';
}

export async function getStandardPricing(): Promise<StandardPricing> {
  const saved = await SaasPricing.findOne({ key: 'standard' }).lean();
  if (saved?.rzpPlanId && saved.annualPrice) {
    return { annualPrice: saved.annualPrice, planId: saved.rzpPlanId, source: 'superadmin' };
  }
  const envPlan = process.env.RAZORPAY_PLAN_ID_STANDARD?.trim() || null;
  if (envPlan) {
    const amount = await getPlanAmountInr(envPlan);
    return { annualPrice: amount ?? SAAS_STANDARD_PRICE_INR, planId: envPlan, source: 'env' };
  }
  return { annualPrice: SAAS_STANDARD_PRICE_INR, planId: null, source: 'default' };
}

/** Yearly price this hotel pays: its custom price, else the standard price. */
export async function annualPriceForHotel(hotel: Pick<IHotel, 'saasAnnualPrice'>): Promise<number> {
  return hotel.saasAnnualPrice ?? (await getStandardPricing()).annualPrice;
}

/** Razorpay plan a new subscription for this hotel should use. */
export async function resolvePlanId(hotel: Pick<IHotel, 'rzpCustomPlanId'>): Promise<string> {
  const custom = hotel.rzpCustomPlanId?.trim();
  if (custom) return custom;
  const { planId } = await getStandardPricing();
  if (!planId) throw new Error('[saasPricing] No standard price set — set it in Super Admin → Subscriptions');
  return planId;
}

/**
 * Set the standard yearly price. Creates a Razorpay plan unless the price is
 * unchanged. Existing subscribers keep their current plan and price.
 */
export async function setStandardPrice(annualPrice: number): Promise<{ annualPrice: number; planId: string; created: boolean }> {
  const current = await SaasPricing.findOne({ key: 'standard' }).lean();
  if (current?.rzpPlanId && current.annualPrice === annualPrice) {
    return { annualPrice, planId: current.rzpPlanId, created: false };
  }
  const planId = await createRazorpayPlan(annualPrice, 'DinePOS SaaS Standard');
  await SaasPricing.findOneAndUpdate(
    { key: 'standard' },
    { $set: { annualPrice, rzpPlanId: planId } },
    { upsert: true },
  );
  return { annualPrice, planId, created: true };
}
