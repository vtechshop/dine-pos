/**
 * Customer Wallet Routes
 * Mount point: /api/wallet
 *
 * Customer pre-paid wallet — separate from loyalty points.
 *
 * Endpoints:
 *   GET  /customers/:customerId/balance    — current wallet balance (cashier)
 *   POST /customers/:customerId/topup      — credit wallet (cashier/admin)
 *   POST /customers/:customerId/deduct     — debit wallet for order payment (cashier)
 *   GET  /customers/:customerId/history    — paginated transactions (cashier)
 *   POST /customers/:customerId/refund     — credit refund back to wallet (admin)
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import {
  authMiddleware, requireAdmin, requireCashierOrAdmin, AuthRequest,
} from '../middleware/auth';
import { sendError } from '../utils/sendError';
import CustomerProfile from '../models/CustomerProfile';
import WalletTransaction from '../models/WalletTransaction';
import { logAudit } from '../utils/audit';

const router = Router();
router.use(authMiddleware);

async function resolveCustomer(customerId: string, hotelId: string) {
  const hotelObjId = new mongoose.Types.ObjectId(hotelId);
  if (mongoose.isValidObjectId(customerId)) {
    return CustomerProfile.findOne({ _id: customerId, hotelId: hotelObjId });
  }
  return CustomerProfile.findOne({ customerId, hotelId: hotelObjId });
}

// ── Balance ───────────────────────────────────────────────────────────────────

router.get('/customers/:customerId/balance', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await resolveCustomer(req.params.customerId, req.hotelId!);
    if (!customer) { res.status(404).json({ message: 'Customer not found' }); return; }
    res.json({
      customerId: customer.customerId,
      name:       customer.name,
      walletBalance: customer.walletBalance ?? 0,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch wallet balance', err);
  }
});

// ── Top-up ────────────────────────────────────────────────────────────────────

router.post('/customers/:customerId/topup', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount, paymentRef, remarks } = req.body as { amount?: number; paymentRef?: string; remarks?: string };
    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ message: 'amount must be a positive number' });
      return;
    }

    const addAmt = Math.round(Number(amount) * 100) / 100;
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);
    const topupFilter = mongoose.isValidObjectId(req.params.customerId)
      ? { _id: new mongoose.Types.ObjectId(req.params.customerId), hotelId: hotelObjId }
      : { customerId: req.params.customerId, hotelId: hotelObjId };

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const customer = await CustomerProfile.findOneAndUpdate(
        { ...topupFilter, status: 'active' },
        { $inc: { walletBalance: addAmt } },
        { new: true, session },
      );
      if (!customer) {
        await session.abortTransaction();
        const exists = await CustomerProfile.findOne(topupFilter).select('status').lean();
        if (!exists) { res.status(404).json({ message: 'Customer not found' }); return; }
        res.status(409).json({ message: `Cannot top up wallet for ${exists.status} customer` }); return;
      }
      const newBalance = Math.round((customer.walletBalance ?? 0) * 100) / 100;
      await WalletTransaction.create([{
        hotelId:      new mongoose.Types.ObjectId(req.hotelId),
        customerId:   customer._id,
        type:         'credit',
        source:       'topup',
        amount:       addAmt,
        balanceAfter: newBalance,
        orderId:      null,
        paymentRef:   paymentRef || '',
        remarks:      remarks || 'Wallet top-up',
        createdBy:    `cashier:${req.hotelId}`,
      }], { session });
      await session.commitTransaction();
      logAudit(req, 'wallet.topup', 'CustomerProfile', customer._id.toString(), { amount: addAmt, newBalance });
      res.json({ success: true, walletBalance: newBalance });
    } catch (err) {
      try { await session.abortTransaction(); } catch { /* ignore secondary error */ }
      sendError(res, 500, 'Failed to top up wallet', err);
    } finally {
      await session.endSession();
    }
  } catch (err) {
    sendError(res, 500, 'Failed to top up wallet', err);
  }
});

// ── Deduct (order payment) ────────────────────────────────────────────────────

