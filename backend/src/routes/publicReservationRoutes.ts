/**
 * Public self-booking endpoints.
 * hotelId comes from the URL path — NEVER from the request body.
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Hotel from '../models/Hotel';
import Reservation, { parseTimeToMinutes } from '../models/Reservation';
import { makeRateLimiter } from '../utils/rateLimiter';
import { sendError } from '../utils/sendError';

const router = Router();
const limiter = makeRateLimiter({ windowMs: 60_000, max: 10 });

// GET /:hotelId/slots?date=YYYY-MM-DD — booked slots for a date
router.get('/:hotelId/slots', limiter, async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({ message: 'Invalid hotel' });
    }

    const hotel = await Hotel.findOne({ _id: hotelId, status: 'active' }).select('name').lean();
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    const dateStr = req.query.date as string;
    if (!dateStr) return res.status(400).json({ message: 'date is required' });

    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid date' });
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    const end   = new Date(d); end.setHours(23, 59, 59, 999);

    const taken = await Reservation.find({
      hotelId,
      date: { $gte: start, $lte: end },
      status: { $nin: ['cancelled', 'no_show'] },
    }).select('time startMinutes durationMinutes tableId tableNumber status').lean();

    res.json({ hotelName: (hotel as any).name, date: dateStr, taken });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch slots', err);
  }
});

// POST /:hotelId/book — guest self-booking (creates a pending reservation)
router.post('/:hotelId/book', limiter, async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({ message: 'Invalid hotel' });
    }

    const hotel = await Hotel.findOne({ _id: hotelId, status: 'active' }).select('_id').lean();
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    const {
      customerName, phone, partySize,
      date: dateStr, time,
      notes = '', occasion = '',
    } = req.body as Record<string, any>;

    if (!customerName?.trim()) return res.status(400).json({ message: 'customerName is required' });
    if (!phone?.trim())        return res.status(400).json({ message: 'phone is required' });
    if (!partySize || partySize < 1) return res.status(400).json({ message: 'partySize must be ≥ 1' });
    if (!dateStr)              return res.status(400).json({ message: 'date is required' });
    if (!time)                 return res.status(400).json({ message: 'time is required' });

    const dateObj = new Date(dateStr + 'T00:00:00');
    if (isNaN(dateObj.getTime())) return res.status(400).json({ message: 'Invalid date' });

    // Prevent past-date bookings
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (dateObj < today) return res.status(400).json({ message: 'Cannot book a reservation in the past' });

    const reservation = await Reservation.create({
      hotelId,
      customerName: customerName.trim(),
      phone:        phone.trim(),
      partySize:    parseInt(partySize),
      date:         dateObj,
      time,
      startMinutes: parseTimeToMinutes(time),
      notes:        String(notes).trim(),
      occasion:     String(occasion).trim(),
      source:       'website',
      status:       'pending',
    });

    res.status(201).json({
      message:       'Reservation request submitted. The restaurant will confirm shortly.',
      reservationId: reservation._id,
    });
  } catch (err) {
    sendError(res, 400, 'Failed to create reservation', err);
  }
});

export default router;
