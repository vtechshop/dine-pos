import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import Cashier from '../models/Cashier';
import { logAudit } from '../utils/audit';
import { validatePin } from '../utils/pinPolicy';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const cashiers = await Cashier.find({ hotelId: req.hotelId })
      .select('-pin').sort({ createdAt: -1 }).lean();
    res.json(cashiers);
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

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
    const exists = await Cashier.findOne({ hotelId: req.hotelId, employeeCode: code });
    if (exists) return res.status(409).json({ message: `Employee code ${code} already exists` });
    const cashier = await Cashier.create({
      hotelId: req.hotelId, name: name.trim(), employeeCode: code,
      pin: await bcrypt.hash(pin.toString().trim(), 12), mobile: (mobile || '').trim(), isActive: true,
    });
    const { pin: _pin, ...safe } = (cashier.toObject() as any);
    logAudit(req, 'cashier.created', 'cashier', String((cashier as any)._id), { name: name.trim(), employeeCode: code });
    return res.status(201).json(safe);
  } catch (error: any) {
    if (error.code === 11000) return res.status(409).json({ message: 'Employee code already exists' });
    return res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const { name, mobile, employeeCode } = req.body;
  try {
    const update: any = {};
    if (name)             update.name = name.trim();
    if (mobile !== undefined) update.mobile = mobile.trim();
    if (employeeCode)     update.employeeCode = employeeCode.toString().trim().toUpperCase();
    const cashier = await Cashier.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId }, update,
      { new: true, select: '-pin' }
    ).lean();
    if (!cashier) return res.status(404).json({ message: 'Cashier not found' });
    return res.json(cashier);
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id/pin', async (req: AuthRequest, res: Response) => {
  const { pin } = req.body;
  const pinCheck = validatePin(pin);
  if (!pinCheck.valid) {
    return res.status(400).json({ message: pinCheck.message });
  }
  try {
    const cashier = await Cashier.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { pin: await bcrypt.hash(pin.toString().trim(), 12) },
      { new: true, select: '-pin' }
    ).lean();
    if (!cashier) return res.status(404).json({ message: 'Cashier not found' });
    logAudit(req, 'cashier.pin_reset', 'cashier', req.params.id);
    return res.json({ message: 'PIN updated successfully' });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id/toggle', async (req: AuthRequest, res: Response) => {
  try {
    const cashier = await Cashier.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!cashier) return res.status(404).json({ message: 'Cashier not found' });
    cashier.isActive = !cashier.isActive;
    await cashier.save();
    logAudit(req, 'cashier.toggled', 'cashier', req.params.id, { isActive: cashier.isActive });
    return res.json({ isActive: cashier.isActive });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const cashier = await Cashier.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!cashier) return res.status(404).json({ message: 'Cashier not found' });
    logAudit(req, 'cashier.deleted', 'cashier', req.params.id, { name: (cashier as any).name });
    return res.json({ message: 'Cashier deleted' });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
