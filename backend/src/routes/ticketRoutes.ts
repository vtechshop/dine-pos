import { Router, Request, Response } from 'express';
import Ticket from '../models/Ticket';

const router = Router();

// Super admin auth middleware
const superAdminAuth = (req: Request, res: Response, next: Function) => {
  const id = req.headers['x-super-admin-id'] as string;
  const pass = req.headers['x-super-admin-pass'] as string;
  if (id === (process.env.SUPER_ADMIN_ID || 'superadmin') && pass === (process.env.SUPER_ADMIN_PASS || 'super1234')) {
    return next();
  }
  return res.status(401).json({ message: 'Unauthorized' });
};

// ── Hotel routes ───────────────────────────────────────────────────────────

// POST /api/tickets — raise a ticket
router.post('/', async (req: Request, res: Response) => {
  try {
    const { hotelName, hotelPhone, subject, description, category, priority } = req.body;
    if (!hotelName || !hotelPhone || !subject || !description) {
      return res.status(400).json({ message: 'hotelName, hotelPhone, subject and description are required' });
    }
    const ticket = await Ticket.create({ hotelName, hotelPhone, subject, description, category, priority });
    return res.status(201).json(ticket);
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
});

// GET /api/tickets/hotel/:phone — get tickets for a hotel
router.get('/hotel/:phone', async (req: Request, res: Response) => {
  try {
    const tickets = await Ticket.find({ hotelPhone: req.params.phone }).sort({ createdAt: -1 });
    return res.json(tickets);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/tickets/:id/reply — hotel adds a reply
router.post('/:id/reply', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: 'Message required' });
    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { $push: { replies: { message, by: 'hotel' } }, status: 'open' },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    return res.json(ticket);
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
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
