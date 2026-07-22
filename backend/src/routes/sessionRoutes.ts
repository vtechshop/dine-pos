import { Router, Response } from 'express';
import mongoose from 'mongoose';
import {
  authMiddleware,
  requireAdmin,
  requireCashierOrAdmin,
  requireWaiterOrCashierOrAdmin,
  AuthRequest,
} from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { sendError } from '../utils/sendError';
import { logger } from '../utils/logger';
import { logAudit } from '../utils/audit';
import { io } from '../server';
import TableSession from '../models/TableSession';
import Guest from '../models/Guest';
import Table from '../models/Table';
import Order from '../models/Order';
import Settings from '../models/Settings';
import CustomerProfile from '../models/CustomerProfile';
import guestRouter from './guestRoutes';
import { getLoyaltyConfig, calculateEarnedPoints, earnPoints } from '../utils/loyaltyUtils';
import { scheduleReceiptPrint } from '../utils/printUtils';

const router = Router();

// ── Global middleware: every session route requires auth ──────────────────────
router.use(authMiddleware);
router.use(requireFeature('tableSessions'));

// ── Mount nested guest routes ──────────────────────────────────────────────────
// Guests are sub-resources of sessions: /api/sessions/:sessionId/guests/…
// mergeParams: true in guestRoutes lets guest handlers read req.params.sessionId.
router.use('/:sessionId/guests', guestRouter);

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/sessions
// List sessions for this hotel. Default: open sessions only.
// Returns each session enriched with active guest count + running total.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const statusParam = req.query.status as string | undefined;
    const filter: Record<string, any> = { hotelId: req.hotelId };

    if (!statusParam || statusParam === 'open' || statusParam === 'closed') {
      filter.status = statusParam || 'open';
    } else if (statusParam === 'all') {
      // no status filter
    } else {
      res.status(400).json({ message: "status must be 'open', 'closed', or 'all'" });
      return;
    }

    const sessions = await TableSession.find(filter)
      .sort({ openedAt: -1 })
      .limit(100)
      .lean();

    if (sessions.length === 0) {
      res.json({ sessions: [], total: 0 });
      return;
    }

    const sessionIds = sessions.map((s: any) => s._id);

    // One aggregation for all guest summaries — avoids N+1 queries
    const agg = await Guest.aggregate([
      {
        $match: {
          sessionId: { $in: sessionIds },
          hotelId: new mongoose.Types.ObjectId(req.hotelId),
        },
      },
      {
        $group: {
          _id: '$sessionId',
          guestCount:       { $sum: 1 },
          activeGuestCount: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          runningTotal:     { $sum: { $cond: [{ $eq: ['$status', 'active'] }, '$totalAmount', 0] } },
        },
      },
    ]);

    const aggMap: Record<string, { guestCount: number; activeGuestCount: number; runningTotal: number }> = {};
    for (const a of agg) {
      aggMap[String(a._id)] = {
        guestCount:       a.guestCount,
        activeGuestCount: a.activeGuestCount,
        runningTotal:     a.runningTotal,
      };
    }

    const enriched = sessions.map((s: any) => ({
      ...s,
      guestCount:       aggMap[String(s._id)]?.guestCount       ?? 0,
      activeGuestCount: aggMap[String(s._id)]?.activeGuestCount ?? 0,
      runningTotal:     aggMap[String(s._id)]?.runningTotal     ?? 0,
    }));

    res.json({ sessions: enriched, total: enriched.length });
  } catch (err: any) {
    sendError(res, 500, 'Failed to fetch sessions', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/sessions
// Open a new table session. Creates a TableSession, increments Table → occupied.
// RBAC: waiter | cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.post('/', requireWaiterOrCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { tableId, notes } = req.body as { tableId?: string; notes?: string };

    if (!tableId || !mongoose.isValidObjectId(tableId)) {
      res.status(400).json({ message: 'tableId is required and must be a valid ObjectId' });
      return;
    }

    // Verify table belongs to this hotel
    const table = await Table.findOne({ _id: tableId, hotelId: req.hotelId });
    if (!table) {
      res.status(404).json({ message: 'Table not found' });
      return;
    }
    if (table.status === 'inactive') {
      res.status(409).json({ message: 'Table is inactive and cannot be opened' });
      return;
    }

    // Guard before hitting the unique index — give a meaningful 409
    const existing = await TableSession.findOne({
      hotelId: req.hotelId,
      tableId: new mongoose.Types.ObjectId(tableId),
      status: 'open',
    });
    if (existing) {
      res.status(409).json({
        message: 'Table already has an open session',
        sessionId: existing._id,
      });
      return;
    }

    // Copy QR timeout from hotel settings (falls back to model default 15 min)
    const settings = await Settings.findOne({ hotelId: req.hotelId }).select('qrGuestTimeoutMinutes').lean();
    const qrTimeoutMinutes: number = (settings as any)?.qrGuestTimeoutMinutes ?? 15;

    const openedBy = req.role === 'waiter' && req.waiterName
      ? `Waiter: ${req.waiterName}`
      : req.role === 'cashier' && req.cashierName
      ? `Cashier: ${req.cashierName}`
      : 'Admin';

    const session = await TableSession.create({
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      tableId:  new mongoose.Types.ObjectId(tableId),
      tableNumber: String(table.number),
      openedBy,
      qrTimeoutMinutes,
      notes: (notes ?? '').slice(0, 500),
    });

    // Mark table occupied (non-atomic; safe because partial unique index prevents duplicate open sessions)
    await Table.findByIdAndUpdate(tableId, {
      status: 'occupied',
      currentSessionId: session._id,
    });

    io.to(`hotel_${req.hotelId}`).emit('session_opened', {
      sessionId: session._id,
      tableId,
      tableNumber: session.tableNumber,
      openedBy: session.openedBy,
      openedAt: session.openedAt,
    });

    logAudit(req, 'session.opened', 'session', String(session._id), {
      tableId,
      tableNumber: session.tableNumber,
    });

    logger.info('Table session opened', {
      hotelId: req.hotelId,
      sessionId: String(session._id),
      tableNumber: session.tableNumber,
      openedBy: session.openedBy,
    });

    res.status(201).json({ session });
  } catch (err: any) {
    // MongoDB duplicate-key on the partial unique index means a concurrent open raced us
    if (err?.code === 11000) {
      res.status(409).json({ message: 'Table already has an open session (concurrent request)' });
      return;
    }
    sendError(res, 500, 'Failed to open session', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/table/:tableId
// Return the currently open session for a table (with guest list), or null.
// RBAC: any authenticated staff (waiter | cashier | admin)
// ────────────────────────────────────────────────────────────────────────────────
router.get('/table/:tableId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { tableId } = req.params;

    if (!mongoose.isValidObjectId(tableId)) {
      res.status(400).json({ message: 'Invalid tableId' });
      return;
    }

    // Multi-tenant: confirm table belongs to this hotel before querying sessions
    const table = await Table.findOne({ _id: tableId, hotelId: req.hotelId }).lean();
    if (!table) {
      res.status(404).json({ message: 'Table not found' });
      return;
    }

    const session = await TableSession.findOne({
      hotelId: req.hotelId,
      tableId: new mongoose.Types.ObjectId(tableId),
      status: 'open',
    });

    if (!session) {
      res.json({ session: null, guests: [] });
      return;
    }

    const guests = await Guest.find({ sessionId: session._id }).sort({ guestNumber: 1 });

    res.json({ session, guests });
  } catch (err: any) {
    sendError(res, 500, 'Failed to fetch session', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/:sessionId
// Return a single session with its guest list.
// RBAC: any authenticated staff
// ────────────────────────────────────────────────────────────────────────────────
router.get('/:sessionId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    if (!mongoose.isValidObjectId(sessionId)) {
      res.status(400).json({ message: 'Invalid sessionId' });
      return;
    }

    // hotelId in query — multi-tenant isolation
    const session = await TableSession.findOne({
      _id: sessionId,
      hotelId: req.hotelId,
    });
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const guests = await Guest.find({ sessionId: session._id }).sort({ guestNumber: 1 });

    res.json({ session, guests });
  } catch (err: any) {
    sendError(res, 500, 'Failed to fetch session', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/:sessionId/bill
// Merged table bill: session + all guests + their orders.
// Used by cashier to present the full table bill.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.get('/:sessionId/bill', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    if (!mongoose.isValidObjectId(sessionId)) {
      res.status(400).json({ message: 'Invalid sessionId' });
      return;
    }

    const session = await TableSession.findOne({
      _id: sessionId,
      hotelId: req.hotelId,
    });
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const guests = await Guest.find({ sessionId: session._id }).sort({ guestNumber: 1 });

    // Fetch each guest's orders; queries are parallel for speed
    const guestBills = await Promise.all(
      guests.map(async (guest) => {
        const orders = await Order.find({
          guestId: guest._id,
          hotelId: req.hotelId,
        }).sort({ createdAt: 1 });
        return { guest, orders };
      })
    );

    // Grand total = sum of active (unbilled) guests only
    const grandTotal = guests
      .filter((g) => g.status === 'active')
      .reduce((sum, g) => sum + g.totalAmount, 0);

    res.json({ session, guests: guestBills, grandTotal });
  } catch (err: any) {
    sendError(res, 500, 'Failed to fetch session bill', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// PATCH /api/sessions/:sessionId/close
// Close a session. All active guests must be billed or left first,
// OR pass bulkBill:true + paymentMethod to auto-bill all active guests.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.patch('/:sessionId/close', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { bulkBill, paymentMethod, splitDetails } = req.body as {
      bulkBill?: boolean;
      paymentMethod?: string;
      splitDetails?: { cash?: number; upi?: number; card?: number };
    };

    if (!mongoose.isValidObjectId(sessionId)) {
      res.status(400).json({ message: 'Invalid sessionId' });
      return;
    }

    const session = await TableSession.findOne({
      _id: sessionId,
      hotelId: req.hotelId,
    });
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }
    if (session.status === 'closed') {
      res.status(400).json({ message: 'Session is already closed' });
      return;
    }

    const guests = await Guest.find({ sessionId: session._id });

    if (bulkBill) {
      const VALID_METHODS = ['cash', 'upi', 'card', 'split', 'complimentary'];
      if (!paymentMethod || !VALID_METHODS.includes(paymentMethod)) {
        res.status(400).json({
          message: `paymentMethod is required for bulkBill. Valid values: ${VALID_METHODS.join(', ')}`,
        });
        return;
      }

      // Capture active guests before bulk-bill so we can update loyalty after
      const activeBeforeBill = guests.filter((g) => g.status === 'active');

      if (paymentMethod === 'split' && splitDetails) {
        const totalActiveAmount = activeBeforeBill.reduce((sum, g) => sum + g.totalAmount, 0);
        const splitSum = (splitDetails.cash ?? 0) + (splitDetails.upi ?? 0) + (splitDetails.card ?? 0);
        if (Math.abs(splitSum - totalActiveAmount) > 0.01) {
          res.status(400).json({ message: `Split amounts (₹${splitSum.toFixed(2)}) must equal table total (₹${totalActiveAmount.toFixed(2)})` });
          return;
        }
      }

      const now = new Date();
      await Guest.updateMany(
        { sessionId: session._id, status: 'active' },
        {
          $set: {
            status: 'billed',
            paymentMethod,
            billedAt: now,
            qrSessionToken: null,
            qrTokenExpiresAt: null,
            ...(paymentMethod === 'split' && splitDetails
              ? {
                  'splitDetails.cash': splitDetails.cash ?? 0,
                  'splitDetails.upi':  splitDetails.upi  ?? 0,
                  'splitDetails.card': splitDetails.card ?? 0,
                }
              : {}),
          },
        }
      );

      // [Phase 4] fire-and-forget lifetimeSpend; [Phase 6] fire-and-forget earn points
      for (const g of activeBeforeBill) {
        if (g.customerId) {
          CustomerProfile.findByIdAndUpdate(g.customerId, {
            $inc: { lifetimeSpend: g.totalAmount },
            $set: { lastVisitAt: now },
          }).catch(() => {});
        }
      }

      // [Phase 6] Earn loyalty points for every billed guest with a CustomerProfile
      ;(async () => {
        try {
          const loyaltyCfg = await getLoyaltyConfig(req.hotelId!);
          if (loyaltyCfg.enabled && loyaltyCfg.pointsPerHundredRupees > 0) {
            await Promise.allSettled(
              activeBeforeBill
                .filter((g) => g.customerId)
                .map((g) => (async () => {
                  const pts = calculateEarnedPoints(g.totalAmount, loyaltyCfg);
                  if (pts > 0) {
                    await earnPoints(
                      g.customerId as mongoose.Types.ObjectId,
                      req.hotelId!,
                      pts,
                      loyaltyCfg,
                      { sessionId: String(session._id), guestId: String(g._id), createdBy: 'system:bulkBill' },
                    );
                  }
                })())
            );
          }
        } catch { /* non-critical */ }
      })();
      // [Phase 7] Fire-and-forget receipt prints for each billed guest
      for (const g of activeBeforeBill) {
        scheduleReceiptPrint(req.hotelId!, {
          guestId:      String(g._id),
          sessionId:    String(session._id),
          tableNumber:  g.tableNumber,
          guestLabel:   g.displayLabel,
          totalAmount:  g.totalAmount,
          paymentMethod,
        }).catch(() => {});
      }
    } else {
      const activeGuests = guests.filter((g) => g.status === 'active');
      if (activeGuests.length > 0) {
        res.status(400).json({
          message: `${activeGuests.length} guest(s) are still active. Bill or mark as left before closing, or pass bulkBill:true.`,
          activeGuestIds: activeGuests.map((g) => g._id),
        });
        return;
      }
    }

    // Re-fetch final state to compute revenue from billed guests
    const finalGuests = await Guest.find({ sessionId: session._id });
    const totalRevenue = finalGuests
      .filter((g) => g.status === 'billed')
      .reduce((sum, g) => sum + g.totalAmount, 0);

    const now = new Date();

    const [updatedSession] = await Promise.all([
      TableSession.findByIdAndUpdate(
        session._id,
        { $set: { status: 'closed', closedAt: now, totalRevenue } },
        { new: true }
      ),
      Table.findOneAndUpdate(
        { _id: session.tableId, hotelId: req.hotelId },
        { $set: { status: 'available', currentSessionId: null } }
      ),
    ]);

    io.to(`hotel_${req.hotelId}`).emit('session_closed', {
      sessionId: session._id,
      tableId: session.tableId,
      tableNumber: session.tableNumber,
      totalRevenue,
    });

    logAudit(req, 'session.closed', 'session', String(session._id), {
      tableNumber: session.tableNumber,
      totalRevenue,
      bulkBill: !!bulkBill,
    });

    logger.info('Table session closed', {
      hotelId: req.hotelId,
      sessionId: String(session._id),
      tableNumber: session.tableNumber,
      totalRevenue,
    });

    res.json({ session: updatedSession, totalRevenue });
  } catch (err: any) {
    sendError(res, 500, 'Failed to close session', err);
  }
});

export default router;
