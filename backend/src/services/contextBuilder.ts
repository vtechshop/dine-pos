// ─── Business Context Builder ─────────────────────────────────────────────────
// Assembles a compact, pre-computed business snapshot for the AI chat system.
// Redis-first: reads from all Phase 2/3/4 caches before hitting the DB.
// Falls back gracefully — a partial context is still useful.
// Gemini NEVER receives raw series data or performs calculations.

import mongoose from 'mongoose';
import Hotel from '../models/Hotel';
import DailySnapshot from '../models/DailySnapshot';
import { computeHealthScore } from './healthScore';
import { getCachedAlerts } from '../utils/alertCache';
import { getCachedRecommendations } from '../utils/alertCache';
import { getCachedForecast } from '../utils/forecastCache';
import { getCachedInventory } from '../utils/forecastCache';
import { getCachedContext, setCachedContext } from '../utils/chatCache';
import VendorLedgerEntry from '../models/VendorLedgerEntry';
import Expense from '../models/Expense';

// ─── Type guards for cached payloads ─────────────────────────────────────────
// Caches store typed objects as `unknown`. These guards safely extract data.

function isAlertResult(v: unknown): v is {
  date: string;
  alerts: Array<{ type: string; severity: string; message: string }>;
} {
  return (
    typeof v === 'object' && v !== null &&
    Array.isArray((v as any).alerts)
  );
}

function isRecommendationSet(v: unknown): v is {
  stars:         Array<{ productName: string }>;
  puzzles:       Array<{ productName: string; revenuePerUnit: number }>;
  upsellTargets: Array<{ productName: string; reason: string }>;
} {
  return typeof v === 'object' && v !== null && Array.isArray((v as any).stars);
}

function isForecast(v: unknown): v is {
  revenueNext7d:       Array<{ date: string; value: number }>;
  forecastWeekRevenue: number;
  forecastWeekOrders:  number;
  revenueForecastMeta: { confidence: number; method: string };
  dataPoints:          number;
} {
  return (
    typeof v === 'object' && v !== null &&
    Array.isArray((v as any).revenueNext7d)
  );
}

function isInventory(v: unknown): v is {
  coverageSummary: { criticalCount: number; warningCount: number };
  totalReorderCost: number;
  criticalItems: Array<{ name: string; daysRemaining: number }>;
} {
  return typeof v === 'object' && v !== null && typeof (v as any).coverageSummary === 'object';
}

// ─── Build context string ─────────────────────────────────────────────────────

