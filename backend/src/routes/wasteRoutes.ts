import { Router, Response } from 'express';
import WasteLog from '../models/WasteLog';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import mongoose from 'mongoose';

const router = Router();
router.use(authMiddleware);

// GET waste logs with optional date filter
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { hotelId: req.hotelId };
    if (req.query.date) {
      const date  = new Date(req.query.date as string);
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end   = new Date(date); end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    } else if (req.query.from && req.query.to) {
      const from = new Date(req.query.from as string);
      const to   = new Date(req.query.to as string); to.setHours(23, 59, 59, 999);
      filter.date = { $gte: from, $lte: to };
    }
    const logs = await WasteLog.find(filter).sort({ date: -1 });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// GET waste analytics — top wasted items + total loss
router.get('/analytics', async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date  = new Date(dateStr);
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);

    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);

    const [summary, topItems, byReason] = await Promise.all([
      WasteLog.aggregate([
        { $match: { hotelId: hotelObjId, date: { $gte: start, $lte: end } } },
        { $group: { _id: null, totalLoss: { $sum: '$estimatedLoss' }, totalEntries: { $sum: 1 } } },
      ]),
      WasteLog.aggregate([
        { $match: { hotelId: hotelObjId, date: { $gte: start, $lte: end } } },
        { $group: { _id: '$productName', totalQty: { $sum: '$quantity' }, totalLoss: { $sum: '$estimatedLoss' } } },
        { $sort: { totalLoss: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, productName: '$_id', totalQty: 1, totalLoss: 1 } },
      ]),
      WasteLog.aggregate([
        { $match: { hotelId: hotelObjId, date: { $gte: start, $lte: end } } },
        { $group: { _id: '$reason', count: { $sum: 1 }, totalLoss: { $sum: '$estimatedLoss' } } },
      ]),
    ]);

    res.json({
      date: dateStr,
      totalLoss:    summary[0]?.totalLoss || 0,
      totalEntries: summary[0]?.totalEntries || 0,
      topItems,
      byReason,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST log waste
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const log = new WasteLog({ ...req.body, hotelId: req.hotelId });
    await log.save();
    res.status(201).json(log);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// DELETE
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const log = await WasteLog.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!log) return res.status(404).json({ message: 'Log not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
