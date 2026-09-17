/**
 * WhatsApp Auto-Receipts — core service
 *
 * Public API:
 *  normalizePhone(raw, defaultCountry)          — E.164 normalisation
 *  buildReceiptVars(hotelId, orderId, guestId)  — template variable values
 *  createWhatsAppReceiptJob(...)                 — fire-and-forget job creation
 *  createWhatsAppReceiptJobForGuest(...)         — dine-in guest session variant
 *
 * Security invariants:
 *  - hotelId comes from authenticated request context, never from the client body
 *  - All DB lookups include hotelId in the filter (no cross-tenant reads)
 *  - normalizePhone is server-side only; frontend-supplied numbers are re-validated
 *  - createWhatsAppReceiptJob is always fire-and-forget: it NEVER throws or
 *    rejects; any failure is logged at WARN and swallowed so the bill completes
 */

import mongoose, { Types } from 'mongoose';
import Hotel    from '../models/Hotel';
import Settings from '../models/Settings';
import Order    from '../models/Order';
import WhatsAppReceipt from '../models/WhatsAppReceipt';
import { logger } from '../utils/logger';
import { normalizePhone as _normalizePhone } from '../utils/phoneUtils';

// ── Phone normalisation ───────────────────────────────────────────────────────

/**
 * Normalise a raw phone string to E.164 format.
 * Delegates to the shared phoneUtils implementation (India-first, +91 heuristics).
 * Exported so routes and tests can import from one place.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  return _normalizePhone(raw);
}

// ── Template variable resolvers ───────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  cash:        'Cash',
  upi:         'UPI',
  upi_intent:  'UPI',
  upi_qr:      'UPI QR',
  upi_collect: 'UPI',
  card:        'Card',
  split:       'Split',
  razorpay:    'Online',
};

function _fmt(n: number, sym = '₹'): string {
  return `${sym}${n.toFixed(2)}`;
}

function _fmtDate(d: Date | null | undefined, tz = 'Asia/Kolkata'): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

function _fmtTime(d: Date | null | undefined, tz = 'Asia/Kolkata'): string {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
}

/**
 * Build a flat map of named template variables from a completed Order document.
 * All values are safe strings — no internal IDs or secrets.
 */
export function buildReceiptVarsFromOrder(
  order: {
    customerName?:  string | null;
    orderNumber?:   string;
    grandTotal?:    number;
    subtotal?:      number;
    taxTotal?:      number;
    discountAmount?: number;
    paymentMethod?: string;
    tableNumber?:   string | number | null;
    orderSource?:   string;
    completedAt?:   Date | null;
    createdAt?:     Date | null;
    items?:         unknown[];
  },
  hotelName:    string,
  currencySymbol = '₹',
): Record<string, string> {
  const completedAt = order.completedAt ?? order.createdAt ?? null;
  return {
    customerName:   order.customerName   || 'Valued Customer',
    restaurantName: hotelName            || 'Restaurant',
    orderNumber:    order.orderNumber    || '',
    grandTotal:     _fmt(order.grandTotal    ?? 0, currencySymbol),
    subtotal:       _fmt(order.subtotal      ?? 0, currencySymbol),
    taxTotal:       _fmt(order.taxTotal      ?? 0, currencySymbol),
    discountAmount: _fmt(order.discountAmount ?? 0, currencySymbol),
    paymentMethod:  PAYMENT_LABELS[order.paymentMethod ?? ''] ?? (order.paymentMethod ?? ''),
    tableNumber:    order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway',
    orderDate:      _fmtDate(completedAt),
    orderTime:      _fmtTime(completedAt),
    itemCount:      String(order.items?.length ?? 0),
  };
}

// ── Job creation helpers ──────────────────────────────────────────────────────

interface JobOptions {
  orderId?:    Types.ObjectId | string | null;
  guestId?:    Types.ObjectId | string | null;
  customerId?: Types.ObjectId | string | null;
  phoneNumber: string | null | undefined;
}

