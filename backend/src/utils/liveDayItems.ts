import mongoose from 'mongoose';
import Order from '../models/Order';
import type { IItemMetric } from '../models/HourlyMetrics';
import { startOfBusinessDay, endOfBusinessDay } from './businessDate';

/**
 * Per-dish sales for one business day, straight from orders — the same numbers
 * the nightly DailySnapshot stores as `allItems` (non-cancelled orders, grouped
 * by product, top 100 by revenue). Used for "today so far" recommendations;
 * nothing is saved.
 */
export async function liveItemsForDay(
  hotelId:  string,
  date:     string,
  timezone: string = 'Asia/Kolkata',
): Promise<IItemMetric[]> {
  const rows = await Order.aggregate([
    {
      $match: {
        hotelId:   new mongoose.Types.ObjectId(hotelId),
        createdAt: { $gte: startOfBusinessDay(date, timezone), $lte: endOfBusinessDay(date, timezone) },
        status:    { $ne: 'cancelled' },
      },
    },
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
  return rows.map((r) => ({
    productId:   r._id as mongoose.Types.ObjectId,
    productName: String(r.productName ?? ''),
    qty:         Number(r.qty ?? 0),
    revenue:     +(Number(r.revenue ?? 0)).toFixed(2),
  }));
}
