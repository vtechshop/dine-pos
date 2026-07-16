/**
 * QR Guest Session Routes  (Architecture v1.1 — Phase 3)
 *
 * All endpoints are public (no auth token required).
 * Mount point: /api/public/qr
 *
 * Endpoints:
 *   POST /session  — initialise or resume a QR guest session
 *   POST /orders   — place an order within an existing QR guest session
 *   GET  /bill     — view running guest bill by token
 *
 * Backward compatibility: only active when features.tableSessions === true.
 * Hotels with tableSessions === false continue using POST /api/public/orders unchanged.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Product from '../models/Product';
import Hotel from '../models/Hotel';
import type { CustomerIdentificationMode } from '../models/Hotel';
import TableSession from '../models/TableSession';
import Guest from '../models/Guest';
import CustomerProfile from '../models/CustomerProfile';
import Order from '../models/Order';
import DailyCounter from '../models/DailyCounter';
import { resolveHotelStatus } from '../middleware/auth';
import { sendError } from '../utils/sendError';
import { logger } from '../utils/logger';
import { guestLabel } from '../utils/guestLabel';
import { makeRateLimiter } from '../utils/rateLimiter';
import { io } from '../server';

const router = Router();

const qrReadLimiter = makeRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many requests. Please slow down.' },
});

const qrWriteLimiter = makeRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many requests. Please slow down.' },
});

// ── Shared helper: generate a per-hotel CustomerProfile sequential ID ─────────
// Uses the same DailyCounter mechanism as order numbers; key is permanent (not daily).
const generateCustomerId = async (hotelId: string): Promise<string> => {
  const key = `CUST-${hotelId}`;
  const counter = await DailyCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    { upsert: true, new: true }
  );
  const shortId = hotelId.slice(-6).toUpperCase();
  return `CUST-${shortId}-${String(counter!.seq).padStart(4, '0')}`;
};

// ── Shared helper: validate hotel is active + has required features ────────────
// Returns null and sends a response on failure; returns features on success.
async function validateHotelForQR(
  res: Response,
  hotelId: string,
  requireTableSessions: boolean
): Promise<{ tableSessions: boolean; customerIdentification: CustomerIdentificationMode; qrOrdering: boolean } | null> {
  const entry = await resolveHotelStatus(hotelId);

  if (!['trial', 'active'].includes(entry.status)) {
    res.status(403).json({ message: 'This hotel is not currently accepting orders' });
    return null;
  }

  const f = (entry.features ?? {}) as any;

  if (f.qrOrdering === false) {
    res.status(403).json({ code: 'FEATURE_DISABLED', message: 'QR ordering is not enabled for this hotel' });
    return null;
  }

  if (requireTableSessions && !f.tableSessions) {
    res.status(403).json({ code: 'FEATURE_DISABLED', message: 'Table session ordering is not enabled for this hotel' });
    return null;
  }

  return {
    tableSessions:          Boolean(f.tableSessions),
    customerIdentification: (f.customerIdentification as CustomerIdentificationMode) || 'disabled',
    qrOrdering:             f.qrOrdering !== false,
  };
}

// ── Shared helper: validate and price items against the product catalog ────────
// Returns null + sends a response on failure; returns priced items on success.
async function validateItems(
  res: Response,
  clientItems: any[],
  hotelId: string
): Promise<{ validatedItems: any[]; subtotal: number; taxTotal: number } | null> {
  const productIds = clientItems
    .map((i: any) => i.product)
    .filter((id: any) => mongoose.isValidObjectId(String(id ?? '')));

  const dbProducts = productIds.length > 0
    ? await Product.find({
        _id: { $in: productIds },
        hotelId,
        isAvailable: true,
        isDeleted: { $ne: true },
      }).select('_id name price taxPercent').lean()
    : [];

  const productMap: Record<string, any> = {};
  for (const p of dbProducts) productMap[(p._id as mongoose.Types.ObjectId).toString()] = p;

  let subtotal = 0;
  let taxTotal = 0;
  const validatedItems: any[] = [];

  for (const ci of clientItems) {
    if (!ci.product || !mongoose.isValidObjectId(String(ci.product))) continue;
    const prod = productMap[String(ci.product)];
    if (!prod) continue;
    const qty = Math.max(1, Math.floor(Number(ci.quantity) || 1));
    const taxAmt = (prod.price * qty * (prod.taxPercent || 0)) / 100;
    const total  = prod.price * qty + taxAmt;
    validatedItems.push({
      product:     prod._id,
      productName: prod.name,
      quantity:    qty,
      price:       prod.price,
      taxPercent:  prod.taxPercent || 0,
      taxAmount:   +taxAmt.toFixed(2),
      total:       +total.toFixed(2),
    });
    subtotal += prod.price * qty;
    taxTotal += taxAmt;
  }

  if (validatedItems.length === 0) {
    res.status(400).json({ message: 'No valid items found in the order' });
    return null;
  }

  return { validatedItems, subtotal, taxTotal };
}

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/public/qr/session
// Initialise a new QR guest session (first scan) or resume an existing one
// (returning scan with a valid guestToken in localStorage).
//
// Validation chain:
//   hotel active → qrOrdering enabled → tableSessions enabled
//   → open session exists for table
//   → if guestToken provided: validate against existing guest
//   → if new guest: collect name/phone per customerIdentification mode
//   → create guest (atomic $inc) + optional CustomerProfile
// ────────────────────────────────────────────────────────────────────────────────
router.post('/session', qrWriteLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { hotelId, tableNumber, guestToken, name, phone } = req.body as {
      hotelId?: string;
      tableNumber?: string;
      guestToken?: string;
      name?: string;
      phone?: string;
    };

    if (!hotelId || !mongoose.isValidObjectId(hotelId)) {
      res.status(400).json({ message: 'hotelId is required' });
      return;
    }
    const cleanTable = String(tableNumber ?? '').trim();
    if (!cleanTable) {
      res.status(400).json({ message: 'tableNumber is required' });
      return;
    }

    const features = await validateHotelForQR(res, hotelId, true);
    if (!features) return;

    const identMode = features.customerIdentification;

    // ── Find open session for this table ──────────────────────────────────────
    const session = await TableSession.findOne({
      hotelId: new mongoose.Types.ObjectId(hotelId),
      tableNumber: cleanTable,
      status: 'open',
    });

    if (!session) {
      res.status(404).json({
        code: 'SESSION_NOT_FOUND',
        message: 'No open session found for this table. Please ask a staff member to open your table.',
      });
      return;
    }

    // ── Returning-guest fast path: validate stored guestToken ─────────────────
    if (guestToken && typeof guestToken === 'string') {
      const existingGuest = await Guest.findOne({
        qrSessionToken: guestToken,
        hotelId: new mongoose.Types.ObjectId(hotelId),
      });

      const tokenOk =
        existingGuest &&
        existingGuest.status === 'active' &&
        String(existingGuest.sessionId) === String(session._id) &&
        (existingGuest.qrTokenExpiresAt === null || new Date() <= existingGuest.qrTokenExpiresAt);

      if (tokenOk && existingGuest) {
        logger.info('QR guest session reused', {
          hotelId,
          sessionId: String(session._id),
          tableNumber: session.tableNumber,
        });
        res.json({
          guestToken,
          expiresAt: existingGuest.qrTokenExpiresAt?.toISOString() || null,
          tableNumber: session.tableNumber,
          isReturning: true,
          customerIdentification: identMode,
          displayLabel: existingGuest.displayLabel,
        });
        return;
      }

      // Token present but invalid (expired, wrong session, guest billed/left/cancelled)
      if (existingGuest && existingGuest.qrTokenExpiresAt !== null && new Date() > existingGuest.qrTokenExpiresAt) {
        logger.info('QR token expired — creating new guest', {
          hotelId,
          tableNumber: session.tableNumber,
        });
      }

      // If customer info (name/phone) is NOT supplied, tell the client to show the form
      const needsName  = identMode === 'name_only' || identMode === 'name_mobile';
      const needsPhone = identMode === 'name_mobile';
      const cleanName  = String(name  ?? '').trim();
      const cleanPhone = String(phone ?? '').trim();

      if (needsName && !cleanName) {
        res.status(401).json({
          code: 'SESSION_EXPIRED',
          message: 'Your session has expired. Please provide your details to continue.',
          requiresName:  needsName,
          requiresPhone: needsPhone,
        });
        return;
      }
      if (needsPhone && !cleanPhone) {
        res.status(401).json({
          code: 'SESSION_EXPIRED',
          message: 'Your session has expired. Please provide your details to continue.',
          requiresName:  true,
          requiresPhone: true,
        });
        return;
      }
      // Fall through: token was invalid but customer info was provided — create a new guest below
    }

    // ── New-guest path: validate customer info per mode ───────────────────────
    const cleanName  = String(name  ?? '').trim().slice(0, 100);
    const cleanPhone = String(phone ?? '').trim().slice(0, 20);

    if (identMode === 'name_only' && !cleanName) {
      res.status(400).json({
        code: 'CUSTOMER_INFO_REQUIRED',
        message: 'Please enter your name to place an order',
        requiresName:  true,
        requiresPhone: false,
      });
      return;
    }
    if (identMode === 'name_mobile') {
      if (!cleanName) {
        res.status(400).json({
          code: 'CUSTOMER_INFO_REQUIRED',
          message: 'Please enter your name and mobile number to place an order',
          requiresName:  true,
          requiresPhone: true,
        });
        return;
      }
      if (!cleanPhone) {
        res.status(400).json({
          code: 'CUSTOMER_INFO_REQUIRED',
          message: 'Please enter your mobile number to place an order',
          requiresName:  true,
          requiresPhone: true,
        });
        return;
      }
    }

    // ── Atomic: allocate guest slot ───────────────────────────────────────────
    const updatedSession = await TableSession.findByIdAndUpdate(
      session._id,
      { $inc: { guestCount: 1 } },
      { new: true }
    );
    if (!updatedSession) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const guestNumber = updatedSession.guestCount;
    const newToken    = crypto.randomBytes(32).toString('hex');
    const expiresAt   = new Date(Date.now() + session.qrTimeoutMinutes * 60 * 1000);

    // displayLabel = customer name (if provided) or auto-alphabetic label
    const displayLabel =
      (identMode !== 'disabled' && cleanName) ? cleanName : guestLabel(guestNumber);

    // ── Find or create CustomerProfile (name_mobile only) ─────────────────────
    let customerId: mongoose.Types.ObjectId | null = null;

    if (identMode === 'name_mobile' && cleanPhone) {
      let profile = await CustomerProfile.findOne({
        hotelId: new mongoose.Types.ObjectId(hotelId),
        phone:   cleanPhone,
        status:  { $ne: 'merged' },
      });

      if (!profile) {
        const newCustomerId = await generateCustomerId(hotelId);
        profile = await CustomerProfile.create({
          hotelId:     new mongoose.Types.ObjectId(hotelId),
          customerId:  newCustomerId,
          name:        cleanName,
          phone:       cleanPhone,
          lastVisitAt: new Date(),
          visitCount:  1,
        });
        logger.info('CustomerProfile created via QR', {
          hotelId,
          customerId: newCustomerId,
        });
      } else {
        // Returning customer — update visit tracking (fire-and-forget)
        CustomerProfile.findByIdAndUpdate(profile._id, {
          $set: { lastVisitAt: new Date(), name: cleanName },
          $inc: { visitCount: 1 },
        }).catch(() => {});
      }

      customerId = profile._id as mongoose.Types.ObjectId;
    }

    // ── Create guest ──────────────────────────────────────────────────────────
    const guest = await Guest.create({
      sessionId:        session._id,
      hotelId:          new mongoose.Types.ObjectId(hotelId),
      tableId:          session.tableId,
      tableNumber:      session.tableNumber,
      customerId,
      guestNumber,
      displayLabel,
      qrSessionToken:   newToken,
      qrTokenExpiresAt: expiresAt,
    });

    logger.info('QR guest session created', {
      hotelId,
      sessionId:   String(session._id),
      tableNumber: session.tableNumber,
      guestNumber,
      identMode,
    });

    res.status(201).json({
      guestToken:             newToken,
      expiresAt:              expiresAt.toISOString(),
      tableNumber:            session.tableNumber,
      isReturning:            false,
      customerIdentification: identMode,
      displayLabel:           guest.displayLabel,
    });
  } catch (err: any) {
    sendError(res, 500, 'Failed to initialise QR session', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/public/qr/orders
// Place an order within an existing QR guest session.
//
// Full validation chain (per Architecture v1.1 §4):
//   hotel active → qrOrdering → tableSessions
//   → guest found by qrSessionToken (O(log n) via sparse unique index)
//   → guest.status === 'active'
//   → token not expired
//   → session found and open
//   → items validated against product catalog
//   → order created with sessionId + guestId
//   → guest.totalAmount incremented
//   → qrTokenExpiresAt nulled (first order clears idle timeout)
// ────────────────────────────────────────────────────────────────────────────────
router.post('/orders', qrWriteLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { hotelId, guestToken, items: clientItems, notes } = req.body as {
      hotelId?: string;
      guestToken?: string;
      items?: any[];
      notes?: string;
    };

    if (!hotelId || !mongoose.isValidObjectId(hotelId)) {
      res.status(400).json({ message: 'hotelId is required' });
      return;
    }
    if (!guestToken || typeof guestToken !== 'string') {
      res.status(400).json({ message: 'guestToken is required' });
      return;
    }
    if (!Array.isArray(clientItems) || clientItems.length === 0) {
      res.status(400).json({ message: 'items is required' });
      return;
    }

    // ── Hotel + feature validation ────────────────────────────────────────────
    const features = await validateHotelForQR(res, hotelId, true);
    if (!features) return;

    // ── Guest lookup (O(log n) — sparse unique index on qrSessionToken) ───────
    const guest = await Guest.findOne({
      qrSessionToken: guestToken,
      hotelId:        new mongoose.Types.ObjectId(hotelId),
    });

    if (!guest) {
      logger.warn('Invalid QR session token on order', { hotelId });
      res.status(401).json({
        code:    'INVALID_TOKEN',
        message: 'Invalid session. Please scan the QR code again.',
      });
      return;
    }

    // ── Guest status check ────────────────────────────────────────────────────
    if (guest.status !== 'active') {
      logger.info('QR order attempted on non-active guest', {
        hotelId,
        guestStatus: guest.status,
      });
      res.status(401).json({
        code:    'SESSION_EXPIRED',
        message: 'Your session has ended. Please scan the QR code again.',
      });
      return;
    }

    // ── Token expiry check (lazy: nulled after first order, so usually null) ──
    if (guest.qrTokenExpiresAt !== null && new Date() > guest.qrTokenExpiresAt) {
      logger.info('QR token expired on order attempt', {
        hotelId,
        tableNumber: guest.tableNumber,
      });
      res.status(401).json({
        code:    'SESSION_EXPIRED',
        message: 'Your session has timed out. Please scan the QR code again.',
      });
      return;
    }

    // ── Session validation ────────────────────────────────────────────────────
    const session = await TableSession.findOne({
      _id:     guest.sessionId,
      hotelId: new mongoose.Types.ObjectId(hotelId),
    });

    if (!session || session.status !== 'open') {
      logger.info('QR order on closed/missing session', {
        hotelId,
        sessionId: String(guest.sessionId),
      });
      res.status(401).json({
        code:    'SESSION_CLOSED',
        message: 'This table session has been closed. Please ask staff for assistance.',
      });
      return;
    }

    // ── Item validation + pricing (server-side; client prices never trusted) ──
    const itemResult = await validateItems(res, clientItems, hotelId);
    if (!itemResult) return;

    const { validatedItems, subtotal, taxTotal } = itemResult;
    const grandTotal = subtotal + taxTotal;

    // ── Generate order number (same atomic pattern as orderRoutes.ts) ─────────
    const dateStr    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const counterKey = `ORD-${dateStr}-${hotelId}`;
    const counter    = await DailyCounter.findOneAndUpdate(
      { key: counterKey },
      { $inc: { seq: 1 }, $setOnInsert: { key: counterKey } },
      { upsert: true, new: true }
    );
    const orderNumber = `ORD-${dateStr}-${String(counter!.seq).padStart(3, '0')}`;

    // ── Create order with full session/guest linkage ──────────────────────────
    const order = await Order.create({
      hotelId,
      orderNumber,
      items:          validatedItems,
      subtotal:       +subtotal.toFixed(2),
      taxTotal:       +taxTotal.toFixed(2),
      discountAmount: 0,
      grandTotal:     +grandTotal.toFixed(2),
      tableNumber:    guest.tableNumber,
      customerName:   guest.displayLabel,
      notes:          String(notes ?? '').slice(0, 200),
      orderSource:    'qr',
      paymentMethod:  'cash',
      sessionId:      guest.sessionId,
      guestId:        guest._id,
    });

    // ── Update guest: increment running total + clear idle expiry ─────────────
    await Guest.findByIdAndUpdate(guest._id, {
      $inc: { totalAmount: +grandTotal.toFixed(2) },
      $set: { qrTokenExpiresAt: null }, // once ordering started, token never idles out
    });

    // ── Socket event to admin dashboard ──────────────────────────────────────
    try {
      io.to(`hotel_${hotelId}`).emit('new_order', {
        _id:         order._id.toString(),
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        customerName: order.customerName,
        grandTotal:  order.grandTotal,
        itemCount:   order.items.length,
        sessionId:   String(guest.sessionId),
        guestId:     String(guest._id),
      });
    } catch (emitErr: any) {
      logger.warn('QR order socket emit failed', { hotelId, error: emitErr?.message });
    }

    logger.info('QR order placed', {
      hotelId,
      sessionId:   String(guest.sessionId),
      tableNumber: guest.tableNumber,
      grandTotal,
    });

    res.status(201).json({ order });
  } catch (err: any) {
    sendError(res, 400, 'Failed to place order', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/public/qr/bill?token=<guestToken>&hotel=<hotelId>
// View guest's running bill. Works while guest is active.
// After billing the token is cleared server-side → 404; customer views via receipt.
// ────────────────────────────────────────────────────────────────────────────────
router.get('/bill', qrReadLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, hotel } = req.query as { token?: string; hotel?: string };

    if (!token) {
      res.status(400).json({ message: 'token query param is required' });
      return;
    }
    if (!hotel || !mongoose.isValidObjectId(hotel)) {
      res.status(400).json({ message: 'hotel query param is required' });
      return;
    }

    // Lightweight hotel check (no feature-gate: viewing a bill should always work)
    const entry = await resolveHotelStatus(hotel);
    if (!['trial', 'active'].includes(entry.status)) {
      res.status(403).json({ message: 'Hotel not active' });
      return;
    }

    const guest = await Guest.findOne({
      qrSessionToken: token,
      hotelId:        new mongoose.Types.ObjectId(hotel),
    });

    if (!guest) {
      res.status(404).json({
        code:    'SESSION_NOT_FOUND',
        message: 'Session not found or has already been settled.',
      });
      return;
    }

    const orders = await Order.find({
      guestId: guest._id,
      hotelId: hotel,
    }).sort({ createdAt: 1 }).lean();

    let subtotal = 0;
    let taxTotal = 0;
    for (const o of orders as any[]) {
      subtotal += Number(o.subtotal) || 0;
      taxTotal += Number(o.taxTotal) || 0;
    }

    res.json({
      tableNumber:   guest.tableNumber,
      displayLabel:  guest.displayLabel,
      guestStatus:   guest.status,
      orders,
      subtotal:      +subtotal.toFixed(2),
      taxTotal:      +taxTotal.toFixed(2),
      grandTotal:    +(subtotal + taxTotal).toFixed(2),
      isBilled:      guest.status === 'billed',
      paymentMethod: guest.paymentMethod,
      fetchedAt:     new Date().toISOString(),
    });
  } catch (err: any) {
    sendError(res, 500, 'Failed to fetch bill', err);
  }
});

export default router;
