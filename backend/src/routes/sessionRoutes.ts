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
import guestRouter from './guestRoutes';

const router = Router();

// ── Global middleware: every session route requires auth + tableSessions feature ──
router.use(authMiddleware);
router.use(requireFeature('tableSessions'));

// ── Mount nested guest routes ──────────────────────────────────────────────────
// Guests are sub-resources of sessions: /api/sessions/:sessionId/guests/…
// mergeParams: true in guestRoutes lets guest handlers read req.params.sessionId.
router.use('/:sessionId/guests', guestRouter);

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
    const { bulkBill, paymentMethod } = req.body as {
      bulkBill?: boolean;
      paymentMethod?: string;
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
          },
        }
      );
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
