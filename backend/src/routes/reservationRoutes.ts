import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Reservation, { parseTimeToMinutes } from '../models/Reservation';
import CustomerProfile from '../models/CustomerProfile';
import Table from '../models/Table';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { sendError } from '../utils/sendError';
import { logAudit } from '../utils/audit';
import { getMessagingProvider } from '../services/messagingProvider';
import { makeRateLimiter } from '../utils/rateLimiter';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('reservations'));

// ── State machine ─────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['arrived', 'cancelled', 'no_show'],
  arrived:   ['seated', 'cancelled'],
  seated:    ['completed'],
  completed: [],
  cancelled: [],
  no_show:   [],
};

const TERMINAL = new Set(['completed', 'cancelled', 'no_show']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end   = new Date(d); end.setHours(23, 59, 59, 999);
  return { start, end };
}

function parseDateStr(s: string): Date | null {
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function hasOverlap(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

async function checkConflict(
  hotelId: string,
  tableId: mongoose.Types.ObjectId,
  dateObj: Date,
  startMins: number,
  duration: number,
  excludeId?: string,
  session?: mongoose.ClientSession,
): Promise<boolean> {
  const { start, end } = dayBounds(dateObj);
  const query: Record<string, any> = {
    hotelId,
    tableId,
    date: { $gte: start, $lte: end },
    status: { $nin: ['cancelled', 'no_show'] },
  };
  if (excludeId) query._id = { $ne: new mongoose.Types.ObjectId(excludeId) };

  const opts = session ? { session } : {};
  const existing = await Reservation
    .find(query, 'startMinutes durationMinutes time', opts)
    .lean();

  for (const ex of existing) {
    const exStart = typeof ex.startMinutes === 'number' ? ex.startMinutes : parseTimeToMinutes(ex.time);
    const exDur   = typeof ex.durationMinutes === 'number' ? ex.durationMinutes : 90;
    if (hasOverlap(startMins, duration, exStart, exDur)) return true;
  }
  return false;
}

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, any> = { hotelId: req.hotelId };

    if (req.query.date) {
      const d = parseDateStr(req.query.date as string);
      if (!d) return res.status(400).json({ message: 'Invalid date' });
      const { start, end } = dayBounds(d);
      filter.date = { $gte: start, $lte: end };
    }

    if (req.query.status) {
      filter.status = { $in: (req.query.status as string).split(',').filter(Boolean) };
    }

    if (req.query.tableId && mongoose.Types.ObjectId.isValid(req.query.tableId as string)) {
      filter.tableId = new mongoose.Types.ObjectId(req.query.tableId as string);
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip  = Math.max(parseInt(req.query.skip  as string) || 0, 0);

    const [reservations, total] = await Promise.all([
      Reservation.find(filter).sort({ date: 1, startMinutes: 1, time: 1 }).skip(skip).limit(limit),
      Reservation.countDocuments(filter),
    ]);

    res.json({ reservations, total, limit, skip });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch reservations', err);
  }
});

// ── GET /stats ────────────────────────────────────────────────────────────────

router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, any> = { hotelId: req.hotelId };
    if (req.query.date) {
      const d = parseDateStr(req.query.date as string);
      if (d) {
        const { start, end } = dayBounds(d);
        filter.date = { $gte: start, $lte: end };
      }
    }

    const agg = await Reservation.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const stats: Record<string, number> = {
      pending: 0, confirmed: 0, arrived: 0, seated: 0,
      completed: 0, cancelled: 0, no_show: 0,
    };
    for (const { _id, count } of agg) stats[_id as string] = count;
    res.json(stats);
  } catch (err) {
    sendError(res, 500, 'Failed to fetch stats', err);
  }
});

// ── GET /availability ─────────────────────────────────────────────────────────

router.get('/availability', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.query.date) return res.status(400).json({ message: 'date required' });
    const d = parseDateStr(req.query.date as string);
    if (!d) return res.status(400).json({ message: 'Invalid date' });

    const { start, end } = dayBounds(d);
    const taken = await Reservation.find({
      hotelId: req.hotelId,
      date: { $gte: start, $lte: end },
      status: { $nin: ['cancelled', 'no_show'] },
      tableId: { $ne: null },
    }).select('tableId tableNumber time startMinutes durationMinutes status customerName partySize').lean();

    res.json({ taken });
  } catch (err) {
    sendError(res, 500, 'Failed to check availability', err);
  }
});

// ── POST / — create reservation ───────────────────────────────────────────────

const createLimiter = makeRateLimiter({ windowMs: 60_000, max: 30 });

