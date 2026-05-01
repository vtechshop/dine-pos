import { Router, Request, Response } from 'express';
import ChatMessage from '../models/ChatMessage';

const router = Router();

// GET messages for a table
router.get('/:tableNumber', async (req: Request, res: Response) => {
  try {
    const messages = await ChatMessage.find({ tableNumber: req.params.tableNumber })
      .sort({ createdAt: 1 })
      .limit(100);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET all tables with unread count (for admin)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const tables = await ChatMessage.aggregate([
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
router.patch('/:tableNumber/read', async (req: Request, res: Response) => {
  try {
    await ChatMessage.updateMany(
      { tableNumber: req.params.tableNumber, sender: 'customer', read: false },
      { $set: { read: true } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

export default router;
