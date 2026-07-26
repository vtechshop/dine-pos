import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Expense from '../models/Expense';
import WasteLog from '../models/WasteLog';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseRange(from?: unknown, to?: unknown) {
  const start = from ? new Date(String(from)) : new Date(Date.now() - 29 * 86_400_000);
  const end   = to   ? new Date(String(to))   : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function pct(num: number, den: number) { return den > 0 ? round2((num / den) * 100) : 0; }

const VALID_MENU_SORT = new Set(['margin', 'revenue', 'qty', 'cogs', 'grossProfit', 'name']);
const VALID_GROUPBY   = new Set(['day', 'week', 'month']);

// Shared COGS pipeline stages: unwind items → lookup product recipe → lookup ingredient cost
// Expects `hotelId` ObjectId and the prior $match stage having been applied.
// After these stages, group by { oid, pid } to sum recipeCostPerUnit per order item.
function cogsLookupStages(hotelId: mongoose.Types.ObjectId): mongoose.PipelineStage[] {
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
          { $project: { costPerUnit: 1 } },
        ],
        as: 'ing',
      },
    },
    { $unwind: { path: '$ing', preserveNullAndEmptyArrays: true } },
  ] as mongoose.PipelineStage[];
}

// ── GET /dashboard ────────────────────────────────────────────────────────────

