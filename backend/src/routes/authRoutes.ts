import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import Hotel from '../models/Hotel';
import RefreshToken from '../models/RefreshToken';
import Settings from '../models/Settings';
import { generateToken, generateRefreshToken, generateKitchenToken, generateWaiterToken, generateCashierToken } from '../middleware/auth';
import Waiter from '../models/Waiter';
import Cashier from '../models/Cashier';
import { logAuditRaw } from '../utils/audit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

// Returns days remaining in trial (negative if expired)
const trialDaysRemaining = (trialEndDate: Date | null): number => {
  if (!trialEndDate) return 0;
  return Math.ceil((trialEndDate.getTime() - Date.now()) / 86400000);
};

// POST /api/auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { userId, password } = req.body;
  if (!userId || !password || typeof userId !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'User ID and password required' });
  }

  try {
    const hotel = await Hotel.findOne({ adminId: userId.trim() });
    if (!hotel || !hotel.adminPasswordHash) {
      return res.status(401).json({ message: 'Invalid User ID or Password' });
    }

    if (hotel.status === 'pending') {
      return res.status(403).json({ message: 'Your registration is still pending approval.' });
    }
    if (hotel.status === 'suspended') {
      return res.status(403).json({ message: 'Your account has been suspended. Contact support.' });
    }
    if (hotel.status === 'rejected') {
      return res.status(403).json({ message: 'Your registration was rejected. Please resubmit.' });
    }

    // Auto-expire trial if trialEndDate has passed
    if (hotel.status === 'trial' && hotel.trialEndDate && hotel.trialEndDate < new Date()) {
      await Hotel.findByIdAndUpdate(hotel._id, { status: 'expired' });
      return res.status(403).json({
        code: 'TRIAL_EXPIRED',
        message: 'Your free trial has ended. Please contact support to activate your subscription.',
      });
    }
    if (hotel.status === 'expired') {
      return res.status(403).json({
        code: 'TRIAL_EXPIRED',
        message: 'Your free trial has ended. Please contact support to activate your subscription.',
      });
    }

    const isMatch = await bcrypt.compare(password, hotel.adminPasswordHash);
    if (!isMatch) {
      logAuditRaw({ hotelId: hotel._id.toString(), action: 'login.failure', targetType: 'hotel', targetId: hotel._id.toString(), metadata: { userId, reason: 'wrong_password' }, ip: req.ip });
      return res.status(401).json({ message: 'Invalid User ID or Password' });
    }

    const [token, refreshToken] = await Promise.all([
      Promise.resolve(generateToken(hotel._id.toString(), hotel.hotelName)),
      generateRefreshToken(hotel._id.toString()),
    ]);

    // Compute trial info for the mobile app
    const daysRemaining = hotel.status === 'trial' ? trialDaysRemaining(hotel.trialEndDate) : null;

    logAuditRaw({ hotelId: hotel._id.toString(), action: 'login.success', targetType: 'hotel', targetId: hotel._id.toString(), metadata: { userId }, ip: req.ip });
    return res.json({
      success: true,
      token,
      refreshToken,
      hotelId: hotel._id,
      hotelName: hotel.hotelName,
      status: hotel.status,
      trialDaysRemaining: daysRemaining,
      trialEndDate: hotel.trialEndDate,
      subscriptionPlan: hotel.subscriptionPlan,
      features: hotel.features,
    });
  } catch {
    return res.status(500).json({ message: 'Server error during login' });
  }
});

// POST /api/auth/refresh — exchange a valid refresh token for new token pair
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ message: 'Refresh token required' });
  }

  try {
    const record = await RefreshToken.findOne({ token: refreshToken, revokedAt: null });
    if (!record) {
      return res.status(401).json({ message: 'Invalid or revoked refresh token' });
    }
    if (record.expiresAt < new Date()) {
      return res.status(401).json({ message: 'Refresh token expired. Please login again.' });
    }

    const hotel = await Hotel.findById(record.hotelId).select('hotelName status').lean();
    if (!hotel || !['active', 'trial', 'premium'].includes((hotel as any).status)) {
      return res.status(403).json({ message: 'Account not active' });
    }

    // Rotate: revoke old token, issue new pair
    await RefreshToken.findByIdAndUpdate(record._id, { revokedAt: new Date() });
    const [newToken, newRefreshToken] = await Promise.all([
      Promise.resolve(generateToken(record.hotelId.toString(), (hotel as any).hotelName)),
      generateRefreshToken(record.hotelId.toString()),
    ]);

    return res.json({ token: newToken, refreshToken: newRefreshToken });
  } catch {
    return res.status(500).json({ message: 'Server error during token refresh' });
  }
});

