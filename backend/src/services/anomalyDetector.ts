// ─── Fraud & Anomaly Detection ────────────────────────────────────────────────
// All calculations performed in Node.js. Gemini only explains detected anomalies.
// Never accuses users of fraud — always says "Anomaly detected" with evidence.
// Reuses DailySnapshot baselines; never duplicates snapshot/forecast computations.

import mongoose from 'mongoose';
import DailySnapshot from '../models/DailySnapshot';
import Order from '../models/Order';
import { generateNarrative } from '../utils/geminiNarrative';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnomalySeverity = 'low' | 'medium' | 'high';

export interface AnomalyResult {
  type:      string;
  label:     string;
  severity:  AnomalySeverity;
  confidence: number;
  evidence:  string;
  metric:    Record<string, number | string>;
}

export interface AnomalyReport {
  hotelId:        string;
  analysisDate:   string;
  dataWindowDays: number;
  anomalies:      AnomalyResult[];
  allClear:       boolean;
  summary:        string;
  generatedAt:    string;
}

// ─── Statistical helpers ─────────────────────────────────────────────────────

function stats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function zScore(value: number, mean: number, std: number): number {
  return std < 0.001 ? 0 : (value - mean) / std;
}

function confidenceFromZ(z: number): number {
  return Math.min(0.95, Math.max(0.05, (z - 1.0) / 3.0));
}

function severityFromConfidence(c: number): AnomalySeverity {
  if (c >= 0.65) return 'high';
  if (c >= 0.35) return 'medium';
  return 'low';
}

// Threshold: z > 1.5 triggers an anomaly
function isAnomaly(z: number): boolean {
  return z > 1.5;
}

// ─── Main detector ────────────────────────────────────────────────────────────