router.post('/', createLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const {
      customerName, phone, email = '', partySize,
      date: dateStr, time,
      tableNumber, tableId: tableIdRaw,
      notes = '', occasion = '', source = 'phone',
      durationMinutes: durRaw = 90,
      depositAmount = 0, depositStatus = 'none',
    } = req.body as Record<string, any>;

    if (!customerName?.trim()) return res.status(400).json({ message: 'customerName is required' });
    if (!phone?.trim())        return res.status(400).json({ message: 'phone is required' });
    if (!partySize || partySize < 1) return res.status(400).json({ message: 'partySize must be ≥ 1' });
    if (!dateStr)              return res.status(400).json({ message: 'date is required' });
    if (!time)                 return res.status(400).json({ message: 'time is required' });

    const dateObj = parseDateStr(dateStr);
    if (!dateObj) return res.status(400).json({ message: 'Invalid date' });

    const startMins = parseTimeToMinutes(time);
    const duration  = Math.max(15, Math.min(480, parseInt(durRaw) || 90));

    let tableId: mongoose.Types.ObjectId | null = null;
    if (tableIdRaw && mongoose.Types.ObjectId.isValid(tableIdRaw)) {
      tableId = new mongoose.Types.ObjectId(tableIdRaw);
    }

    // Atomic double-booking check
    if (tableId) {
      const sess = await mongoose.startSession();
      let conflict = false;
      try {
        await sess.withTransaction(async () => {
          conflict = await checkConflict(req.hotelId!, tableId!, dateObj, startMins, duration, undefined, sess);
        });
      } finally {
        await sess.endSession();
      }
      if (conflict) return res.status(409).json({ message: 'Table already has a reservation in that time window' });
    }

    // Auto-link customer by phone
    let customerId: mongoose.Types.ObjectId | null = null;
    try {
      const cust = await CustomerProfile.findOne(
        { hotelId: req.hotelId, phone: phone.trim() },
        '_id',
      ).lean();
      if (cust) customerId = cust._id as mongoose.Types.ObjectId;
    } catch { /* best-effort link */ }

    const reservation = await Reservation.create({
      hotelId:      req.hotelId,
      customerName: customerName.trim(),
      phone:        phone.trim(),
      email:        email?.trim() || '',
      partySize:    parseInt(partySize),
      date:         dateObj,
      time,
      startMinutes: startMins,
      durationMinutes: duration,
      tableId,
      tableNumber:  tableNumber ? parseInt(tableNumber) : null,
      customerId,
      notes:        String(notes).trim(),
      occasion:     String(occasion).trim(),
      source,
      depositAmount: parseFloat(depositAmount) || 0,
      depositStatus,
      status: 'pending',
    });

    logAudit(req, 'reservation.create', 'Reservation', reservation._id.toString(), {
      customerName: reservation.customerName,
      date: dateStr,
      time,
      partySize,
    });

    res.status(201).json(reservation);
  } catch (err) {
    sendError(res, 400, 'Failed to create reservation', err);
  }
});

// ── PATCH /:id/status ─────────────────────────────────────────────────────────

router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const { status: newStatus, cancellationReason } = req.body as Record<string, string>;

    if (!newStatus) return res.status(400).json({ message: 'status is required' });

    const r = await Reservation.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!r) return res.status(404).json({ message: 'Reservation not found' });

    if (TERMINAL.has(r.status)) {
      return res.status(409).json({ message: `Reservation is already ${r.status}` });
    }

    const allowed = VALID_TRANSITIONS[r.status] ?? [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({
        message: `Cannot transition from '${r.status}' to '${newStatus}'. Allowed: ${allowed.join(', ') || 'none'}`,
      });
    }

    const now = new Date();
    const prevStatus = r.status;

    r.set('status', newStatus);
    if (newStatus === 'confirmed')  r.set('confirmedAt', now);
    if (newStatus === 'arrived')    r.set('arrivedAt', now);
    if (newStatus === 'cancelled') {
      r.set('cancelledAt', now);
      r.set('cancelledBy', req.cashierId || req.waiterId || req.hotelId || '');
      if (cancellationReason) r.set('cancellationReason', String(cancellationReason));
    }
    if (newStatus === 'no_show') r.set('noShowAt', now);

    await r.save();

    // Table sync: arrived → seated sets table to occupied
    if (newStatus === 'seated' && r.tableId) {
      Table.findOneAndUpdate(
        { _id: r.tableId, hotelId: req.hotelId, status: { $in: ['available', 'reserved'] } },
        { status: 'occupied' },
      ).catch(() => {});
    }

    logAudit(req, `reservation.status.${newStatus}`, 'Reservation', r._id.toString(), {
      from: prevStatus,
      to:   newStatus,
      customerName: r.customerName,
      ...(cancellationReason ? { cancellationReason } : {}),
    });

    // Confirmation SMS — best-effort, never blocks response
    if (newStatus === 'confirmed' && r.phone) {
      void (async () => {
        try {
          const provider = await getMessagingProvider(req.hotelId!, 'sms');
          if (provider.name !== 'none') {
            const dateFmt = r.date.toLocaleDateString('en-IN', {
              weekday: 'short', day: '2-digit', month: 'short',
            });
            await provider.sendMessages(r._id.toString(), 'sms', [{
              phone:   r.phone,
              message: `Hi ${r.customerName}, your reservation on ${dateFmt} at ${r.time} for ${r.partySize} guest(s) is confirmed. See you soon!`,
            }]);
          }
        } catch { /* best-effort */ }
      })();
    }

    res.json(r);
  } catch (err) {
    sendError(res, 500, 'Failed to update reservation status', err);
  }
});

