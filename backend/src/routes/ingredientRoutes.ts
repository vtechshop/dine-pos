import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Ingredient from '../models/Ingredient';
import WasteLog from '../models/WasteLog';
import StockMovement from '../models/StockMovement';
import GRN from '../models/GRN';
import Product from '../models/Product';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('ingredients'));

// ── GET /summary — KPI overview ─────────────────────────────────────────────
// Must come before /:id routes so 'summary' is not treated as an ObjectId param.
router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [aggResult, wasteLossResult] = await Promise.all([
      Ingredient.aggregate([
        { $match: { hotelId: hotelObjId } },
        {
          $group: {
            _id: null,
            total:       { $sum: 1 },
            lowStock:    { $sum: { $cond: [{ $and: [{ $gt: ['$currentStock', 0] }, { $lte: ['$currentStock', '$lowStockThreshold'] }] }, 1, 0] } },
            outOfStock:  { $sum: { $cond: [{ $eq: ['$currentStock', 0] }, 1, 0] } },
            stockValue:  { $sum: { $multiply: ['$currentStock', '$costPerUnit'] } },
          },
        },
      ]),
      WasteLog.aggregate([
        { $match: { hotelId: hotelObjId, date: { $gte: today, $lte: todayEnd } } },
        { $group: { _id: null, totalLoss: { $sum: '$estimatedLoss' } } },
      ]),
    ]);

    const agg = aggResult[0] ?? { total: 0, lowStock: 0, outOfStock: 0, stockValue: 0 };
    res.json({
      total:          agg.total,
      lowStock:       agg.lowStock,
      outOfStock:     agg.outOfStock,
      stockValue:     agg.stockValue,
      todayWasteLoss: wasteLossResult[0]?.totalLoss ?? 0,
    });
  } catch (error) {
    sendError(res, 500, 'Failed to fetch inventory summary', error);
  }
});

// ── GET /alerts/low-stock ────────────────────────────────────────────────────
router.get('/alerts/low-stock', async (req: AuthRequest, res: Response) => {
  try {
    const ingredients = await Ingredient.find({
      hotelId: req.hotelId,
      $expr: { $lte: ['$currentStock', '$lowStockThreshold'] },
    }).sort({ currentStock: 1 });
    res.json({ ingredients });
  } catch (error) {
    sendError(res, 500, 'Failed to fetch low stock alerts', error);
  }
});

// ── GET / — list all ingredients ─────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip  = Math.max(parseInt(req.query.skip  as string) || 0,  0);
    const [ingredients, total] = await Promise.all([
      Ingredient.find({ hotelId: req.hotelId }).sort({ name: 1 }).skip(skip).limit(limit),
      Ingredient.countDocuments({ hotelId: req.hotelId }),
    ]);
    res.json({ ingredients, total, limit, skip });
  } catch (error) {
    sendError(res, 500, 'Failed to fetch ingredients', error);
  }
});

// ── POST / — create ingredient ────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const ingredient = new Ingredient({ ...req.body, hotelId: req.hotelId });
    await ingredient.save();
    logAudit(req, 'ingredient.created', 'ingredient', String((ingredient as any)._id), { name: (ingredient as any).name });

    // Record opening stock movement if initial stock is positive
    const initStock = (ingredient as any).currentStock as number;
    if (initStock > 0) {
      await StockMovement.create({
        hotelId:        req.hotelId,
        ingredientId:   (ingredient as any)._id,
        ingredientName: (ingredient as any).name,
        type:           'opening_stock',
        delta:          initStock,
        previousStock:  0,
        resultingStock: initStock,
        costPerUnit:    (ingredient as any).costPerUnit ?? null,
        totalCost:      initStock * ((ingredient as any).costPerUnit ?? 0),
        referenceType:  'manual',
        performedBy:    req.role ?? 'admin',
      });
    }

    res.status(201).json(ingredient);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── GET /:id/history — stock movement history for one ingredient ──────────────
