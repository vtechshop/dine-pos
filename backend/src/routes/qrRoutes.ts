/**
 * QR / Kiosk Guest Order Routes  (Architecture v1.1 — Phase 3 + Phase 5 revision)
 *
 * Both QR scan and Customer Kiosk use these endpoints identically.
 * The only runtime difference is where the guestToken is stored:
 *   QR     → browser localStorage (customer's own device)
 *   Kiosk  → application memory (hotel-owned tablet, cleared between customers)
 *
 * Mount point: /api/public/qr
 *
 * Endpoints:
 *   POST /session  — preflight: validates hotel, returns feature flags, validates
 *                   a stored guestToken if the customer is returning.
 *                   NO DB writes — session/guest creation is deferred to first order.
 *
 *   POST /orders   — place an order.
 *                   First order (no guestToken): auto-creates session + guest + order.
 *                   Subsequent orders (guestToken present): links to existing guest.
 *                   Returns { guestToken, order } — client stores the token.
 *
 *   GET  /bill     — view running guest bill by guestToken (read-only).
 *
 * Backward compatibility: only active when features.tableSessions === true.
 * Hotels with tableSessions === false continue using POST /api/public/orders.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Product from '../models/Product';
import Hotel from '../models/Hotel';
import ChatMessage from '../models/ChatMessage';
import type { CustomerIdentificationMode } from '../models/Hotel';
import Table from '../models/Table';
import TableSession from '../models/TableSession';
import Guest from '../models/Guest';
import CustomerProfile from '../models/CustomerProfile';
import Order from '../models/Order';
import DailyCounter from '../models/DailyCounter';
import { resolveHotelStatus } from '../middleware/auth';
import { sendError } from '../utils/sendError';
import { logger } from '../utils/logger';
import { guestLabel } from '../utils/guestLabel';
import { findOrCreateOpenSession } from '../utils/sessionUtils';
import { makeRateLimiter } from '../utils/rateLimiter';
import { applyIngredientStockChange } from '../utils/stockUtils';
import { io } from '../server';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import GatewayFactory from '../services/payment/GatewayFactory';

const router = Router();

// M-16: Store only the SHA-256 hash of the guest token in the DB.
// The raw token (returned to and stored by the client) is never persisted,
// so a DB dump cannot be replayed as a valid guest token.
const hashGuestToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

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
async function validateHotelForQR(
  res: Response,
  hotelId: string,
  requireTableSessions: boolean,
  requireKiosk = false,
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

  if (requireKiosk && f.kiosk === false) {
    res.status(403).json({ code: 'FEATURE_DISABLED', message: 'Kiosk mode is not enabled for this hotel' });
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

// ── Helper: resolve tableId from body (preferred) or tableNumber lookup ────────
async function resolveTableId(
  tableId: string | undefined,
  tableNumber: string | undefined,
  hotelId: string
): Promise<string | null> {
  if (tableId && mongoose.isValidObjectId(tableId)) return tableId;

  if (tableNumber) {
    const cleanTable = String(tableNumber).trim();

    // Accept an ObjectId passed as tableNumber (QR code may encode table._id)
    if (mongoose.isValidObjectId(cleanTable)) return cleanTable;

    const tableNum = Number(cleanTable);
    if (!isNaN(tableNum)) {
      const tableDoc = await Table.findOne({
        hotelId: new mongoose.Types.ObjectId(hotelId),
        number:  tableNum,
      });
      return tableDoc ? String(tableDoc._id) : null;
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/public/qr/session
// Preflight — validates hotel + feature flags, optionally validates a stored
// guestToken (returning customer resume). NO DB writes; no session or guest created.
// Session + guest creation is deferred until the first successful order.
// ────────────────────────────────────────────────────────────────────────────────
router.post('/session', qrWriteLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { hotelId, guestToken } = req.body as {
      hotelId?: string;
      guestToken?: string;
    };

    if (!hotelId || !mongoose.isValidObjectId(hotelId)) {
      res.status(400).json({ message: 'hotelId is required' });
      return;
    }

    const features = await validateHotelForQR(res, hotelId, true);
    if (!features) return;

    const identMode = features.customerIdentification;

    // ── Returning-customer fast path: validate stored guestToken ──────────────
    if (guestToken && typeof guestToken === 'string') {
      const existingGuest = await Guest.findOne({
        qrSessionToken: hashGuestToken(guestToken),
        hotelId:        new mongoose.Types.ObjectId(hotelId),
      });

      const isValid =
        existingGuest &&
        existingGuest.status === 'active' &&
        (existingGuest.qrTokenExpiresAt === null || new Date() <= existingGuest.qrTokenExpiresAt);

      if (isValid && existingGuest) {
        logger.info('QR/Kiosk preflight — token valid, returning customer', {
          hotelId,
          tableNumber: existingGuest.tableNumber,
        });
        res.json({
          isReturning:            true,
          guestToken,
          displayLabel:           existingGuest.displayLabel,
          tableNumber:            existingGuest.tableNumber,
          customerIdentification: identMode,
          requiresName:           false,
          requiresPhone:          false,
        });
        return;
      }
      // Token invalid/expired — fall through to new-customer response
    }

    // ── New customer: return what the form needs to collect ───────────────────
    res.json({
      isReturning:            false,
      guestToken:             null,
      customerIdentification: identMode,
      requiresName:           identMode === 'name_only' || identMode === 'name_mobile',
      requiresPhone:          identMode === 'name_mobile',
    });
  } catch (err: any) {
    sendError(res, 500, 'Failed to initialise QR session', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/public/qr/orders
// Unified order endpoint for QR scan and Kiosk flows.
//
// Two cases handled in a single request:
//
// A. First order (no guestToken in body):
//    Requires: tableId (or tableNumber), items, and customer info per feature flag.
//    Creates: open session (auto, if none exists) → guest → order.
//    Returns: { guestToken, order } — client stores the token.
//
// B. Subsequent orders (guestToken present):
//    Validates: token → guest active → session open → items priced.
//    Creates:   order, $inc guest.totalAmount.
//    Returns:   { guestToken, order } — same token echoed back.
//
// orderSource must be 'qr' (customer's own device) or 'kiosk' (hotel tablet).
// ────────────────────────────────────────────────────────────────────────────────
router.post('/orders', qrWriteLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      hotelId,
      guestToken,
      items: clientItems,
      notes,
      tableId,
      tableNumber,
      name,
      phone,
      orderSource,
    } = req.body as {
      hotelId?:     string;
      guestToken?:  string;
      items?:       any[];
      notes?:       string;
      tableId?:     string;
      tableNumber?: string;
      name?:        string;
      phone?:       string;
      orderSource?: string;
    };

    if (!hotelId || !mongoose.isValidObjectId(hotelId)) {
      res.status(400).json({ message: 'hotelId is required' });
      return;
    }
    if (!Array.isArray(clientItems) || clientItems.length === 0) {
      res.status(400).json({ message: 'items is required' });
      return;
    }
    // M-10: cap item count to prevent payload abuse on the public QR endpoint
    if (clientItems.length > 50) {
      res.status(400).json({ message: 'Order cannot contain more than 50 items' });
      return;
    }

    // Idempotency guard — client sends a unique clientOrderId per order attempt.
    // If a network retry arrives with the same ID, return the already-saved order.
    const clientOrderId = typeof req.body.clientOrderId === 'string' ? req.body.clientOrderId.slice(0, 64) : null;
    if (clientOrderId) {
      const dup = await Order.findOne({ offlineId: clientOrderId, hotelId }).lean();
      if (dup) {
        res.status(200).json({ guestToken: req.body.guestToken ?? '', order: dup });
        return;
      }
    }

    // ── Hotel + feature validation ────────────────────────────────────────────
    const isKiosk = orderSource === 'kiosk';
    const features = await validateHotelForQR(res, hotelId, true, isKiosk);
    if (!features) return;

    const validSource = isKiosk ? 'kiosk' : 'qr';

    let guest: any;
    let rawGuestToken = '';

    if (guestToken && typeof guestToken === 'string') {
      // ── Case B: Returning customer — validate stored guestToken ───────────────
      guest = await Guest.findOne({
        qrSessionToken: hashGuestToken(guestToken),
        hotelId:        new mongoose.Types.ObjectId(hotelId),
      });

      if (!guest) {
        logger.warn('Invalid QR/Kiosk guestToken on order', { hotelId });
        res.status(401).json({
          code:    'INVALID_TOKEN',
          message: 'Invalid session. Please scan the QR code again.',
        });
        return;
      }
      if (guest.status !== 'active') {
        res.status(401).json({
          code:    'SESSION_EXPIRED',
          message: 'Your session has ended. Please scan the QR code again.',
        });
        return;
      }
      if (guest.qrTokenExpiresAt !== null && new Date() > guest.qrTokenExpiresAt) {
        res.status(401).json({
          code:    'SESSION_EXPIRED',
          message: 'Your session has timed out. Please scan the QR code again.',
        });
        return;
      }

      const session = await TableSession.findOne({
        _id:     guest.sessionId,
        hotelId: new mongoose.Types.ObjectId(hotelId),
      });
      if (!session || session.status !== 'open') {
        res.status(401).json({
          code:    'SESSION_CLOSED',
          message: 'This table session has been closed. Please ask staff for assistance.',
        });
        return;
      }

      rawGuestToken = guestToken; // raw token echoed back to client in response

    } else {
      // ── Case A: First order — auto-create session + guest ─────────────────────
      const resolvedTableId = await resolveTableId(tableId, tableNumber, hotelId);
      if (!resolvedTableId) {
        res.status(400).json({
          code:    'TABLE_REQUIRED',
          message: 'tableId or tableNumber is required for the first order',
        });
        return;
      }

      // Validate customer info per customerIdentification feature flag
      const identMode  = features.customerIdentification;
      const cleanName  = String(name  ?? '').trim().slice(0, 100);
      let   cleanPhone = String(phone ?? '').trim().slice(0, 20);

      if (identMode === 'name_only' && !cleanName) {
        res.status(400).json({
          code:          'CUSTOMER_INFO_REQUIRED',
          message:       'Please enter your name to place an order',
          requiresName:  true,
          requiresPhone: false,
        });
        return;
      }
      if (identMode === 'name_mobile') {
        if (!cleanName) {
          res.status(400).json({
            code:          'CUSTOMER_INFO_REQUIRED',
            message:       'Please enter your name and mobile number to place an order',
            requiresName:  true,
            requiresPhone: true,
          });
          return;
        }
        if (!cleanPhone) {
          res.status(400).json({
            code:          'CUSTOMER_INFO_REQUIRED',
            message:       'Please enter your mobile number to place an order',
            requiresName:  true,
            requiresPhone: true,
          });
          return;
        }
        // Normalize and validate phone to E.164 before CustomerProfile lookup/create
        const digits = cleanPhone.replace(/\D/g, '');
        if (digits.length === 10) {
          cleanPhone = `+91${digits}`;
        } else if (digits.length === 12 && digits.startsWith('91')) {
          cleanPhone = `+${digits}`;
        } else if (digits.length === 11 && digits.startsWith('0')) {
          cleanPhone = `+91${digits.slice(1)}`;
        } else if (cleanPhone.startsWith('+') && digits.length >= 10) {
          cleanPhone = `+${digits}`;
        } else {
          res.status(400).json({
            code:    'INVALID_PHONE',
            message: 'Please enter a valid 10-digit mobile number',
          });
          return;
        }
      }

      // ── Auto-create or find open session ──────────────────────────────────────
      let session: any;
      try {
        const result = await findOrCreateOpenSession(resolvedTableId, hotelId, 'QR Self-service');
        session = result.session;
        if (result.created) {
          try {
            io.to(`hotel_${hotelId}`).emit('session_opened', {
              sessionId:   String(session._id),
              tableId:     String(session.tableId),
              tableNumber: session.tableNumber,
              openedBy:    'QR Self-service',
              openedAt:    session.openedAt,
            });
          } catch { /* non-critical */ }
        }
      } catch (err: any) {
        if (err.httpStatus === 404) {
          res.status(404).json({ code: 'TABLE_NOT_FOUND', message: err.message });
          return;
        }
        if (err.httpStatus === 409) {
          res.status(409).json({ code: 'TABLE_INACTIVE', message: err.message });
          return;
        }
        throw err;
      }

      // ── Find or create CustomerProfile (name_mobile only) ──────────────────────
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
          logger.info('CustomerProfile created via QR/Kiosk', { hotelId, customerId: newCustomerId });
        } else {
          CustomerProfile.findByIdAndUpdate(profile._id, {
            $set: { lastVisitAt: new Date(), name: cleanName },
            $inc: { visitCount: 1 },
          }).catch(() => {});
        }
        customerId = profile._id as mongoose.Types.ObjectId;
      }

      // ── Atomic: allocate guest slot in session ────────────────────────────────
      const updatedSession = await TableSession.findByIdAndUpdate(
        session._id,
        { $inc: { guestCount: 1 } },
        { new: true }
      );
      if (!updatedSession) {
        res.status(404).json({ message: 'Session not found' });
        return;
      }

      const guestNumber  = updatedSession.guestCount;
      const newToken     = crypto.randomBytes(32).toString('hex');
      rawGuestToken      = newToken; // raw token returned to client; only its hash is stored
      const expiresAt    = new Date(Date.now() + session.qrTimeoutMinutes * 60 * 1000);
      const displayLabel = (identMode !== 'disabled' && cleanName) ? cleanName : guestLabel(guestNumber);

      guest = await Guest.create({
        sessionId:        session._id,
        hotelId:          new mongoose.Types.ObjectId(hotelId),
        tableId:          session.tableId,
        tableNumber:      session.tableNumber,
        customerId,
        guestNumber,
        displayLabel,
        qrSessionToken:   hashGuestToken(newToken),
        qrTokenExpiresAt: expiresAt,
      });

      logger.info('QR/Kiosk guest created on first order', {
        hotelId,
        sessionId:   String(session._id),
        tableNumber: session.tableNumber,
        guestNumber,
        identMode,
        orderSource: validSource,
      });
    }

    // ── Item validation + pricing (server-side; client prices never trusted) ──
    const itemResult = await validateItems(res, clientItems, hotelId);
    if (!itemResult) return;

    const { validatedItems, subtotal, taxTotal } = itemResult;
    const grandTotal = +(subtotal + taxTotal).toFixed(2);

    // ── Enforce Razorpay-only payment for QR orders ───────────────────────────
    const gwConfig = await PaymentGatewayConfig.findOne({
      hotelId:   new mongoose.Types.ObjectId(String(hotelId)),
      isActive:  true,
      isDeleted: false,
    }).lean();
    if (!gwConfig || !GatewayFactory.isRegistered(gwConfig.gatewayType as Parameters<typeof GatewayFactory.isRegistered>[0])) {
      res.status(402).json({ code: 'NO_PAYMENT_GATEWAY', message: 'Online payment is not configured for this hotel. Please order at the counter.' });
      return;
    }

    // ── Generate order number (same atomic counter as orderRoutes.ts) ──────────
    const dateStr    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const counterKey = `ORD-${dateStr}-${hotelId}`;
    const counter    = await DailyCounter.findOneAndUpdate(
      { key: counterKey },
      { $inc: { seq: 1 }, $setOnInsert: { key: counterKey } },
      { upsert: true, new: true }
    );
    const orderNumber = `ORD-${dateStr}-${String(counter!.seq).padStart(3, '0')}`;

    // Per-guest order cap — prevent runaway ordering / DoS on the public endpoint
    const guestOrderCount = await Order.countDocuments({ guestId: guest._id, hotelId });
    if (guestOrderCount >= 20) {
      res.status(429).json({ code: 'ORDER_LIMIT', message: 'Maximum orders per session reached. Please ask staff for assistance.' });
      return;
    }

    // ── Create order + deduct stock atomically ────────────────────────────────
    const orderDoc = {
      hotelId,
      orderNumber,
      offlineId:      clientOrderId ?? null,
      items:          validatedItems,
      subtotal:       +subtotal.toFixed(2),
      taxTotal:       +taxTotal.toFixed(2),
      discountAmount: 0,
      grandTotal,
      tableNumber:    guest.tableNumber,
      customerName:   guest.displayLabel,
      notes:          String(notes ?? '').slice(0, 200),
      orderSource:    validSource,
      paymentMethod:  'razorpay',
      status:         'payment_pending',
      sessionId:      guest.sessionId,
      guestId:        guest._id,
    };
    const stockItems = validatedItems.filter((i: any) => i.product);
    const stockBulkOps = stockItems.map((item: any) => ({
      updateOne: {
        filter: { _id: item.product, hotelId, stock: { $gt: 0 } },
        update: [
          { $set: { stock: { $max: [{ $subtract: ['$stock', item.quantity] }, 0] } } },
          { $set: { isAvailable: { $gt: ['$stock', 0] } } },
        ],
      },
    }));
    let order: any;
    const qrTx = await mongoose.startSession();
    try {
      await qrTx.withTransaction(async () => {
        [order] = await Order.create([orderDoc], { session: qrTx });
        if (stockBulkOps.length > 0) await Product.bulkWrite(stockBulkOps as any, { session: qrTx });
        await applyIngredientStockChange(validatedItems, String(hotelId), -1, qrTx);
      });
    } finally {
      await qrTx.endSession();
    }

    // ── Update guest: increment running total + clear idle timeout ────────────
    await Guest.findByIdAndUpdate(guest._id, {
      $inc: { totalAmount: grandTotal },
      $set: { qrTokenExpiresAt: null }, // once ordering started, token never idles out
    });

    logger.info('QR/Kiosk order placed (payment_pending)', {
      hotelId,
      sessionId:   String(guest.sessionId),
      tableNumber: guest.tableNumber,
      grandTotal,
      orderSource: validSource,
    });

    // Always return guestToken so client can persist it for subsequent orders.
    // rawGuestToken holds the un-hashed token; guest.qrSessionToken is its hash.
    res.status(201).json({
      guestToken: rawGuestToken,
      order,
    });
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
      qrSessionToken: hashGuestToken(token),
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

    // [Phase 6] Include loyalty balance so customer can see redeemable points
    let loyaltyBalance: number | undefined;
    if (guest.customerId) {
      const profile = await CustomerProfile.findById(guest.customerId).select('loyaltyBalance').lean();
      loyaltyBalance = (profile as any)?.loyaltyBalance;
    }

    res.json({
      tableNumber:           guest.tableNumber,
      displayLabel:          guest.displayLabel,
      guestStatus:           guest.status,
      orders,
      subtotal:              +subtotal.toFixed(2),
      taxTotal:              +taxTotal.toFixed(2),
      grandTotal:            +(subtotal + taxTotal).toFixed(2),
      isBilled:              guest.status === 'billed',
      paymentMethod:         guest.paymentMethod,
      loyaltyBalance,
      loyaltyPointsRedeemed: guest.loyaltyPointsRedeemed || undefined,
      loyaltyDiscountAmount:  guest.loyaltyDiscountAmount || undefined,
      fetchedAt:             new Date().toISOString(),
    });
  } catch (err: any) {
    sendError(res, 500, 'Failed to fetch bill', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// POST /api/public/qr/waiter-call
// Guest requests waiter assistance. Creates a ChatMessage and notifies the admin
// room via socket. Public endpoint — no auth token required.
// ────────────────────────────────────────────────────────────────────────────────
router.post('/waiter-call', qrWriteLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { hotelId, tableNumber, message } = req.body as {
      hotelId?:     string;
      tableNumber?: string;
      message?:     string;
    };

    if (!hotelId || !mongoose.isValidObjectId(hotelId)) {
      res.status(400).json({ message: 'hotelId is required' });
      return;
    }
    if (!tableNumber || typeof tableNumber !== 'string' || !tableNumber.trim()) {
      res.status(400).json({ message: 'tableNumber is required' });
      return;
    }

    const entry = await resolveHotelStatus(hotelId);
    if (!['trial', 'active'].includes(entry.status)) {
      res.status(403).json({ message: 'This hotel is not currently accepting requests' });
      return;
    }

    const cleanMessage = String(message ?? '').trim().slice(0, 500) || '[Waiter Request]';
    const cleanTable   = tableNumber.trim();

    const chat = await ChatMessage.create({
      hotelId,
      tableNumber: cleanTable,
      sender:      'customer',
      message:     cleanMessage,
    });

    const payload = {
      _id:         chat._id.toString(),
      hotelId,
      tableNumber: cleanTable,
      sender:      chat.sender,
      message:     chat.message,
      createdAt:   (chat as any).createdAt,
    };

    try {
      io.to(`hotel_${hotelId}_table_${cleanTable}`).emit('new_message', payload);
      io.to(`admin_${hotelId}`).emit('new_message', payload);
    } catch (emitErr: any) {
      logger.warn('Waiter call socket emit failed', { hotelId, tableNumber: cleanTable, error: emitErr?.message });
    }

    res.json({ ok: true });
  } catch (err: any) {
    sendError(res, 500, 'Failed to send waiter request', err);
  }
});

export default router;
