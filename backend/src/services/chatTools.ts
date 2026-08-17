// ─── AI Chat Tool Functions ───────────────────────────────────────────────────
// Each tool receives hotelId from the authenticated server context.
// Gemini NEVER provides hotelId — it can only provide date ranges and limits.
// All results are limited in size to prevent token runaway.

import mongoose from 'mongoose';
import Order from '../models/Order';
import HourlyMetrics from '../models/HourlyMetrics';
import DailySnapshot from '../models/DailySnapshot';
import Ingredient from '../models/Ingredient';
import Expense from '../models/Expense';
import VendorLedgerEntry from '../models/VendorLedgerEntry';

const MAX_ITEMS = 20;

// Validate date string — must be YYYY-MM-DD and not in the future
function validateDate(d: unknown): string | null {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (d > today) return null;
  return d;
}

function parseLimit(l: unknown, max = MAX_ITEMS): number {
  const n = typeof l === 'number' ? Math.floor(l) : parseInt(String(l ?? '10'), 10);
  return Math.max(1, Math.min(isNaN(n) ? 10 : n, max));
}

// ─── Tool: getRevenue ─────────────────────────────────────────────────────────
export async function toolGetRevenue(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const start = validateDate(args.startDate) ?? yesterday;
  const end   = validateDate(args.endDate)   ?? start;

  const snaps = await DailySnapshot.find(
    { hotelId: hotelOId, date: { $gte: start, $lte: end } },
    { date: 1, totalRevenue: 1, totalOrders: 1, avgOrderValue: 1, cancelledOrders: 1 },
  ).sort({ date: 1 }).lean();

  const totalRevenue = snaps.reduce((s, d) => s + d.totalRevenue, 0);
  const totalOrders  = snaps.reduce((s, d) => s + d.totalOrders,  0);

  // Include today's live data if range includes today
  if (end >= today) {
    const [agg] = await HourlyMetrics.aggregate([
      { $match: { hotelId: hotelOId, date: today } },
      { $group: { _id: null, revenue: { $sum: '$revenue' }, orders: { $sum: '$orderCount' } } },
    ]);
    if (agg) {
      return {
        period:        `${start} to ${end}`,
        totalRevenue:  +(totalRevenue + (agg.revenue ?? 0)).toFixed(2),
        totalOrders:   totalOrders + (agg.orders ?? 0),
        avgOrderValue: totalOrders + agg.orders > 0
          ? +((totalRevenue + agg.revenue) / (totalOrders + agg.orders)).toFixed(2)
          : 0,
        note: 'Includes today\'s partial data',
        dailyBreakdown: snaps.map((s) => ({
          date: s.date, revenue: s.totalRevenue, orders: s.totalOrders,
        })),
      };
    }
  }

  return {
    period:        `${start} to ${end}`,
    totalRevenue:  +totalRevenue.toFixed(2),
    totalOrders,
    avgOrderValue: totalOrders > 0 ? +(totalRevenue / totalOrders).toFixed(2) : 0,
    dailyBreakdown: snaps.map((s) => ({
      date: s.date, revenue: s.totalRevenue, orders: s.totalOrders,
    })),
  };
}

