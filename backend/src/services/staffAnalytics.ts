// ─── Staff Performance Analytics ─────────────────────────────────────────────
// All calculations in Node.js. Gemini generates narrative summary only.
// Sources: Order aggregation by cashierId (last 30 days).

import mongoose from 'mongoose';
import Order from '../models/Order';
import { generateNarrative } from '../utils/geminiNarrative';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StaffMemberStats {
  cashierId:        string;
  totalOrders:      number;
  completedOrders:  number;
  cancelledOrders:  number;
  cancelRate:       number;
  totalRevenue:     number;
  avgOrderValue:    number;
  totalDiscount:    number;
  avgDiscountPct:   number;
  revenueShare:     number;
  performanceScore: number;
  rank:             number;
}

export interface StaffAnalyticsReport {
  hotelId:        string;
  windowDays:     number;
  generatedAt:    string;
  hotelAvg: {
    ordersPerStaff:   number;
    revenuePerStaff:  number;
    aov:              number;
    cancelRate:       number;
    discountPct:      number;
  };
  staff:          StaffMemberStats[];
  totalRevenue:   number;
  totalOrders:    number;
  activeStaff:    number;
  topPerformer:   string | null;
  summary:        string;
}

// ─── Main analytics builder ───────────────────────────────────────────────────

export async function buildStaffAnalytics(hotelId: string): Promise<StaffAnalyticsReport | null> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const windowDays = 30;
  const windowStart = new Date();
  windowStart.setUTCHours(0, 0, 0, 0);
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

  const pipeline = [
    {
      $match: {
        hotelId:   hotelOId,
        createdAt: { $gte: windowStart },
        cashierId: { $nin: ['', null] },
      },
    },
    {
      $group: {
        _id:             '$cashierId',
        totalOrders:     { $sum: 1 },
        cancelledOrders: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        completedOrders: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } },
        totalRevenue:    { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$grandTotal', 0] } },
        totalDiscount:   { $sum: '$discountAmount' },
        totalGross:      { $sum: '$grandTotal' },
      },
    },
  ];

  const rows = await Order.aggregate(pipeline);

  if (rows.length === 0) {
    logger.info('[staffAnalytics] No staff data', { hotelId });
    return null;
  }

  // ── Compute per-staff metrics ────────────────────────────────────────────
  const grandTotalRevenue = rows.reduce((s, r) => s + (r.totalRevenue as number), 0);
  const grandTotalOrders  = rows.reduce((s, r) => s + (r.totalOrders as number), 0);

  const staffList = rows.map((r): Omit<StaffMemberStats, 'rank'> => {
    const completed    = r.completedOrders  as number;
    const cancelled    = r.cancelledOrders  as number;
    const total        = r.totalOrders      as number;
    const revenue      = r.totalRevenue     as number;
    const discount     = r.totalDiscount    as number;
    const gross        = r.totalGross       as number;
    const cancelRate   = total > 0   ? +(cancelled / total).toFixed(4)                     : 0;
    const aov          = completed > 0 ? +(revenue / completed).toFixed(2)                  : 0;
    const discountPct  = gross > 0   ? +((discount / gross) * 100).toFixed(2)              : 0;
    const revenueShare = grandTotalRevenue > 0 ? +((revenue / grandTotalRevenue) * 100).toFixed(2) : 0;
    return {
      cashierId:        r._id as string,
      totalOrders:      total,
      completedOrders:  completed,
      cancelledOrders:  cancelled,
      cancelRate,
      totalRevenue:     +revenue.toFixed(2),
      avgOrderValue:    aov,
      totalDiscount:    +discount.toFixed(2),
      avgDiscountPct:   discountPct,
      revenueShare,
      performanceScore: 0, // computed below
    };
  });

  // ── Hotel-wide averages ──────────────────────────────────────────────────
  const n                = staffList.length;
  const avgOrders        = grandTotalOrders / n;
  const avgRevenue       = grandTotalRevenue / n;
  const allCancelRates   = staffList.map((s) => s.cancelRate);
  const avgCancelRate    = allCancelRates.reduce((a, b) => a + b, 0) / n;
  const allAov           = staffList.map((s) => s.avgOrderValue);
  const avgAov           = allAov.reduce((a, b) => a + b, 0) / n;
  const allDiscountPcts  = staffList.map((s) => s.avgDiscountPct);
  const avgDiscountPct   = allDiscountPcts.reduce((a, b) => a + b, 0) / n;

  // ── Performance score: normalized composite (higher = better) ────────────
  // Factors: revenue share (40%), low cancel rate (30%), high AOV (30%)
  const maxRevenue   = Math.max(...staffList.map((s) => s.totalRevenue), 1);
  const maxAov       = Math.max(...staffList.map((s) => s.avgOrderValue), 1);
  const maxCancel    = Math.max(...staffList.map((s) => s.cancelRate), 0.001);

  const scored = staffList.map((s) => ({
    ...s,
    performanceScore: +(
      (s.totalRevenue / maxRevenue) * 40 +
      (1 - s.cancelRate / maxCancel) * 30 +
      (s.avgOrderValue / maxAov) * 30
    ).toFixed(1),
  }));

  // ── Rank by performanceScore descending ──────────────────────────────────
  scored.sort((a, b) => b.performanceScore - a.performanceScore);
  const ranked: StaffMemberStats[] = scored.map((s, i) => ({ ...s, rank: i + 1 }));

  // ── Gemini narrative ─────────────────────────────────────────────────────
  const topStaff = ranked.slice(0, 3).map((s) =>
    `${s.cashierId}: ${s.completedOrders} orders, ₹${s.totalRevenue.toFixed(0)} revenue, ${s.cancelRate * 100 < 1 ? '<1' : (s.cancelRate * 100).toFixed(1)}% cancel rate`,
  ).join('; ');

  const prompt = `You are a restaurant operations analyst. Here is staff performance data for the last ${windowDays} days:

Hotel averages: ${n} active staff, avg ${avgOrders.toFixed(1)} orders/staff, avg ₹${avgRevenue.toFixed(0)} revenue/staff, avg ${(avgCancelRate * 100).toFixed(1)}% cancel rate, avg ₹${avgAov.toFixed(0)} AOV.

Top performers: ${topStaff}.

Total: ${grandTotalOrders} orders, ₹${grandTotalRevenue.toFixed(0)} revenue across all staff.

Write a 60-80 word operational summary: highlight top performers, note any staff with unusually high cancel rates or discount usage, and suggest 1 coaching action. Use professional, neutral language.`;

  const narrative = await generateNarrative(prompt);
  const summary = narrative?.trim() ?? `${n} staff members processed ${grandTotalOrders} orders totaling ₹${grandTotalRevenue.toFixed(0)} over ${windowDays} days.`;

  const report: StaffAnalyticsReport = {
    hotelId,
    windowDays,
    generatedAt: new Date().toISOString(),
    hotelAvg: {
      ordersPerStaff:   +avgOrders.toFixed(1),
      revenuePerStaff:  +avgRevenue.toFixed(2),
      aov:              +avgAov.toFixed(2),
      cancelRate:       +avgCancelRate.toFixed(4),
      discountPct:      +avgDiscountPct.toFixed(2),
    },
    staff:        ranked,
    totalRevenue: +grandTotalRevenue.toFixed(2),
    totalOrders:  grandTotalOrders,
    activeStaff:  n,
    topPerformer: ranked[0]?.cashierId ?? null,
    summary,
  };

  logger.info('[staffAnalytics] Report built', { hotelId, staffCount: n, totalOrders: grandTotalOrders });
  return report;
}
