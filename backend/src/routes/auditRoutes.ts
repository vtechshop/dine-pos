import { Router, Response } from 'express';
import AuditLog from '../models/AuditLog';
import { istDay } from '../utils/financeDefinitions';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// GET /api/audit — paginated audit log for this hotel (newest first)
// Query params: action, actorRole, targetType, from (ISO date), to (ISO date), page, limit
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), 200);
    const skip  = (page - 1) * limit;

    const filter: any = { hotelId: req.hotelId };
    if (req.query.action)     filter.action     = req.query.action;
    if (req.query.actorRole)  filter.actorRole  = req.query.actorRole;
    if (req.query.targetType) filter.targetType = req.query.targetType;
    if (req.query.from || req.query.to) {
      // Phase 5 · Batch 7 (P4-RPT-08): a plain date (YYYY-MM-DD, what the page sends) is a whole IST
      // day — "To" includes that day up to 23:59:59.999. Before, To meant 00:00 UTC, so a filter
      // ending today showed nothing from today. A full timestamp is used exactly as before.
      const bound = (v: unknown, end: boolean): Date | null => {
        const str = String(v);
        const d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? istDay(str, end) : new Date(str);
        return Number.isNaN(d.getTime()) ? null : d;
      };
      const from = req.query.from ? bound(req.query.from, false) : undefined;
      const to   = req.query.to   ? bound(req.query.to, true)    : undefined;
      if (from === null || to === null) return res.status(400).json({ message: 'Invalid date. Use YYYY-MM-DD.' });
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to)   filter.createdAt.$lte = to;
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
