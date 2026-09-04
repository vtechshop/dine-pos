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

// D-15: Allowed transitions — prevents impossible state jumps.
// 'expired' is a system-only terminal state reached by the expiry worker, not via PATCH.
const VALID_TRANSITIONS: Record<string, string[]> = {
  waiting:  ['notified', 'cancelled', 'expired'],
  notified: ['waiting', 'seated', 'cancelled', 'expired'],
};

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

    // D-15: Use the explicit transition table, not just an allowlist
    const staffAllowed = ['waiting', 'notified', 'seated', 'cancelled'];
    if (!staffAllowed.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Allowed: ${staffAllowed.join(', ')}` });
    }

    // Snapshot the current entry to validate the transition
    const existing = await Waitlist.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!existing) return res.status(404).json({ message: 'Waitlist entry not found' });
    if (TERMINAL.has(existing.status)) {
      return res.status(409).json({ message: `Entry is already ${existing.status}` });
    }

    const allowedNext = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowedNext.includes(status)) {
      return res.status(409).json({
        message: `Cannot transition from '${existing.status}' to '${status}'. Allowed: ${allowedNext.filter(s => staffAllowed.includes(s)).join(', ') || 'none'}`,
      });
    }

    // D-15: Atomic conditional update — guards against concurrent PATCH races
    const extraUpdate: Record<string, unknown> = {};
    if (status === 'notified') extraUpdate.notifiedAt = new Date();
    if (estimatedWaitMinutes !== undefined) {
      extraUpdate.estimatedWaitMinutes = parseInt(estimatedWaitMinutes) || 0;
    }

    const updated = await Waitlist.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, status: existing.status },
      { $set: { status, ...extraUpdate } },
      { new: true },
    );
    if (!updated) {
      return res.status(409).json({ message: 'Entry was modified concurrently. Please refresh and retry.' });
    }

    logAudit(req, `waitlist.${status}`, 'Waitlist', updated._id.toString(), { guestName: updated.guestName });
    res.json(updated);
  } catch (err) {
    sendError(res, 500, 'Failed to update waitlist entry', err);
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
// D-13: Soft delete — transition to 'cancelled' rather than hard-deleting the record.
// Audit history is preserved; the UI hides cancelled entries by default.

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const entry = await Waitlist.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, status: { $nin: ['seated', 'expired'] } },
      { $set: { status: 'cancelled' } },
      { new: true },
    );
    if (!entry) {
      // Either not found or already in a terminal state — do a plain check to give better message
      const exists = await Waitlist.findOne({ _id: req.params.id, hotelId: req.hotelId });
      if (!exists) return res.status(404).json({ message: 'Waitlist entry not found' });
      return res.status(409).json({ message: `Entry is already ${exists.status} and cannot be removed` });
    }
    logAudit(req, 'waitlist.cancel', 'Waitlist', entry._id.toString(), { guestName: entry.guestName });
    res.json({ message: 'Removed from waitlist', entry });
  } catch (err) {
    sendError(res, 500, 'Failed to remove from waitlist', err);
  }
});

export default router;
