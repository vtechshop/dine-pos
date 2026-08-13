import { Router, Response } from 'express';
import mongoose from 'mongoose';
import WasteLog from '../models/WasteLog';
import Ingredient from '../models/Ingredient';
import StockMovement from '../models/StockMovement';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('waste'));

// ── GET / — waste logs with optional date filter ─────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { hotelId: req.hotelId };
    if (req.query.date) {
      const date  = new Date(req.query.date as string);
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end   = new Date(date); end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    } else if (req.query.from && req.query.to) {
      const from = new Date(req.query.from as string);
      const to   = new Date(req.query.to as string); to.setHours(23, 59, 59, 999);
      filter.date = { $gte: from, $lte: to };
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip  = Math.max(parseInt(req.query.skip  as string) || 0,  0);
    const [logs, total] = await Promise.all([
      WasteLog.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
      WasteLog.countDocuments(filter),
    ]);
    res.json({ logs, total, limit, skip });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// ── GET /analytics — waste KPIs ──────────────────────────────────────────────
router.get('/analytics', async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date  = new Date(dateStr);
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const [summary, topItems, byReason] = await Promise.all([
      WasteLog.aggregate([
        { $match: { hotelId: hotelObjId, date: { $gte: start, $lte: end } } },
        { $group: { _id: null, totalLoss: { $sum: '$estimatedLoss' }, totalEntries: { $sum: 1 } } },
      ]),
      WasteLog.aggregate([
        { $match: { hotelId: hotelObjId, date: { $gte: start, $lte: end } } },
        { $group: { _id: '$productName', totalQty: { $sum: '$quantity' }, totalLoss: { $sum: '$estimatedLoss' } } },
        { $sort: { totalLoss: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, productName: '$_id', totalQty: 1, totalLoss: 1 } },
      ]),
      WasteLog.aggregate([
        { $match: { hotelId: hotelObjId, date: { $gte: start, $lte: end } } },
        { $group: { _id: '$reason', count: { $sum: 1 }, totalLoss: { $sum: '$estimatedLoss' } } },
      ]),
    ]);

    res.json({
      date: dateStr,
      totalLoss:    summary[0]?.totalLoss || 0,
      totalEntries: summary[0]?.totalEntries || 0,
      topItems,
      byReason,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// ── POST / — log waste ────────────────────────────────────────────────────────
// If ingredientId is provided:
//   1. Validate ingredient belongs to this hotel
//   2. Deduct quantity from ingredient.currentStock (clamped to available)
//   3. Auto-calculate estimatedLoss if not provided (qty × costPerUnit)
//   4. Create StockMovement record for the deduction
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { ingredientId, quantity, estimatedLoss, ...rest } = req.body;

    let resolvedIngredientId: mongoose.Types.ObjectId | null = null;
    let resolvedEstimatedLoss = typeof estimatedLoss === 'number' ? estimatedLoss : 0;

    if (ingredientId) {
      // Validate ingredient belongs to this hotel
      const ingredient = await Ingredient.findOne({ _id: ingredientId, hotelId: req.hotelId });
      if (!ingredient) {
        return res.status(404).json({ message: 'Ingredient not found for this hotel' });
      }

      const qty = typeof quantity === 'number' ? quantity : parseFloat(quantity) || 0;
      if (qty <= 0) {
        return res.status(400).json({ message: 'quantity must be positive' });
      }

      const prevStock = (ingredient as any).currentStock as number;
      const costPerUnit = (ingredient as any).costPerUnit as number;

      // Clamp deduction to available stock — never go below 0
      const actualDeduction = Math.min(qty, Math.max(0, prevStock));

      // Auto-compute estimated loss if not manually provided
      if (typeof estimatedLoss !== 'number') {
        resolvedEstimatedLoss = actualDeduction * costPerUnit;
      }

      resolvedIngredientId = (ingredient as any)._id;

      // Deduct stock
      if (actualDeduction > 0) {
        await Ingredient.updateOne(
          { _id: ingredientId, hotelId: req.hotelId },
          { $inc: { currentStock: -actualDeduction } },
        );

        // Record stock movement — best-effort (don't fail the waste log on audit failure)
        StockMovement.create({
          hotelId:        req.hotelId,
          ingredientId:   resolvedIngredientId,
          ingredientName: (ingredient as any).name,
          type:           'waste',
          delta:          -actualDeduction,
          previousStock:  prevStock,
          resultingStock: prevStock - actualDeduction,
          costPerUnit,
          totalCost:      resolvedEstimatedLoss,
          referenceType:  'waste',
          reason:         rest.reason ?? 'other',
          notes:          rest.notes ?? '',
          performedBy:    req.role ?? 'admin',
        }).catch(() => {});
      }
    }

    const log = new WasteLog({
      ...rest,
      quantity,
      estimatedLoss: resolvedEstimatedLoss,
      hotelId: req.hotelId,
      ingredientId: resolvedIngredientId,
    });
    await log.save();
    res.status(201).json(log);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const log = await WasteLog.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!log) return res.status(404).json({ message: 'Log not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
