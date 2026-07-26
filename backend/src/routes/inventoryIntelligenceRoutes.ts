import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Ingredient from '../models/Ingredient';
import GRN from '../models/GRN';
import WasteLog from '../models/WasteLog';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseRange(from?: unknown, to?: unknown, defaultDays = 29) {
  const start = from ? new Date(String(from)) : new Date(Date.now() - defaultDays * 86_400_000);
  const end   = to   ? new Date(String(to))   : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function pct(num: number, den: number) { return den > 0 ? round2((num / den) * 100) : 0; }
function daysBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

// Orders → Product recipe → Ingredient cost — shared across stock-movement & turnover
function cogsStages(hotelId: mongoose.Types.ObjectId): mongoose.PipelineStage[] {
  return [
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        let: { pid: '$items.product', hid: hotelId },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$_id', '$$pid'] }, { $eq: ['$hotelId', '$$hid'] }] } } },
          { $project: { recipe: 1 } },
        ],
        as: 'prod',
      },
    },
    { $unwind: { path: '$prod', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$prod.recipe', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'ingredients',
        let: { iid: '$prod.recipe.ingredient', hid: hotelId },
        pipeline: [
          { $match: { $expr: { $and: [
            { $ne: ['$$iid', null] },
            { $eq: ['$_id', '$$iid'] },
            { $eq: ['$hotelId', '$$hid'] },
          ]}}},
          { $project: { name: 1, unit: 1, currentStock: 1, costPerUnit: 1, lowStockThreshold: 1 } },
        ],
        as: 'ing',
      },
    },
    { $unwind: { path: '$ing', preserveNullAndEmptyArrays: true } },
  ] as mongoose.PipelineStage[];
}

// ── 1. GET /waste-analysis?from=&to= ─────────────────────────────────────────

router.get('/waste-analysis', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const days    = daysBetween(start, end);

    const [wasteAgg, revenueAgg] = await Promise.all([
      WasteLog.aggregate([
        { $match: { hotelId, date: { $gte: start, $lte: end } } },
        { $facet: {
          summary: [
            { $group: { _id: null, totalCost: { $sum: '$estimatedLoss' }, count: { $sum: 1 }, totalQty: { $sum: '$quantity' } } },
          ],
          byReason: [
            { $group: { _id: '$reason', totalLoss: { $sum: '$estimatedLoss' }, count: { $sum: 1 } } },
            { $sort: { totalLoss: -1 } },
          ],
          topItems: [
            { $group: { _id: '$productName', totalLoss: { $sum: '$estimatedLoss' }, totalQty: { $sum: '$quantity' }, count: { $sum: 1 } } },
            { $sort: { totalLoss: -1 } },
            { $limit: 10 },
          ],
          trend: [
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, totalLoss: { $sum: '$estimatedLoss' }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
        } },
      ]),
      Order.aggregate([
        { $match: { hotelId, status: { $ne: 'cancelled' }, createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, revenue: { $sum: '$grandTotal' } } },
      ]),
    ]);

    const waste   = wasteAgg[0] ?? {};
    const summary = waste.summary?.[0] ?? { totalCost: 0, count: 0, totalQty: 0 };
    const revenue = revenueAgg[0]?.revenue ?? 0;

    return res.json({
      period:  { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), days },
      summary: {
        totalCost:    round2(summary.totalCost),
        itemCount:    summary.count,
        wastePct:     pct(summary.totalCost, revenue),
        avgDailyLoss: round2(summary.totalCost / days),
      },
      byReason: (waste.byReason ?? []).map((r: { _id: string; totalLoss: number; count: number }) => ({
        reason: r._id, totalLoss: round2(r.totalLoss), count: r.count,
      })),
      topItems: (waste.topItems ?? []).map((i: { _id: string; totalLoss: number; totalQty: number; count: number }) => ({
        productName: i._id, totalLoss: round2(i.totalLoss), totalQty: round2(i.totalQty), count: i.count,
      })),
      trend: (waste.trend ?? []).map((t: { _id: string; totalLoss: number; count: number }) => ({
        date: t._id, totalLoss: round2(t.totalLoss), count: t.count,
      })),
    });
  } catch (err) {
    return sendError(res, 500, 'Waste analysis failed', err);
  }
});