router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);

    const matchOrders: mongoose.FilterQuery<typeof Order> = {
      hotelId,
      status: { $ne: 'cancelled' },
      createdAt: { $gte: start, $lte: end },
    };

    const [revenueAgg, cogsAgg, expenseAgg, wasteAgg] = await Promise.all([
      // Revenue + order count
      Order.aggregate([
        { $match: matchOrders },
        { $group: { _id: null, revenue: { $sum: '$grandTotal' }, orders: { $sum: 1 } } },
      ]),

      // COGS via recipe BOM × ingredient costPerUnit × qty sold
      Order.aggregate([
        { $match: matchOrders },
        ...cogsLookupStages(hotelId),
        {
          $group: {
            _id: { oid: '$_id', pid: '$items.product' },
            qty:  { $first: '$items.quantity' },
            recipeCostPerUnit: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$prod.recipe.quantity', 0] },
                  { $ifNull: ['$ing.costPerUnit', 0] },
                ],
              },
            },
          },
        },
        { $addFields: { itemCOGS: { $multiply: ['$recipeCostPerUnit', '$qty'] } } },
        { $group: { _id: null, totalCOGS: { $sum: '$itemCOGS' } } },
      ]),

      // Expenses
      Expense.aggregate([
        { $match: { hotelId, date: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),

      // Waste cost
      WasteLog.aggregate([
        { $match: { hotelId, date: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$estimatedLoss' } } },
      ]),
    ]);

    const revenue        = revenueAgg[0]?.revenue ?? 0;
    const orderCount     = revenueAgg[0]?.orders  ?? 0;
    const cogs           = cogsAgg[0]?.totalCOGS  ?? 0;
    const totalExpenses  = expenseAgg[0]?.total    ?? 0;
    const wasteTotal     = wasteAgg[0]?.total      ?? 0;
    const grossProfit    = revenue - cogs;
    const netProfit      = grossProfit - totalExpenses - wasteTotal;

    return res.json({
      period:         { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
      revenue:        round2(revenue),
      orderCount,
      cogs:           round2(cogs),
      foodCostPct:    pct(cogs, revenue),
      grossProfit:    round2(grossProfit),
      grossMarginPct: pct(grossProfit, revenue),
      totalExpenses:  round2(totalExpenses),
      wasteTotal:     round2(wasteTotal),
      netProfit:      round2(netProfit),
      netMarginPct:   pct(netProfit, revenue),
    });
  } catch (err) {
    return sendError(res, 500, 'Finance dashboard failed', err);
  }
});

// ── GET /menu-profitability ───────────────────────────────────────────────────

router.get('/menu-profitability', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, sort = 'revenue', dir = 'desc', limit = '50', skip = '0' } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId  = new mongoose.Types.ObjectId(req.hotelId);
    const sortKey  = VALID_MENU_SORT.has(String(sort)) ? String(sort) : 'revenue';
    const sortDir  = String(dir) === 'asc' ? 1 : -1;
    const lim      = Math.min(Math.max(1, parseInt(String(limit), 10) || 50), 200);
    const sk       = Math.max(0, parseInt(String(skip), 10) || 0);

    const matchOrders: mongoose.FilterQuery<typeof Order> = {
      hotelId,
      status: { $ne: 'cancelled' },
      createdAt: { $gte: start, $lte: end },
    };

    // Mongo sort key mapping
    const mongoSortMap: Record<string, string> = {
      margin:      'marginPct',
      revenue:     'revenue',
      qty:         'qtySold',
      cogs:        'totalCOGS',
      grossProfit: 'grossProfit',
      name:        'productName',
    };
    const mongoSortKey = mongoSortMap[sortKey] ?? 'revenue';

    const pipeline: mongoose.PipelineStage[] = [
      { $match: matchOrders },
      ...cogsLookupStages(hotelId),
      // Phase 1: group by (orderId + product) to get recipe cost per order item
      {
        $group: {
          _id:         { oid: '$_id', pid: '$items.product' },
          productName: { $first: '$items.productName' },
          qty:         { $first: '$items.quantity' },
          unitPrice:   { $first: '$items.price' },
          recipeCostPerUnit: {
            $sum: {
              $multiply: [
                { $ifNull: ['$prod.recipe.quantity', 0] },
                { $ifNull: ['$ing.costPerUnit', 0] },
              ],
            },
          },
        },
      },
      {
        $addFields: {
          itemRevenue: { $multiply: ['$unitPrice', '$qty'] },
          itemCOGS:    { $multiply: ['$recipeCostPerUnit', '$qty'] },
        },
      },
      // Phase 2: group by product
      {
        $group: {
          _id:         '$_id.pid',
          productName: { $first: '$productName' },
          qtySold:     { $sum: '$qty' },
          revenue:     { $sum: '$itemRevenue' },
          totalCOGS:   { $sum: '$itemCOGS' },
          avgSellingPrice:      { $avg: '$unitPrice' },
          avgRecipeCostPerUnit: { $avg: '$recipeCostPerUnit' },
        },
      },
      {
        $addFields: {
          grossProfit:    { $subtract: ['$revenue', '$totalCOGS'] },
          grossProfitPerUnit: {
            $cond: [
              { $gt: ['$qtySold', 0] },
              { $divide: [{ $subtract: ['$revenue', '$totalCOGS'] }, '$qtySold'] },
              0,
            ],
          },
          marginPct: {
            $cond: [
              { $gt: ['$revenue', 0] },
              {
                $multiply: [
                  { $divide: [{ $subtract: ['$revenue', '$totalCOGS'] }, '$revenue'] },
                  100,
                ],
              },
              0,
            ],
          },
        },
      },
      // Count total before pagination
      {
        $facet: {
          items: [
            { $sort:  { [mongoSortKey]: sortDir } },
            { $skip:  sk },
            { $limit: lim },
            {
              $project: {
                _id:          0,
                productId:    '$_id',
                productName:  1,
                qtySold:      1,
                revenue:      1,
                totalCOGS:    1,
                grossProfit:  1,
                avgSellingPrice:      1,
                avgRecipeCostPerUnit: 1,
                grossProfitPerUnit:   1,
                marginPct:    1,
                contributionMarginPerUnit: '$grossProfitPerUnit',
              },
            },
          ],
          summary: [
            {
              $group: {
                _id:             null,
                totalProducts:   { $sum: 1 },
                totalRevenue:    { $sum: '$revenue' },
                totalCOGS:       { $sum: '$totalCOGS' },
                totalGrossProfit:{ $sum: '$grossProfit' },
              },
            },
          ],
        },
      },
    ];

    const [result] = await Order.aggregate(pipeline);

    const items   = result?.items   ?? [];
    const summary = result?.summary?.[0] ?? { totalProducts: 0, totalRevenue: 0, totalCOGS: 0, totalGrossProfit: 0 };

    return res.json({
      items: items.map((i: Record<string, number | string>) => ({
        ...i,
        revenue:              round2(Number(i.revenue)),
        totalCOGS:            round2(Number(i.totalCOGS)),
        grossProfit:          round2(Number(i.grossProfit)),
        avgSellingPrice:      round2(Number(i.avgSellingPrice)),
        avgRecipeCostPerUnit: round2(Number(i.avgRecipeCostPerUnit)),
        grossProfitPerUnit:   round2(Number(i.grossProfitPerUnit)),
        marginPct:            round2(Number(i.marginPct)),
        contributionMarginPerUnit: round2(Number(i.contributionMarginPerUnit)),
      })),
      total: summary.totalProducts,
      summary: {
        totalRevenue:     round2(summary.totalRevenue),
        totalCOGS:        round2(summary.totalCOGS),
        totalGrossProfit: round2(summary.totalGrossProfit),
        overallMarginPct: pct(summary.totalGrossProfit, summary.totalRevenue),
      },
    });
  } catch (err) {
    return sendError(res, 500, 'Menu profitability failed', err);
  }
});

