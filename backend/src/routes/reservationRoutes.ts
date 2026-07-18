import { Router, Response } from 'express';
import Reservation from '../models/Reservation';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// GET reservations — optional ?date=YYYY-MM-DD filter
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { hotelId: req.hotelId };
    if (req.query.date) {
      const date = new Date(req.query.date as string);
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end   = new Date(date); end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip  = Math.max(parseInt(req.query.skip  as string) || 0,  0);
    const [reservations, total] = await Promise.all([
      Reservation.find(filter).sort({ date: 1, time: 1 }).skip(skip).limit(limit),
      Reservation.countDocuments(filter),
    ]);
    res.json({ reservations, total, limit, skip });
  } catch (error) {
    sendError(res, 500, 'Failed to fetch reservations', error);
  }
});

// POST create reservation
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const reservation = new Reservation({ ...req.body, hotelId: req.hotelId });
    await reservation.save();
    res.status(201).json(reservation);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// PATCH update status
router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const allowed = ['confirmed', 'seated', 'cancelled', 'no-show'];
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });
  try {
    const r = await Reservation.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { status },
      { new: true }
    );
    if (!r) return res.status(404).json({ message: 'Reservation not found' });
    res.json(r);
  } catch (error) {
    sendError(res, 500, 'Failed to update reservation status', error);
  }
});

// PUT full update
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const r = await Reservation.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!r) return res.status(404).json({ message: 'Reservation not found' });
    res.json(r);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// DELETE
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const r = await Reservation.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!r) return res.status(404).json({ message: 'Reservation not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    sendError(res, 500, 'Failed to delete reservation', error);
  }
});

export default router;
