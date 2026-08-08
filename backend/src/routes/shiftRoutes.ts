import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, requireCashierOrAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import Shift from '../models/Shift';
import Order from '../models/Order';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireFeature('shift'));

// ── POST /api/shifts/open — open a new shift ──────────────────────────────────

router.post('/open', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { cashierName, cashierId, openedAt, openingCash, openingNote } = req.body;
    if (!cashierName || openingCash === undefined) {
      return res.status(400).json({ message: 'cashierName and openingCash are required' });
    }

    // Enforce one open shift per hotel
    const existing = await Shift.findOne({ hotelId: req.hotelId, status: 'open' });
    if (existing) {
      return res.status(409).json({
        message: 'A shift is already open. Close it before opening a new one.',
        shiftId: existing._id,
      });
    }

    const shift = await Shift.create({
      hotelId:     req.hotelId,
      cashierId:   cashierId ?? req.cashierId ?? '',
      cashierName: cashierName.trim(),
      openedAt:    openedAt ? new Date(openedAt) : new Date(),
      openingCash: Number(openingCash) || 0,
      openingNote: (openingNote ?? '').trim(),
      status:      'open',
    });

    logAudit(req, 'shift.opened', 'shift', String(shift._id), { openingCash, cashierName });
    return res.status(201).json({ shift });
  } catch (error: any) {
    // Partial unique index race: two concurrent opens slipped past the findOne guard
    if (error?.code === 11000) {
      const dup = await Shift.findOne({ hotelId: req.hotelId, status: 'open' }).lean();
      return res.status(409).json({
        message: 'A shift is already open. Close it before opening a new one.',
        shiftId: dup?._id ?? null,
      });
    }
    return sendError(res, 500, 'Server error', error);
  }
});

// ── GET /api/shifts/active — current open shift for this hotel ────────────────