// ── 2. GET /cost-variance ─────────────────────────────────────────────────────

router.get('/cost-variance', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);

    const items = await GRN.aggregate([
      { $match: { hotelId, isDeleted: false, status: { $in: ['completed', 'partial'] } } },
      { $sort: { receiveDate: 1 } },
      { $unwind: '$items' },
      { $match: { 'items.ingredientId': { $ne: null }, 'items.purchasePrice': { $gt: 0 } } },
      {
        $group: {
          _id:           '$items.ingredientId',
          prices:        { $push: '$items.purchasePrice' },
          lastPrice:     { $last: '$items.purchasePrice' },
          lastDate:      { $last: '$receiveDate' },
          purchaseCount: { $sum: 1 },
        },
      },
      { $addFields: { recentPrices: { $slice: ['$prices', -10] } } },
      { $addFields: { avgPurchaseCost: { $avg: '$recentPrices' } } },
      {
        $lookup: {
          from: 'ingredients',
          let: { iid: '$_id', hid: hotelId },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$_id', '$$iid'] }, { $eq: ['$hotelId', '$$hid'] }] } } },
            { $project: { name: 1, unit: 1, costPerUnit: 1 } },
          ],
          as: 'ingredient',
        },
      },
      { $unwind: { path: '$ingredient', preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          currentCost: '$ingredient.costPerUnit',
          variance:    { $subtract: ['$ingredient.costPerUnit', '$avgPurchaseCost'] },
          variancePct: {
            $cond: [
              { $gt: ['$avgPurchaseCost', 0] },
              { $multiply: [{ $divide: [{ $subtract: ['$ingredient.costPerUnit', '$avgPurchaseCost'] }, '$avgPurchaseCost'] }, 100] },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          trend: {
            $cond: [
              { $gt: ['$variancePct', 3] }, 'increased',
              { $cond: [{ $lt: ['$variancePct', -3] }, 'decreased', 'stable'] },
            ],
          },
        },
      },
      {
        $project: {
          _id:             0,
          ingredientId:    '$_id',
          name:            '$ingredient.name',
          unit:            '$ingredient.unit',
          currentCost:     1,
          avgPurchaseCost: 1,
          lastPrice:       1,
          lastDate:        1,
          variance:        1,
          variancePct:     1,
          trend:           1,
          purchaseCount:   1,
        },
      },
      { $sort: { variancePct: -1 } },
    ]);

    type VarianceRow = { trend: string; currentCost: number; avgPurchaseCost: number; lastPrice: number; variance: number; variancePct: number };
    const rounded = items.map((i: VarianceRow & Record<string, unknown>) => ({
      ...i,
      currentCost:     round2(i.currentCost),
      avgPurchaseCost: round2(i.avgPurchaseCost),
      lastPrice:       round2(i.lastPrice),
      variance:        round2(i.variance),
      variancePct:     round2(i.variancePct),
    }));

    return res.json({
      items: rounded,
      summary: {
        increased: rounded.filter(i => i.trend === 'increased').length,
        decreased: rounded.filter(i => i.trend === 'decreased').length,
        stable:    rounded.filter(i => i.trend === 'stable').length,
      },
    });
  } catch (err) {
    return sendError(res, 500, 'Cost variance failed', err);
  }
});

// ── 3. GET /vendor-price-comparison?from=&to= ─────────────────────────────────

