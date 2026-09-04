// ─── Sales & Demand Forecast Engine ──────────────────────────────────────────
// All forecast values computed in Node.js using statistical methods only.
// Gemini receives ONLY pre-computed summary numbers — never raw series.

import mongoose from 'mongoose';
import DailySnapshot from '../models/DailySnapshot';
import { autoForecast, wma, addDays, ForecastResult } from '../utils/statisticalForecast';
import { generateNarrative } from '../utils/geminiNarrative';
import { getCachedNarrative, setCachedNarrative, hashNarrativeInput } from '../utils/aiReportCache';
import { consumeAiQuota } from '../utils/aiUsageTracker';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DayForecast {
  date:           string;
  value:          number;
  confidenceLow:  number;   // lower bound (MAPE-based 80% interval)
  confidenceHigh: number;   // upper bound
}

export interface HourDistribution {
  hour:           number;         // 0-23
  avgRevShare:    number;         // % of daily revenue expected this hour
  avgOrderShare:  number;         // % of daily orders expected this hour
}

export interface ItemDemandForecast {
  productId:    string;
  productName:  string;
  forecastQty:  number;         // predicted qty next day
  avgQty7d:     number;         // baseline for comparison
  trend:        'rising' | 'falling' | 'stable';
}

export interface SalesForecast {
  generatedAt:    string;
  dataPoints:     number;        // snapshots used

  // Revenue
  revenueNext7d:  DayForecast[];
  revenueNext30d: DayForecast[];
  revenueForecastMeta: Pick<ForecastResult, 'method' | 'confidence' | 'mape'>;

  // Orders
  ordersNext7d:   DayForecast[];
  ordersNext30d:  DayForecast[];
  ordersForecastMeta: Pick<ForecastResult, 'method' | 'confidence' | 'mape'>;

  // Derived from 7-day revenue forecast
  forecastWeekRevenue:   number;
  forecastWeekOrders:    number;
  avgForecastAOV:        number;

  // Peak hours (from last 14 snapshots)
  peakHourDistribution:  HourDistribution[];
  topPeakHours:          number[];    // top 3 hours by revenue share

  // Item demand (top 10 items by recent qty)
  itemDemand:            ItemDemandForecast[];

  // Table utilization
  tableUtilNext7d:       DayForecast[];

  // Accuracy: backtested MAPE vs actual snapshots available
  revenueAccuracy: { mape: number; dataPoints: number; grade: 'good' | 'fair' | 'poor' };

  // Narrative (Gemini — cached)
  narrative:         string | null;
  narrativeSource:   'cache' | 'gemini' | 'unavailable';
}

// ─── Snapshot loader ──────────────────────────────────────────────────────────

interface SnapshotRow {
  date:         string;
  totalRevenue: number;
  totalOrders:  number;
  avgOrderValue: number;
  uniqueTables: number;
  hourlyRevenue: number[];
  hourlyOrders:  number[];
  allItems:      Array<{ productId: mongoose.Types.ObjectId; productName: string; qty: number; revenue: number }>;
}

async function loadSnapshots(hotelId: string, limit: number): Promise<SnapshotRow[]> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  // allItems is only consumed by buildItemDemandForecast which uses the last 21
  // snapshots. Loading it for all 90 transfers thousands of sub-documents that
  // are immediately discarded — split into two targeted queries instead.
  const ITEM_DEMAND_WINDOW = 21;
  const itemsLimit = Math.min(limit, ITEM_DEMAND_WINDOW);

  const [withoutItems, withItems] = await Promise.all([
    DailySnapshot.find(
      { hotelId: hotelOId },
      { date: 1, totalRevenue: 1, totalOrders: 1, avgOrderValue: 1,
        uniqueTables: 1, hourlyRevenue: 1, hourlyOrders: 1 },
    ).sort({ date: -1 }).limit(limit).lean(),

    DailySnapshot.find(
      { hotelId: hotelOId },
      { date: 1, allItems: 1 },
    ).sort({ date: -1 }).limit(itemsLimit).lean(),
  ]);

  // Merge: index withItems by date for O(1) lookup
  const itemMap = new Map<string, unknown[]>();
  for (const s of withItems) {
    itemMap.set((s as any).date, (s as any).allItems ?? []);
  }

  const merged = withoutItems.map((s) => ({
    ...s,
    allItems: itemMap.get((s as any).date) ?? [],
  }));

  // Return in ascending order (oldest first) for time-series algorithms
  return merged.reverse() as unknown as SnapshotRow[];
}

