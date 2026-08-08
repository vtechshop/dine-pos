import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import HourlyMetrics from '../models/HourlyMetrics';
import DailySnapshot from '../models/DailySnapshot';
import JobRegistry from '../models/JobRegistry';
import { getHotMetrics, getTopItems } from '../utils/aiMetricsCache';
import { sendError } from '../utils/sendError';

const router = Router();

// ─── SA-only middleware (mirrors superAdminRoutes.ts pattern) ─────────────────
const saAuth = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(
        header.slice(7),
        process.env.SUPER_ADMIN_JWT_SECRET!,
      ) as { role?: string };
      if (payload?.role === 'superadmin') { next(); return; }
    } catch { /* invalid / expired */ }
  }
  res.status(401).json({ message: 'Unauthorized' });
};

// ─── GET /api/ai/metrics/today ────────────────────────────────────────────────
// Returns today's running revenue + order count.
// Reads from Redis hot cache first; falls back to MongoDB hourly metrics sum.
router.get('/metrics/today', authMiddleware, requireFeature('ai'), async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;

    // 1. Try Redis hot cache
    const hot = await getHotMetrics(hotelId);
    if (hot) {
      return res.json({ source: 'cache', ...hot });
    }

    // 2. Fallback: aggregate today's hourly metrics from MongoDB
    const today = new Date().toISOString().slice(0, 10);
    const [agg]  = await HourlyMetrics.aggregate([
      { $match: { hotelId: new mongoose.Types.ObjectId(hotelId), date: today } },
      {
        $group: {
          _id:     null,
          revenue: { $sum: '$revenue' },
          orders:  { $sum: '$orderCount' },
        },
      },
    ]);

    const revenue = +(agg?.revenue ?? 0).toFixed(2);
    const orders  = agg?.orders ?? 0;

    // Also pull leaderboard from Redis (best-effort)
    const topItems = await getTopItems(hotelId, today, 10);

    return res.json({
      source:    'mongodb',
      revenue,
      orders,
      updatedAt: new Date().toISOString(),
      topItems,
    });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch today metrics', err);
  }
});

// ─── GET /api/ai/metrics/snapshot/:date ──────────────────────────────────────
// Returns the pre-built DailySnapshot for a given date (YYYY-MM-DD).
router.get('/metrics/snapshot/:date', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
    }

    const snapshot = await DailySnapshot.findOne(
      { hotelId: new mongoose.Types.ObjectId(hotelId), date },
    ).lean();

    if (!snapshot) {
      return res.status(404).json({ message: `No snapshot for ${date}` });
    }

    return res.json(snapshot);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch snapshot', err);
  }
});

// ─── GET /api/ai/jobs ─────────────────────────────────────────────────────────
// Super-admin only — returns recent job execution status for both scheduler jobs.
router.get('/jobs', saAuth, async (_req: Request, res: Response) => {
  try {
    const jobs = await JobRegistry.find().sort({ lastRunAt: -1 }).lean();
    return res.json({ jobs });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch job registry', err);
  }
});

export default router;