// ─── Tool: getTopProducts ─────────────────────────────────────────────────────
export async function toolGetTopProducts(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown; limit?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;
  const limit     = parseLimit(args.limit, 20);

  const startDate = new Date(`${startStr}T00:00:00.000Z`);
  const endDate   = new Date(`${endStr}T23:59:59.999Z`);

  const items = await Order.aggregate([
    { $match: { hotelId: hotelOId, createdAt: { $gte: startDate, $lte: endDate }, status: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.productName', qty: { $sum: '$items.quantity' }, revenue: { $sum: '$items.total' } } },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);

  return {
    period: `${startStr} to ${endStr}`,
    products: items.map((p) => ({
      name:    p._id,
      qty:     p.qty,
      revenue: +p.revenue.toFixed(2),
    })),
  };
}

// ─── Tool: getLowStockItems ───────────────────────────────────────────────────
export async function toolGetLowStockItems(
  hotelId: string,
): Promise<Record<string, unknown>> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  const items = await Ingredient.find(
    { hotelId: hotelOId, $expr: { $lte: ['$currentStock', '$lowStockThreshold'] } },
    { name: 1, currentStock: 1, lowStockThreshold: 1, unit: 1 },
  ).sort({ currentStock: 1 }).limit(MAX_ITEMS).lean();

  return {
    count: items.length,
    items: items.map((i) => ({
      name:              (i as any).name,
      currentStock:      (i as any).currentStock,
      lowStockThreshold: (i as any).lowStockThreshold,
      unit:              (i as any).unit,
    })),
  };
}

// ─── Tool: getVendorBalances ──────────────────────────────────────────────────
export async function toolGetVendorBalances(
  hotelId: string,
): Promise<Record<string, unknown>> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  // Get latest runningBalance per vendor (most recent ledger entry per vendor)
  const balances = await VendorLedgerEntry.aggregate([
    { $match: { hotelId: hotelOId } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$vendorId', runningBalance: { $first: '$runningBalance' } } },
    { $match: { runningBalance: { $gt: 0 } } },
    { $sort: { runningBalance: -1 } },
    { $limit: MAX_ITEMS },
    { $lookup: { from: 'vendors', localField: '_id', foreignField: '_id', as: 'vendor' } },
  ]);

  const total = balances.reduce((s: number, b: any) => s + (b.runningBalance ?? 0), 0);

  return {
    totalOutstanding: +total.toFixed(2),
    vendors: balances.map((b: any) => ({
      name:        (b.vendor?.[0]?.vendorName ?? 'Unknown'),
      outstanding: +(b.runningBalance ?? 0).toFixed(2),
    })),
  };
}

// ─── Tool: getPaymentBreakdown ────────────────────────────────────────────────
export async function toolGetPaymentBreakdown(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;

  const snaps = await DailySnapshot.find(
    { hotelId: hotelOId, date: { $gte: startStr, $lte: endStr } },
    { paymentBreakdown: 1, totalRevenue: 1 },
  ).lean();

  const totals = { cash: 0, upi: 0, card: 0, split: 0 };
  let totalRev = 0;
  for (const s of snaps) {
    const pb = (s.paymentBreakdown as any) ?? {};
    totals.cash  += pb.cash  ?? 0;
    totals.upi   += pb.upi   ?? 0;
    totals.card  += pb.card  ?? 0;
    totals.split += pb.split ?? 0;
    totalRev     += s.totalRevenue;
  }

  return {
    period:       `${startStr} to ${endStr}`,
    totalRevenue: +totalRev.toFixed(2),
    breakdown: {
      cash:  { amount: +totals.cash.toFixed(2),  pct: totalRev > 0 ? +((totals.cash  / totalRev) * 100).toFixed(1) : 0 },
      upi:   { amount: +totals.upi.toFixed(2),   pct: totalRev > 0 ? +((totals.upi   / totalRev) * 100).toFixed(1) : 0 },
      card:  { amount: +totals.card.toFixed(2),  pct: totalRev > 0 ? +((totals.card  / totalRev) * 100).toFixed(1) : 0 },
      split: { amount: +totals.split.toFixed(2), pct: totalRev > 0 ? +((totals.split / totalRev) * 100).toFixed(1) : 0 },
    },
  };
}

// ─── Tool: getOnlineOrderMetrics ──────────────────────────────────────────────
export async function toolGetOnlineOrderMetrics(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;

  const snaps = await DailySnapshot.find(
    { hotelId: hotelOId, date: { $gte: startStr, $lte: endStr } },
    { sourceBreakdown: 1, totalRevenue: 1 },
  ).lean();

  const totals = { dineIn: 0, takeaway: 0, qr: 0, swiggy: 0, zomato: 0, other: 0 };
  let totalRev = 0;
  for (const s of snaps) {
    const sb = (s.sourceBreakdown as any) ?? {};
    Object.keys(totals).forEach((k) => { (totals as any)[k] += sb[k] ?? 0; });
    totalRev += s.totalRevenue;
  }

  return {
    period:       `${startStr} to ${endStr}`,
    totalRevenue: +totalRev.toFixed(2),
    sources: Object.entries(totals).map(([source, amount]) => ({
      source,
      amount:  +amount.toFixed(2),
      pct:     totalRev > 0 ? +((amount / totalRev) * 100).toFixed(1) : 0,
    })).sort((a, b) => b.amount - a.amount),
  };
}

// ─── Tool: getExpenses ────────────────────────────────────────────────────────
export async function toolGetExpenses(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;
  const startDate = new Date(`${startStr}T00:00:00.000Z`);
  const endDate   = new Date(`${endStr}T23:59:59.999Z`);

  const agg = await Expense.aggregate([
    { $match: { hotelId: hotelOId, date: { $gte: startDate, $lte: endDate } } },
    {
      $group: {
        _id:   '$category',
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 10 },
  ]);

  const grandTotal = agg.reduce((s: number, c: any) => s + c.total, 0);

  return {
    period:     `${startStr} to ${endStr}`,
    grandTotal: +grandTotal.toFixed(2),
    categories: agg.map((c: any) => ({
      category: c._id ?? 'Uncategorized',
      total:    +c.total.toFixed(2),
      count:    c.count,
    })),
  };
}

// ─── Tool: getCancellations ───────────────────────────────────────────────────
export async function toolGetCancellations(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;

  const snaps = await DailySnapshot.find(
    { hotelId: hotelOId, date: { $gte: startStr, $lte: endStr } },
    { date: 1, cancelledOrders: 1, cancelledRevenue: 1, totalOrders: 1 },
  ).lean();

  const totalCancelled = snaps.reduce((s, d) => s + d.cancelledOrders, 0);
  const totalOrders    = snaps.reduce((s, d) => s + d.totalOrders, 0);
  const totalLost      = snaps.reduce((s, d) => s + d.cancelledRevenue, 0);

  return {
    period:           `${startStr} to ${endStr}`,
    totalCancelled,
    totalOrders:      totalOrders + totalCancelled,
    cancellationRate: totalOrders + totalCancelled > 0
      ? +((totalCancelled / (totalOrders + totalCancelled)) * 100).toFixed(1)
      : 0,
    revenueLost:      +totalLost.toFixed(2),
  };
}

// ─── Tool: getOrders ─────────────────────────────────────────────────────────
export async function toolGetOrders(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;

  const snaps = await DailySnapshot.find(
    { hotelId: hotelOId, date: { $gte: startStr, $lte: endStr } },
    { date: 1, totalOrders: 1, cancelledOrders: 1, avgOrderValue: 1, hourlyOrders: 1 },
  ).sort({ date: 1 }).lean();

  const totalOrders    = snaps.reduce((s, d) => s + d.totalOrders,    0);
  const totalCancelled = snaps.reduce((s, d) => s + d.cancelledOrders, 0);

  // Peak hour across the period
  const hourTotals = Array(24).fill(0) as number[];
  for (const s of snaps) {
    const h = (s.hourlyOrders as number[]) ?? [];
    h.forEach((count, i) => { hourTotals[i] += count; });
  }
  const peakHour = hourTotals.reduce((mi, v, i, arr) => (v > arr[mi] ? i : mi), 0);

  return {
    period:           `${startStr} to ${endStr}`,
    totalOrders,
    cancelledOrders:  totalCancelled,
    completedOrders:  totalOrders - totalCancelled,
    cancellationRate: totalOrders > 0
      ? +((totalCancelled / (totalOrders + totalCancelled)) * 100).toFixed(1)
      : 0,
    peakHour,
    dailyBreakdown: snaps.map((s) => ({
      date:            s.date,
      orders:          s.totalOrders,
      cancelled:       s.cancelledOrders,
      avgOrderValue:   s.avgOrderValue,
    })),
  };
}

// ─── Tool: getDiscounts ───────────────────────────────────────────────────────
export async function toolGetDiscounts(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;
  const startDate = new Date(`${startStr}T00:00:00.000Z`);
  const endDate   = new Date(`${endStr}T23:59:59.999Z`);

  const [agg] = await Order.aggregate([
    {
      $match: {
        hotelId:   hotelOId,
        createdAt: { $gte: startDate, $lte: endDate },
        status:    { $ne: 'cancelled' },
      },
    },
    {
      $group: {
        _id:           null,
        totalRevenue:  { $sum: '$grandTotal' },
        totalDiscount: { $sum: '$discountAmount' },
        ordersWithDiscount: {
          $sum: { $cond: [{ $gt: ['$discountAmount', 0] }, 1, 0] },
        },
        totalOrders: { $sum: 1 },
      },
    },
  ]);

  if (!agg) {
    return { period: `${startStr} to ${endStr}`, totalDiscount: 0, discountRate: 0, ordersWithDiscount: 0 };
  }

  const discountRate = agg.totalRevenue + agg.totalDiscount > 0
    ? +((agg.totalDiscount / (agg.totalRevenue + agg.totalDiscount)) * 100).toFixed(1)
    : 0;

  return {
    period:             `${startStr} to ${endStr}`,
    totalDiscount:      +agg.totalDiscount.toFixed(2),
    totalRevenue:       +agg.totalRevenue.toFixed(2),
    discountRate,
    ordersWithDiscount: agg.ordersWithDiscount,
    totalOrders:        agg.totalOrders,
    discountPenetration: agg.totalOrders > 0
      ? +((agg.ordersWithDiscount / agg.totalOrders) * 100).toFixed(1)
      : 0,
  };
}

// ─── Tool: getRefunds ────────────────────────────────────────────────────────
export async function toolGetRefunds(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;
  const startDate = new Date(`${startStr}T00:00:00.000Z`);
  const endDate   = new Date(`${endStr}T23:59:59.999Z`);

  // Look for cancelled orders (proxy for refunds) and refunded payments
  const [orderStats] = await Order.aggregate([
    {
      $match: {
        hotelId:   hotelOId,
        createdAt: { $gte: startDate, $lte: endDate },
        status:    'cancelled',
      },
    },
    {
      $group: {
        _id:          null,
        count:        { $sum: 1 },
        totalValue:   { $sum: '$grandTotal' },
      },
    },
  ]);

  return {
    period:           `${startStr} to ${endStr}`,
    cancelledOrders:  orderStats?.count        ?? 0,
    cancelledValue:   +(orderStats?.totalValue ?? 0).toFixed(2),
    note: 'Refund data shows cancelled orders. Payment gateway refunds tracked separately.',
  };
}

// ─── Tool: getCustomerMetrics ─────────────────────────────────────────────────
export async function toolGetCustomerMetrics(
  hotelId: string,
  args: { startDate?: unknown; endDate?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startStr  = validateDate(args.startDate) ?? yesterday;
  const endStr    = validateDate(args.endDate)   ?? startStr;
  const startDate = new Date(`${startStr}T00:00:00.000Z`);
  const endDate   = new Date(`${endStr}T23:59:59.999Z`);

  const guestStats = await Order.aggregate([
    {
      $match: {
        hotelId:   hotelOId,
        createdAt: { $gte: startDate, $lte: endDate },
        status:    { $ne: 'cancelled' },
        guestId:   { $ne: null },
      },
    },
    { $group: { _id: '$guestId', count: { $sum: 1 }, spend: { $sum: '$grandTotal' } } },
  ]);

  const uniqueGuests  = guestStats.length;
  const repeatGuests  = guestStats.filter((g) => g.count > 1).length;
  const totalGuestRev = guestStats.reduce((s, g) => s + g.spend, 0);
  const avgSpendPerGuest = uniqueGuests > 0 ? +(totalGuestRev / uniqueGuests).toFixed(2) : 0;

  return {
    period:           `${startStr} to ${endStr}`,
    uniqueGuests,
    repeatGuests,
    repeatRate:       uniqueGuests > 0 ? +((repeatGuests / uniqueGuests) * 100).toFixed(1) : 0,
    avgSpendPerGuest,
    note: uniqueGuests === 0 ? 'No guest-linked orders in this period. Guest linking requires customer profiles.' : null,
  };
}

// ─── Tool: getAlerts ─────────────────────────────────────────────────────────
export async function toolGetAlerts(
  hotelId: string,
  args: { date?: unknown },
): Promise<Record<string, unknown>> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const dateStr   = validateDate(args.date) ?? new Date().toISOString().slice(0, 10);

  // Try persistent alerts first
  const Alert = (await import('../models/Alert')).default;
  const persistedAlerts = await Alert.find(
    { hotelId: hotelOId, dedupDate: dateStr, resolvedAt: null },
    { type: 1, severity: 1, title: 1, message: 1, isRead: 1 },
  ).sort({ severity: 1 }).lean();

  return {
    date:   dateStr,
    count:  persistedAlerts.length,
    alerts: persistedAlerts.map((a: any) => ({
      type:     a.type,
      severity: a.severity,
      title:    a.title,
      message:  a.message,
      isRead:   a.isRead,
    })),
  };
}

// ─── Tool router ─────────────────────────────────────────────────────────────
// Dispatches Gemini function calls to the correct tool with server-enforced hotelId.
// Max 5 tool calls per chat request to prevent runaway.

const TOOL_MAP: Record<
  string,
  (hotelId: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
> = {
  getRevenue:            (h, a) => toolGetRevenue(h, a),
  getTopProducts:        (h, a) => toolGetTopProducts(h, a),
  getLowStockItems:      (h, _) => toolGetLowStockItems(h),
  getVendorBalances:     (h, _) => toolGetVendorBalances(h),
  getPaymentBreakdown:   (h, a) => toolGetPaymentBreakdown(h, a),
  getOnlineOrderMetrics: (h, a) => toolGetOnlineOrderMetrics(h, a),
  getExpenses:           (h, a) => toolGetExpenses(h, a),
  getCancellations:      (h, a) => toolGetCancellations(h, a),
  getOrders:             (h, a) => toolGetOrders(h, a),
  getDiscounts:          (h, a) => toolGetDiscounts(h, a),
  getRefunds:            (h, a) => toolGetRefunds(h, a),
  getCustomerMetrics:    (h, a) => toolGetCustomerMetrics(h, a),
  getAlerts:             (h, a) => toolGetAlerts(h, a),
};

export async function executeTool(
  toolName: string,
  hotelId:  string,
  args:     Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // hasOwnProperty prevents prototype-chain names (constructor, __proto__, toString) from
  // being treated as valid tools if Gemini sends a crafted tool name.
  const fn = Object.prototype.hasOwnProperty.call(TOOL_MAP, toolName)
    ? TOOL_MAP[toolName]
    : undefined;
  if (!fn) return { error: `Unknown tool: ${toolName}` };
  try {
    return await fn(hotelId, args);
  } catch (err) {
    return { error: `Tool execution failed: ${String(err)}` };
  }
}

export const AVAILABLE_TOOLS = Object.keys(TOOL_MAP);
