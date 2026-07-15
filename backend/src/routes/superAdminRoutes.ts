import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import { makeRateLimiter } from '../utils/rateLimiter';
import jwt from 'jsonwebtoken';
import os from 'os';
import mongoose from 'mongoose';
import Hotel from '../models/Hotel';
import Order from '../models/Order';
import Device from '../models/Device';
import Ticket from '../models/Ticket';
import Subscription from '../models/Subscription';
import RefreshToken from '../models/RefreshToken';
import Notification from '../models/Notification';
import RemoteConfig from '../models/RemoteConfig';
import { redisHealthCheck } from '../config/redis';
import { generateAdminId, generatePassword } from '../utils/credentialGenerator';
import { bootstrapNewHotel } from '../services/bootstrapHotel';
import { sendError } from '../utils/sendError';
import { getPriceForPlan, getDeviceLimitForPlan } from '../utils/planLimits';
import { logAuditRaw } from '../utils/audit';


const router = Router();

const adminLoginLimiter = makeRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many login attempts. Please try again after 15 minutes.' },
});

const safeEqual = (a: string, b: string): boolean => {
  try {
    return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

const SUPER_ADMIN_JWT_SECRET = process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET!;

const superAdminAuth = (req: Request, res: Response, next: Function) => {
  // Primary: verify short-lived JWT issued by /superadmin/login
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), SUPER_ADMIN_JWT_SECRET) as any;
      if (payload?.role === 'superadmin') return next();
    } catch { /* fall through to credential check */ }
  }

  // Legacy fallback: raw credential headers (kept for backward-compat during rollout)
  const id   = (req.headers['x-super-admin-id']   as string) || '';
  const pass = (req.headers['x-super-admin-pass'] as string) || '';
  const expectedId   = process.env.SUPER_ADMIN_ID!;
  const expectedPass = process.env.SUPER_ADMIN_PASS!;
  if (id && pass && safeEqual(id, expectedId) && safeEqual(pass, expectedPass)) return next();

  return res.status(401).json({ message: 'Unauthorized' });
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/login', adminLoginLimiter, (req: Request, res: Response) => {
  const { userId, password } = req.body;
  const adminId   = process.env.SUPER_ADMIN_ID!;
  const adminPass = process.env.SUPER_ADMIN_PASS!;
  if (!userId || !password) return res.status(400).json({ message: 'Credentials required' });
  if (safeEqual(String(userId), adminId) && safeEqual(String(password), adminPass)) {
    const token = jwt.sign({ role: 'superadmin' }, SUPER_ADMIN_JWT_SECRET, { expiresIn: '4h' });
    return res.json({ success: true, role: 'superadmin', token });
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

router.get('/hotels/:id', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.params.id).select('-adminPasswordHash');
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json(hotel);
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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

    logAuditRaw({ hotelId: req.params.id, action: 'hotel.approved', targetType: 'hotel', targetId: req.params.id, metadata: { trialDays: days, adminId }, ip: req.ip });
    return res.json({
      message: `${hotel.hotelName} approved — ${days}-day trial started`,
      hotel,
      credentials,
      emailPayload,
      whatsappPayload,
    });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
    logAuditRaw({ hotelId: req.params.id, action: 'hotel.rejected', targetType: 'hotel', targetId: req.params.id, metadata: { reason }, ip: req.ip });
    return res.json({ message: `${hotel.hotelName} rejected`, hotel });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
    logAuditRaw({ hotelId: req.params.id, action: 'hotel.suspended', targetType: 'hotel', targetId: req.params.id, ip: req.ip });
    return res.json({ message: `${hotel.hotelName} suspended`, hotel });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

router.put('/hotels/:id/activate', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id, { status: 'active' }, { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} activated`, hotel });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

router.put('/hotels/:id/expire', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id, { status: 'expired' }, { new: true }
    );
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    return res.json({ message: `${hotel.hotelName} marked as expired`, hotel });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

router.delete('/notifications/:id', superAdminAuth, async (req: Request, res: Response) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isActive: false });
    return res.json({ message: 'Notification deactivated' });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── Remote Config (super admin management) ─────────────────────────────────────

router.get('/remote-config', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const config = await RemoteConfig.findOne().lean()
      ?? (await RemoteConfig.create({})).toObject();
    return res.json(config);
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
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
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── Super Admin Dashboard ─────────────────────────────────────────────────────
//
// GET /api/superadmin/dashboard
// Single-call endpoint that assembles every Row 1-4 widget in parallel.
// All DB queries run concurrently; slowest query sets the response time.
//
router.get('/dashboard', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const now          = new Date();
    const todayStart   = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const monthStart   = new Date(now.getFullYear(), now.getMonth(), 1);
    const in7Days      = new Date(now.getTime() + 7  * 86_400_000);
    const in14Days     = new Date(now.getTime() + 14 * 86_400_000);
    const onlineCutoff = new Date(now.getTime() - 5  * 60_000);   // 5-min heartbeat window

    const [
      hotelCounts,
      todayRev,
      monthRev,
      totalDevices,
      onlineDevices,
      churnRisk,
      openTickets,
      latestRegistrations,
      pendingRenewals,
      recentTickets,
      appVersionAgg,
      remoteConfig,
      mongoState,
      redisState,
    ] = await Promise.all([
      // ── Row 1 ──
      Hotel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),

      Order.aggregate([
        { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } },
      ]),

      Order.aggregate([
        { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } },
      ]),

      Device.countDocuments({ isActive: true }),
      Device.countDocuments({ isActive: true, lastSeen: { $gte: onlineCutoff } }),

      // ── Row 2 ──
      Hotel.countDocuments({
        status: 'trial',
        trialEndDate: { $gte: now, $lte: in7Days },
      }),

      Ticket.countDocuments({ status: { $in: ['open', 'in-progress'] } }),

      // ── Row 3: latest registrations (all statuses, newest first) ──
      Hotel.find()
        .select('hotelName ownerName phone city state status subscriptionType createdAt approvedAt')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      // ── Row 3: pending renewals (trial/active ending in 14 days) ──
      Hotel.find({
        status: { $in: ['trial', 'active'] },
        $or: [
          { trialEndDate:       { $gte: now, $lte: in14Days } },
          { subscriptionEndDate: { $gte: now, $lte: in14Days } },
          { planExpiryDate:      { $gte: now, $lte: in14Days } },
        ],
      })
        .select('hotelName ownerName phone status subscriptionType trialEndDate subscriptionEndDate planExpiryDate')
        .sort({ trialEndDate: 1, subscriptionEndDate: 1 })
        .limit(20)
        .lean(),

      // ── Row 4: recent open tickets ──
      Ticket.find({ status: { $in: ['open', 'in-progress'] } })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      // ── Row 4: app version distribution ──
      Device.aggregate([
        { $match: { isActive: true, appVersion: { $ne: '' } } },
        { $group: { _id: '$appVersion', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      RemoteConfig.findOne().select('minimumAppVersion forceUpdate').lean(),

      // ── System health ──
      Promise.resolve(mongoose.connection.readyState),
      redisHealthCheck(),
    ]);

    // Build hotel status map
    const sc: Record<string, number> = {};
    for (const row of hotelCounts as any[]) sc[row._id] = row.count;

    // App version distribution
    const totalVersioned = (appVersionAgg as any[]).reduce((s: number, v: any) => s + v.count, 0);
    const latestVersion  = (remoteConfig as any)?.minimumAppVersion || '';
    const versionDist    = (appVersionAgg as any[]).map((v: any) => ({
      version:    v._id || 'unknown',
      count:      v.count,
      percentage: totalVersioned > 0 ? Math.round((v.count / totalVersioned) * 100) : 0,
      isLatest:   latestVersion ? v._id === latestVersion : false,
    }));
    const outdatedDeviceCount = latestVersion
      ? (appVersionAgg as any[]).filter((v: any) => v._id && v._id !== latestVersion).reduce((s: number, v: any) => s + v.count, 0)
      : 0;

    // Memory stats
    const mem = process.memoryUsage();

    return res.json({
      // Row 1
      hotelStats: {
        total:     Object.values(sc).reduce((s, n) => s + n, 0),
        pending:   sc.pending   || 0,
        trial:     sc.trial     || 0,
        active:    sc.active    || 0,
        expired:   sc.expired   || 0,
        suspended: sc.suspended || 0,
        rejected:  sc.rejected  || 0,
      },
      devices: { total: totalDevices, online: onlineDevices },

      // Row 2
      todayRevenue:   (todayRev as any[])[0]?.total  || 0,
      monthlyRevenue: (monthRev as any[])[0]?.total  || 0,
      churnRisk,
      openTickets,

      // Row 3
      latestRegistrations,
      pendingRenewals,

      // Row 4
      recentTickets,
      systemHealth: {
        mongo:  mongoState === 1 ? 'ok' : 'error',
        redis:  redisState,
        api:    'ok',
        memory: {
          usedMB:     Math.round(mem.heapUsed  / 1_048_576),
          totalMB:    Math.round(mem.heapTotal / 1_048_576),
          rssMB:      Math.round(mem.rss       / 1_048_576),
          percentage: Math.round((mem.heapUsed / mem.heapTotal) * 100),
        },
        uptimeSeconds: Math.round(process.uptime()),
        loadAvg:       os.loadavg()[0],
      },
      appVersions: {
        latestVersion,
        forceUpdateEnabled:  (remoteConfig as any)?.forceUpdate || false,
        totalDevices,
        outdatedDeviceCount,
        distribution: versionDist,
      },

      generatedAt: now,
    });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── Subscription Revenue ───────────────────────────────────────────────────────
//
// GET /api/superadmin/dashboard/subscription-revenue
// MRR, ARR, and expected renewal revenue derived from active hotel plans.
//
router.get('/dashboard/subscription-revenue', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const now         = new Date();
    const in30Days    = new Date(now.getTime() + 30 * 86_400_000);

    const [planAgg, renewingHotels, recentSubs] = await Promise.all([
      // Active/trial hotels by subscription type
      Hotel.aggregate([
        { $match: { status: { $in: ['active', 'trial'] } } },
        { $group: { _id: '$subscriptionType', count: { $sum: 1 } } },
      ]),

      // Hotels whose subscription renews within 30 days
      Hotel.find({
        status: { $in: ['active', 'trial'] },
        $or: [
          { trialEndDate:       { $gte: now, $lte: in30Days } },
          { subscriptionEndDate: { $gte: now, $lte: in30Days } },
          { planExpiryDate:      { $gte: now, $lte: in30Days } },
        ],
      }).select('hotelName subscriptionType trialEndDate subscriptionEndDate').lean(),

      // Last 5 paid subscription records for "recent payments" display
      Subscription.find({ status: 'active' })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    let mrr = 0;
    const breakdown: { plan: string; count: number; monthlyPrice: number; contribution: number }[] = [];

    for (const row of planAgg as any[]) {
      const plan  = row._id || 'trial';
      const price = getPriceForPlan(plan);
      const contrib = price * row.count;
      mrr += contrib;
      breakdown.push({ plan, count: row.count, monthlyPrice: price, contribution: contrib });
    }

    const expectedRenewalRevenue = (renewingHotels as any[]).reduce((sum, h) => {
      return sum + getPriceForPlan(h.subscriptionType);
    }, 0);

    return res.json({
      mrr,
      arr:                    mrr * 12,
      expectedRenewalRevenue,
      renewingCount:          renewingHotels.length,
      breakdown:              breakdown.sort((a, b) => b.contribution - a.contribution),
      recentSubscriptions:    recentSubs,
    });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── Hotel Growth ──────────────────────────────────────────────────────────────
//
// GET /api/superadmin/dashboard/hotel-growth?period=7d|30d|12m
// Time-bucketed hotel registration counts for the growth graph.
//
router.get('/dashboard/hotel-growth', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const period = (['7d', '30d', '12m'].includes(req.query.period as string)
      ? req.query.period as string
      : '30d');

    const now = new Date();
    let startDate: Date;
    let groupId: Record<string, any>;

    if (period === '7d') {
      startDate = new Date(now.getTime() - 7 * 86_400_000);
      groupId   = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };
    } else if (period === '30d') {
      startDate = new Date(now.getTime() - 30 * 86_400_000);
      groupId   = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };
    } else {
      // 12 months
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      groupId   = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } };
    }

    const data = await Hotel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id:      groupId,
          total:    { $sum: 1 },
          approved: { $sum: { $cond: [{ $ne: ['$status', 'pending'] }, 1, 0] } },
          trial:    { $sum: { $cond: [{ $eq: ['$status', 'trial'] }, 1, 0] } },
          active:   { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]);

    const totalInPeriod = (data as any[]).reduce((s, d) => s + d.total, 0);

    return res.json({ period, data, totalInPeriod });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── Failed Payments ───────────────────────────────────────────────────────────
//
// GET /api/superadmin/dashboard/failed-payments
// Counts from the Subscription model + overdue active hotels.
//
router.get('/dashboard/failed-payments', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date();

    const [pending, failed, overdue, recent] = await Promise.all([
      Subscription.countDocuments({ status: 'pending' }),
      Subscription.countDocuments({ status: 'expired' }),

      // Overdue: paid-plan hotels whose subscription end date has passed
      Hotel.countDocuments({
        status: 'active',
        subscriptionType: { $in: ['starter', 'professional', 'enterprise'] },
        $or: [
          { subscriptionEndDate: { $lt: now } },
          { planExpiryDate:       { $lt: now } },
        ],
      }),

      // Last 10 failed/pending subscriptions for detail view
      Subscription.find({ status: { $in: ['pending', 'expired', 'cancelled'] } })
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
    ]);

    return res.json({
      pending,
      failed,
      overdue,
      total:  pending + failed + overdue,
      recent,
    });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── Device Licensing ──────────────────────────────────────────────────────────
//
// GET /api/superadmin/dashboard/device-licensing
// Platform-wide device slot usage grouped by subscription plan.
//
router.get('/dashboard/device-licensing', superAdminAuth, async (_req: Request, res: Response) => {
  try {
    const [totalDevices, activeDevices, blockedDevices, planAgg, deviceVersionAgg] = await Promise.all([
      Device.countDocuments(),
      Device.countDocuments({ isActive: true }),
      Device.countDocuments({ isActive: false }),

      // Hotels by plan (to compute total allowed slots)
      Hotel.aggregate([
        { $match: { status: { $in: ['active', 'trial'] } } },
        { $group: { _id: '$subscriptionType', hotelCount: { $sum: 1 } } },
      ]),

      // Active devices per plan (via hotel join)
      Device.aggregate([
        { $match: { isActive: true } },
        {
          $lookup: {
            from:         'hotels',
            localField:   'hotelId',
            foreignField: '_id',
            as:           'hotel',
          },
        },
        { $unwind: { path: '$hotel', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$hotel.subscriptionType', activeCount: { $sum: 1 } } },
      ]),
    ]);

    const activeByPlan: Record<string, number> = {};
    for (const row of deviceVersionAgg as any[]) activeByPlan[row._id || 'unknown'] = row.activeCount;

    const byPlan = (planAgg as any[]).map((row: any) => {
      const plan          = row._id || 'trial';
      const allowedPerHotel = getDeviceLimitForPlan(plan);
      return {
        plan,
        allowedPerHotel,
        hotelCount:    row.hotelCount,
        totalAllowed:  allowedPerHotel * row.hotelCount,
        activeDevices: activeByPlan[plan] || 0,
      };
    });

    return res.json({
      total:   totalDevices,
      active:  activeDevices,
      blocked: blockedDevices,
      byPlan:  byPlan.sort((a, b) => b.activeDevices - a.activeDevices),
    });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

// ── Top Hotels ────────────────────────────────────────────────────────────────
//
// GET /api/superadmin/dashboard/top-hotels?by=revenue|orders|activity&period=today|week|month&limit=10
// Leaderboard for the three "Top Hotels" tabs.
//
router.get('/dashboard/top-hotels', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const by     = (['revenue', 'orders', 'activity'].includes(req.query.by as string) ? req.query.by as string : 'revenue');
    const period = (['today', 'week', 'month'].includes(req.query.period as string)    ? req.query.period as string : 'today');
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));

    const now = new Date();
    let startDate: Date;
    if (period === 'today') {
      startDate = new Date(now); startDate.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 86_400_000);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    if (by === 'activity') {
      const results = await Device.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$hotelId', lastSeen: { $max: '$lastSeen' }, deviceCount: { $sum: 1 } } },
        { $sort: { lastSeen: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from:         'hotels',
            localField:   '_id',
            foreignField: '_id',
            as:           'hotel',
          },
        },
        { $unwind: '$hotel' },
        {
          $project: {
            hotelId:      '$_id',
            hotelName:    '$hotel.hotelName',
            city:         '$hotel.city',
            plan:         '$hotel.subscriptionType',
            lastSeen:     1,
            deviceCount:  1,
          },
        },
      ]);
      return res.json({ by, period, hotels: results });
    }

    // Revenue or orders — aggregate from Order collection
    const valueExpr = by === 'revenue'
      ? { $sum: '$grandTotal' }
      : { $sum: 1 };

    const results = await Order.aggregate([
      { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: startDate } } },
      { $group: { _id: '$hotelId', value: valueExpr } },
      { $sort: { value: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from:         'hotels',
          localField:   '_id',
          foreignField: '_id',
          as:           'hotel',
        },
      },
      { $unwind: '$hotel' },
      {
        $project: {
          hotelId:   '$_id',
          hotelName: '$hotel.hotelName',
          city:      '$hotel.city',
          plan:      '$hotel.subscriptionType',
          value:     1,
        },
      },
    ]);

    return res.json({ by, period, hotels: results });
  } catch (error) { return sendError(res, 500, 'Server error', error); }
});

export default router;