export async function buildBusinessContext(hotelId: string): Promise<string> {
  // Cache hit: avoid re-building for 30min
  const cached = await getCachedContext(hotelId);
  if (cached) return cached;

  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);

  // ── Parallel: hotel name + snapshots + all Redis caches + vendor/expense ──
  const [
    hotelResult,
    todaySnapResult,
    last7SnapResult,
    alertsResult,
    recsResult,
    forecastResult,
    inventoryResult,
    vendorAggResult,
    expenseAggResult,
  ] = await Promise.allSettled([
    Hotel.findById(hotelOId, { hotelName: 1 }).lean(),
    DailySnapshot.findOne(
      { hotelId: hotelOId, date: { $in: [today, yesterday] } },
      {
        date: 1, totalRevenue: 1, totalOrders: 1, avgOrderValue: 1,
        cancelledOrders: 1, revenueVs7DayAvgPct: 1, ordersVs7DayAvgPct: 1,
        peakHourRevenue: 1, sourceBreakdown: 1,
      },
    ).sort({ date: -1 }).lean(),
    DailySnapshot.find(
      { hotelId: hotelOId },
      { avgOrderValue: 1 },
    ).sort({ date: -1 }).limit(7).lean(),
    getCachedAlerts(hotelId, today),
    getCachedRecommendations(hotelId, today),
    getCachedForecast(hotelId),
    getCachedInventory(hotelId),
    VendorLedgerEntry.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$vendorId', runningBalance: { $first: '$runningBalance' } } },
      { $match: { runningBalance: { $gt: 0 } } },
      { $group: { _id: null, outstanding: { $sum: '$runningBalance' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: { hotelId: hotelOId, date: { $gte: new Date(`${yesterday}T00:00:00.000Z`), $lte: new Date(`${yesterday}T23:59:59.999Z`) } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const hotelName = hotelResult.status === 'fulfilled' && hotelResult.value
    ? (hotelResult.value as any).hotelName ?? 'Restaurant'
    : 'Restaurant';

  const snap           = todaySnapResult.status === 'fulfilled'  ? todaySnapResult.value    : null;
  const last7          = last7SnapResult.status === 'fulfilled'  ? (last7SnapResult.value as any[]) : [];
  const alerts         = alertsResult.status === 'fulfilled'     ? alertsResult.value       : null;
  const recs           = recsResult.status === 'fulfilled'       ? recsResult.value         : null;
  const forecast       = forecastResult.status === 'fulfilled'   ? forecastResult.value     : null;
  const inventory      = inventoryResult.status === 'fulfilled'  ? inventoryResult.value    : null;
  const vendorAgg      = vendorAggResult.status === 'fulfilled'  ? (vendorAggResult.value as any[]) : [];
  const expenseAgg     = expenseAggResult.status === 'fulfilled' ? (expenseAggResult.value as any[]) : [];
  const vendorOutstanding = +(vendorAgg[0]?.outstanding ?? 0).toFixed(0);
  const vendorCount       = vendorAgg[0]?.count ?? 0;
  const yesterdayExpenses = +(expenseAgg[0]?.total ?? 0).toFixed(0);

  const lines: string[] = [
    `=== BUSINESS INTELLIGENCE CONTEXT (${today}) ===`,
    `Restaurant: ${hotelName}`,
  ];

  // ── Health score ─────────────────────────────────────────────────────────
  if (snap) {
    const hs = computeHealthScore(snap as any, last7 as any);
    lines.push(`Health Score: ${hs.score}/100 (Grade ${hs.grade})`);
  }

  lines.push('');

  // ── Recent performance ────────────────────────────────────────────────────
  if (snap) {
    const s = snap as any;
    // Guard all numeric fields — an older document or partial write can leave
    // these as null/undefined, and calling .toFixed() on null throws a 500.
    const revenue        = Number(s.totalRevenue   ?? 0);
    const orders         = Number(s.totalOrders    ?? 0);
    const aov            = Number(s.avgOrderValue  ?? 0);
    const cancelled      = Number(s.cancelledOrders ?? 0);
    const cancPct        = orders > 0
      ? ((cancelled / (orders + cancelled)) * 100).toFixed(1)
      : '0.0';
    const revTrend = s.revenueVs7DayAvgPct != null
      ? ` (${s.revenueVs7DayAvgPct > 0 ? '+' : ''}${Number(s.revenueVs7DayAvgPct).toFixed(1)}% vs 7d avg)`
      : '';
    const ordTrend = s.ordersVs7DayAvgPct != null
      ? ` (${s.ordersVs7DayAvgPct > 0 ? '+' : ''}${Number(s.ordersVs7DayAvgPct).toFixed(1)}% vs 7d avg)`
      : '';

    lines.push(`RECENT PERFORMANCE (${s.date}):`);
    lines.push(`- Revenue: ₹${revenue.toFixed(0)}${revTrend}`);
    lines.push(`- Orders: ${orders}${ordTrend}`);
    lines.push(`- AOV: ₹${aov.toFixed(0)}`);
    lines.push(`- Cancellations: ${cancelled} (${cancPct}%)`);
    lines.push('');
  }

  // ── Active alerts ─────────────────────────────────────────────────────────
  if (isAlertResult(alerts)) {
    const active = alerts.alerts.filter(
      (a) => a.severity === 'critical' || a.severity === 'warning',
    );
    if (active.length > 0) {
      lines.push('ACTIVE ALERTS:');
      active.slice(0, 5).forEach((a) => {
        const badge = a.severity === 'critical' ? '[CRITICAL]' : '[WARNING]';
        lines.push(`- ${badge} ${a.message}`);
      });
      lines.push('');
    }
  }

  // ── Forecast ─────────────────────────────────────────────────────────────
  if (isForecast(forecast)) {
    const f    = forecast;
    const conf = Math.round(f.revenueForecastMeta.confidence * 100);
    const tom  = f.revenueNext7d[0];
    lines.push('REVENUE FORECAST:');
    lines.push(`- Method: ${f.revenueForecastMeta.method.replace(/_/g, ' ')} | Confidence: ${conf}% | Based on ${f.dataPoints} days`);
    if (tom) lines.push(`- Tomorrow: ₹${tom.value.toFixed(0)}`);
    lines.push(`- Next 7 days total: ₹${f.forecastWeekRevenue.toFixed(0)}`);
    lines.push(`- Next 7 days orders: ${Math.round(f.forecastWeekOrders)}`);
    lines.push('');
  }

  // ── Menu recommendations ──────────────────────────────────────────────────
  if (isRecommendationSet(recs)) {
    const r = recs;
    if (r.stars.length > 0) {
      lines.push('MENU STARS (high demand + high margin):');
      r.stars.slice(0, 3).forEach((s) => lines.push(`- ${s.productName}`));
    }
    if (r.upsellTargets.length > 0) {
      const top = r.upsellTargets[0];
      lines.push(`TOP UPSELL OPPORTUNITY: ${top.productName}`);
    }
    lines.push('');
  }

  // ── Inventory ─────────────────────────────────────────────────────────────
  if (isInventory(inventory)) {
    const inv = inventory;
    lines.push('INVENTORY STATUS:');
    lines.push(`- Critical (< 3 days stock): ${inv.coverageSummary.criticalCount} items`);
    lines.push(`- Warning (3–7 days stock): ${inv.coverageSummary.warningCount} items`);
    lines.push(`- Total reorder cost: ₹${inv.totalReorderCost.toFixed(0)}`);
    if (inv.criticalItems.length > 0) {
      const names = inv.criticalItems.slice(0, 3).map((i) => i.name).join(', ');
      lines.push(`- Critical items: ${names}`);
    }
    lines.push('');
  }

  // ── Vendor outstanding ────────────────────────────────────────────────────
  if (vendorOutstanding > 0) {
    lines.push('VENDOR PAYABLES:');
    lines.push(`- Total outstanding: ₹${vendorOutstanding} across ${vendorCount} vendor(s)`);
    lines.push('');
  }

  // ── Yesterday expenses ────────────────────────────────────────────────────
  if (yesterdayExpenses > 0) {
    lines.push(`EXPENSES (${yesterday}): ₹${yesterdayExpenses}`);
    lines.push('');
  }

  lines.push('=== END OF CONTEXT ===');
  lines.push('IMPORTANT: All numbers above are pre-calculated. Do not recalculate or estimate. If asked about something not in this context, use the available chat tools to look up specific data.');
  lines.push('AVAILABLE TOOLS: getRevenue, getTopProducts, getLowStockItems, getVendorBalances, getPaymentBreakdown, getOnlineOrderMetrics, getExpenses, getCancellations');

  const contextStr = lines.join('\n');
  await setCachedContext(hotelId, contextStr);
  return contextStr;
}
