import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import Reservation from '../models/Reservation';
import Order from '../models/Order';
import CustomerProfile from '../models/CustomerProfile';
import Table from '../models/Table';
import { sendError } from '../utils/sendError';

// GET /api/search?q=  — top-bar search across reservations, orders, customers
// and tables (name, phone, order number, table number). Admin only, like the
// Orders and Customers screens the results link to.

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

const PER_GROUP = 5;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ reservations: [], orders: [], customers: [], tables: [] });

    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const re      = new RegExp(escapeRe(q), 'i');
    const digits  = q.replace(/\D/g, '');
    // Phones are stored in different formats (+91…, 10-digit) — match on digits.
    const phoneRe = digits.length >= 3 ? new RegExp(escapeRe(digits)) : null;

    const [reservations, orders, customers, tables] = await Promise.all([
      Reservation.find(
        { hotelId, $or: [{ customerName: re }, ...(phoneRe ? [{ phone: phoneRe }] : [])] },
        { customerName: 1, phone: 1, date: 1, time: 1, partySize: 1, status: 1, tableNumber: 1 },
      ).sort({ date: -1 }).limit(PER_GROUP).lean(),

      Order.find(
        {
          hotelId,
          $or: [
            { orderNumber: re },
            { customerName: re },
            ...(phoneRe ? [{ customerPhone: phoneRe }] : []),
          ],
        },
        { orderNumber: 1, customerName: 1, tableNumber: 1, grandTotal: 1, status: 1, createdAt: 1 },
      ).sort({ createdAt: -1 }).limit(PER_GROUP).lean(),

      CustomerProfile.find(
        { hotelId, $or: [{ name: re }, ...(phoneRe ? [{ phone: phoneRe }] : [])] },
        { name: 1, phone: 1, lastVisitAt: 1 },
      ).sort({ lastVisitAt: -1 }).limit(PER_GROUP).lean(),

      Table.find(
        { hotelId, $or: [{ name: re }, ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : [])] },
        { number: 1, name: 1, status: 1 },
      ).sort({ number: 1 }).limit(PER_GROUP).lean(),
    ]);

    return res.json({ reservations, orders, customers, tables });
  } catch (err) {
    return sendError(res, 500, 'Search failed', err);
  }
});

export default router;
