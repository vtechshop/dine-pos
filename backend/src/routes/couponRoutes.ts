/**
 * Coupon Routes
 * Mount point: /api/coupons
 *
 * Endpoints:
 *   GET  /                        — list coupons (admin)
 *   POST /                        — create coupon (admin)
 *   GET  /:id                     — get coupon (admin)
 *   PATCH /:id                    — update coupon (admin)
 *   DELETE /:id                   — soft delete (admin)
 *   POST /validate                — validate a coupon code for an order (cashier)
 *   POST /:id/apply               — increment usageCount after payment (cashier)
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import {
  authMiddleware, requireAdmin, requireCashierOrAdmin, AuthRequest,
} from '../middleware/auth';
import { requireActiveStaff } from '../middleware/staffAuth';
import { sendError } from '../utils/sendError';
import Coupon from '../models/Coupon';
import CouponRedemption from '../models/CouponRedemption';
import { logAudit } from '../utils/audit';

const router = Router();
router.use(authMiddleware);

// ── List ──────────────────────────────────────────────────────────────────────

router.get('/', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const { page = '1', limit = '50', active } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const filter: Record<string, any> = { hotelId, isDeleted: false };
    if (active === 'true')  filter.isActive = true;
    if (active === 'false') filter.isActive = false;

    const [coupons, total] = await Promise.all([
      Coupon.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Coupon.countDocuments(filter),
    ]);

    res.json({ coupons, total, page: pageNum, limit: limitNum });
  } catch (err) {
    sendError(res, 500, 'Failed to list coupons', err);
  }
});

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      code, description, type, value, minOrderValue, maxDiscount,
      validFrom, validUntil, usageLimit, perCustomerLimit,
      applicableCategories, applicableProducts,
    } = req.body as Record<string, any>;

    if (!code || !type || value === undefined || !validFrom) {
      res.status(400).json({ message: 'code, type, value, validFrom are required' });
      return;
    }
    if (!['percent', 'flat'].includes(type)) {
      res.status(400).json({ message: 'type must be "percent" or "flat"' });
      return;
    }
    if (type === 'percent' && (value < 0 || value > 100)) {
      res.status(400).json({ message: 'percent value must be 0–100' });
      return;
    }

    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const coupon = await Coupon.create({
      hotelId,
      code:               String(code).trim().toUpperCase(),
      description:        description ? String(description).trim().slice(0, 300) : '',
      type,
      value:              Number(value),
      minOrderValue:      Number(minOrderValue) || 0,
      maxDiscount:        Number(maxDiscount) || 0,
      validFrom:          new Date(validFrom),
      validUntil:         validUntil ? new Date(validUntil) : null,
      usageLimit:         Number(usageLimit) || 0,
      perCustomerLimit:   Number(perCustomerLimit) || 0,
      applicableCategories: Array.isArray(applicableCategories) ? applicableCategories : [],
      applicableProducts:   Array.isArray(applicableProducts) ? applicableProducts : [],
      isActive:           true,
      createdBy:          `admin:${req.hotelId}`,
    });

    logAudit(req, 'coupon.create', 'Coupon', coupon._id.toString(), { code: coupon.code });
    res.status(201).json({ coupon });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ message: 'A coupon with this code already exists' });
      return;
    }
    sendError(res, 500, 'Failed to create coupon', err);
  }
});

// ── Get ───────────────────────────────────────────────────────────────────────

router.get('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const coupon = await Coupon.findOne({
      _id: req.params.id,
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      isDeleted: false,
    }).lean();
    if (!coupon) { res.status(404).json({ message: 'Coupon not found' }); return; }
    res.json({ coupon });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch coupon', err);
  }
});

// ── Update ────────────────────────────────────────────────────────────────────

router.patch('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const allowed = [
      'description', 'value', 'minOrderValue', 'maxDiscount',
      'validFrom', 'validUntil', 'usageLimit', 'perCustomerLimit',
      'applicableCategories', 'applicableProducts', 'isActive',
    ] as const;

    const update: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ message: 'No valid fields to update' });
      return;
    }

    const coupon = await Coupon.findOneAndUpdate(
      { _id: req.params.id, hotelId: new mongoose.Types.ObjectId(req.hotelId), isDeleted: false },
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!coupon) { res.status(404).json({ message: 'Coupon not found' }); return; }

    logAudit(req, 'coupon.update', 'Coupon', coupon._id.toString(), { fields: Object.keys(update) });
    res.json({ coupon });
  } catch (err) {
    sendError(res, 500, 'Failed to update coupon', err);
  }
});

// ── Soft delete ───────────────────────────────────────────────────────────────

router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const coupon = await Coupon.findOneAndUpdate(
      { _id: req.params.id, hotelId: new mongoose.Types.ObjectId(req.hotelId), isDeleted: false },
      { $set: { isDeleted: true, isActive: false } },
      { new: true },
    );
    if (!coupon) { res.status(404).json({ message: 'Coupon not found' }); return; }
    logAudit(req, 'coupon.delete', 'Coupon', coupon._id.toString(), { code: coupon.code });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to delete coupon', err);
  }
});

// ── Validate (cashier-facing: call before applying to an order) ───────────────

router.post('/validate', requireCashierOrAdmin, requireActiveStaff, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { code, orderTotal, customerId } = req.body as {
      code?: string; orderTotal?: number; customerId?: string;
    };

    if (!code || orderTotal === undefined) {
      res.status(400).json({ message: 'code and orderTotal are required' });
      return;
    }

    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const now     = new Date();

    const coupon = await Coupon.findOne({
      hotelId,
      code:      String(code).trim().toUpperCase(),
      isActive:  true,
      isDeleted: false,
    }).lean();

    if (!coupon) {
      res.status(404).json({ valid: false, message: 'Invalid or inactive coupon code' });
      return;
    }
    if (coupon.validFrom > now) {
      res.status(400).json({ valid: false, message: 'Coupon is not yet active' });
      return;
    }
    if (coupon.validUntil && coupon.validUntil < now) {
      res.status(400).json({ valid: false, message: 'Coupon has expired' });
      return;
    }
    if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
      res.status(400).json({ valid: false, message: 'Coupon usage limit reached' });
      return;
    }
    if (coupon.minOrderValue > 0 && Number(orderTotal) < coupon.minOrderValue) {
      res.status(400).json({
        valid: false,
        message: `Minimum order value ₹${coupon.minOrderValue} required for this coupon`,
      });
      return;
    }

    // Calculate discount
    let discountAmount = 0;
    if (coupon.type === 'percent') {
      discountAmount = (Number(orderTotal) * coupon.value) / 100;
      if (coupon.maxDiscount > 0) discountAmount = Math.min(discountAmount, coupon.maxDiscount);
    } else {
      discountAmount = coupon.value;
    }
    discountAmount = Math.min(discountAmount, Number(orderTotal));
    discountAmount = Math.round(discountAmount * 100) / 100;

    res.json({
      valid:          true,
      couponId:       coupon._id,
      code:           coupon.code,
      description:    coupon.description,
      type:           coupon.type,
      value:          coupon.value,
      discountAmount,
      finalAmount:    Math.round((Number(orderTotal) - discountAmount) * 100) / 100,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to validate coupon', err);
  }
});

// ── POST /:id/apply — increment usageCount after successful order ─────────────
// Called client-side after a payment is confirmed. Fire-and-forget is acceptable;
// the worst case is a usage count that is 1 low — not a financial risk.

router.post('/:id/apply', requireCashierOrAdmin, requireActiveStaff, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // C-05: validation only — no permanent usageCount increment here.
    // The authoritative increment lives inside the order transaction in orderRoutes.ts,
    // which also creates the CouponRedemption record. A second increment here caused
    // every coupon application to count twice.
    const coupon = await Coupon.findOne({
      _id: req.params.id,
      hotelId: new mongoose.Types.ObjectId(req.hotelId!),
      isDeleted: false,
      $or: [{ usageLimit: { $lte: 0 } }, { $expr: { $lt: ['$usageCount', '$usageLimit'] } }],
    });
    if (!coupon) { res.status(404).json({ message: 'Coupon not found' }); return; }
    logAudit(req, 'coupon_applied', 'Coupon', String(coupon._id), { code: coupon.code, usageCount: coupon.usageCount });
    res.json({ success: true, usageCount: coupon.usageCount });
  } catch (err) {
    sendError(res, 500, 'Failed to apply coupon', err);
  }
});

// ── GET /:id/redemptions — list CouponRedemption records for a coupon (admin) ─

router.get('/:id/redemptions', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const coupon = await Coupon.findOne({
      _id:       req.params.id,
      hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
      isDeleted: false,
    }).lean();
    if (!coupon) { res.status(404).json({ message: 'Coupon not found' }); return; }

    const { page = '1', limit = '20', status, customerId } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const filter: Record<string, any> = {
      hotelId:  new mongoose.Types.ObjectId(req.hotelId!),
      couponId: new mongoose.Types.ObjectId(req.params.id),
    };
    if (status && ['redeemed', 'reversed'].includes(status)) filter.status = status;
    if (customerId && mongoose.isValidObjectId(customerId)) {
      filter.customerId = new mongoose.Types.ObjectId(customerId);
    }

    const [redemptions, total, activeCount, reversedCount] = await Promise.all([
      CouponRedemption.find(filter)
        .sort({ redeemedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      CouponRedemption.countDocuments(filter),
      CouponRedemption.countDocuments({ hotelId: filter.hotelId, couponId: filter.couponId, status: 'redeemed' }),
      CouponRedemption.countDocuments({ hotelId: filter.hotelId, couponId: filter.couponId, status: 'reversed' }),
    ]);

    res.json({ redemptions, total, page: pageNum, limit: limitNum, activeCount, reversedCount });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch redemptions', err);
  }
});

export default router;
