import mongoose from 'mongoose';
import DailySnapshot from '../models/DailySnapshot';
import Hotel from '../models/Hotel';
import { computeHealthScore, HealthScore } from './healthScore';
import { generateNarrative } from '../utils/geminiNarrative';
import { getCachedNarrative, setCachedNarrative, hashNarrativeInput } from '../utils/aiReportCache';
import { logger } from '../utils/logger';

// ─── Return shape ─────────────────────────────────────────────────────────────

export interface DailyReportSnapshot {
  totalRevenue:              number;
  totalOrders:               number;
  avgOrderValue:             number;
  cancelledOrders:           number;
  cancelledRevenue:          number;
  paymentBreakdown:          { cash: number; upi: number; card: number; split: number };
  sourceBreakdown:           { dineIn: number; takeaway: number; qr: number; swiggy: number; zomato: number; other: number };
  topItems:                  Array<{ productName: string; qty: number; revenue: number }>;
  peakHour:                  number;
  peakHourRevenue:           number;
  hourlyRevenue:             number[];
  hourlyOrders:              number[];
  uniqueTables:              number;
  revenueVs7DayAvgPct:       number | null;
  ordersVs7DayAvgPct:        number | null;
  revenueVsSameWeekdayPct:   number | null;
  dataInputHash:             string;
  computedAt:                Date;
}

