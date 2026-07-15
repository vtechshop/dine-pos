import { Router, Response } from 'express';
import ChatMessage from '../models/ChatMessage';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('customerChat'));

// GET messages for a table
router.get('/:tableNumber', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
    const skip  = Math.max(parseInt(req.query.skip  as string) || 0,   0);
    const [messages, total] = await Promise.all([
      ChatMessage.find({ hotelId, tableNumber: req.params.tableNumber })
        .sort({ createdAt: 1 }).skip(skip).limit(limit),
      ChatMessage.countDocuments({ hotelId, tableNumber: req.params.tableNumber }),
    ]);
    res.json({ messages, total, limit, skip });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET all tables with unread count (for admin)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    const tables = await ChatMessage.aggregate([
      { $match: { hotelId } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$tableNumber',
          lastMessage: { $first: '$message' },
          lastSender: { $first: '$sender' },
          lastTime: { $first: '$createdAt' },
          unread: {
            $sum: { $cond: [{ $and: [{ $eq: ['$sender', 'customer'] }, { $eq: ['$read', false] }] }, 1, 0] },
          },
        },
      },
      { $sort: { lastTime: -1 } },
    ]);
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// PATCH mark table messages as read
router.patch('/:tableNumber/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = req.hotelId!;
    await ChatMessage.updateMany(
      { hotelId, tableNumber: req.params.tableNumber, sender: 'customer', read: false },
      { $set: { read: true } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

export default router;
