import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Notification from '../models/Notification';
import NotificationRead from '../models/NotificationRead';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// GET /api/notifications — notifications for this hotel (unread first)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const hotelObjectId = new mongoose.Types.ObjectId(req.hotelId!);
    const now = new Date();

    const notifications = await Notification.find({
      isActive: true,
      $and: [
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
        { $or: [{ targetHotels: { $size: 0 } }, { targetHotels: hotelObjectId }] },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    if (notifications.length === 0) {
      return res.json({ notifications: [], unreadCount: 0 });
    }

    const notificationIds = notifications.map((n: any) => n._id);
    const readRecords = await NotificationRead.find({
      hotelId: hotelObjectId,
      notificationId: { $in: notificationIds },
    }).select('notificationId').lean();

    const readSet = new Set(readRecords.map((r: any) => r.notificationId.toString()));

    const withReadStatus = notifications.map((n: any) => ({
      ...n,
      isRead: readSet.has(n._id.toString()),
    }));

    const unreadCount = withReadStatus.filter((n) => !n.isRead).length;

    return res.json({ notifications: withReadStatus, unreadCount });
  } catch (error) {
    sendError(res, 500, 'Failed to fetch notifications', error);
  }
});

// PUT /api/notifications/:id/read — mark notification as read
router.put('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const hotelObjectId = new mongoose.Types.ObjectId(req.hotelId!);
    const notificationId = new mongoose.Types.ObjectId(req.params.id);
    await NotificationRead.updateOne(
      { notificationId, hotelId: hotelObjectId },
      { $setOnInsert: { notificationId, hotelId: hotelObjectId, readAt: new Date() } },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (error) {
    sendError(res, 500, 'Failed to mark notification as read', error);
  }
});

// PUT /api/notifications/read-all — mark all active notifications as read
router.put('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    const hotelObjectId = new mongoose.Types.ObjectId(req.hotelId!);
    const now = new Date();

    const active = await Notification.find({ isActive: true })
      .select('_id')
      .limit(500)
      .lean();

    if (active.length === 0) return res.json({ ok: true });

    const ops = active.map((n: any) => ({
      updateOne: {
        filter: { notificationId: n._id, hotelId: hotelObjectId },
        update: { $setOnInsert: { notificationId: n._id, hotelId: hotelObjectId, readAt: now } },
        upsert: true,
      },
    }));

    await NotificationRead.bulkWrite(ops, { ordered: false });
    return res.json({ ok: true });
  } catch (error) {
    sendError(res, 500, 'Failed to mark all notifications as read', error);
  }
});

export default router;
