import mongoose from 'mongoose';
import DailySnapshot from '../models/DailySnapshot';
import HourlyMetrics from '../models/HourlyMetrics';
import { getHotMetrics, getTopItems } from '../utils/aiMetricsCache';
import { computeHealthScore } from './healthScore';

// ─── Return shapes ────────────────────────────────────────────────────────────

export interface DashboardTrend {
  date:         string;
  totalRevenue: number;
  totalOrders:  number;
  healthScore:  number;
}

export interface WeekComparison {
  thisWeekRevenue: number;
  lastWeekRevenue: number;
  changePct:       number | null;
}

export interface ExecutiveDashboard {
  today: {
    revenue:   number;
    orders:    number;
    updatedAt: string;
    topItems:  Array<{ productId: string; productName: string; revenue: number }>;
    source:    'cache' | 'mongodb';
  };
  trend:              DashboardTrend[];   // last 7 complete days, chronological
  weekComparison:     WeekComparison;    // rolling 7-day vs prior 7-day
  latestHealthScore:  { date: string; score: number; grade: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function buildExecutiveDashboard(hotelId: string): Promise<ExecutiveDashboard> {
  const today    = new Date().toISOString().slice(0, 10);
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  // ── Today's metrics: Redis hot cache → HourlyMetrics fallback ─────────────
  const [hot, topItemsRedis] = await Promise.all([
    getHotMetrics(hotelId),
    getTopItems(hotelId, today, 5),
  ]);

  let todayRevenue   = 0;
  let todayOrders    = 0;
  let todayUpdatedAt = new Date().toISOString();
  let todaySource: 'cache' | 'mongodb' = 'cache';

  if (hot) {
    todayRevenue   = hot.revenue;
    todayOrders    = hot.orders;
    todayUpdatedAt = hot.updatedAt;
  } else {
    // Redis unavailable or no data — sum from HourlyMetrics for today
    const [agg] = await HourlyMetrics.aggregate([
      { $match: { hotelId: hotelOId, date: today } },
      { $group: { _id: null, revenue: { $sum: '$revenue' }, orders: { $sum: '$orderCount' } } },
    ]);
    todayRevenue  = +(agg?.revenue ?? 0).toFixed(2);
    todayOrders   = agg?.orders ?? 0;
    todaySource   = 'mongodb';
  }

  // ── Last 7 complete days' snapshots ───────────────────────────────────────
  const last7Snaps = await DailySnapshot.find(
    { hotelId: hotelOId, date: { $lt: today } },
    {
      date: 1, totalRevenue: 1, totalOrders: 1,
      cancelledOrders: 1, avgOrderValue: 1,
      revenueVs7DayAvgPct: 1, ordersVs7DayAvgPct: 1,
      peakHourRevenue: 1, sourceBreakdown: 1,
    },
  ).sort({ date: -1 }).limit(7).lean();

  // Trend: compute health score for each snapshot, return chronologically
  const trend: DashboardTrend[] = last7Snaps
    .map((s) => ({
      date:         s.date,
      totalRevenue: s.totalRevenue,
      totalOrders:  s.totalOrders,
      healthScore:  computeHealthScore(s, []).score,
    }))
    .reverse();

  // ── Rolling week comparison — last 7 complete days vs the 7 before that ───
  // "this week" = [today-7, today-1]  (7 complete days just ended)
  // "last week" = [today-14, today-8] (7 complete days before that)
  const thisWeekStart = daysAgo(7);     // e.g. Jul 20
  const thisWeekEnd   = daysAgo(1);     // yesterday
  const lastWeekStart = daysAgo(14);    // Jul 13
  const lastWeekEnd   = daysAgo(8);     // Jul 19

  const [thisWeekSnaps, lastWeekSnaps] = await Promise.all([
    DailySnapshot.find(
      { hotelId: hotelOId, date: { $gte: thisWeekStart, $lte: thisWeekEnd } },
      { totalRevenue: 1 },
    ).lean(),
    DailySnapshot.find(
      { hotelId: hotelOId, date: { $gte: lastWeekStart, $lte: lastWeekEnd } },
      { totalRevenue: 1 },
    ).lean(),
  ]);

  const thisWeekRevenue = +thisWeekSnaps.reduce((s, d) => s + d.totalRevenue, 0).toFixed(2);
  const lastWeekRevenue = +lastWeekSnaps.reduce((s, d) => s + d.totalRevenue, 0).toFixed(2);
  const changePct = lastWeekRevenue > 0
    ? +((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue * 100).toFixed(1)
    : null;

  // ── Latest health score (most recent complete day) ────────────────────────
  let latestHealthScore: ExecutiveDashboard['latestHealthScore'] = null;
  if (last7Snaps.length > 0) {
    const latest   = last7Snaps[0]; // sorted desc — most recent
    const prior    = last7Snaps.slice(1); // up to 6 prior days for AOV comparison
    const h        = computeHealthScore(latest, prior);
    latestHealthScore = { date: latest.date, score: h.score, grade: h.grade };
  }

  return {
    today: {
      revenue:   todayRevenue,
      orders:    todayOrders,
      updatedAt: todayUpdatedAt,
      topItems:  topItemsRedis,
      source:    todaySource,
    },
    trend,
    weekComparison: { thisWeekRevenue, lastWeekRevenue, changePct },
    latestHealthScore,
  };
}
