import { Router, Response } from 'express';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { buildDailyReport } from '../services/dailyReport';
import { buildExecutiveDashboard } from '../services/executiveDashboard';
import { sendError } from '../utils/sendError';
import { requireAiQuota } from '../utils/aiUsageTracker';

const router = Router();
router.use(authMiddleware);
router.use(requireFeature('ai'));
router.use(requireAdmin);

// ─── GET /api/ai/report/:date ─────────────────────────────────────────────────
// Returns the AI-enhanced daily business report for a completed day.
// Includes: DailySnapshot KPIs, restaurant health score, Gemini narrative.
// Gemini response is cached in Redis (7d for past dates, 1h for today).
// If Gemini is unavailable, returns snapshot + health without narrative.

router.get('/report/:date', requireAiQuota('report'), async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
    }

    const today = new Date().toISOString().slice(0, 10);
    if (date > today) {
      return res.status(400).json({ message: 'date cannot be in the future' });
    }

    const report = await buildDailyReport(hotelId, date);

    if (!report) {
      return res.status(404).json({
        message: `No daily snapshot for ${date}. The nightly job runs at 0:00–3:59 UTC.`,
      });
    }

    return res.json(report);
  } catch (err) {
    sendError(res, 500, 'Failed to build daily report', err);
  }
});

// ─── GET /api/ai/dashboard ────────────────────────────────────────────────────
// Returns the executive dashboard: today's live metrics + 7-day trend +
// rolling week comparison + latest health score.
// Today's metrics come from Redis hot cache; fallback is HourlyMetrics aggregate.

router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const dashboard = await buildExecutiveDashboard(hotelId);
    return res.json(dashboard);
  } catch (err) {
    sendError(res, 500, 'Failed to build executive dashboard', err);
  }
});

export default router;
