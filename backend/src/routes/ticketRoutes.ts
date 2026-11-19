import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Ticket from '../models/Ticket';
import Hotel from '../models/Hotel';
import { sendError } from '../utils/sendError';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

const safeEqual = (a: string, b: string): boolean => {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  } catch { return false; }
};

// Exported for unit testing — never call with user-supplied envId/envPass; always pass process.env values.
export function verifySuperAdminCredentials(
  id: string | undefined,
  pass: string | undefined,
  envId: string | undefined,
  envPass: string | undefined,
): boolean {
  if (!id || !pass || !envId || !envPass) return false;
  return safeEqual(id, envId) && safeEqual(pass, envPass);
}

// Super admin auth — JWT Bearer (SA app / web dashboard) or credential headers (CI / automation)
const superAdminAuth = (req: Request, res: Response, next: Function) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), process.env.SUPER_ADMIN_JWT_SECRET!) as any;
      if (payload?.role === 'superadmin') return next();
    } catch { /* invalid or expired token */ }
  }
  // Credential headers: same gate as superAdminRoutes — off in production unless
  // explicitly enabled, so this router is not an unthrottled password oracle.
  const credHeaderEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.ENABLE_SUPERADMIN_CREDENTIAL_HEADER_AUTH === 'true';
  if (credHeaderEnabled) {
    const id   = req.headers['x-super-admin-id']   as string | undefined;
    const pass = req.headers['x-super-admin-pass'] as string | undefined;
    if (verifySuperAdminCredentials(id, pass, process.env.SUPER_ADMIN_ID, process.env.SUPER_ADMIN_PASS)) {
      return next();
    }
  }
  return res.status(401).json({ message: 'Unauthorized' });
};

// ── Hotel routes (JWT required) ────────────────────────────────────────────
// Tickets belong to the hotel in the JWT. hotelName / hotelPhone / :phone sent by
// the client are ignored (they let any user read, reply to or file tickets as
// another hotel). Legacy tickets without hotelId match on the hotel's stored phone.
async function ownTicketsFilter(hotelId: string): Promise<Record<string, unknown> | null> {
  const hotel = await Hotel.findById(hotelId).select('phone').lean<{ phone?: string }>();
  if (!hotel) return null;
  const or: Record<string, unknown>[] = [{ hotelId: new mongoose.Types.ObjectId(hotelId) }];
  if (hotel.phone) or.push({ hotelId: null, hotelPhone: hotel.phone });
  return { $or: or };
}

// POST /api/tickets — raise a ticket
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { subject, description, category, priority } = req.body;
    if (typeof subject !== 'string' || !subject.trim() || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ message: 'subject and description are required' });
    }
    const hotel = await Hotel.findById(req.hotelId).select('hotelName phone').lean<{ hotelName?: string; phone?: string }>();
    if (!hotel) return res.status(404).json({ message: 'Hotel not found' });
    const ticket = await Ticket.create({
      hotelId:    new mongoose.Types.ObjectId(req.hotelId!),
      hotelName:  hotel.hotelName || req.hotelName || 'Hotel',
      hotelPhone: hotel.phone || '',
      subject, description, category, priority,
    });
    return res.status(201).json(ticket);
  } catch (error) {
    return sendError(res, 500, 'Failed to create ticket', error);
  }
});

// GET /api/tickets/hotel/:phone — this hotel's tickets (:phone kept for app
// compatibility but ignored — the hotel comes from the JWT)
router.get('/hotel/:phone', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const filter = await ownTicketsFilter(req.hotelId!);
    if (!filter) return res.json([]);
    const tickets = await Ticket.find(filter).sort({ createdAt: -1 });
    return res.json(tickets);
  } catch (error) {
    return sendError(res, 500, 'Server error', error);
  }
});

// POST /api/tickets/:id/reply — hotel adds a reply to one of its own tickets
router.post('/:id/reply', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { message } = req.body;
    if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ message: 'Message required' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Ticket not found' });
    const filter = await ownTicketsFilter(req.hotelId!);
    if (!filter) return res.status(404).json({ message: 'Ticket not found' });
    const ticket = await Ticket.findOneAndUpdate(
      { _id: req.params.id, ...filter },
      { $push: { replies: { message, by: 'hotel' } }, status: 'open' },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    return res.json(ticket);
  } catch (error) {
    return sendError(res, 500, 'Server error', error);
  }
});

// ── Super Admin routes ─────────────────────────────────────────────────────

// GET /api/tickets — all tickets (super admin)
router.get('/', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    const tickets = await Ticket.find(filter).sort({ createdAt: -1 });
    return res.json(tickets);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/tickets/:id/admin-reply — super admin replies
router.post('/:id/admin-reply', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: 'Message required' });
    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { $push: { replies: { message, by: 'superadmin' } }, status: 'in-progress' },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    return res.json(ticket);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/tickets/:id/status — update ticket status (super admin)
router.put('/:id/status', superAdminAuth, async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    return res.json(ticket);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
