import { Router, Response } from 'express';
import AuditLog from '../models/AuditLog';
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
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from as string);
      if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to   as string);
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
