import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'crypto';
import Hotel from '../models/Hotel';
import Order from '../models/Order';
import Device from '../models/Device';
import RefreshToken from '../models/RefreshToken';
import Notification from '../models/Notification';
import RemoteConfig from '../models/RemoteConfig';
import { generateAdminId, generatePassword } from '../utils/credentialGenerator';
import { bootstrapNewHotel } from '../services/bootstrapHotel';

const router = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const safeEqual = (a: string, b: string): boolean => {
  try {
    return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

const superAdminAuth = (req: Request, res: Response, next: Function) => {
  const id   = (req.headers['x-super-admin-id']   as string) || '';
  const pass = (req.headers['x-super-admin-pass'] as string) || '';
  const expectedId   = process.env.SUPER_ADMIN_ID   || 'superadmin';
  const expectedPass = process.env.SUPER_ADMIN_PASS || 'super1234';
  if (safeEqual(id, expectedId) && safeEqual(pass, expectedPass)) return next();
  return res.status(401).json({ message: 'Unauthorized' });
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/login', adminLoginLimiter, (req: Request, res: Response) => {
  const { userId, password } = req.body;
  const adminId   = process.env.SUPER_ADMIN_ID   || 'superadmin';
  const adminPass = process.env.SUPER_ADMIN_PASS || 'super1234';
  if (!userId || !password) return res.status(400).json({ message: 'Credentials required' });
  if (safeEqual(String(userId), adminId) && safeEqual(String(password), adminPass)) {
    return res.json({ success: true, role: 'superadmin' });
  }
  return res.status(401).json({ message: 'Invalid super admin credentials' });
});

// ── Hotels ────────────────────────────────────────────────────────────────────

router.get('/hotels', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;
    const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    if (search) {
      const s = escapeRegex(String(search));
      filter.$or = [
        { hotelName:   { $regex: s, $options: 'i' } },
        { ownerName:   { $regex: s, $options: 'i' } },
        { phone:       { $regex: s, $options: 'i' } },
        { fssaiNumber: { $regex: s, $options: 'i' } },
      ];
    }

    const [hotels, total] = await Promise.all([
      Hotel.find(filter)
        .select('-adminPasswordHash')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Hotel.countDocuments(filter),
    ]);

    return res.json({ hotels, total, page, limit, pages: Math.ceil(total / limit) || 1 });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.get('/hotels/:id', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.params.id).select('-adminPasswordHash');
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json(hotel);
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.put('/hotels/:id/approve', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const existing = await Hotel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Hotel not found' });

    const { trialDays = 14, features } = req.body;
    const days = Math.max(1, Math.min(365, parseInt(trialDays) || 14));

    // Auto-generate unique adminId (retry on collision)
    let adminId = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateAdminId();
      const taken = await Hotel.findOne({ adminId: candidate, _id: { $ne: req.params.id } });
      if (!taken) { adminId = candidate; break; }
    }
    if (!adminId) return res.status(500).json({ message: 'Could not generate unique Admin ID' });

    const plainPassword = generatePassword();
    const adminPasswordHash = await bcrypt.hash(plainPassword, 12);

    const trialStartDate = new Date();
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + days);

    const featureUpdate: Record<string, boolean> = {};
    const allowedFeatures = ['payment', 'reservations', 'customerChat', 'qrOrdering', 'expenses', 'reports', 'tables', 'ingredients', 'waste', 'aggregator'];
    if (features && typeof features === 'object') {
      for (const key of allowedFeatures) {
        if (features[key] !== undefined) featureUpdate[`features.${key}`] = Boolean(features[key]);
      }
    }

    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          adminId,
          adminPasswordHash,
          status: 'trial',
          approvedAt: trialStartDate,
          trialStartDate,
          trialEndDate,
          subscriptionType: 'trial',
          subscriptionStartDate: trialStartDate,
          subscriptionEndDate: trialEndDate,
          rejectionReason: '',
          resetRequested: false,
          resetFulfilledAt: null,
          ...featureUpdate,
        },
      },
      { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    const { kitchenPin } = await bootstrapNewHotel(hotel._id as any, {
      hotelName: hotel.hotelName,
      phone: hotel.phone,
    });

    const credentials = { adminId, password: plainPassword, kitchenPin };

    const emailPayload = {
      to: hotel.email,
      subject: `Welcome to Dine POS — Your Account is Approved!`,
      hotelName: hotel.hotelName,
      ownerName: hotel.ownerName,
      adminId,
      password: plainPassword,
      kitchenPin,
      trialEndDate: trialEndDate.toLocaleDateString('en-IN'),
      loginUrl: 'https://app.dinepos.in',
    };

    const whatsappPayload = {
      phone: hotel.phone,
      message:
        `Hi ${hotel.ownerName}! 🎉\n` +
        `Your *Dine POS* account for *${hotel.hotelName}* is approved!\n\n` +
        `*Admin ID:* ${adminId}\n` +
        `*Password:* ${plainPassword}\n` +
        `*Kitchen PIN:* ${kitchenPin}\n\n` +
        `Trial active until: ${trialEndDate.toLocaleDateString('en-IN')}\n` +
        `Download the app and login to get started.`,
    };

    return res.json({
      message: `${hotel.hotelName} approved — ${days}-day trial started`,
      hotel,
      credentials,
      emailPayload,
      whatsappPayload,
    });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

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
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.put('/hotels/:id/suspend', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id, { status: 'suspended' }, { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    // Revoke all active sessions so the device is locked out immediately
    await Promise.all([
      RefreshToken.updateMany({ hotelId: req.params.id, revokedAt: null }, { revokedAt: new Date() }),
      Device.updateMany({ hotelId: req.params.id }, { isActive: false, isOnline: false }),
    ]).catch(() => {});
    return res.json({ message: `${hotel.hotelName} suspended`, hotel });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.put('/hotels/:id/activate', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id, { status: 'active' }, { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} activated`, hotel });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.put('/hotels/:id/expire', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id, { status: 'expired' }, { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} marked as expired`, hotel });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.put('/hotels/:id/credentials', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { adminId, password } = req.body;
    if (!adminId || !password) return res.status(400).json({ message: 'adminId and password are required' });
    if (adminId.length < 4)    return res.status(400).json({ message: 'adminId must be at least 4 characters' });
    if (password.length < 6)   return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const existing = await Hotel.findOne({ adminId: adminId.trim(), _id: { $ne: req.params.id } });
    if (existing) return res.status(409).json({ message: 'This Admin ID is already taken by another hotel' });

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
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.put('/hotels/:id/premium', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { isPremium, premiumPlan, premiumExpiry, trialDays } = req.body;
    const update: any = {
      isPremium: !!isPremium,
      premiumPlan: isPremium ? (premiumPlan || 'pro') : 'free',
      premiumExpiry: isPremium && premiumExpiry ? new Date(premiumExpiry) : null,
    };
    if (trialDays && trialDays > 0) {
      const trial = new Date();
      trial.setDate(trial.getDate() + trialDays);
      update.trialEndsAt = trial;
      update.isPremium = true;
      update.premiumPlan = 'trial';
    }
    const hotel = await Hotel.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} plan updated`, hotel });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// PUT /api/superadmin/hotels/:id/trial — start or reset trial
router.put('/hotels/:id/trial', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.body.trialDays || req.body.days) || 14));

    const trialStartDate = new Date();
    const trialEndDate   = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + days);

    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      {
        status:               'trial',
        trialStartDate,
        trialEndDate,
        subscriptionType:     'trial',
        subscriptionStartDate: trialStartDate,
        subscriptionEndDate:  trialEndDate,
        approvedAt:           trialStartDate,
        rejectionReason:      '',
      },
      { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({
      message: `${hotel.hotelName} trial started for ${days} days (until ${trialEndDate.toLocaleDateString('en-IN')})`,
      hotel,
    });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// PUT /api/superadmin/hotels/:id/extend-trial — add days to current trial end
router.put('/hotels/:id/extend-trial', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const addDays = Math.max(1, Math.min(365, parseInt(req.body.days) || 7));

    const hotel = await Hotel.findById(req.params.id);
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    const base = hotel.subscriptionEndDate && hotel.subscriptionEndDate > new Date()
      ? hotel.subscriptionEndDate
      : (hotel.trialEndDate && hotel.trialEndDate > new Date() ? hotel.trialEndDate : new Date());

    const newEnd = new Date(base);
    newEnd.setDate(newEnd.getDate() + addDays);

    const updated = await Hotel.findByIdAndUpdate(
      req.params.id,
      {
        trialEndDate:       newEnd,
        subscriptionEndDate: newEnd,
        status:             'trial',
        subscriptionType:   'trial',
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({
      message: `Trial extended by ${addDays} days (until ${newEnd.toLocaleDateString('en-IN')})`,
      hotel: updated,
    });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// PUT /api/superadmin/hotels/:id/plan — convert to paid subscription
router.put('/hotels/:id/plan', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { plan, durationDays } = req.body;
    const validPlans = ['starter', 'professional', 'enterprise'];
    if (!validPlans.includes(plan)) return res.status(400).json({ message: 'plan must be starter, professional, or enterprise' });
    const days = Math.max(1, Math.min(730, parseInt(durationDays) || 30));

    const subscriptionStartDate = new Date();
    const subscriptionEndDate   = new Date();
    subscriptionEndDate.setDate(subscriptionEndDate.getDate() + days);

    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      {
        status:               'active',
        subscriptionType:     plan,
        subscriptionStartDate,
        subscriptionEndDate,
        subscriptionPlan:     plan,
        planStartDate:        subscriptionStartDate,
        planExpiryDate:       subscriptionEndDate,
        rejectionReason:      '',
      },
      { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({
      message: `${hotel.hotelName} converted to ${plan} plan (${days} days, until ${subscriptionEndDate.toLocaleDateString('en-IN')})`,
      hotel,
    });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// PUT /api/superadmin/hotels/:id/features — update feature flags
router.put('/hotels/:id/features', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const allowed = ['payment', 'reservations', 'customerChat', 'qrOrdering', 'expenses', 'reports', 'tables', 'ingredients', 'waste', 'aggregator'];
    const update: any = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        update[`features.${key}`] = Boolean(req.body[key]);
      }
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: 'No valid feature flags provided' });

    const hotel = await Hotel.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).select('-adminPasswordHash');
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: 'Feature flags updated', features: hotel.features });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const [total, pending, trial, active, expired, suspended, rejected, resetRequests, todayRegistrations] = await Promise.all([
      Hotel.countDocuments(),
      Hotel.countDocuments({ status: 'pending' }),
      Hotel.countDocuments({ status: 'trial' }),
      Hotel.countDocuments({ status: 'active' }),
      Hotel.countDocuments({ status: 'expired' }),
      Hotel.countDocuments({ status: 'suspended' }),
      Hotel.countDocuments({ status: 'rejected' }),
      Hotel.countDocuments({ resetRequested: true }),
      Hotel.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
    ]);

    return res.json({ total, pending, trial, active, expired, suspended, rejected, resetRequests, todayRegistrations });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// ── Revenue ───────────────────────────────────────────────────────────────────

router.get('/branch-revenue', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date  = new Date(dateStr);
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);

    const activeHotels = await Hotel.find({ status: { $in: ['active', 'trial'] } }).select('_id hotelName city').lean();
    const revenueByHotel = await Order.aggregate([
      { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$hotelId', revenue: { $sum: '$grandTotal' }, orders: { $sum: 1 }, avgOrder: { $avg: '$grandTotal' } } },
    ]);
    const revenueMap = new Map(revenueByHotel.map((r: any) => [r._id.toString(), r]));
    const branches = activeHotels.map((h: any) => {
      const r = revenueMap.get(h._id.toString());
      return { hotelId: h._id, hotelName: h.hotelName, city: h.city || '', revenue: r?.revenue || 0, orders: r?.orders || 0, avgOrder: r?.avgOrder || 0 };
    }).sort((a: any, b: any) => b.revenue - a.revenue);
    const totalRevenue = branches.reduce((s: number, b: any) => s + b.revenue, 0);
    const totalOrders  = branches.reduce((s: number, b: any) => s + b.orders, 0);

    res.json({ date: dateStr, totalRevenue, totalOrders, branches });
  } catch { res.status(500).json({ message: 'Server error' }); }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotelId = req.query.hotelId as string;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const matchFilter: any = { status: { $ne: 'cancelled' }, createdAt: { $gte: todayStart, $lte: todayEnd } };
    if (hotelId) {
      const mongoose = await import('mongoose');
      if (mongoose.default.Types.ObjectId.isValid(hotelId)) {
        matchFilter.hotelId = new mongoose.default.Types.ObjectId(hotelId);
      }
    }

    const [orderStats, deviceStats] = await Promise.all([
      Order.aggregate([
        { $match: matchFilter },
        { $group: { _id: '$hotelId', ordersToday: { $sum: 1 }, revenueToday: { $sum: '$grandTotal' } } },
      ]),
      Device.aggregate([
        { $group: { _id: '$hotelId', deviceCount: { $sum: 1 }, lastSeen: { $max: '$lastSeen' } } },
      ]),
    ]);

    const statsMap: Record<string, any> = {};
    for (const s of orderStats) {
      statsMap[s._id.toString()] = { ordersToday: s.ordersToday, revenueToday: s.revenueToday };
    }
    for (const d of deviceStats) {
      const key = d._id?.toString();
      if (key) {
        statsMap[key] = { ...(statsMap[key] || {}), deviceCount: d.deviceCount, lastSeen: d.lastSeen };
      }
    }

    return res.json({ analytics: statsMap, generatedAt: new Date() });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// ── Devices ───────────────────────────────────────────────────────────────────

router.get('/devices', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.query;
    const filter: any = {};
    if (hotelId) filter.hotelId = hotelId;
    const devices = await Device.find(filter)
      .populate('hotelId', 'hotelName')
      .sort({ lastSeen: -1 })
      .limit(500)
      .lean();
    return res.json(devices);
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// ── Notifications ─────────────────────────────────────────────────────────────

router.get('/notifications', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const notifications = await Notification.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }).sort({ createdAt: -1 }).limit(50).lean();
    return res.json(notifications);
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.post('/notifications', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { title, message, type, targetHotels, expiresInDays } = req.body;
    if (!title?.trim() || !message?.trim()) return res.status(400).json({ message: 'Title and message required' });

    let expiresAt: Date | null = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const notification = await Notification.create({
      title:        title.trim(),
      message:      message.trim(),
      type:         type || 'info',
      targetHotels: Array.isArray(targetHotels) ? targetHotels : [],
      expiresAt,
      createdBy:    'superadmin',
    });
    return res.status(201).json({ message: 'Notification broadcast sent', notification });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.delete('/notifications/:id', superAdminAuth, async (req: Request, res: Response) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isActive: false });
    return res.json({ message: 'Notification deactivated' });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// ── Remote Config (super admin management) ─────────────────────────────────────

router.get('/remote-config', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const config = await RemoteConfig.findOne().lean()
      ?? (await RemoteConfig.create({})).toObject();
    return res.json(config);
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

router.put('/remote-config', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const allowed = [
      'maintenanceMode', 'maintenanceMessage', 'minimumAppVersion', 'minimumAppVersionIos',
      'forceUpdate', 'forceUpdateMessage', 'trialDays', 'paymentEnabled',
      'broadcastMessage', 'broadcastMessageType',
    ];
    const update: any = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    let config = await RemoteConfig.findOneAndUpdate({}, { $set: update }, { new: true, upsert: true });
    return res.json({ message: 'Remote config updated', config });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

// ── System Health ─────────────────────────────────────────────────────────────

router.get('/health', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const mongoose = (await import('mongoose')).default;
    const mongoState = mongoose.connection.readyState;
    const mongoStatus = mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected';

    const [totalHotels, totalOrders, totalDevices] = await Promise.all([
      Hotel.countDocuments(),
      Order.countDocuments(),
      Device.countDocuments(),
    ]);

    const onlineDeviceCutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 min
    const onlineDevices = await Device.countDocuments({ lastSeen: { $gte: onlineDeviceCutoff } });

    return res.json({
      status:       'ok',
      mongo:        mongoStatus,
      api:          'ok',
      totalHotels,
      totalOrders,
      totalDevices,
      onlineDevices,
      checkedAt:    new Date(),
    });
  } catch { return res.status(500).json({ message: 'Server error' }); }
});

export default router;