router.get('/:id/history', async (req: AuthRequest, res: Response) => {
  try {
    const ingredient = await Ingredient.findOne({ _id: req.params.id, hotelId: req.hotelId }).select('_id');
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip  = Math.max(parseInt(req.query.skip  as string) || 0,  0);

    const [movements, total] = await Promise.all([
      StockMovement.find({ hotelId: req.hotelId, ingredientId: req.params.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      StockMovement.countDocuments({ hotelId: req.hotelId, ingredientId: req.params.id }),
    ]);

    res.json({ movements, total, limit, skip });
  } catch (error) {
    sendError(res, 500, 'Failed to fetch stock history', error);
  }
});

// ── POST /:id/stock-in — add stock with cost + supplier info ──────────────────
router.post('/:id/stock-in', async (req: AuthRequest, res: Response) => {
  try {
    const { quantity, costPerUnit, supplier = '', invoiceNumber = '', date, notes = '' } = req.body;

    if (typeof quantity !== 'number' || quantity <= 0) {
      return res.status(400).json({ message: 'quantity must be a positive number' });
    }
    if (typeof costPerUnit !== 'number' || costPerUnit < 0) {
      return res.status(400).json({ message: 'costPerUnit must be a non-negative number' });
    }

    // Single atomic update: increment stock AND recompute WAC in one operation (prevents TOCTOU race)
    const before = await Ingredient.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      [
        {
          $set: {
            // WAC uses pre-update values (all $-refs resolve from pre-update doc in the same $set stage)
            // B-23: round WAC to 4 decimal places (matches GRN path) to prevent
            // floating-point noise from accumulating across repeated stock-in operations.
            costPerUnit: {
              $cond: [
                { $gt: [{ $add: ['$currentStock', quantity] }, 0] },
                {
                  $round: [{
                    $divide: [
                      { $add: [{ $multiply: ['$currentStock', '$costPerUnit'] }, quantity * costPerUnit] },
                      { $add: ['$currentStock', quantity] },
                    ],
                  }, 4],
                },
                costPerUnit,
              ],
            },
            currentStock: { $add: ['$currentStock', quantity] },
          },
        },
      ],
      { new: false }, // returns document BEFORE the update (prevStock, prevCost)
    );
    if (!before) return res.status(404).json({ message: 'Ingredient not found' });

    const prevStock = (before as any).currentStock as number;
    const newStock  = prevStock + quantity;

    const ingredient = await Ingredient.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });

    const totalCost = quantity * costPerUnit;

    await StockMovement.create({
      hotelId:        req.hotelId,
      ingredientId:   req.params.id,
      ingredientName: (ingredient as any).name,
      type:           'stock_in',
      delta:          quantity,
      previousStock:  prevStock,
      resultingStock: newStock,
      costPerUnit,
      totalCost,
      referenceType:  'manual',
      supplier,
      invoiceNumber,
      notes,
      performedBy:    req.role ?? 'admin',
    });

    logAudit(req, 'ingredient.stock_in', 'ingredient', req.params.id, {
      name: (ingredient as any).name, quantity, costPerUnit, supplier, invoiceNumber,
    });

    res.json({ ingredient, movement: { delta: quantity, previousStock: prevStock, resultingStock: newStock, costPerUnit, totalCost } });
  } catch (error) {
    sendError(res, 500, 'Failed to record stock in', error);
  }
});

// ── POST /:id/adjust — physical count correction ──────────────────────────────
router.post('/:id/adjust', async (req: AuthRequest, res: Response) => {
  try {
    const { physicalStock, reason = 'physical_count', notes = '' } = req.body;

    if (typeof physicalStock !== 'number' || physicalStock < 0) {
      return res.status(400).json({ message: 'physicalStock must be a non-negative number' });
    }

    const before = await Ingredient.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!before) return res.status(404).json({ message: 'Ingredient not found' });

    const prevStock = (before as any).currentStock as number;
    const delta = physicalStock - prevStock;

    if (delta === 0) {
      return res.json({ ingredient: before, message: 'No change — physical stock matches system stock' });
    }

    const ingredient = await Ingredient.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { $set: { currentStock: physicalStock } },
      { new: true, runValidators: true },
    );
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });

    await StockMovement.create({
      hotelId:        req.hotelId,
      ingredientId:   req.params.id,
      ingredientName: (ingredient as any).name,
      type:           'adjustment',
      delta,
      previousStock:  prevStock,
      resultingStock: physicalStock,
      costPerUnit:    (ingredient as any).costPerUnit ?? null,
      referenceType:  'manual',
      reason,
      notes,
      performedBy:    req.role ?? 'admin',
    });

    logAudit(req, 'ingredient.adjusted', 'ingredient', req.params.id, {
      name: (ingredient as any).name, prevStock, physicalStock, delta, reason,
    });

    res.json({ ingredient, movement: { delta, previousStock: prevStock, resultingStock: physicalStock, reason } });
  } catch (error) {
    sendError(res, 500, 'Failed to adjust stock', error);
  }
});

// ── PUT /:id — update ingredient metadata ─────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, unit, lowStockThreshold, costPerUnit } = req.body;
    const update: Record<string, unknown> = {};
    if (name              !== undefined) update.name              = name;
    if (unit              !== undefined) update.unit              = unit;
    if (lowStockThreshold !== undefined) update.lowStockThreshold = lowStockThreshold;
    if (costPerUnit       !== undefined) update.costPerUnit       = costPerUnit;
    const ingredient = await Ingredient.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      update,
      { new: true, runValidators: true },
    );
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });
    logAudit(req, 'ingredient.updated', 'ingredient', req.params.id, { name: (ingredient as any).name });
    res.json(ingredient);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── PATCH /:id/restock — legacy increment endpoint ───────────────────────────
