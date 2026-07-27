import mongoose from 'mongoose';
import Order from '../models/Order';
import HourlyMetrics, { IItemMetric, IPaymentBreakdown, ISourceBreakdown } from '../models/HourlyMetrics';
import JobRegistry from '../models/JobRegistry';
import Hotel from '../models/Hotel';
import { setHotMetrics, upsertLeaderboard } from '../utils/aiMetricsCache';
import { acquireSchedulerLock, releaseSchedulerLock } from '../utils/schedulerLock';
import { logger } from '../utils/logger';

const BATCH_SIZE = 20;

// ─── Aggregate a single hotel's metrics for one UTC hour ─────────────────────

export async function aggregateHotelHour(
  hotelId:     mongoose.Types.ObjectId,
  startOfHour: Date,
  endOfHour:   Date,
): Promise<void> {
  const matchBase = {
    hotelId,
    createdAt: { $gte: startOfHour, $lte: endOfHour },
  };
  const matchActive = { ...matchBase, status: { $ne: 'cancelled' } };

  // ── Main order stats via aggregation ─────────────────────────────────────
  const [stats] = await Order.aggregate([
    { $match: matchBase },
    {
      $group: {
        _id: null,
        orderCount:       { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } },
        revenue:          { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$grandTotal', 0] } },
        cancelledCount:   { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        cancelledRevenue: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, '$grandTotal', 0] } },
        // Payment breakdown
        cashRev:   { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq: ['$paymentMethod', 'cash']  }] }, '$grandTotal', 0] } },
        upiRev:    { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq: ['$paymentMethod', 'upi']   }] }, '$grandTotal', 0] } },
        cardRev:   { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq: ['$paymentMethod', 'card']  }] }, '$grandTotal', 0] } },
        splitRev:  { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq: ['$paymentMethod', 'split'] }] }, '$grandTotal', 0] } },
        // Source breakdown
        dineInRev:   { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq:  ['$orderSource', 'dine-in']                         }] }, '$grandTotal', 0] } },
        takeawayRev: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq:  ['$orderSource', 'takeaway']                        }] }, '$grandTotal', 0] } },
        qrRev:       { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $in:  ['$orderSource', ['qr', 'kiosk', 'waiter']]        }] }, '$grandTotal', 0] } },
        swiggyRev:   { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq:  ['$orderSource', 'swiggy']                          }] }, '$grandTotal', 0] } },
        zomatoRev:   { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $eq:  ['$orderSource', 'zomato']                          }] }, '$grandTotal', 0] } },
        otherRev:    { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'cancelled'] }, { $not: { $in: ['$orderSource', ['dine-in','takeaway','qr','kiosk','waiter','swiggy','zomato']] } }] }, '$grandTotal', 0] } },
      },
    },
  ]);

  // No orders this hour — write a zero row so we know the hour was processed
  const orderCount       = stats?.orderCount       ?? 0;
  const revenue          = stats?.revenue          ?? 0;
  const cancelledCount   = stats?.cancelledCount   ?? 0;
  const cancelledRevenue = stats?.cancelledRevenue ?? 0;

  const paymentBreakdown: IPaymentBreakdown = {
    cash:  +(stats?.cashRev   ?? 0).toFixed(2),
    upi:   +(stats?.upiRev    ?? 0).toFixed(2),
    card:  +(stats?.cardRev   ?? 0).toFixed(2),
    split: +(stats?.splitRev  ?? 0).toFixed(2),
  };

  const sourceBreakdown: ISourceBreakdown = {
    dineIn:   +(stats?.dineInRev   ?? 0).toFixed(2),
    takeaway: +(stats?.takeawayRev ?? 0).toFixed(2),
    qr:       +(stats?.qrRev       ?? 0).toFixed(2),
    swiggy:   +(stats?.swiggyRev   ?? 0).toFixed(2),
    zomato:   +(stats?.zomatoRev   ?? 0).toFixed(2),
    other:    +(stats?.otherRev    ?? 0).toFixed(2),
  };

  // ── Top 10 items by revenue this hour ────────────────────────────────────
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
    { $limit: 10 },
  ]);

  const topItems: IItemMetric[] = itemAgg.map((r) => ({
    productId:   r._id as mongoose.Types.ObjectId,
    productName: String(r.productName ?? ''),
    qty:         Number(r.qty ?? 0),
    revenue:     +(r.revenue ?? 0).toFixed(2),
  }));

  // ── Unique tables this hour ───────────────────────────────────────────────
  const tableNums = await Order.distinct('tableNumber', {
    ...matchActive,
    tableNumber: { $nin: [null, ''] },
  });
  const uniqueTables = tableNums.length;

  // ── Build date / hour keys ────────────────────────────────────────────────
  const date = startOfHour.toISOString().slice(0, 10);
  const hour = startOfHour.getUTCHours();

  // ── Upsert HourlyMetrics ──────────────────────────────────────────────────
  await HourlyMetrics.findOneAndUpdate(
    { hotelId, date, hour },
    {
      $set: {
        orderCount,
        revenue:          +revenue.toFixed(2),
        avgOrderValue:    orderCount > 0 ? +(revenue / orderCount).toFixed(2) : 0,
        cancelledCount,
        cancelledRevenue: +cancelledRevenue.toFixed(2),
        paymentBreakdown,
        sourceBreakdown,
        topItems,
        uniqueTables,
        computedAt:       new Date(),
      },
    },
    { upsert: true, new: false },
  );
}