async function _createJob(hotelId: string, opts: JobOptions): Promise<void> {
  // 1. Feature flag check — hotel must have whatsappNotifications enabled
  const hotel = await Hotel.findById(hotelId).select('features').lean();
  if (!hotel?.features?.whatsappNotifications) return;

  // 2. Settings check — autoSend and templateName must be configured
  const settings = await Settings.findOne(
    { hotelId: new mongoose.Types.ObjectId(hotelId) },
  ).select('whatsappReceipts currencySymbol').lean();
  const waCfg = (settings as any)?.whatsappReceipts;
  if (!waCfg?.autoSend || !waCfg.templateName?.trim()) return;

  // 3. Phone normalisation — server-side only
  const normalized = opts.phoneNumber ? normalizePhone(opts.phoneNumber) : null;
  if (!normalized) return; // No valid phone → skip silently, not an error

  // 4. Upsert: $setOnInsert ensures only one record per (hotel, order/guest, purpose)
  const filter: Record<string, unknown> = {
    hotelId: new Types.ObjectId(hotelId),
    purpose: 'receipt',
  };
  if (opts.orderId) filter.orderId = new Types.ObjectId(String(opts.orderId));
  if (opts.guestId) filter.guestId = new Types.ObjectId(String(opts.guestId));

  const doc: Record<string, unknown> = {
    hotelId:         new Types.ObjectId(hotelId),
    purpose:         'receipt',
    phoneNumber:     opts.phoneNumber!,
    normalizedPhone: normalized,
    provider:        'msg91',
    templateName:    waCfg.templateName.trim(),
    templateLanguage: (waCfg.templateLanguage ?? 'en').trim() || 'en',
    templateVars:    Array.isArray(waCfg.templateVars) ? waCfg.templateVars : [],
    status:          'queued',
    attemptCount:    0,
    maxAttempts:     3,
  };
  if (opts.orderId)    doc.orderId    = new Types.ObjectId(String(opts.orderId));
  if (opts.guestId)    doc.guestId    = new Types.ObjectId(String(opts.guestId));
  if (opts.customerId) doc.customerId = new Types.ObjectId(String(opts.customerId));

  await WhatsAppReceipt.findOneAndUpdate(
    filter,
    { $setOnInsert: doc },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

/**
 * Create a WhatsApp receipt job for a completed non-dine-in order.
 * Always fire-and-forget — never throws.
 */
export async function createWhatsAppReceiptJob(
  hotelId:    string,
  orderId:    string | Types.ObjectId,
  phone:      string | null | undefined,
  customerId?: string | Types.ObjectId | null,
): Promise<void> {
  try {
    await _createJob(hotelId, {
      orderId:    String(orderId),
      phoneNumber: phone,
      customerId,
    });
  } catch (err) {
    logger.warn('[WhatsApp] createReceiptJob failed', {
      hotelId,
      orderId: String(orderId),
      err: String(err),
    });
  }
}

/**
 * Create a WhatsApp receipt job for a dine-in guest billing event.
 * Looks up the CustomerProfile associated with the guest to get the phone.
 * Always fire-and-forget — never throws.
 */
export async function createWhatsAppReceiptJobForGuest(
  hotelId: string,
  guest: {
    _id:        unknown;
    customerId?: unknown;
    phone?:     string | null;
  },
): Promise<void> {
  try {
    let phone: string | null = guest.phone ?? null;

    // If the guest has a linked CustomerProfile, use their stored phone
    if (!phone && guest.customerId) {
      const CustomerProfile = (await import('../models/CustomerProfile')).default;
      const customer = await CustomerProfile.findOne({
        _id:     new Types.ObjectId(String(guest.customerId)),
        hotelId: new Types.ObjectId(hotelId),
      }).select('phone').lean();
      phone = customer?.phone ?? null;
    }

    await _createJob(hotelId, {
      guestId:     String((guest as any)._id),
      customerId:  guest.customerId ? String(guest.customerId) : null,
      phoneNumber: phone,
    });
  } catch (err) {
    logger.warn('[WhatsApp] createReceiptJobForGuest failed', {
      hotelId,
      guestId: String((guest as any)._id),
      err: String(err),
    });
  }
}

/**
 * Build receipt template vars for a queued receipt record.
 * Used by the worker at send time so the order data is fresh.
 */
export async function buildReceiptVars(
  hotelId:  string,
  orderId:  Types.ObjectId | string | null | undefined,
  guestId?: Types.ObjectId | string | null,
): Promise<Record<string, string>> {
  const settings = await Settings.findOne(
    { hotelId: new mongoose.Types.ObjectId(hotelId) },
  ).select('hotelName currencySymbol').lean();
  const hotelName    = (settings as any)?.hotelName    ?? 'Restaurant';
  const currencySym  = (settings as any)?.currencySymbol ?? '₹';

  if (orderId) {
    const order = await Order.findOne({
      _id:     new Types.ObjectId(String(orderId)),
      hotelId: new mongoose.Types.ObjectId(hotelId),
    }).select(
      'customerName orderNumber grandTotal subtotal taxTotal discountAmount paymentMethod tableNumber orderSource completedAt createdAt items',
    ).lean();

    if (order) return buildReceiptVarsFromOrder(order, hotelName, currencySym);
  }

  if (guestId) {
    // For dine-in billing, load the Guest document
    try {
      const Guest = (await import('../models/Guest')).default;
      const guest = await Guest.findOne({
        _id:     new Types.ObjectId(String(guestId)),
        hotelId: new mongoose.Types.ObjectId(hotelId),
      }).select('displayLabel tableNumber totalAmount paymentMethod billedAt customerId').lean();

      if (guest) {
        const CustomerProfile = (await import('../models/CustomerProfile')).default;
        const customer = await CustomerProfile.findOne({
          _id:     (guest as any).customerId,
          hotelId: new mongoose.Types.ObjectId(hotelId),
        }).select('name').lean();

        return buildReceiptVarsFromOrder(
          {
            customerName:  customer?.name || (guest as any).displayLabel || 'Valued Customer',
            orderNumber:   (guest as any).displayLabel ?? '',
            grandTotal:    (guest as any).totalAmount ?? 0,
            subtotal:      (guest as any).totalAmount ?? 0,
            taxTotal:      0,
            discountAmount:0,
            paymentMethod: (guest as any).paymentMethod ?? '',
            tableNumber:   (guest as any).tableNumber ?? null,
            completedAt:   (guest as any).billedAt ?? null,
            items:         [],
          },
          hotelName,
          currencySym,
        );
      }
    } catch {
      // Guest model may not exist in all deployments — degrade gracefully
    }
  }

  // Fallback — should not happen in normal operation
  return buildReceiptVarsFromOrder({}, hotelName, currencySym);
}
