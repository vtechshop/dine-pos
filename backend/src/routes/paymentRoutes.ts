import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Payment from '../models/Payment';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import Order from '../models/Order';
import GatewayFactory from '../services/payment/GatewayFactory';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';
import { logAudit } from '../utils/audit';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

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
        const gateway = GatewayFactory.create(gatewayConfig);
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
      const gateway = GatewayFactory.create(gatewayConfig);
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
    const payment = await Payment.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    if (!['success', 'partial_refunded'].includes(payment.status)) {
      return res.status(400).json({ message: `Cannot refund a payment with status '${payment.status}'` });
    }

    const { amount, reason } = req.body as { amount: number; reason?: string };
    if (!amount || amount <= 0) return res.status(400).json({ message: 'amount (> 0 in rupees) is required' });

    const amountPaise  = Math.round(amount * 100);
    const maxRefund    = payment.amount - payment.refundedAmount;

    if (amountPaise > maxRefund) {
      return res.status(400).json({ message: `Maximum refundable amount is ₹${(maxRefund / 100).toFixed(2)}` });
    }

    const gatewayConfig = await PaymentGatewayConfig.findOne({ hotelId: req.hotelId, gatewayType: payment.gatewayType, isDeleted: false });

    if (!gatewayConfig || !GatewayFactory.isRegistered(payment.gatewayType as Parameters<typeof GatewayFactory.isRegistered>[0])) {
      // Record refund as pending (to be processed manually or when SDK is integrated)
      const refundId = `REF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      payment.refunds.push({ refundId, amount: amountPaise, reason: reason ?? '', initiatedBy: req.hotelId ?? 'system', refundedAt: new Date(), gatewayResponse: {} });
      payment.refundedAmount += amountPaise;
      payment.refundStatus    = payment.refundedAmount >= payment.amount ? 'full' : 'partial';
      payment.status          = payment.refundedAmount >= payment.amount ? 'refunded' : 'partial_refunded';
      await payment.save();

      logAudit(req, 'refund_initiated', 'Payment', String(payment._id), { refundId, amount, status: 'pending_gateway' });
      return res.json({
        refundId,
        status:            'pending',
        message:           `Refund recorded. Gateway '${payment.gatewayType}' SDK needs to be integrated to process it.`,
        payment:           { ...payment.toObject(), amount: +((payment.amount / 100).toFixed(2)), refundedAmount: +((payment.refundedAmount / 100).toFixed(2)) },
      });
    }

    try {
      const gateway = GatewayFactory.create(gatewayConfig);
      const result = await gateway.initiateRefund({ gatewayTransactionId: payment.gatewayTransactionId, amount: amountPaise, reason });

      payment.refunds.push({ refundId: result.refundId, amount: amountPaise, reason: reason ?? '', initiatedBy: req.hotelId ?? 'system', refundedAt: new Date(), gatewayResponse: result.gatewayResponse });
      payment.refundedAmount += amountPaise;
      payment.refundStatus    = payment.refundedAmount >= payment.amount ? 'full' : 'partial';
      payment.status          = payment.refundedAmount >= payment.amount ? 'refunded' : 'partial_refunded';
      await payment.save();

      logAudit(req, 'refund_initiated', 'Payment', String(payment._id), { refundId: result.refundId, amount });
      return res.json({
        refundId:  result.refundId,
        status:    result.status,
        payment:   { ...payment.toObject(), amount: +((payment.amount / 100).toFixed(2)), refundedAmount: +((payment.refundedAmount / 100).toFixed(2)) },
      });
    } catch (e) {
      return sendError(res, 502, 'Refund failed: ' + (e as Error).message);
    }
  } catch (err) {
    return sendError(res, 500, 'Failed to initiate refund', err);
  }
});

export default router;
