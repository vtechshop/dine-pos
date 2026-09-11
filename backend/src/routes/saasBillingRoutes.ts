/**
 * DinePOS SaaS Billing Routes (hotel-facing)
 * Base: /api/saas
 *
 * Uses requireHotelJwt (NOT authMiddleware) so expired/trial hotels can reach
 * billing endpoints and subscribe/renew.
 *
 * Endpoints:
 *   GET  /api/saas/status           — current subscription info for the hotel
 *   GET  /api/saas/plan             — plan details (price, features)
 *   POST /api/saas/subscribe        — create a Razorpay subscription → returns checkout_url
 *   POST /api/saas/cancel           — cancel at cycle end
 *   GET  /api/saas/invoices         — list past Subscription records (billing history)
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Hotel from '../models/Hotel';
import Subscription from '../models/Subscription';
import { requireHotelJwt, AuthRequest } from '../middleware/auth';
import {
  getPlanId,
  createSubscription,
  cancelSubscription,
  fetchSubscription,
} from '../services/razorpaySubscriptionService';
import { logger } from '../utils/logger';
import { SAAS_STANDARD_PRICE_INR } from '../utils/planLimits';
import { makeRateLimiter } from '../utils/rateLimiter';

const router = Router();

// Strict rate limits for unauthenticated endpoints
const publicSubscribeLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many subscribe attempts. Please try again after 15 minutes.' },
});

const publicStatusLimiter = makeRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many status checks. Please wait a few minutes.' },
});

// ── POST /api/saas/subscribe-public ──────────────────────────────────────────
// Unauthenticated subscribe endpoint for expired hotels that cannot log in.
// Accepts { hotelId } and validates the hotel is genuinely expired before
// creating a Razorpay subscription. No JWT required — security comes from the
// DB check that the hotel status is 'expired'.
router.post('/subscribe-public', publicSubscribeLimiter, async (req: Request, res: Response) => {
  const { hotelId } = req.body as { hotelId?: string };

  if (!hotelId || typeof hotelId !== 'string' || !mongoose.Types.ObjectId.isValid(hotelId)) {
    return res.status(400).json({ message: 'Valid hotelId required.' });
  }

  try {
    const hotel = await Hotel.findById(hotelId)
      .select('status rzpSubscriptionId rzpSubscriptionStatus rzpCustomPlanId saasAnnualPrice subscriptionType')
      .lean();

    if (!hotel) return res.status(404).json({ message: 'Hotel not found.' });
    const h = hotel as any;

    // Only genuinely expired hotels may use this endpoint
    if (h.status !== 'expired') {
      return res.status(403).json({ message: 'This endpoint is only available for expired accounts.' });
    }

    // Block if already has an active/authenticated subscription
    const blockedStatuses = ['active', 'authenticated', 'created'];
    if (h.rzpSubscriptionId && blockedStatuses.includes(h.rzpSubscriptionStatus)) {
      return res.status(409).json({
        message: 'You already have an active subscription.',
        rzpSubscriptionStatus: h.rzpSubscriptionStatus,
      });
    }

    const planId = getPlanId(h);
    const sub    = await createSubscription(planId, hotelId);

    await Hotel.findByIdAndUpdate(hotelId, {
      rzpSubscriptionId:     sub.id,
      rzpSubscriptionStatus: sub.status,
    });

    logger.info('[saasBillingRoutes] POST /subscribe-public — subscription created', {
      hotelId,
      subscriptionId: sub.id,
    });

    return res.status(201).json({
      subscriptionId: sub.id,
      checkoutUrl:    sub.short_url,
      status:         sub.status,
    });
  } catch (err: any) {
    const rzpMsg = err?.error?.description ?? err?.message ?? String(err);
    logger.error('[saasBillingRoutes] POST /subscribe-public error', { hotelId, rzpMsg, err: String(err) });
    return res.status(500).json({ message: `Razorpay error: ${rzpMsg}` });
  }
});

// ── GET /api/saas/status-public?hotelId=xxx ───────────────────────────────────
// Unauthenticated endpoint so expired hotels can check if their account has been
// activated (e.g. after completing a Razorpay payment and returning to the app).
// Returns only whether the hotel is now active — no sensitive billing data.
router.get('/status-public', publicStatusLimiter, async (req: Request, res: Response) => {
  const { hotelId } = req.query as { hotelId?: string };

  if (!hotelId || typeof hotelId !== 'string' || !mongoose.Types.ObjectId.isValid(hotelId)) {
    return res.status(400).json({ message: 'Valid hotelId required.' });
  }

  try {
    const hotel = await Hotel.findById(hotelId)
      .select('status subscriptionType')
      .lean();

    if (!hotel) return res.status(404).json({ message: 'Hotel not found.' });
    const h = hotel as any;

    return res.json({
      isActive: h.status === 'active',
      status:   h.status,
    });
  } catch (err) {
    logger.error('[saasBillingRoutes] GET /status-public error', { hotelId, err: String(err) });
    return res.status(500).json({ message: 'Failed to check status.' });
  }
});

// All routes below require valid hotel JWT (no status gate — expired hotels must reach billing)
router.use(requireHotelJwt);

// ── GET /api/saas/status ──────────────────────────────────────────────────────
router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.hotelId)
      .select(
        'status subscriptionType subscriptionPlan subscriptionStartDate subscriptionEndDate ' +
        'saasAnnualPrice rzpSubscriptionId rzpSubscriptionStatus rzpNextBillingAt ' +
        'printerEntitlementGranted printerEntitlementFulfilledAt printerEntitlementSkipped',
      )
      .lean();

    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    const h = hotel as any;
    return res.json({
      status:                h.status,
      subscriptionType:      h.subscriptionType,
      subscriptionPlan:      h.subscriptionPlan,
      subscriptionStartDate: h.subscriptionStartDate,
      subscriptionEndDate:   h.subscriptionEndDate,
      annualPrice:           h.saasAnnualPrice ?? SAAS_STANDARD_PRICE_INR,
      rzpSubscriptionStatus: h.rzpSubscriptionStatus,
      rzpNextBillingAt:      h.rzpNextBillingAt,
      hasActiveSubscription: !!h.rzpSubscriptionId && h.rzpSubscriptionStatus === 'active',
      printerEntitlement: {
        granted:     h.printerEntitlementGranted,
        fulfilledAt: h.printerEntitlementFulfilledAt,
        skipped:     h.printerEntitlementSkipped,
      },
    });
  } catch (err) {
    logger.error('[saasBillingRoutes] GET /status error', { hotelId: req.hotelId, err: String(err) });
    return res.status(500).json({ message: 'Failed to fetch subscription status' });
  }
});

// ── GET /api/saas/plan ────────────────────────────────────────────────────────
router.get('/plan', async (req: AuthRequest, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.hotelId)
      .select('saasAnnualPrice')
      .lean();

    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    const annualPrice = (hotel as any).saasAnnualPrice ?? SAAS_STANDARD_PRICE_INR;

    return res.json({
      name:        'DinePOS SaaS Standard',
      annualPrice,
      currency:    'INR',
      billingCycle: 'yearly',
      features: {
        devices:          'unlimited',
        support:          '24/7 email + WhatsApp',
        printerBonus:     '2 free Bluetooth thermal printers (first subscription only)',
      },
    });
  } catch (err) {
    logger.error('[saasBillingRoutes] GET /plan error', { hotelId: req.hotelId, err: String(err) });
    return res.status(500).json({ message: 'Failed to fetch plan details' });
  }
});

// ── POST /api/saas/subscribe ──────────────────────────────────────────────────
// Creates a Razorpay subscription and returns the hosted checkout URL.
// The hotel owner completes payment on Razorpay's hosted page.
// Activation is confirmed by the webhook (subscription.activated / invoice.paid).
router.post('/subscribe', async (req: AuthRequest, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.hotelId)
      .select('rzpSubscriptionId rzpSubscriptionStatus rzpCustomPlanId saasAnnualPrice status')
      .lean();

    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    const h = hotel as any;

    // Block if already has an active/authenticated subscription
    const blockedStatuses = ['active', 'authenticated', 'created'];
    if (h.rzpSubscriptionId && blockedStatuses.includes(h.rzpSubscriptionStatus)) {
      return res.status(409).json({
        message: 'You already have an active subscription.',
        rzpSubscriptionStatus: h.rzpSubscriptionStatus,
      });
    }

    const planId = getPlanId(h);
    const sub    = await createSubscription(planId, req.hotelId!);

    // Store subscription id on hotel immediately so webhook can find the hotel
    await Hotel.findByIdAndUpdate(req.hotelId, {
      rzpSubscriptionId:     sub.id,
      rzpSubscriptionStatus: sub.status,
    });

    logger.info('[saasBillingRoutes] POST /subscribe — subscription created', {
      hotelId: req.hotelId,
      subscriptionId: sub.id,
    });

    return res.status(201).json({
      subscriptionId: sub.id,
      checkoutUrl:    sub.short_url,   // Razorpay hosted checkout link
      status:         sub.status,
    });
  } catch (err) {
    logger.error('[saasBillingRoutes] POST /subscribe error', { hotelId: req.hotelId, err: String(err) });
    return res.status(500).json({ message: 'Failed to create subscription. Please try again.' });
  }
});

// ── POST /api/saas/cancel ─────────────────────────────────────────────────────
// Cancels the current subscription at the end of the current billing cycle.
// Hotel remains active until subscriptionEndDate.
router.post('/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.hotelId)
      .select('rzpSubscriptionId rzpSubscriptionStatus status')
      .lean();

    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    const h = hotel as any;

    if (!h.rzpSubscriptionId) {
      return res.status(400).json({ message: 'No active subscription to cancel.' });
    }
    if (h.rzpSubscriptionStatus === 'cancelled') {
      return res.status(409).json({ message: 'Subscription is already cancelled.' });
    }

    // cancelAtCycleEnd=true → hotel stays active until period end
    await cancelSubscription(h.rzpSubscriptionId, true);

    // Webhook (subscription.cancelled) will update status; pre-emptively update local status
    await Hotel.findByIdAndUpdate(req.hotelId, {
      rzpSubscriptionStatus: 'cancelled',
    });

    logger.info('[saasBillingRoutes] POST /cancel — subscription cancel requested', {
      hotelId: req.hotelId,
      rzpSubscriptionId: h.rzpSubscriptionId,
    });

    return res.json({
      message: 'Your subscription has been cancelled. You will retain access until the end of your current billing period.',
    });
  } catch (err) {
    logger.error('[saasBillingRoutes] POST /cancel error', { hotelId: req.hotelId, err: String(err) });
    return res.status(500).json({ message: 'Failed to cancel subscription. Please contact support.' });
  }
});

// ── GET /api/saas/invoices ────────────────────────────────────────────────────
// Returns paginated billing history (Subscription records) for this hotel.
router.get('/invoices', async (req: AuthRequest, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip  = (page - 1) * limit;

    const [records, total] = await Promise.all([
      Subscription.find({ hotelId: new mongoose.Types.ObjectId(req.hotelId!) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('plan status startDate endDate amount currency paidAt isRenewal billingCycle createdAt rzpInvoiceId')
        .lean(),
      Subscription.countDocuments({ hotelId: new mongoose.Types.ObjectId(req.hotelId!) }),
    ]);

    return res.json({
      invoices: records,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('[saasBillingRoutes] GET /invoices error', { hotelId: req.hotelId, err: String(err) });
    return res.status(500).json({ message: 'Failed to fetch billing history' });
  }
});

export default router;
