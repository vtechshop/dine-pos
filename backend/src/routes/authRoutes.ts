import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import Hotel from '../models/Hotel';
import RefreshToken from '../models/RefreshToken';
import Settings from '../models/Settings';
import { generateToken, generateRefreshToken, generateKitchenToken } from '../middleware/auth';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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
  if (!userId || !password) {
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
      return res.status(401).json({ message: 'Invalid User ID or Password' });
    }

    const [token, refreshToken] = await Promise.all([
      Promise.resolve(generateToken(hotel._id.toString(), hotel.hotelName)),
      generateRefreshToken(hotel._id.toString()),
    ]);

    // Compute trial info for the mobile app
    const daysRemaining = hotel.status === 'trial' ? trialDaysRemaining(hotel.trialEndDate) : null;

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
    if ((settings as any).kitchenPin !== pin.toString().trim()) {
      return res.status(401).json({ message: 'Incorrect PIN' });
    }
    return res.json({ token: generateKitchenToken(hotelId) });
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
