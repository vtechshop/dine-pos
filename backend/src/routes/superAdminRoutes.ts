import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import Hotel from '../models/Hotel';
import Order from '../models/Order';
import mongoose from 'mongoose';

const router = Router();

// Middleware: validate super admin credentials via header
const superAdminAuth = (req: Request, res: Response, next: Function) => {
  const id = req.headers['x-super-admin-id'] as string;
  const pass = req.headers['x-super-admin-pass'] as string;

  if (
    id === (process.env.SUPER_ADMIN_ID || 'superadmin') &&
    pass === (process.env.SUPER_ADMIN_PASS || 'super1234')
  ) {
    return next();
  }
  return res.status(401).json({ message: 'Unauthorized' });
};

// POST /api/superadmin/login
router.post('/login', (req: Request, res: Response) => {
  const { userId, password } = req.body;
  const adminId = process.env.SUPER_ADMIN_ID || 'superadmin';
  const adminPass = process.env.SUPER_ADMIN_PASS || 'super1234';

  if (!userId || !password) {
    return res.status(400).json({ message: 'Credentials required' });
  }

  if (userId === adminId && password === adminPass) {
    return res.json({ success: true, role: 'superadmin' });
  }
  return res.status(401).json({ message: 'Invalid super admin credentials' });
});

// GET /api/superadmin/hotels — list all hotels with filters
router.get('/hotels', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;
    const filter: any = {};

    if (status && status !== 'all') filter.status = status;
    if (search) {
      filter.$or = [
        { hotelName: { $regex: search, $options: 'i' } },
        { ownerName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { fssaiNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const hotels = await Hotel.find(filter).sort({ createdAt: -1 });
    return res.json(hotels);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/superadmin/hotels/:id — hotel detail
router.get('/hotels/:id', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json(hotel);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/superadmin/hotels/:id/approve
router.put('/hotels/:id/approve', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      { status: 'active', approvedAt: new Date(), rejectionReason: '' },
      { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} approved successfully`, hotel });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/superadmin/hotels/:id/reject
router.put('/hotels/:id/reject', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: 'Rejection reason required' });

    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', rejectionReason: reason },
      { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} rejected`, hotel });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/superadmin/hotels/:id/suspend
router.put('/hotels/:id/suspend', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      { status: 'suspended' },
      { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} suspended`, hotel });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/superadmin/hotels/:id/activate
router.put('/hotels/:id/activate', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      { status: 'active' },
      { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} activated`, hotel });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/superadmin/hotels/:id/credentials — set adminId + password on approval
router.put('/hotels/:id/credentials', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { adminId, password } = req.body;
    if (!adminId || !password) {
      return res.status(400).json({ message: 'adminId and password are required' });
    }
    if (adminId.length < 4) {
      return res.status(400).json({ message: 'adminId must be at least 4 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check adminId is not already taken by another hotel
    const existing = await Hotel.findOne({ adminId: adminId.trim(), _id: { $ne: req.params.id } });
    if (existing) {
      return res.status(409).json({ message: 'This Admin ID is already taken by another hotel' });
    }

    const adminPasswordHash = await bcrypt.hash(password, 10);
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      {
        adminId: adminId.trim(),
        adminPasswordHash,
        status: 'active',
        approvedAt: new Date(),
        rejectionReason: '',
        resetRequested: false,
        resetFulfilledAt: new Date(),
      },
      { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} approved and credentials set`, hotel });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/superadmin/branch-revenue — multi-branch revenue comparison
router.get('/branch-revenue', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date  = new Date(dateStr);
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);

    const activeHotels = await Hotel.find({ status: 'active' }).select('_id hotelName city').lean();

    const revenueByHotel = await Order.aggregate([
      { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: start, $lte: end } } },
      { $group: {
        _id:      '$hotelId',
        revenue:  { $sum: '$grandTotal' },
        orders:   { $sum: 1 },
        avgOrder: { $avg: '$grandTotal' },
      }},
    ]);

    const revenueMap = new Map(revenueByHotel.map((r: any) => [r._id.toString(), r]));

    const branches = activeHotels.map((h: any) => {
      const r = revenueMap.get(h._id.toString());
      return {
        hotelId:   h._id,
        hotelName: h.hotelName,
        city:      h.city || '',
        revenue:   r?.revenue || 0,
        orders:    r?.orders || 0,
        avgOrder:  r?.avgOrder || 0,
      };
    }).sort((a: any, b: any) => b.revenue - a.revenue);

    const totalRevenue = branches.reduce((s: number, b: any) => s + b.revenue, 0);
    const totalOrders  = branches.reduce((s: number, b: any) => s + b.orders, 0);

    res.json({ date: dateStr, totalRevenue, totalOrders, branches });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// GET /api/superadmin/stats
router.get('/stats', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const [total, pending, active, suspended, rejected, resetRequests] = await Promise.all([
      Hotel.countDocuments(),
      Hotel.countDocuments({ status: 'pending' }),
      Hotel.countDocuments({ status: 'active' }),
      Hotel.countDocuments({ status: 'suspended' }),
      Hotel.countDocuments({ status: 'rejected' }),
      Hotel.countDocuments({ resetRequested: true }),
    ]);
    return res.json({ total, pending, active, suspended, rejected, resetRequests });
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
