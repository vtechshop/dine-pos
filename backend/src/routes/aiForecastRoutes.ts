import { Router, Response } from 'express';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { buildForecast } from '../services/forecastEngine';
import { buildInventoryPrediction } from '../services/inventoryPredictor';
import {
  getCachedForecast,
  setCachedForecast,
  getCachedInventory,
  setCachedInventory,
} from '../utils/forecastCache';
import { singleFlight } from '../utils/singleFlight';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireFeature('ai'));

// ─── GET /api/ai/forecast ─────────────────────────────────────────────────────
// Full forecast dashboard: revenue (7d + 30d), orders (7d + 30d), peak hours,
// item demand, table utilization, Gemini executive brief.
// Cached 6h in Redis.

router.get('/forecast', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;

    const cached = await getCachedForecast(hotelId);
    if (cached) return res.json(cached);

    const result = await singleFlight(`forecast:${hotelId}`, () => buildForecast(hotelId));
    if (!result) {
      return res.status(404).json({
        message: 'Insufficient historical data. At least 3 days of snapshots are required to generate a forecast.',
      });
    }

    await setCachedForecast(hotelId, result);
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to build forecast', err);
  }
});

// ─── GET /api/ai/forecast/inventory ──────────────────────────────────────────
// Inventory prediction: stock levels, days remaining, reorder suggestions,
// overstock flags. Cached 4h in Redis.

router.get('/forecast/inventory', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;

    const cached = await getCachedInventory(hotelId);
    if (cached) return res.json(cached);

    const result = await singleFlight(`inventory:${hotelId}`, () => buildInventoryPrediction(hotelId));
    if (!result) {
      return res.status(404).json({
        message: 'No ingredients found. Add ingredients in inventory management to enable prediction.',
      });
    }

    await setCachedInventory(hotelId, result);
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to build inventory forecast', err);
  }
});

// ─── GET /api/ai/forecast/purchase ───────────────────────────────────────────
// Returns data-driven purchase suggestions based on current stock + thresholds.

router.get('/purchase', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { buildPurchaseSuggestions } = await import('../services/purchaseSuggestion');
    const result = await buildPurchaseSuggestions(hotelId);
    return res.json(result);
  } catch (err) {
    sendError(res, 500, 'Failed to build purchase suggestions', err);
  }
});

export default router;

