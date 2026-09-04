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
import { startOfBusinessDay, endOfBusinessDay } from '../utils/businessDate';

const router = Router();

// D-11: Split limiters — slot-check (GET) is read-only and can be more generous;
// booking (POST) is a mutation and must be stricter.
const slotsLimiter   = makeRateLimiter({ windowMs: 60_000, max: 30 });
const bookingLimiter = makeRateLimiter({ windowMs: 60_000, max: 5 });

// Canonical time regex matching Reservation.parseTimeToMinutes format
const TIME_RE = /^(1[0-2]|0?[1-9]):[0-5]\d\s*(AM|PM)$/i;

// GET /:hotelId/slots?date=YYYY-MM-DD — booked slots for a date
router.get('/:hotelId/slots', slotsLimiter, async (req: Request, res: Response) => {
  try {
    const { hotelId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({ message: 'Invalid hotel' });
    }

    const hotel = await Hotel.findOne({ _id: hotelId, status: 'active' }).select('name').lean();
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });

    const dateStr = req.query.date as string;
    if (!dateStr) return res.status(400).json({ message: 'date is required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ message: 'Invalid date format (expected YYYY-MM-DD)' });

    // D-05: Use IST-aware boundaries so reservations near midnight are bucketed correctly
    const start = startOfBusinessDay(dateStr, 'Asia/Kolkata');
    const end   = endOfBusinessDay(dateStr, 'Asia/Kolkata');

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
router.post('/:hotelId/book', bookingLimiter, async (req: Request, res: Response) => {
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

    // D-07: validate phone format — require 10–15 digits
    const phoneDigits = String(phone).replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return res.status(400).json({ message: 'phone must contain 10–15 digits' });
    }

    if (!partySize || partySize < 1) return res.status(400).json({ message: 'partySize must be ≥ 1' });
    // D-08: enforce partySize upper bound (matches the Reservation model max:200)
    if (parseInt(partySize) > 200) return res.status(400).json({ message: 'partySize cannot exceed 200' });

    if (!dateStr) return res.status(400).json({ message: 'date is required' });
    if (!time)    return res.status(400).json({ message: 'time is required' });

    // D-06: reject malformed time values that would silently become 0 in parseTimeToMinutes
    if (!TIME_RE.test(String(time))) {
      return res.status(400).json({ message: "time must be in h:mm AM/PM format (e.g. 7:30 PM)" });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) {
      return res.status(400).json({ message: 'Invalid date format (expected YYYY-MM-DD)' });
    }
    const dateObj = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(dateObj.getTime())) return res.status(400).json({ message: 'Invalid date' });

    // D-05: Compute IST "today" for past-date comparison
    const nowIst    = new Date(Date.now() + 330 * 60_000); // shift to IST
    const todayStr  = nowIst.toISOString().slice(0, 10);
    const todayDate = new Date(todayStr + 'T00:00:00Z');

    if (dateObj < todayDate) {
      return res.status(400).json({ message: 'Cannot book a reservation in the past' });
    }

    // D-08: Prevent booking a time slot that has already passed today (same-day past-time)
    if (dateStr === todayStr) {
      const slotMins = parseTimeToMinutes(String(time));
      const nowMins  = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
      if (slotMins <= nowMins) {
        return res.status(400).json({ message: 'Cannot book a time slot that has already passed today' });
      }
    }

    const reservation = await Reservation.create({
      hotelId,
      customerName: customerName.trim(),
      phone:        phone.trim(),
      partySize:    parseInt(partySize),
      date:         dateObj,
      time,
      startMinutes: parseTimeToMinutes(String(time)),
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
