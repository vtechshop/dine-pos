import { Router, Response } from 'express';
import mongoose from 'mongoose';
import VendorPayment from '../models/VendorPayment';
import VendorLedgerEntry from '../models/VendorLedgerEntry';
import Vendor from '../models/Vendor';
import DailyCounter from '../models/DailyCounter';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware, requireAdmin);
router.use(requireFeature('supplyChain'));

// ── GET /report ───────────────────────────────────────────────────────────────

router.get('/report', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const { from, to } = req.query as Record<string, string>;

    const payFilter: Record<string, unknown> = { hotelId, isDeleted: false, isReversed: false };
    if (from || to) {
      const dr: Record<string, Date> = {};
      if (from) dr.$gte = new Date(from);
      if (to)   dr.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      payFilter.paymentDate = dr;
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [paymentsAgg, methodAgg, monthAgg, outstandingAgg] = await Promise.all([
      VendorPayment.aggregate([
        { $match: payFilter },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      VendorPayment.aggregate([
        { $match: payFilter },
        { $group: { _id: '$paymentMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      VendorPayment.aggregate([
        {
          $match: {
            hotelId,
            isDeleted: false,
            isReversed: false,
            paymentDate: { $gte: monthStart, $lte: now },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Vendor.aggregate([
        { $match: { hotelId, isDeleted: false } },
        {
          $group: {
            _id: null,
            totalOutstanding: { $sum: '$currentOutstanding' },
            vendorsWithOutstanding: {
              $sum: { $cond: [{ $gt: ['$currentOutstanding', 0] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const outstandingVendors = await Vendor.find({
      hotelId, isDeleted: false, currentOutstanding: { $gt: 0 },
    })
      .sort({ currentOutstanding: -1 })
      .limit(20)
      .select('businessName vendorCode mobile email currentOutstanding creditLimit paymentTerms')
      .lean();

    return res.json({
      totalPayments:          paymentsAgg[0]?.total ?? 0,
      paymentCount:           paymentsAgg[0]?.count ?? 0,
      paymentThisMonth:       monthAgg[0]?.total ?? 0,
      paymentCountThisMonth:  monthAgg[0]?.count ?? 0,
      totalOutstanding:       outstandingAgg[0]?.totalOutstanding ?? 0,
      vendorsWithOutstanding: outstandingAgg[0]?.vendorsWithOutstanding ?? 0,
      byMethod:               methodAgg,
      outstandingVendors,
    });
  } catch (err) {
    return sendError(res, 500, 'Payment report failed', err);
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const {
      vendorId, from, to, method, reversed,
      search, sort = 'paymentDate', dir = 'desc',
      limit = '50', skip = '0',
    } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { hotelId, isDeleted: false };
    if (vendorId)             filter.vendorId       = new mongoose.Types.ObjectId(vendorId);
    if (method)               filter.paymentMethod  = method;
    if (reversed === 'true')  filter.isReversed     = true;
    if (reversed === 'false') filter.isReversed     = false;

    if (from || to) {
      const dr: Record<string, Date> = {};
      if (from) dr.$gte = new Date(from);
      if (to)   dr.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      filter.paymentDate = dr;
    }

    if (search) {
      const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { paymentNumber: re },
        { 'vendorSnapshot.businessName': re },
        { referenceNumber: re },
        { notes: re },
      ];
    }

    const SORT_WHITELIST = new Set(['paymentDate', 'amount', 'createdAt', 'paymentNumber']);
    const sortField = SORT_WHITELIST.has(sort) ? sort : 'paymentDate';
    const sortDir   = dir === 'asc' ? 1 : -1;
    const lim       = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const sk        = Math.max(0, parseInt(skip, 10) || 0);

    const [payments, total] = await Promise.all([
      VendorPayment.find(filter)
        .sort({ [sortField]: sortDir })
        .skip(sk)
        .limit(lim)
        .lean(),
      VendorPayment.countDocuments(filter),
    ]);

    return res.json({ payments, total, limit: lim, skip: sk });
  } catch (err) {
    return sendError(res, 500, 'Failed to list payments', err);
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const payment = await VendorPayment.findOne({ _id: req.params.id, hotelId, isDeleted: false }).lean();
    if (!payment) return sendError(res, 404, 'Payment not found');
    return res.json(payment);
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch payment', err);
  }
});

// ── POST / — Create payment ───────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const { vendorId, paymentDate, paymentMethod, amount, referenceNumber, notes, attachment } = req.body as Record<string, unknown>;

    if (!vendorId)                      return sendError(res, 400, 'vendorId is required');
    if (!paymentMethod)                 return sendError(res, 400, 'paymentMethod is required');
    if (!amount || Number(amount) <= 0) return sendError(res, 400, 'amount must be greater than 0');

    // M-9: idempotency check (hotel-scoped)
    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idemKey) {
      const existing = await VendorPayment.findOne({ hotelId, idempotencyKey: idemKey }).lean();
      if (existing) return res.status(201).json(existing);
    }

    const vendor = await Vendor.findOne({ _id: String(vendorId), hotelId, isDeleted: false });
    if (!vendor) return sendError(res, 404, 'Vendor not found');

    const ctr = await DailyCounter.findOneAndUpdate(
      { key: `PAY-${req.hotelId}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const paymentNumber = `PAY-${String(ctr.seq).padStart(4, '0')}`;
    const amt = Number(amount);

    const session = await mongoose.startSession();
    let payment: InstanceType<typeof VendorPayment>;
    await session.withTransaction(async () => {
      [payment] = await VendorPayment.create([{
        hotelId,
        paymentNumber,
        vendorId:        new mongoose.Types.ObjectId(String(vendorId)),
        vendorSnapshot:  { businessName: vendor.businessName, vendorCode: vendor.vendorCode, mobile: vendor.mobile },
        paymentDate:     paymentDate ? new Date(String(paymentDate)) : new Date(),
        paymentMethod:   String(paymentMethod),
        amount:          amt,
        referenceNumber: String(referenceNumber || ''),
        notes:           String(notes || ''),
        attachment:      String(attachment || ''),
        createdBy:       req.cashierId || req.waiterId || req.hotelId || '',
        ...(idemKey ? { idempotencyKey: idemKey } : {}),
      }], { session });
      const updatedVendor = await Vendor.findOneAndUpdate(
        { _id: vendor._id, hotelId },
        [{ $set: { currentOutstanding: { $max: [0, { $subtract: ['$currentOutstanding', amt] }] } } }],
        { new: true, session },
      );
      await VendorLedgerEntry.create([{
        hotelId,
        vendorId:        vendor._id,
        entryType:       'payment',
        referenceId:     payment!._id,
        referenceNumber: paymentNumber,
        debit:           0,
        credit:          amt,
        runningBalance:  updatedVendor?.currentOutstanding ?? 0,
        description:     `Payment via ${paymentMethod}${referenceNumber ? ` (ref: ${referenceNumber})` : ''}`,
      }], { session });
    });
    await session.endSession();

    logAudit(req, 'vendor_payment.created', 'vendor_payment', String(payment!._id), {
      paymentNumber, vendorId, amount: amt, paymentMethod,
    });

    return res.status(201).json(payment!);
  } catch (err: any) {
    // HIGH-3: concurrent request with same idempotency key lost the unique-index race
    if (err?.code === 11000 && err?.keyPattern?.idempotencyKey) {
      const k = req.headers['x-idempotency-key'] as string | undefined;
      if (k) {
        const saved = await VendorPayment.findOne({ hotelId: new mongoose.Types.ObjectId(req.hotelId!), idempotencyKey: k }).lean();
        if (saved) return res.status(201).json(saved);
      }
    }
    return sendError(res, 500, 'Failed to create payment', err);
  }
});

// ── PUT /:id — Update (only non-reversed, non-deleted) ───────────────────────

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const payment = await VendorPayment.findOne({ _id: req.params.id, hotelId, isDeleted: false });
    if (!payment)           return sendError(res, 404, 'Payment not found');
    if (payment.isReversed) return sendError(res, 400, 'Cannot update a reversed payment');

    const { paymentDate, paymentMethod, referenceNumber, notes, attachment, amount } = req.body as Record<string, unknown>;

    if (amount !== undefined) {
      const newAmt = Number(amount);
      if (newAmt <= 0) return sendError(res, 400, 'amount must be greater than 0');
      const diff = newAmt - payment.amount;

      const session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const updatedVendor = await Vendor.findOneAndUpdate(
          { _id: payment.vendorId, hotelId },
          { $inc: { currentOutstanding: -diff } },
          { new: true, session },
        );
        await VendorLedgerEntry.create([{
          hotelId,
          vendorId:        payment.vendorId,
          entryType:       'adjustment',
          referenceId:     payment._id,
          referenceNumber: payment.paymentNumber,
          debit:           diff < 0 ? Math.abs(diff) : 0,
          credit:          diff > 0 ? diff : 0,
          runningBalance:  updatedVendor?.currentOutstanding ?? 0,
          description:     `Payment ${payment.paymentNumber} amount updated (${diff > 0 ? '+' : ''}${diff.toFixed(2)})`,
        }], { session });
        payment.amount = newAmt;
        await payment.save({ session });
      });
      await session.endSession();
    }

    if (paymentDate     !== undefined) payment.paymentDate     = new Date(String(paymentDate));
    if (paymentMethod   !== undefined) payment.paymentMethod   = String(paymentMethod) as typeof payment.paymentMethod;
    if (referenceNumber !== undefined) payment.referenceNumber = String(referenceNumber);
    if (notes           !== undefined) payment.notes           = String(notes);
    if (attachment      !== undefined) payment.attachment      = String(attachment);

    if (amount === undefined) await payment.save();

    logAudit(req, 'vendor_payment.updated', 'vendor_payment', String(payment._id), {
      paymentNumber: payment.paymentNumber,
    });

    return res.json(payment);
  } catch (err) {
    return sendError(res, 500, 'Failed to update payment', err);
  }
});

// ── DELETE /:id — Soft-delete (reverses balance if not already reversed) ──────

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const payment = await VendorPayment.findOne({ _id: req.params.id, hotelId, isDeleted: false });
    if (!payment) return sendError(res, 404, 'Payment not found');

    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      if (!payment.isReversed) {
        const updatedVendor = await Vendor.findOneAndUpdate(
          { _id: payment.vendorId, hotelId },
          { $inc: { currentOutstanding: payment.amount } },
          { new: true, session },
        );
        await VendorLedgerEntry.create([{
          hotelId,
          vendorId:        payment.vendorId,
          entryType:       'adjustment',
          referenceId:     payment._id,
          referenceNumber: payment.paymentNumber,
          debit:           payment.amount,
          credit:          0,
          runningBalance:  updatedVendor?.currentOutstanding ?? 0,
          description:     `Payment ${payment.paymentNumber} deleted (auto-reversal)`,
        }], { session });
      }
      payment.isDeleted = true;
      await payment.save({ session });
    });
    await session.endSession();

    logAudit(req, 'vendor_payment.deleted', 'vendor_payment', String(payment._id), {
      paymentNumber: payment.paymentNumber, amount: payment.amount,
    });

    return res.json({ success: true });
  } catch (err) {
    return sendError(res, 500, 'Failed to delete payment', err);
  }
});

// ── POST /:id/reverse ─────────────────────────────────────────────────────────

router.post('/:id/reverse', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const payment = await VendorPayment.findOne({ _id: req.params.id, hotelId, isDeleted: false });
    if (!payment)           return sendError(res, 404, 'Payment not found');
    if (payment.isReversed) return sendError(res, 400, 'Payment is already reversed');

    const { reason } = req.body as { reason?: string };

    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const updatedVendor = await Vendor.findOneAndUpdate(
        { _id: payment.vendorId, hotelId },
        { $inc: { currentOutstanding: payment.amount } },
        { new: true, session },
      );
      await VendorLedgerEntry.create([{
        hotelId,
        vendorId:        payment.vendorId,
        entryType:       'adjustment',
        referenceId:     payment._id,
        referenceNumber: payment.paymentNumber,
        debit:           payment.amount,
        credit:          0,
        runningBalance:  updatedVendor?.currentOutstanding ?? 0,
        description:     `Reversal of payment ${payment.paymentNumber}${reason ? `: ${reason}` : ''}`,
      }], { session });
      payment.isReversed     = true;
      payment.reversedBy     = req.cashierId || req.waiterId || req.hotelId || '';
      payment.reversedAt     = new Date();
      payment.reversalReason = String(reason || '');
      await payment.save({ session });
    });
    await session.endSession();

    logAudit(req, 'vendor_payment.reversed', 'vendor_payment', String(payment._id), {
      paymentNumber: payment.paymentNumber, amount: payment.amount, reason,
    });

    return res.json(payment);
  } catch (err) {
    return sendError(res, 500, 'Failed to reverse payment', err);
  }
});

export default router;