export interface DailyReportPayload {
  date:            string;
  hotelId:         string;
  snapshot:        DailyReportSnapshot;
  health:          HealthScore;
  narrative:       string | null;
  narrativeSource: 'cache' | 'gemini' | 'unavailable';
  generatedAt:     string;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
// Rule: Gemini receives only pre-computed KPIs.
// It generates narrative/summaries/recommendations — never calculates metrics.

function buildPrompt(
  hotelName: string,
  date:      string,
  snap:      DailyReportSnapshot,
  health:    HealthScore,
): string {
  const totalAttempted = snap.totalOrders + snap.cancelledOrders;
  const cancellationPct = totalAttempted > 0
    ? ((snap.cancelledOrders / totalAttempted) * 100).toFixed(1)
    : '0.0';

  const totalPayment = Object.values(snap.paymentBreakdown).reduce((s, v) => s + v, 0) || 1;
  const pp = {
    cash: ((snap.paymentBreakdown.cash / totalPayment) * 100).toFixed(0),
    upi:  ((snap.paymentBreakdown.upi  / totalPayment) * 100).toFixed(0),
    card: ((snap.paymentBreakdown.card / totalPayment) * 100).toFixed(0),
  };

  const totalSource = Object.values(snap.sourceBreakdown).reduce((s, v) => s + v, 0) || 1;
  const sp = {
    dineIn:   ((snap.sourceBreakdown.dineIn   / totalSource) * 100).toFixed(0),
    takeaway: ((snap.sourceBreakdown.takeaway / totalSource) * 100).toFixed(0),
    qr:       ((snap.sourceBreakdown.qr       / totalSource) * 100).toFixed(0),
    delivery: (((snap.sourceBreakdown.swiggy + snap.sourceBreakdown.zomato) / totalSource) * 100).toFixed(0),
  };

  const top3 = snap.topItems
    .slice(0, 3)
    .map((item, i) => `${i + 1}. ${item.productName} (₹${item.revenue.toFixed(0)})`)
    .join(', ') || 'N/A';

  const revTrend = snap.revenueVs7DayAvgPct != null
    ? `${snap.revenueVs7DayAvgPct > 0 ? '+' : ''}${snap.revenueVs7DayAvgPct.toFixed(1)}% vs 7-day avg`
    : 'trend unavailable (insufficient history)';

  const ordTrend = snap.ordersVs7DayAvgPct != null
    ? `${snap.ordersVs7DayAvgPct > 0 ? '+' : ''}${snap.ordersVs7DayAvgPct.toFixed(1)}% vs 7-day avg`
    : 'trend unavailable (insufficient history)';

  return `You are a concise restaurant business analyst. All metrics below are pre-calculated by our analytics engine.
Do not recalculate, estimate, or invent numbers. Use only what is provided.

Restaurant: ${hotelName}
Date: ${date}
Health Score: ${health.score}/100 (Grade: ${health.grade})

Performance Metrics:
- Revenue: ₹${snap.totalRevenue.toFixed(0)} (${revTrend})
- Orders: ${snap.totalOrders} (${ordTrend})
- Average Order Value: ₹${snap.avgOrderValue.toFixed(0)}
- Cancellation Rate: ${cancellationPct}%
- Peak Hour: ${snap.peakHour}:00–${snap.peakHour + 1}:00 (₹${snap.peakHourRevenue.toFixed(0)})
- Top 3 Items: ${top3}
- Unique Tables Served: ${snap.uniqueTables}

Payment Mix: Cash ${pp.cash}% · UPI ${pp.upi}% · Card ${pp.card}%
Order Sources: Dine-in ${sp.dineIn}% · Takeaway ${sp.takeaway}% · QR/Self-order ${sp.qr}% · Delivery ${sp.delivery}%

Write a concise executive report using exactly these three headings:

## Performance Summary
Two sentences on overall performance and the most notable trend.

## Key Highlights
Two or three bullet points (prefix each with –) on what worked well or stood out today.

## Recommendations
Three specific, actionable bullet points (prefix each with –) that management can act on tomorrow.

Total length: 130–180 words. Professional, direct tone. No filler phrases like "it's worth noting."`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function buildDailyReport(
  hotelId: string,
  date:    string,
): Promise<DailyReportPayload | null> {
  const today    = new Date().toISOString().slice(0, 10);
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  const [snap, hotel, last7] = await Promise.all([
    DailySnapshot.findOne({ hotelId: hotelOId, date }).lean(),
    Hotel.findById(hotelId, { name: 1, hotelName: 1 }).lean(),
    DailySnapshot.find(
      { hotelId: hotelOId, date: { $lt: date } },
      { avgOrderValue: 1 },
    ).sort({ date: -1 }).limit(7).lean(),
  ]);

  if (!snap) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = hotel as any;
  const hotelName: string = h?.name ?? h?.hotelName ?? 'Restaurant';

  const health = computeHealthScore(snap, last7);

  // KPI subset used for cache key — if these numbers change, cache misses and Gemini re-runs
  const narrativeInput = {
    date,
    totalRevenue:         snap.totalRevenue,
    totalOrders:          snap.totalOrders,
    cancelledOrders:      snap.cancelledOrders,
    avgOrderValue:        snap.avgOrderValue,
    revenueVs7DayAvgPct: snap.revenueVs7DayAvgPct,
    ordersVs7DayAvgPct:  snap.ordersVs7DayAvgPct,
    score:               health.score,
    grade:               health.grade,
  };
  const inputHash = hashNarrativeInput(narrativeInput);

  let narrative: string | null              = null;
  let narrativeSource: DailyReportPayload['narrativeSource'] = 'unavailable';

  const cached = await getCachedNarrative(hotelId, date, inputHash);
  if (cached) {
    narrative       = cached;
    narrativeSource = 'cache';
  } else {
    const prompt    = buildPrompt(hotelName, date, snap as unknown as DailyReportSnapshot, health);
    const generated = await generateNarrative(prompt);
    if (generated) {
      narrative       = generated;
      narrativeSource = 'gemini';
      await setCachedNarrative(hotelId, date, inputHash, generated, date === today);
      logger.info('[dailyReport] Gemini narrative cached', { hotelId, date, grade: health.grade });
    }
  }

  return {
    date,
    hotelId,
    snapshot:        snap as unknown as DailyReportSnapshot,
    health,
    narrative,
    narrativeSource,
    generatedAt:     new Date().toISOString(),
  };
}