router.post('/customers/:customerId/deduct', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount, orderId, remarks } = req.body as { amount?: number; orderId?: string; remarks?: string };
    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ message: 'amount must be a positive number' });
      return;
    }

    const deductAmt = Math.round(Number(amount) * 100) / 100;
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);
    const deductFilter = mongoose.isValidObjectId(req.params.customerId)
      ? { _id: new mongoose.Types.ObjectId(req.params.customerId), hotelId: hotelObjId }
      : { customerId: req.params.customerId, hotelId: hotelObjId };

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const customer = await CustomerProfile.findOneAndUpdate(
        { ...deductFilter, status: 'active', walletBalance: { $gte: deductAmt } },
        { $inc: { walletBalance: -deductAmt } },
        { new: true, session },
      );
      if (!customer) {
        await session.abortTransaction();
        const exists = await CustomerProfile.findOne(deductFilter).select('status walletBalance').lean();
        if (!exists) { res.status(404).json({ message: 'Customer not found' }); return; }
        if (exists.status !== 'active') {
          res.status(409).json({ message: `Cannot deduct from wallet for ${exists.status} customer` }); return;
        }
        res.status(400).json({ message: `Insufficient wallet balance. Available: ₹${exists.walletBalance ?? 0}` }); return;
      }
      const newBalance = Math.round((customer.walletBalance ?? 0) * 100) / 100;
      await WalletTransaction.create([{
        hotelId:      new mongoose.Types.ObjectId(req.hotelId),
        customerId:   customer._id,
        type:         'debit',
        source:       'redemption',
        amount:       deductAmt,
        balanceAfter: newBalance,
        orderId:      orderId ? new mongoose.Types.ObjectId(orderId) : null,
        paymentRef:   '',
        remarks:      remarks || 'Used for order payment',
        createdBy:    `cashier:${req.hotelId}`,
      }], { session });
      await session.commitTransaction();
      logAudit(req, 'wallet.deduct', 'CustomerProfile', customer._id.toString(), { amount: deductAmt, newBalance, orderId });
      res.json({ success: true, walletBalance: newBalance, deducted: deductAmt });
    } catch (err) {
      try { await session.abortTransaction(); } catch { /* ignore secondary error */ }
      sendError(res, 500, 'Failed to deduct from wallet', err);
    } finally {
      await session.endSession();
    }
  } catch (err) {
    sendError(res, 500, 'Failed to deduct from wallet', err);
  }
});

// ── Transaction history ───────────────────────────────────────────────────────

router.get('/customers/:customerId/history', requireCashierOrAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customer = await resolveCustomer(req.params.customerId, req.hotelId!);
    if (!customer) { res.status(404).json({ message: 'Customer not found' }); return; }

    const page  = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));
    const skip  = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      WalletTransaction.find({ customerId: customer._id, hotelId: new mongoose.Types.ObjectId(req.hotelId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments({ customerId: customer._id, hotelId: new mongoose.Types.ObjectId(req.hotelId) }),
    ]);

    res.json({ walletBalance: customer.walletBalance ?? 0, transactions, total, page, limit });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch wallet history', err);
  }
});

// ── Refund ────────────────────────────────────────────────────────────────────

router.post('/customers/:customerId/refund', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount, orderId, remarks } = req.body as { amount?: number; orderId?: string; remarks?: string };
    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ message: 'amount must be a positive number' });
      return;
    }

    const refundAmt = Math.round(Number(amount) * 100) / 100;
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId!);
    const refundBaseFilter = mongoose.isValidObjectId(req.params.customerId)
      ? { _id: new mongoose.Types.ObjectId(req.params.customerId), hotelId: hotelObjId }
      : { customerId: req.params.customerId, hotelId: hotelObjId };

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const customer = await CustomerProfile.findOneAndUpdate(
        refundBaseFilter,
        { $inc: { walletBalance: refundAmt } },
        { new: true, session },
      );
      if (!customer) {
        await session.abortTransaction();
        res.status(404).json({ message: 'Customer not found' }); return;
      }
      const newBalance = Math.round((customer.walletBalance ?? 0) * 100) / 100;
      await WalletTransaction.create([{
        hotelId:      new mongoose.Types.ObjectId(req.hotelId),
        customerId:   customer._id,
        type:         'credit',
        source:       'refund',
        amount:       refundAmt,
        balanceAfter: newBalance,
        orderId:      orderId ? new mongoose.Types.ObjectId(orderId) : null,
        paymentRef:   '',
        remarks:      remarks || 'Refund to wallet',
        createdBy:    `admin:${req.hotelId}`,
      }], { session });
      await session.commitTransaction();
      logAudit(req, 'wallet.refund', 'CustomerProfile', customer._id.toString(), { amount: refundAmt, newBalance, orderId });
      res.json({ success: true, walletBalance: newBalance });
    } catch (err) {
      try { await session.abortTransaction(); } catch { /* ignore secondary error */ }
      sendError(res, 500, 'Failed to process wallet refund', err);
    } finally {
      await session.endSession();
    }
  } catch (err) {
    sendError(res, 500, 'Failed to process wallet refund', err);
  }
});

export default router;