// ─── Update Redis hot metrics + leaderboard for a hotel from today's HourlyMetrics ──
// Single $facet pipeline: halves MongoDB round-trips vs two separate aggregations.

async function refreshRedisForHotel(hotelId: mongoose.Types.ObjectId, today: string): Promise<void> {
  const [result] = await HourlyMetrics.aggregate([
    { $match: { hotelId, date: today } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id:     null,
              revenue: { $sum: '$revenue' },
              orders:  { $sum: '$orderCount' },
            },
          },
        ],
        items: [
          { $unwind: '$topItems' },
          {
            $group: {
              _id:         '$topItems.productId',
              productName: { $first: '$topItems.productName' },
              qty:         { $sum: '$topItems.qty' },
              revenue:     { $sum: '$topItems.revenue' },
            },
          },
          { $sort: { revenue: -1 } },
          { $limit: 20 },
        ],
      },
    },
  ]);

  const totals = result?.totals?.[0];
  if (totals) {
    await setHotMetrics(hotelId.toString(), totals.revenue, totals.orders);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaderboardItems: IItemMetric[] = (result?.items ?? []).map((r: any) => ({
    productId:   r._id as mongoose.Types.ObjectId,
    productName: String(r.productName ?? ''),
    qty:         Number(r.qty ?? 0),
    revenue:     +(Number(r.revenue ?? 0)).toFixed(2),
  }));

  if (leaderboardItems.length > 0) {
    await upsertLeaderboard(hotelId.toString(), today, leaderboardItems);
  }
}

// ─── Run hourly aggregation across all active hotels ─────────────────────────

export async function runHourlyAggregation(
  targetDate?: string,
  targetHour?: number,
): Promise<void> {
  const jobStart = Date.now();
  const jobName  = 'hourly-aggregation';

  // Distributed lock — skip if another instance is already running this job.
  // TTL: 55 min, giving headroom before the next scheduled run at :05.
  const acquired = await acquireSchedulerLock(jobName, 55 * 60);
  if (!acquired) return;

  // Default: the just-completed UTC hour (1h ago)
  const prevHour    = new Date(Date.now() - 60 * 60 * 1000);
  const date        = targetDate ?? prevHour.toISOString().slice(0, 10);
  const hour        = targetHour ?? prevHour.getUTCHours();
  const today       = new Date().toISOString().slice(0, 10);
  const startOfHour = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`);
  const endOfHour   = new Date(`${date}T${String(hour).padStart(2, '0')}:59:59.999Z`);

  logger.info(`[hourlyAggregator] running for ${date} hour=${hour}`);

  await JobRegistry.findOneAndUpdate(
    { jobName },
    { $set: { lastRunAt: new Date(), lastRunStatus: 'running', lastError: null } },
    { upsert: true },
  );

  const hotels = await Hotel.find(
    { status: { $in: ['active', 'trial'] } },
    { _id: 1 },
  ).lean();

  let processed    = 0;
  let failed       = 0;
  const errors: string[] = [];

  try {
    for (let i = 0; i < hotels.length; i += BATCH_SIZE) {
      const batch   = hotels.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (h) => {
          const hotelId = h._id as mongoose.Types.ObjectId;
          await aggregateHotelHour(hotelId, startOfHour, endOfHour);
          if (date === today) {
            await refreshRedisForHotel(hotelId, today);
          }
        }),
      );
      for (let j = 0; j < results.length; j++) {
        const r   = results[j];
        const hid = batch[j]?._id?.toString() ?? 'unknown';
        if (r.status === 'fulfilled') {
          processed++;
        } else {
          failed++;
          errors.push(`hotel:${hid} — ${String(r.reason)}`);
          logger.error('[hourlyAggregator] hotel failed', { hotelId: hid, reason: r.reason });
        }
      }
    }

    const durationMs = Date.now() - jobStart;

    await JobRegistry.findOneAndUpdate(
      { jobName },
      {
        $set: {
          lastRunStatus:   failed === 0 ? 'success' : 'failure',
          hotelsProcessed: processed,
          hotelsFailed:    failed,
          durationMs,
          lastError:       errors.length > 0 ? errors.slice(0, 3).join(' | ') : null,
        },
      },
    );

    logger.info(`[hourlyAggregator] done — processed=${processed} failed=${failed} duration=${durationMs}ms`);
  } finally {
    await releaseSchedulerLock(jobName);
  }
}
