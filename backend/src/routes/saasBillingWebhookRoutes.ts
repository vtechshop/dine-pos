/**
 * DinePOS SaaS Billing Webhook
 * POST /api/saas/webhook
 *
 * Receives Razorpay Subscription lifecycle events for the DinePOS SaaS account.
 * This is COMPLETELY SEPARATE from /api/payment-webhooks/:hotelId which handles
 * per-hotel customer payment events.
 *
 * Authenticated via HMAC-SHA256 of raw body against RAZORPAY_SAAS_WEBHOOK_SECRET.
 * No hotel JWT — webhook is server-to-server from Razorpay.
 *
 * Events handled:
 *   subscription.authenticated  → subscription ready to charge (created link clicked)
 *   subscription.activated      → first charge successful, hotel goes active
 *   invoice.paid                → renewal charge successful (idempotent on rzpInvoiceId)
 *   invoice.payment_failed      → payment attempt failed (do NOT suspend yet)
 *   subscription.halted         → Razorpay gave up after retries → suspend hotel
 *   subscription.cancelled      → hotel or SA cancelled → expire/cancel
 *   subscription.completed      → subscription reached total_count limit → expire
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Hotel from '../models/Hotel';
import Subscription from '../models/Subscription';
import { logger } from '../utils/logger';
import { invalidateStatusCache } from '../middleware/auth';

const router = Router();

// ── HMAC-SHA256 signature verification ──────────────────────────────────────
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ── POST /api/saas/webhook ────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const secret = process.env.RAZORPAY_SAAS_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[saasBillingWebhook] RAZORPAY_SAAS_WEBHOOK_SECRET not set — rejecting all events');
    return res.status(500).json({ message: 'Webhook secret not configured' });
  }

  const rawBody  = (req as Request & { rawBody?: string }).rawBody ?? '';
  const signature = (req.headers['x-razorpay-signature'] ?? '') as string;

  if (!signature) {
    logger.warn('[saasBillingWebhook] Missing X-Razorpay-Signature header');
    return res.status(400).json({ message: 'Missing signature' });
  }

  if (!verifySignature(rawBody, signature, secret)) {
    logger.warn('[saasBillingWebhook] Signature mismatch — rejecting event');
    return res.status(400).json({ message: 'Invalid signature' });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ message: 'Invalid JSON payload' });
  }

  const event    = payload.event as string;
  const entity   = payload.payload?.subscription?.entity ?? payload.payload?.invoice?.entity?.subscription ?? null;
  const invoice  = payload.payload?.invoice?.entity ?? null;

  // We need the subscription id to find the hotel
  const rzpSubscriptionId: string =
    entity?.id ??
    invoice?.subscription_id ??
    '';

  logger.info('[saasBillingWebhook] received', { event, rzpSubscriptionId });

  // Always return 200 quickly to Razorpay — process asynchronously
  res.status(200).json({ received: true });

  if (!rzpSubscriptionId) {
    logger.warn('[saasBillingWebhook] No subscription id in payload', { event });
    return;
  }

  try {
    await handleSaasWebhookEvent(event, rzpSubscriptionId, entity, invoice, payload);
  } catch (err) {
    logger.error('[saasBillingWebhook] handler error', { event, rzpSubscriptionId, err: String(err) });
  }
});

// ── Event handler ─────────────────────────────────────────────────────────────
async function handleSaasWebhookEvent(
  event:              string,
  rzpSubscriptionId:  string,
  entity:             any,
  invoice:            any,
  _payload:           any,
): Promise<void> {

  const hotel = await Hotel.findOne({ rzpSubscriptionId });
  if (!hotel) {
    logger.warn('[saasBillingWebhook] No hotel found for subscription', { rzpSubscriptionId, event });
    return;
  }

  const hotelId = (hotel._id as mongoose.Types.ObjectId).toString();

  switch (event) {

    // ── Subscription authenticated (hosted checkout completed by hotel owner) ─
    case 'subscription.authenticated': {
      await Hotel.findByIdAndUpdate(hotel._id, {
        rzpSubscriptionStatus: 'authenticated',
      });
      logger.info('[saasBillingWebhook] subscription.authenticated', { hotelId });
      break;
    }

    // ── First charge successful → activate hotel ───────────────────────────────
    case 'subscription.activated': {
      const chargeAt    = entity?.charge_at     ? new Date(entity.charge_at * 1000)   : null;
      const currentEnd  = entity?.current_end   ? new Date(entity.current_end * 1000) : null;
      const currentStart= entity?.current_start ? new Date(entity.current_start * 1000): new Date();

      // Grant printer entitlement on first-ever activation (idempotent)
      const grantPrinter = !hotel.printerEntitlementGranted;

      await Hotel.findByIdAndUpdate(hotel._id, {
        status:                'active',
        subscriptionType:      'standard',
        subscriptionPlan:      'standard',
        subscriptionStartDate: currentStart,
        subscriptionEndDate:   currentEnd,
        rzpSubscriptionStatus: 'active',
        rzpNextBillingAt:      chargeAt,
        ...(grantPrinter ? { printerEntitlementGranted: true } : {}),
      });

      // Create first Subscription record
      await Subscription.create({
        hotelId:                hotel._id,
        plan:                   'standard',
        status:                 'active',
        startDate:              currentStart,
        endDate:                currentEnd ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        amount:                 hotel.saasAnnualPrice ?? 12000,
        currency:               'INR',
        paymentMethod:          'razorpay_subscription',
        billingCycle:           'yearly',
        rzpSubscriptionId,
        rzpPlanId:              entity?.plan_id ?? '',
        rzpInvoiceId:           invoice?.id ?? '',
        paidAt:                 new Date(),
        isRenewal:              false,
        printerEntitlementGranted: grantPrinter,
      });

      await invalidateStatusCache(hotelId);
      logger.info('[saasBillingWebhook] subscription.activated — hotel active', { hotelId, grantPrinter });
      break;
    }

    // ── Renewal invoice paid (idempotent on rzpInvoiceId) ──────────────────────
    case 'invoice.paid': {
      const invoiceId   = invoice?.id ?? '';
      const chargeAt    = entity?.charge_at     ? new Date(entity.charge_at * 1000)   : null;
      const currentEnd  = entity?.current_end   ? new Date(entity.current_end * 1000) : null;
      const currentStart= entity?.current_start ? new Date(entity.current_start * 1000): new Date();

      if (!invoiceId) {
        logger.warn('[saasBillingWebhook] invoice.paid has no invoice id', { rzpSubscriptionId });
        return;
      }

      // Idempotency: skip if this invoice was already processed
      const existing = await Subscription.findOne({ rzpSubscriptionId, rzpInvoiceId: invoiceId });
      if (existing) {
        logger.info('[saasBillingWebhook] invoice.paid duplicate — skipping', { invoiceId });
        return;
      }

      await Hotel.findByIdAndUpdate(hotel._id, {
        status:                'active',
        subscriptionType:      'standard',
        subscriptionPlan:      'standard',
        subscriptionStartDate: currentStart,
        subscriptionEndDate:   currentEnd,
        rzpSubscriptionStatus: 'active',
        rzpNextBillingAt:      chargeAt,
      });

      await Subscription.create({
        hotelId:      hotel._id,
        plan:         'standard',
        status:       'active',
        startDate:    currentStart,
        endDate:      currentEnd ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        amount:       hotel.saasAnnualPrice ?? 12000,
        currency:     'INR',
        paymentMethod: 'razorpay_subscription',
        billingCycle: 'yearly',
        rzpSubscriptionId,
        rzpPlanId:    entity?.plan_id ?? '',
        rzpInvoiceId: invoiceId,
        paidAt:       new Date(),
        isRenewal:    true,
        printerEntitlementGranted: false, // only on first activation
      });

      await invalidateStatusCache(hotelId);
      logger.info('[saasBillingWebhook] invoice.paid — renewal processed', { hotelId, invoiceId });
      break;
    }

    // ── Payment attempt failed (do NOT suspend — Razorpay will retry) ──────────
    case 'invoice.payment_failed': {
      const invoiceId = invoice?.id ?? '';
      // Increment failureCount on the most recent Subscription record for this sub
      await Subscription.findOneAndUpdate(
        { rzpSubscriptionId, status: 'active' },
        { $inc: { failureCount: 1 } },
        { sort: { createdAt: -1 } },
      );
      await Hotel.findByIdAndUpdate(hotel._id, {
        rzpSubscriptionStatus: 'pending',
      });
      logger.warn('[saasBillingWebhook] invoice.payment_failed — NOT suspending; awaiting halted', {
        hotelId, invoiceId,
      });
      break;
    }

    // ── Razorpay exhausted retries → suspend hotel ──────────────────────────────
    case 'subscription.halted': {
      await Hotel.findByIdAndUpdate(hotel._id, {
        status:                'suspended',
        rzpSubscriptionStatus: 'halted',
      });
      // Mark current subscription as expired/failed
      await Subscription.findOneAndUpdate(
        { rzpSubscriptionId, status: 'active' },
        { status: 'expired', cancellationReason: 'payment_halted' },
        { sort: { createdAt: -1 } },
      );
      await invalidateStatusCache(hotelId);
      logger.warn('[saasBillingWebhook] subscription.halted — hotel suspended', { hotelId });
      break;
    }

    // ── Cancelled (by hotel admin or SA) ────────────────────────────────────────
    case 'subscription.cancelled': {
      const endsAt = entity?.current_end ? new Date(entity.current_end * 1000) : new Date();
      const alreadyExpired = endsAt < new Date();

      await Hotel.findByIdAndUpdate(hotel._id, {
        status:                alreadyExpired ? 'expired' : hotel.status, // keep active until cycle end
        rzpSubscriptionStatus: 'cancelled',
        subscriptionEndDate:   endsAt,
      });
      await Subscription.findOneAndUpdate(
        { rzpSubscriptionId, status: 'active' },
        { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'user_cancelled' },
        { sort: { createdAt: -1 } },
      );
      await invalidateStatusCache(hotelId);
      logger.info('[saasBillingWebhook] subscription.cancelled', { hotelId, endsAt });
      break;
    }

    // ── Completed (total_count reached — effectively never for 120-cycle plan) ──
    case 'subscription.completed': {
      await Hotel.findByIdAndUpdate(hotel._id, {
        status:                'expired',
        rzpSubscriptionStatus: 'completed',
      });
      await Subscription.findOneAndUpdate(
        { rzpSubscriptionId, status: 'active' },
        { status: 'expired', cancellationReason: 'subscription_completed' },
        { sort: { createdAt: -1 } },
      );
      await invalidateStatusCache(hotelId);
      logger.info('[saasBillingWebhook] subscription.completed — hotel expired', { hotelId });
      break;
    }

    default:
      logger.info('[saasBillingWebhook] unhandled event — ignoring', { event });
  }
}

export default router;
