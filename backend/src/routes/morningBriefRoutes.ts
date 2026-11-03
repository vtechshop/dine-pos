import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import MorningBrief from '../models/MorningBrief';
import { buildMorningBrief } from '../services/morningBriefBuilder';
import {
  getCachedBrief, setCachedBrief, getCachedLatestBrief, invalidateBriefCache,
} from '../utils/morningBriefCache';
import { sendError } from '../utils/sendError';
import { requireAiQuota } from '../utils/aiUsageTracker';
import DailySnapshot from '../models/DailySnapshot';
import { catchUpSnapshot, hotelYesterday } from '../utils/ensureDailySnapshot';
import { singleFlight } from '../utils/singleFlight';
import { logger } from '../utils/logger';

const router = Router();

// ─── Catch-up for a missed brief ──────────────────────────────────────────────
// Briefs are built overnight from yesterday's DailySnapshot. If that slot was
// missed, build yesterday's summary + brief when someone opens it. One try per
// hotel/day every 30 min, so a Gemini outage can't make every page load retry.
const BRIEF_RETRY_MS = 30 * 60_000;
const briefTriedAt   = new Map<string, number>();

async function fillYesterdayBrief(hotelId: string): Promise<void> {
  try {
    const { yesterday } = await hotelYesterday(hotelId);
    const key = hotelId + ':' + yesterday;
    if (Date.now() - (briefTriedAt.get(key) ?? 0) < BRIEF_RETRY_MS) return;
    const hid = new mongoose.Types.ObjectId(hotelId);
    if (await MorningBrief.exists({ hotelId: hid, date: yesterday })) return;
    briefTriedAt.set(key, Date.now());

    await catchUpSnapshot(hotelId, yesterday);
    if (!(await DailySnapshot.exists({ hotelId: hid, date: yesterday }))) return; // no sales yesterday
    const ok = await singleFlight('brief-fill:' + key, () => buildMorningBrief(hotelId, yesterday));
    if (ok) await invalidateBriefCache(hotelId, yesterday);
  } catch (err) {
    logger.warn('[morningBrief] catch-up failed', { hotelId, err: String(err) });
  }
}
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('ai'));

// ─── GET /api/ai/morning-brief ────────────────────────────────────────────────
// Returns the latest available morning brief (most recent date).

router.get('/morning-brief', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;

    // Missed overnight? Build it now — wait up to 8 s, then let it finish in the background
    await Promise.race([fillYesterdayBrief(hotelId), new Promise(r => setTimeout(r, 8_000))]);

    const cached = await getCachedLatestBrief(hotelId);
    if (cached) return res.json(cached);

    const hotelOId = new mongoose.Types.ObjectId(hotelId);
    const brief = await MorningBrief.findOne(
      { hotelId: hotelOId },
    ).sort({ date: -1 }).lean();

    if (!brief) {
      return res.status(202).json({
        message: 'No morning brief generated yet. Briefs are generated daily at UTC 04:00–05:59.',
        available: false,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    await setCachedBrief(hotelId, brief.date, brief, brief.date === today);
    return res.json(brief);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch morning brief', err);
  }
});

// ─── GET /api/ai/morning-brief/:date ─────────────────────────────────────────
// Returns the morning brief for a specific date (YYYY-MM-DD).
// Date must be in the past; today's brief may not exist yet.

router.get('/morning-brief/:date', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = req.hotelId!;
    const { date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (date > today) {
      return res.status(400).json({ message: 'Cannot retrieve a brief for a future date.' });
    }

    const cached = await getCachedBrief(hotelId, date);
    if (cached) return res.json(cached);

    const hotelOId = new mongoose.Types.ObjectId(hotelId);
    const brief = await MorningBrief.findOne({ hotelId: hotelOId, date }).lean();

    if (!brief) {
      return res.status(404).json({
        message: `No morning brief found for ${date}. Briefs are generated automatically once daily.`,
        date,
      });
    }

    await setCachedBrief(hotelId, date, brief, date === today);
    return res.json(brief);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch morning brief', err);
  }
});

// ─── GET /api/ai/morning-brief/history ───────────────────────────────────────
// Returns a paginated list of past morning briefs (metadata only, not full content).

router.get('/morning-brief-history', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId  = req.hotelId!;
    const hotelOId = new mongoose.Types.ObjectId(hotelId);
    const limit    = Math.min(Math.max(1, parseInt(String(req.query.limit ?? '30'), 10) || 30), 90);
    const skip     = Math.max(0, parseInt(String(req.query.skip  ?? '0'),  10) || 0);

    const [briefs, total] = await Promise.all([
      MorningBrief.find(
        { hotelId: hotelOId },
        {
          date: 1, generatedAt: 1,
          'business.revenue': 1, 'business.orders': 1,
          'business.healthScore': 1, 'business.healthGrade': 1,
          'business.topSellingItem': 1,
          executiveSummary: 1,
          warning: 1,
        },
      ).sort({ date: -1 }).skip(skip).limit(limit).lean(),
      MorningBrief.countDocuments({ hotelId: hotelOId }),
    ]);

    return res.json({ briefs, total, limit, skip });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch brief history', err);
  }
});

// ─── POST /api/ai/morning-brief/regenerate ───────────────────────────────────
// Force-regenerate the morning brief for a specific date (admin only).
// Useful when data was corrected after the scheduled run.
// Body: { date?: string } — defaults to yesterday if omitted.

router.post('/morning-brief/regenerate', requireAiQuota('report'), async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    let { date }  = req.body as { date?: string };

    if (!date) {
      const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
      date = d.toISOString().slice(0, 10);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (date >= today) {
      return res.status(400).json({ message: 'Can only regenerate briefs for past dates.' });
    }

    // Force regeneration: delete existing so idempotency check passes
    const hotelOId = new mongoose.Types.ObjectId(hotelId);
    await MorningBrief.deleteOne({ hotelId: hotelOId, date });
    await invalidateBriefCache(hotelId, date);

    const ok = await buildMorningBrief(hotelId, date);
    if (!ok) {
      return res.status(404).json({
        message: `No DailySnapshot found for ${date}. Ensure the date has been processed.`,
        date,
      });
    }

    const brief = await MorningBrief.findOne({ hotelId: hotelOId, date }).lean();
    if (brief) {
      await setCachedBrief(hotelId, date, brief, false);
    }

    return res.status(201).json({ success: true, date, brief });
  } catch (err) {
    sendError(res, 500, 'Failed to regenerate morning brief', err);
  }
});

export default router;
