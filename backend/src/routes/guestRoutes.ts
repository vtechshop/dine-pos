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
import GiftVoucher from '../models/GiftVoucher';
import CustomerProfile from '../models/CustomerProfile';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import { guestLabel } from '../utils/guestLabel';
import { getLoyaltyConfig, calculateEarnedPoints, calculateMaxRedeemablePoints, calculateRedeemValue, earnPoints, redeemPoints as redeemLoyaltyPts } from '../utils/loyaltyUtils';
import { scheduleReceiptPrint } from '../utils/printUtils';

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
    const { action, paymentMethod, splitDetails, paidAmount, displayLabel, redeemPoints, giftVoucherCode } = req.body as {
      action: 'bill' | 'left' | 'rename';
      paymentMethod?: string;
      splitDetails?: { cash?: number; upi?: number; card?: number };
      paidAmount?: number;
      displayLabel?: string;
      redeemPoints?: number;
      giftVoucherCode?: string;
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

      // H-06: reject billing if the kitchen still has active orders for this guest
      const activeOrderCount = await Order.countDocuments({
        guestId: guest._id,
        hotelId: req.hotelId,
        status:  { $in: ['pending', 'preparing', 'ready'] },
      });
      if (activeOrderCount > 0) {
        res.status(409).json({
          message: `Cannot bill: ${activeOrderCount} order${activeOrderCount > 1 ? 's are' : ' is'} still in the kitchen (pending, preparing, or ready). Mark them as served before billing.`,
          pendingOrderCount: activeOrderCount,
        });
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
      // Pre-compute loyalty discount so split-payment validation uses the correct
      // post-discount payable total. Read-only — actual point deduction happens after
      // the H-07 atomic guard to prevent double-deduction races.
      const wantsLoyalty = !!(
        redeemPoints && typeof redeemPoints === 'number' && redeemPoints > 0
        && guest.customerId && !guest.loyaltyPointsRedeemed
      );
      let loyaltyCfgPrecomputed: any = null;
      let loyaltyToRedeem  = 0;
      let loyaltyDiscount  = 0;

      if (wantsLoyalty) {
        try {
          loyaltyCfgPrecomputed = await getLoyaltyConfig(req.hotelId!);
          if (loyaltyCfgPrecomputed.enabled && (redeemPoints as number) >= loyaltyCfgPrecomputed.minimumRedeemPoints) {
            const _prof = await CustomerProfile.findById(guest.customerId).select('loyaltyBalance').lean();
            const _bal  = (_prof as any)?.loyaltyBalance ?? 0;
            loyaltyToRedeem = calculateMaxRedeemablePoints(
              guest.totalAmount, _bal, redeemPoints as number, loyaltyCfgPrecomputed,
            );
            if (loyaltyToRedeem > 0) {
              loyaltyDiscount = calculateRedeemValue(loyaltyToRedeem, loyaltyCfgPrecomputed);
            }
          }
        } catch { /* precompute failed — validation uses full amount, redemption retries fresh */ }
      }

      // Voucher resolution (server-side — never trust client amount)
      const rawGuestVoucherCode = giftVoucherCode
        ? String(giftVoucherCode).trim().toUpperCase()
        : '';
      let guestVoucherDoc: any = null;
      let guestVoucherAmount   = 0;
      if (rawGuestVoucherCode) {
        const vNow = new Date();
        guestVoucherDoc = await GiftVoucher.findOne({
          hotelId:     new mongoose.Types.ObjectId(req.hotelId!),
          voucherCode: rawGuestVoucherCode,
          isActive:    true,
          isDeleted:   false,
          $or: [{ expiresAt: null }, { expiresAt: { $gte: vNow } }],
          balance:     { $gt: 0 },
        }).select('_id voucherCode balance').lean();
        if (!guestVoucherDoc) {
          res.status(400).json({ message: 'Gift voucher not found, expired, or inactive' });
          return;
        }
        guestVoucherAmount = Math.round(
          Math.min(guestVoucherDoc.balance, guest.totalAmount - loyaltyDiscount) * 100,
        ) / 100;
      }

      if (paymentMethod === 'split' && splitDetails) {
        const splitSum     = (splitDetails.cash ?? 0) + (splitDetails.upi ?? 0) + (splitDetails.card ?? 0);
        const payableTotal = +(guest.totalAmount - loyaltyDiscount - guestVoucherAmount).toFixed(2);
        if (Math.abs(splitSum - payableTotal) > 0.01) {
          res.status(400).json({
            message: `Split amounts (₹${splitSum.toFixed(2)}) must equal payable amount (₹${payableTotal.toFixed(2)}) after discounts`,
          });
          return;
        }
        updateFields['splitDetails.cash'] = splitDetails.cash ?? 0;
        updateFields['splitDetails.upi']  = splitDetails.upi  ?? 0;
        updateFields['splitDetails.card'] = splitDetails.card ?? 0;
      }

      // H-07: atomic guard — only one of two concurrent billing requests wins this.
      // The loser gets null and returns 409 before touching loyalty points.
      const updated = await Guest.findOneAndUpdate(
        { _id: guest._id, status: 'active' },
        { $set: updateFields },
        { new: true, runValidators: true },
      );
      if (!updated) {
        res.status(409).json({ message: 'Guest has already been billed. Refresh to see the latest status.' });
        return;
      }

      // Gift voucher deduction (after atomic billing guard — best-effort, logged on failure)
      if (guestVoucherDoc && guestVoucherAmount > 0) {
        try {
          const vNow = new Date();
          const deducted = await GiftVoucher.findOneAndUpdate(
            {
              _id:       guestVoucherDoc._id,
              hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
              isActive:  true,
              isDeleted: false,
              $or:       [{ expiresAt: null }, { expiresAt: { $gte: vNow } }],
              balance:   { $gte: guestVoucherAmount },
            },
            [
              { $set: { balance: { $subtract: ['$balance', guestVoucherAmount] } } },
              { $set: {
                  isActive:     { $cond: { if: { $lte: ['$balance', 0] }, then: false, else: '$isActive' } },
                  transactions: { $concatArrays: [{ $ifNull: ['$transactions', []] }, [{ type: 'redeem', amount: guestVoucherAmount, balanceAfter: { $ifNull: ['$balance', 0] }, orderId: null, remarks: `Guest billing: ${guest.displayLabel} (Guest ${String(guest._id)})`, createdBy: `cashier:${req.hotelId}`, createdAt: vNow }]] },
              }},
            ] as any,
            { new: true },
          );
          if (deducted) {
            await Guest.findByIdAndUpdate(updated._id, {
              $set: {
                giftVoucherId:     guestVoucherDoc._id,
                giftVoucherCode:   rawGuestVoucherCode,
                giftVoucherAmount: guestVoucherAmount,
              },
            });
          } else {
            logger.warn('[gift-voucher] deduction at guest billing failed — voucher may have changed', {
              hotelId: req.hotelId, guestId: String(guest._id),
            });
          }
        } catch (vErr: any) {
          logger.warn('[gift-voucher] deduction error at guest billing', {
            hotelId: req.hotelId, guestId: String(guest._id), error: vErr?.message,
          });
        }
      }

      // [Phase 6] Loyalty redemption — runs AFTER the atomic guard.
      // Reuses precomputed config/toRedeem to avoid an extra round-trip in the happy path.
      // Falls back to a fresh fetch when precompute failed (e.g. config service timeout).
      let guestAfterLoyalty = updated;
      if (wantsLoyalty) {
        try {
          let cfg      = loyaltyCfgPrecomputed;
          let toRedeem = loyaltyToRedeem;

          if (!cfg || toRedeem === 0) {
            cfg = await getLoyaltyConfig(req.hotelId!);
            if (cfg.enabled && (redeemPoints as number) >= cfg.minimumRedeemPoints) {
              const prof = await CustomerProfile.findById(guest.customerId).select('loyaltyBalance').lean();
              const bal  = (prof as any)?.loyaltyBalance ?? 0;
              toRedeem   = calculateMaxRedeemablePoints(guest.totalAmount, bal, redeemPoints as number, cfg);
            }
          }

          if (cfg && toRedeem > 0) {
            const actorId = req.cashierId ? `cashier:${req.cashierId}` : `admin:${req.hotelId}`;
            const discount = await redeemLoyaltyPts(
              guest.customerId as mongoose.Types.ObjectId,
              req.hotelId!,
              toRedeem,
              cfg,
              { sessionId: String(session._id), guestId: String(guest._id), createdBy: actorId },
            );
            updateFields.loyaltyPointsRedeemed = toRedeem;
            updateFields.loyaltyDiscountAmount  = discount;
            const afterLoyalty = await Guest.findByIdAndUpdate(
              updated._id,
              { $set: { loyaltyPointsRedeemed: toRedeem, loyaltyDiscountAmount: discount } },
              { new: true },
            );
            if (afterLoyalty) guestAfterLoyalty = afterLoyalty;
          }
        } catch (loyaltyErr: any) {
          logger.warn('Loyalty redemption skipped during billing', {
            hotelId: req.hotelId,
            guestId: String(guest._id),
            error: loyaltyErr?.message,
          });
        }
      }

      // Lifetimespan update + loyalty earn (both non-blocking after atomic guard)
      if (guest.customerId) {
        // Atomic claim on lifetimeSpendAt — prevents double-increment on request replay.
        // The billing guard above (status: 'active') already prevents most replays; this
        // is a belt-and-suspenders guard for server-crash-then-retry scenarios.
        Guest.findOneAndUpdate(
          { _id: updated._id, hotelId: req.hotelId, lifetimeSpendAt: null },
          { $set: { lifetimeSpendAt: new Date() } },
        ).then(claimed => {
          if (claimed) {
            CustomerProfile.findByIdAndUpdate(guest.customerId, {
              $inc: { lifetimeSpend: guest.totalAmount },
              $set: { lastVisitAt: new Date() },
            }).catch(() => {});
          }
        }).catch(() => {});

        // Earn points — idempotent via Guest.loyaltyEarnedAt; guard prevents double-earn
        // on request replay (e.g. network retry after client timeout).
        if (!updated.loyaltyEarnedAt) {
          ;(async () => {
            try {
              const loyaltyCfg = await getLoyaltyConfig(req.hotelId!);
              if (loyaltyCfg.enabled) {
                let earnBase = guest.totalAmount;
                if (loyaltyCfg.calculationBase === 'before_gst') {
                  const [sub] = await Order.aggregate([
                    { $match: { sessionId: session._id, guestId: guest._id, status: { $ne: 'cancelled' } } },
                    { $group: { _id: null, s: { $sum: '$subtotal' } } },
                  ]);
                  earnBase = sub?.s ?? guest.totalAmount;
                }
                const earnableBase = Math.max(0, earnBase - (updateFields.loyaltyDiscountAmount ?? 0));
                const pts = calculateEarnedPoints(earnableBase, loyaltyCfg);
                if (pts > 0) {
                  await earnPoints(
                    guest.customerId as mongoose.Types.ObjectId,
                    req.hotelId!,
                    pts,
                    loyaltyCfg,
                    { sessionId: String(session._id), guestId: String(guest._id), createdBy: 'system' },
                  );
                  // Stamp idempotency guard so a replay can't double-earn
                  await Guest.updateOne(
                    { _id: updated._id, loyaltyEarnedAt: null },
                    { $set: { loyaltyEarnedAt: new Date() } },
                  );
                }
              }
            } catch { /* non-critical */ }
          })();
        }
      }

      // [Phase 7] Fire-and-forget receipt print
      scheduleReceiptPrint(req.hotelId!, {
        guestId:               String(guest._id),
        sessionId:             String(session._id),
        tableNumber:           guest.tableNumber,
        guestLabel:            guest.displayLabel,
        totalAmount:           guest.totalAmount,
        paymentMethod,
        loyaltyDiscountAmount: updateFields.loyaltyDiscountAmount,
      }).catch(() => {});

      // Sync paymentMethod and mark orders completed so daily/range reports
      // reflect the correct payment breakdown for session-billed dine-in guests.
      Order.updateMany(
        { sessionId: session._id, guestId: updated._id, status: { $ne: 'cancelled' } },
        { $set: { paymentMethod, status: 'completed' } },
      ).catch(() => {});

      const billingDiscount = guestAfterLoyalty.loyaltyDiscountAmount ?? 0;
      const netPayable = guestAfterLoyalty.totalAmount - billingDiscount - guestVoucherAmount;

      io.to(`hotel_${req.hotelId}`).emit('guest_billed', {
        sessionId: session._id,
        guestId: guest._id,
        paymentMethod,
        totalAmount: guestAfterLoyalty.totalAmount,
        loyaltyDiscountAmount: billingDiscount,
        netPayable,
      });

      // Also emit order_completed so admin dashboard stats refresh immediately
      io.to(`hotel_${req.hotelId}`).emit('order_completed', {
        orderId: String(guest._id),
        tableNumber: guest.tableNumber || '',
        paymentMethod,
        grandTotal: netPayable,
      });

      logAudit(req, 'guest.billed', 'guest', String(guest._id), {
        sessionId: String(session._id),
        paymentMethod,
        totalAmount: guestAfterLoyalty.totalAmount,
        loyaltyDiscountAmount: billingDiscount,
        netPayable,
      });

      res.json({ guest: guestAfterLoyalty });

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

    // Reverse loyalty transactions before clearing the guest's billing fields.
    // Runs regardless of whether the loyalty feature is currently enabled —
    // points were earned/redeemed when the feature was on, so the reversal must happen.
    if (guest.customerId) {
      try {
        const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);
        const createdBy = `admin:${req.hotelId}`;

        // 1. Restore redeemed points
        const redeemed = (guest as any).loyaltyPointsRedeemed as number | undefined;
        if (redeemed && redeemed > 0) {
          const afterRestore = await CustomerProfile.findByIdAndUpdate(
            guest.customerId,
            { $inc: { loyaltyBalance: redeemed } },
            { new: true },
          );
          if (afterRestore) {
            await LoyaltyTransaction.create({
              customerId:      guest.customerId,
              hotelId:         hotelObjId,
              guestId:         guest._id,
              transactionType: 'adjust',
              points:          redeemed,
              balanceAfter:    afterRestore.loyaltyBalance,
              createdBy,
              remarks:         `Reversal: guest reopened — restored ${redeemed} redeemed points`,
            });
          }
        }

        // 2. Reverse earned points (find most recent earn transaction for this guest)
        const earnTx = await LoyaltyTransaction.findOne({
          guestId:         guest._id,
          hotelId:         hotelObjId,
          transactionType: 'earn',
        }).sort({ createdAt: -1 });

        if (earnTx && earnTx.points > 0) {
          const afterDeduct = await CustomerProfile.findOneAndUpdate(
            { _id: guest.customerId, loyaltyBalance: { $gte: earnTx.points } },
            { $inc: { loyaltyBalance: -earnTx.points } },
            { new: true },
          );
          if (afterDeduct) {
            await LoyaltyTransaction.create({
              customerId:      guest.customerId,
              hotelId:         hotelObjId,
              guestId:         guest._id,
              transactionType: 'adjust',
              points:          -earnTx.points,
              balanceAfter:    afterDeduct.loyaltyBalance,
              createdBy,
              remarks:         `Reversal: guest reopened — reversed ${earnTx.points} earned points`,
            });
          } else {
            logger.warn('Loyalty reopen: insufficient balance to reverse earned points — partial reversal skipped', {
              hotelId:     req.hotelId,
              guestId:     String(guest._id),
              earnedPoints: earnTx.points,
            });
          }
        }
      } catch (loyaltyErr: any) {
        logger.warn('Loyalty reversal failed during guest reopen', {
          hotelId: req.hotelId,
          guestId: String(guest._id),
          error:   loyaltyErr?.message,
        });
      }
    }

    // Gift voucher restoration on reopen (before clearing guest fields)
    const reopenVoucherAmt = (guest as any).giftVoucherAmount as number | undefined;
    if (reopenVoucherAmt && reopenVoucherAmt > 0 && (guest as any).giftVoucherId) {
      try {
        const reopenNow = new Date();
        await GiftVoucher.findOneAndUpdate(
          { _id: (guest as any).giftVoucherId, hotelId: req.hotelId! },
          [
            { $set: { balance: { $add: ['$balance', reopenVoucherAmt] }, isActive: true } },
            { $set: { transactions: { $concatArrays: [{ $ifNull: ['$transactions', []] }, [{ type: 'refund', amount: reopenVoucherAmt, balanceAfter: { $ifNull: ['$balance', 0] }, orderId: null, remarks: `Guest reopened: ${guest.displayLabel} (Guest ${String(guest._id)})`, createdBy: `admin:${req.hotelId}`, createdAt: reopenNow }]] } } },
          ] as any,
        );
      } catch (vErr: any) {
        logger.warn('[gift-voucher] restoration on guest reopen failed', {
          hotelId: req.hotelId, guestId: String(guest._id), error: vErr?.message,
        });
      }
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
          loyaltyPointsRedeemed: 0,
          loyaltyDiscountAmount: 0,
          giftVoucherId: null,
          giftVoucherCode: '',
          giftVoucherAmount: 0,
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