// ─── Peak hour distribution ───────────────────────────────────────────────────

function buildPeakHourDistribution(snapshots: SnapshotRow[]): HourDistribution[] {
  const revTotals   = Array(24).fill(0);
  const orderTotals = Array(24).fill(0);
  const dayRevTotals = Array(24).fill(0);
  const dayOrdTotals = Array(24).fill(0);

  for (const s of snapshots) {
    const dayRevSum = s.hourlyRevenue.reduce((a, b) => a + b, 0) || 1;
    const dayOrdSum = s.hourlyOrders.reduce((a, b) => a + b, 0) || 1;
    for (let h = 0; h < 24; h++) {
      revTotals[h]   += (s.hourlyRevenue[h] ?? 0) / dayRevSum;
      orderTotals[h] += (s.hourlyOrders[h] ?? 0) / dayOrdSum;
      dayRevTotals[h]++;
      dayOrdTotals[h]++;
    }
  }

  return Array.from({ length: 24 }, (_, h) => ({
    hour:          h,
    avgRevShare:   +((revTotals[h] / (dayRevTotals[h] || 1)) * 100).toFixed(1),
    avgOrderShare: +((orderTotals[h] / (dayOrdTotals[h] || 1)) * 100).toFixed(1),
  }));
}

// ─── Item demand forecast ─────────────────────────────────────────────────────

function buildItemDemandForecast(snapshots: SnapshotRow[]): ItemDemandForecast[] {
  if (snapshots.length === 0) return [];

  // Aggregate items: productId → { name, daily qty series }
  const itemMap = new Map<string, { name: string; qtySeries: number[] }>();

  for (const s of snapshots) {
    const seen = new Set<string>();
    for (const item of s.allItems) {
      const id = item.productId.toString();
      seen.add(id);
      if (!itemMap.has(id)) {
        itemMap.set(id, { name: item.productName, qtySeries: [] });
      }
      itemMap.get(id)!.qtySeries.push(item.qty);
    }
    // For items that didn't appear in this snapshot, record a 0
    for (const [id, data] of itemMap) {
      if (!seen.has(id)) data.qtySeries.push(0);
    }
  }

  // Rank by average qty over last 14 snapshots, take top 15
  const ranked = [...itemMap.entries()]
    .map(([id, { name, qtySeries }]) => {
      const recent = qtySeries.slice(-14);
      const avgQty = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
      return { id, name, qtySeries, avgQty };
    })
    .filter((i) => i.avgQty > 0)
    .sort((a, b) => b.avgQty - a.avgQty)
    .slice(0, 15);

  return ranked.map(({ id, name, qtySeries, avgQty }) => {
    const forecastQty = +wma(qtySeries, Math.min(7, qtySeries.length)).toFixed(1);
    const recentAvg   = qtySeries.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const olderAvg    = qtySeries.slice(-7, -3).reduce((a, b) => a + b, 0) / 4 || recentAvg;

    const trendPct = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
    const trend: ItemDemandForecast['trend'] =
      trendPct >  0.08 ? 'rising' :
      trendPct < -0.08 ? 'falling' :
      'stable';

    return {
      productId:   id,
      productName: name,
      forecastQty,
      avgQty7d:    +avgQty.toFixed(1),
      trend,
    };
  });
}

// ─── Gemini narrative prompt ──────────────────────────────────────────────────
// All numbers are pre-computed. Gemini only writes the summary.

