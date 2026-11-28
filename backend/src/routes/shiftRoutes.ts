import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, requireCashierOrAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import Shift from '../models/Shift';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';
import { salesReport, drawerCash } from '../utils/financeDefinitions';
import { r2 } from '../utils/paymentLedger';

const router = Router();
router.use(authMiddleware);
router.use(requireFeature('shift'));

// ── POST /api/shifts/open — open a new shift ──────────────────────────────────

router.post('/open', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { openingCash, openingNote } = req.body;
    if (openingCash === undefined) {
      return res.status(400).json({ message: 'openingCash is required' });
    }

    // Enforce one open shift per hotel
    const existing = await Shift.findOne({ hotelId: req.hotelId, status: 'open' });
    if (existing) {
      return res.status(409).json({
        message: 'A shift is already open. Close it before opening a new one.',
        shiftId: existing._id,
      });
    }

    // M1: cashierId and cashierName come from the verified JWT, never from req.body
    // A hotel admin's token has no cashier identity; record the shift as the admin's.
    const byAdmin     = req.role === 'admin' && !req.cashierId;
    const cashierId   = req.cashierId   || (byAdmin ? 'admin' : '');
    const cashierName = req.cashierName || (byAdmin ? 'Hotel Admin' : '');
    if (!cashierId || !cashierName) {
      return res.status(400).json({ message: 'Could not tell who is opening the shift. Sign in again and retry.' });
    }

    const shift = await Shift.create({
      hotelId:     req.hotelId,
      cashierId,
      cashierName,
      openedAt:    new Date(), // M2: always server-set
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
// Batch 3: from the payment ledger. Money counts when it was taken (also for orders placed
// before the shift or still in the kitchen); sales count when orders are served / completed.

router.get('/active/stats', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await Shift.findOne({ hotelId: req.hotelId, status: 'open' }).lean();
    if (!shift) {
      return res.json({ totalOrders: 0, totalSales: 0, cashSales: 0, upiSales: 0, cardSales: 0, splitCashSales: 0, drawer: null });
    }

    const hid = new mongoose.Types.ObjectId(req.hotelId);
    const now = new Date();
    const [report, drawer] = await Promise.all([
      salesReport(hid, new Date(shift.openedAt), now),
      drawerCash(hid, shift, now),
    ]);
    const c = report.collections;

    return res.json({
      // Older field names kept for the Shift tab and the mobile app. Split payments are in
      // the ledger under their parts, so the cash part is already in cashSales (split = 0).
      totalOrders:    report.totalOrders,
      totalSales:     report.totalSales,
      cashSales:      c.cash,
      upiSales:       c.upi,
      cardSales:      c.card,
      splitCashSales: 0,
      drawer,
      finance: {
        totalSales:       report.totalSales,
        totalOrders:      report.totalOrders,
        totalTax:         report.totalTax,
        totalDiscount:    report.totalDiscount,
        paymentBreakdown: report.paymentBreakdown,
        collections:      report.collections,
        tenders:          report.tenders,
        refunds:          report.refunds,
        reversals:        report.reversals,
        tips:             report.tips,
        netCollections:   report.netCollections,
      },
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

    const shift = await Shift.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!shift) return res.status(404).json({ message: 'Shift not found' });

    // FIX 3a: reject movements on a closed shift with an explicit error
    if (shift.status !== 'open' || shift.closedAt) {
      return res.status(400).json({ message: 'Cannot record cash movement on a closed shift.' });
    }

    // FIX 3b: only the shift owner or an admin may record cash movements
    if (shift.cashierId.toString() !== (req.cashierId ?? '').toString() && req.role !== 'admin') {
      return res.status(403).json({ message: 'Only the shift owner or admin can record cash movements.' });
    }

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
      { _id: req.params.id, hotelId: req.hotelId },
      null,
      { session },
    );
    if (!shift) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Shift not found' });
    }

    // FIX 5: prevent double-close — return 400 instead of a confusing 404
    if (shift.closedAt || shift.status === 'closed') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Shift is already closed.' });
    }

    // FIX 1: non-admin staff may only close their own shift. A shift the hotel admin opened
    // (cashierId 'admin') can be closed by a cashier taking over the counter; otherwise the
    // cashier could neither close it nor open their own (one open shift per hotel).
    const adminOpened = shift.cashierId.toString() === 'admin';
    if (shift.cashierId.toString() !== (req.cashierId ?? '').toString() && req.role !== 'admin'
        && !(adminOpened && req.role === 'cashier')) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'You can only close your own shift.' });
    }

    // Batch 3: the shift's figures from the payment ledger — the same calculation as the live
    // drawer balance. Money counts when it was taken (orders placed before the shift or still in
    // the kitchen included); split payments under their parts; cash refunds and reversals out;
    // cash tips in. Sales are the orders served / completed in the shift.
    const shiftStart = shift.openedAt;
    const shiftEnd   = new Date();
    const hid = new mongoose.Types.ObjectId(req.hotelId);
    const [report, drawer] = await Promise.all([
      salesReport(hid, new Date(shiftStart), shiftEnd),
      drawerCash(hid, shift, shiftEnd),
    ]);
    const c = report.collections;

    const actual = r2(Math.max(0, Number(actualCash) || 0));
    const expected = drawer.expected;

    shift.status       = 'closed';
    shift.closedAt     = shiftEnd;
    shift.closingNote  = (closingNote ?? '').trim();
    shift.actualCash   = actual;
    shift.expectedCash = expected;
    shift.difference   = r2(actual - expected);
    shift.totalOrders  = report.totalOrders;
    shift.totalSales   = report.totalSales;
    shift.cashSales    = c.cash;                     // money taken in cash (incl. split cash parts)
    shift.upiSales     = c.upi;
    shift.cardSales    = c.card;
    shift.otherSales   = r2(c.online + c.other);

    await shift.save({ session });
    await session.commitTransaction();

    logAudit(req, 'shift.closed', 'shift', String(shift._id), {
      openedBy: shift.cashierName,
      closedBy: req.cashierName || (req.role === 'admin' ? 'Hotel Admin' : ''),
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
