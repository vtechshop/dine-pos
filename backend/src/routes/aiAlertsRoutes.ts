import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { computeAlerts } from '../services/alertEngine';
import { buildRecommendations } from '../services/recommendationEngine';
import {
  getCachedAlerts,
  setCachedAlerts,
  getCachedRecommendations,
  setCachedRecommendations,
} from '../utils/alertCache';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateDate(date: string): string | null {
  if (!DATE_RE.test(date)) return 'date must be YYYY-MM-DD';
  if (date > todayUTC())   return 'date cannot be in the future';
  return null;
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

    const result = await computeAlerts(hotelId, date);
    if (!result) {
      return res.status(404).json({ message: 'No metrics data available for today yet.' });
    }

    await setCachedAlerts(hotelId, date, result, true);
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to compute smart alerts', err);
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

    const result = await computeAlerts(hotelId, date);
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
    const hotelId = req.hotelId!;
    const date    = todayUTC();

    const cached = await getCachedRecommendations(hotelId, date);
    if (cached) return res.json(cached);

    const result = await buildRecommendations(hotelId, date);
    if (!result) {
      return res.status(404).json({
        message: 'No daily snapshot available for today. Recommendations require a completed snapshot.',
      });
    }

    await setCachedRecommendations(hotelId, date, result, true);
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to build recommendations', err);
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

    const result = await buildRecommendations(hotelId, date);
    if (!result) {
      return res.status(404).json({ message: `No snapshot data found for ${date}.` });
    }

    const isToday = date === todayUTC();
    await setCachedRecommendations(hotelId, date, result, isToday);
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to build recommendations', err);
  }
});

export default router;
