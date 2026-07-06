import { Router, Response } from 'express';
import Reservation from '../models/Reservation';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';

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
    const reservations = await Reservation.find(filter).sort({ date: 1, time: 1 });
    res.json(reservations);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST create reservation
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const reservation = new Reservation({ ...req.body, hotelId: req.hotelId });
    await reservation.save();
    res.status(201).json(reservation);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
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
    res.status(500).json({ message: 'Server error', error });
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
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// DELETE
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const r = await Reservation.findOneAndDelete({ _id: req.params.id, hotelId: req.hotelId });
    if (!r) return res.status(404).json({ message: 'Reservation not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
