import { Router, Response } from 'express';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { buildAnomalyReport } from '../services/anomalyDetector';
import { buildStaffAnalytics } from '../services/staffAnalytics';
import { buildKitchenAnalytics } from '../services/kitchenAnalytics';
import {
  getCachedAnomaly, setCachedAnomaly,
  getCachedStaff,   setCachedStaff,
  getCachedKitchen, setCachedKitchen,
} from '../utils/analyticsCache';
import { singleFlight } from '../utils/singleFlight';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// ─── GET /api/ai/analytics/anomalies ─────────────────────────────────────────
// Fraud & anomaly detection report for today.
// Baselines: last 30 DailySnapshots. Detectors: cancellation spike, payment shift,
// discount activity, off-hours orders, round-amount pattern, cancellation clustering.
// All calculations in Node.js. Gemini explains detected anomalies only.

router.get('/analytics/anomalies', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;

    const cached = await getCachedAnomaly(hotelId);
    if (cached) return res.json(cached);

    const report = await singleFlight(`anomaly:${hotelId}`, () => buildAnomalyReport(hotelId));
    if (!report) {
      return res.status(202).json({
        message: 'Insufficient historical data for anomaly detection. At least 7 days of snapshots required.',
        dataWindowDays: 0,
      });
    }

    await setCachedAnomaly(hotelId, report);
    return res.json(report);
  } catch (err) {
    sendError(res, 500, 'Failed to build anomaly report', err);
  }
});

// ─── GET /api/ai/analytics/staff ─────────────────────────────────────────────
// Staff performance analytics: per-cashier orders, revenue, AOV, cancel rate,
// discount usage, performance score vs hotel average. Last 30 days.

router.get('/analytics/staff', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;

    const cached = await getCachedStaff(hotelId);
    if (cached) return res.json(cached);

    const report = await singleFlight(`staff:${hotelId}`, () => buildStaffAnalytics(hotelId));
    if (!report) {
      return res.status(202).json({
        message: 'No staff order data found for the last 30 days.',
        activeStaff: 0,
      });
    }

    await setCachedStaff(hotelId, report);
    return res.json(report);
  } catch (err) {
    sendError(res, 500, 'Failed to build staff analytics', err);
  }
});

// ─── GET /api/ai/analytics/kitchen ───────────────────────────────────────────
// Kitchen performance analytics: fulfillment time (createdAt → completedAt),
// per-hour load, p90 latency, SLA breach rate, top items. Last 30 days.

router.get('/analytics/kitchen', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;

    const cached = await getCachedKitchen(hotelId);
    if (cached) return res.json(cached);

    const report = await singleFlight(`kitchen:${hotelId}`, () => buildKitchenAnalytics(hotelId));
    if (!report) {
      return res.status(202).json({
        message: 'No completed order fulfillment data found for the last 30 days.',
        totalOrdersAnalyzed: 0,
      });
    }

    await setCachedKitchen(hotelId, report);
    return res.json(report);
  } catch (err) {
    sendError(res, 500, 'Failed to build kitchen analytics', err);
  }
});

export default router;
