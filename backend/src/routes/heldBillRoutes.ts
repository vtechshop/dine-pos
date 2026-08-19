import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireActiveStaff } from '../middleware/staffAuth';
import HeldBill from '../models/HeldBill';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireActiveStaff);

// GET /api/held-bills — list held bills for this hotel, newest first
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const bills = await HeldBill.find({ hotelId: req.hotelId })
      .sort({ heldAt: -1 })
      .lean();
    res.json(bills);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// POST /api/held-bills — create a new held bill
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { label, items, metadata, heldAt, terminal } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items array is required and must not be empty' });
    }
    const bill = await HeldBill.create({
      hotelId:     new mongoose.Types.ObjectId(req.hotelId),
      cashierId:   req.cashierId   ?? '',
      cashierName: req.cashierName ?? '',
      label:       label ?? '',
      items,
      metadata:    metadata ?? {},
      heldAt:      heldAt ? new Date(heldAt) : new Date(),
      terminal:    terminal ?? '',
    });
    res.status(201).json(bill);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// DELETE /api/held-bills/:id — remove a held bill scoped to this hotel
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const bill = await HeldBill.findOneAndDelete({
      _id:     req.params.id,
      hotelId: req.hotelId,
    });
    if (!bill) return res.status(404).json({ message: 'Held bill not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
