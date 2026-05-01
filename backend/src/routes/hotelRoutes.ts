import { Router, Request, Response } from 'express';
import Hotel from '../models/Hotel';

const router = Router();

// POST /api/hotels/register — Hotel registers for the platform
router.post('/register', async (req: Request, res: Response) => {
  try {
    const existing = await Hotel.findOne({ phone: req.body.phone });
    if (existing) {
      return res.status(400).json({ message: 'A hotel with this phone number is already registered' });
    }

    const hotel = await Hotel.create({
      ...req.body,
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

    const updated = await Hotel.findOneAndUpdate(
      { phone: req.params.phone },
      {
        ...req.body,
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

export default router;