// POST /api/auth/kitchen — validate kitchen PIN, return short-lived kitchen JWT
router.post('/kitchen', loginLimiter, async (req: Request, res: Response) => {
  const { hotelId, pin } = req.body;
  if (!hotelId || !pin) {
    return res.status(400).json({ message: 'Hotel ID and PIN required' });
  }
  try {
    const settings = await Settings.findOne({ hotelId }).select('kitchenPin').lean();
    if (!settings || !(settings as any).kitchenPin) {
      return res.status(403).json({ message: 'Kitchen PIN not set. Ask admin to configure it in Settings.' });
    }
    if (!await bcrypt.compare(pin.toString().trim(), (settings as any).kitchenPin)) {
      logAuditRaw({ hotelId, action: 'kitchen.login.failure', targetType: 'kitchen', metadata: { reason: 'wrong_pin' }, ip: req.ip });
      return res.status(401).json({ message: 'Incorrect PIN' });
    }
    logAuditRaw({ hotelId, action: 'kitchen.login.success', targetType: 'kitchen', ip: req.ip });
    return res.json({ token: generateKitchenToken(hotelId) });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/waiter — login with hotelId + employeeCode + PIN
router.post('/waiter', loginLimiter, async (req: Request, res: Response) => {
  const { hotelId, employeeCode, pin } = req.body;
  if (!hotelId || !employeeCode || !pin) {
    return res.status(400).json({ message: 'Hotel ID, employee code and PIN required' });
  }
  try {
    const waiter = await Waiter.findOne({
      hotelId,
      employeeCode: employeeCode.toString().trim().toUpperCase(),
    }).lean();
    if (!waiter) {
      return res.status(401).json({ message: 'Employee code not found' });
    }
    if (!waiter.isActive) {
      return res.status(403).json({ message: 'Your account is inactive. Contact admin.' });
    }
    if (!await bcrypt.compare(pin.toString().trim(), (waiter as any).pin)) {
      logAuditRaw({ hotelId, action: 'waiter.login.failure', targetType: 'waiter', targetId: String((waiter as any)._id), metadata: { employeeCode, reason: 'wrong_pin' }, ip: req.ip });
      return res.status(401).json({ message: 'Incorrect PIN' });
    }
    logAuditRaw({ hotelId, action: 'waiter.login.success', targetType: 'waiter', targetId: String((waiter as any)._id), metadata: { employeeCode }, ip: req.ip });
    const token = generateWaiterToken(hotelId, String((waiter as any)._id), waiter.name);
    return res.json({
      token,
      waiter: {
        _id:          (waiter as any)._id,
        name:         waiter.name,
        employeeCode: waiter.employeeCode,
        mobile:       waiter.mobile,
      },
    });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/cashier — login with hotelId + employeeCode + PIN
router.post('/cashier', loginLimiter, async (req: Request, res: Response) => {
  const { hotelId, employeeCode, pin } = req.body;
  if (!hotelId || !employeeCode || !pin) {
    return res.status(400).json({ message: 'Hotel ID, employee code and PIN required' });
  }
  try {
    const cashier = await Cashier.findOne({
      hotelId,
      employeeCode: employeeCode.toString().trim().toUpperCase(),
    }).lean();
    if (!cashier) {
      return res.status(401).json({ message: 'Employee code not found' });
    }
    if (!cashier.isActive) {
      return res.status(403).json({ message: 'Your account is inactive. Contact admin.' });
    }
    if (!await bcrypt.compare(pin.toString().trim(), (cashier as any).pin)) {
      logAuditRaw({ hotelId, action: 'cashier.login.failure', targetType: 'cashier', targetId: String((cashier as any)._id), metadata: { employeeCode, reason: 'wrong_pin' }, ip: req.ip });
      return res.status(401).json({ message: 'Incorrect PIN' });
    }
    logAuditRaw({ hotelId, action: 'cashier.login.success', targetType: 'cashier', targetId: String((cashier as any)._id), metadata: { employeeCode }, ip: req.ip });
    const token = generateCashierToken(hotelId, String((cashier as any)._id), cashier.name);
    return res.json({
      token,
      cashier: {
        _id:          (cashier as any)._id,
        name:         cashier.name,
        employeeCode: cashier.employeeCode,
        mobile:       cashier.mobile,
      },
    });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/logout — revoke the refresh token server-side
router.post('/logout', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (refreshToken && typeof refreshToken === 'string') {
    await RefreshToken.findOneAndUpdate(
      { token: refreshToken, revokedAt: null },
      { revokedAt: new Date() }
    ).catch(() => {}); // fire-and-forget, non-critical
  }
  return res.json({ ok: true });
});

export default router;
