import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { computeAlerts } from '../services/alertEngine';
import { buildRecommendations } from '../services/recommendationEngine';
import {
  getCachedAlerts,
  setCachedAlerts,
  getCachedRecommendations,
  setCachedRecommendations,
} from '../utils/alertCache';
import { singleFlight } from '../utils/singleFlight';
import { sendError } from '../utils/sendError';
import DailySnapshot from '../models/DailySnapshot';
import Alert from '../models/Alert';
import Hotel from '../models/Hotel';
import { ensureDailySnapshot } from '../utils/ensureDailySnapshot';
import { liveItemsForDay } from '../utils/liveDayItems';
import { todayBusinessDate, yesterdayBusinessDate } from '../utils/businessDate';
import { logger } from '../utils/logger';

const router = Router();
router.use(authMiddleware);
router.use(requireFeature('ai'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateDate(date: string): string | null {
  if (!DATE_RE.test(date)) return 'date must be YYYY-MM-DD';
  // India is ahead of UTC: just after local midnight the local date is already tomorrow in UTC terms
  const latest = [todayUTC(), todayBusinessDate()].sort()[1];
  if (date > latest)       return 'date cannot be in the future';
  return null;
}

/** Build a missed nightly summary on demand; never fails the request. */
async function catchUpSnapshot(hotelId: string, date: string): Promise<void> {
  try {
    await singleFlight(`snapfill:${hotelId}:${date}`, () => ensureDailySnapshot(hotelId, date));
  } catch (err) {
    logger.warn('[ai] snapshot catch-up failed', { hotelId, date, err: String(err) });
  }
}

// ─── GET /api/ai/alerts ───────────────────────────────────────────────────────
// Today's smart alerts — reads from HourlyMetrics for live data.
// Cached 30min in Redis; misses compute from scratch.

router.get('/alerts', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const date    = todayUTC();

    const cached = await getCachedAlerts(hotelId, date);
    if (cached) return res.json(cached);

    const result = await singleFlight(`alerts:${hotelId}:${date}`, () => computeAlerts(hotelId, date));
    if (!result) {
      return res.status(404).json({ message: 'No metrics data available for today yet.' });
    }

    await setCachedAlerts(hotelId, date, result, true);
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to compute smart alerts', err);
  }
});

// ─── GET /api/ai/alerts/history ──────────────────────────────────────────────
// Moved here (before /alerts/:date) so Express matches the literal 'history'
// segment before the :date wildcard catches it.
router.get('/alerts/history', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = new mongoose.Types.ObjectId(req.hotelId!);
    const since    = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const alerts   = await Alert.find(
      { hotelId, dedupDate: { $gte: since } },
    ).sort({ dedupDate: -1, severity: 1 }).limit(100).lean();
    return res.json({ alerts });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch alert history', err);
  }
});

// ─── GET /api/ai/alerts/:date ─────────────────────────────────────────────────
// Past-day smart alerts — reads from DailySnapshot.
// Cached 24h in Redis.

router.get('/alerts/:date', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { date } = req.params;

    const err = validateDate(date);
    if (err) return res.status(400).json({ message: err });

    const cached = await getCachedAlerts(hotelId, date);
    if (cached) return res.json(cached);

    const result = await singleFlight(`alerts:${hotelId}:${date}`, () => computeAlerts(hotelId, date));
    if (!result) {
      return res.status(404).json({ message: `No snapshot data found for ${date}.` });
    }

    const isToday = date === todayUTC();
    await setCachedAlerts(hotelId, date, result, isToday);
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to compute smart alerts', err);
  }
});

// ─── GET /api/ai/recommendations ─────────────────────────────────────────────
// Today's recommendation set — requires a DailySnapshot for today.
// Snapshots for today exist only after the first nightly run or manual trigger.
// Cached 2h in Redis.

