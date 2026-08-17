import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Payment from '../models/Payment';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import Order from '../models/Order';
import CustomerProfile from '../models/CustomerProfile';
import Coupon from '../models/Coupon';
import CouponRedemption from '../models/CouponRedemption';
import GiftVoucher from '../models/GiftVoucher';
import GatewayFactory from '../services/payment/GatewayFactory';
import { ensureValidOAuthConfig } from '../services/payment/razorpayTokenRefresh';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { sendError } from '../utils/sendError';
import { logAudit } from '../utils/audit';
import { logger } from '../utils/logger';
import { getLoyaltyConfig, calculateEarnedPoints, earnPoints, reverseEarnedPoints } from '../utils/loyaltyUtils';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('payment'));

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateTxnId(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TXN-${ts}-${rand}`;
}

function parseRange(from?: unknown, to?: unknown) {
  const start = from ? new Date(String(from)) : new Date(Date.now() - 29 * 86_400_000);
  const end   = to   ? new Date(String(to))   : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ── GET /api/payments/reports/summary ─────────────────────────────────────────

router.get('/reports/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);

    const [agg] = await Payment.aggregate([
      { $match: { hotelId, createdAt: { $gte: start, $lte: end } } },
      {
        $facet: {
          overall: [
            {
              $group: {
                _id:            null,
                total:          { $sum: 1 },
                totalAmount:    { $sum: '$amount' },
                successAmount:  { $sum: { $cond: [{ $eq: ['$status', 'success'] }, '$amount', 0] } },
                successCount:   { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
                failedCount:    { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                pendingCount:   { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                refundedAmount: { $sum: '$refundedAmount' },
              },
            },
          ],
          byGateway: [
            { $group: { _id: '$gatewayType', count: { $sum: 1 }, amount: { $sum: '$amount' }, successCount: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } } } },
            { $sort: { amount: -1 } },
          ],
          byMethod: [
            { $match: { status: 'success' } },
            { $group: { _id: '$paymentMethod', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
            { $sort: { amount: -1 } },
          ],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
          ],
          dailyTrend: [
            { $match: { status: 'success' } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]);

    const ov = agg?.overall?.[0] ?? {};
    const successRate = ov.total > 0 ? +((ov.successCount / ov.total) * 100).toFixed(1) : 0;

    return res.json({
      period: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
      summary: {
        total:          ov.total          ?? 0,
        totalAmount:    +(((ov.totalAmount   ?? 0) / 100).toFixed(2)),   // paise → rupees
        successAmount:  +(((ov.successAmount ?? 0) / 100).toFixed(2)),
        successCount:   ov.successCount   ?? 0,
        failedCount:    ov.failedCount    ?? 0,
        pendingCount:   ov.pendingCount   ?? 0,
        refundedAmount: +(((ov.refundedAmount ?? 0) / 100).toFixed(2)),
        successRate,
      },
      byGateway:   (agg?.byGateway ?? []).map((g: { _id: string; count: number; amount: number; successCount: number }) => ({
        gatewayType:  g._id,
        count:        g.count,
        amount:       +((g.amount / 100).toFixed(2)),
        successRate:  g.count > 0 ? +((g.successCount / g.count) * 100).toFixed(1) : 0,
      })),
      byMethod:    (agg?.byMethod ?? []).map((m: { _id: string; count: number; amount: number }) => ({ method: m._id, count: m.count, amount: +((m.amount / 100).toFixed(2)) })),
      byStatus:    (agg?.byStatus ?? []).map((s: { _id: string; count: number; amount: number }) => ({ status: s._id, count: s.count, amount: +((s.amount / 100).toFixed(2)) })),
      dailyTrend:  (agg?.dailyTrend ?? []).map((d: { _id: string; count: number; amount: number }) => ({ date: d._id, count: d.count, amount: +((d.amount / 100).toFixed(2)) })),
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch payment report', err);
  }
});

// ── GET /api/payments ─────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, status, gateway, method, page = '1', limit = '20' } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);

    const filter: Record<string, unknown> = { hotelId, createdAt: { $gte: start, $lte: end } };
    if (status)  filter.status = status;
    if (gateway) filter.gatewayType = gateway;
    if (method)  filter.paymentMethod = method;

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Number(limit));
    const lim  = Math.min(100, Number(limit));

    const [payments, total] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
      Payment.countDocuments(filter),
    ]);

    const safePayments = payments.map(p => ({
      ...p,
      amount:         +((p.amount / 100).toFixed(2)),
      refundedAmount: +((p.refundedAmount / 100).toFixed(2)),
      refunds: p.refunds.map(r => ({ ...r, amount: +((r.amount / 100).toFixed(2)) })),
    }));

    return res.json({ payments: safePayments, total, page: Number(page), limit: lim });
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch payments', err);
  }
});

// ── GET /api/payments/status/:txnId ──────────────────────────────────────────

router.get('/status/:txnId', async (req: AuthRequest, res: Response) => {
  try {
    const payment = await Payment.findOne({ internalTransactionId: req.params.txnId, hotelId: req.hotelId }).lean();
    if (!payment) return res.status(404).json({ message: 'Transaction not found' });
    return res.json({
      ...payment,
      amount:         +((payment.amount / 100).toFixed(2)),
      refundedAmount: +((payment.refundedAmount / 100).toFixed(2)),
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch payment status', err);
  }
});

// ── GET /api/payments/:id ─────────────────────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const payment = await Payment.findOne({ _id: req.params.id, hotelId: req.hotelId }).lean();
    if (!payment) return res.status(404).json({ message: 'Payment not found' });
    return res.json({
      ...payment,
      amount:         +((payment.amount / 100).toFixed(2)),
      refundedAmount: +((payment.refundedAmount / 100).toFixed(2)),
      refunds: payment.refunds.map(r => ({ ...r, amount: +((r.amount / 100).toFixed(2)) })),
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch payment', err);
  }
});

// ── POST /api/payments/create ─────────────────────────────────────────────────

router.post('/create', async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, amount, currency = 'INR', customerName, customerEmail, customerPhone, description } = req.body as {
      orderId: string; amount: number; currency?: string;
      customerName?: string; customerEmail?: string; customerPhone?: string; description?: string;
    };

    if (!orderId || !amount || amount <= 0) {
      return res.status(400).json({ message: 'orderId and amount (> 0) are required' });
    }

    // Validate order belongs to hotel
    const order = await Order.findOne({ _id: orderId, hotelId: req.hotelId });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // P0-1: Prevent client-controlled under/over-payment — amount must be within ₹1 of order total
    if (Math.abs(amount - order.grandTotal) > 1) {
      return res.status(400).json({
        message: `Payment amount ₹${amount.toFixed(2)} does not match order total ₹${order.grandTotal.toFixed(2)}`,
      });
    }

    // Reject duplicate payment if the order already has a successful payment.
    const existingSuccess = await Payment.findOne({
      orderId: new mongoose.Types.ObjectId(orderId),
      hotelId: req.hotelId,
      status:  'success',
    });
    if (existingSuccess) {
      return res.status(409).json({ message: 'Order already has a successful payment.' });
    }

    // Find active gateway
    const gatewayConfig = await PaymentGatewayConfig.findOne({ hotelId: req.hotelId, isActive: true, isDeleted: false });
    if (!gatewayConfig) {
      return res.status(422).json({ message: 'No active payment gateway configured. Enable a gateway in Payment Settings.' });
    }

    const internalTransactionId = generateTxnId();
    const amountPaise = Math.round(amount * 100); // convert rupees to paise

    // Create payment record first (status: pending)
    const payment = await Payment.create({
      hotelId:               new mongoose.Types.ObjectId(req.hotelId),
      orderId:               new mongoose.Types.ObjectId(orderId),
      internalTransactionId,
      gatewayType:           gatewayConfig.gatewayType,
      status:                'pending',
      amount:                amountPaise,
      currency:              currency.toUpperCase(),
      initiatedBy:           req.hotelId ?? 'system',
    });

    // Attempt to call gateway SDK (will fail gracefully if SDK not yet integrated)
    let gatewayData: Record<string, unknown> = {};
    let gatewayError: string | null = null;

    if (GatewayFactory.isRegistered(gatewayConfig.gatewayType)) {
      try {
        const effectiveConfig = gatewayConfig.isOAuthConnected
          ? await ensureValidOAuthConfig(gatewayConfig)
          : gatewayConfig;
        const gateway = GatewayFactory.create(effectiveConfig);
        const result = await gateway.createPayment({
          amount:                amountPaise,
          currency,
          orderId,
          hotelId:               req.hotelId!,
          internalTransactionId,
          customerName, customerEmail, customerPhone, description,
        });
        gatewayData = result as unknown as Record<string, unknown>;

        // Update with gateway IDs
        payment.gatewayTransactionId = result.gatewayTransactionId;
        payment.gatewayOrderId       = result.gatewayOrderId ?? '';
        payment.status               = 'processing';
        payment.gatewayResponse      = result as unknown as Record<string, unknown>;
        await payment.save();
      } catch (e) {
        gatewayError = (e as Error).message;
        payment.status        = 'failed';
        payment.failureReason = gatewayError;
        await payment.save();
      }
    } else {
      gatewayError = `Gateway '${gatewayConfig.gatewayType}' SDK is not yet integrated. Payment recorded as pending.`;
    }

    logAudit(req, 'payment_created', 'Payment', String(payment._id), {
      orderId, amount, gatewayType: gatewayConfig.gatewayType, internalTransactionId,
    });

    return res.status(201).json({
      payment: {
        ...payment.toObject(),
        amount: +((payment.amount / 100).toFixed(2)),
      },
      gatewayData,
      gatewayError,
      gatewayIntegrated: GatewayFactory.isRegistered(gatewayConfig.gatewayType),
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to create payment', err);
  }
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────

router.post('/verify', async (req: AuthRequest, res: Response) => {
  try {
    const { internalTransactionId, gatewayTransactionId, signature } = req.body as {
      internalTransactionId: string; gatewayTransactionId?: string; signature?: string;
    };

    if (!internalTransactionId) {
      return res.status(400).json({ message: 'internalTransactionId is required' });
    }

    const payment = await Payment.findOne({ internalTransactionId, hotelId: req.hotelId });
    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    if (payment.status === 'success') {
      return res.json({ verified: true, payment: { ...payment.toObject(), amount: +((payment.amount / 100).toFixed(2)) } });
    }

    const gatewayConfig = await PaymentGatewayConfig.findOne({ hotelId: req.hotelId, gatewayType: payment.gatewayType, isDeleted: false });

    if (!gatewayConfig || !GatewayFactory.isRegistered(payment.gatewayType as Parameters<typeof GatewayFactory.isRegistered>[0])) {
      return res.json({
        verified:          false,
        gatewayIntegrated: false,
        message:           `Gateway '${payment.gatewayType}' SDK is not yet integrated. Manual verification required.`,
        payment:           { ...payment.toObject(), amount: +((payment.amount / 100).toFixed(2)) },
      });
    }

    try {
      const effectiveConfig = gatewayConfig.isOAuthConnected
        ? await ensureValidOAuthConfig(gatewayConfig)
        : gatewayConfig;
      const gateway = GatewayFactory.create(effectiveConfig);
      const result = await gateway.verifyPayment({
        gatewayTransactionId: gatewayTransactionId ?? payment.gatewayTransactionId,
        gatewayOrderId:       payment.gatewayOrderId,
        signature,
      });

      payment.status          = result.status;
      payment.paymentMethod   = result.paymentMethod ?? 'other';
      payment.gatewayResponse = { ...payment.gatewayResponse, verify: result.gatewayResponse };
      if (gatewayTransactionId) payment.gatewayTransactionId = gatewayTransactionId;
      await payment.save();

      // Loyalty earn — atomic claim prevents double-earn with concurrent webhook
      if (result.status === 'success') {
        ;(async () => {
          try {
            // Atomic claim: only the first caller (verify OR webhook) wins this update.
            // findOneAndUpdate returns the OLD doc; null means loyaltyEarnedAt was already set.
            const claimed = await Payment.findOneAndUpdate(
              { _id: payment._id, hotelId: req.hotelId, loyaltyEarnedAt: null },
              { $set: { loyaltyEarnedAt: new Date() } },
            );
            if (!claimed) return; // webhook already claimed the earn slot

            const order = await Order.findOne({ _id: payment.orderId, hotelId: req.hotelId }).lean();
            if (!order) return;
            const customerPhone: string | undefined = (order as any).customerPhone;
            if (!customerPhone) return;

            const loyaltyCfg = await getLoyaltyConfig(req.hotelId!);
            if (!loyaltyCfg.enabled) return;

            const profile = await CustomerProfile.findOne({
              hotelId: new mongoose.Types.ObjectId(req.hotelId),
              phone:   customerPhone,
              status:  'active',
              loyaltyOptOut: { $ne: true },
            }).select('_id').lean();
            if (!profile) return;

            const billAmount = (order as any).grandTotal ?? ((payment.amount - payment.refundedAmount) / 100);
            const pts = calculateEarnedPoints(billAmount, loyaltyCfg);
            if (pts <= 0) return;

            await earnPoints(
              (profile as any)._id,
              req.hotelId!,
              pts,
              loyaltyCfg,
              {
                orderId:   String(payment.orderId),
                paymentId: String(payment._id),
                createdBy: 'system:payment_verify',
              },
            );

            // Stamp loyaltyEarnPoints (loyaltyEarnedAt already set by the atomic claim above)
            await Payment.updateOne(
              { _id: payment._id },
              { $set: { loyaltyEarnPoints: pts } },
            );
          } catch (e) {
            logger.warn('[loyalty] earn on payment verify failed', {
              paymentId: String(payment._id),
              err: String(e),
            });
          }
        })();
      }

      logAudit(req, 'payment_verified', 'Payment', String(payment._id), { status: result.status });
      return res.json({ verified: result.success, payment: { ...payment.toObject(), amount: +((payment.amount / 100).toFixed(2)) } });
    } catch (e) {
      return sendError(res, 502, 'Gateway verification failed: ' + (e as Error).message);
    }
  } catch (err) {
    return sendError(res, 500, 'Failed to verify payment', err);
  }
});

// ── POST /api/payments/:id/refund ─────────────────────────────────────────────

router.post('/:id/refund', async (req: AuthRequest, res: Response) => {
  try {
    // Read snapshot for validation and gateway lookup (not the authoritative balance)
    const snapshot = await Payment.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!snapshot) return res.status(404).json({ message: 'Payment not found' });

    if (!['success', 'partial_refunded'].includes(snapshot.status)) {
      return res.status(400).json({ message: `Cannot refund a payment with status '${snapshot.status}'` });
    }

    const { amount, reason } = req.body as { amount: number; reason?: string };
    if (!amount || amount <= 0) return res.status(400).json({ message: 'amount (> 0 in rupees) is required' });

    const amountPaise = Math.round(amount * 100);
    const maxRefund   = snapshot.amount - snapshot.refundedAmount;
    if (amountPaise > maxRefund) {
      return res.status(400).json({ message: `Maximum refundable amount is ₹${(maxRefund / 100).toFixed(2)}` });
    }

    const gatewayConfig = await PaymentGatewayConfig.findOne({ hotelId: req.hotelId, gatewayType: snapshot.gatewayType, isDeleted: false });
    const localRefundId = `REF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Acquire advisory lock BEFORE calling the gateway.
    // Prevents the race where gateway fires but the DB write fails (e.g., concurrent refund).
    // Filter matches exact refundedAmount so two concurrent requests can't both acquire.
    const locked = await Payment.findOneAndUpdate(
      {
        _id:              snapshot._id,
        hotelId:          req.hotelId,
        status:           { $in: ['success', 'partial_refunded'] },
        refundedAmount:   snapshot.refundedAmount,
        refundInProgress: { $ne: true },
      },
      { $set: { refundInProgress: true } },
      { new: true },
    );
    if (!locked) {
      return res.status(409).json({
        message: 'Refund rejected: a concurrent refund is in progress or the balance changed. Refresh and retry.',
      });
    }

    let gatewayRefundId: string | null = null;
    let gatewayStatus:   string | null = null;
    let gatewayResponse: unknown       = {};

    if (gatewayConfig && GatewayFactory.isRegistered(snapshot.gatewayType as Parameters<typeof GatewayFactory.isRegistered>[0])) {
      try {
        const effectiveConfig = gatewayConfig.isOAuthConnected
          ? await ensureValidOAuthConfig(gatewayConfig)
          : gatewayConfig;
        const gateway = GatewayFactory.create(effectiveConfig);
        const result  = await gateway.initiateRefund({ gatewayTransactionId: snapshot.gatewayTransactionId, amount: amountPaise, reason });
        gatewayRefundId = result.refundId;
        gatewayStatus   = result.status;
        gatewayResponse = result.gatewayResponse;
      } catch (e) {
        // Gateway failed — release the lock so a retry is possible
        await Payment.updateOne({ _id: locked._id }, { $set: { refundInProgress: false } }).catch(() => {});
        return sendError(res, 502, 'Refund failed: ' + (e as Error).message);
      }
    }

    const actualRefundId = gatewayRefundId ?? localRefundId;
    const newRefunded    = locked.refundedAmount + amountPaise;
    const newRefStatus   = newRefunded >= locked.amount ? 'full'     : 'partial';
    const newPayStatus   = newRefunded >= locked.amount ? 'refunded' : 'partial_refunded';

    const refundEntry = {
      refundId:        actualRefundId,
      amount:          amountPaise,
      reason:          reason ?? '',
      initiatedBy:     req.hotelId ?? 'system',
      refundedAt:      new Date(),
      gatewayResponse,
    };

    // Commit: we hold the lock so no concurrent refund can interfere
    const updated = await Payment.findOneAndUpdate(
      { _id: locked._id, refundInProgress: true },
      {
        $inc:  { refundedAmount: amountPaise },
        $push: { refunds: refundEntry },
        $set:  { refundStatus: newRefStatus, status: newPayStatus, refundInProgress: false },
      },
      { new: true },
    );
    if (!updated) {
      // Extremely unlikely — lock was somehow broken; release and surface error
      await Payment.updateOne({ _id: locked._id }, { $set: { refundInProgress: false } }).catch(() => {});
      return res.status(500).json({ message: 'Refund commit failed. Check payment status and retry.' });
    }

    // Loyalty reversal — reverse earned points on full or partial refund.
    // Idempotent via loyaltyReversedAt. Only reverses if points were earned for this payment.
    if (updated.loyaltyEarnPoints > 0 && !updated.loyaltyReversedAt) {
      ;(async () => {
        try {
          const order = await Order.findOne({ _id: updated.orderId, hotelId: req.hotelId }).lean();
          if (!order) return;
          const customerPhone: string | undefined = (order as any).customerPhone;
          if (!customerPhone) return;

          const profile = await CustomerProfile.findOne({
            hotelId: new mongoose.Types.ObjectId(req.hotelId),
            phone:   customerPhone,
            status:  { $ne: 'merged' },
          }).select('_id').lean();
          if (!profile) return;

          const loyaltyCfg = await getLoyaltyConfig(req.hotelId!);

          // Partial refund: reverse proportional points; full refund: reverse all.
          const refundFraction = amountPaise / locked.amount;
          const ptsToReverse   = Math.round(updated.loyaltyEarnPoints * refundFraction);

          await reverseEarnedPoints(
            (profile as any)._id,
            req.hotelId!,
            ptsToReverse,
            loyaltyCfg,
            {
              orderId:   String(updated.orderId),
              paymentId: String(updated._id),
              createdBy: `system:refund`,
              remarks:   `Reversed ${ptsToReverse} points on refund of ₹${amount}`,
            },
          );

          await Payment.updateOne(
            { _id: updated._id, loyaltyReversedAt: null },
            { $set: { loyaltyReversedAt: new Date() } },
          );
        } catch (e) {
          logger.warn('[loyalty] reversal on refund failed', {
            paymentId: String(updated._id),
            err: String(e),
          });
        }
      })();
    }

    // Gift voucher partial restoration (fire-and-forget, idempotent via per-refund giftVoucherRestoredAt)
    if (newRefStatus === 'partial') {
      const thisRefundAmt = amountPaise;
      ;(async () => {
        try {
          const orderForVoucher = await Order.findOne({ _id: updated.orderId, hotelId: req.hotelId })
            .select('giftVoucherId giftVoucherAmount giftVoucherRestoredAt').lean();
          const vAmt = (orderForVoucher as any)?.giftVoucherAmount as number | undefined;
          if (!orderForVoucher || !(orderForVoucher as any).giftVoucherId || !vAmt || vAmt <= 0) return;
          if ((orderForVoucher as any).giftVoucherRestoredAt) return; // full restoration already claimed
          // Proportional: payment.amount is the post-voucher charge (paise); denominator is consistent
          const restoreAmt = Math.round(vAmt * (thisRefundAmt / updated.amount) * 100) / 100;
          if (restoreAmt <= 0) return;
          // Atomic per-refund claim via arrayFilters — returns null if already claimed
          const claimed = await Payment.findOneAndUpdate(
            {
              _id:     updated._id,
              hotelId: req.hotelId,
              refunds: { $elemMatch: { refundId: actualRefundId, giftVoucherRestoredAt: null } },
            },
            { $set: { 'refunds.$[rf].giftVoucherRestoredAt': new Date() } },
            { arrayFilters: [{ 'rf.refundId': actualRefundId, 'rf.giftVoucherRestoredAt': null }], new: false },
          );
          if (!claimed) return;
          const refNow = new Date();
          await GiftVoucher.findOneAndUpdate(
            { _id: (orderForVoucher as any).giftVoucherId, hotelId: req.hotelId },
            [
              { $set: { balance: { $add: ['$balance', restoreAmt] }, isActive: true } },
              { $set: { transactions: { $concatArrays: [{ $ifNull: ['$transactions', []] }, [{ type: 'refund', amount: restoreAmt, balanceAfter: { $ifNull: ['$balance', 0] }, orderId: updated.orderId, remarks: `Partial refund: Payment ${String(updated._id)} (₹${amount})`, createdBy: 'system:refund', createdAt: refNow }]] } } },
            ] as any,
          );
        } catch (e) {
          logger.warn('[gift-voucher] restoration on partial refund failed', { paymentId: String(updated._id), err: String(e) });
        }
      })();
    }

    // Coupon reversal on full refund (fire-and-forget, idempotent via status field)
    if (newRefStatus === 'full') {
      ;(async () => {
        try {
          const orderForCoupon = await Order.findOne({ _id: updated.orderId, hotelId: req.hotelId }).select('couponId').lean();
          if (!orderForCoupon || !(orderForCoupon as any).couponId) return;
          const claimedRed = await CouponRedemption.findOneAndUpdate(
            { hotelId: req.hotelId, orderId: updated.orderId, status: 'redeemed' },
            { $set: { status: 'reversed', reversedAt: new Date(), reversedReason: 'full_refund' } },
          );
          if (claimedRed) {
            await Coupon.findOneAndUpdate(
              { _id: claimedRed.couponId, hotelId: req.hotelId, usageCount: { $gt: 0 } },
              { $inc: { usageCount: -1 } },
            );
          }
        } catch (e) {
          logger.warn('[coupon] reversal on full refund failed', { paymentId: String(updated._id), err: String(e) });
        }
      })();
    }

    // Gift voucher restoration on full refund (fire-and-forget, idempotent via giftVoucherRestoredAt)
    if (newRefStatus === 'full') {
      ;(async () => {
        try {
          const orderForVoucher = await Order.findOne({ _id: updated.orderId, hotelId: req.hotelId })
            .select('giftVoucherId giftVoucherAmount giftVoucherRestoredAt orderNumber').lean();
          const vAmt = (orderForVoucher as any)?.giftVoucherAmount as number | undefined;
          if (!orderForVoucher || !(orderForVoucher as any).giftVoucherId || !vAmt || vAmt <= 0) return;
          if ((orderForVoucher as any).giftVoucherRestoredAt) return;
          const claimedOrder = await Order.findOneAndUpdate(
            { _id: updated.orderId, hotelId: req.hotelId, giftVoucherRestoredAt: null },
            { $set: { giftVoucherRestoredAt: new Date() } },
          );
          if (!claimedOrder) return;
          const refNow = new Date();
          await GiftVoucher.findOneAndUpdate(
            {
              _id: (orderForVoucher as any).giftVoucherId,
              hotelId: req.hotelId,
              transactions: { $not: { $elemMatch: { type: 'refund', orderId: updated.orderId } } },
            },
            [
              { $set: { balance: { $add: ['$balance', vAmt] }, isActive: true } },
              { $set: { transactions: { $concatArrays: [{ $ifNull: ['$transactions', []] }, [{ type: 'refund', amount: vAmt, balanceAfter: { $ifNull: ['$balance', 0] }, orderId: updated.orderId, remarks: `Full refund: Payment ${String(updated._id)}`, createdBy: 'system:refund', createdAt: refNow }]] } } },
            ] as any,
          );
        } catch (e) {
          logger.warn('[gift-voucher] restoration on full refund failed', { paymentId: String(updated._id), err: String(e) });
        }
      })();
    }

    const isPendingGateway = !gatewayRefundId;
    logAudit(req, 'refund_initiated', 'Payment', String(updated._id), {
      refundId: actualRefundId, amount,
      status:   isPendingGateway ? 'pending_gateway' : 'processed',
    });

    return res.json({
      refundId: actualRefundId,
      status:   gatewayStatus ?? 'pending',
      ...(isPendingGateway && { message: `Refund recorded. Gateway '${snapshot.gatewayType}' SDK needs to be integrated to process it.` }),
      payment:  { ...updated.toObject(), amount: +((updated.amount / 100).toFixed(2)), refundedAmount: +((updated.refundedAmount / 100).toFixed(2)) },
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to initiate refund', err);
  }
});

export default router;
