import { Router, Response } from 'express';
import Expense from '../models/Expense';
import Order from '../models/Order';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import mongoose from 'mongoose';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// GET expenses with optional date range
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { hotelId: req.hotelId };
    if (req.query.date) {
      const date = new Date(req.query.date as string);
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end   = new Date(date); end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    } else if (req.query.from && req.query.to) {
      const from = new Date(req.query.from as string);
      const to   = new Date(req.query.to as string); to.setHours(23, 59, 59, 999);
      filter.date = { $gte: from, $lte: to };
    }
    const expenses = await Expense.find(filter).sort({ date: -1 });
    res.json(expenses);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET P&L report for a date range
router.get('/pnl', async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date  = new Date(dateStr);
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const [revenueResult, expenseResult] = await Promise.all([
      Order.aggregate([
        { $match: { hotelId: hotelObjId, status: { $ne: 'cancelled' }, createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, revenue: { $sum: '$grandTotal' }, orders: { $sum: 1 } } },
      ]),
      Expense.aggregate([
        { $match: { hotelId: hotelObjId, date: { $gte: start, $lte: end } } },
        { $group: {
          _id: '$category',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        }},
      ]),
    ]);

    const revenue   = revenueResult[0]?.revenue || 0;
    const orders    = revenueResult[0]?.orders || 0;
    const expenses  = expenseResult.reduce((sum: number, e: any) => sum + e.total, 0);
    const profit    = revenue - expenses;

    res.json({
      date: dateStr,
      revenue,
      orders,
      expenses,
      profit,
      profitMargin: revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '0',
      breakdown: expenseResult,
    });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// POST create expense
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const expense = new Expense({ ...req.body, hotelId: req.hotelId });
    await expense.save();
    logAudit(req, 'expense.created', 'expense', String((expense as any)._id), { description: (expense as any).description, amount: (expense as any).amount });
    res.status(201).json(expense);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// PUT update expense
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    logAudit(req, 'expense.updated', 'expense', req.params.id, { description: (expense as any).description, amount: (expense as any).amount });
    res.json(expense);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// DELETE expense
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!expense) return res.status(404).json({ message: 'Expense not found' });
    logAudit(req, 'expense.deleted', 'expense', req.params.id, { description: (expense as any).description, amount: (expense as any).amount });
    res.json({ message: 'Deleted' });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
