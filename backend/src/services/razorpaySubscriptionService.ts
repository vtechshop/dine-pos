/**
 * DinePOS SaaS Billing — Razorpay Subscription Service
 *
 * Uses the DinePOS SaaS Razorpay account (RAZORPAY_SAAS_KEY_ID / RAZORPAY_SAAS_KEY_SECRET).
 * This is COMPLETELY SEPARATE from the per-hotel Razorpay OAuth payment gateway
 * used for hotel customer QR/UPI payments (RAZORPAY_CLIENT_ID / RAZORPAY_CLIENT_SECRET).
 *
 * Handles:
 *   - Creating Razorpay Plans per unique price point (standard + custom)
 *   - Creating/cancelling/fetching Razorpay Subscriptions
 *   - Updating a subscription's plan for next renewal cycle (custom price change)
 */

import Razorpay from 'razorpay';
import { logger } from '../utils/logger';

// Lazily-initialised client — allows tests to stub env vars before first call.
let _client: Razorpay | null = null;

function getSaasClient(): Razorpay {
  if (_client) return _client;
  const keyId     = process.env.RAZORPAY_SAAS_KEY_ID;
  const keySecret = process.env.RAZORPAY_SAAS_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('[razorpaySubscriptionService] RAZORPAY_SAAS_KEY_ID or RAZORPAY_SAAS_KEY_SECRET not set');
  }
  _client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return _client;
}

// ── Plan helpers ──────────────────────────────────────────────────────────────

// Which plan a hotel subscribes on is decided in services/saasPricing.ts (resolvePlanId).

/**
 * Create a new Razorpay Plan for a given annual price in INR.
 * Called by Super Admin when setting the standard price or a hotel's custom price.
 * Returns the Razorpay plan_id (e.g. "plan_xxx").
 */
export async function createRazorpayPlan(
  annualPriceInr: number,
  label = 'DinePOS SaaS Standard',
): Promise<string> {
  const rzp   = getSaasClient();
  const paise = Math.round(annualPriceInr * 100);

  const plan = await (rzp.plans as any).create({
    period:   'yearly',
    interval: 1,
    item: {
      name:        label,
      amount:      paise,
      currency:    'INR',
      description: 'DinePOS annual SaaS subscription — unlimited devices',
    },
  }) as { id: string };

  planAmountCache.set(plan.id, annualPriceInr);
  logger.info('[razorpaySubscriptionService] plan created', { planId: plan.id, annualPriceInr });
  return plan.id;
}

// A Razorpay plan's price never changes, so each one is fetched only once.
const planAmountCache = new Map<string, number>();

/**
 * Yearly price (INR) of a Razorpay plan, read from Razorpay itself.
 * Returns null if it can't be read (no keys, network error, timeout) so the
 * caller can fall back to the price stored on the hotel.
 */
export async function getPlanAmountInr(planId: string | undefined | null): Promise<number | null> {
  if (!planId) return null;
  const cached = planAmountCache.get(planId);
  if (cached !== undefined) return cached;
  try {
    const rzp = getSaasClient();
    const plan = await withTimeout(
      (rzp.plans as any).fetch(planId) as Promise<{ item?: { amount?: number } }>,
      LOOKUP_TIMEOUT_MS,
    );
    const paise = Number(plan?.item?.amount);
    if (!Number.isFinite(paise) || paise <= 0) return null;
    const inr = paise / 100;
    planAmountCache.set(planId, inr);
    return inr;
  } catch (err) {
    logger.warn('[razorpaySubscriptionService] could not read plan amount', { planId, err: String(err) });
    return null;
  }
}

/** plan_id of a subscription, or null if Razorpay can't be reached. */
export async function getSubscriptionPlanId(rzpSubscriptionId: string): Promise<string | null> {
  if (!rzpSubscriptionId) return null;
  try {
    const sub = await withTimeout(fetchSubscription(rzpSubscriptionId), LOOKUP_TIMEOUT_MS);
    return sub?.plan_id || null;
  } catch (err) {
    logger.warn('[razorpaySubscriptionService] could not read subscription plan', { rzpSubscriptionId, err: String(err) });
    return null;
  }
}

