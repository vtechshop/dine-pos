import { Router, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { TallyConfig } from '../models/TallyConfig';
import { TallySyncJob } from '../models/TallySyncJob';
import { encrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

const router = Router();

router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('tally'));

// GET /api/integrations/tally/config
router.get('/config', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cfg = await TallyConfig.findOne({
      hotelId: new mongoose.Types.ObjectId(req.hotelId!),
    }).lean();

    if (!cfg) {
      res.json({
        enabled: false,
        companyName: '',
        connectorTokenSet: false,
        connectorLastSeenAt: null,
        ledgerMap: {},
        syncSales: true,
        syncPurchases: true,
        syncExpenses: true,
        syncCancellations: true,
      });
      return;
    }

    const { connectorToken: _removed, ...safe } = cfg as any;
    res.json({ ...safe, connectorTokenSet: !!(cfg.connectorToken) });
  } catch (e) {
    logger.error('[tally] GET config error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/integrations/tally/config
router.put('/config', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { enabled, companyName, ledgerMap, syncSales, syncPurchases, syncExpenses, syncCancellations } = req.body;

    const update: Record<string, unknown> = {};
    if (enabled          !== undefined) update.enabled          = Boolean(enabled);
    if (companyName      !== undefined) update.companyName      = String(companyName).trim().slice(0, 200);
    if (syncSales        !== undefined) update.syncSales        = Boolean(syncSales);
    if (syncPurchases    !== undefined) update.syncPurchases    = Boolean(syncPurchases);
    if (syncExpenses     !== undefined) update.syncExpenses     = Boolean(syncExpenses);
    if (syncCancellations !== undefined) update.syncCancellations = Boolean(syncCancellations);
    if (ledgerMap && typeof ledgerMap === 'object') {
      const LEDGER_FIELDS = [
        'salesLedger', 'cgstLedger', 'sgstLedger', 'cashLedger', 'bankLedger',
        'discountLedger', 'roundOffLedger', 'expenseLedger', 'purchaseLedger',
        'stockInHandLedger', 'walletLedger',
      ] as const;
      for (const f of LEDGER_FIELDS) {
        if (typeof (ledgerMap as any)[f] === 'string') {
          update[`ledgerMap.${f}`] = String((ledgerMap as any)[f]).trim().slice(0, 200);
        }
      }
    }

    const cfg = await TallyConfig.findOneAndUpdate(
      { hotelId: new mongoose.Types.ObjectId(req.hotelId!) },
      { $set: update },
      { upsert: true, new: true },
    ).lean();

    const { connectorToken: _removed, ...safe } = cfg as any;
    res.json({ ...safe, connectorTokenSet: !!(cfg!.connectorToken) });
  } catch (e) {
    logger.error('[tally] PUT config error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/integrations/tally/connector-token — generate new connector token
router.post('/connector-token', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const encrypted  = encrypt(plainToken);

    await TallyConfig.findOneAndUpdate(
      { hotelId: new mongoose.Types.ObjectId(req.hotelId!) },
      { $set: { connectorToken: encrypted } },
      { upsert: true },
    );

    // Return plaintext ONCE — it is never returned again after this response
    res.json({
      token: plainToken,
      message: 'Copy this token and configure it in your Tally Bridge Connector. It will not be shown again.',
    });
  } catch (e) {
    logger.error('[tally] connector-token error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/integrations/tally/jobs — sync history with pagination
router.get('/jobs', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, entityType, page = '1', limit = '50' } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const filter: Record<string, unknown> = { hotelId: new mongoose.Types.ObjectId(req.hotelId!) };
    const VALID_STATUSES = new Set(['pending', 'syncing', 'synced', 'failed', 'skipped']);
    if (status && VALID_STATUSES.has(status)) filter.status = status;
    const VALID_ENTITY_TYPES = new Set(['order', 'cancellation', 'purchase_invoice', 'expense']);
    if (entityType && VALID_ENTITY_TYPES.has(entityType)) filter.entityType = entityType;

    const [jobs, total] = await Promise.all([
      TallySyncJob.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      TallySyncJob.countDocuments(filter),
    ]);

    res.json({ jobs, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (e) {
    logger.error('[tally] GET jobs error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/integrations/tally/jobs/:id/retry
router.post('/jobs/:id/retry', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const job = await TallySyncJob.findOne({
      _id:     req.params.id,
      hotelId: new mongoose.Types.ObjectId(req.hotelId!),
    });
    if (!job) {
      res.status(404).json({ message: 'Job not found' });
      return;
    }
    if (job.status !== 'failed') {
      res.status(400).json({ message: 'Only failed jobs can be retried manually' });
      return;
    }

    job.status        = 'pending';
    job.nextAttemptAt = null;
    job.errorCode     = '';
    job.errorReason   = '';
    await job.save();

    res.json({ message: 'Job queued for retry', job });
  } catch (e) {
    logger.error('[tally] retry job error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/integrations/tally/stats — counts by status
router.get('/stats', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const agg = await TallySyncJob.aggregate([
      { $match: { hotelId: new mongoose.Types.ObjectId(req.hotelId!) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const stats: Record<string, number> = {};
    for (const row of agg) stats[String(row._id)] = row.count;
    res.json(stats);
  } catch (e) {
    logger.error('[tally] GET stats error', { hotelId: req.hotelId, err: String(e) });
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
