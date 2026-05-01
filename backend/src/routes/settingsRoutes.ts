import { Router, Response } from 'express';
import Settings from '../models/Settings';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

// GET settings for this hotel
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    let settings = await Settings.findOne({ hotelId: req.hotelId });
    if (!settings) {
      settings = await Settings.create({ hotelId: req.hotelId });
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// PUT update settings for this hotel
router.put('/', async (req: AuthRequest, res: Response) => {
  try {
    const settings = await Settings.findOneAndUpdate(
      { hotelId: req.hotelId },
      { ...req.body, hotelId: req.hotelId },
      { new: true, upsert: true, runValidators: true }
    );
    res.json(settings);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

export default router;
