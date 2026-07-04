import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import Waiter from '../models/Waiter';

const router = Router();
router.use(authMiddleware);

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
  if (pin.length < 4 || pin.length > 6) {
    return res.status(400).json({ message: 'PIN must be 4–6 digits' });
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
      pin: pin.toString().trim(),
      mobile: (mobile || '').trim(),
      isActive: true,
    });
    const { pin: _pin, ...safe } = (waiter.toObject() as any);
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
    return res.json(waiter);
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/waiters/:id/pin — reset PIN
router.patch('/:id/pin', async (req: AuthRequest, res: Response) => {
  const { pin } = req.body;
  if (!pin || pin.length < 4 || pin.length > 6) {
    return res.status(400).json({ message: 'PIN must be 4–6 digits' });
  }
  try {
    const waiter = await Waiter.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { pin: pin.toString().trim() },
      { new: true, select: '-pin' }
    ).lean();
    if (!waiter) return res.status(404).json({ message: 'Waiter not found' });
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
    return res.json({ message: 'Waiter deleted' });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
