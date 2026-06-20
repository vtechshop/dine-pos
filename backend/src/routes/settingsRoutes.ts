import { Router, Response } from 'express';
import Settings from '../models/Settings';
import Hotel from '../models/Hotel';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

// GET settings for this hotel — includes premium status from Hotel record
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    let settings = await Settings.findOne({ hotelId: req.hotelId });
    if (!settings) {
      settings = await Settings.create({ hotelId: req.hotelId });
    }
    const hotel = await Hotel.findById(req.hotelId).select('isPremium premiumPlan premiumExpiry trialEndsAt');
    const now = new Date();
    const isPremiumActive =
      hotel?.isPremium &&
      (!hotel.premiumExpiry || hotel.premiumExpiry > now);
    const isTrialActive =
      !hotel?.isPremium &&
      hotel?.trialEndsAt != null &&
      hotel.trialEndsAt > now;

    res.json({
      ...settings.toObject(),
      isPremium: isPremiumActive || isTrialActive || false,
      premiumPlan: hotel?.premiumPlan || 'free',
      premiumExpiry: hotel?.premiumExpiry || null,
      trialEndsAt: hotel?.trialEndsAt || null,
    });
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

    // Keep Hotel record in sync so Super Admin dashboard shows the latest name/phone
    const syncFields: Record<string, any> = {};
    if (req.body.hotelName)  syncFields.hotelName  = req.body.hotelName;
    if (req.body.phone)      syncFields.phone       = req.body.phone;
    if (req.body.ownerName)  syncFields.ownerName   = req.body.ownerName;
    if (Object.keys(syncFields).length > 0) {
      await Hotel.findByIdAndUpdate(req.hotelId, syncFields);
    }

    res.json(settings);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

export default router;
