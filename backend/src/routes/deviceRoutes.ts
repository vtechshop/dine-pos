import { Router, Response } from 'express';
import Device from '../models/Device';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireActiveStaff } from '../middleware/staffAuth';

const router = Router();

// POST /api/devices/register — called on app launch after login
router.post('/register', authMiddleware, requireActiveStaff, async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const { deviceId, deviceName, platform, appVersion, osVersion, pushToken } = req.body;

    if (!deviceId) return res.status(400).json({ message: 'deviceId required' });

    const device = await Device.findOneAndUpdate(
      { deviceId, hotelId },
      {
        $set: {
          deviceName:  deviceName  || 'Unknown Device',
          platform:    platform    || 'android',
          appVersion:  appVersion  || '',
          osVersion:   osVersion   || '',
          lastSeen:    new Date(),
          isOnline:    true,
          pushToken:   pushToken   || '',
        },
      },
      { upsert: true, new: true }
    );

    return res.json({ message: 'Device registered', device });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/devices — list devices for this hotel
router.get('/', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const devices = await Device.find({ hotelId: req.hotelId })
      .sort({ lastSeen: -1 })
      .lean();
    return res.json(devices);
  } catch {
    return res.status(500).json({ message: 'Server error' });
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
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