function buildForecastNarrativePrompt(fc: Omit<SalesForecast, 'narrative' | 'narrativeSource'>): string {
  const weekRev   = fc.forecastWeekRevenue.toFixed(0);
  const weekOrd   = fc.forecastWeekOrders.toFixed(0);
  const aov       = fc.avgForecastAOV.toFixed(0);
  const conf      = Math.round(fc.revenueForecastMeta.confidence * 100);
  const method    = fc.revenueForecastMeta.method.replace('_', ' ');
  const peakHours = fc.topPeakHours.map((h) => `${h}:00`).join(', ');
  const topItems  = fc.itemDemand
    .slice(0, 5)
    .map((i) => `${i.productName} (~${i.forecastQty} units, ${i.trend})`)
    .join('; ');

  const tomorrow  = fc.revenueNext7d[0];
  const day2      = fc.revenueNext7d[1];
  const mape      = fc.revenueForecastMeta.mape.toFixed(1);

  return `You are a restaurant business analyst. All numbers below are pre-computed statistical forecasts. Do not recalculate any values.

Forecast Method: ${method}
Forecast Confidence: ${conf}% (MAPE: ${mape}%)
Data Points Used: ${fc.dataPoints} days of history

Revenue Forecast:
- Tomorrow: ₹${tomorrow?.value.toFixed(0) ?? 'N/A'}
- Day after: ₹${day2?.value.toFixed(0) ?? 'N/A'}
- Next 7 days total: ₹${weekRev}
- Next 30 days avg/day: ₹${(fc.revenueNext30d.reduce((s, d) => s + d.value, 0) / 30).toFixed(0)}

Orders Forecast:
- Next 7 days total: ${weekOrd} orders
- Forecast AOV: ₹${aov}

Peak Hours Today (historical average): ${peakHours}

Top Item Demand (next day forecast):
${topItems}

Write a structured forecast briefing with exactly three sections:

## Executive Summary
Two sentences on the overall revenue and demand outlook for the next 7 days.

## Risks
Two bullet points (use –) on forecast risks — low confidence, trend reversal, or concentration risk.

## Opportunities
Two bullet points (use –) on concrete opportunities — peak hour prep, upsell timing, inventory stocking.

Total: 100–130 words. Professional, data-driven tone.`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function buildForecast(hotelId: string): Promise<SalesForecast | null> {
  const today    = new Date().toISOString().slice(0, 10);
  const snapshots = await loadSnapshots(hotelId, 90);

  if (snapshots.length < 3) return null;  // too little history to forecast

  // ── Time series extraction ────────────────────────────────────────────────
  const revenueSeries       = snapshots.map((s) => s.totalRevenue);
  const ordersSeries        = snapshots.map((s) => s.totalOrders);
  const tablesSeries        = snapshots.map((s) => s.uniqueTables);
  const lastDate            = snapshots[snapshots.length - 1].date;

  // ── Revenue forecast (7 + 30 days) ───────────────────────────────────────
  const revFC7  = autoForecast(revenueSeries, 7);
  const revFC30 = autoForecast(revenueSeries, 30);

  // Confidence interval: use MAPE as ±uncertainty. 80% prediction interval ≈ ±1.28σ.
  // We model σ ≈ value * (MAPE/100) giving asymmetric but practical bounds.
  function withCI(value: number, mape: number): Omit<DayForecast, 'date'> {
    const err = value * (mape / 100);
    return {
      value,
      confidenceLow:  +Math.max(0, value - err).toFixed(2),
      confidenceHigh: +(value + err).toFixed(2),
    };
  }

  const revenueNext7d  = revFC7.values.map((v, i) => ({ date: addDays(lastDate, i + 1), ...withCI(v, revFC7.mape) }));
  const revenueNext30d = revFC30.values.map((v, i) => ({ date: addDays(lastDate, i + 1), ...withCI(v, revFC30.mape) }));

  // ── Orders forecast (7 + 30 days) ────────────────────────────────────────
  const ordFC7  = autoForecast(ordersSeries, 7);
  const ordFC30 = autoForecast(ordersSeries, 30);

  const ordersNext7d  = ordFC7.values.map((v, i) => ({ date: addDays(lastDate, i + 1), ...withCI(v, ordFC7.mape) }));
  const ordersNext30d = ordFC30.values.map((v, i) => ({ date: addDays(lastDate, i + 1), ...withCI(v, ordFC30.mape) }));

  // ── Derived aggregates ────────────────────────────────────────────────────
  const forecastWeekRevenue = revenueNext7d.reduce((s, d) => s + d.value, 0);
  const forecastWeekOrders  = ordersNext7d.reduce((s, d) => s + d.value, 0);
  const avgForecastAOV      = forecastWeekOrders > 0
    ? +(forecastWeekRevenue / forecastWeekOrders).toFixed(2)
    : 0;

  // ── Table utilization (7-day forecast) ───────────────────────────────────
  const tablesFC7     = autoForecast(tablesSeries, 7);
  const tableUtilNext7d = tablesFC7.values.map((v, i) => ({
    date:            addDays(lastDate, i + 1),
    value:           Math.round(v),
    confidenceLow:   Math.max(0, Math.round(v - v * (tablesFC7.mape / 100))),
    confidenceHigh:  Math.round(v + v * (tablesFC7.mape / 100)),
  }));

  // Accuracy grade from backtested MAPE
  const revMape = revFC7.mape;
  const accuracyGrade: 'good' | 'fair' | 'poor' =
    revMape < 10 ? 'good' : revMape < 25 ? 'fair' : 'poor';
  const revenueAccuracy = { mape: revMape, dataPoints: snapshots.length, grade: accuracyGrade };

  // ── Peak hour distribution (last 14 snapshots) ────────────────────────────
  const recent14             = snapshots.slice(-14);
  const peakHourDistribution = buildPeakHourDistribution(recent14);
  const topPeakHours         = [...peakHourDistribution]
    .sort((a, b) => b.avgRevShare - a.avgRevShare)
    .slice(0, 3)
    .map((h) => h.hour)
    .sort((a, b) => a - b);

  // ── Item demand forecast (top 15 items) ──────────────────────────────────
  const itemDemand = buildItemDemandForecast(snapshots.slice(-21)); // 3 weeks

  // ── Gemini narrative (cached) ─────────────────────────────────────────────
  const forecastSummary = {
    date:        today,
    dataPoints:  snapshots.length,
    weekRevenue: forecastWeekRevenue,
    conf:        revFC7.confidence,
    topItem:     itemDemand[0]?.productName,
    topPeakHour: topPeakHours[0],
  };
  const inputHash = hashNarrativeInput(forecastSummary);

  let narrative: string | null              = null;
  let narrativeSource: SalesForecast['narrativeSource'] = 'unavailable';

  const cacheKey = `forecast:${today}`;
  const cached   = await getCachedNarrative(hotelId, cacheKey, inputHash);
  if (cached) {
    narrative       = cached;
    narrativeSource = 'cache';
  } else {
    const partialFc: Omit<SalesForecast, 'narrative' | 'narrativeSource'> = {
      generatedAt: new Date().toISOString(),
      dataPoints:  snapshots.length,
      revenueNext7d,
      revenueNext30d,
      revenueForecastMeta: { method: revFC7.method, confidence: revFC7.confidence, mape: revFC7.mape },
      ordersNext7d,
      ordersNext30d,
      ordersForecastMeta: { method: ordFC7.method, confidence: ordFC7.confidence, mape: ordFC7.mape },
      forecastWeekRevenue: +forecastWeekRevenue.toFixed(2),
      forecastWeekOrders:  +forecastWeekOrders.toFixed(2),
      avgForecastAOV,
      peakHourDistribution,
      topPeakHours,
      itemDemand,
      tableUtilNext7d,
      revenueAccuracy,
    };
    await consumeAiQuota(hotelId, 'report');
    const prompt    = buildForecastNarrativePrompt(partialFc);
    const generated = await generateNarrative(prompt);
    if (generated) {
      narrative       = generated;
      narrativeSource = 'gemini';
      // 6h cache for today's forecast narrative (matches forecastCache TTL)
      await setCachedNarrative(hotelId, cacheKey, inputHash, generated, true);
    }
  }

  return {
    generatedAt:   new Date().toISOString(),
    dataPoints:    snapshots.length,
    revenueNext7d,
    revenueNext30d,
    revenueForecastMeta: {
      method:     revFC7.method,
      confidence: revFC7.confidence,
      mape:       revFC7.mape,
    },
    ordersNext7d,
    ordersNext30d,
    ordersForecastMeta: {
      method:     ordFC7.method,
      confidence: ordFC7.confidence,
      mape:       ordFC7.mape,
    },
    forecastWeekRevenue: +forecastWeekRevenue.toFixed(2),
    forecastWeekOrders:  +forecastWeekOrders.toFixed(2),
    avgForecastAOV,
    peakHourDistribution,
    topPeakHours,
    itemDemand,
    tableUtilNext7d,
    revenueAccuracy,
    narrative,
    narrativeSource,
  };
}
