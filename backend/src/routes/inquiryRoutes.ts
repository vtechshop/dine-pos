import { Router, Request, Response } from 'express';
import { makeRateLimiter } from '../utils/rateLimiter';
import Inquiry from '../models/Inquiry';
import Lead from '../models/Lead';
import { sendError } from '../utils/sendError';
import { validateEmail } from '../utils/validation';
import { createFromInquiry } from '../services/leadService';
import { io } from '../server';
import { logger } from '../utils/logger';

// 10 submissions per hour per IP — prevents marketing form spam
const rl = makeRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many submissions. Please try again later.' },
});

const router = Router();

// POST /api/inquiries/contact
router.post('/contact', rl, async (req: Request, res: Response) => {
  const { name, email, phone, restaurant, message } = req.body;

  if (!name?.trim())    return res.status(400).json({ message: 'Name is required' });
  if (!email?.trim() || !validateEmail(String(email))) {
    return res.status(400).json({ message: 'A valid email address is required' });
  }
  if (!message?.trim()) return res.status(400).json({ message: 'Message is required' });

  try {
    // M13: duplicate detection — same email submitted contact within 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dupe = await Lead.findOne({ email: String(email).trim().toLowerCase(), source: 'website_contact', createdAt: { $gte: since } });
    if (dupe) {
      return res.status(200).json({ message: 'Thank you! We already have your enquiry and will be in touch soon.', id: dupe._id });
    }

    const inquiry = await Inquiry.create({
      type:       'contact',
      name:       String(name).trim().slice(0, 100),
      email:      String(email).trim().toLowerCase().slice(0, 200),
      phone:      String(phone || '').trim().slice(0, 20),
      restaurant: String(restaurant || '').trim().slice(0, 200),
      message:    String(message).trim().slice(0, 2000),
    });

    // Async lead creation — does not block the response
    createFromInquiry(inquiry, io).catch(err =>
      logger.error('inquiryRoutes createFromInquiry error', { err: String(err) }),
    );

    return res.status(201).json({
      message: 'Thank you! We will get back to you within one business day.',
      id: inquiry._id,
    });
  } catch (err) {
    return sendError(res, 500, 'Submission failed', err);
  }
});

// POST /api/inquiries/demo
router.post('/demo', rl, async (req: Request, res: Response) => {
  const { name, email, phone, restaurant, outlets, preferredDate, preferredTime, notes } = req.body;

  if (!name?.trim())  return res.status(400).json({ message: 'Name is required' });
  if (!email?.trim() || !validateEmail(String(email))) {
    return res.status(400).json({ message: 'A valid email address is required' });
  }
  if (!phone?.trim()) return res.status(400).json({ message: 'Phone number is required' });

  try {
    // M13: duplicate detection — same phone submitted demo within 48h
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const dupe = await Lead.findOne({ phone: String(phone).trim(), source: 'website_demo', createdAt: { $gte: since } });
    if (dupe) {
      return res.status(200).json({ message: 'Demo booked! We will confirm your slot via WhatsApp or email shortly.', id: dupe._id });
    }

    const inquiry = await Inquiry.create({
      type:          'demo',
      name:          String(name).trim().slice(0, 100),
      email:         String(email).trim().toLowerCase().slice(0, 200),
      phone:         String(phone).trim().slice(0, 20),
      restaurant:    String(restaurant || '').trim().slice(0, 200),
      outlets:       String(outlets || '').trim(),
      preferredDate: String(preferredDate || '').trim(),
      preferredTime: String(preferredTime || '').trim(),
      notes:         String(notes || '').trim().slice(0, 1000),
    });

    // Async lead creation — does not block the response
    createFromInquiry(inquiry, io).catch(err =>
      logger.error('inquiryRoutes createFromInquiry error', { err: String(err) }),
    );

    return res.status(201).json({
      message: 'Demo booked! We will confirm your slot via WhatsApp or email shortly.',
      id: inquiry._id,
    });
  } catch (err) {
    return sendError(res, 500, 'Submission failed', err);
  }
});

export default router;