router.get('/vendor-price-comparison', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const { start, end } = parseRange(from, to, 89);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);

    const rows = await GRN.aggregate([
      {
        $match: {
          hotelId, isDeleted: false,
          status: { $in: ['completed', 'partial'] },
          receiveDate: { $gte: start, $lte: end },
        },
      },
      { $sort: { receiveDate: 1 } },
      { $unwind: '$items' },
      { $match: { 'items.ingredientId': { $ne: null }, 'items.purchasePrice': { $gt: 0 } } },
      {
        $group: {
          _id:            { ingredientId: '$items.ingredientId', vendorId: '$vendorId' },
          ingredientName: { $first: '$items.productName' },
          unit:           { $first: '$items.unit' },
          vendorName:     { $first: '$vendorSnapshot.businessName' },
          vendorCode:     { $first: '$vendorSnapshot.vendorCode' },
          minPrice:       { $min: '$items.purchasePrice' },
          maxPrice:       { $max: '$items.purchasePrice' },
          avgPrice:       { $avg: '$items.purchasePrice' },
          lastPrice:      { $last: '$items.purchasePrice' },
          purchaseCount:  { $sum: 1 },
          totalQty:       { $sum: '$items.receivedQty' },
          totalValue:     { $sum: { $multiply: ['$items.receivedQty', '$items.purchasePrice'] } },
        },
      },
      {
        $group: {
          _id:            '$_id.ingredientId',
          ingredientName: { $first: '$ingredientName' },
          unit:           { $first: '$unit' },
          vendors: {
            $push: {
              vendorId:      '$_id.vendorId',
              vendorName:    '$vendorName',
              vendorCode:    '$vendorCode',
              minPrice:      '$minPrice',
              maxPrice:      '$maxPrice',
              avgPrice:      '$avgPrice',
              lastPrice:     '$lastPrice',
              purchaseCount: '$purchaseCount',
              totalQty:      '$totalQty',
              totalValue:    '$totalValue',
            },
          },
          overallMin: { $min: '$minPrice' },
          overallMax: { $max: '$maxPrice' },
        },
      },
      {
        $lookup: {
          from: 'ingredients',
          let: { iid: '$_id', hid: hotelId },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$_id', '$$iid'] }, { $eq: ['$hotelId', '$$hid'] }] } } },
            { $project: { costPerUnit: 1 } },
          ],
          as: 'ing',
        },
      },
      {
        $project: {
          _id:            0,
          ingredientId:   '$_id',
          ingredientName: 1,
          unit:           1,
          vendors:        1,
          overallMin:     1,
          overallMax:     1,
          currentWAC:     { $ifNull: [{ $arrayElemAt: ['$ing.costPerUnit', 0] }, 0] },
        },
      },
      { $sort: { ingredientName: 1 } },
    ]);

    type VendorRow = { avgPrice: number; minPrice: number; maxPrice: number; lastPrice: number; totalValue: number };
    return res.json(rows.map(r => ({
      ...r,
      overallMin: round2(r.overallMin),
      overallMax: round2(r.overallMax),
      currentWAC: round2(r.currentWAC),
      vendors: (r.vendors as VendorRow[])
        .map(v => ({
          ...v,
          minPrice:   round2(v.minPrice),
          maxPrice:   round2(v.maxPrice),
          avgPrice:   round2(v.avgPrice),
          lastPrice:  round2(v.lastPrice),
          totalValue: round2(v.totalValue),
        }))
        .sort((a, b) => a.avgPrice - b.avgPrice),
    })));
  } catch (err) {
    return sendError(res, 500, 'Vendor price comparison failed', err);
  }
});

// ── 4. GET /inventory-value ───────────────────────────────────────────────────

