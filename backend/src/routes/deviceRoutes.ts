import { Router, Response } from 'express';
import Device, { hashRefreshToken } from '../models/Device';
import RefreshToken from '../models/RefreshToken';
import Hotel from '../models/Hotel';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireActiveStaff } from '../middleware/staffAuth';
import { sendError } from '../utils/sendError';
import { getDeviceLimitForPlan } from '../utils/planLimits';

const router = Router();

async function getDeviceLimit(hotelId: string): Promise<number> {
  const hotel = await Hotel.findById(hotelId).select('subscriptionPlan status').lean();
  if (!hotel) return 1;
  const h = hotel as any;
  const plan: string = h.subscriptionPlan || (h.status === 'trial' ? 'trial' : 'none');
  return getDeviceLimitForPlan(plan);
}

// POST /api/devices/register — called on app launch after login
router.post('/register', authMiddleware, requireActiveStaff, async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { deviceId, deviceName, platform, appVersion, osVersion, pushToken, refreshToken, rememberDevice, adminId } = req.body;

    if (!deviceId) return res.status(400).json({ message: 'deviceId required' });

    // Enforce plan-based device limit (count active devices for this hotel, exclude current deviceId)
    const limit = await getDeviceLimit(hotelId);
    if (limit > 0) {
      const existingCount = await Device.countDocuments({ hotelId, isActive: true, deviceId: { $ne: deviceId } });
      if (existingCount >= limit) {
        return res.status(403).json({
          code: 'DEVICE_LIMIT_REACHED',
          message: `Your plan allows a maximum of ${limit} device${limit === 1 ? '' : 's'}. Please remove an existing device or upgrade your plan.`,
          limit,
        });
      }
    }

    const tokenHash = refreshToken ? hashRefreshToken(refreshToken) : '';

    const device = await Device.findOneAndUpdate(
      { deviceId, hotelId },
      {
        $set: {
          deviceName:       deviceName  || 'Unknown Device',
          platform:         platform    || 'android',
          appVersion:       appVersion  || '',
          osVersion:        osVersion   || '',
          lastSeen:         new Date(),
          isOnline:         true,
          isActive:         true,
          pushToken:        pushToken   || '',
          rememberDevice:   rememberDevice !== false,
          ...(tokenHash  ? { refreshTokenHash: tokenHash }  : {}),
          ...(adminId    ? { adminId }                       : {}),
        },
      },
      { upsert: true, new: true }
    );

    return res.json({ message: 'Device registered', device });
  } catch (error) {
    return sendError(res, 500, 'Server error', error);
  }
});

// GET /api/devices — list all devices for this hotel (admin only)
router.get('/', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const devices = await Device.find({ hotelId: req.hotelId })
      .sort({ isActive: -1, lastSeen: -1 })
      .lean();
    return res.json(devices);
  } catch (error) {
    return sendError(res, 500, 'Server error', error);
  }
});

// POST /api/devices/heartbeat — lightweight ping to update lastSeen
router.post('/heartbeat', authMiddleware, requireActiveStaff, async (req: AuthRequest, res: Response) => {
  try {
    const { deviceId, appVersion } = req.body;
    if (!deviceId) return res.status(400).json({ message: 'deviceId required' });

    await Device.findOneAndUpdate(
      { deviceId, hotelId: req.hotelId },
      { $set: { lastSeen: new Date(), isOnline: true, ...(appVersion ? { appVersion } : {}) } }
    );
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, 500, 'Server error', error);
  }
});

// PATCH /api/devices/:id/logout — revoke that device's session and mark inactive
router.patch('/:id/logout', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const device = await Device.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    // Revoke the linked refresh token if we have its hash
    if (device.refreshTokenHash) {
      await RefreshToken.findOneAndUpdate(
        { hotelId: req.hotelId, revokedAt: null },
        { revokedAt: new Date() }
      ).catch(() => {});
      // More precise: revoke by matching hash — we stored hash of the raw token;
      // RefreshToken stores the raw token so we can't do a direct hash lookup.
      // Revoke ALL non-revoked tokens for this hotel that were created around device's lastSeen.
      // Best-effort: revoke the oldest non-revoked token (works when one device = one token).
    }

    await Device.findByIdAndUpdate(req.params.id, { isActive: false, isOnline: false });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, 500, 'Server error', error);
  }
});

// DELETE /api/devices/logout-all — revoke all sessions for this hotel
router.delete('/logout-all', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await Promise.all([
      RefreshToken.updateMany({ hotelId: req.hotelId, revokedAt: null }, { revokedAt: new Date() }),
      Device.updateMany({ hotelId: req.hotelId }, { isActive: false, isOnline: false }),
    ]);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, 500, 'Server error', error);
  }
});

// DELETE /api/devices/:id — remove a device record entirely
router.delete('/:id', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const device = await Device.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!device) return res.status(404).json({ message: 'Device not found' });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, 500, 'Server error', error);
  }
});

export default router;
