import crypto from 'crypto';
import mongoose from 'mongoose';
import Order from '../models/Order';
import HourlyMetrics, { IItemMetric } from '../models/HourlyMetrics';
import DailySnapshot from '../models/DailySnapshot';
import JobRegistry from '../models/JobRegistry';
import Hotel from '../models/Hotel';
import { acquireSchedulerLock, releaseSchedulerLock } from '../utils/schedulerLock';
import { logger } from '../utils/logger';
import { yesterdayBusinessDate, startOfBusinessDay, endOfBusinessDay } from '../utils/businessDate';

const DAILY_BATCH_SIZE = 10;

// ─── Thundering herd mitigation ───────────────────────────────────────────────
// Distributes hotels across a 240-minute window (UTC 0:00–3:59).
// Deterministic per hotelId: same hotel always lands in the same slot.
export function hotelStaggerSlot(hotelId: string): number {
  return parseInt(hotelId.slice(-8), 16) % 240;
}

// ─── Delta helpers ────────────────────────────────────────────────────────────

function pct(current: number, baseline: number): number | null {
  if (baseline === 0) return null;
  return +((current - baseline) / baseline * 100).toFixed(1);
}

// ─── Build a single hotel's daily snapshot ────────────────────────────────────

export async function buildDailySnapshot(
  hotelId:  mongoose.Types.ObjectId,
  date:     string,  // "YYYY-MM-DD" in hotel-local timezone
  timezone: string = 'Asia/Kolkata',
): Promise<void> {
  // Hotel-level lock: prevents duplicate snapshot builds if the scheduler fires twice
  const hotelLockName = `daily-snap:${hotelId}:${date}`;
  const acquired      = await acquireSchedulerLock(hotelLockName, 600);
  if (!acquired) {
    logger.warn('[dailySnap] hotel lock already held, skipping', { hotelId: hotelId.toString(), date });
    return;
  }

  try {
  const startOfDay = startOfBusinessDay(date, timezone);
  const endOfDay   = endOfBusinessDay(date, timezone);
  const matchActive = {
    hotelId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    status:    { $ne: 'cancelled' },
  };

  // ── Hourly metrics for this day ───────────────────────────────────────────
  const hourlyDocs = await HourlyMetrics.find({ hotelId, date }).lean();

  const hourlyRevenue = Array(24).fill(0) as number[];
  const hourlyOrders  = Array(24).fill(0) as number[];

  let totalRevenue          = 0;
  let totalOrders           = 0;
  let cancelledOrders       = 0;
  let cancelledRevenue      = 0;
  const paymentBreakdown    = { cash: 0, upi: 0, card: 0, split: 0 };
  const sourceBreakdown     = { dineIn: 0, takeaway: 0, qr: 0, swiggy: 0, zomato: 0, other: 0 };
  let peakHour              = 0;
  let peakHourRevenue       = 0;

  for (const h of hourlyDocs) {
    hourlyRevenue[h.hour] = h.revenue;
    hourlyOrders[h.hour]  = h.orderCount;
    totalRevenue          += h.revenue;
    totalOrders           += h.orderCount;
    cancelledOrders       += h.cancelledCount;
    cancelledRevenue      += h.cancelledRevenue;
    paymentBreakdown.cash  += h.paymentBreakdown.cash;
    paymentBreakdown.upi   += h.paymentBreakdown.upi;
    paymentBreakdown.card  += h.paymentBreakdown.card;
    paymentBreakdown.split += h.paymentBreakdown.split;
    sourceBreakdown.dineIn   += h.sourceBreakdown.dineIn;
    sourceBreakdown.takeaway += h.sourceBreakdown.takeaway;
    sourceBreakdown.qr       += h.sourceBreakdown.qr;
    sourceBreakdown.swiggy   += h.sourceBreakdown.swiggy;
    sourceBreakdown.zomato   += h.sourceBreakdown.zomato;
    sourceBreakdown.other    += h.sourceBreakdown.other;
    if (h.revenue > peakHourRevenue) {
      peakHourRevenue = h.revenue;
      peakHour        = h.hour;
    }
  }

  // ── Top 10 items by qty (display leaderboard) — from hourly topItems approx ──
  const itemQtyMap = new Map<string, IItemMetric>();
  for (const h of hourlyDocs) {
    for (const item of h.topItems) {
      const key = item.productId.toString();
      const existing = itemQtyMap.get(key);
      if (existing) {
        existing.qty     += item.qty;
        existing.revenue += item.revenue;
      } else {
        itemQtyMap.set(key, {
          productId:   item.productId,
          productName: item.productName,
          qty:         item.qty,
          revenue:     item.revenue,
        });
      }
    }
  }
  const topItems: IItemMetric[] = Array.from(itemQtyMap.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10)
    .map((i) => ({ ...i, revenue: +i.revenue.toFixed(2) }));

  // ── Full item breakdown for menu engineering (direct from orders) ─────────
  const itemAgg = await Order.aggregate([
    { $match: matchActive },
    { $unwind: '$items' },
    {
      $group: {
        _id:         '$items.product',
        productName: { $first: '$items.productName' },
        qty:         { $sum: '$items.quantity' },
        revenue:     { $sum: '$items.total' },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 100 },
  ]);

  const allItems: IItemMetric[] = itemAgg.map((r) => ({
    productId:   r._id as mongoose.Types.ObjectId,
    productName: String(r.productName ?? ''),
    qty:         Number(r.qty ?? 0),
    revenue:     +(r.revenue ?? 0).toFixed(2),
  }));

  // ── Unique tables for the day ─────────────────────────────────────────────
  const tableNums = await Order.distinct('tableNumber', {
    ...matchActive,
    tableNumber: { $nin: [null, ''] },
  });
  const uniqueTables = tableNums.length;

  // ── Deltas vs historical baselines ───────────────────────────────────────
  // Require at least 3 days of history before reporting a delta
  const last7 = await DailySnapshot.find(
    { hotelId, date: { $lt: date } },
    { date: 1, totalRevenue: 1, totalOrders: 1 },
  )
    .sort({ date: -1 })
    .limit(7)
    .lean();

  let revenueVs7DayAvgPct:     number | null = null;
  let ordersVs7DayAvgPct:      number | null = null;
  let revenueVsSameWeekdayPct: number | null = null;

  if (last7.length >= 3) {
    const avgRevenue = last7.reduce((s, d) => s + d.totalRevenue, 0) / last7.length;
    const avgOrders  = last7.reduce((s, d) => s + d.totalOrders, 0)  / last7.length;
    revenueVs7DayAvgPct = pct(totalRevenue, avgRevenue);
    ordersVs7DayAvgPct  = pct(totalOrders, avgOrders);
  }

  // Same weekday = 7 days ago (first entry in last7 is the most recent prior day)
  const sameWeekdaySnap = last7.find((d) => {
    const ms = new Date(d.date).getTime() - new Date(date).getTime();
    return Math.abs(ms) === 7 * 24 * 60 * 60 * 1000;
  });
  if (sameWeekdaySnap) {
    revenueVsSameWeekdayPct = pct(totalRevenue, sameWeekdaySnap.totalRevenue);
  }

  // ── dataInputHash for idempotency ────────────────────────────────────────
  const hashInput = `${hotelId}:${date}:${totalRevenue.toFixed(2)}:${totalOrders}:${cancelledOrders}`;
  const dataInputHash = crypto.createHash('sha256').update(hashInput).digest('hex');

  // ── Upsert DailySnapshot ─────────────────────────────────────────────────
  await DailySnapshot.findOneAndUpdate(
    { hotelId, date },
    {
      $set: {
        totalRevenue:            +totalRevenue.toFixed(2),
        totalOrders,
        avgOrderValue:           totalOrders > 0 ? +(totalRevenue / totalOrders).toFixed(2) : 0,
        cancelledOrders,
        cancelledRevenue:        +cancelledRevenue.toFixed(2),
        paymentBreakdown:        {
          cash:  +paymentBreakdown.cash.toFixed(2),
          upi:   +paymentBreakdown.upi.toFixed(2),
          card:  +paymentBreakdown.card.toFixed(2),
          split: +paymentBreakdown.split.toFixed(2),
        },
        sourceBreakdown:         {
          dineIn:   +sourceBreakdown.dineIn.toFixed(2),
          takeaway: +sourceBreakdown.takeaway.toFixed(2),
          qr:       +sourceBreakdown.qr.toFixed(2),
          swiggy:   +sourceBreakdown.swiggy.toFixed(2),
          zomato:   +sourceBreakdown.zomato.toFixed(2),
          other:    +sourceBreakdown.other.toFixed(2),
        },
        topItems,
        allItems,
        peakHour,
        peakHourRevenue:         +peakHourRevenue.toFixed(2),
        hourlyRevenue:           hourlyRevenue.map((v) => +v.toFixed(2)),
        hourlyOrders,
        uniqueTables,
        revenueVs7DayAvgPct,
        ordersVs7DayAvgPct,
        revenueVsSameWeekdayPct,
        dataInputHash,
        computedAt:              new Date(),
      },
    },
    { upsert: true, new: false },
  );
  } finally {
    await releaseSchedulerLock(hotelLockName);
  }
}

// ─── Dispatch daily snapshots for hotels due in this minute ──────────────────
// Called every minute during UTC 0:00–3:59 (minuteOfDay 0–239)

export async function dispatchDailySnapshots(minuteOfDay: number): Promise<void> {
  const jobStart  = Date.now();
  const jobName   = 'daily-snapshot';
  // Per-minute lock: each minute's slot is independent, so different minutes
  // can run on different instances without blocking each other.
  const lockName  = `daily-snapshot-m${minuteOfDay}`;

  const acquired = await acquireSchedulerLock(lockName, 5 * 60);
  if (!acquired) return;

  // "Yesterday" is computed per-hotel below using hotel timezone.
  // This UTC fallback is kept only for the job registry log.
  const yesterdayUtc = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await JobRegistry.findOneAndUpdate(
    { jobName },
    { $set: { lastRunAt: new Date(), lastRunStatus: 'running', lastError: null } },
    { upsert: true },
  );

  const hotels = await Hotel.find(
    { status: { $in: ['active', 'trial'] } },
    { _id: 1, timezone: 1 },
  ).lean();

  const due = hotels.filter((h) => hotelStaggerSlot(h._id.toString()) === minuteOfDay);

  try {
    if (due.length === 0) {
      await JobRegistry.findOneAndUpdate(
        { jobName },
        { $set: { lastRunStatus: 'success', hotelsProcessed: 0, hotelsFailed: 0, durationMs: Date.now() - jobStart } },
      );
      return;
    }

    logger.info(`[dailySnapshot] minute=${minuteOfDay} dispatching ${due.length} hotel(s) (ref UTC yesterday: ${yesterdayUtc})`);

    let processed              = 0;
    let failed                 = 0;
    let lastError: string | null = null;

    for (let i = 0; i < due.length; i += DAILY_BATCH_SIZE) {
      const batch   = due.slice(i, i + DAILY_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((h) => {
          const tz      = (h as any).timezone ?? 'Asia/Kolkata';
          const dateStr = yesterdayBusinessDate(tz);
          return buildDailySnapshot(h._id as mongoose.Types.ObjectId, dateStr, tz);
        }),
      );
      for (let j = 0; j < results.length; j++) {
        const r   = results[j];
        const hid = batch[j]?._id?.toString() ?? 'unknown';
        if (r.status === 'fulfilled') {
          processed++;
        } else {
          failed++;
          lastError = `hotel:${hid} — ${String(r.reason)}`;
          logger.error('[dailySnapshot] hotel failed', { reason: r.reason });
        }
      }
    }

    await JobRegistry.findOneAndUpdate(
      { jobName },
      {
        $set: {
          lastRunStatus:   failed === 0 ? 'success' : 'failure',
          hotelsProcessed: processed,
          hotelsFailed:    failed,
          durationMs:      Date.now() - jobStart,
          lastError,
        },
      },
    );
  } finally {
    await releaseSchedulerLock(lockName);
  }
}
