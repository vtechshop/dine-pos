// ─── Morning Brief Builder ────────────────────────────────────────────────────
// Assembles a pre-generated daily business briefing from existing service outputs.
// Runs once per day per hotel via the scheduler (not on-demand).
// All KPIs computed in Node.js. Gemini receives only pre-computed summaries
// and generates: executive summary, 3 recommendations, 1 opportunity, 1 warning.

import crypto from 'crypto';
import mongoose from 'mongoose';
import DailySnapshot from '../models/DailySnapshot';
import MorningBrief from '../models/MorningBrief';
import { computeHealthScore } from './healthScore';
import { buildForecast } from './forecastEngine';
import { buildInventoryPrediction } from './inventoryPredictor';
import { buildRecommendations } from './recommendationEngine';
import { getCachedForecast, getCachedInventory } from '../utils/forecastCache';
import { generateNarrative } from '../utils/geminiNarrative';
import { logger } from '../utils/logger';

// ─── Typed interfaces for cached objects ─────────────────────────────────────

interface CachedForecast {
  forecastWeekRevenue?: number;
  forecastWeekOrders?:  number;
  avgForecastAOV?:      number;
  topPeakHours?:        number[];
  revenueForecastMeta?: { confidence: number; method: string };
  revenueNext7d?:       Array<{ date: string; value: number }>;
}

interface CachedInventory {
  criticalItems?:  Array<{ name: string }>;
  warningItems?:   Array<{ name: string }>;
  overstockItems?: Array<{ name: string }>;
  topReorderItems?: Array<{ name: string }>;
  totalReorderCost?: number;
  coverageSummary?: { criticalCount: number; warningCount: number };
}

function isForecast(v: unknown): v is CachedForecast {
  return typeof v === 'object' && v !== null && 'forecastWeekRevenue' in v;
}

function isInventory(v: unknown): v is CachedInventory {
  return typeof v === 'object' && v !== null && 'coverageSummary' in v;
}

// ─── Profit estimation ────────────────────────────────────────────────────────
// No BOM (Bill-of-Materials) link between menu items and ingredients exists in
// the current data model. We use a conservative 20% net margin heuristic,
// typical for mid-range Indian F&B operations, until actual cost tracking is added.
const ESTIMATED_NET_MARGIN = 0.20;

