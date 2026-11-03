import mongoose from 'mongoose';
import DailySnapshot from '../models/DailySnapshot';
import Hotel from '../models/Hotel';
import Order from '../models/Order';
import { aggregateHotelHour } from '../workers/hourlyAggregator';
import { buildDailySnapshot } from '../workers/dailySnapshotBuilder';
import { todayBusinessDate, startOfBusinessDay, endOfBusinessDay, toBusinessDate } from './businessDate';
import { logger } from './logger';
import { singleFlight } from './singleFlight';
import { recordAlertsForDay } from '../services/alertEngine';

const HOUR = 60 * 60 * 1000;

/**
 * Catch-up for the nightly AI summary. Each hotel's DailySnapshot is built in a
 * single one-minute slot overnight; if the server was restarting or busy then,
 * that day is never built and every AI page shows "no data". This builds a
 * missing past day on demand from that day's orders: hourly metrics first
 * (the snapshot totals come from them), then the snapshot — the same code the
 * nightly jobs run, so the result is identical.
 *
 * Only closed days (before today) — a part-day snapshot would skew trends.
 * Returns true when a snapshot for `date` exists afterwards.
 */
export async function ensureDailySnapshot(hotelId: string, date: string): Promise<boolean> {
  const hid = new mongoose.Types.ObjectId(hotelId);
  if (await DailySnapshot.exists({ hotelId: hid, date })) return true;

  const hotel = await Hotel.findById(hid, { timezone: 1 }).lean();
  const tz    = (hotel as { timezone?: string } | null)?.timezone ?? 'Asia/Kolkata';
  if (date >= todayBusinessDate(tz)) return false;

  const start = startOfBusinessDay(date, tz);
  const end   = endOfBusinessDay(date, tz);
  // Closed or no sales that day — nothing to summarise
  if (!(await Order.exists({ hotelId: hid, createdAt: { $gte: start, $lte: end } }))) return false;

  // The hourly buckets that belong to this business day (same keys the hourly job writes)
  const first = Math.ceil(start.getTime() / HOUR) * HOUR;
  for (let t = first; t <= end.getTime(); t += HOUR) {
    const hourStart = new Date(t);
    if (toBusinessDate(hourStart, tz) !== date) continue;
    await aggregateHotelHour(hid, hourStart, new Date(t + HOUR - 1), tz);
  }
  await buildDailySnapshot(hid, date, tz);

  const ok = !!(await DailySnapshot.exists({ hotelId: hid, date }));
  if (ok) await recordAlertsForDay(hotelId, date);
  logger.info('[ensureDailySnapshot] built missing day on demand', { hotelId, date, ok });
  return ok;
}

/** The hotel's timezone and its business "yesterday". */
export async function hotelYesterday(hotelId: string): Promise<{ tz: string; yesterday: string }> {
  const hotel = await Hotel.findById(hotelId, { timezone: 1 }).lean();
  const tz    = (hotel as { timezone?: string } | null)?.timezone ?? 'Asia/Kolkata';
  return { tz, yesterday: toBusinessDate(new Date(Date.now() - 86_400_000), tz) };
}

/** Build a missed nightly summary on demand; never fails the caller. */
export async function catchUpSnapshot(hotelId: string, date: string): Promise<void> {
  try {
    await singleFlight(`snapfill:${hotelId}:${date}`, () => ensureDailySnapshot(hotelId, date));
  } catch (err) {
    logger.warn('[ensureDailySnapshot] catch-up failed', { hotelId, date, err: String(err) });
  }
}

/**
 * Fill any missed days in the last `days` (oldest first, one at a time) in the
 * background — used by 7-day trend views so a gap heals itself. Days without
 * orders are skipped cheaply.
 */
export function catchUpRecentDaysInBackground(hotelId: string, days: number, tz: string): void {
  void (async () => {
    for (let n = days; n >= 1; n--) {
      await catchUpSnapshot(hotelId, toBusinessDate(new Date(Date.now() - n * 86_400_000), tz));
    }
  })();
}
