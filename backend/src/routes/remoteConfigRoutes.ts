import { Router, Request, Response } from 'express';
import RemoteConfig from '../models/RemoteConfig';

const router = Router();

// GET /api/remote-config — public endpoint, fetched on app startup
router.get('/', async (_req: Request, res: Response) => {
  try {
    const config = await RemoteConfig.findOne().select('-__v').lean()
      ?? (await RemoteConfig.create({})).toObject();
    return res.json(config);
  } catch {
    // Return safe defaults if DB unavailable — never block the app
    return res.json({
      maintenanceMode:      false,
      maintenanceMessage:   '',
      minimumAppVersion:    '1.0.0',
      minimumAppVersionIos: '1.0.0',
      forceUpdate:          false,
      forceUpdateMessage:   '',
      trialDays:            14,
      paymentEnabled:       false,
      broadcastMessage:     '',
      broadcastMessageType: 'info',
    });
  }
});

export default router;