router.get('/inventory-value', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);

    const [agg] = await Ingredient.aggregate([
      { $match: { hotelId } },
      {
        $addFields: {
          value:        { $multiply: ['$currentStock', { $ifNull: ['$costPerUnit', 0] }] },
          isLowStock:   { $and: [{ $gt: ['$lowStockThreshold', 0] }, { $gt: ['$currentStock', 0] }, { $lte: ['$currentStock', '$lowStockThreshold'] }] },
          isOutOfStock: { $lte: ['$currentStock', 0] },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id:               null,
                totalIngredients:  { $sum: 1 },
                currentStockValue: { $sum: '$value' },
                lowStockCount:     { $sum: { $cond: ['$isLowStock', 1, 0] } },
                lowStockValue:     { $sum: { $cond: ['$isLowStock', '$value', 0] } },
                outOfStockCount:   { $sum: { $cond: ['$isOutOfStock', 1, 0] } },
                outOfStockValue:   { $sum: { $cond: ['$isOutOfStock', '$value', 0] } },
              },
            },
          ],
          topByValue: [
            { $sort: { value: -1 } },
            { $limit: 20 },
            { $project: { name: 1, unit: 1, currentStock: 1, costPerUnit: 1, value: 1, lowStockThreshold: 1 } },
          ],
          lowStockItems: [
            { $match: { isLowStock: true } },
            { $sort: { currentStock: 1 } },
            { $project: { name: 1, unit: 1, currentStock: 1, lowStockThreshold: 1, costPerUnit: 1, value: 1 } },
          ],
          outOfStockItems: [
            { $match: { isOutOfStock: true } },
            { $sort: { name: 1 } },
            { $project: { name: 1, unit: 1, costPerUnit: 1 } },
          ],
        },
      },
    ]);

    type StockItem = { value?: number; costPerUnit?: number; [k: string]: unknown };
    const fix = (arr: StockItem[]) => arr.map(i => ({ ...i, value: round2(Number(i.value ?? 0)), costPerUnit: round2(Number(i.costPerUnit ?? 0)) }));
    const sm  = agg?.summary?.[0] ?? {};

    return res.json({
      summary: {
        totalIngredients:  sm.totalIngredients  ?? 0,
        currentStockValue: round2(sm.currentStockValue ?? 0),
        lowStockCount:     sm.lowStockCount     ?? 0,
        lowStockValue:     round2(sm.lowStockValue ?? 0),
        outOfStockCount:   sm.outOfStockCount   ?? 0,
        outOfStockValue:   round2(sm.outOfStockValue ?? 0),
      },
      topByValue:      fix(agg?.topByValue      ?? []),
      lowStockItems:   fix(agg?.lowStockItems   ?? []),
      outOfStockItems: fix(agg?.outOfStockItems ?? []),
    });
  } catch (err) {
    return sendError(res, 500, 'Inventory value failed', err);
  }
});

// ── 5. GET /stock-movement?from=&to= ─────────────────────────────────────────