// ── PUT /:id — full update ────────────────────────────────────────────────────

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const r = await Reservation.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!r) return res.status(404).json({ message: 'Reservation not found' });
    if (TERMINAL.has(r.status)) {
      return res.status(409).json({ message: `Cannot edit a ${r.status} reservation` });
    }

    const {
      customerName, phone, email, partySize,
      date: dateStr, time,
      tableNumber, tableId: tableIdRaw,
      notes, occasion, source,
      durationMinutes: durRaw, depositAmount, depositStatus,
    } = req.body as Record<string, any>;

    const newDate     = dateStr ? parseDateStr(dateStr) : r.date;
    if (!newDate) return res.status(400).json({ message: 'Invalid date' });

    const newTime     = time !== undefined ? time : r.time;
    const newDuration = durRaw !== undefined
      ? Math.max(15, Math.min(480, parseInt(durRaw) || r.durationMinutes))
      : r.durationMinutes;
    const newStartMins = parseTimeToMinutes(newTime);

    let newTableId: mongoose.Types.ObjectId | null = r.tableId ?? null;
    if (tableIdRaw !== undefined) {
      newTableId = tableIdRaw && mongoose.Types.ObjectId.isValid(tableIdRaw)
        ? new mongoose.Types.ObjectId(tableIdRaw)
        : null;
    }

    // Conflict check when table or time/date changed
    const tableChanged = newTableId?.toString() !== r.tableId?.toString();
    const timeChanged  = newTime !== r.time || dateStr !== undefined;

    if (newTableId && (tableChanged || timeChanged)) {
      const sess = await mongoose.startSession();
      let conflict = false;
      try {
        await sess.withTransaction(async () => {
          conflict = await checkConflict(
            req.hotelId!, newTableId!, newDate, newStartMins, newDuration,
            r._id.toString(), sess,
          );
        });
      } finally {
        await sess.endSession();
      }
      if (conflict) return res.status(409).json({ message: 'Table already has a reservation in that time window' });
    }

    if (customerName?.trim()) r.set('customerName', customerName.trim());
    if (phone?.trim()) {
      r.set('phone', phone.trim());
      // Re-link customer if phone changed
      try {
        const cust = await CustomerProfile.findOne(
          { hotelId: req.hotelId, phone: phone.trim() }, '_id',
        ).lean();
        r.set('customerId', cust ? cust._id : null);
      } catch { /* best-effort */ }
    }
    if (email !== undefined) r.set('email', email?.trim() || '');
    if (partySize)           r.set('partySize', parseInt(partySize));
    r.set('date', newDate);
    r.set('time', newTime);
    r.set('startMinutes', newStartMins);
    r.set('durationMinutes', newDuration);
    r.set('tableId', newTableId ?? null);
    if (tableNumber !== undefined) r.set('tableNumber', tableNumber ? parseInt(tableNumber) : null);
    if (notes !== undefined)       r.set('notes', String(notes).trim());
    if (occasion !== undefined)    r.set('occasion', String(occasion).trim());
    if (source !== undefined)      r.set('source', source);
    if (depositAmount !== undefined) r.set('depositAmount', parseFloat(depositAmount) || 0);
    if (depositStatus !== undefined) r.set('depositStatus', depositStatus);

    await r.save();
    logAudit(req, 'reservation.update', 'Reservation', r._id.toString(), { fields: Object.keys(req.body) });

    res.json(r);
  } catch (err) {
    sendError(res, 400, 'Failed to update reservation', err);
  }
});

// ── DELETE /:id — soft-cancel or ?hard=1 for physical delete ─────────────────

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const r = await Reservation.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!r) return res.status(404).json({ message: 'Reservation not found' });

    if (req.query.hard === '1') {
      await r.deleteOne();
      logAudit(req, 'reservation.delete', 'Reservation', r._id.toString(), { customerName: r.customerName });
      return res.json({ message: 'Deleted' });
    }

    // Soft-cancel
    if (!TERMINAL.has(r.status)) {
      r.set('status', 'cancelled');
      r.set('cancelledAt', new Date());
      r.set('cancelledBy', req.cashierId || req.waiterId || req.hotelId || '');
      await r.save();
    }
    logAudit(req, 'reservation.cancel', 'Reservation', r._id.toString(), { customerName: r.customerName });
    res.json(r);
  } catch (err) {
    sendError(res, 500, 'Failed to delete reservation', err);
  }
});

export default router;
