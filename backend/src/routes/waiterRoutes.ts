import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import Waiter from '../models/Waiter';
import { logAudit } from '../utils/audit';
import { validatePin } from '../utils/pinPolicy';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// GET /api/waiters — list all waiters for this hotel
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const waiters = await Waiter.find({ hotelId: req.hotelId })
      .select('-pin')
      .sort({ createdAt: -1 })
      .lean();
    res.json(waiters);
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
    logAudit(req, 'waiter.updated', 'waiter', req.params.id, { changes: update });
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
    logAudit(req, 'waiter.pin_reset', 'waiter', req.params.id);
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
    logAudit(req, 'waiter.toggled', 'waiter', req.params.id, { isActive: waiter.isActive });
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
