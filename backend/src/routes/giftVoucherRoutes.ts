/**
 * Gift Voucher Routes
 * Mount point: /api/gift-vouchers
 *
 * Endpoints:
 *   GET  /                         — list vouchers (admin)
 *   POST /                         — issue a new voucher (admin)
 *   GET  /:code/check              — check balance (cashier)
 *   POST /redeem                   — redeem against an order (cashier)
 *   POST /topup                    — add balance to existing voucher (admin)
 *   POST /:id/deactivate           — deactivate (admin)
 *   GET  /customer/:customerId     — vouchers for a customer (cashier)
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  authMiddleware, requireAdmin, requireCashierOrAdmin, AuthRequest,
} from '../middleware/auth';
import { requireActiveStaff } from '../middleware/staffAuth';
import { sendError } from '../utils/sendError';
import GiftVoucher from '../models/GiftVoucher';
import Order from '../models/Order';
import { logAudit } from '../utils/audit';

const router = Router();
router.use(authMiddleware);

// ── Rate limiters (hotel-scoped — auth runs before these) ──────────────────────
// /check — cashiers check frequently; 60/min per hotel is generous
const checkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req: any) => `gv:check:${req.hotelId ?? ipKeyGenerator(req.ip ?? '')}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many voucher check requests, please slow down' },
});

// /redeem — stricter; normal POS sees at most a few per minute
const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: any) => `gv:redeem:${req.hotelId ?? ipKeyGenerator(req.ip ?? '')}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many redemption requests, please slow down' },
});

// /topup and issue — admin actions; 20/min is generous
const adminActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req: any) => `gv:admin:${req.hotelId ?? ipKeyGenerator(req.ip ?? '')}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests, please slow down' },
});

function generateVoucherCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GV-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── List ──────────────────────────────────────────────────────────────────────

router.get('/', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelId  = new mongoose.Types.ObjectId(req.hotelId);
    const { page = '1', limit = '50', active } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const filter: Record<string, any> = { hotelId, isDeleted: false };
    if (active === 'true')  filter.isActive = true;
    if (active === 'false') filter.isActive = false;

    const [vouchers, total] = await Promise.all([
      GiftVoucher.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select('-transactions')
        .lean(),
      GiftVoucher.countDocuments(filter),
    ]);

    res.json({ vouchers, total, page: pageNum, limit: limitNum });
  } catch (err) {
    sendError(res, 500, 'Failed to list gift vouchers', err);
  }
});

// ── Issue ─────────────────────────────────────────────────────────────────────

router.post('/', requireAdmin, adminActionLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount, issuedToName, issuedToPhone, issuedToCustomerId, expiresAt } = req.body as Record<string, any>;

    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ message: 'amount must be a positive number' });
      return;
    }

    const hotelId     = new mongoose.Types.ObjectId(req.hotelId);
    let voucherCode   = generateVoucherCode();

    // Retry up to 5 times on collision; fail cleanly if all attempts collide
    let unique = !(await GiftVoucher.exists({ hotelId, voucherCode }));
    for (let i = 0; i < 5 && !unique; i++) {
      voucherCode = generateVoucherCode();
      unique = !(await GiftVoucher.exists({ hotelId, voucherCode }));
    }
    if (!unique) {
      res.status(503).json({ message: 'Could not generate a unique voucher code, please try again shortly' });
      return;
    }

    const now     = new Date();
    const voucher = await GiftVoucher.create({
      hotelId,
      voucherCode,
      originalAmount:     Number(amount),
      balance:            Number(amount),
      issuedToCustomerId: issuedToCustomerId || null,
      issuedToName:       issuedToName ? String(issuedToName).trim() : '',
      issuedToPhone:      issuedToPhone ? String(issuedToPhone).trim() : '',
      issuedAt:           now,
      expiresAt:          expiresAt ? new Date(expiresAt) : null,
      isActive:           true,
      transactions: [{
        type:         'issue',
        amount:       Number(amount),
        balanceAfter: Number(amount),
        orderId:      null,
        remarks:      'Voucher issued',
        createdBy:    `admin:${req.hotelId}`,
        createdAt:    now,
      }],
      createdBy: `admin:${req.hotelId}`,
    });

    logAudit(req, 'giftvoucher.issue', 'GiftVoucher', voucher._id.toString(), { voucherCode, amount });
    res.status(201).json({ voucher });
  } catch (err) {
    sendError(res, 500, 'Failed to issue gift voucher', err);
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const [agg] = await GiftVoucher.aggregate([
      { $match: { hotelId, isDeleted: false } },
      {
        $facet: {
          counts: [
            {
              $group: {
                _id:                 null,
                total:               { $sum: 1 },
                active:              { $sum: { $cond: ['$isActive', 1, 0] } },
                inactive:            { $sum: { $cond: ['$isActive', 0, 1] } },
                outstandingLiability:{ $sum: { $cond: ['$isActive', '$balance', 0] } },
              },
            },
          ],
          txAgg: [
            { $unwind: { path: '$transactions', preserveNullAndEmptyArrays: false } },
            { $group: { _id: '$transactions.type', totalAmount: { $sum: '$transactions.amount' } } },
          ],
        },
      },
    ]);

    const counts  = agg?.counts?.[0] ?? { total: 0, active: 0, inactive: 0, outstandingLiability: 0 };
    const txMap: Record<string, number> = {};
    for (const row of (agg?.txAgg ?? [])) txMap[row._id] = row.totalAmount;

    res.json({
      total:                counts.total,
      active:               counts.active,
      inactive:             counts.inactive,
      totalIssuedValue:     txMap['issue']  ?? 0,
      totalTopupValue:      txMap['topup']  ?? 0,
      totalRedeemedValue:   txMap['redeem'] ?? 0,
      totalRestoredValue:   txMap['refund'] ?? 0,
      outstandingLiability: counts.outstandingLiability,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch gift voucher stats', err);
  }
});

// ── Transaction history ───────────────────────────────────────────────────────

router.get('/:id/transactions', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: 'Voucher not found' });
      return;
    }

    const { page = '1', limit = '50' } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip     = (pageNum - 1) * limitNum;

    const voucher = await GiftVoucher.findOne({ _id: req.params.id, hotelId, isDeleted: false })
      .select('voucherCode balance transactions')
      .lean();
    if (!voucher) { res.status(404).json({ message: 'Voucher not found' }); return; }

    const allTxs = (voucher.transactions ?? []).slice().reverse(); // newest first
    res.json({
      voucherCode:  voucher.voucherCode,
      balance:      voucher.balance,
      transactions: allTxs.slice(skip, skip + limitNum),
      total:        allTxs.length,
      page:         pageNum,
      limit:        limitNum,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch voucher transactions', err);
  }
});

// ── Check balance ─────────────────────────────────────────────────────────────

router.get('/:code/check', checkLimiter, requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const code    = String(req.params.code).trim().toUpperCase();

    const voucher = await GiftVoucher.findOne({ hotelId, voucherCode: code, isDeleted: false })
      .select('voucherCode balance originalAmount issuedToName issuedToPhone expiresAt isActive')
      .lean();

    if (!voucher) { res.status(404).json({ valid: false, message: 'Voucher not found' }); return; }
    if (!voucher.isActive) { res.status(400).json({ valid: false, message: 'Voucher is inactive' }); return; }
    if (voucher.expiresAt && new Date(voucher.expiresAt) < new Date()) {
      res.status(400).json({ valid: false, message: 'Voucher has expired' });
      return;
    }
    if (voucher.balance <= 0) { res.status(400).json({ valid: false, message: 'Voucher has no remaining balance' }); return; }

    res.json({ valid: true, voucher });
  } catch (err) {
    sendError(res, 500, 'Failed to check voucher', err);
  }
});

// ── Redeem ────────────────────────────────────────────────────────────────────

router.post('/redeem', redeemLimiter, requireCashierOrAdmin, requireActiveStaff, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { code, amount, orderId, remarks } = req.body as {
      code?: string; amount?: number; orderId?: string; remarks?: string;
    };

    if (!code || !amount || Number(amount) <= 0) {
      res.status(400).json({ message: 'code and amount are required' });
      return;
    }

    const hotelId    = new mongoose.Types.ObjectId(req.hotelId);
    const voucherCode = String(code).trim().toUpperCase();
    const redeemAmt   = Number(amount);

    // Idempotency: if orderId provided and this orderId was already redeemed, return success
    if (orderId && mongoose.isValidObjectId(orderId)) {
      const orderObjId = new mongoose.Types.ObjectId(orderId);
      const alreadyRedeemed = await GiftVoucher.findOne({
        hotelId,
        voucherCode,
        transactions: { $elemMatch: { type: 'redeem', orderId: orderObjId } },
      }).select('balance voucherCode').lean();
      if (alreadyRedeemed) {
        res.json({ success: true, redeemedAmount: redeemAmt, newBalance: alreadyRedeemed.balance, voucherCode: alreadyRedeemed.voucherCode });
        return;
      }
      // Validate: redeemAmt cannot exceed order grandTotal (when orderId is supplied)
      const orderDoc = await Order.findOne({ _id: orderObjId, hotelId }).select('grandTotal').lean();
      if (orderDoc && redeemAmt > (orderDoc as any).grandTotal) {
        res.status(400).json({ message: `Redeem amount (₹${redeemAmt}) exceeds order total (₹${(orderDoc as any).grandTotal})` });
        return;
      }
    }

    const now = new Date();
    const redeemEntry = {
      type:      'redeem',
      amount:    redeemAmt,
      orderId:   orderId ? new mongoose.Types.ObjectId(orderId) : null,
      remarks:   remarks || 'Redeemed at billing',
      createdBy: `cashier:${req.hotelId}`,
      createdAt: now,
    };

    // Atomic: guard balance, deduct, push transaction, deactivate if drained — one round-trip
    const voucher = await GiftVoucher.findOneAndUpdate(
      {
        hotelId,
        voucherCode,
        isActive:  true,
        isDeleted: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }],
        balance:   { $gte: redeemAmt },
      },
      [
        { $set: { balance: { $subtract: ['$balance', redeemAmt] } } },
        {
          $set: {
            isActive:     { $cond: { if: { $lte: ['$balance', 0] }, then: false, else: '$isActive' } },
            transactions: {
              $concatArrays: [
                { $ifNull: ['$transactions', []] },
                [{ ...redeemEntry, balanceAfter: { $ifNull: ['$balance', 0] } }],
              ],
            },
          },
        },
      ] as any,
      { new: true },
    );
    if (!voucher) {
      const v = await GiftVoucher.findOne({ hotelId, voucherCode, isDeleted: false })
        .select('isActive balance expiresAt').lean();
      if (!v || !v.isActive) { res.status(404).json({ message: 'Voucher not found or inactive' }); return; }
      if (v.expiresAt && v.expiresAt < now) { res.status(400).json({ message: 'Voucher has expired' }); return; }
      res.status(400).json({ message: `Insufficient balance. Available: ₹${v.balance}` }); return;
    }
    const newBalance = voucher.balance;

    logAudit(req, 'giftvoucher.redeem', 'GiftVoucher', voucher._id.toString(), { voucherCode, amount: redeemAmt, newBalance });
    res.json({ success: true, redeemedAmount: redeemAmt, newBalance, voucherCode });
  } catch (err) {
    sendError(res, 500, 'Failed to redeem voucher', err);
  }
});

// ── Top-up ────────────────────────────────────────────────────────────────────

router.post('/topup', requireAdmin, adminActionLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { code, amount, remarks } = req.body as { code?: string; amount?: number; remarks?: string };
    if (!code || !amount || Number(amount) <= 0) {
      res.status(400).json({ message: 'code and amount are required' });
      return;
    }

    const hotelId    = new mongoose.Types.ObjectId(req.hotelId!);
    const voucherCode = String(code).trim().toUpperCase();
    const addAmt      = Number(amount);
    const now         = new Date();

    // Atomic: $inc balance, activate, push transaction — no last-write-wins race
    const voucher = await GiftVoucher.findOneAndUpdate(
      { hotelId, voucherCode, isDeleted: false },
      [
        { $set: {
            balance:  { $round: [{ $add: ['$balance', addAmt] }, 2] },
            isActive: true,
        }},
        { $set: {
            transactions: { $concatArrays: [
              { $ifNull: ['$transactions', []] },
              [{ type: 'topup', amount: addAmt, balanceAfter: { $ifNull: ['$balance', 0] }, orderId: null, remarks: remarks || 'Top-up by admin', createdBy: `admin:${req.hotelId}`, createdAt: now }],
            ]},
        }},
      ] as any,
      { new: true },
    );
    if (!voucher) { res.status(404).json({ message: 'Voucher not found' }); return; }

    const newBalance = voucher.balance;
    logAudit(req, 'giftvoucher.topup', 'GiftVoucher', voucher._id.toString(), { voucherCode, amount: addAmt, newBalance });
    res.json({ success: true, newBalance });
  } catch (err) {
    sendError(res, 500, 'Failed to top up voucher', err);
  }
});

// ── Deactivate ────────────────────────────────────────────────────────────────

router.post('/:id/deactivate', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const voucher = await GiftVoucher.findOneAndUpdate(
      { _id: req.params.id, hotelId: new mongoose.Types.ObjectId(req.hotelId), isDeleted: false },
      { $set: { isActive: false } },
      { new: true },
    );
    if (!voucher) { res.status(404).json({ message: 'Voucher not found' }); return; }
    logAudit(req, 'giftvoucher.deactivate', 'GiftVoucher', voucher._id.toString(), {});
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to deactivate voucher', err);
  }
});

// ── Reactivate ────────────────────────────────────────────────────────────────

router.post('/:id/reactivate', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: 'Voucher not found' });
      return;
    }
    // isDeleted guard: deleted vouchers cannot be reactivated
    const voucher = await GiftVoucher.findOneAndUpdate(
      { _id: req.params.id, hotelId: new mongoose.Types.ObjectId(req.hotelId), isDeleted: false },
      { $set: { isActive: true } },
      { new: true },
    );
    if (!voucher) { res.status(404).json({ message: 'Voucher not found' }); return; }
    // Note: expired vouchers may be reactivated (isActive=true) but /check and /redeem
    // still enforce expiresAt, so they remain non-redeemable until expiry is updated.
    logAudit(req, 'giftvoucher.reactivate', 'GiftVoucher', voucher._id.toString(), {
      voucherCode: voucher.voucherCode, balance: voucher.balance,
    });
    res.json({ success: true, voucher: { _id: voucher._id, voucherCode: voucher.voucherCode, isActive: voucher.isActive, balance: voucher.balance } });
  } catch (err) {
    sendError(res, 500, 'Failed to reactivate voucher', err);
  }
});

// ── By customer ───────────────────────────────────────────────────────────────

router.get('/customer/:customerId', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelId    = new mongoose.Types.ObjectId(req.hotelId);
    const customerId = new mongoose.Types.ObjectId(req.params.customerId);

    const vouchers = await GiftVoucher.find({
      hotelId,
      issuedToCustomerId: customerId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .select('-transactions')
      .lean();

    res.json({ vouchers });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch customer vouchers', err);
  }
});

export default router;
