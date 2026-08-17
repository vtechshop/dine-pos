import { Router, Response } from 'express';
import Waitlist from '../models/Waitlist';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { sendError } from '../utils/sendError';
import { logAudit } from '../utils/audit';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('reservations'));

const TERMINAL = new Set(['seated', 'cancelled', 'expired']);

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, any> = { hotelId: req.hotelId };
    if (req.query.status) {
      filter.status = { $in: (req.query.status as string).split(',').filter(Boolean) };
    } else {
      filter.status = { $nin: ['seated', 'cancelled', 'expired'] };
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip  = Math.max(parseInt(req.query.skip  as string) || 0, 0);

    const [entries, total] = await Promise.all([
      Waitlist.find(filter).sort({ priority: -1, createdAt: 1 }).skip(skip).limit(limit),
      Waitlist.countDocuments(filter),
    ]);

    res.json({ entries, total, limit, skip });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch waitlist', err);
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      guestName, phone, partySize,
      seatingPreference = '', notes = '',
      estimatedWaitMinutes = 0,
    } = req.body as Record<string, any>;

    if (!guestName?.trim()) return res.status(400).json({ message: 'guestName is required' });
    if (!phone?.trim())     return res.status(400).json({ message: 'phone is required' });
    if (!partySize || partySize < 1) return res.status(400).json({ message: 'partySize must be ≥ 1' });

    const entry = await Waitlist.create({
      hotelId:              req.hotelId,
      guestName:            guestName.trim(),
      phone:                phone.trim(),
      partySize:            parseInt(partySize),
      seatingPreference:    String(seatingPreference).trim(),
      notes:                String(notes).trim(),
      estimatedWaitMinutes: parseInt(estimatedWaitMinutes) || 0,
    });

    logAudit(req, 'waitlist.add', 'Waitlist', entry._id.toString(), { guestName: entry.guestName });
    res.status(201).json(entry);
  } catch (err) {
    sendError(res, 400, 'Failed to add to waitlist', err);
  }
});

// ── PATCH /:id/status ─────────────────────────────────────────────────────────

router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const { status, estimatedWaitMinutes } = req.body as Record<string, any>;
    const allowed = ['waiting', 'notified', 'seated', 'cancelled', 'expired'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });

    const entry = await Waitlist.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!entry) return res.status(404).json({ message: 'Waitlist entry not found' });
    if (TERMINAL.has(entry.status)) {
      return res.status(409).json({ message: `Entry is already ${entry.status}` });
    }

    entry.set('status', status);
    if (status === 'notified') entry.set('notifiedAt', new Date());
    if (estimatedWaitMinutes !== undefined) {
      entry.set('estimatedWaitMinutes', parseInt(estimatedWaitMinutes) || 0);
    }

    await entry.save();
    logAudit(req, `waitlist.${status}`, 'Waitlist', entry._id.toString(), { guestName: entry.guestName });
    res.json(entry);
  } catch (err) {
    sendError(res, 500, 'Failed to update waitlist entry', err);
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const entry = await Waitlist.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!entry) return res.status(404).json({ message: 'Waitlist entry not found' });
    logAudit(req, 'waitlist.delete', 'Waitlist', entry._id.toString(), { guestName: entry.guestName });
    res.json({ message: 'Removed from waitlist' });
  } catch (err) {
    sendError(res, 500, 'Failed to remove from waitlist', err);
  }
});

export default router;
