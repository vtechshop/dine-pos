// ─── Kitchen Performance Analytics ───────────────────────────────────────────
// All calculations in Node.js. Gemini generates narrative summary only.
// Sources: Order aggregation on createdAt → completedAt timing (last 30 days).

import mongoose from 'mongoose';
import Order from '../models/Order';
import { generateNarrative } from '../utils/geminiNarrative';
import { logger } from '../utils/logger';

// ─── Prompt sanitization ─────────────────────────────────────────────────────
// productName originates from the product catalog — user-created strings.
// Strip characters that could be used to inject instructions into a Gemini prompt.
function sanitize(s: string): string {
  return String(s).replace(/[<>{}\[\]\\|`]/g, '').slice(0, 80).trim();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HourlyKitchenStats {
  hour:                number;
  orderCount:          number;
  avgFulfillmentMin:   number;
  minFulfillmentMin:   number;
  maxFulfillmentMin:   number;
  p90FulfillmentMin:   number;
}

export interface ItemThroughputStats {
  productName: string;
  orderCount:  number;
  share:       number;
}

export interface KitchenAnalyticsReport {
  hotelId:                  string;
  windowDays:               number;
  generatedAt:              string;
  totalOrdersAnalyzed:      number;
  avgFulfillmentMin:        number;
  medianFulfillmentMin:     number;
  p90FulfillmentMin:        number;
  fastestHour:              number | null;
  slowestHour:              number | null;
  peakLoadHour:             number | null;
  hourly:                   HourlyKitchenStats[];
  topItems:                 ItemThroughputStats[];
  slaBreachPct:             number;
  slaDurationMin:           number;
  summary:                  string;
}

// ─── Main analytics builder ───────────────────────────────────────────────────

const SLA_MINUTES = 30; // orders taking longer than this count as SLA breach

export async function buildKitchenAnalytics(hotelId: string): Promise<KitchenAnalyticsReport | null> {
  const hotelOId   = new mongoose.Types.ObjectId(hotelId);
  const windowDays = 30;
  const windowStart = new Date();
  windowStart.setUTCHours(0, 0, 0, 0);
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

  // ── Parallel: fulfillment timing + item throughput ───────────────────────
  const [fulfillmentRows, itemRows] = await Promise.all([

    Order.aggregate([
      {
        $match: {
          hotelId:     hotelOId,
          createdAt:   { $gte: windowStart },
          completedAt: { $ne: null, $exists: true },
          status:      { $in: ['completed', 'served'] },
        },
      },
      {
        $addFields: {
          fulfillmentMin: {
            $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 60000],
          },
          hour: { $hour: '$createdAt' },
        },
      },
      // Sanity filter: 0.5 min ≤ fulfillment ≤ 120 min (exclude outliers / data errors)
      { $match: { fulfillmentMin: { $gte: 0.5, $lte: 120 } } },
      {
        $group: {
          _id:                '$hour',
          orderCount:         { $sum: 1 },
          avgFulfillmentMin:  { $avg: '$fulfillmentMin' },
          minFulfillmentMin:  { $min: '$fulfillmentMin' },
          maxFulfillmentMin:  { $max: '$fulfillmentMin' },
          fulfillmentValues:  { $push: '$fulfillmentMin' },
          slaBreaches:        { $sum: { $cond: [{ $gt: ['$fulfillmentMin', SLA_MINUTES] }, 1, 0] } },
          totalInWindow:      { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // Top items by order frequency (last 30 days, non-cancelled)
    Order.aggregate([
      {
        $match: {
          hotelId:   hotelOId,
          createdAt: { $gte: windowStart },
          status:    { $ne: 'cancelled' },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id:        '$items.productName',
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { orderCount: -1 } },
      { $limit: 10 },
    ]),
  ]);

  if (fulfillmentRows.length === 0) {
    logger.info('[kitchenAnalytics] No fulfillment data', { hotelId });
    return null;
  }

  // ── Compute p90 per hour using sorted fulfillment values ─────────────────
  const hourlyStats: HourlyKitchenStats[] = fulfillmentRows.map((r) => {
    const values = (r.fulfillmentValues as number[]).sort((a, b) => a - b);
    const p90Idx = Math.floor(values.length * 0.9);
    return {
      hour:              r._id as number,
      orderCount:        r.orderCount as number,
      avgFulfillmentMin: +(r.avgFulfillmentMin as number).toFixed(1),
      minFulfillmentMin: +(r.minFulfillmentMin as number).toFixed(1),
      maxFulfillmentMin: +(r.maxFulfillmentMin as number).toFixed(1),
      p90FulfillmentMin: +(values[p90Idx] ?? r.maxFulfillmentMin as number).toFixed(1),
    };
  });

  // ── Overall metrics ──────────────────────────────────────────────────────
  const totalOrders = hourlyStats.reduce((s, h) => s + h.orderCount, 0);
  const weightedAvg = hourlyStats.reduce((s, h) => s + h.avgFulfillmentMin * h.orderCount, 0) / totalOrders;

  // Flat list of all raw fulfillment times (reconstructed from per-hour aggregation)
  // We have per-hour avg/min/max but not the raw array globally. Use p90 as proxy.
  const allP90Values = fulfillmentRows.flatMap((r) =>
    (r.fulfillmentValues as number[]).sort((a, b) => a - b),
  );
  allP90Values.sort((a, b) => a - b);
  const medianIdx  = Math.floor(allP90Values.length * 0.50);
  const p90Idx     = Math.floor(allP90Values.length * 0.90);
  const medianMin  = allP90Values[medianIdx] ?? weightedAvg;
  const p90Min     = allP90Values[p90Idx]    ?? weightedAvg;

  const totalBreaches = fulfillmentRows.reduce((s, r) => s + (r.slaBreaches as number), 0);
  const slaBreachPct  = totalOrders > 0 ? +((totalBreaches / totalOrders) * 100).toFixed(2) : 0;

  // Peak load hour = most orders
  const peakLoadHour = hourlyStats.reduce(
    (max, h) => h.orderCount > max.orderCount ? h : max,
    hourlyStats[0],
  )?.hour ?? null;

  // Fastest and slowest hours (by avg fulfillment, minimum 5 orders to be meaningful)
  const qualifiedHours = hourlyStats.filter((h) => h.orderCount >= 5);
  const fastestHour = qualifiedHours.length > 0
    ? qualifiedHours.reduce((f, h) => h.avgFulfillmentMin < f.avgFulfillmentMin ? h : f).hour
    : null;
  const slowestHour = qualifiedHours.length > 0
    ? qualifiedHours.reduce((s, h) => h.avgFulfillmentMin > s.avgFulfillmentMin ? h : s).hour
    : null;

  // ── Top items ────────────────────────────────────────────────────────────
  const totalItemOrders = itemRows.reduce((s, r) => s + (r.orderCount as number), 0);
  const topItems: ItemThroughputStats[] = itemRows.map((r) => ({
    productName: r._id   as string,
    orderCount:  r.orderCount as number,
    share:       totalItemOrders > 0 ? +((r.orderCount as number / totalItemOrders) * 100).toFixed(2) : 0,
  }));

  // ── Gemini narrative ─────────────────────────────────────────────────────
  const fastHourStr  = fastestHour !== null ? `${fastestHour}:00 UTC` : 'N/A';
  const slowHourStr  = slowestHour !== null ? `${slowestHour}:00 UTC` : 'N/A';
  const peakHourStr  = peakLoadHour !== null ? `${peakLoadHour}:00 UTC` : 'N/A';
  const topItemNames = topItems.slice(0, 5).map((i) => sanitize(i.productName)).join(', ');

  const prompt = `You are a kitchen operations analyst for a restaurant. Summarize the following kitchen performance data (last ${windowDays} days):

- Orders analyzed: ${totalOrders}
- Average fulfillment time: ${weightedAvg.toFixed(1)} min (median: ${medianMin.toFixed(1)} min, p90: ${p90Min.toFixed(1)} min)
- SLA target: ${SLA_MINUTES} min — ${slaBreachPct}% of orders breached the SLA
- Peak load hour: ${peakHourStr}
- Fastest hour: ${fastHourStr}, Slowest hour: ${slowHourStr}
- Top items by order volume: ${topItemNames || 'N/A'}

Write a 60-80 word kitchen performance summary. Highlight throughput bottlenecks, peak pressure windows, and 1 actionable improvement suggestion. Be specific and practical.`;

  const narrative = await generateNarrative(prompt);
  const summary = narrative?.trim()
    ?? `Kitchen processed ${totalOrders} orders with an average fulfillment time of ${weightedAvg.toFixed(1)} minutes. SLA breach rate: ${slaBreachPct}%.`;

  const report: KitchenAnalyticsReport = {
    hotelId,
    windowDays,
    generatedAt:          new Date().toISOString(),
    totalOrdersAnalyzed:  totalOrders,
    avgFulfillmentMin:    +weightedAvg.toFixed(1),
    medianFulfillmentMin: +medianMin.toFixed(1),
    p90FulfillmentMin:    +p90Min.toFixed(1),
    fastestHour,
    slowestHour,
    peakLoadHour,
    hourly:     hourlyStats,
    topItems,
    slaBreachPct,
    slaDurationMin: SLA_MINUTES,
    summary,
  };

  logger.info('[kitchenAnalytics] Report built', {
    hotelId, totalOrders, avgFulfillment: weightedAvg.toFixed(1), slaBreachPct,
  });
  return report;
}
