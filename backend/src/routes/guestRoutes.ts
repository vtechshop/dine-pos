import { Router, Response } from 'express';
import mongoose from 'mongoose';
import {
  requireAdmin,
  requireCashierOrAdmin,
  requireWaiterOrCashierOrAdmin,
  AuthRequest,
} from '../middleware/auth';
import { sendError } from '../utils/sendError';
import { logger } from '../utils/logger';
import { logAudit } from '../utils/audit';
import { io } from '../server';
import TableSession from '../models/TableSession';
import Guest from '../models/Guest';
import Order from '../models/Order';
import { guestLabel } from '../utils/guestLabel';

// mergeParams: true — inherits :sessionId from the parent sessionRoutes mount
const router = Router({ mergeParams: true });

// ── Shared helper: resolve + validate session + hotel ownership ────────────────
async function resolveSession(sessionId: string, hotelId: string) {
  if (!mongoose.isValidObjectId(sessionId)) return null;
  return TableSession.findOne({ _id: sessionId, hotelId });
}

// ── Shared helper: resolve + validate guest (session + hotel ownership) ────────
async function resolveGuest(guestId: string, sessionId: string, hotelId: string) {
  if (!mongoose.isValidObjectId(guestId)) return null;
  return Guest.findOne({ _id: guestId, sessionId, hotelId });
}

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/sessions/:sessionId/guests
// Add a guest party to an open session.
// Assigns the next guest slot atomically via $inc on session.guestCount.
// RBAC: waiter | cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.post('/', requireWaiterOrCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { displayLabel: customLabel, notes } = req.body as {
      displayLabel?: string;
      notes?: string;
    };

    const session = await resolveSession(sessionId, req.hotelId!);
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }
    if (session.status !== 'open') {
      res.status(409).json({ message: 'Session is closed — cannot add guests' });
      return;
    }

    // Atomic increment: returns the new (post-increment) guestCount as the guest number
    const updatedSession = await TableSession.findByIdAndUpdate(
      session._id,
      { $inc: { guestCount: 1 } },
      { new: true }
    );
    if (!updatedSession) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const guestNumber = updatedSession.guestCount;
    const label = customLabel?.trim().slice(0, 50) || guestLabel(guestNumber);

    const guest = await Guest.create({
      sessionId: session._id,
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      tableId: session.tableId,
      tableNumber: session.tableNumber,
      guestNumber,
      displayLabel: label,
      notes: (notes ?? '').slice(0, 500),
    });

    io.to(`hotel_${req.hotelId}`).emit('guest_added', {
      sessionId: session._id,
      guest: {
        _id: guest._id,
        guestNumber,
        displayLabel: label,
        status: guest.status,
      },
    });

    logger.info('Guest added to session', {
      hotelId: req.hotelId,
      sessionId: String(session._id),
      guestId: String(guest._id),
      guestNumber,
    });

    res.status(201).json({ guest });
  } catch (err: any) {
    sendError(res, 500, 'Failed to add guest', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/:sessionId/guests
// List all guests in a session, sorted by guest number.
// RBAC: any authenticated staff
// ────────────────────────────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const session = await resolveSession(sessionId, req.hotelId!);
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const guests = await Guest.find({ sessionId: session._id }).sort({ guestNumber: 1 });

    res.json({ guests });
  } catch (err: any) {
    sendError(res, 500, 'Failed to fetch guests', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/:sessionId/guests/:guestId
// Guest detail with their orders.
// RBAC: any authenticated staff
// ────────────────────────────────────────────────────────────────────────────────
router.get('/:guestId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, guestId } = req.params;

    const session = await resolveSession(sessionId, req.hotelId!);
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const guest = await resolveGuest(guestId, String(session._id), req.hotelId!);
    if (!guest) {
      res.status(404).json({ message: 'Guest not found' });
      return;
    }

    const orders = await Order.find({
      guestId: guest._id,
      hotelId: req.hotelId,
    }).sort({ createdAt: 1 });

    res.json({ guest, orders });
  } catch (err: any) {
    sendError(res, 500, 'Failed to fetch guest', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// PATCH /api/sessions/:sessionId/guests/:guestId
// Multipurpose update — action determines behaviour:
//   action: 'bill'   — mark guest as billed (requires paymentMethod)
//   action: 'left'   — mark guest as left (walked out / complimentary / skipped)
//   action: 'rename' — update displayLabel
// RBAC: cashier | admin (bill/left); waiter | cashier | admin (rename)
// ────────────────────────────────────────────────────────────────────────────────
router.patch('/:guestId', requireWaiterOrCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, guestId } = req.params;
    const { action, paymentMethod, splitDetails, paidAmount, displayLabel } = req.body as {
      action: 'bill' | 'left' | 'rename';
      paymentMethod?: string;
      splitDetails?: { cash?: number; upi?: number; card?: number };
      paidAmount?: number;
      displayLabel?: string;
    };

    if (!action || !['bill', 'left', 'rename'].includes(action)) {
      res.status(400).json({ message: "action must be one of: 'bill', 'left', 'rename'" });
      return;
    }

    const session = await resolveSession(sessionId, req.hotelId!);
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }
    if (session.status !== 'open') {
      res.status(409).json({ message: 'Session is closed' });
      return;
    }

    const guest = await resolveGuest(guestId, String(session._id), req.hotelId!);
    if (!guest) {
      res.status(404).json({ message: 'Guest not found' });
      return;
    }

    if (action === 'bill') {
      // Cashier/admin only for billing
      if (req.role === 'waiter') {
        res.status(403).json({ message: 'Waiters cannot mark guests as billed' });
        return;
      }
      if (guest.status !== 'active') {
        res.status(409).json({ message: `Guest is already ${guest.status}` });
        return;
      }
      const VALID_METHODS = ['cash', 'upi', 'card', 'split', 'complimentary'];
      if (!paymentMethod || !VALID_METHODS.includes(paymentMethod)) {
        res.status(400).json({
          message: `paymentMethod is required for billing. Valid values: ${VALID_METHODS.join(', ')}`,
        });
        return;
      }

      const updateFields: Record<string, any> = {
        status: 'billed',
        paymentMethod,
        billedAt: new Date(),
        qrSessionToken: null,
        qrTokenExpiresAt: null,
      };

      if (paidAmount !== undefined && typeof paidAmount === 'number') {
        updateFields.paidAmount = paidAmount;
      }
      if (paymentMethod === 'split' && splitDetails) {
        updateFields['splitDetails.cash'] = splitDetails.cash ?? 0;
        updateFields['splitDetails.upi']  = splitDetails.upi  ?? 0;
        updateFields['splitDetails.card'] = splitDetails.card ?? 0;
      }

      const updated = await Guest.findByIdAndUpdate(
        guest._id,
        { $set: updateFields },
        { new: true }
      );

      io.to(`hotel_${req.hotelId}`).emit('guest_billed', {
        sessionId: session._id,
        guestId: guest._id,
        paymentMethod,
        totalAmount: guest.totalAmount,
      });

      logAudit(req, 'guest.billed', 'guest', String(guest._id), {
        sessionId: String(session._id),
        paymentMethod,
        totalAmount: guest.totalAmount,
      });

      res.json({ guest: updated });

    } else if (action === 'left') {
      // Cashier/admin only for marking left
      if (req.role === 'waiter') {
        res.status(403).json({ message: 'Waiters cannot mark guests as left' });
        return;
      }
      if (guest.status !== 'active') {
        res.status(409).json({ message: `Guest is already ${guest.status}` });
        return;
      }

      const updated = await Guest.findByIdAndUpdate(
        guest._id,
        {
          $set: {
            status: 'left',
            qrSessionToken: null,
            qrTokenExpiresAt: null,
          },
        },
        { new: true }
      );

      io.to(`hotel_${req.hotelId}`).emit('guest_updated', {
        sessionId: session._id,
        guestId: guest._id,
        status: 'left',
      });

      logAudit(req, 'guest.left', 'guest', String(guest._id), {
        sessionId: String(session._id),
      });

      res.json({ guest: updated });

    } else {
      // action === 'rename'
      if (!displayLabel?.trim()) {
        res.status(400).json({ message: 'displayLabel is required for rename action' });
        return;
      }

      const updated = await Guest.findByIdAndUpdate(
        guest._id,
        { $set: { displayLabel: displayLabel.trim().slice(0, 50) } },
        { new: true }
      );

      io.to(`hotel_${req.hotelId}`).emit('guest_updated', {
        sessionId: session._id,
        guestId: guest._id,
        displayLabel: updated?.displayLabel,
      });

      res.json({ guest: updated });
    }
  } catch (err: any) {
    sendError(res, 500, 'Failed to update guest', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/sessions/:sessionId/guests/merge
// Merge sourceGuest into targetGuest:
//   - All of source's orders are reassigned to target
//   - target.totalAmount += source.totalAmount  (via $inc)
//   - source is cancelled; its qrSessionToken is cleared
// Both guests must be active; cannot merge a guest with itself.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.post('/merge', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { sourceGuestId, targetGuestId, reason } = req.body as {
      sourceGuestId?: string;
      targetGuestId?: string;
      reason?: string;
    };

    if (!sourceGuestId || !targetGuestId) {
      res.status(400).json({ message: 'sourceGuestId and targetGuestId are required' });
      return;
    }
    if (!mongoose.isValidObjectId(sourceGuestId) || !mongoose.isValidObjectId(targetGuestId)) {
      res.status(400).json({ message: 'sourceGuestId and targetGuestId must be valid ObjectIds' });
      return;
    }
    if (sourceGuestId === targetGuestId) {
      res.status(400).json({ message: 'Cannot merge a guest with themselves' });
      return;
    }

    const session = await resolveSession(sessionId, req.hotelId!);
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }
    if (session.status !== 'open') {
      res.status(409).json({ message: 'Session is closed' });
      return;
    }

    const [source, target] = await Promise.all([
      resolveGuest(sourceGuestId, String(session._id), req.hotelId!),
      resolveGuest(targetGuestId, String(session._id), req.hotelId!),
    ]);
    if (!source) {
      res.status(404).json({ message: 'Source guest not found' });
      return;
    }
    if (!target) {
      res.status(404).json({ message: 'Target guest not found' });
      return;
    }
    if (source.status !== 'active') {
      res.status(409).json({ message: `Source guest is already ${source.status} — cannot merge` });
      return;
    }
    if (target.status !== 'active') {
      res.status(409).json({ message: `Target guest is already ${target.status} — cannot merge into` });
      return;
    }

    // Reassign all source orders to target, then cancel source
    await Order.updateMany(
      { guestId: source._id, hotelId: req.hotelId },
      { $set: { guestId: target._id } }
    );

    const [updatedTarget] = await Promise.all([
      Guest.findByIdAndUpdate(
        target._id,
        { $inc: { totalAmount: source.totalAmount } },
        { new: true }
      ),
      Guest.findOneAndUpdate(
        // status filter prevents double-cancel on race
        { _id: source._id, status: 'active' },
        {
          $set: {
            status: 'cancelled',
            qrSessionToken: null,
            qrTokenExpiresAt: null,
          },
        }
      ),
    ]);

    const mergedAt = new Date();
    const mergedBy =
      req.cashierName || req.waiterName || req.hotelId || 'Admin';

    io.to(`hotel_${req.hotelId}`).emit('guests_merged', {
      sessionId: session._id,
      sourceGuestId: source._id,
      targetGuestId: target._id,
      newTotal: updatedTarget?.totalAmount,
    });

    logAudit(req, 'guest.merged', 'guest', String(target._id), {
      sessionId:     String(session._id),
      sourceGuestId: String(source._id),
      targetGuestId: String(target._id),
      amountMerged:  source.totalAmount,
      mergedBy,
      mergedAt:      mergedAt.toISOString(),
      reason:        reason?.trim().slice(0, 200) || null,
    });

    logger.info('Guests merged', {
      hotelId: req.hotelId,
      sessionId: String(session._id),
      sourceGuestId: String(source._id),
      targetGuestId: String(target._id),
      amountMerged: source.totalAmount,
    });

    res.json({ target: updatedTarget });
  } catch (err: any) {
    sendError(res, 500, 'Failed to merge guests', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/sessions/:sessionId/guests/split
// Split specified orders from sourceGuest into a newly created guest.
// sourceGuest.totalAmount is recalculated from remaining orders.
// New guest.totalAmount is the sum of the moved orders.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.post('/split', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { sourceGuestId, orderIds } = req.body as {
      sourceGuestId?: string;
      orderIds?: string[];
    };

    if (!sourceGuestId || !mongoose.isValidObjectId(sourceGuestId)) {
      res.status(400).json({ message: 'sourceGuestId is required and must be a valid ObjectId' });
      return;
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ message: 'orderIds must be a non-empty array' });
      return;
    }
    const invalidId = orderIds.find((id) => !mongoose.isValidObjectId(id));
    if (invalidId) {
      res.status(400).json({ message: `Invalid orderId: ${invalidId}` });
      return;
    }

    const session = await resolveSession(sessionId, req.hotelId!);
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }
    if (session.status !== 'open') {
      res.status(409).json({ message: 'Session is closed' });
      return;
    }

    const source = await resolveGuest(sourceGuestId, String(session._id), req.hotelId!);
    if (!source) {
      res.status(404).json({ message: 'Source guest not found' });
      return;
    }
    if (source.status !== 'active') {
      res.status(409).json({ message: `Source guest is already ${source.status} — cannot split` });
      return;
    }

    // Verify all orders belong to source guest and this hotel
    const ordersToMove = await Order.find({
      _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) },
      guestId: source._id,
      hotelId: req.hotelId,
    });
    if (ordersToMove.length !== orderIds.length) {
      res.status(400).json({
        message: 'One or more orderIds do not belong to the source guest',
      });
      return;
    }

    // Atomic: allocate new guest number
    const updatedSession = await TableSession.findByIdAndUpdate(
      session._id,
      { $inc: { guestCount: 1 } },
      { new: true }
    );
    if (!updatedSession) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const newGuestNumber = updatedSession.guestCount;
    const newLabel = guestLabel(newGuestNumber);
    const splitTotal = ordersToMove.reduce((sum, o) => sum + o.grandTotal, 0);
    const remainingTotal = Math.max(0, source.totalAmount - splitTotal);

    // Create the new guest
    const newGuest = await Guest.create({
      sessionId: session._id,
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      tableId: session.tableId,
      tableNumber: session.tableNumber,
      guestNumber: newGuestNumber,
      displayLabel: newLabel,
      totalAmount: splitTotal,
    });

    // Move orders to new guest; update source total
    await Promise.all([
      Order.updateMany(
        {
          _id: { $in: orderIds.map((id) => new mongoose.Types.ObjectId(id)) },
          hotelId: req.hotelId,
        },
        { $set: { guestId: newGuest._id } }
      ),
      Guest.findByIdAndUpdate(source._id, { $set: { totalAmount: remainingTotal } }),
    ]);

    const updatedSource = await Guest.findById(source._id);

    io.to(`hotel_${req.hotelId}`).emit('guest_split', {
      sessionId: session._id,
      sourceGuestId: source._id,
      newGuestId: newGuest._id,
      newGuestLabel: newLabel,
      movedOrderCount: ordersToMove.length,
    });

    logAudit(req, 'guest.split', 'guest', String(newGuest._id), {
      sessionId: String(session._id),
      sourceGuestId: String(source._id),
      orderCount: ordersToMove.length,
      splitTotal,
    });

    logger.info('Guest split', {
      hotelId: req.hotelId,
      sessionId: String(session._id),
      sourceGuestId: String(source._id),
      newGuestId: String(newGuest._id),
      orderCount: ordersToMove.length,
    });

    res.status(201).json({ newGuest, source: updatedSource });
  } catch (err: any) {
    sendError(res, 500, 'Failed to split guest', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// PATCH /api/sessions/:sessionId/guests/:guestId/transfer
// Transfer a guest to a different open session (different table).
// Reassigns the guest + all their orders to the target session.
// Both sessions must belong to this hotel and be open.
// RBAC: cashier | admin
// ────────────────────────────────────────────────────────────────────────────────
router.patch('/:guestId/transfer', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, guestId } = req.params;
    const { targetSessionId } = req.body as { targetSessionId?: string };

    if (!targetSessionId || !mongoose.isValidObjectId(targetSessionId)) {
      res.status(400).json({ message: 'targetSessionId is required and must be a valid ObjectId' });
      return;
    }
    if (targetSessionId === sessionId) {
      res.status(400).json({ message: 'targetSessionId must differ from the current session' });
      return;
    }

    const [sourceSession, targetSession] = await Promise.all([
      resolveSession(sessionId, req.hotelId!),
      resolveSession(targetSessionId, req.hotelId!),
    ]);
    if (!sourceSession) {
      res.status(404).json({ message: 'Source session not found' });
      return;
    }
    if (!targetSession) {
      res.status(404).json({ message: 'Target session not found' });
      return;
    }
    if (sourceSession.status !== 'open') {
      res.status(409).json({ message: 'Source session is closed' });
      return;
    }
    if (targetSession.status !== 'open') {
      res.status(409).json({ message: 'Target session is closed' });
      return;
    }

    const guest = await resolveGuest(guestId, String(sourceSession._id), req.hotelId!);
    if (!guest) {
      res.status(404).json({ message: 'Guest not found' });
      return;
    }
    if (guest.status !== 'active') {
      res.status(409).json({ message: `Guest is already ${guest.status} — cannot transfer` });
      return;
    }

    // Allocate slot in target session
    const updatedTarget = await TableSession.findByIdAndUpdate(
      targetSession._id,
      { $inc: { guestCount: 1 } },
      { new: true }
    );
    if (!updatedTarget) {
      res.status(404).json({ message: 'Target session not found' });
      return;
    }

    const newGuestNumber = updatedTarget.guestCount;
    const newLabel = guestLabel(newGuestNumber);

    // Move guest to target session
    const updatedGuest = await Guest.findByIdAndUpdate(
      guest._id,
      {
        $set: {
          sessionId: targetSession._id,
          tableId: targetSession.tableId,
          tableNumber: targetSession.tableNumber,
          guestNumber: newGuestNumber,
          displayLabel: newLabel,
          // Rotate token on transfer for security
          qrSessionToken: null,
          qrTokenExpiresAt: null,
        },
      },
      { new: true }
    );

    // Reassign all guest's orders to the target session
    await Order.updateMany(
      { guestId: guest._id, hotelId: req.hotelId },
      {
        $set: {
          sessionId: targetSession._id,
          tableNumber: targetSession.tableNumber,
        },
      }
    );

    io.to(`hotel_${req.hotelId}`).emit('guest_transferred', {
      guestId: guest._id,
      fromSessionId: sourceSession._id,
      toSessionId: targetSession._id,
      newLabel,
    });

    logAudit(req, 'guest.transferred', 'guest', String(guest._id), {
      fromSessionId: String(sourceSession._id),
      toSessionId: String(targetSession._id),
      fromTable: sourceSession.tableNumber,
      toTable: targetSession.tableNumber,
    });

    logger.info('Guest transferred', {
      hotelId: req.hotelId,
      guestId: String(guest._id),
      fromSessionId: String(sourceSession._id),
      toSessionId: String(targetSession._id),
    });

    res.json({ guest: updatedGuest });
  } catch (err: any) {
    sendError(res, 500, 'Failed to transfer guest', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// PATCH /api/sessions/:sessionId/guests/:guestId/reopen
// Admin-only: reopen a billed guest (e.g. disputed charge, additional orders).
// Generates a fresh QR token and sets status back to active.
// Note: loyalty reversal is deferred to Phase 5 (Loyalty Engine).
// RBAC: admin only
// ────────────────────────────────────────────────────────────────────────────────
router.patch('/:guestId/reopen', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, guestId } = req.params;

    const session = await resolveSession(sessionId, req.hotelId!);
    if (!session) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }
    if (session.status !== 'open') {
      res.status(409).json({ message: 'Cannot reopen a guest in a closed session' });
      return;
    }

    const guest = await resolveGuest(guestId, String(session._id), req.hotelId!);
    if (!guest) {
      res.status(404).json({ message: 'Guest not found' });
      return;
    }
    if (guest.status !== 'billed') {
      res.status(409).json({ message: `Only billed guests can be reopened (current status: ${guest.status})` });
      return;
    }

    const updated = await Guest.findByIdAndUpdate(
      guest._id,
      {
        $set: {
          status: 'active',
          paymentMethod: null,
          paidAmount: null,
          billedAt: null,
          'splitDetails.cash': 0,
          'splitDetails.upi': 0,
          'splitDetails.card': 0,
          qrSessionToken: null,
          qrTokenExpiresAt: null,
        },
      },
      { new: true }
    );

    io.to(`hotel_${req.hotelId}`).emit('guest_reopened', {
      sessionId: session._id,
      guestId: guest._id,
    });

    logAudit(req, 'guest.reopened', 'guest', String(guest._id), {
      sessionId: String(session._id),
      previousTotal: guest.totalAmount,
    });

    logger.info('Guest reopened', {
      hotelId: req.hotelId,
      sessionId: String(session._id),
      guestId: String(guest._id),
    });

    res.json({ guest: updated });
  } catch (err: any) {
    sendError(res, 500, 'Failed to reopen guest', err);
  }
});

export default router;