router.get('/active', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await Shift.findOne({ hotelId: req.hotelId, status: 'open' }).lean();
    return res.json({ shift: shift ?? null });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── GET /api/shifts/active/stats — live totals for the current open shift ─────
// Only counts completed orders so pending/preparing tickets don't inflate cash.

router.get('/active/stats', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await Shift.findOne({ hotelId: req.hotelId, status: 'open' }).lean();
    if (!shift) {
      return res.json({ totalOrders: 0, totalSales: 0, cashSales: 0, upiSales: 0, cardSales: 0 });
    }

    const [agg] = await Order.aggregate([
      {
        $match: {
          hotelId:   new mongoose.Types.ObjectId(req.hotelId),
          status:    { $in: ['completed'] },
          createdAt: { $gte: shift.openedAt },
        },
      },
      {
        $group: {
          _id:         null,
          totalOrders: { $sum: 1 },
          totalSales:  { $sum: '$grandTotal' },
          cashSales:   { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$grandTotal', 0] } },
          upiSales:    { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi'] },  '$grandTotal', 0] } },
          cardSales:   { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card'] }, '$grandTotal', 0] } },
        },
      },
    ]);

    return res.json({
      totalOrders: agg?.totalOrders ?? 0,
      totalSales:  agg?.totalSales  ?? 0,
      cashSales:   agg?.cashSales   ?? 0,
      upiSales:    agg?.upiSales    ?? 0,
      cardSales:   agg?.cardSales   ?? 0,
    });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── GET /api/shifts — shift history (cashier or admin, paginated) ─────────────

router.get('/', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const skip  = (page - 1) * limit;

    const [shifts, total] = await Promise.all([
      Shift.find({ hotelId: req.hotelId })
        .sort({ openedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Shift.countDocuments({ hotelId: req.hotelId }),
    ]);

    return res.json({ shifts, total, page, pages: Math.ceil(total / limit) });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── GET /api/shifts/:id — single shift detail ─────────────────────────────────

router.get('/:id', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid shift ID' });
    }
    const shift = await Shift.findOne({ _id: req.params.id, hotelId: req.hotelId }).lean();
    if (!shift) return res.status(404).json({ message: 'Shift not found' });
    return res.json({ shift });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── POST /api/shifts/:id/movements — add cash in/out ─────────────────────────

router.post('/:id/movements', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid shift ID' });
    }
    const { type, amount, reason, cashierName } = req.body;
    if (!type || !['cash_in', 'cash_out'].includes(type)) {
      return res.status(400).json({ message: 'type must be cash_in or cash_out' });
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ message: 'amount must be > 0' });

    const shift = await Shift.findOne({ _id: req.params.id, hotelId: req.hotelId, status: 'open' });
    if (!shift) return res.status(404).json({ message: 'Open shift not found' });

    const movement = {
      type,
      amount: amt,
      reason: (reason ?? '').trim(),
      cashierName: (cashierName ?? shift.cashierName).trim(),
      timestamp: new Date(),
    };
    shift.movements.push(movement as any);

    // Update running totals
    if (type === 'cash_in')  shift.cashIn  += amt;
    if (type === 'cash_out') shift.cashOut += amt;

    await shift.save();

    const addedMovement = shift.movements[shift.movements.length - 1];
    return res.status(201).json({ movement: addedMovement, shift });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── POST /api/shifts/:id/close — close a shift ───────────────────────────────

router.post('/:id/close', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invalid shift ID' });
    }
    const { actualCash, closingNote } = req.body;
    if (actualCash === undefined || actualCash === null) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'actualCash is required' });
    }

    const shift = await Shift.findOne(
      { _id: req.params.id, hotelId: req.hotelId, status: 'open' },
      null,
      { session },
    );
    if (!shift) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Open shift not found' });
    }

    // Aggregate order totals for this shift's period
    const shiftStart = shift.openedAt;
    const shiftEnd   = new Date();

    const [orderAgg] = await Order.aggregate([
      {
        $match: {
          hotelId: new mongoose.Types.ObjectId(req.hotelId),
          status: { $in: ['completed'] },
          createdAt: { $gte: shiftStart, $lte: shiftEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSales:  { $sum: '$grandTotal' },
          cashSales:   { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$grandTotal', 0] } },
          upiSales:    { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi'] },  '$grandTotal', 0] } },
          cardSales:   { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card'] }, '$grandTotal', 0] } },
          otherSales:  {
            $sum: {
              $cond: [
                { $not: [{ $in: ['$paymentMethod', ['cash', 'upi', 'card']] }] },
                '$grandTotal',
                0,
              ],
            },
          },
        },
      },
    ]).session(session);

    const actual = Number(actualCash) || 0;
    const expected = shift.openingCash + (orderAgg?.cashSales ?? 0) + shift.cashIn - shift.cashOut;

    shift.status       = 'closed';
    shift.closedAt     = shiftEnd;
    shift.closingNote  = (closingNote ?? '').trim();
    shift.actualCash   = actual;
    shift.expectedCash = expected;
    shift.difference   = actual - expected;
    shift.totalOrders  = orderAgg?.totalOrders ?? 0;
    shift.totalSales   = orderAgg?.totalSales  ?? 0;
    shift.cashSales    = orderAgg?.cashSales   ?? 0;
    shift.upiSales     = orderAgg?.upiSales    ?? 0;
    shift.cardSales    = orderAgg?.cardSales   ?? 0;
    shift.otherSales   = orderAgg?.otherSales  ?? 0;

    await shift.save({ session });
    await session.commitTransaction();

    logAudit(req, 'shift.closed', 'shift', String(shift._id), {
      actualCash: actual,
      expectedCash: expected,
      difference: shift.difference,
      totalSales: shift.totalSales,
      totalOrders: shift.totalOrders,
    });

    return res.json({ shift });
  } catch (error) {
    await session.abortTransaction();
    return sendError(res, 500, 'Server error', error);
  } finally {
    session.endSession();
  }
});

export default router;