router.get('/stock-movement', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const days    = daysBetween(start, end);

    const [consumed, allIngredients] = await Promise.all([
      Order.aggregate([
        { $match: { hotelId, status: { $ne: 'cancelled' }, createdAt: { $gte: start, $lte: end } } },
        ...cogsStages(hotelId),
        { $match: { 'ing._id': { $ne: null } } },
        {
          $group: {
            _id:           '$ing._id',
            name:          { $first: '$ing.name' },
            unit:          { $first: '$ing.unit' },
            currentStock:  { $first: '$ing.currentStock' },
            costPerUnit:   { $first: '$ing.costPerUnit' },
            totalConsumed: {
              $sum: { $multiply: [{ $ifNull: ['$prod.recipe.quantity', 0] }, { $ifNull: ['$items.quantity', 0] }] },
            },
            orderSet: { $addToSet: '$_id' },
          },
        },
        {
          $addFields: {
            orderCount:          { $size: '$orderSet' },
            avgDailyConsumption: { $divide: ['$totalConsumed', days] },
            value:               { $multiply: ['$currentStock', { $ifNull: ['$costPerUnit', 0] }] },
          },
        },
        { $sort: { totalConsumed: -1 } },
      ]),
      Ingredient.find({ hotelId }).select('_id name unit currentStock costPerUnit').lean(),
    ]);

    const consumedIds = new Set(consumed.map((c: { _id: unknown }) => String(c._id)));

    const deadStock = allIngredients
      .filter(i => i.currentStock > 0 && !consumedIds.has(String(i._id)))
      .map(i => ({
        ingredientId:        String(i._id),
        name:                i.name,
        unit:                i.unit,
        currentStock:        i.currentStock,
        costPerUnit:         round2(i.costPerUnit),
        value:               round2(i.currentStock * i.costPerUnit),
        totalConsumed:       0,
        avgDailyConsumption: 0,
        orderCount:          0,
      }));

    type ConsumedRow = { _id: unknown; costPerUnit: number; totalConsumed: number; avgDailyConsumption: number; value: number };
    const active = consumed.filter((c: ConsumedRow) => c.totalConsumed > 0);
    const mid    = active.length > 0 ? (active[Math.floor(active.length / 2)] as ConsumedRow).totalConsumed : 0;

    const fmt = (c: ConsumedRow & Record<string, unknown>) => ({
      ...c,
      ingredientId:        String(c._id),
      costPerUnit:         round2(c.costPerUnit),
      totalConsumed:       round2(c.totalConsumed),
      avgDailyConsumption: round2(c.avgDailyConsumption),
      value:               round2(c.value),
    });

    const fastMoving = active.filter((c: ConsumedRow) => c.totalConsumed >= mid).map(fmt).slice(0, 20);
    const slowMoving = active.filter((c: ConsumedRow) => c.totalConsumed < mid).map(fmt).slice(0, 20);

    return res.json({
      period:  { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), days },
      summary: {
        fastMovingCount: fastMoving.length,
        slowMovingCount: slowMoving.length,
        deadStockCount:  deadStock.length,
        deadStockValue:  round2(deadStock.reduce((s, d) => s + d.value, 0)),
      },
      fastMoving,
      slowMoving,
      deadStock: deadStock.slice(0, 20),
    });
  } catch (err) {
    return sendError(res, 500, 'Stock movement failed', err);
  }
});

// ── 6. GET /stock-turnover?from=&to= ─────────────────────────────────────────

router.get('/stock-turnover', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const days    = daysBetween(start, end);

    const [cogsAgg, inventoryAgg] = await Promise.all([
      Order.aggregate([
        { $match: { hotelId, status: { $ne: 'cancelled' }, createdAt: { $gte: start, $lte: end } } },
        ...cogsStages(hotelId),
        {
          $group: {
            _id: { oid: '$_id', pid: '$items.product' },
            qty: { $first: '$items.quantity' },
            recipeCostPerUnit: {
              $sum: { $multiply: [{ $ifNull: ['$prod.recipe.quantity', 0] }, { $ifNull: ['$ing.costPerUnit', 0] }] },
            },
          },
        },
        { $addFields: { itemCOGS: { $multiply: ['$recipeCostPerUnit', '$qty'] } } },
        { $group: { _id: null, totalCOGS: { $sum: '$itemCOGS' } } },
      ]),
      Ingredient.aggregate([
        { $match: { hotelId } },
        { $group: { _id: null, inventoryValue: { $sum: { $multiply: ['$currentStock', { $ifNull: ['$costPerUnit', 0] }] } } } },
      ]),
    ]);

    const cogs           = cogsAgg[0]?.totalCOGS        ?? 0;
    const inventoryValue = inventoryAgg[0]?.inventoryValue ?? 0;
    const annualCOGS     = days > 0 ? (cogs / days) * 365 : 0;
    const turnoverRatio  = inventoryValue > 0 ? round2(annualCOGS / inventoryValue) : 0;
    const daysOfInventory = cogs > 0      ? round2(inventoryValue / (cogs / days)) : 0;

    return res.json({
      period:         { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), days },
      cogs:           round2(cogs),
      inventoryValue: round2(inventoryValue),
      annualCOGS:     round2(annualCOGS),
      turnoverRatio,
      daysOfInventory,
      avgDailyCOGS:   round2(cogs / days),
    });
  } catch (err) {
    return sendError(res, 500, 'Stock turnover failed', err);
  }
});

