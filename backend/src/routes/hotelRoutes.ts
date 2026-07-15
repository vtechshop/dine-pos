import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Hotel from '../models/Hotel';

const JWT_SECRET = process.env.JWT_SECRET!;

// Verifies JWT only — does NOT enforce subscription status.
// Used for endpoints that expired hotels still need to access.
const jwtOnlyAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ message: 'Authentication required' }); return; }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { hotelId: string };
    (req as any).hotelId = decoded.hotelId;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired session' });
  }
};

const router = Router();

const VALID_BUSINESS_TYPES = [
  'restaurant', 'hotel', 'bakery', 'cafe', 'sweet-shop', 'juice-shop',
  'fast-food', 'cloud-kitchen', 'food-court', 'mess', 'catering',
  'veg', 'non-veg', 'both',
];

// POST /api/hotels/register — Hotel registers for the platform
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { hotelName, ownerName, phone, email, businessType, state, city } = req.body;

    if (!hotelName?.trim()) return res.status(400).json({ message: 'Business name is required' });
    if (!ownerName?.trim()) return res.status(400).json({ message: 'Owner name is required' });
    if (!phone?.trim())     return res.status(400).json({ message: 'Phone number is required' });
    if (!/^\d{10}$/.test(String(phone).trim())) {
      return res.status(400).json({ message: 'Phone number must be exactly 10 digits' });
    }
    if (!email?.trim()) return res.status(400).json({ message: 'Email address is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }
    if (!businessType || !VALID_BUSINESS_TYPES.includes(businessType)) {
      return res.status(400).json({ message: 'Please select a valid business type' });
    }
    if (!state?.trim()) return res.status(400).json({ message: 'State is required' });
    if (!city?.trim())  return res.status(400).json({ message: 'City is required' });

    const existingPhone = await Hotel.findOne({ phone: String(phone).trim() });
    if (existingPhone) {
      return res.status(409).json({ message: 'A hotel with this phone number is already registered' });
    }

    const existingEmail = await Hotel.findOne({ email: String(email).trim().toLowerCase() });
    if (existingEmail) {
      return res.status(409).json({ message: 'This email address is already registered' });
    }

    const hotel = await Hotel.create({
      hotelName: String(hotelName).trim(),
      ownerName: String(ownerName).trim(),
      phone: String(phone).trim(),
      email: String(email).trim().toLowerCase(),
      businessType,
      state: String(state).trim(),
      city: String(city).trim(),
      address: typeof req.body.address === 'string' ? req.body.address.trim() : undefined,
      status: 'pending',
    });

    return res.status(201).json({
      message: 'Registration submitted! Awaiting super admin approval.',
      hotelId: hotel._id,
    });
  } catch (error: any) {
    return res.status(400).json({ message: error.message || 'Registration failed' });
  }
});

// GET /api/hotels/status/:phone — Check registration status
router.get('/status/:phone', async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findOne({ phone: req.params.phone }).select(
      'hotelName status rejectionReason createdAt approvedAt'
    );
    if (!hotel) return res.status(404).json({ message: 'No registration found for this phone' });
    return res.json(hotel);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/hotels/resubmit/:phone — Update details and reset status to pending
router.put('/resubmit/:phone', async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findOne({ phone: req.params.phone });
    if (!hotel) return res.status(404).json({ message: 'No registration found for this phone' });

    if (hotel.status !== 'rejected') {
      return res.status(400).json({ message: 'Only rejected registrations can be resubmitted' });
    }

    const { hotelName, ownerName, email, businessType, state, city, address } = req.body;
    const updated = await Hotel.findOneAndUpdate(
      { phone: req.params.phone },
      {
        ...(hotelName     && { hotelName:    String(hotelName).trim() }),
        ...(ownerName     && { ownerName:    String(ownerName).trim() }),
        ...(email         && { email:        String(email).trim().toLowerCase() }),
        ...(businessType  && { businessType }),
        ...(state         && { state:        String(state).trim() }),
        ...(city          && { city:         String(city).trim() }),
        ...(typeof address === 'string' && { address: address.trim() }),
        status: 'pending',
        rejectionReason: '',
        approvedAt: null,
      },
      { new: true }
    );

    return res.json({ message: 'Resubmission successful! Awaiting super admin approval.', hotel: updated });
  } catch (error: any) {
    return res.status(400).json({ message: error.message || 'Resubmission failed' });
  }
});

// POST /api/hotels/reset-request — Hotel requests credential reset
router.post('/reset-request', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone number required' });

    const hotel = await Hotel.findOne({ phone: phone.trim() });
    if (!hotel) return res.status(404).json({ message: 'No hotel found with this phone number' });
    if (hotel.status !== 'active') {
      return res.status(400).json({ message: 'Only active hotels can request a credential reset' });
    }

    await Hotel.findByIdAndUpdate(hotel._id, { resetRequested: true, resetRequestedAt: new Date() });
    return res.json({ message: 'Reset request submitted. The super admin will update your credentials shortly.' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/hotels/reset-status/:phone — Check if credentials were reset after request
router.get('/reset-status/:phone', async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findOne({ phone: req.params.phone }).select(
      'hotelName status adminId resetRequested resetRequestedAt resetFulfilledAt'
    );
    if (!hotel) return res.status(404).json({ message: 'No hotel found' });
    return res.json(hotel);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/hotels/subscription — returns live subscription info (JWT-only, no status gate)
router.get('/subscription', jwtOnlyAuth, async (req: Request, res: Response) => {
  try {
    const hotelId = (req as any).hotelId;
    const hotel = await Hotel.findById(hotelId)
      .select('status subscriptionType subscriptionEndDate trialEndDate planExpiryDate hotelName')
      .lean();
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    const h = hotel as any;
    const now = new Date();
    const endDate: Date | null = h.subscriptionEndDate || h.trialEndDate || h.planExpiryDate || null;
    const daysRemaining = endDate
      ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / 86400000))
      : 0;
    const isExpired = !endDate || endDate < now || h.status === 'expired';

    return res.json({
      subscriptionStatus: h.status,
      subscriptionType: h.subscriptionType || 'trial',
      trialEndDate: h.trialEndDate || null,
      subscriptionEndDate: h.subscriptionEndDate || null,
      daysRemaining,
      isExpired,
      hotelName: h.hotelName,
    });
  } catch {
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
