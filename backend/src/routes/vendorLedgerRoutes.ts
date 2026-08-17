import { Router, Response } from 'express';
import mongoose from 'mongoose';
import VendorLedgerEntry from '../models/VendorLedgerEntry';
import VendorPayment from '../models/VendorPayment';
import Vendor from '../models/Vendor';
import GRN from '../models/GRN';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware, requireAdmin);

// ── GET /report — outstanding dashboard + aging ───────────────────────────────

router.get('/report', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const now     = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [vendorStats, payThisMonth, recentPayments, agingAgg] = await Promise.all([
      Vendor.aggregate([
        { $match: { hotelId, isDeleted: false } },
        {
          $group: {
            _id: null,
            totalVendors: { $sum: 1 },
            vendorsWithOutstanding: {
              $sum: { $cond: [{ $gt: ['$currentOutstanding', 0] }, 1, 0] },
            },
            totalOutstanding: { $sum: '$currentOutstanding' },
          },
        },
      ]),
      VendorPayment.aggregate([
        {
          $match: {
            hotelId, isDeleted: false, isReversed: false,
            paymentDate: { $gte: monthStart, $lte: now },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      VendorPayment.find({ hotelId, isDeleted: false, isReversed: false })
        .sort({ paymentDate: -1 })
        .limit(5)
        .lean(),
      GRN.aggregate([
        { $match: { hotelId, isDeleted: false, status: { $ne: 'cancelled' } } },
        {
          $addFields: {
            daysOld: { $divide: [{ $subtract: [now, '$receiveDate'] }, 86400000] },
            grnValue: {
              $reduce: {
                input: '$items',
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    {
                      $multiply: [
                        { $max: [0, { $subtract: ['$$this.receivedQty', '$$this.rejectedQty'] }] },
                        '$$this.purchasePrice',
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            current:  { $sum: { $cond: [{ $lte: ['$daysOld', 30] }, '$grnValue', 0] } },
            days31_60: { $sum: { $cond: [{ $and: [{ $gt: ['$daysOld', 30] }, { $lte: ['$daysOld', 60] }] }, '$grnValue', 0] } },
            days61_90: { $sum: { $cond: [{ $and: [{ $gt: ['$daysOld', 60] }, { $lte: ['$daysOld', 90] }] }, '$grnValue', 0] } },
            over90:   { $sum: { $cond: [{ $gt: ['$daysOld', 90] }, '$grnValue', 0] } },
          },
        },
      ]),
    ]);

    const outstandingVendors = await Vendor.find({
      hotelId, isDeleted: false, currentOutstanding: { $gt: 0 },
    })
      .sort({ currentOutstanding: -1 })
      .limit(10)
      .select('businessName vendorCode mobile email currentOutstanding creditLimit paymentTerms')
      .lean();

    return res.json({
      totalVendors:           vendorStats[0]?.totalVendors ?? 0,
      vendorsWithOutstanding: vendorStats[0]?.vendorsWithOutstanding ?? 0,
      totalOutstanding:       vendorStats[0]?.totalOutstanding ?? 0,
      paymentThisMonth:       payThisMonth[0]?.total ?? 0,
      paymentCountThisMonth:  payThisMonth[0]?.count ?? 0,
      outstandingVendors,
      recentPayments,
      aging: agingAgg[0] ?? { current: 0, days31_60: 0, days61_90: 0, over90: 0 },
    });
  } catch (err) {
    return sendError(res, 500, 'Ledger report failed', err);
  }
});

// ── GET /:vendorId/statement — full statement (chronological) ─────────────────

router.get('/:vendorId/statement', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = new mongoose.Types.ObjectId(req.hotelId!);
    const { vendorId } = req.params;
    const { from, to } = req.query as Record<string, string>;

    const vendor = await Vendor.findOne({ _id: vendorId, hotelId, isDeleted: false }).lean();
    if (!vendor) return sendError(res, 404, 'Vendor not found');

    const filter: Record<string, unknown> = {
      hotelId,
      vendorId: new mongoose.Types.ObjectId(vendorId),
    };
    if (from || to) {
      const dr: Record<string, Date> = {};
      if (from) dr.$gte = new Date(from);
      if (to)   dr.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      filter.createdAt = dr;
    }

    const entries = await VendorLedgerEntry.find(filter).sort({ createdAt: 1 }).lean();
    const totalDebit  = entries.reduce((s, e) => s + e.debit,  0);
    const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

    return res.json({
      vendor,
      entries,
      totalDebit,
      totalCredit,
      openingBalance:     vendor.openingBalance,
      currentOutstanding: vendor.currentOutstanding,
      generatedAt:        new Date(),
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to generate statement', err);
  }
});

// ── GET /:vendorId — ledger entries (paginated, newest first) ─────────────────

router.get('/:vendorId', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = new mongoose.Types.ObjectId(req.hotelId!);
    const { vendorId } = req.params;
    const { from, to, type, limit = '100', skip = '0' } = req.query as Record<string, string>;

    const vendor = await Vendor.findOne({ _id: vendorId, hotelId, isDeleted: false }).lean();
    if (!vendor) return sendError(res, 404, 'Vendor not found');

    const filter: Record<string, unknown> = {
      hotelId,
      vendorId: new mongoose.Types.ObjectId(vendorId),
    };
    if (type) filter.entryType = type;
    if (from || to) {
      const dr: Record<string, Date> = {};
      if (from) dr.$gte = new Date(from);
      if (to)   dr.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      filter.createdAt = dr;
    }

    const lim = Math.min(Math.max(1, parseInt(limit, 10) || 100), 500);
    const sk  = Math.max(0, parseInt(skip, 10) || 0);

    const [entries, total] = await Promise.all([
      VendorLedgerEntry.find(filter).sort({ createdAt: -1 }).skip(sk).limit(lim).lean(),
      VendorLedgerEntry.countDocuments(filter),
    ]);

    return res.json({
      vendor,
      entries,
      total,
      limit: lim,
      skip:  sk,
      currentOutstanding: vendor.currentOutstanding,
      openingBalance:     vendor.openingBalance,
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch ledger', err);
  }
});

// ── POST /:vendorId/opening-balance ──────────────────────────────────────────

router.post('/:vendorId/opening-balance', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = new mongoose.Types.ObjectId(req.hotelId!);
    const { vendorId } = req.params;
    const { amount, notes } = req.body as { amount?: unknown; notes?: string };

    if (amount === undefined || amount === null) return sendError(res, 400, 'amount is required');
    const amt = Number(amount);

    const vendor = await Vendor.findOne({ _id: vendorId, hotelId, isDeleted: false });
    if (!vendor) return sendError(res, 404, 'Vendor not found');

    const oldBalance = vendor.openingBalance;
    const diff       = amt - oldBalance;

    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const existing = await VendorLedgerEntry.findOne({
        hotelId, vendorId: new mongoose.Types.ObjectId(vendorId), entryType: 'opening_balance',
      }).session(session);

      if (existing) {
        existing.debit          = amt;
        existing.runningBalance = amt;
        existing.description    = String(notes || 'Opening balance');
        await existing.save({ session });
      } else {
        await VendorLedgerEntry.create([{
          hotelId,
          vendorId,
          entryType:       'opening_balance',
          referenceId:     null,
          referenceNumber: '',
          debit:           amt,
          credit:          0,
          runningBalance:  amt,
          description:     String(notes || 'Opening balance'),
        }], { session });
      }

      vendor.openingBalance     = amt;
      vendor.currentOutstanding = vendor.currentOutstanding + diff;
      await vendor.save({ session });
    });
    await session.endSession();

    logAudit(req, 'vendor_ledger.opening_balance', 'vendor', vendorId, { amount: amt, oldBalance });

    return res.json({
      success:            true,
      openingBalance:     vendor.openingBalance,
      currentOutstanding: vendor.currentOutstanding,
    });
  } catch (err) {
    return sendError(res, 500, 'Failed to set opening balance', err);
  }
});

export default router;