// ── 7. GET /purchase-intelligence?from=&to= ───────────────────────────────────

router.get('/purchase-intelligence', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);

    const [agg] = await GRN.aggregate([
      {
        $match: {
          hotelId, isDeleted: false,
          status: { $in: ['completed', 'partial'] },
          receiveDate: { $gte: start, $lte: end },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.purchasePrice': { $gt: 0 } } },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id:               null,
                totalGRNSet:       { $addToSet: '$grnNumber' },
                totalSpend:        { $sum: { $multiply: ['$items.receivedQty', '$items.purchasePrice'] } },
                uniqueVendors:     { $addToSet: '$vendorId' },
                uniqueIngredients: { $addToSet: '$items.ingredientId' },
              },
            },
            { $addFields: { totalGRNs: { $size: '$totalGRNSet' }, uniqueVendors: { $size: '$uniqueVendors' }, uniqueIngredients: { $size: '$uniqueIngredients' } } },
          ],
          topIngredients: [
            {
              $group: {
                _id:        '$items.ingredientId',
                name:       { $first: '$items.productName' },
                unit:       { $first: '$items.unit' },
                totalQty:   { $sum: '$items.receivedQty' },
                totalValue: { $sum: { $multiply: ['$items.receivedQty', '$items.purchasePrice'] } },
                grnCount:   { $sum: 1 },
                avgPrice:   { $avg: '$items.purchasePrice' },
              },
            },
            { $sort: { totalValue: -1 } },
            { $limit: 15 },
          ],
          vendorContribution: [
            {
              $group: {
                _id:        '$vendorId',
                vendorName: { $first: '$vendorSnapshot.businessName' },
                vendorCode: { $first: '$vendorSnapshot.vendorCode' },
                totalSpend: { $sum: { $multiply: ['$items.receivedQty', '$items.purchasePrice'] } },
                grnSet:     { $addToSet: '$grnNumber' },
              },
            },
            { $addFields: { grnCount: { $size: '$grnSet' } } },
            { $sort: { totalSpend: -1 } },
            { $limit: 10 },
          ],
          monthlySpend: [
            {
              $group: {
                _id:        { $dateToString: { format: '%Y-%m', date: '$receiveDate' } },
                totalSpend: { $sum: { $multiply: ['$items.receivedQty', '$items.purchasePrice'] } },
                grnSet:     { $addToSet: '$grnNumber' },
              },
            },
            { $addFields: { grnCount: { $size: '$grnSet' } } },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]);

    const sm          = agg?.summary?.[0] ?? {};
    const totalSpend  = sm.totalSpend ?? 0;

    return res.json({
      period:  { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
      summary: {
        totalGRNs:         sm.totalGRNs         ?? 0,
        totalSpend:        round2(totalSpend),
        uniqueVendors:     sm.uniqueVendors     ?? 0,
        uniqueIngredients: sm.uniqueIngredients ?? 0,
      },
      topIngredients: (agg?.topIngredients ?? []).map((i: { totalValue: number; avgPrice: number; [k: string]: unknown }) => ({
        ...i, totalValue: round2(i.totalValue), avgPrice: round2(i.avgPrice),
      })),
      vendorContribution: (agg?.vendorContribution ?? []).map((v: { totalSpend: number; [k: string]: unknown }) => ({
        ...v, totalSpend: round2(v.totalSpend), pct: pct(v.totalSpend, totalSpend),
      })),
      monthlySpend: (agg?.monthlySpend ?? []).map((m: { totalSpend: number; [k: string]: unknown }) => ({
        ...m, totalSpend: round2(m.totalSpend),
      })),
    });
  } catch (err) {
    return sendError(res, 500, 'Purchase intelligence failed', err);
  }
});

export default router;