// ── GET /cogs-trend ───────────────────────────────────────────────────────────

router.get('/cogs-trend', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, groupBy = 'day' } = req.query;
    const { start, end } = parseRange(from, to);
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const gb      = VALID_GROUPBY.has(String(groupBy)) ? String(groupBy) : 'day';

    const dateFmt = gb === 'week'  ? '%G-W%V'
                  : gb === 'month' ? '%Y-%m'
                  :                  '%Y-%m-%d';

    const matchOrders: mongoose.FilterQuery<typeof Order> = {
      hotelId,
      status: { $ne: 'cancelled' },
      createdAt: { $gte: start, $lte: end },
    };

    const [revenueTrend, cogsTrend] = await Promise.all([
      // Revenue per period
      Order.aggregate([
        { $match: matchOrders },
        { $group: {
          _id:     { $dateToString: { format: dateFmt, date: '$createdAt' } },
          revenue: { $sum: '$grandTotal' },
          orders:  { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),

      // COGS per period (complex pipeline)
      Order.aggregate([
        { $match: matchOrders },
        // Add date bucket before unwinding so we can carry it through
        {
          $addFields: {
            dateBucket: { $dateToString: { format: dateFmt, date: '$createdAt' } },
          },
        },
        ...cogsLookupStages(hotelId),
        // Phase 1: group by (dateBucket + orderId + product)
        {
          $group: {
            _id:  { db: '$dateBucket', oid: '$_id', pid: '$items.product' },
            qty:  { $first: '$items.quantity' },
            recipeCostPerUnit: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$prod.recipe.quantity', 0] },
                  { $ifNull: ['$ing.costPerUnit', 0] },
                ],
              },
            },
          },
        },
        { $addFields: { itemCOGS: { $multiply: ['$recipeCostPerUnit', '$qty'] } } },
        // Phase 2: group by dateBucket
        {
          $group: {
            _id:       '$_id.db',
            totalCOGS: { $sum: '$itemCOGS' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Merge revenue + COGS by period key
    const cogsMap = new Map<string, number>(cogsTrend.map(r => [r._id, r.totalCOGS]));

    const trend = revenueTrend.map(r => {
      const cogs        = cogsMap.get(r._id) ?? 0;
      const grossProfit = r.revenue - cogs;
      return {
        period:         r._id,
        revenue:        round2(r.revenue),
        cogs:           round2(cogs),
        grossProfit:    round2(grossProfit),
        grossMarginPct: pct(grossProfit, r.revenue),
        orders:         r.orders,
      };
    });

    return res.json(trend);
  } catch (err) {
    return sendError(res, 500, 'COGS trend failed', err);
  }
});

export default router;
