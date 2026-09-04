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
    let resolvedActualDeduction = 0;

    if (ingredientId) {
      const qty = typeof quantity === 'number' ? quantity : parseFloat(quantity) || 0;
      if (qty <= 0) {
        return res.status(400).json({ message: 'quantity must be positive' });
      }

      // B-01: Wrap stock decrement, StockMovement, and WasteLog in a single transaction
      // so the database cannot be left half-updated if any write fails.
      let savedLog: any = null;
      let is404         = false;
      const txSession   = await mongoose.startSession();
      try {
        await txSession.withTransaction(async () => {
          // B-14: Atomic pipeline update — clamps to 0, returns PRE-UPDATE document.
          const preDoc = await Ingredient.findOneAndUpdate(
            { _id: ingredientId, hotelId: req.hotelId },
            [{ $set: { currentStock: { $max: [0, { $subtract: ['$currentStock', qty] }] } } }],
            { new: false, session: txSession },
          );
          if (!preDoc) { is404 = true; return; }

          const prevStock       = Math.max(0, (preDoc as any).currentStock as number);
          const costPerUnit     = (preDoc as any).costPerUnit as number;
          const actualDeduction = Math.min(qty, prevStock);

          resolvedActualDeduction = actualDeduction;
          resolvedIngredientId    = (preDoc as any)._id;

          if (typeof estimatedLoss !== 'number') {
            resolvedEstimatedLoss = actualDeduction * costPerUnit;
          }

          if (actualDeduction > 0) {
            await StockMovement.create([{
              hotelId:        req.hotelId,
              ingredientId:   resolvedIngredientId,
              ingredientName: (preDoc as any).name,
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
            }], { session: txSession });
          }

          const newLog = new WasteLog({
            ...rest,
            quantity,
            estimatedLoss:   resolvedEstimatedLoss,
            hotelId:         req.hotelId,
            ingredientId:    resolvedIngredientId,
            actualDeduction: resolvedActualDeduction,
          });
          await newLog.save({ session: txSession });
          savedLog = newLog;
        });
      } finally {
        await txSession.endSession();
      }

      if (is404) return res.status(404).json({ message: 'Ingredient not found for this hotel' });
      return res.status(201).json(savedLog);
    }

    const log = new WasteLog({
      ...rest,
      quantity,
      estimatedLoss:   resolvedEstimatedLoss,
      hotelId:         req.hotelId,
      ingredientId:    resolvedIngredientId,
      actualDeduction: resolvedActualDeduction,
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
    // B-01: Wrap log deletion, stock restoration, and StockMovement in one transaction.
    let log: any    = null;
    let isNotFound  = false;
    const txSession = await mongoose.startSession();
    try {
      await txSession.withTransaction(async () => {
        log = await WasteLog.findOneAndDelete(
          { _id: req.params.id, hotelId: req.hotelId },
          { session: txSession },
        );
        if (!log) { isNotFound = true; return; }

        // B-15: Restore ingredient stock when a waste log is deleted.
        const restorable = (log as any).actualDeduction as number | undefined;
        if (!log.ingredientId || !restorable || restorable <= 0) return;

        const preRestore = await Ingredient.findOneAndUpdate(
          { _id: log.ingredientId, hotelId: req.hotelId },
          { $inc: { currentStock: restorable } },
          { new: false, session: txSession },
        );
        if (!preRestore) return; // ingredient deleted — still remove the log

        const prevStock = Math.max(0, (preRestore as any).currentStock as number);
        await StockMovement.create([{
          hotelId:        req.hotelId,
          ingredientId:   log.ingredientId,
          ingredientName: (log as any).productName,
          type:           'adjustment',
          delta:          +restorable,
          previousStock:  prevStock,
          resultingStock: prevStock + restorable,
          costPerUnit:    (preRestore as any).costPerUnit ?? null,
          totalCost:      null,
          referenceId:    String(log._id),
          referenceType:  'waste',
          reason:         'Waste log deleted — stock restored',
          performedBy:    req.role ?? 'admin',
        }], { session: txSession });
      });
    } finally {
      await txSession.endSession();
    }

    if (isNotFound) return res.status(404).json({ message: 'Log not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