// ─── Payment method label ─────────────────────────────────────────────────────
function topPayment(breakdown: { cash: number; upi: number; card: number; split: number }): string {
  const entries = Object.entries(breakdown) as [string, number][];
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'cash';
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildMorningBrief(
  hotelId: string,
  date:    string,  // YYYY-MM-DD — the date to summarize (yesterday)
): Promise<boolean> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  // ── Load yesterday's DailySnapshot ──────────────────────────────────────
  const snap = await DailySnapshot.findOne(
    { hotelId: hotelOId, date },
    {
      totalRevenue: 1, totalOrders: 1, avgOrderValue: 1,
      cancelledOrders: 1, cancelledRevenue: 1,
      paymentBreakdown: 1, sourceBreakdown: 1,
      topItems: 1, allItems: 1,
      peakHour: 1, peakHourRevenue: 1,
      revenueVs7DayAvgPct: 1, ordersVs7DayAvgPct: 1, revenueVsSameWeekdayPct: 1,
      dataInputHash: 1,
    },
  ).lean();

  if (!snap) {
    logger.warn('[morningBrief] No snapshot for date', { hotelId, date });
    return false;
  }

  // ── Idempotency: skip if brief already exists with same input hash ────────
  const briefHash = crypto
    .createHash('sha256')
    .update(`${hotelId}:${date}:${snap.dataInputHash}`)
    .digest('hex');

  const existing = await MorningBrief.findOne({ hotelId: hotelOId, date, dataInputHash: briefHash });
  if (existing) {
    logger.info('[morningBrief] Already up-to-date, skipping', { hotelId, date });
    return true;
  }

  // ── Load last 7 snapshots for health score AOV stability ─────────────────
  const last7 = await DailySnapshot.find(
    { hotelId: hotelOId, date: { $lt: date } },
    { avgOrderValue: 1 },
  ).sort({ date: -1 }).limit(7).lean();

  const health = computeHealthScore(snap as any, last7);

  // ── Parallel: forecast + inventory + recommendations (from cache or compute) ─
  const [rawForecast, rawInventory, recs] = await Promise.allSettled([
    (async () => {
      const cached = await getCachedForecast(hotelId);
      if (isForecast(cached)) return cached;
      return buildForecast(hotelId);
    })(),
    (async () => {
      const cached = await getCachedInventory(hotelId);
      if (isInventory(cached)) return cached;
      return buildInventoryPrediction(hotelId);
    })(),
    buildRecommendations(hotelId, date),
  ]);

  const forecast  = rawForecast.status  === 'fulfilled' ? rawForecast.value  : null;
  const inventory = rawInventory.status === 'fulfilled' ? rawInventory.value : null;
  const recSet    = recs.status         === 'fulfilled' ? recs.value         : null;

  // ── Business summary ──────────────────────────────────────────────────────
  const revenue            = snap.totalRevenue;
  const orders             = snap.totalOrders;
  const cancelledOrders    = snap.cancelledOrders;
  const totalAttempted     = orders + cancelledOrders;
  const cancelRate         = totalAttempted > 0 ? +(cancelledOrders / totalAttempted).toFixed(4) : 0;
  const estimatedProfit    = +(revenue * ESTIMATED_NET_MARGIN).toFixed(2);
  const profitMarginPct    = ESTIMATED_NET_MARGIN * 100;
  const avgBill            = orders > 0 ? +snap.avgOrderValue.toFixed(2) : 0;
  const pb                 = snap.paymentBreakdown as { cash: number; upi: number; card: number; split: number };
  const topPaymentMethod   = topPayment(pb);
  const topItem            = (snap.topItems as Array<{ productName: string; qty: number; revenue: number }>)[0] ?? null;

  // ── Menu summary from recommendations ────────────────────────────────────
  const topMenuItems = ((snap.topItems ?? []) as Array<{ productName: string; qty: number; revenue: number }>)
    .slice(0, 5)
    .map((i) => ({ name: i.productName, revenue: i.revenue, qty: i.qty }));

  const slowMovers = (recSet?.slowMovers ?? [])
    .slice(0, 3)
    .map((s) => s.productName);

  // ── Inventory summary ─────────────────────────────────────────────────────
  const inv = isInventory(inventory) ? inventory : null;
  const criticalNames  = (inv?.criticalItems  ?? []).slice(0, 5).map((i) => i.name);
  const warningNames   = (inv?.warningItems   ?? []).slice(0, 5).map((i) => i.name);
  const overstockNames = (inv?.overstockItems ?? []).slice(0, 5).map((i) => i.name);
  const reorderNames   = (inv?.topReorderItems ?? []).slice(0, 5).map((i) => i.name);

  // ── Forecast summary ──────────────────────────────────────────────────────
  const fc = isForecast(forecast) ? forecast : null;
  const expectedRevenue = fc?.revenueNext7d?.[0]?.value
    ?? fc?.forecastWeekRevenue != null ? (fc!.forecastWeekRevenue! / 7) : revenue;
  const expectedOrders  = fc?.forecastWeekOrders != null
    ? Math.round(fc.forecastWeekOrders / 7) : orders;
  const expectedAov     = fc?.avgForecastAOV ?? avgBill;
  const topBusyHours    = fc?.topPeakHours ?? [snap.peakHour];
  const forecastConf    = fc?.revenueForecastMeta?.confidence ?? 0;
  const forecastMethod  = fc?.revenueForecastMeta?.method ?? 'unavailable';

  // ── Gemini: executive summary + recommendations + opportunity + warning ───
  const topItemStr     = topItem ? `${topItem.productName} (₹${topItem.revenue.toFixed(0)}, ${topItem.qty} sold)` : 'N/A';
  const critStr        = criticalNames.length ? criticalNames.join(', ') : 'None';
  const warnStr        = warningNames.length  ? warningNames.join(', ')  : 'None';
  const slowStr        = slowMovers.length    ? slowMovers.join(', ')    : 'None';
  const forecastRevStr = `₹${(typeof expectedRevenue === 'number' ? expectedRevenue : 0).toFixed(0)}`;

  const prompt = `You are a business intelligence analyst for a restaurant/hotel POS system.

Generate a concise morning briefing for the restaurant manager based on yesterday's data (${date}):

BUSINESS SUMMARY:
- Revenue: ₹${revenue.toFixed(0)} | Orders: ${orders} | Avg Bill: ₹${avgBill.toFixed(0)}
- Estimated Net Profit: ₹${estimatedProfit.toFixed(0)} (${profitMarginPct.toFixed(0)}% margin heuristic)
- Health Score: ${health.score}/100 (${health.grade})
- Cancellation Rate: ${(cancelRate * 100).toFixed(1)}% (${cancelledOrders} cancelled)
- Top Seller: ${topItemStr}
- Peak Hour: ${snap.peakHour}:00 | Top Payment: ${topPaymentMethod}
- Revenue vs 7-day avg: ${snap.revenueVs7DayAvgPct != null ? `${snap.revenueVs7DayAvgPct > 0 ? '+' : ''}${snap.revenueVs7DayAvgPct.toFixed(1)}%` : 'N/A'}

INVENTORY ALERTS:
- Critical (reorder now): ${critStr}
- Low stock (monitor): ${warnStr}
- Slow-moving menu items: ${slowStr}

TODAY'S FORECAST:
- Expected Revenue: ${forecastRevStr} | Expected Orders: ${expectedOrders}
- Busy Hours: ${topBusyHours.slice(0, 3).join(', ')}:00 UTC

Respond in this EXACT format (no markdown headers, no extra lines):
SUMMARY: [2-sentence executive summary of yesterday's performance]
REC1: [Specific actionable recommendation #1 based on data]
REC2: [Specific actionable recommendation #2 based on data]
REC3: [Specific actionable recommendation #3 based on data]
OPPORTUNITY: [One business opportunity spotted in the data]
WARNING: [One warning or risk from the data, or "None" if all clear]`;

  const raw = await generateNarrative(prompt);

  // Parse Gemini structured response
  let executiveSummary = `${date} brief: Revenue ₹${revenue.toFixed(0)}, ${orders} orders. Health score ${health.score}/100 (${health.grade}).`;
  let recommendations: string[] = [
    'Review top-selling items and ensure adequate stock.',
    'Monitor cancellation patterns for service improvement opportunities.',
    'Check inventory alerts and place reorders where needed.',
  ];
  let opportunity = 'Review peak-hour staffing to maximize revenue during busy periods.';
  let warning: string | null = criticalNames.length > 0
    ? `Critical stock alert: ${criticalNames[0]} needs immediate reorder.`
    : null;

  if (raw) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('SUMMARY:'))      executiveSummary = line.replace('SUMMARY:', '').trim();
      else if (line.startsWith('REC1:'))    recommendations[0] = line.replace('REC1:', '').trim();
      else if (line.startsWith('REC2:'))    recommendations[1] = line.replace('REC2:', '').trim();
      else if (line.startsWith('REC3:'))    recommendations[2] = line.replace('REC3:', '').trim();
      else if (line.startsWith('OPPORTUNITY:')) opportunity = line.replace('OPPORTUNITY:', '').trim();
      else if (line.startsWith('WARNING:')) {
        const w = line.replace('WARNING:', '').trim();
        warning = (w.toLowerCase() === 'none' || !w) ? null : w;
      }
    }
  }

  // ── Persist (upsert) ──────────────────────────────────────────────────────
  await MorningBrief.findOneAndUpdate(
    { hotelId: hotelOId, date },
    {
      $set: {
        generatedAt:   new Date(),
        dataInputHash: briefHash,
        business: {
          revenue,
          orders,
          estimatedProfit,
          estimatedProfitMarginPct: profitMarginPct,
          avgBill,
          healthScore:           health.score,
          healthGrade:           health.grade,
          topSellingItem:        topItem?.productName ?? null,
          topSellingItemRevenue: topItem?.revenue ?? 0,
          topSellingItemQty:     topItem?.qty ?? 0,
          peakHour:              snap.peakHour,
          topPaymentMethod,
          revenueVs7DayAvgPct:  snap.revenueVs7DayAvgPct,
          ordersVs7DayAvgPct:   snap.ordersVs7DayAvgPct,
          cancelledOrders,
          cancelRate,
        },
        menu: { topMenuItems, slowMovers },
        inventory: {
          criticalItems:        criticalNames,
          warningItems:         warningNames,
          overstockItems:       overstockNames,
          reorderRequiredNames: reorderNames,
          totalReorderCost:     inv?.totalReorderCost ?? 0,
          criticalCount:        inv?.coverageSummary?.criticalCount ?? criticalNames.length,
          warningCount:         inv?.coverageSummary?.warningCount  ?? warningNames.length,
        },
        forecast: {
          expectedRevenue: typeof expectedRevenue === 'number' ? +expectedRevenue.toFixed(2) : 0,
          expectedOrders,
          expectedAov:     +expectedAov.toFixed(2),
          topBusyHours,
          forecastConfidence: forecastConf,
          method:             forecastMethod,
        },
        executiveSummary,
        recommendations: recommendations.filter(Boolean),
        opportunity,
        warning,
        notifications: { emailQueued: false, whatsappQueued: false, pushQueued: false, sentAt: null },
      },
    },
    { upsert: true, new: true },
  );

  logger.info('[morningBrief] Brief built', { hotelId, date, healthScore: health.score });
  return true;
}
