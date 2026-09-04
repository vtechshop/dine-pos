import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Reservation, { parseTimeToMinutes } from '../models/Reservation';
import CustomerProfile from '../models/CustomerProfile';
import Table from '../models/Table';
import TableSession from '../models/TableSession';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { sendError } from '../utils/sendError';
import { logAudit } from '../utils/audit';
import { getMessagingProvider } from '../services/messagingProvider';
import { makeRateLimiter } from '../utils/rateLimiter';
import { startOfBusinessDay, endOfBusinessDay, toBusinessDate } from '../utils/businessDate';

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

// D-05: Use IST (Asia/Kolkata) for day boundaries so reservations near midnight
// are bucketed to the correct business date regardless of server timezone.
function dayBounds(dateStr: string, tz = 'Asia/Kolkata'): { start: Date; end: Date } {
  return {
    start: startOfBusinessDay(dateStr, tz),
    end:   endOfBusinessDay(dateStr, tz),
  };
}

function parseDateStr(s: string): Date | null {
  // Validate YYYY-MM-DD format before parsing to avoid silent coercions
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

// Canonical time regex matching the Reservation model's parseTimeToMinutes format
const TIME_RE = /^(1[0-2]|0?[1-9]):[0-5]\d\s*(AM|PM)$/i;

// Phone: accept 10–15 digits after stripping non-digit characters
function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function hasOverlap(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

async function checkConflict(
  hotelId: string,
  tableId: mongoose.Types.ObjectId,
  dateStr: string,
  startMins: number,
  duration: number,
  excludeId?: string,
  session?: mongoose.ClientSession,
): Promise<boolean> {
  const { start, end } = dayBounds(dateStr);
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
      const { start, end } = dayBounds(req.query.date as string);
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
        const { start, end } = dayBounds(req.query.date as string);
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

    const { start, end } = dayBounds(req.query.date as string);
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
    // D-07: reject clearly malformed phone numbers (less than 10 or more than 15 digits)
    if (!isValidPhone(String(phone))) return res.status(400).json({ message: 'phone must contain 10–15 digits' });
    if (!partySize || partySize < 1) return res.status(400).json({ message: 'partySize must be ≥ 1' });
    if (!dateStr)              return res.status(400).json({ message: 'date is required' });
    if (!time)                 return res.status(400).json({ message: 'time is required' });
    // D-06: reject malformed time values that would silently become 0 (midnight) in parseTimeToMinutes
    if (!TIME_RE.test(String(time))) return res.status(400).json({ message: "time must be in h:mm AM/PM format (e.g. 7:30 PM)" });

    const dateObj = parseDateStr(dateStr);
    if (!dateObj) return res.status(400).json({ message: 'Invalid date' });

    const startMins = parseTimeToMinutes(time);
    const duration  = Math.max(15, Math.min(480, parseInt(durRaw) || 90));

    let tableId: mongoose.Types.ObjectId | null = null;
    if (tableIdRaw && mongoose.Types.ObjectId.isValid(tableIdRaw)) {
      tableId = new mongoose.Types.ObjectId(tableIdRaw);
    }

    // Auto-link customer by phone (best-effort, read-only — safe outside transaction)
    let customerId: mongoose.Types.ObjectId | null = null;
    try {
      const cust = await CustomerProfile.findOne(
        { hotelId: req.hotelId, phone: phone.trim() },
        '_id',
      ).lean();
      if (cust) customerId = cust._id as mongoose.Types.ObjectId;
    } catch { /* best-effort link */ }

    const reservationDoc = {
      hotelId:         req.hotelId,
      customerName:    customerName.trim(),
      phone:           phone.trim(),
      email:           email?.trim() || '',
      partySize:       parseInt(partySize),
      date:            dateObj,
      time,
      startMinutes:    startMins,
      durationMinutes: duration,
      tableId,
      tableNumber:     tableNumber ? parseInt(tableNumber) : null,
      customerId,
      notes:           String(notes).trim(),
      occasion:        String(occasion).trim(),
      source,
      depositAmount:   parseFloat(depositAmount) || 0,
      depositStatus,
      status:          'pending' as const,
    };

    let reservation: any;

    if (tableId) {
      // Conflict check + create are in the same transaction so no slot can be
      // taken between the two operations. E11000 from the partial unique index
      // (Sprint 1 D-01) is the final guard against concurrent duplicate writes.
      const sess = await mongoose.startSession();
      try {
        await sess.withTransaction(async () => {
          const conflict = await checkConflict(req.hotelId!, tableId!, dateStr, startMins, duration, undefined, sess);
          if (conflict) {
            const slotErr = new Error('SLOT_CONFLICT') as any;
            slotErr.isSlotConflict = true;
            throw slotErr;
          }
          [reservation] = await Reservation.create([reservationDoc], { session: sess });
        });
      } catch (txErr: any) {
        if (txErr.isSlotConflict) {
          return res.status(409).json({ message: 'Table already has a reservation in that time window' });
        }
        const errCode = txErr.code ?? txErr.cause?.code;
        if (errCode === 11000) {
          return res.status(409).json({ message: 'Reservation slot already taken (concurrent booking)' });
        }
        throw txErr;
      } finally {
        await sess.endSession();
      }
    } else {
      reservation = await Reservation.create(reservationDoc);
    }

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
    if (newStatus === 'seated')     r.set('seatedAt', now);  // D-14
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

    // D-02: Restore table on terminal transitions (completed/cancelled/no_show).
    // Guard: skip if an open TableSession currently holds the table — session
    // close already restores the table and is the authoritative cleanup path.
    if (TERMINAL.has(newStatus) && r.tableId) {
      ;(async () => {
        try {
          const openSession = await TableSession.findOne(
            { tableId: r.tableId, hotelId: req.hotelId, status: 'open' },
            '_id',
          ).lean();
          if (!openSession) {
            await Table.findOneAndUpdate(
              { _id: r.tableId, hotelId: req.hotelId, status: { $in: ['occupied', 'reserved'] } },
              { $set: { status: 'available' } },
            );
          }
        } catch { /* best-effort — table restore must never fail the reservation save */ }
      })();
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
    // D-05: compute the date string (YYYY-MM-DD in IST) for IST-aware conflict checks
    const newDateStr  = dateStr ?? toBusinessDate(r.date, 'Asia/Kolkata');

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
            req.hotelId!, newTableId!, newDateStr, newStartMins, newDuration,
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
    const wasTerminal = TERMINAL.has(r.status);
    if (!wasTerminal) {
      r.set('status', 'cancelled');
      r.set('cancelledAt', new Date());
      r.set('cancelledBy', req.cashierId || req.waiterId || req.hotelId || '');
      await r.save();

      // D-02: restore table after soft-cancel (same guard as PATCH handler)
      if (r.tableId) {
        ;(async () => {
          try {
            const openSession = await TableSession.findOne(
              { tableId: r.tableId, hotelId: req.hotelId, status: 'open' },
              '_id',
            ).lean();
            if (!openSession) {
              await Table.findOneAndUpdate(
                { _id: r.tableId, hotelId: req.hotelId, status: { $in: ['occupied', 'reserved'] } },
                { $set: { status: 'available' } },
              );
            }
          } catch { /* best-effort */ }
        })();
      }
    }
    logAudit(req, 'reservation.cancel', 'Reservation', r._id.toString(), { customerName: r.customerName });
    res.json(r);
  } catch (err) {
    sendError(res, 500, 'Failed to delete reservation', err);
  }
});

export default router;