export async function buildAnomalyReport(hotelId: string): Promise<AnomalyReport | null> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString().slice(0, 10);

  // ── Parallel data fetch ──────────────────────────────────────────────────
  const [snapshots, todayAggResult, todayHourlyResult] = await Promise.all([

    // 30-day DailySnapshot baseline (excluding today — may not be finalized)
    DailySnapshot.find(
      { hotelId: hotelOId, date: { $lt: todayStr } },
      {
        date: 1, totalOrders: 1, cancelledOrders: 1, totalRevenue: 1,
        paymentBreakdown: 1, hourlyOrders: 1,
      },
    ).sort({ date: -1 }).limit(30).lean(),

    // Today's order summary: payment mix, discount, round-amount
    Order.aggregate([
      { $match: { hotelId: hotelOId, createdAt: { $gte: todayStart } } },
      {
        $group: {
          _id: null,
          totalOrders:      { $sum: 1 },
          cancelledOrders:  { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          totalRevenue:     { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$grandTotal', 0] } },
          totalDiscount:    { $sum: '$discountAmount' },
          cashOrders:       { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq: ['$paymentMethod', 'cash'] }] }, 1, 0] } },
          upiOrders:        { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq: ['$paymentMethod', 'upi'] }] }, 1, 0] } },
          cardOrders:       { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq: ['$paymentMethod', 'card'] }] }, 1, 0] } },
          roundAmountOrders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', 'cancelled'] },
                    { $gt: ['$grandTotal', 0] },
                    { $eq: [{ $mod: ['$grandTotal', 50] }, 0] },
                  ],
                },
                1, 0,
              ],
            },
          },
        },
      },
    ]),

    // Today's order count by hour (all + cancelled — for off-hours and clustering)
    Order.aggregate([
      { $match: { hotelId: hotelOId, createdAt: { $gte: todayStart } } },
      {
        $group: {
          _id: {
            hour:   { $hour: '$createdAt' },
            status: '$status',
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  if (snapshots.length < 7) {
    logger.info('[anomalyDetector] Insufficient history', { hotelId, days: snapshots.length });
    return null;
  }

  const today = todayAggResult[0] ?? {
    totalOrders: 0, cancelledOrders: 0, totalRevenue: 0, totalDiscount: 0,
    cashOrders: 0, upiOrders: 0, cardOrders: 0, roundAmountOrders: 0,
  };

  // Build hourly maps from today's hourly aggregation
  const hourlyTotal: number[]    = Array(24).fill(0);
  const hourlyCancelled: number[] = Array(24).fill(0);
  for (const r of todayHourlyResult) {
    const h = r._id.hour as number;
    hourlyTotal[h] += r.count as number;
    if ((r._id.status as string) === 'cancelled') {
      hourlyCancelled[h] += r.count as number;
    }
  }

  const anomalies: AnomalyResult[] = [];

  // ── 1. Cancellation rate spike ────────────────────────────────────────────
  const baselineCancelRates = snapshots
    .filter((s) => s.totalOrders > 0)
    .map((s) => s.cancelledOrders / s.totalOrders);
  if (baselineCancelRates.length >= 7 && today.totalOrders > 5) {
    const { mean, std } = stats(baselineCancelRates);
    const todayRate = today.cancelledOrders / today.totalOrders;
    const z = zScore(todayRate, mean, std);
    if (isAnomaly(z)) {
      const confidence = confidenceFromZ(z);
      anomalies.push({
        type:      'cancellation_spike',
        label:     'Cancellation Rate Spike',
        severity:  severityFromConfidence(confidence),
        confidence: +confidence.toFixed(2),
        evidence:  `Today's cancellation rate is ${(todayRate * 100).toFixed(1)}% vs ${(mean * 100).toFixed(1)}% ${snapshots.length}-day average (${today.cancelledOrders} of ${today.totalOrders} orders cancelled).`,
        metric: {
          todayRate:    +todayRate.toFixed(3),
          baselineMean: +mean.toFixed(3),
          baselineStd:  +std.toFixed(3),
          zScore:       +z.toFixed(2),
          cancelledOrders: today.cancelledOrders,
          totalOrders:     today.totalOrders,
        },
      });
    }
  }

  // ── 2. Payment method shift ───────────────────────────────────────────────
  const completedToday = today.totalOrders - today.cancelledOrders;
  if (completedToday >= 10) {
    const todayCashPct = today.cashOrders / completedToday;
    const todayUpiPct  = today.upiOrders  / completedToday;
    const todayCardPct = today.cardOrders / completedToday;

    const baselineCashPcts = snapshots
      .filter((s) => (s.totalOrders - s.cancelledOrders) > 0)
      .map((s) => {
        const completed = s.totalOrders - s.cancelledOrders;
        const pb = s.paymentBreakdown as { cash?: number; upi?: number; card?: number; split?: number };
        const total = (pb.cash ?? 0) + (pb.upi ?? 0) + (pb.card ?? 0) + (pb.split ?? 0);
        return total > 0 ? (pb.cash ?? 0) / total : 0;
      });
    const baselineUpiPcts  = snapshots
      .filter((s) => (s.totalOrders - s.cancelledOrders) > 0)
      .map((s) => {
        const pb = s.paymentBreakdown as { cash?: number; upi?: number; card?: number; split?: number };
        const total = (pb.cash ?? 0) + (pb.upi ?? 0) + (pb.card ?? 0) + (pb.split ?? 0);
        return total > 0 ? (pb.upi ?? 0) / total : 0;
      });

    const cashStats = stats(baselineCashPcts);
    const upiStats  = stats(baselineUpiPcts);
    const cashZ = zScore(todayCashPct, cashStats.mean, cashStats.std);
    const upiZ  = zScore(todayUpiPct,  upiStats.mean,  upiStats.std);
    // Flag whichever method has the biggest deviation (positive or negative)
    const absMaxZ = Math.max(Math.abs(cashZ), Math.abs(upiZ));
    if (absMaxZ > 1.5) {
      const dominantShift =
        Math.abs(cashZ) >= Math.abs(upiZ)
          ? { method: 'cash', todayPct: todayCashPct, baselinePct: cashStats.mean, z: cashZ }
          : { method: 'upi',  todayPct: todayUpiPct,  baselinePct: upiStats.mean,  z: upiZ };
      const confidence = confidenceFromZ(Math.abs(dominantShift.z));
      anomalies.push({
        type:      'payment_shift',
        label:     'Payment Method Shift',
        severity:  severityFromConfidence(confidence),
        confidence: +confidence.toFixed(2),
        evidence:  `${dominantShift.method.toUpperCase()} orders are ${(dominantShift.todayPct * 100).toFixed(1)}% of today's transactions vs ${(dominantShift.baselinePct * 100).toFixed(1)}% ${snapshots.length}-day average. Direction: ${dominantShift.z > 0 ? 'higher' : 'lower'} than usual.`,
        metric: {
          method:      dominantShift.method,
          todayPct:    +dominantShift.todayPct.toFixed(3),
          baselinePct: +dominantShift.baselinePct.toFixed(3),
          zScore:      +dominantShift.z.toFixed(2),
          todayCashPct:  +todayCashPct.toFixed(3),
          todayUpiPct:   +todayUpiPct.toFixed(3),
          todayCardPct:  +todayCardPct.toFixed(3),
        },
      });
    }
  }

  // ── 3. Discount pattern anomaly ───────────────────────────────────────────
  // DailySnapshot does not store discountAmount. Use today's absolute threshold instead.
  if (today.totalRevenue > 0) {
    const todayDiscountRate = today.totalDiscount / (today.totalRevenue + today.totalDiscount);
    // Flag if discounts exceed 15% of gross revenue (absolute threshold — meaningful without baseline)
    if (todayDiscountRate > 0.15 && today.totalDiscount > 500) {
      const confidence = Math.min(0.85, 0.30 + todayDiscountRate * 2);
      anomalies.push({
        type:      'discount_spike',
        label:     'Elevated Discount Activity',
        severity:  severityFromConfidence(confidence),
        confidence: +confidence.toFixed(2),
        evidence:  `Discounts today total ₹${today.totalDiscount.toFixed(0)}, which is ${(todayDiscountRate * 100).toFixed(1)}% of gross revenue (₹${(today.totalRevenue + today.totalDiscount).toFixed(0)}).`,
        metric: {
          totalDiscount:    +today.totalDiscount.toFixed(2),
          totalRevenue:     +today.totalRevenue.toFixed(2),
          discountRatePct:  +(todayDiscountRate * 100).toFixed(2),
        },
      });
    }
  }

  // ── 4. Off-hours transaction activity ─────────────────────────────────────
  // Off-hours: UTC hours 20-24 (≈ 01:30-05:30 IST) and 0-5 (≈ 05:30-10:30 IST)
  // Compare today's off-hour order ratio vs 14d baseline from DailySnapshot hourlyOrders
  const recentSnapshots = snapshots.slice(0, 14);
  if (recentSnapshots.length >= 7 && today.totalOrders > 0) {
    const baselineOffHoursRatios = recentSnapshots
      .filter((s) => {
        const ho = s.hourlyOrders as number[];
        return Array.isArray(ho) && ho.reduce((a, b) => a + b, 0) > 0;
      })
      .map((s) => {
        const ho = s.hourlyOrders as number[];
        const total = ho.reduce((a, b) => a + b, 0);
        // Off hours: UTC 20-23 and 0-4
        const offHours = [0, 1, 2, 3, 4, 20, 21, 22, 23]
          .reduce((sum, h) => sum + (ho[h] ?? 0), 0);
        return total > 0 ? offHours / total : 0;
      });

    if (baselineOffHoursRatios.length >= 5) {
      const { mean, std } = stats(baselineOffHoursRatios);
      const todayOffHours = [0, 1, 2, 3, 4, 20, 21, 22, 23]
        .reduce((sum, h) => sum + hourlyTotal[h], 0);
      const todayOffHoursRatio = todayOffHours / today.totalOrders;
      const z = zScore(todayOffHoursRatio, mean, std);
      if (isAnomaly(z) && todayOffHours >= 3) {
        const confidence = confidenceFromZ(z);
        anomalies.push({
          type:      'off_hours_activity',
          label:     'Off-Hours Transaction Activity',
          severity:  severityFromConfidence(confidence),
          confidence: +confidence.toFixed(2),
          evidence:  `${todayOffHours} orders (${(todayOffHoursRatio * 100).toFixed(1)}%) placed during off-hours today vs ${(mean * 100).toFixed(1)}% ${recentSnapshots.length}-day average.`,
          metric: {
            offHoursOrders:    todayOffHours,
            totalOrders:       today.totalOrders,
            todayOffHoursPct:  +(todayOffHoursRatio * 100).toFixed(2),
            baselineMeanPct:   +(mean * 100).toFixed(2),
            zScore:            +z.toFixed(2),
          },
        });
      }
    }
  }

  // ── 5. Round-amount concentration ─────────────────────────────────────────
  // Flag if > 40% of non-cancelled orders have grandTotal divisible by 50.
  // This pattern can indicate manual price adjustments or systematic rounding.
  if (completedToday >= 10) {
    const roundPct = today.roundAmountOrders / completedToday;
    if (roundPct > 0.40) {
      const confidence = Math.min(0.90, 0.20 + (roundPct - 0.40) * 2.5);
      anomalies.push({
        type:      'round_amount_pattern',
        label:     'Round-Amount Order Concentration',
        severity:  severityFromConfidence(confidence),
        confidence: +confidence.toFixed(2),
        evidence:  `${today.roundAmountOrders} of ${completedToday} orders (${(roundPct * 100).toFixed(1)}%) today have a grand total exactly divisible by ₹50. This is unusually high for organic ordering patterns.`,
        metric: {
          roundAmountOrders: today.roundAmountOrders,
          completedOrders:   completedToday,
          roundPct:          +(roundPct * 100).toFixed(2),
        },
      });
    }
  }

  // ── 6. Cancellation clustering ────────────────────────────────────────────
  // Flag if > 60% of today's cancellations are concentrated in ≤ 2 consecutive hours.
  if (today.cancelledOrders >= 4) {
    const cancelledByHour = hourlyCancelled;
    const totalCancelled  = today.cancelledOrders;

    // Find max cancellations in any 2-hour window
    let maxWindow = 0;
    let maxWindowStart = 0;
    for (let h = 0; h < 24; h++) {
      const window = (cancelledByHour[h] ?? 0) + (cancelledByHour[(h + 1) % 24] ?? 0);
      if (window > maxWindow) {
        maxWindow = window;
        maxWindowStart = h;
      }
    }

    const clusterRatio = maxWindow / totalCancelled;
    if (clusterRatio > 0.60) {
      const confidence = Math.min(0.90, 0.30 + (clusterRatio - 0.60) * 2.5);
      anomalies.push({
        type:      'cancellation_cluster',
        label:     'Cancellation Time Clustering',
        severity:  severityFromConfidence(confidence),
        confidence: +confidence.toFixed(2),
        evidence:  `${maxWindow} of ${totalCancelled} cancellations (${(clusterRatio * 100).toFixed(1)}%) today occurred within a 2-hour window starting at ${maxWindowStart}:00 UTC.`,
        metric: {
          clusteredCancellations: maxWindow,
          totalCancellations:     totalCancelled,
          clusterPct:             +(clusterRatio * 100).toFixed(2),
          clusterHourStart:       maxWindowStart,
        },
      });
    }
  }

  // ── Gemini explanation (one call for all anomalies) ───────────────────────
  let summary = 'No anomalies detected for today. Operations appear within normal parameters.';

  if (anomalies.length > 0) {
    const anomalySummaryText = anomalies.map((a, i) =>
      `${i + 1}. ${a.label} (${a.severity} severity, confidence ${(a.confidence * 100).toFixed(0)}%): ${a.evidence}`,
    ).join('\n');

    const prompt = `You are a business intelligence analyst for a restaurant/hotel POS system.

The following operational anomalies were detected today (${todayStr}) using statistical analysis over a ${snapshots.length}-day baseline:

${anomalySummaryText}

For each anomaly, provide:
- A brief, neutral explanation of why this pattern may have occurred (avoid accusatory language)
- 2-3 plausible business reasons (operational, seasonal, system-related)
- 1 practical suggested action for the manager

Keep each explanation to 2-3 sentences. Total response under 200 words. Use professional, neutral language.`;

    const narrative = await generateNarrative(prompt);
    if (narrative) summary = narrative.trim();
  }

  const report: AnomalyReport = {
    hotelId,
    analysisDate:   todayStr,
    dataWindowDays: snapshots.length,
    anomalies,
    allClear:       anomalies.length === 0,
    summary,
    generatedAt:    new Date().toISOString(),
  };

  logger.info('[anomalyDetector] Report built', {
    hotelId,
    anomalyCount: anomalies.length,
    date:         todayStr,
  });

  return report;
}