router.get('/recommendations', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = req.hotelId!;
    const hotelOId = new mongoose.Types.ObjectId(hotelId);

    // Yesterday's summary may have been missed overnight — build it now if so
    const hotel = await Hotel.findById(hotelOId, { timezone: 1 }).lean();
    await catchUpSnapshot(hotelId, yesterdayBusinessDate((hotel as { timezone?: string } | null)?.timezone ?? 'Asia/Kolkata'));

    // Find the latest available snapshot so we don't 404 during business hours
    // when today's snapshot hasn't been generated yet.
    const snap = await DailySnapshot.findOne({ hotelId: hotelOId }).sort({ date: -1 }).lean();
    if (!snap) {
      return res.status(404).json({
        message: 'No daily snapshot available. Recommendations require at least one completed snapshot.',
      });
    }
    const date = snap.date as string;

    const cached = await getCachedRecommendations(hotelId, date);
    if (cached) return res.json(cached);

    const result = await singleFlight(`recs:${hotelId}:${date}`, () => buildRecommendations(hotelId, date));
    if (!result) {
      return res.status(404).json({
        message: 'No daily snapshot available. Recommendations require a completed snapshot.',
      });
    }

    const isToday = date === todayUTC();
    await setCachedRecommendations(hotelId, date, result, isToday);
    return res.json({ ...result, date: snap.date });
  } catch (err) {
    if ((err as any)?.code === 'AI_QUOTA_EXCEEDED') {
      return res.status(429).json({ code: 'AI_QUOTA_EXCEEDED', message: (err as any).message });
    }
    sendError(res, 500, 'Failed to build recommendations', err);
  }
});

// ─── GET /api/ai/recommendations/live ────────────────────────────────────────
// Today so far, straight from today's orders. Nothing is saved (a part-day
// snapshot would skew trends); cached 5 min. 404 until today has a sale.
// Declared before /:date so "live" is not read as a date.

const LIVE_REC_TTL = 5 * 60;

router.get('/recommendations/live', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const hotel   = await Hotel.findById(hotelId, { timezone: 1 }).lean();
    const tz      = (hotel as { timezone?: string } | null)?.timezone ?? 'Asia/Kolkata';
    const date    = todayBusinessDate(tz);
    const cacheKey = `${date}:live`;

    const cached = await getCachedRecommendations(hotelId, cacheKey);
    if (cached) return res.json(cached);

    const result = await singleFlight(`recs-live:${hotelId}:${date}`, async () => {
      const items = await liveItemsForDay(hotelId, date, tz);
      return items.length ? buildRecommendations(hotelId, date, items) : null;
    });
    if (!result) return res.status(404).json({ message: 'No sales yet today.' });

    const payload = { ...result, live: true };
    await setCachedRecommendations(hotelId, cacheKey, payload, true, LIVE_REC_TTL);
    return res.json(payload);
  } catch (err) {
    if ((err as any)?.code === 'AI_QUOTA_EXCEEDED') {
      return res.status(429).json({ code: 'AI_QUOTA_EXCEEDED', message: (err as any).message });
    }
    sendError(res, 500, 'Failed to build live recommendations', err);
  }
});

// ─── GET /api/ai/recommendations/:date ───────────────────────────────────────
// Past-day recommendation set — reads from DailySnapshot.
// Cached 48h in Redis.

router.get('/recommendations/:date', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { date } = req.params;

    const err = validateDate(date);
    if (err) return res.status(400).json({ message: err });

    const cached = await getCachedRecommendations(hotelId, date);
    if (cached) return res.json(cached);

    // A past day whose nightly summary was missed — build it from that day's orders
    await catchUpSnapshot(hotelId, date);

    const result = await singleFlight(`recs:${hotelId}:${date}`, () => buildRecommendations(hotelId, date));
    if (!result) {
      return res.status(404).json({ message: `No snapshot data found for ${date}.` });
    }

    const isToday = date === todayUTC();
    await setCachedRecommendations(hotelId, date, result, isToday);
    return res.json(result);
  } catch (err) {
    if ((err as any)?.code === 'AI_QUOTA_EXCEEDED') {
      return res.status(429).json({ code: 'AI_QUOTA_EXCEEDED', message: (err as any).message });
    }
    sendError(res, 500, 'Failed to build recommendations', err);
  }
});

// ─── PATCH /api/ai/alerts/:id/read ───────────────────────────────────────────
router.patch('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = new mongoose.Types.ObjectId(req.hotelId!);
    const alertId  = req.params.id;
    if (!/^[0-9a-fA-F]{24}$/.test(alertId)) {
      return res.status(400).json({ message: 'Invalid alert ID' });
    }
    const updated = await Alert.findOneAndUpdate(
      { _id: alertId, hotelId },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true },
    );
    if (!updated) return res.status(404).json({ message: 'Alert not found' });
    return res.json({ success: true, alert: updated });
  } catch (err) {
    sendError(res, 500, 'Failed to mark alert as read', err);
  }
});

export default router;