router.patch('/:id/restock', async (req: AuthRequest, res: Response) => {
  try {
    const { quantity, costPerUnit: bodyCost } = req.body;
    if (typeof quantity !== 'number' || quantity <= 0) {
      return res.status(400).json({ message: 'Valid positive quantity required' });
    }
    if (bodyCost !== undefined && (typeof bodyCost !== 'number' || bodyCost < 0)) {
      return res.status(400).json({ message: 'costPerUnit must be a non-negative number' });
    }

    let ingredient: any = null;
    let prevStock    = 0;
    let incomingCost = 0;
    let is404        = false;

    // B-01: Wrap stock update + StockMovement in a single transaction so
    // neither can succeed without the other.
    const txSession = await mongoose.startSession();
    try {
      await txSession.withTransaction(async () => {
        const before = await Ingredient.findOne(
          { _id: req.params.id, hotelId: req.hotelId },
          null,
          { session: txSession },
        );
        if (!before) { is404 = true; return; }

        prevStock    = (before as any).currentStock as number;
        incomingCost = (typeof bodyCost === 'number') ? bodyCost : (before as any).costPerUnit ?? 0;

        await Ingredient.findOneAndUpdate(
          { _id: req.params.id, hotelId: req.hotelId },
          [
            {
              $set: {
                // B-23: round WAC to 4dp (matches GRN/stock-in path)
                costPerUnit: {
                  $cond: [
                    { $gt: [{ $add: ['$currentStock', quantity] }, 0] },
                    {
                      $round: [{
                        $divide: [
                          { $add: [{ $multiply: ['$currentStock', '$costPerUnit'] }, quantity * incomingCost] },
                          { $add: ['$currentStock', quantity] },
                        ],
                      }, 4],
                    },
                    incomingCost,
                  ],
                },
                currentStock: { $add: ['$currentStock', quantity] },
              },
            },
          ],
          { new: false, session: txSession },
        );

        ingredient = await Ingredient.findOne(
          { _id: req.params.id, hotelId: req.hotelId },
          null,
          { session: txSession },
        );

        await StockMovement.create([{
          hotelId:        req.hotelId,
          ingredientId:   req.params.id,
          ingredientName: (ingredient as any)?.name,
          type:           'restock',
          delta:          quantity,
          previousStock:  prevStock,
          resultingStock: prevStock + quantity,
          costPerUnit:    (ingredient as any)?.costPerUnit ?? null,
          totalCost:      quantity * incomingCost,
          referenceType:  'manual',
          performedBy:    req.role ?? 'admin',
        }], { session: txSession });
      });
    } finally {
      await txSession.endSession();
    }

    if (is404 || !ingredient) return res.status(404).json({ message: 'Ingredient not found' });
    logAudit(req, 'ingredient.restocked', 'ingredient', req.params.id, { name: (ingredient as any).name, quantity, costPerUnit: incomingCost });
    res.json(ingredient);
  } catch (error) {
    sendError(res, 500, 'Failed to restock ingredient', error);
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ingredient = await Ingredient.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!ingredient) return res.status(404).json({ message: 'Ingredient not found' });

    // HIGH-4: Block deletion when the ingredient is still in use
    if ((ingredient as any).currentStock > 0) {
      return res.status(409).json({
        message: `Cannot delete "${(ingredient as any).name}": current stock is ${(ingredient as any).currentStock} ${(ingredient as any).unit || 'units'}. Adjust stock to 0 first.`,
      });
    }

    const [activeGrn, activeRecipe] = await Promise.all([
      GRN.exists({
        hotelId:           req.hotelId,
        'items.ingredientId': req.params.id,
        isDeleted:         false,
        status:            { $ne: 'cancelled' },
      }),
      Product.exists({
        hotelId:              req.hotelId,
        isDeleted:            false,
        'recipe.ingredient':  new mongoose.Types.ObjectId(req.params.id),
      }),
    ]);

    if (activeGrn) {
      return res.status(409).json({
        message: `Cannot delete "${(ingredient as any).name}": it is referenced by one or more active GRNs. Cancel or complete those GRNs first.`,
      });
    }
    if (activeRecipe) {
      return res.status(409).json({
        message: `Cannot delete "${(ingredient as any).name}": it is used in one or more product recipes. Remove it from those recipes first.`,
      });
    }

    await Ingredient.deleteOne({ _id: req.params.id, hotelId: req.hotelId });
    logAudit(req, 'ingredient.deleted', 'ingredient', req.params.id, { name: (ingredient as any).name });
    res.json({ message: 'Deleted' });
  } catch (error) {
    sendError(res, 500, 'Failed to delete ingredient', error);
  }
});

export default router;
