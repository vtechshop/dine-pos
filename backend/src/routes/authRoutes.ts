import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import Hotel from '../models/Hotel';
import { generateToken } from '../middleware/auth';

const router = Router();

// POST /api/auth/login — Per-hotel login using credentials set by super admin
router.post('/login', async (req: Request, res: Response) => {
  const { userId, password } = req.body;

  if (!userId || !password) {
    return res.status(400).json({ message: 'User ID and password required' });
  }

  try {
    // Find hotel by adminId
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

    const isMatch = await bcrypt.compare(password, hotel.adminPasswordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid User ID or Password' });
    }

    const token = generateToken(hotel._id.toString(), hotel.hotelName);

    return res.json({
      success: true,
      token,
      hotelId: hotel._id,
      hotelName: hotel.hotelName,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error during login' });
  }
});

export default router;
