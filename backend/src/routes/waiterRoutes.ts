import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import Waiter from '../models/Waiter';
import Hotel from '../models/Hotel';
import Order from '../models/Order';
import TableSession from '../models/TableSession';
import { logAudit } from '../utils/audit';
import { validatePin } from '../utils/pinPolicy';
import { logger } from '../utils/logger';
import { toBusinessDate, todayBusinessDate, startOfBusinessDay } from '../utils/businessDate';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

const STATS_WINDOW_DAYS = 30;
const OPENED_BY_PREFIX  = 'Waiter: ';

interface TableStats { tablesToday: number; tables30d: number }

// Tables attended = distinct table visits where the waiter opened the session
// or marked an order served. Sessions and orders store the waiter's *name*
// (taken from their JWT), so renaming a waiter drops their earlier history.
async function tablesAttendedByName(hotelId: string, names: string[]): Promise<Map<string, TableStats>> {
  const hotel      = await Hotel.findById(hotelId, { timezone: 1 }).lean();
  const tz         = hotel?.timezone || 'Asia/Kolkata';
  const todayStart = startOfBusinessDay(todayBusinessDate(tz), tz);
  const since      = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [sessions, orders] = await Promise.all([
    TableSession.find(
      { hotelId, openedAt: { $gte: since }, openedBy: { $in: names.map(n => OPENED_BY_PREFIX + n) } },
      { openedBy: 1, openedAt: 1 },
    ).lean(),
    Order.find(
      { hotelId, createdAt: { $gte: since }, servedBy: { $in: names }, tableNumber: { $ne: '' } },
      { servedBy: 1, servedAt: 1, createdAt: 1, sessionId: 1, tableNumber: 1 },
    ).lean(),
  ]);

  const visits = new Map<string, { today: Set<string>; window: Set<string> }>();
  const add = (name: string, visitKey: string, at: Date) => {
    let v = visits.get(name);
    if (!v) { v = { today: new Set(), window: new Set() }; visits.set(name, v); }
    v.window.add(visitKey);
    if (at >= todayStart) v.today.add(visitKey);
  };

  for (const s of sessions) {
    add(s.openedBy.slice(OPENED_BY_PREFIX.length), String(s._id), s.openedAt);
  }
  for (const o of orders) {
    const at = o.servedAt ?? o.createdAt;
    // Without table sessions, count each table once per business day.
    const visitKey = o.sessionId ? String(o.sessionId) : `${o.tableNumber}|${toBusinessDate(at, tz)}`;
    add(o.servedBy, visitKey, at);
  }

  const out = new Map<string, TableStats>();
  for (const [name, v] of visits) out.set(name, { tablesToday: v.today.size, tables30d: v.window.size });
  return out;
}

// GET /api/waiters — list all waiters for this hotel, with tables attended
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const waiters = await Waiter.find({ hotelId: req.hotelId })
      .select('-pin')
      .sort({ createdAt: -1 })
      .lean();

    let stats: Map<string, TableStats> | null = null;
    try {
      stats = await tablesAttendedByName(req.hotelId!, waiters.map(w => w.name));
    } catch (err) {
      // Stats are a nice-to-have — never fail the staff list over them.
      logger.warn('[waiters] tables-attended stats failed', { hotelId: req.hotelId, err: String(err) });
    }

    // Omit the fields (rather than send 0) when stats failed, so the UI hides them.
    res.json(waiters.map(w => (stats
      ? { ...w, ...(stats.get(w.name) ?? { tablesToday: 0, tables30d: 0 }) }
      : w
    )));
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/waiters — add waiter
router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, employeeCode, pin, mobile } = req.body;
  if (!name || !employeeCode || !pin) {
    return res.status(400).json({ message: 'Name, employee code and PIN are required' });
  }
  const pinCheck = validatePin(pin);
  if (!pinCheck.valid) {
    return res.status(400).json({ message: pinCheck.message });
  }
  try {
    const code = employeeCode.toString().trim().toUpperCase();
    const exists = await Waiter.findOne({ hotelId: req.hotelId, employeeCode: code });
    if (exists) {
      return res.status(409).json({ message: `Employee code ${code} already exists` });
    }
    const waiter = await Waiter.create({
      hotelId: req.hotelId,
      name: name.trim(),
      employeeCode: code,
      pin: await bcrypt.hash(pin.toString().trim(), 12),
      mobile: (mobile || '').trim(),
      isActive: true,
    });
    const { pin: _pin, ...safe } = (waiter.toObject() as any);
    logAudit(req, 'waiter.created', 'waiter', String((waiter as any)._id), { name: name.trim(), employeeCode: code });
    return res.status(201).json(safe);
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Employee code already exists' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/waiters/:id — edit name / mobile / employeeCode
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const { name, mobile, employeeCode } = req.body;
  try {
    const update: any = {};
    if (name)         update.name = name.trim();
    if (mobile !== undefined) update.mobile = mobile.trim();
    if (employeeCode) update.employeeCode = employeeCode.toString().trim().toUpperCase();
    const waiter = await Waiter.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      update,
      { new: true, select: '-pin' }
    ).lean();
    if (!waiter) return res.status(404).json({ message: 'Waiter not found' });
    logAudit(req, 'waiter.updated', 'waiter', req.params.id, { name: waiter.name, employeeCode: waiter.employeeCode, changes: update });
    return res.json(waiter);
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/waiters/:id/pin — reset PIN
router.patch('/:id/pin', async (req: AuthRequest, res: Response) => {
  const { pin } = req.body;
  const pinCheck = validatePin(pin);
  if (!pinCheck.valid) {
    return res.status(400).json({ message: pinCheck.message });
  }
  try {
    const waiter = await Waiter.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { pin: await bcrypt.hash(pin.toString().trim(), 12) },
      { new: true, select: '-pin' }
    ).lean();
    if (!waiter) return res.status(404).json({ message: 'Waiter not found' });
    logAudit(req, 'waiter.pin_reset', 'waiter', req.params.id, { name: waiter.name, employeeCode: waiter.employeeCode });
    return res.json({ message: 'PIN updated successfully' });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/waiters/:id/toggle — toggle isActive
router.patch('/:id/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const waiter = await Waiter.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!waiter) return res.status(404).json({ message: 'Waiter not found' });
    waiter.isActive = !waiter.isActive;
    await waiter.save();
    logAudit(req, 'waiter.toggled', 'waiter', req.params.id, { name: waiter.name, employeeCode: waiter.employeeCode, isActive: waiter.isActive });
    return res.json({ isActive: waiter.isActive });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/waiters/:id — remove waiter
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const waiter = await Waiter.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!waiter) return res.status(404).json({ message: 'Waiter not found' });
    logAudit(req, 'waiter.deleted', 'waiter', req.params.id, { name: (waiter as any).name });
    return res.json({ message: 'Waiter deleted' });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