// Webhooks wait for these lookups before replying to Razorpay, so keep them short.
const LOOKUP_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

// ── Subscription helpers ──────────────────────────────────────────────────────

export interface RzpSubscription {
  id:        string;
  plan_id:   string;
  status:    string;
  short_url: string;      // hosted checkout link returned to frontend
  charge_at: number;      // unix timestamp of next charge
  current_start: number | null;
  current_end:   number | null;
}

/**
 * Create a Razorpay Subscription on the given plan_id.
 * total_count=120 (10 years) makes it effectively auto-renewing indefinitely.
 * start_at: optional unix timestamp — leave undefined to charge immediately.
 */
export async function createSubscription(
  planId:   string,
  hotelId:  string,
  startAt?: number,
): Promise<RzpSubscription> {
  const rzp = getSaasClient();

  const params: Record<string, unknown> = {
    plan_id:         planId,
    total_count:     10,        // 10-year mandate — NPCI "Others" category rejects >30yr mandates
    quantity:        1,
    customer_notify: 1,
    notes: {
      hotelId,
      product: 'DinePOS SaaS',
    },
  };
  if (startAt) params.start_at = startAt;

  const sub = await (rzp.subscriptions as any).create(params) as RzpSubscription;
  logger.info('[razorpaySubscriptionService] subscription created', {
    subscriptionId: sub.id,
    planId,
    hotelId,
    status: sub.status,
  });
  return sub;
}

/**
 * Fetch current Razorpay subscription status.
 */
export async function fetchSubscription(rzpSubscriptionId: string): Promise<RzpSubscription> {
  const rzp = getSaasClient();
  return (rzp.subscriptions as any).fetch(rzpSubscriptionId) as Promise<RzpSubscription>;
}

/**
 * Cancel a subscription.
 * cancelAtCycleEnd=true → hotel stays active until subscriptionEndDate (recommended for user-initiated cancels).
 * cancelAtCycleEnd=false → immediate cancellation.
 */
export async function cancelSubscription(
  rzpSubscriptionId: string,
  cancelAtCycleEnd: boolean,
): Promise<void> {
  const rzp = getSaasClient();
  await (rzp.subscriptions as any).cancel(rzpSubscriptionId, cancelAtCycleEnd);
  logger.info('[razorpaySubscriptionService] subscription cancelled', { rzpSubscriptionId, cancelAtCycleEnd });
}

/**
 * Update the plan on an existing active subscription so the new price takes
 * effect at the NEXT billing cycle (not the current paid period).
 * Uses the Razorpay API PATCH /v1/subscriptions/:id endpoint.
 */
export async function updateSubscriptionPlan(
  rzpSubscriptionId: string,
  newPlanId:         string,
): Promise<void> {
  const rzp = getSaasClient();
  // SDK v2.x exposes subscriptions.update() in some versions; fall back to api.patch if absent.
  if (typeof (rzp.subscriptions as any).update === 'function') {
    await (rzp.subscriptions as any).update(rzpSubscriptionId, { plan_id: newPlanId });
  } else {
    // Direct API call via the SDK's internal request helper
    const keyId     = process.env.RAZORPAY_SAAS_KEY_ID!;
    const keySecret = process.env.RAZORPAY_SAAS_KEY_SECRET!;
    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch(`https://api.razorpay.com/v1/subscriptions/${rzpSubscriptionId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plan_id: newPlanId }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Razorpay subscription update failed: ${response.status} ${body}`);
    }
  }
  logger.info('[razorpaySubscriptionService] subscription plan updated (next cycle)', {
    rzpSubscriptionId,
    newPlanId,
  });
}
