import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Hotel from '../models/Hotel';
import Product from '../models/Product';
import { invalidateProductList } from '../utils/menuCache';
import ModifierGroup from '../models/ModifierGroup';
import DailyCounter from '../models/DailyCounter';
import { nextCustomerId } from '../utils/customerId';
import TableSession from '../models/TableSession';
import Guest from '../models/Guest';
import CustomerProfile from '../models/CustomerProfile';
import { findOrCreateOpenSession, findOrCreateDefaultGuest } from '../utils/sessionUtils';
import { scheduleKOTPrint, scheduleOrderReceiptPrint } from '../utils/printUtils';
import { createWhatsAppReceiptJob } from '../services/whatsappReceiptService';
import {
  createTallySyncJobForOrder,
  createTallySyncJobForCancellation,
} from '../services/tallySyncService';
import { applyIngredientStockChange } from '../utils/stockUtils';
import Ingredient from '../models/Ingredient';
import StockMovement from '../models/StockMovement';
import { authMiddleware, requireAdmin, requireKitchenOrAdmin, requireWaiterOrAdmin, requireCashierOrAdmin, requireWaiterOrCashierOrAdmin, resolveHotelStatus, AuthRequest } from '../middleware/auth';
import { requireActiveStaff } from '../middleware/staffAuth';
import { logAudit } from '../utils/audit';
import { logger } from '../utils/logger';
import { io } from '../server';
import { sendError } from '../utils/sendError';
import { normalizePhone } from '../utils/phoneUtils';
import Payment from '../models/Payment';
import PaymentEntry from '../models/PaymentEntry';
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import { getLoyaltyConfig, calculateEarnedPoints, calculateRedeemValue, earnPoints, redeemPoints, reverseEarnedPoints, resolveOrgLoyalty, earnOrgPoints, redeemOrgPoints, reverseOrgEarnedPoints, type OrgLoyaltyContext } from '../utils/loyaltyUtils';
import Coupon from '../models/Coupon';
import CouponRedemption from '../models/CouponRedemption';
import GiftVoucher from '../models/GiftVoucher';
import WalletTransaction from '../models/WalletTransaction';
import { resolveCoupon, CouponResult } from '../utils/couponUtils';
import { isDueAtCounter } from '../utils/counterBilling';
import { recordEntries, outstandingOf, moneyParts, ledgerMethod, r2, PAISE } from '../utils/paymentLedger';
import { salesReport, salesMatch, istDay, todayIST, pendingPayments } from '../utils/financeDefinitions';
import { isQuickServiceOrder } from '../utils/quickService';
import { refuseWithoutShift, isCounterMethod, owesAtCounter } from '../utils/shiftGuard';
import { payBeforeKitchenEnabled, isHeldForCounterPayment } from '../utils/payBeforeKitchen';
import { pushDeliveryAvailability } from '../utils/deliveryAvailabilitySync';
import { PAID_ORDER, NET_TOTAL } from '../utils/paidOrder';

const router = Router();

/** Payment methods the counter can take in person (online Razorpay is never counter-paid). */
const COUNTER_PAY_METHODS = ['cash', 'upi', 'upi_intent', 'upi_qr', 'upi_collect', 'card', 'split'];

/**
 * Batch 3 (owner decision): a tip is money received but not part of the bill, sales or
 * collections. It is recorded as its own ledger entry (type 'tip') when the bill is paid, once
 * per order. Cash tips count in the cash drawer.
 */
async function recordTip(
  hotelId: string, order: { _id: unknown; tipAmount?: number; tipMethod?: string; sessionId?: unknown; guestId?: unknown },
  paidAt: Date, recordedBy: string, session?: mongoose.ClientSession,
): Promise<void> {
  const amount = r2(order.tipAmount);
  if (!(amount > 0)) return;
  const method = (['cash', 'upi', 'card'].includes(String(order.tipMethod)) ? order.tipMethod : 'cash') as 'cash' | 'upi' | 'card';
  await recordEntries(hotelId, [{
    type: 'tip', method, amount, paidAt, source: 'tip',
    allocations: [{ orderId: order._id as any, amount }],
    sessionId: order.sessionId as any, guestId: order.guestId as any,
    reason: 'Tip (not part of the bill)', recordedBy,
    idempotencyKey: `tip:${String(order._id)}`,
  }], session ? { session } : {});
}

/** Tell kitchen screens and dashboards about an order that has entered the kitchen. */
function emitNewOrder(hotelId: string, order: any): void {
  const room = `hotel_${hotelId}`;
  const roomClients = io.sockets.adapter.rooms.get(room)?.size ?? 0;
  logger.info('Emitting new_order', { room, clientsInRoom: roomClients, orderId: String(order._id) });
  io.to(room).emit('new_order', {
    _id:           order._id,
    orderNumber:   order.orderNumber,
    tableNumber:   order.tableNumber,
    customerName:  order.customerName,
    customerPhone: order.customerPhone,
    grandTotal:    order.grandTotal,
    itemCount:     order.items.length,
    orderSource:   order.orderSource,
    notes:         order.notes || undefined,
    createdAt:     order.createdAt,
    items:         order.items.map((i: any) => ({
      productName:   i.productName,
      quantity:      i.quantity,
      price:         i.price,
      variantName:   i.variantName   || undefined,
      modifierNames: (i.selectedModifiers || []).map((m: any) => m.modifierOptionName).filter(Boolean),
    })),
  });
}

// ── C1: Server-side monetary recalculation ───────────────────────────────────
// The backend is the single source of truth for all monetary values.
// Client-supplied subtotal / taxTotal / discountAmount / grandTotal are
// ignored and recomputed from the raw items before any Order is persisted.
function recalcOrderTotals(
  rawItems: any[],
  rawManualDiscount: unknown,
  rawLoyaltyDiscount: unknown,
  serverCouponDiscount = 0,
) {
  let subtotal = 0;
  let taxTotal = 0;

  const items = (rawItems ?? []).map((item: any) => {
    const unitPrice = Math.max(0, Number(item.price) || 0);
    const qty       = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const taxPct    = Math.max(0, Number(item.taxPercent) || 0);
    const lineBase  = Math.round(unitPrice * qty * 100) / 100;
    const taxAmt    = Math.round(lineBase * taxPct / 100 * 100) / 100;
    const lineTotal = Math.round((lineBase + taxAmt) * 100) / 100;
    subtotal += lineBase;
    taxTotal += taxAmt;
    const selectedModifiers = (item.selectedModifiers ?? []).map((m: any) => ({
      ...m,
      modifierTotal: Math.round((Number(m.modifierPrice) || 0) * qty * 100) / 100,
    }));
    return { ...item, quantity: qty, lineBase, taxAmount: taxAmt, total: lineTotal, selectedModifiers };
  });

  subtotal = Math.round(subtotal * 100) / 100;
  taxTotal = Math.round(taxTotal * 100) / 100;
  const available        = subtotal + taxTotal;
  const discountAmount   = Math.min(Math.max(0, Number(rawManualDiscount) || 0), available);
  const couponDiscount   = Math.min(Math.max(0, serverCouponDiscount), available - discountAmount);
  const loyaltyDiscount  = Math.min(Math.max(0, Number(rawLoyaltyDiscount) || 0), available - discountAmount - couponDiscount);
  const grandTotal       = Math.max(0, Math.round((available - discountAmount - couponDiscount - loyaltyDiscount) * 100) / 100);

  // Proportional discount allocation across line items — for GST-compliant invoice printing.
  // Distributes the manual bill-level discount by lineBase weight; last item absorbs the
  // remainder so sum(discountAllocated) === discountAmount exactly (no floating paise drift).
  // Does NOT change taxAmount or grandTotal — purely a per-line reporting field.
  let allocatedSum = 0;
  const finalItems = items.map((item: any, index: number) => {
    let discountAllocated = 0;
    if (discountAmount > 0 && subtotal > 0) {
      if (index === items.length - 1) {
        discountAllocated = Math.max(0, Math.round((discountAmount - allocatedSum) * 100) / 100);
      } else {
        discountAllocated = Math.round((item.lineBase / subtotal) * discountAmount * 100) / 100;
        allocatedSum += discountAllocated;
      }
    }
    const { lineBase: _lb, ...rest } = item;
    return { ...rest, discountAllocated };
  });

  return { items: finalItems, subtotal, taxTotal, discountAmount, couponDiscount, loyaltyDiscount, grandTotal };
}



// ── C2: Server-side product + modifier validation ────────────────────────────
// For items that carry a product ObjectId reference, we:
//   • verify the product belongs to this hotel and is not deleted
//   • derive basePrice from the DB (variant price when variantId is set)
//   • for each selectedModifier, verify group + option are hotel-owned,
//     active, not deleted, and override the price from the DB value
//   • recompute item.price = dbBasePrice + sum(dbOptionPrices)
// Aggregator items without a product ref pass through unvalidated (no DB record to check).
export async function validateAndEnrichItems(
  rawItems: any[],
  hotelId: string,
): Promise<{ items: any[]; error: string | null; code?: string; trackedStock?: Map<string, number> }> {
  // Collect distinct product IDs that have a ref
  const productIdStrings = [
    ...new Set(
      rawItems
        .filter(item => item.product && mongoose.isValidObjectId(item.product))
        .map(item => String(item.product)),
    ),
  ];

  // Collect distinct modifier group IDs from all items
  const mgIdStrings = [
    ...new Set(
      rawItems
        .flatMap(item => (item.selectedModifiers ?? []))
        .map((m: any) => m?.modifierGroupId)
        .filter((id: any) => id && mongoose.isValidObjectId(id))
        .map(String),
    ),
  ];

  // Single parallel fetch for all products and modifier groups
  const [products, modifierGroups] = await Promise.all([
    productIdStrings.length > 0
      ? Product.find({
          _id:       { $in: productIdStrings.map(id => new mongoose.Types.ObjectId(id)) },
          hotelId,
          isDeleted: false,
        }).lean()
      : Promise.resolve([]),
    mgIdStrings.length > 0
      ? ModifierGroup.find({
          _id:       { $in: mgIdStrings.map(id => new mongoose.Types.ObjectId(id)) },
          hotelId,
          isDeleted: false,
          isActive:  true,
        }).lean()
      : Promise.resolve([]),
  ]);

  const productMap  = new Map<string, any>(products.map((p: any) => [String(p._id), p]));
  const modGroupMap = new Map<string, any>(modifierGroups.map((g: any) => [String(g._id), g]));

  const enriched: any[] = [];

  for (const item of rawItems) {
    // Every POS line must reference a product of this hotel: its price and tax
    // come from the DB. A product-less line used to pass through with the
    // client's price/taxPercent (₹1, 0% GST). Aggregator orders don't use this route.
    if (!item.product || !mongoose.isValidObjectId(String(item.product))) {
      return { items: [], error: `Item "${String(item.productName ?? '').slice(0, 60) || 'unknown'}" is not linked to a product` };
    }

    const product = productMap.get(String(item.product));
    if (!product) {
      return { items: [], error: `Product ${item.product} not found in this hotel or has been deleted` };
    }

    // Resolve base price: variant if specified, else product price
    let basePrice: number = Number(product.price) || 0;
    // Batch 3: the size stored on the line always comes from the product, never from the client.
    let variantId = '';
    let variantName = '';
    if (item.variantId && mongoose.isValidObjectId(item.variantId)) {
      const variant = (product.variants ?? []).find((v: any) => String(v._id) === String(item.variantId));
      if (!variant) {
        return { items: [], error: `Variant ${item.variantId} not found on product ${product.name}` };
      }
      basePrice = Number(variant.price) || 0;
      variantId = String(variant._id);
      variantName = String(variant.name ?? '');
    }

    // Validate + enrich each selectedModifier
    let modifierPriceSum = 0;
    const validatedModifiers: any[] = [];

    for (const mod of (item.selectedModifiers ?? [])) {
      if (!mod.modifierGroupId || !mongoose.isValidObjectId(mod.modifierGroupId)) {
        return { items: [], error: 'Invalid modifierGroupId in selectedModifiers' };
      }

      const group = modGroupMap.get(String(mod.modifierGroupId));
      if (!group) {
        return { items: [], error: `Modifier group ${mod.modifierGroupId} not found, inactive, or does not belong to this hotel` };
      }

      if (!mod.modifierOptionId || !mongoose.isValidObjectId(mod.modifierOptionId)) {
        return { items: [], error: 'Invalid modifierOptionId in selectedModifiers' };
      }

      const option = (group.options ?? []).find(
        (o: any) => String(o._id) === String(mod.modifierOptionId),
      );
      if (!option) {
        return { items: [], error: `Modifier option ${mod.modifierOptionId} not found in group "${group.name}"` };
      }
      if (option.isActive === false) {
        return { items: [], error: `Modifier option "${option.name}" is inactive` };
      }

      const serverPrice = Math.max(0, Number(option.price) || 0);
      modifierPriceSum += serverPrice;

      validatedModifiers.push({
        modifierGroupId:    String(group._id),
        modifierGroupName:  group.name,
        modifierOptionId:   String(option._id),
        modifierOptionName: option.name,
        modifierPrice:      serverPrice,
        modifierTotal:      0, // recalcOrderTotals will set this correctly
      });
    }

    const serverUnitPrice = basePrice + modifierPriceSum;

    enriched.push({
      ...item,
      price:             serverUnitPrice,
      taxPercent:        Number(product.taxPercent) || 0,
      hsnCode:           product.hsnCode || '',
      productName:       product.name,
      variantId,
      variantName,
      selectedModifiers: validatedModifiers,
      notes:             String(item.notes ?? '').trim().slice(0, 200),
    });
  }

  // Phase 5 · Batch 6 (P4-INV-02 / -03): a dish that is sold out or switched off cannot be ordered,
  // and a counted dish cannot be ordered beyond its stock (all lines of the dish together).
  // Stock is "counted" when it is a number ≥ 0 (−1 / missing = not counted).
  const wanted = new Map<string, number>();
  for (const it of enriched) {
    const id = String(it.product);
    wanted.set(id, (wanted.get(id) ?? 0) + Math.max(0, Number(it.quantity) || 0));
  }
  const trackedStock = new Map<string, number>();
  for (const [id, qty] of wanted) {
    const p = productMap.get(id);
    if (p.isAvailable === false) {
      return { items: [], error: `${p.name} is sold out or switched off. Remove it from the bill.`, code: 'ITEM_UNAVAILABLE' };
    }
    if (typeof p.stock === 'number' && p.stock >= 0) {
      if (qty > p.stock) {
        return {
          items: [], code: 'NOT_ENOUGH_STOCK',
          error: p.stock === 0
            ? `${p.name} is sold out. Remove it from the bill.`
            : `Only ${p.stock} ${p.name} left — the bill has ${qty}. Change the quantity.`,
        };
      }
      trackedStock.set(id, p.stock);
    }
  }

  return { items: enriched, error: null, trackedStock };
}

// Helper: Generate order number like ORD-20260310-001 (per hotel)
// Uses an atomic MongoDB $inc counter — no race condition under concurrent tablets.

// Database/infrastructure failures (Atlas blip, write conflict, timeout) are temporary:
// answer 503 so the mobile offline queue retries the bill. Every other unexpected error
// keeps the old 400, which the queue treats as permanent.
function isTemporaryDbError(error: any): boolean {
  const name = String(error?.name ?? '');
  return name.startsWith('Mongo') || (Array.isArray(error?.errorLabels) && error.errorLabels.includes('TransientTransactionError'))
    || (typeof error?.hasErrorLabel === 'function' && error.hasErrorLabel('TransientTransactionError'));
}

const generateOrderNumber = async (hotelId: string, prefix = 'ORD'): Promise<string> => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = `${prefix}-${dateStr}-${hotelId}`;
  const counter = await DailyCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    { upsert: true, new: true },
  );
  return `${prefix}-${dateStr}-${String(counter!.seq).padStart(3, '0')}`;
};

// Daily report — one definition of Sales / Collections for every report (utils/financeDefinitions.ts).
// Owner decision (27 Nov 2026): totalSales = PAID orders (completed, or paid ahead), net of refunds
// and settlement discounts, by the IST day they were created. paymentBreakdown = collections (money
// received on the day, split payments under their parts). grossSales / totalRefunds / refundedOrders /
// cancelledOrders as on main.
router.get('/reports/daily', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || todayIST();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || isNaN(istDay(dateStr).getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    const report = await salesReport(new mongoose.Types.ObjectId(req.hotelId!), istDay(dateStr), istDay(dateStr, true));
    res.json({ date: dateStr, ...report });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// Range report (weekly / monthly) — same shape and definitions as daily
router.get('/reports/range', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Both from and to are required — a range without explicit bounds is ambiguous
    if (!req.query.from || !req.query.to) {
      return res.status(400).json({ message: 'Both from and to date params are required' });
    }
    const fromStr = req.query.from as string;
    const toStr   = req.query.to   as string;
    if (![fromStr, toStr].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(istDay(d).getTime()))) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    const report = await salesReport(new mongoose.Types.ObjectId(req.hotelId!), istDay(fromStr), istDay(toStr, true));
    res.json({ from: fromStr, to: toStr, ...report });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// Product-wise sales report for a date
router.get('/reports/products', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Batch 2 (2D): products sold = SALES basis (served / completed on the day, IST day).
    const dateStr = (req.query.date as string) || todayIST();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ message: 'Invalid date format' });

    const results = await Order.aggregate([
      { $match: { hotelId: new mongoose.Types.ObjectId(req.hotelId!), status: { $ne: 'cancelled' }, ...PAID_ORDER, createdAt: { $gte: istDay(dateStr), $lte: istDay(dateStr, true) } } },
      { $unwind: '$items' },
      { $group: {
        _id: '$items.productName',
        totalQuantity: { $sum: '$items.quantity' },
        totalRevenue:  { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
      }},
      { $sort: { totalQuantity: -1 } },
      { $limit: 20 },
      { $project: { _id: 0, productName: '$_id', totalQuantity: 1, totalRevenue: 1 } },
    ]);

    res.json({ date: dateStr, products: results });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// All remaining routes require auth + active staff check
router.use(authMiddleware);
router.use(requireActiveStaff);

// ── Discount policy (Batch 3 · 3D) ────────────────────────────────────────────
// The server already enforces who may discount (admin: any; cashier: up to the hotel's
// maxCashierDiscountPercent, 0 = none) but the POS never knew it, so it showed "Not permitted"
// even to admins and offered a discount field to cashiers who would then be refused.
router.get('/discount-policy', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const hotel = await Hotel.findById(req.hotelId).select('maxCashierDiscountPercent').lean() as any;
    const cap = Number(hotel?.maxCashierDiscountPercent) || 0;
    const isAdmin = req.role === 'admin';
    res.json({
      role: req.role,
      canDiscount: isAdmin || cap > 0,
      maxPercent: isAdmin ? 100 : cap,
      maxCashierDiscountPercent: cap,
    });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// Admin sets the cashier discount limit (0–100 %, 0 = cashiers cannot discount). Audited.
router.patch('/discount-policy', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const raw = Number(req.body?.maxCashierDiscountPercent);
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
      return res.status(400).json({ message: 'maxCashierDiscountPercent must be a number from 0 to 100.' });
    }
    const cap = Math.round(raw * 100) / 100;
    const before = await Hotel.findById(req.hotelId).select('maxCashierDiscountPercent').lean() as any;
    await Hotel.updateOne({ _id: req.hotelId }, { $set: { maxCashierDiscountPercent: cap } });
    logAudit(req, 'hotel.discount_policy', 'hotel', String(req.hotelId), {
      before: Number(before?.maxCashierDiscountPercent) || 0, after: cap,
    });
    res.json({ maxCashierDiscountPercent: cap });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET /api/orders/kitchen — active orders for KDS (pending + preparing + ready), oldest first
// 'ready' is included so the kitchen can see which orders are waiting for collection.
// Waiter marks them 'served' via PATCH /:id/status.
router.get('/kitchen', requireKitchenOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await Order.find(
      { hotelId: req.hotelId, status: { $in: ['pending', 'preparing', 'ready'] } },
      { orderNumber: 1, tableNumber: 1, customerName: 1, notes: 1, status: 1, isParcel: 1,
        orderSource: 1, acceptedAt: 1, platformOrderId: 1, deliveryAddress: 1,
        createdAt: 1, 'items.product': 1, 'items.productName': 1, 'items.quantity': 1,
        'items.selectedModifiers': 1, 'items.variantName': 1, 'items.notes': 1 },
    ).sort({ createdAt: 1 }).lean();
    res.json(orders);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET /api/orders/waiter/table-summary — active orders grouped by table (for waiter home screen)
router.get('/waiter/table-summary', requireWaiterOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await Order.find(
      { hotelId: req.hotelId, status: { $in: ['pending', 'preparing', 'ready'] }, isParcel: false },
      { tableNumber: 1, status: 1 },
    ).lean();
    const grouped: Record<string, { tableNumber: string; orderCount: number; hasReady: boolean }> = {};
    for (const o of orders as any[]) {
      const t = String(o.tableNumber || '');
      if (!t) continue;
      if (!grouped[t]) grouped[t] = { tableNumber: t, orderCount: 0, hasReady: false };
      grouped[t].orderCount++;
      if (o.status === 'ready') grouped[t].hasReady = true;
    }
    res.json(Object.values(grouped));
  } catch (err) {
    sendError(res, 500, 'Failed to load table summary', err);
  }
});

// GET /api/orders/waiter — ready orders waiting to be served, oldest first
router.get('/waiter', requireWaiterOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await Order.find(
      { hotelId: req.hotelId, status: 'ready' },
      { orderNumber: 1, tableNumber: 1, customerName: 1, notes: 1, status: 1, isParcel: 1, createdAt: 1,
        'items.productName': 1, 'items.quantity': 1 },
    ).sort({ createdAt: 1 }).lean();
    res.json(orders);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET /api/orders/cashier — all active orders + today's completed orders
router.get('/cashier', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const orders = await Order.find(
      {
        hotelId: req.hotelId,
        $or: [
          { status: { $in: ['pending', 'preparing', 'ready', 'served'] } },
          { status: 'completed', completedAt: { $gte: startOfDay } },
          // Held for counter payment (pay before kitchen) — online orders excluded
          { status: 'payment_pending', paymentMethod: { $ne: 'razorpay' } },
        ],
      },
      {
        orderNumber: 1, tableNumber: 1, customerName: 1, notes: 1, paymentTime: 1,
        status: 1, paymentMethod: 1, grandTotal: 1, subtotal: 1, taxTotal: 1, discountAmount: 1,
        orderSource: 1, isParcel: 1, createdAt: 1, completedBy: 1, completedAt: 1, cashierId: 1,
        // Batch 3: what the payment dialog and the invoice need to show the real amount owed
        couponDiscount: 1, loyaltyDiscount: 1, paymentDiscount: 1, giftVoucherAmount: 1, walletAmount: 1,
        deliveryFee: 1, amountSettled: 1, redeemedPoints: 1, customerPhone: 1,
        'items.productName': 1, 'items.quantity': 1, 'items.price': 1, 'items.total': 1,
        // Batch 3: the invoice shows the size, add-ons and note of each line
        'items.variantName': 1, 'items.selectedModifiers': 1, 'items.notes': 1,
      }
    ).sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET /orders/cashier/pending-summary — bills with money still owed (Batch 3). One server rule for
// the admin and cashier dashboards; based on outstanding balances, not kitchen status.
router.get('/cashier/pending-summary', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    res.json(await pendingPayments(new mongoose.Types.ObjectId(req.hotelId!)));
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET all orders
router.get('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { hotelId: req.hotelId };

    if (req.query.date) {
      const date = new Date(req.query.date as string);
      if (isNaN(date.getTime())) return res.status(400).json({ message: 'Invalid date format' });
      const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    }
    // Accept both from/to (legacy) and dateFrom/dateTo (new) query params
    const fromStr = (req.query.from || req.query.dateFrom) as string | undefined;
    const toStr   = (req.query.to   || req.query.dateTo)   as string | undefined;
    if (fromStr && toStr) {
      const from = new Date(fromStr);
      const to = new Date(toStr);
      to.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: from, $lte: to };
    }
    // Only plain strings (or repeated ?status=a&status=b) may reach the filter.
    // sanitizeRequest strips "$" keys, so ?status[$ne]=x arrives as {} and used to 500.
    const isStrOrStrList = (v: unknown) =>
      typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string'));
    if (req.query.status) {
      const s = req.query.status;
      if (!isStrOrStrList(s)) return res.status(400).json({ message: 'Invalid status filter' });
      filter.status = Array.isArray(s) ? { $in: s } : s;
    }
    if (req.query.source) {
      const s = req.query.source;
      if (!isStrOrStrList(s)) return res.status(400).json({ message: 'Invalid source filter' });
      filter.orderSource = Array.isArray(s) ? { $in: s } : s;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 20), 200);
    const skip = (page - 1) * limit;

    if (req.query.q) {
      const raw = (req.query.q as string).trim();
      if (raw) {
        // Escape regex special characters to prevent injection
        const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const qRx = new RegExp(escaped, 'i');
        (filter as any).$or = [
          { orderNumber: qRx },
          { customerName:  qRx },
          { customerPhone: qRx },
        ];
      }
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    const totalPages = Math.ceil(total / limit);
    res.json({ orders, total, page, pages: totalPages, totalPages });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET customer list — aggregated from orders (name, phone, totalOrders, totalSpent, lastOrderDate)
router.get('/customers', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const match: any = {
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      status: { $ne: 'cancelled' }, ...PAID_ORDER,
      customerPhone: { $nin: ['', null] },
    };

    if (req.query.from && req.query.to) {
      const from = new Date(req.query.from as string);
      const to = new Date(req.query.to as string);
      to.setHours(23, 59, 59, 999);
      match.createdAt = { $gte: from, $lte: to };
    } else {
      // Default cap: last 90 days — prevents unbounded full-collection scan
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      match.createdAt = { $gte: ninetyDaysAgo };
    }

    const customers = await Order.aggregate([
      { $match: match },
      // No pre-group $sort — $first/$max/$min accumulators don't require sorted input
      { $group: {
        _id: '$customerPhone',
        customerName:   { $first: '$customerName' },
        totalOrders:    { $sum: 1 },
        totalSpent:     { $sum: NET_TOTAL },
        lastOrderDate:  { $max: '$createdAt' },
        firstOrderDate: { $min: '$createdAt' },
      }},
      { $sort: { lastOrderDate: -1 } },
      { $limit: 500 },
      { $project: { _id: 0, phone: '$_id', customerName: 1, totalOrders: 1, totalSpent: 1, lastOrderDate: 1, firstOrderDate: 1 } },
    ]).option({ maxTimeMS: 30_000 });

    res.json({ customers, total: customers.length });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET single order
router.get('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// POST create order — admin, waiter, and cashier can create orders; kitchen cannot
router.post('/', requireWaiterOrCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    logger.info('[POST /orders] Received', { hotelId: req.hotelId, role: req.role, itemCount: Array.isArray(req.body.items) ? req.body.items.length : 0 });
    // Every order must have at least one item and at most 100 items
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }
    if (req.body.items.length > 100) {
      return res.status(400).json({ message: 'Order cannot contain more than 100 items' });
    }
    // Customer name and phone are mandatory for all orders
    if (!req.body.customerName || !String(req.body.customerName).trim()) {
      return res.status(400).json({ message: 'Customer name is required' });
    }
    if (!req.body.customerPhone || !String(req.body.customerPhone).trim()) {
      return res.status(400).json({ message: 'Customer phone is required' });
    }

    // ── Idempotency guard ────────────────────────────────────────────────────
    // offlineId is the client-generated queue item id. If the network dropped
    // after the server saved but before the client received the 201, the client
    // will retry. We return the already-saved order instead of duplicating it.
    if (req.body.offlineId) {
      const existing = await Order.findOne({
        offlineId: req.body.offlineId,
        hotelId: req.hotelId,
      });
      if (existing) return res.status(200).json(existing);
    }

    // Phase 5 · Batch 5 (Decision 3): money taken at the counter needs an open shift.
    if (req.body.payNow === true && (req.role === 'cashier' || req.role === 'admin')
        && isCounterMethod(req.body.paymentMethod) && await refuseWithoutShift(res, req.hotelId!)) return;

    // ── Phase 4: Order Route Guard ────────────────────────────────────────────
    // When sessionId + guestId are both provided, validate the ownership chain:
    //   hotel → session open → guest active + belongs to this session.
    // If either lookup returns null the order is rejected (guest stale/wrong hotel).
    // Hotels without tableSessions simply have no sessions — validation returns null
    // naturally, so an explicit feature-flag check is not needed here.
    let linkedGuestId: mongoose.Types.ObjectId | null = null;
    // Session the order belongs to. Set by the explicit sessionId/guestId path below and by
    // the auto-session path (staff order with only a tableId), and written onto the order so
    // the table bill, guest billing (Order.updateMany by guestId) and release checks see it.
    let linkedSessionId: mongoose.Types.ObjectId | null = null;

    if (req.body.sessionId && req.body.guestId) {
      const { sessionId, guestId } = req.body;

      if (!mongoose.isValidObjectId(sessionId) || !mongoose.isValidObjectId(guestId)) {
        return res.status(400).json({ message: 'Invalid sessionId or guestId' });
      }

      const [linkedSession, linkedGuest] = await Promise.all([
        TableSession.findOne({ _id: sessionId, hotelId: req.hotelId, status: 'open' }),
        Guest.findOne({ _id: guestId, sessionId, hotelId: req.hotelId, status: 'active' }),
      ]);

      if (!linkedSession) {
        return res.status(409).json({ message: 'Session not found or not open' });
      }
      if (!linkedGuest) {
        return res.status(409).json({ message: 'Guest not found, not active, or does not belong to this session' });
      }

      linkedGuestId = linkedGuest._id as mongoose.Types.ObjectId;
      linkedSessionId = linkedSession._id as mongoose.Types.ObjectId;

      // CustomerProfile find/create when phone + name provided and guest has no profile yet
      const { customerPhone, customerName } = req.body;
      if (customerPhone && !linkedGuest.customerId) {
        try {
          const entry = await resolveHotelStatus(req.hotelId!);
          if ((entry.features as any)?.customerIdentification === 'name_mobile') {
            // E-5 fix: always normalize to E.164 before matching/storing
            const e164Phone = normalizePhone(String(customerPhone));
            const cleanName = String(customerName || '').trim().slice(0, 100);

            if (e164Phone) {
              let profile = await CustomerProfile.findOne({
                hotelId: new mongoose.Types.ObjectId(req.hotelId),
                phone:   e164Phone,
                status:  { $ne: 'merged' },
              });

              if (!profile && cleanName) {
                const newCustomerId = await nextCustomerId(req.hotelId!);
                profile = await CustomerProfile.create({
                  hotelId:     new mongoose.Types.ObjectId(req.hotelId),
                  customerId:  newCustomerId,
                  name:        cleanName,
                  phone:       e164Phone,
                  lastVisitAt: new Date(),
                  firstVisitAt: new Date(),
                  visitCount:  1,
                });
                logger.info('CustomerProfile created', { customerId: String(newCustomerId), hotelId: req.hotelId });
              } else if (profile) {
                // E-6 fix: only increment visitCount when the guest has no prior profile link
                // (i.e., this is the first order linking this customer to this session/guest).
                // visitCount increments once per guest session, not per order.
                CustomerProfile.findByIdAndUpdate(profile._id, {
                  $set: { lastVisitAt: new Date(), ...(cleanName ? { name: cleanName } : {}) },
                  $inc: { visitCount: 1 },
                }).catch(() => {});
              }

              if (profile) {
                // Link profile to guest — non-blocking; subsequent orders for the same
                // guest already have customerId set, so the outer `!linkedGuest.customerId`
                // guard prevents further increments for the same guest.
                Guest.findByIdAndUpdate(linkedGuest._id, { $set: { customerId: profile._id } }).catch(() => {});
              }
            }
          }
        } catch (profileErr) {
          // CustomerProfile failure is non-fatal — order still proceeds
          logger.warn('CustomerProfile lookup/create failed; order proceeds', { error: String(profileErr), hotelId: req.hotelId });
        }
      }
    } else if (req.body.tableId && mongoose.isValidObjectId(req.body.tableId)) {
      // ── Phase 5: Waiter auto-session ──────────────────────────────────────────
      // When a staff member places an order with a tableId but no explicit sessionId/guestId,
      // auto-create a session (if none is open) and link to a default "table" guest.
      // Hotels with tableSessions=false skip this entirely (no feature lookup needed —
      // they won't have any sessions, so findOne returns null and would create one;
      // we guard with resolveHotelStatus to keep strict feature control).
      try {
        const entry = await resolveHotelStatus(req.hotelId!);
        if ((entry.features as any)?.tableSessions) {
          const openedBy = req.role === 'waiter' && req.waiterName
            ? `Waiter: ${req.waiterName}`
            : req.role === 'cashier' && req.cashierName
            ? `Cashier: ${req.cashierName}`
            : 'Admin';

          const { session, created } = await findOrCreateOpenSession(
            req.body.tableId,
            req.hotelId!,
            openedBy,
          );

          if (created) {
            try {
              io.to(`hotel_${req.hotelId}`).emit('session_opened', {
                sessionId:   String(session._id),
                tableId:     String(session.tableId),
                tableNumber: session.tableNumber,
                openedBy,
                openedAt:    session.openedAt,
              });
            } catch { /* non-critical */ }
          }

          const defaultGuest = await findOrCreateDefaultGuest(session, req.hotelId!);
          linkedGuestId = defaultGuest._id as mongoose.Types.ObjectId;
          linkedSessionId = session._id as mongoose.Types.ObjectId;
        }
      } catch (sessionErr: any) {
        if (sessionErr.httpStatus === 404) {
          return res.status(404).json({ message: sessionErr.message });
        }
        if (sessionErr.httpStatus === 409) {
          return res.status(409).json({ message: sessionErr.message });
        }
        // Other session errors are non-fatal — order proceeds without session link
        logger.warn('Auto-session error; order proceeds without session', { error: String(sessionErr), hotelId: req.hotelId });
      }
    }

    // ── Server-side price + modifier integrity check ─────────────────────────
    const { items: validatedItems, error: itemError, code: itemCode, trackedStock } = await validateAndEnrichItems(
      req.body.items,
      req.hotelId!,
    );
    if (itemError) {
      return res.status(itemCode ? 409 : 422).json({ message: itemError, ...(itemCode ? { code: itemCode } : {}) });
    }

    // ── Server-side coupon resolution ─────────────────────────────────────────
    // Compute item totals first (needed for coupon minimum order check).
    const preCoupon     = recalcOrderTotals(validatedItems, 0, 0);
    // Batch 3: the POS sends the subtotal the cashier sees. If a price changed since the dish was
    // added, refuse before anything is recorded: the bill must never differ from the screen.
    // Optional, so offline-queued bills and other clients are not affected.
    if (req.body.expectedSubtotal != null) {
      const shown = Number(req.body.expectedSubtotal);
      if (!Number.isFinite(shown) || Math.abs(shown - preCoupon.subtotal) > PAISE) {
        return res.status(409).json({
          code: 'PRICE_CHANGED',
          message: `Prices have changed since this bill was started (screen ₹${(Number.isFinite(shown) ? shown : 0).toFixed(2)}, current ₹${preCoupon.subtotal.toFixed(2)} before tax). Remove the changed dish and add it again.`,
        });
      }
    }
    const orderTotal    = preCoupon.subtotal + preCoupon.taxTotal;
    let couponResult: CouponResult | null = null;
    try {
      couponResult = await resolveCoupon(
        req.body.couponCode,
        req.hotelId!,
        orderTotal,
        validatedItems,
      );
    } catch (couponErr: any) {
      return res.status(400).json({ message: couponErr.message, code: couponErr.code ?? 'COUPON_ERROR' });
    }

    // Resolve customer identity for per-customer coupon limit enforcement
    let couponCustomerId: mongoose.Types.ObjectId | null = null;
    let couponCustomerPhone = '';
    if (couponResult) {
      const rawPhone = String(req.body.customerPhone || '');
      const np = rawPhone ? normalizePhone(rawPhone) : '';
      if (np) {
        couponCustomerPhone = np;
        const cpDoc = await CustomerProfile.findOne({
          hotelId: new mongoose.Types.ObjectId(req.hotelId!),
          phone:   np,
          status:  { $ne: 'merged' },
        }).select('_id').lean();
        if (cpDoc) couponCustomerId = (cpDoc as any)._id;
      }
    }

    // ── Server-side gift voucher resolution ──────────────────────────────────
    // hotelId is always from JWT (req.hotelId) — never from req.body
    const rawVoucherCode = req.body.giftVoucherCode
      ? String(req.body.giftVoucherCode).trim().toUpperCase()
      : '';
    let voucherDoc: any = null;
    if (rawVoucherCode) {
      const voucherNow = new Date();
      voucherDoc = await GiftVoucher.findOne({
        hotelId:     new mongoose.Types.ObjectId(req.hotelId!),
        voucherCode: rawVoucherCode,
        isActive:    true,
        isDeleted:   false,
        $or: [{ expiresAt: null }, { expiresAt: { $gte: voucherNow } }],
      }).select('_id voucherCode balance').lean();
      if (!voucherDoc) {
        return res.status(400).json({ message: 'Gift voucher not found, expired, or inactive' });
      }
    }

    const orderNumber = await generateOrderNumber(req.hotelId!);

    // ── H1: Verify loyaltyDiscount against server-side redemption rate ─────────
    // Prevent a client from inflating loyaltyDiscount beyond what the redeemed
    // points are worth. Config is fetched once and reused in H2 below.
    const rawRedeemedPts = Math.max(0, Number(req.body.redeemedPoints) || 0);
    let verifiedLoyaltyDiscount = Math.max(0, Number(req.body.loyaltyDiscount) || 0);
    let h2LoyaltyCfg: Awaited<ReturnType<typeof getLoyaltyConfig>> | null = null;
    let h2RedeemProfile: { _id: mongoose.Types.ObjectId; orgCustomerId?: mongoose.Types.ObjectId | null } | null = null;
    let h2OrgCtx: OrgLoyaltyContext | null = null;
    if (rawRedeemedPts > 0) {
      // ── H1: Pre-fetch profile (needed for both branch and org-loyalty paths) ──
      const e164Phone = normalizePhone(String(req.body.customerPhone || ''));
      if (e164Phone) {
        h2RedeemProfile = await CustomerProfile.findOne({
          hotelId:       new mongoose.Types.ObjectId(req.hotelId),
          phone:         e164Phone,
          status:        'active',
          loyaltyOptOut: { $ne: true },
        }).select('_id orgCustomerId') as { _id: mongoose.Types.ObjectId; orgCustomerId?: mongoose.Types.ObjectId | null } | null;
      }
      if (h2RedeemProfile) {
        // Check if org-loyalty is active for this customer — if so, use HQ config
        h2OrgCtx = await resolveOrgLoyalty(h2RedeemProfile, req.hotelId!);
      }
      // Use org HQ config when org-loyalty is active; otherwise use branch config
      h2LoyaltyCfg = h2OrgCtx ? h2OrgCtx.hqConfig : await getLoyaltyConfig(req.hotelId!);
      // maxAllowedDiscount = points × (pointValueInPaisa / 100) in rupees
      const maxAllowedDiscount = rawRedeemedPts * (h2LoyaltyCfg.pointValueInPaisa / 100);
      verifiedLoyaltyDiscount = Math.min(verifiedLoyaltyDiscount, maxAllowedDiscount);
      if (!h2LoyaltyCfg.enabled || !h2RedeemProfile) {
        verifiedLoyaltyDiscount = 0;
        h2RedeemProfile = null;
        h2OrgCtx = null;
      }
    } else {
      verifiedLoyaltyDiscount = 0; // no points redeemed → zero loyalty discount allowed
    }

    // RBAC: discount gate — admin unrestricted; non-admin allowed only up to hotel's cap
    if (Number(req.body.discountAmount) > 0 && req.role !== 'admin') {
      const hotelCap = await Hotel.findById(req.hotelId).select('maxCashierDiscountPercent').lean() as any;
      const cap: number = hotelCap?.maxCashierDiscountPercent ?? 0;
      if (cap === 0) {
        return res.status(403).json({ message: 'Only admins can apply discounts.' });
      }
      const quickBase = validatedItems.reduce((s: number, i: any) =>
        s + (Number(i.price) || 0) * Math.max(1, Math.floor(Number(i.quantity) || 1)), 0);
      const pct = quickBase > 0 ? (Number(req.body.discountAmount) / quickBase * 100) : 0;
      if (pct > cap) {
        return res.status(403).json({ message: `Discount ${pct.toFixed(1)}% exceeds cashier limit of ${cap}%. Contact admin.` });
      }
    }

    const recalc = recalcOrderTotals(
      validatedItems,
      req.body.discountAmount,
      verifiedLoyaltyDiscount,
      couponResult?.couponDiscount ?? 0,
    );
    // Explicit field allowlist — never spread req.body to prevent mass-assignment of
    // server-controlled fields (status, completedBy, completedAt, cashierId, hotelId).
    const b = req.body;
    // Server-authoritative voucher amount: min(voucher balance, post-coupon grand total)
    const serverVoucherAmount = voucherDoc && voucherDoc.balance > 0
      ? Math.round(Math.min(voucherDoc.balance, recalc.grandTotal) * 100) / 100
      : 0;
    const cappedDeliveryFee = Math.max(0, Math.min(Number(b.deliveryFee ?? b.deliveryCharge) || 0, 9999));
    const grandTotalBeforeWallet = Math.round(Math.max(0, recalc.grandTotal - serverVoucherAmount + cappedDeliveryFee) * 100) / 100;

    // C-03: Server-authoritative wallet amount — capped at the remaining payable balance.
    const rawWalletCustomerId = b.walletCustomerId ? String(b.walletCustomerId) : null;
    const rawWalletAmount     = Math.max(0, Number(b.walletAmount) || 0);
    let walletCustomerOId: mongoose.Types.ObjectId | null = null;
    let serverWalletAmount = 0;
    if (rawWalletCustomerId && rawWalletAmount > 0 && mongoose.Types.ObjectId.isValid(rawWalletCustomerId)) {
      walletCustomerOId  = new mongoose.Types.ObjectId(rawWalletCustomerId);
      serverWalletAmount = Math.round(Math.min(rawWalletAmount, grandTotalBeforeWallet) * 100) / 100;
    }

    const finalGrandTotal = Math.round(Math.max(0, grandTotalBeforeWallet - serverWalletAmount) * 100) / 100;
    const order = new Order({
      tableNumber:         b.tableNumber,
      customerName:        b.customerName,
      customerPhone:       b.customerPhone,
      notes:               b.notes,
      // Phase 5 · Batch 7: dine-in guest count from the POS (a whole number 1–999, else not stored)
      guestCount:          b.orderSource === 'dine-in' && Number.isInteger(Number(b.guestCount)) && Number(b.guestCount) >= 1 && Number(b.guestCount) <= 999
                             ? Number(b.guestCount) : null,
      orderSource:         b.orderSource,
      isParcel:            b.isParcel,
      paymentMethod:       b.paymentMethod,
      splitDetails:        b.splitDetails,
      tableId:             b.tableId,
      // P4-TBL-01: the auto-session path resolves the session and guest on the server;
      // without these the order was saved unlinked (bill ₹0, never marked paid by guest billing).
      sessionId:           linkedSessionId ?? b.sessionId,
      // F-5: validate guestId format before storing — prevents malformed values from
      // breaking downstream queries that cast it to ObjectId.
      guestId:             linkedGuestId
                             ?? ((b.guestId && mongoose.isValidObjectId(b.guestId)) ? b.guestId : undefined),
      offlineId:           b.offlineId ?? null,
      deliveryAddress:     b.deliveryAddress,
      platformOrderId:     b.platformOrderId,
        deliveryFee:         cappedDeliveryFee,
      platformCommission:  b.platformCommission,
      estimatedPickupTime: b.estimatedPickupTime,
      deliveryPartnerName: b.deliveryPartnerName,
      redeemedPoints:      b.redeemedPoints,
      hotelId:             req.hotelId,
      orderNumber,
      items:               recalc.items,
      subtotal:            recalc.subtotal,
      taxTotal:            recalc.taxTotal,
      discountAmount:      recalc.discountAmount,
      couponId:            couponResult?.couponId ?? null,
      couponCode:          couponResult?.couponCode ?? '',
      couponDiscount:      recalc.couponDiscount,
      loyaltyDiscount:     recalc.loyaltyDiscount,
      giftVoucherId:       voucherDoc ? voucherDoc._id : null,
      giftVoucherCode:     rawVoucherCode || '',
      giftVoucherAmount:   serverVoucherAmount,
      walletAmount:        serverWalletAmount,
      walletCustomerId:    walletCustomerOId,
      grandTotal:          finalGrandTotal,
    });

    // ── Pay before kitchen ───────────────────────────────────────────────────
    // payNow: the counter took payment while placing the order — it goes to the
    // kitchen already paid. Otherwise, if the hotel holds unpaid orders, park it in
    // 'payment_pending' (no kitchen list, no new_order, no KOT) until POST /:id/pay.
    const payNow = b.payNow === true && (req.role === 'cashier' || req.role === 'admin');
    let payNowParts: ReturnType<typeof moneyParts> = null;
    if (payNow) {
      if (!COUNTER_PAY_METHODS.includes(String(b.paymentMethod))) {
        return res.status(400).json({ message: 'Choose Cash, UPI, Card or Split to take payment.' });
      }
      // Batch 2 (2B): the ledger parts must add up to the bill to the paisa.
      payNowParts = moneyParts(String(b.paymentMethod), order.grandTotal, b.splitDetails);
      if (!payNowParts || payNowParts.length === 0) {
        return res.status(400).json({ message: `Split amounts must add up to the bill total (₹${Number(order.grandTotal).toFixed(2)}) exactly.` });
      }
      order.paymentTime = new Date();
    } else if (b.paymentMethod !== 'razorpay' && await payBeforeKitchenEnabled(req.hotelId!)) {
      order.status = 'payment_pending';
    }
    const heldForPayment = order.status === 'payment_pending';

    // ── Atomic transaction: persist order + deduct stock atomically ──────────
    // order.save() and both stock-deduction writes must succeed or fail together.
    // KOT print, guest total, stock-response read, and socket emit run AFTER
    // the transaction commits so they never see a rolled-back order.
    const stockItems = order.items.filter(i => i.product);
    // Phase 5 · Batch 6 (P4-INV-03): counted dishes are taken off stock only if enough is left
    // (was: clamped at 0, so a second till could sell a plate that did not exist). One update per
    // dish for all its lines; if any dish no longer has enough, the whole order is rolled back.
    const stockWanted = new Map<string, number>();
    for (const item of stockItems) {
      const id = String(item.product);
      if (trackedStock?.has(id)) stockWanted.set(id, (stockWanted.get(id) ?? 0) + item.quantity);
    }
    const stockBulkOps = [...stockWanted].map(([id, qty]) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(id), hotelId: req.hotelId, stock: { $gte: qty } },
        update: [
          { $set: { stock: { $subtract: ['$stock', qty] } } },
          { $set: { isAvailable: { $gt: ['$stock', 0] } } },
        ],
      },
    }));

    let ingredientDeltas = new Map<string, number>();
    let saleMovementPrevStocks = new Map<string, number>();
    let ingredientShortfalls = new Map<string, number>();
    const txSession = await mongoose.startSession();
    try {
      await txSession.withTransaction(async () => {
        // Phase 5 · Batch 6: withTransaction re-runs this block after a write conflict (e.g. two tills
        // selling the same counted dish). The first, aborted attempt left the order marked as saved,
        // so the retry tried to UPDATE an order that was never committed (DocumentNotFoundError →
        // "Invalid data"). Every attempt inserts it afresh.
        order.isNew = true;
        // Atomically claim one coupon usage slot inside the transaction.
        // If the limit is exhausted by a concurrent order, the transaction aborts.
        if (couponResult) {
          const couponDoc = await Coupon.findOneAndUpdate(
            {
              _id:       couponResult.couponId,
              hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
              isActive:  true,
              isDeleted: false,
              $or: [
                { usageLimit: { $lte: 0 } },
                { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
              ],
            },
            { $inc: { usageCount: 1 } },
            { session: txSession },
          );
          if (!couponDoc) {
            const e = new Error('Coupon usage limit reached — please try a different coupon');
            (e as any).isCouponError = true;
            throw e;
          }

          // C-11: perCustomerLimit requires customer identity — cannot skip by omitting phone
          if (couponDoc.perCustomerLimit > 0 && !couponCustomerId && !couponCustomerPhone) {
            const e = new Error('This coupon requires customer phone number to enforce per-customer limits');
            (e as any).isCouponError = true;
            (e as any).code = 'COUPON_IDENTITY_REQUIRED';
            throw e;
          }

          // Per-customer limit check (enforced inside the transaction)
          if (couponDoc.perCustomerLimit > 0 && (couponCustomerId || couponCustomerPhone)) {
            const custFilter: Record<string, any> = {
              hotelId:  new mongoose.Types.ObjectId(req.hotelId!),
              couponId: couponResult!.couponId,
              status:   'redeemed',
            };
            if (couponCustomerId) custFilter.customerId = couponCustomerId;
            else custFilter.phone = couponCustomerPhone;
            const ccount = await CouponRedemption.countDocuments(custFilter, { session: txSession });
            if (ccount >= couponDoc.perCustomerLimit) {
              const e = new Error('You have reached the per-customer usage limit for this coupon');
              (e as any).isCouponError = true;
              (e as any).code = 'COUPON_CUSTOMER_LIMIT';
              throw e;
            }
          }

          // Record the redemption atomically alongside the order
          await CouponRedemption.create([{
            hotelId:        new mongoose.Types.ObjectId(req.hotelId!),
            couponId:       couponResult!.couponId,
            couponCode:     couponResult!.couponCode,
            orderId:        order._id,
            customerId:     couponCustomerId,
            phone:          couponCustomerPhone,
            discountAmount: recalc.couponDiscount,
            status:         'redeemed',
            redeemedAt:     new Date(),
          }], { session: txSession });
        }
        // Atomically deduct gift voucher balance inside the transaction
        if (voucherDoc && serverVoucherAmount > 0) {
          const vNow = new Date();
          const deducted = await GiftVoucher.findOneAndUpdate(
            {
              _id:       voucherDoc._id,
              hotelId:   new mongoose.Types.ObjectId(req.hotelId!),
              isActive:  true,
              isDeleted: false,
              $or: [{ expiresAt: null }, { expiresAt: { $gte: vNow } }],
              balance:   { $gte: serverVoucherAmount },
            },
            [
              { $set: { balance: { $subtract: ['$balance', serverVoucherAmount] } } },
              {
                $set: {
                  isActive: { $cond: { if: { $lte: ['$balance', 0] }, then: false, else: '$isActive' } },
                  transactions: {
                    $concatArrays: [
                      { $ifNull: ['$transactions', []] },
                      [{
                        type: 'redeem', amount: serverVoucherAmount, balanceAfter: { $ifNull: ['$balance', 0] },
                        orderId: order._id,
                        remarks: `Order ${orderNumber}`,
                        createdBy: `cashier:${req.hotelId}`,
                        createdAt: vNow,
                      }],
                    ],
                  },
                },
              },
            ] as any,
            { session: txSession, new: true },
          );
          if (!deducted) {
            const e = new Error('Gift voucher is no longer valid or has insufficient balance — please re-validate');
            (e as any).isVoucherError = true;
            throw e;
          }
        }

        // C-03: Atomically deduct wallet balance inside the same transaction.
        // Using findOneAndUpdate with balance >= check prevents overdraft even under concurrency.
        if (walletCustomerOId && serverWalletAmount > 0) {
          const walletUpdated = await CustomerProfile.findOneAndUpdate(
            {
              _id:           walletCustomerOId,
              hotelId:       new mongoose.Types.ObjectId(req.hotelId!),
              walletBalance: { $gte: serverWalletAmount },
            },
            { $inc: { walletBalance: -serverWalletAmount } },
            { new: true, session: txSession },
          );
          if (!walletUpdated) {
            const e = new Error('Insufficient wallet balance — please re-validate');
            (e as any).isWalletError = true;
            throw e;
          }
          await WalletTransaction.create([{
            hotelId:      new mongoose.Types.ObjectId(req.hotelId!),
            customerId:   walletCustomerOId,
            type:         'debit',
            source:       'redemption',
            amount:       serverWalletAmount,
            balanceAfter: +((walletUpdated as any).walletBalance ?? 0).toFixed(2),
            orderId:      order._id,
            paymentRef:   '',
            remarks:      `Order ${orderNumber} payment`,
            createdBy:    req.cashierId || req.waiterId || req.hotelId || 'cashier',
          }], { session: txSession });
        }

        // Ingredient deduction runs first so we capture actual clamped deltas
        // and persist them on the order for use during cancellation restoration.
        const { actualDeltas, previousStocks, shortfalls, ingredientNames } = await applyIngredientStockChange(order.items, req.hotelId!, -1, txSession);
        ingredientDeltas = actualDeltas;
        saleMovementPrevStocks = previousStocks;
        ingredientShortfalls = shortfalls;
        if (ingredientDeltas.size > 0) order.ingredientDeltas = ingredientDeltas;
        await order.save({ session: txSession });
        if (stockBulkOps.length > 0) {
          const sw = await Product.bulkWrite(stockBulkOps as any, { session: txSession });
          if (sw.matchedCount !== stockBulkOps.length) {
            const e = new Error('A dish on this bill sold out while it was being placed. Refresh the menu and check the bill.');
            (e as any).isStockError = true;
            throw e;
          }
        }
        // H2: loyalty redemption inside transaction — if it fails the whole order is rolled back
        // so the loyalty ledger and order discount are always consistent.
        if (order.redeemedPoints > 0 && h2LoyaltyCfg?.enabled && h2RedeemProfile) {
          if (h2OrgCtx) {
            // Org-loyalty path: deduct from OrganizationCustomer.orgLoyaltyBalance
            await redeemOrgPoints(
              h2OrgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
              h2OrgCtx.orgCustomer!.orgHotelId.toString(),
              req.hotelId!,
              h2RedeemProfile._id as mongoose.Types.ObjectId,
              order.redeemedPoints,
              h2LoyaltyCfg,
              { orderId: String(order._id), createdBy: req.cashierName || 'cashier' },
              txSession,
            );
          } else {
            // Branch-loyalty path (unchanged behavior)
            await redeemPoints(
              h2RedeemProfile._id as mongoose.Types.ObjectId,
              req.hotelId!,
              order.redeemedPoints,
              h2LoyaltyCfg,
              { orderId: String(order._id), createdBy: req.cashierName || 'cashier' },
            );
          }
        }
        // B-01: StockMovement for sale is now inside the transaction — atomic with the
        // stock deduction so neither can succeed without the other.
        if (ingredientDeltas.size > 0) {
          const saleMovements = Array.from(ingredientDeltas.entries()).flatMap(([id, delta]) => {
            if (delta <= 0) return [] as any[];
            const prev = saleMovementPrevStocks.get(id) ?? 0;
            return [{
              hotelId:        req.hotelId,
              ingredientId:   id,
              ingredientName: ingredientNames.get(id) ?? 'Unknown',
              type:           'sale' as const,
              delta:          -delta,
              previousStock:  prev,
              resultingStock: prev - delta,
              referenceId:    String(order._id),
              referenceType:  'order' as const,
              reason:         `Order #${order.orderNumber ?? ''}`,
              performedBy:    String((req as any).cashierId ?? (req as any).waiterId ?? ''),
            }];
          });
          if (saleMovements.length > 0) {
            await StockMovement.insertMany(saleMovements, { session: txSession });
          }
        }
      });
    } finally {
      await txSession.endSession();
    }

    logger.info('Order saved', { orderId: String(order._id), orderNumber: order.orderNumber, hotelId: req.hotelId });
    if (stockBulkOps.length > 0) invalidateProductList(req.hotelId!);   // Batch 6 (P4-INV-04)

    // ── Phase 7: Fire-and-forget KOT print ───────────────────────────────────
    // An order held for payment gets its KOT when it is paid (POST /:id/pay).
    if (!heldForPayment) scheduleKOTPrint(req.hotelId!, {
      _id:         order._id,
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      customerName: order.customerName,
      items:       order.items as { productName: string; quantity: number }[],
      notes:       order.notes,
      orderSource: order.orderSource,
      createdAt:   order.createdAt,
      sessionId:   order.sessionId,
      guestId:     linkedGuestId ?? undefined,
    }).catch(() => {});

    // ── Batch 2 (2B): payment taken while placing the order → payment ledger ───
    // After the order transaction committed. If this fails the order still carries paymentTime,
    // and reports fall back to it (legacy rule), so the collection is never lost.
    if (payNow && payNowParts && payNowParts.length) {
      await recordEntries(req.hotelId!, payNowParts.map(p => ({
        type: 'payment' as const, method: p.method, amount: p.amount, paidAt: order.paymentTime as Date, source: 'pay_now',
        allocations: [{ orderId: order._id as any, amount: p.amount }],
        sessionId: order.sessionId, guestId: linkedGuestId,
        reference: String(b.transactionId ?? '').slice(0, 120),
        recordedBy: req.cashierName || req.role || '',
        idempotencyKey: `paynow:${order._id}:${p.method}`,
      }))).catch(err => logger.error('[ledger] pay-now entry failed', { orderId: String(order._id), error: String(err) }));
    }

    // ── Phase 4: Update guest running total ───────────────────────────────────
    // Only counter-payable orders add to what the guest owes (see counterBilling).
    if (linkedGuestId && isDueAtCounter(order)) {
      await Guest.findByIdAndUpdate(linkedGuestId, { $inc: { totalAmount: order.grandTotal } });
    }

    // ── Return stock updates to client ───────────────────────────────────────
    // Client applies these immediately so local cache reflects server truth
    // without waiting for the next full cache refresh.
    let stockUpdates: { productId: string; newStock: number }[] = [];
    if (stockItems.length > 0) {
      const updatedProducts = await Product.find({
        _id: { $in: stockItems.map(i => i.product) },
        hotelId: req.hotelId,
      }).select('_id stock');
      stockUpdates = updatedProducts.map(p => ({
        productId: (p._id as mongoose.Types.ObjectId).toString(),
        newStock:  (p as any).stock ?? 0,
      }));
      // Dishes this order sold out are now unavailable — take them off Swiggy / Zomato too
      const soldOut = stockUpdates.filter(s => s.newStock === 0).map(s => s.productId);
      if (soldOut.length > 0) void pushDeliveryAvailability(req.hotelId!, soldOut);
    }

    // Held orders are announced to the kitchen when they are paid (POST /:id/pay).
    if (!heldForPayment) emitNewOrder(req.hotelId!, order);

    const responseBody: Record<string, unknown> = { ...order.toObject(), stockUpdates };
    if (ingredientShortfalls.size > 0) {
      responseBody.stockShortfall = Object.fromEntries(ingredientShortfalls);
    }
    res.status(201).json(responseBody);

  } catch (error: any) {
    // Race condition: two concurrent syncs of the same offlineId both pass the
    // findOne check before either inserts. The unique index rejects one of them
    // with code 11000. Return the already-saved order rather than a 400 error.
    if (error.code === 11000 && error.keyPattern?.offlineId) {
      try {
        const existing = await Order.findOne({ offlineId: req.body.offlineId, hotelId: req.hotelId });
        if (existing) return res.status(200).json(existing);
      } catch { /* fall through to sendError */ }
    }
    if (error.isCouponError) {
      return res.status(409).json({ message: error.message, code: (error as any).code ?? 'COUPON_USAGE_LIMIT' });
    }
    if ((error as any).isVoucherError) {
      return res.status(400).json({ message: error.message });
    }
    if ((error as any).isWalletError) {
      return res.status(400).json({ message: error.message });
    }
    if ((error as any).isStockError) {
      return res.status(409).json({ code: 'NOT_ENOUGH_STOCK', message: error.message });
    }
    logger.error('[POST /orders] Failed', { hotelId: req.hotelId, error: String(error), code: error.code, stack: error?.stack });
    if (isTemporaryDbError(error)) return sendError(res, 503, 'Could not save the order right now. Please retry.', error);
    sendError(res, 400, 'Invalid data', error);
  }
});

// PATCH update order status only
router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  const { status, paymentMethod } = req.body;
  const allowed = ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  // Role-based status enforcement — staff can only transition to their allowed statuses
  const role = req.role;
  const KNOWN_ROLES = ['admin', 'kitchen', 'waiter', 'cashier'];
  if (!KNOWN_ROLES.includes(role ?? '')) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  // Kitchen cooks (preparing → ready) and may also hand a ready order over (→ served),
  // for kitchens that serve without a waiter.
  if (role === 'kitchen' && !['preparing', 'ready', 'served'].includes(status)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  if (role === 'waiter' && status !== 'served') {
    return res.status(403).json({ message: 'Access denied.' });
  }
  try {
    const existing = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!existing) return res.status(404).json({ message: 'Order not found' });

    // H3: Block cancellation of completed (paid) orders — checked before role gates
    // so all callers (including cashiers) receive the informative 400 rather than a
    // generic 403 when the real problem is that the order is already paid.
    if (status === 'cancelled' && existing.status === 'completed') {
      return res.status(400).json({ message: 'Cannot cancel a completed order. Process a refund instead.' });
    }
    // Cashier: may only complete orders (all other transitions are role-restricted)
    if (role === 'cashier' && status !== 'completed') {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // State machine: enforce valid source-state for each role's allowed transition
    // Kitchen:  can only act on pending/preparing orders, or serve a ready one
    // Waiter:   can only serve a ready order
    // Cashier:  can only complete a served order
    if (role === 'kitchen' && status === 'served' && existing.status !== 'ready') {
      return res.status(400).json({ message: `Order must be ready before it can be served (current: ${existing.status}).` });
    }
    if (role === 'kitchen' && status !== 'served' && !['pending', 'preparing'].includes(existing.status)) {
      return res.status(400).json({ message: `Cannot update kitchen status from '${existing.status}'.` });
    }
    if (role === 'waiter' && existing.status !== 'ready') {
      return res.status(400).json({ message: `Order must be ready before it can be served (current: ${existing.status}).` });
    }
    // C2: Takeaway/delivery orders can be completed directly from 'pending' (immediate counter payment)
    const isQuickService = isQuickServiceOrder(existing as any);
    if (role === 'cashier' && !['served', 'ready'].includes(existing.status)) {
      if (!(isQuickService && existing.status === 'pending')) {
        return res.status(400).json({ message: `Order must be ready or served before it can be completed (current: ${existing.status}).` });
      }
    }

    // Security: payment_pending orders (QR/kiosk-Razorpay) may only be cancelled by staff.
    // Any other status transition bypasses the payment verification gate.
    // Payment release happens exclusively through qr-verify or Razorpay webhook.
    if (existing.status === 'payment_pending' && status !== 'cancelled') {
      return res.status(400).json({
        message: "Payment-pending orders can only be cancelled. Payment must complete through the normal payment flow.",
      });
    }

    // H-04: atomic cancellation — status change and stock restore in a single transaction.
    // findOneAndUpdate is inside the transaction so an order cannot end up permanently
    // cancelled if the stock restoration write fails and the transaction rolls back.
    if (status === 'cancelled') {
      // Batch 3 (3C): the reason is stored (it was discarded), and an order with money already
      // received is not cancelled silently — the admin must confirm a counter refund
      // (`refund: true`), which is recorded in the payment ledger per method. Online payments
      // are refunded through the gateway refund instead.
      const cancelReason = String(req.body.reason ?? req.body.cancelReason ?? '').trim().slice(0, 300);
      const received = r2(Number((existing as any).amountSettled) || 0)
        || ((existing as any).ledger ? 0 : (existing.paymentTime ? r2(existing.grandTotal) : 0));
      let refundParts: Array<{ method: string; amount: number }> = [];
      if (received > 0) {
        const moneyEntries = await PaymentEntry.find({
          hotelId: req.hotelId, type: 'payment', 'allocations.orderId': existing._id,
          method: { $in: ['cash', 'upi', 'card', 'online'] },
        }).lean();
        const byMethod = new Map<string, number>();
        for (const e of moneyEntries as any[]) {
          const a = (e.allocations || []).filter((x: any) => String(x.orderId) === String(existing._id))
            .reduce((t: number, x: any) => t + (Number(x.amount) || 0), 0);
          byMethod.set(e.method, r2((byMethod.get(e.method) || 0) + a));
        }
        if (!(existing as any).ledger) byMethod.set(ledgerMethod(existing.paymentMethod), received);
        refundParts = [...byMethod.entries()].filter(([, v]) => v > 0).map(([method, amount]) => ({ method, amount }));
        if (refundParts.some(p => p.method === 'online')) {
          return res.status(409).json({ code: 'PAID_ONLINE', message: 'This bill was paid online — refund the online payment first, then cancel.' });
        }
        if (req.body.refund !== true) {
          return res.status(409).json({
            code: 'PAID_ORDER', amountReceived: r2(refundParts.reduce((t, p) => t + p.amount, 0)),
            message: `₹${received.toFixed(2)} was already received for this bill. Cancel only with a refund (confirm the refund to the customer).`,
          });
        }
      }
      const bulkOps = existing.items.filter(i => i.product).map(item => ({
        updateOne: {
          filter: { _id: item.product, hotelId: req.hotelId, stock: { $gte: 0 } },
          update: { $inc: { stock: item.quantity }, $set: { isAvailable: true } },
        },
      }));
      let prevDoc: typeof existing | null = null;
      let cancelDeltas = new Map<string, number>();
      const cancelTx = await mongoose.startSession();
      try {
        await cancelTx.withTransaction(async () => {
          prevDoc = await Order.findOneAndUpdate(
            { _id: req.params.id, hotelId: req.hotelId, status: { $ne: 'cancelled' } },
            { $set: {
                status: 'cancelled', cancelReason, cancelledAt: new Date(),
                cancelledBy: String(req.cashierName || (req as any).adminId || req.role || ''),
            } },
            { new: false, session: cancelTx },
          ) as typeof existing | null;
          if (!prevDoc) return; // already cancelled — no side-effects
          if (bulkOps.length > 0) await Product.bulkWrite(bulkOps as any, { session: cancelTx });
          // Pass stored deltas so we restore exactly what was deducted (not full recipe qty)
          const { actualDeltas } = await applyIngredientStockChange(existing.items, req.hotelId!, 1, cancelTx, existing.ingredientDeltas as Map<string, number> | undefined);
          cancelDeltas = actualDeltas;
          // B-01: StockMovement for sale_reversal inside the transaction — atomic with restoration.
          // Read post-restoration currentStock for resultingStock (read-your-own-writes within tx).
          if (cancelDeltas.size > 0) {
            const cancelIngIds = Array.from(cancelDeltas.keys());
            const cancelIngs = await Ingredient.find(
              { _id: { $in: cancelIngIds }, hotelId: req.hotelId },
              { name: 1, currentStock: 1 },
              { session: cancelTx },
            ).lean();
            const reversalMovements = (cancelIngs as any[]).flatMap((i: any) => {
              const id = String(i._id);
              const delta = cancelDeltas.get(id);
              if (!delta || delta <= 0) return [] as any[];
              const resultingStock = Number(i.currentStock);
              return [{
                hotelId:        req.hotelId,
                ingredientId:   id,
                ingredientName: String(i.name),
                type:           'sale_reversal' as const,
                delta:          +delta,
                previousStock:  resultingStock - delta,
                resultingStock,
                referenceId:    String(existing._id),
                referenceType:  'order' as const,
                reason:         `Order #${existing.orderNumber ?? ''} cancelled`,
                performedBy:    String((req as any).cashierId ?? (req as any).waiterId ?? ''),
              }];
            });
            if (reversalMovements.length > 0) {
              await StockMovement.insertMany(reversalMovements, { session: cancelTx });
            }
          }
        });
      } finally {
        await cancelTx.endSession();
      }
      if (prevDoc && bulkOps.length > 0) invalidateProductList(req.hotelId!);   // Batch 6 (P4-INV-04): stock is back

      if (prevDoc) {
        // Cancelling puts counted stock back (and the dish back on sale) — tell Swiggy / Zomato
        if (bulkOps.length > 0) {
          void pushDeliveryAvailability(req.hotelId!, existing.items.filter(i => i.product).map(i => String(i.product)));
        }
        // Batch 3 (3C): the counter refund the admin confirmed — one ledger refund per method.
        if (refundParts.length > 0) {
          await recordEntries(req.hotelId!, refundParts.map(p => ({
            type: 'refund' as const, method: p.method as any, amount: p.amount, paidAt: new Date(),
            source: 'cancel_refund', allocations: [{ orderId: existing._id as any, amount: p.amount }],
            sessionId: existing.sessionId, guestId: (existing as any).guestId,
            reason: cancelReason || 'Order cancelled', recordedBy: req.cashierName || req.role || '',
            idempotencyKey: `cancel-refund:${existing._id}:${p.method}`,
          })));
        }
        logAudit(req, 'order.cancelled', 'order', String(existing._id), {
          orderNumber: existing.orderNumber,
          prevStatus:  existing.status,
          grandTotal:  existing.grandTotal,
          reason:      cancelReason,
          refunded:    refundParts,
        });

        // Tally Direct Sync — fire-and-forget; failure NEVER rolls back the cancellation
        void createTallySyncJobForCancellation(req.hotelId!, existing._id);

        // Undo only what this order added to the guest's amount due (prepaid /
        // unpaid online orders never added anything). Scoped to this hotel.
        // Batch 3: only the UNPAID part — a part payment already came off the guest's due.
        if (existing.guestId && isDueAtCounter(existing)) {
          const stillOwed = outstandingOf(existing as any);
          await Guest.updateOne({ _id: existing.guestId, hotelId: req.hotelId }, [
            { $set: { totalAmount: { $max: [0, { $round: [{ $subtract: ['$totalAmount', stillOwed] }, 2] }] } } },
          ]);
        }

        // ── Loyalty reversal on cancellation (fire-and-forget) ──────────────────
        ;(async () => {
          try {
            const loyaltyCfg = await getLoyaltyConfig(req.hotelId!);

            const customerPhone = existing.customerPhone;
            if (!customerPhone) return;

            const cancelProfile = await CustomerProfile.findOne({
              hotelId: new mongoose.Types.ObjectId(req.hotelId),
              // Batch 3: profiles store the normalised phone, orders may hold it as typed.
              phone:   { $in: [customerPhone, normalizePhone(customerPhone)].filter(Boolean) as string[] },
              status:  { $ne: 'merged' },
            }).select('_id orgCustomerId').lean();
            if (!cancelProfile) return;

            const cancelOrgCtx = await resolveOrgLoyalty(cancelProfile as any, req.hotelId!);
            const cancelCfg    = cancelOrgCtx ? cancelOrgCtx.hqConfig : loyaltyCfg;

            // Skip if neither branch nor org loyalty is enabled
            if (!cancelCfg.enabled && !cancelOrgCtx) return;

            const profileId = (cancelProfile as any)._id;
            const orderId   = String(existing._id);

            // 1. Reverse earned points via Payment record (Razorpay earn path)
            const earnedPay = await Payment.findOne({
              orderId:          existing._id,
              hotelId:          req.hotelId,
              loyaltyEarnPoints: { $gt: 0 },
              loyaltyReversedAt: null,
            });
            if (earnedPay) {
              const claimedPay = await Payment.findOneAndUpdate(
                { _id: earnedPay._id, loyaltyReversedAt: null },
                { $set: { loyaltyReversedAt: new Date() } },
              );
              if (claimedPay) {
                if (cancelOrgCtx) {
                  await reverseOrgEarnedPoints(
                    cancelOrgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
                    cancelOrgCtx.orgCustomer!.orgHotelId.toString(),
                    req.hotelId!,
                    profileId,
                    claimedPay.loyaltyEarnPoints,
                    cancelCfg,
                    {
                      orderId,
                      paymentId: String(claimedPay._id),
                      createdBy: req.cashierName || 'system:cancel',
                      remarks:   `Earn reversal: Order #${existing.orderNumber ?? ''} cancelled`,
                    },
                  );
                } else {
                  await reverseEarnedPoints(profileId, req.hotelId!, claimedPay.loyaltyEarnPoints, cancelCfg, {
                    orderId,
                    paymentId: String(claimedPay._id),
                    createdBy: req.cashierName || 'system:cancel',
                    remarks:   `Earn reversal: Order #${existing.orderNumber ?? ''} cancelled`,
                  });
                }
              }
            } else {
              // Reverse earned points via Order earn path (cash/UPI takeaway)
              const earnTx = await LoyaltyTransaction.findOne({
                hotelId:         new mongoose.Types.ObjectId(req.hotelId),
                customerId:      profileId,
                orderId:         existing._id,
                transactionType: 'earn',
              }).sort({ createdAt: -1 }).lean();
              if (earnTx && earnTx.points > 0) {
                // Atomic claim: clear loyaltyEarnedAt to prevent repeated reversal
                const claimedOrder = await Order.findOneAndUpdate(
                  { _id: existing._id, loyaltyEarnedAt: { $ne: null } },
                  { $set: { loyaltyEarnedAt: null } },
                );
                if (claimedOrder) {
                  if (cancelOrgCtx) {
                    await reverseOrgEarnedPoints(
                      cancelOrgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
                      cancelOrgCtx.orgCustomer!.orgHotelId.toString(),
                      req.hotelId!,
                      profileId,
                      earnTx.points,
                      cancelCfg,
                      {
                        orderId,
                        createdBy: req.cashierName || 'system:cancel',
                        remarks:   `Earn reversal: Order #${existing.orderNumber ?? ''} cancelled`,
                      },
                    );
                  } else {
                    await reverseEarnedPoints(profileId, req.hotelId!, earnTx.points, cancelCfg, {
                      orderId,
                      createdBy: req.cashierName || 'system:cancel',
                      remarks:   `Earn reversal: Order #${existing.orderNumber ?? ''} cancelled`,
                    });
                  }
                }
              }
            }

            // 2. Restore redeemed points
            const redeemedPts = (existing as any).redeemedPoints ?? 0;
            if (redeemedPts > 0) {
              if (cancelOrgCtx) {
                // Do NOT pass orderId here — it would generate idempotency key
                // "${orgCustomerId}:earn:${orderId}", colliding with the original earn
                // transaction from order completion and causing the restore to be silently
                // rejected. The outer cancellation state guard (order.status = cancelled)
                // provides idempotency. Remarks carry the audit trail.
                await earnOrgPoints(
                  cancelOrgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
                  cancelOrgCtx.orgCustomer!.orgHotelId.toString(),
                  req.hotelId!,
                  profileId,
                  redeemedPts,
                  cancelCfg,
                  {
                    createdBy: req.cashierName || 'system:cancel',
                    remarks:   `Redemption restored: Order #${existing.orderNumber ?? ''} (${orderId}) cancelled`,
                  },
                );
              } else {
                await earnPoints(profileId, req.hotelId!, redeemedPts, cancelCfg, {
                  orderId,
                  createdBy: req.cashierName || 'system:cancel',
                  remarks:   `Redemption restored: Order #${existing.orderNumber ?? ''} cancelled`,
                });
              }
            }
          } catch (e) {
            logger.warn('[loyalty] cancellation reversal failed', { orderId: String(existing._id), err: String(e) });
          }
        })();

        // ── Coupon reversal on cancellation (fire-and-forget, idempotent via status field) ──
        if ((existing as any).couponId) {
          ;(async () => {
            try {
              const claimedRed = await CouponRedemption.findOneAndUpdate(
                { hotelId: req.hotelId, orderId: existing._id, status: 'redeemed' },
                { $set: { status: 'reversed', reversedAt: new Date(), reversedReason: 'order_cancelled' } },
              );
              if (claimedRed) {
                await Coupon.findOneAndUpdate(
                  { _id: claimedRed.couponId, hotelId: req.hotelId, usageCount: { $gt: 0 } },
                  { $inc: { usageCount: -1 } },
                );
              }
            } catch (e) {
              logger.warn('[coupon] reversal on cancellation failed', { orderId: String(existing._id), err: String(e) });
            }
          })();
        }

        // ── Gift voucher reversal on cancellation (fire-and-forget, idempotent via giftVoucherRestoredAt) ──
        const cancelVoucherAmt = (existing as any).giftVoucherAmount as number | undefined;
        if (cancelVoucherAmt && cancelVoucherAmt > 0 && (existing as any).giftVoucherId) {
          ;(async () => {
            try {
              const claimed = await Order.findOneAndUpdate(
                { _id: existing._id, hotelId: req.hotelId, giftVoucherRestoredAt: null },
                { $set: { giftVoucherRestoredAt: new Date() } },
              );
              if (!claimed) return;
              const cancelNow = new Date();
              await GiftVoucher.findOneAndUpdate(
                { _id: (existing as any).giftVoucherId, hotelId: req.hotelId },
                [
                  { $set: { balance: { $add: ['$balance', cancelVoucherAmt] }, isActive: true } },
                  {
                    $set: {
                      transactions: {
                        $concatArrays: [
                          { $ifNull: ['$transactions', []] },
                          [{
                            type: 'refund', amount: cancelVoucherAmt, balanceAfter: { $ifNull: ['$balance', 0] },
                            orderId: existing._id,
                            remarks: `Cancellation: Order #${existing.orderNumber ?? ''}`,
                            createdBy: 'system:cancel', createdAt: cancelNow,
                          }],
                        ],
                      },
                    },
                  },
                ] as any,
              );
            } catch (e) {
              logger.warn('[gift-voucher] reversal on cancellation failed', { orderId: String(existing._id), err: String(e) });
            }
          })();
        }

        // C-04: Wallet refund on cancellation — fire-and-forget, idempotent via walletRestoredAt.
        const cancelWalletAmt = (existing as any).walletAmount as number | undefined;
        if (cancelWalletAmt && cancelWalletAmt > 0 && (existing as any).walletCustomerId) {
          ;(async () => {
            try {
              const claimed = await Order.findOneAndUpdate(
                { _id: existing._id, hotelId: req.hotelId, walletRestoredAt: null },
                { $set: { walletRestoredAt: new Date() } },
              );
              if (!claimed) return; // already refunded by a concurrent request
              const refundHotelOId    = new mongoose.Types.ObjectId(req.hotelId!);
              const refundCustomerOId = new mongoose.Types.ObjectId(String((existing as any).walletCustomerId));
              const refundSession = await mongoose.startSession();
              try {
                await refundSession.withTransaction(async () => {
                  const refunded = await CustomerProfile.findOneAndUpdate(
                    { _id: refundCustomerOId, hotelId: refundHotelOId },
                    { $inc: { walletBalance: cancelWalletAmt } },
                    { new: true, session: refundSession },
                  );
                  if (refunded) {
                    await WalletTransaction.create([{
                      hotelId:      refundHotelOId,
                      customerId:   refundCustomerOId,
                      type:         'credit',
                      source:       'refund',
                      amount:       cancelWalletAmt,
                      balanceAfter: +((refunded as any).walletBalance ?? 0).toFixed(2),
                      orderId:      existing._id,
                      paymentRef:   '',
                      remarks:      `Refund: Order #${(existing as any).orderNumber ?? ''}`,
                      createdBy:    'system:cancel',
                    }], { session: refundSession });
                  }
                });
              } finally {
                await refundSession.endSession();
              }
            } catch (e) {
              logger.warn('[wallet] refund on cancellation failed', { orderId: String(existing._id), err: String(e) });
            }
          })();
        }
      }
    }

    // Atomic completion guard — mirrors the guard on the 'cancelled' path.
    // Only the request that wins the findOneAndUpdate runs the side effects
    // (receipt print + socket emit), preventing duplicate receipts from two
    // concurrent cashier taps on the same order.
    if (status === 'completed') {
      // M13: Razorpay orders must have a verified Payment record before completion.
      // Check BOTH the stored paymentMethod (e.g. QR orders already stored as 'razorpay')
      // AND the client-supplied paymentMethod — either triggers the guard.
      let razorpayPmt: any = null;
      if (paymentMethod === 'razorpay' || existing.paymentMethod === 'razorpay') {
        razorpayPmt = await Payment.findOne({
          orderId: existing._id,
          hotelId: req.hotelId,
          status: 'success',
          gatewayType: { $in: ['razorpay', 'razorpay_link'] },
        }).select('_id amount updatedAt gatewayTransactionId').lean();
        if (!razorpayPmt) {
          return res.status(400).json({ message: 'Payment verification required before completing a Razorpay order.' });
        }
      }

      const VALID_PM = ['cash', 'upi', 'upi_intent', 'upi_qr', 'upi_collect', 'card', 'split', 'razorpay'];
      // Batch 2 (2B): completing no longer stamps paymentTime (it overwrote the real payment
      // time of /pay, payNow, QR and the webhook). Whatever is still owed is recorded below as
      // a ledger payment, which sets paymentTime once the order is fully settled.
      // Paid at the counter earlier (payNow / POST /:id/pay): closing the order must not
      // record a second payment or change when and how it was paid.
      const alreadyPaid = !!existing.paymentTime;
      const completionFields: Record<string, unknown> = {
        status:      'completed',
        completedBy: req.cashierName || req.cashierId || '',
        completedAt: new Date(),
        cashierId:   req.cashierId || '',
      };
      if (!alreadyPaid && paymentMethod && VALID_PM.includes(paymentMethod)) {
        completionFields.paymentMethod = paymentMethod;
      }
      if (!alreadyPaid && req.body.transactionId) completionFields.transactionId = req.body.transactionId;
      if (!alreadyPaid && req.body.upiApp)        completionFields.upiApp        = req.body.upiApp;
      if (!alreadyPaid && req.body.payments)      completionFields.payments      = req.body.payments;
      if (!alreadyPaid && req.body.splitDetails) {
        // M5 (status path): split totals must match what is owed — to the paisa (Batch 2; was ±₹1).
        const sd = req.body.splitDetails as { cash?: number; upi?: number; card?: number };
        const splitTotal = r2((Number(sd.cash) || 0) + (Number(sd.upi) || 0) + (Number(sd.card) || 0));
        const owed = outstandingOf(existing as any);
        if (splitTotal > 0 && Math.abs(splitTotal - owed) > PAISE) {
          return res.status(400).json({
            message: `Split payment total (${splitTotal.toFixed(2)}) must equal the amount due (${owed.toFixed(2)})`,
          });
        }
        completionFields.splitDetails = { cash: r2(sd.cash), upi: r2(sd.upi), card: r2(sd.card) };
      }
      // Batch 2 (2B): what is still owed is collected now — work out the ledger parts BEFORE
      // completing, so an unusable split stops the completion instead of leaving it unrecorded.
      const owedAtCompletion = outstandingOf(existing as any);
      const completionMethod = (paymentMethod && VALID_PM.includes(paymentMethod)) ? paymentMethod : existing.paymentMethod;
      let completionParts: ReturnType<typeof moneyParts> = [];
      if (owedAtCompletion > 0 && completionMethod !== 'razorpay') {
        completionParts = moneyParts(
          completionMethod, owedAtCompletion,
          (completionFields.splitDetails as any) ?? (existing as any).splitDetails,
        );
        if (!completionParts) {
          return res.status(400).json({
            message: `Split amounts must add up to the amount due (₹${owedAtCompletion.toFixed(2)}) before the bill can be closed.`,
          });
        }
      }

      // Phase 5 · Batch 5 (Decision 3): collecting what is owed (or a tip) at the counter needs an
      // open shift. Completing an order that is already paid, or paid online, does not.
      const takesCounterMoney = (completionParts?.length ?? 0) > 0 || (!razorpayPmt && Number((existing as any).tipAmount) > 0);
      if (takesCounterMoney && await refuseWithoutShift(res, req.hotelId!)) return;

      const completableStatuses = isQuickService
        ? ['served', 'ready', 'pending']
        : ['served', 'ready'];
      const prevDoc = await Order.findOneAndUpdate(
        { _id: req.params.id, hotelId: req.hotelId, status: { $in: completableStatuses } },
        { $set: completionFields },
        { new: false },
      );

      if (!prevDoc) {
        const current = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId });
        if (!current) return res.status(404).json({ message: 'Order not found' });
        // Idempotent: a concurrent request already completed this order.
        if (current.status === 'completed') return res.json(current);
        // The order is not in a completable state — tell the caller explicitly.
        return res.status(409).json({
          message: `Cannot complete order from status '${current.status}'. Order must be 'ready' or 'served'.`,
        });
      }

      // P4-TBL-01 (dine-in billing): an order closed here is paid, so it is no longer owed at
      // the table — same rule as POST /:id/pay. prevDoc is the state before this (atomic)
      // completion, so this runs once per order and never for orders already paid ahead
      // (paid at the counter or online), which isDueAtCounter excludes.
      const owedBefore = outstandingOf(prevDoc as any);
      if (prevDoc.guestId && isDueAtCounter(prevDoc) && owedBefore > 0) {
        await Guest.updateOne(
          { _id: prevDoc.guestId, hotelId: req.hotelId },
          [{ $set: { totalAmount: { $max: [0, { $round: [{ $subtract: ['$totalAmount', owedBefore] }, 2] }] } } }],
        );
      }

      // Batch 2 (2B): record the money taken at completion (only what was still owed), or make
      // sure a verified Razorpay payment is in the ledger (same key as QR verify / webhook).
      const completedAtTime = (completionFields.completedAt as Date) ?? new Date();
      if (razorpayPmt) {
        await recordEntries(req.hotelId!, [{
          type: 'payment', method: 'online', amount: r2((Number(razorpayPmt.amount) || 0) / 100),
          paidAt: razorpayPmt.updatedAt ?? completedAtTime, source: 'gateway',
          allocations: [{ orderId: prevDoc._id as any, amount: r2((Number(razorpayPmt.amount) || 0) / 100) }],
          paymentId: razorpayPmt._id, reference: razorpayPmt.gatewayTransactionId ?? '',
          sessionId: prevDoc.sessionId, guestId: (prevDoc as any).guestId,
          recordedBy: 'gateway', idempotencyKey: `gw:${razorpayPmt._id}`,
        }]);
      } else if (owedBefore > 0 && completionParts && completionParts.length) {
        await recordEntries(req.hotelId!, completionParts.map(p => ({
          type: 'payment' as const, method: p.method, amount: p.amount, paidAt: completedAtTime, source: 'completion',
          allocations: [{ orderId: prevDoc._id as any, amount: p.amount }],
          sessionId: prevDoc.sessionId, guestId: (prevDoc as any).guestId,
          reference: String(req.body.transactionId ?? '').slice(0, 120),
          recordedBy: req.cashierName || req.role || '',
          idempotencyKey: `complete:${prevDoc._id}:${p.method}`,
        })));
      }
      if (!razorpayPmt) await recordTip(req.hotelId!, prevDoc as any, completedAtTime, req.cashierName || req.role || '');

      // This request won the atomic update — run side effects exactly once.
      const completedOrder = await Order.findById(req.params.id);
      const orderForResponse = completedOrder ?? existing;

      io.to(`hotel_${req.hotelId}`).emit('order_status_update', {
        orderId:      existing._id,
        orderNumber:  existing.orderNumber,
        status:       'completed',
        tableNumber:  existing.tableNumber  || '',
        customerName: existing.customerName || '',
      });
      io.to(`hotel_${req.hotelId}`).emit('order_completed', {
        orderId:       existing._id,
        orderNumber:   existing.orderNumber,
        tableNumber:   existing.tableNumber  || '',
        completedBy:   String(completionFields.completedBy   ?? ''),
        paymentMethod: String(completionFields.paymentMethod ?? existing.paymentMethod),
        grandTotal:    existing.grandTotal,
      });
      scheduleOrderReceiptPrint(req.hotelId!, orderForResponse.toObject()).catch(err => {
        logger.warn('Receipt print dispatch failed', { orderId: String(existing._id), error: err?.message });
      });

      // WhatsApp receipt — fire-and-forget; failure NEVER rolls back the sale
      void createWhatsAppReceiptJob(
        req.hotelId!,
        existing._id,
        existing.customerPhone ?? null,
        existing.walletCustomerId?.toString() ?? null,
      );

      // Tally Direct Sync — fire-and-forget; failure NEVER rolls back the sale
      void createTallySyncJobForOrder(req.hotelId!, existing._id);

      // Loyalty earn for non-dine-in orders (idempotent, fire-and-forget)
      if (!['dine-in'].includes(existing.orderSource)) {
        ;(async () => {
          try {
            // Skip if a gateway Payment already handled the earn (Razorpay webhook/verify)
            const paidViaGateway = await Payment.findOne({
              orderId:         existing._id,
              hotelId:         req.hotelId,
              loyaltyEarnedAt: { $ne: null },
            }).select('_id').lean();
            if (paidViaGateway) return;

            // Atomic claim on the Order — prevents duplicate earn from concurrent complete calls
            const claimedOrder = await Order.findOneAndUpdate(
              { _id: existing._id, hotelId: req.hotelId, loyaltyEarnedAt: null },
              { $set: { loyaltyEarnedAt: new Date() } },
            );
            if (!claimedOrder) return;

            const loyaltyCfg = await getLoyaltyConfig(req.hotelId!);

            const phone = existing.customerPhone;
            if (!phone) return;

            const earnProfile = await CustomerProfile.findOne({
              hotelId: new mongoose.Types.ObjectId(req.hotelId),
              // Phase 5 · Batch 7 (P4-CATALOG-03): profiles store the normalised phone (+91…), the
              // order holds it as typed — match both, as the cancel path already does.
              phone:   { $in: [phone, normalizePhone(phone)].filter(Boolean) as string[] },
              status:  { $ne: 'merged' },
            }).select('_id loyaltyOptOut orgCustomerId').lean();
            if (!earnProfile) return;

            // lifetimeSpend and the visit are counted once per completed order (gated by claimedOrder
            // above). Dine-in counts its visit per table session instead and never reaches here.
            await CustomerProfile.findByIdAndUpdate(
              (earnProfile as any)._id,
              { $inc: { lifetimeSpend: existing.grandTotal, visitCount: 1 }, $set: { lastVisitAt: new Date() } },
            ).catch(() => {});

            // Determine if org-loyalty is active for this customer
            const earnOrgCtx = await resolveOrgLoyalty(earnProfile as any, req.hotelId!);
            const earnCfg    = earnOrgCtx ? earnOrgCtx.hqConfig : loyaltyCfg;

            if (!earnCfg.enabled || (earnProfile as any).loyaltyOptOut) return;

            // C-06: respect calculationBase — before_gst excludes tax from the earning base.
            const earnBase = earnCfg.calculationBase === 'before_gst'
              ? Math.max(0, existing.grandTotal - (existing.taxTotal ?? 0))
              : existing.grandTotal;
            const pts = calculateEarnedPoints(earnBase, earnCfg);
            if (pts <= 0) return;

            if (earnOrgCtx) {
              // Org-loyalty path: credit OrganizationCustomer.orgLoyaltyBalance
              await earnOrgPoints(
                earnOrgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
                earnOrgCtx.orgCustomer!.orgHotelId.toString(),
                req.hotelId!,
                (earnProfile as any)._id,
                pts,
                earnCfg,
                { orderId: String(existing._id), createdBy: req.cashierName || 'system:order_complete' },
              );
            } else {
              // Branch-loyalty path (unchanged behavior)
              await earnPoints(
                (earnProfile as any)._id,
                req.hotelId!,
                pts,
                earnCfg,
                { orderId: String(existing._id), createdBy: req.cashierName || 'system:order_complete' },
              );
            }
          } catch (e) {
            logger.warn('[loyalty] order completion earn failed', { orderId: String(existing._id), err: String(e) });
          }
        })();
      }

      return res.json(orderForResponse);
    }

    existing.status = status;
    if (status === 'served') {
      existing.servedBy = req.waiterName || req.waiterId || (role === 'kitchen' ? 'Kitchen' : '');
      existing.servedAt = new Date();
    }
    await existing.save();

    io.to(`hotel_${req.hotelId}`).emit('order_status_update', {
      orderId: existing._id,
      orderNumber: existing.orderNumber,
      status: existing.status,
      tableNumber:  existing.tableNumber  || '',
      customerName: existing.customerName || '',
    });

    if (existing.status === 'ready') {
      io.to(`hotel_${req.hotelId}`).emit('waiter_order_ready', {
        orderId: existing._id,
        orderNumber: existing.orderNumber,
        tableNumber: existing.tableNumber || '',
        customerName: existing.customerName || '',
      });
    }
    if (existing.status === 'served') {
      io.to(`hotel_${req.hotelId}`).emit('order_served', {
        orderId: existing._id,
        orderNumber: existing.orderNumber,
        tableNumber: existing.tableNumber || '',
        customerName: existing.customerName || '',
        servedBy: existing.servedBy || '',
      });
    }

    res.json(existing);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// PUT update order — field whitelist prevents mass-assignment and MongoDB operator injection
// H-03: 'status' removed; status transitions must go through PATCH /:id/status
const ORDER_UPDATE_ALLOWED = new Set([
  'paymentStatus', 'paymentMethod', 'notes', 'discountAmount',
  'tableNumber', 'isParcel', 'customerName',
  'transactionId', 'upiApp', 'payments', 'splitDetails',
]);

router.put('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  // Reject MongoDB operator keys (e.g. $set, $unset, $where)
  const hasOperator = Object.keys(req.body).some(k => k.startsWith('$'));
  if (hasOperator) {
    return res.status(400).json({ message: 'Invalid update fields' });
  }

  const update: Record<string, unknown> = {};
  for (const key of Object.keys(req.body)) {
    if (ORDER_UPDATE_ALLOWED.has(key)) update[key] = req.body[key];
  }

  try {
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      update,
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (error) {
    if (isTemporaryDbError(error)) return sendError(res, 503, 'Could not save the order right now. Please retry.', error);
    sendError(res, 400, 'Invalid data', error);
  }
});

// PATCH /:id/payment — cashier-safe endpoint to save payment method / split details / tip
// C3: replaces the admin-only PUT /:id for the specific fields cashiers need to update.
// M5: validates that split payment amounts sum to grandTotal.
router.patch('/:id/payment', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  const { paymentMethod, splitDetails, tipAmount, additionalDiscount, redeemPoints: redeemRequest } = req.body;
  const VALID_PM = ['cash', 'upi', 'upi_intent', 'upi_qr', 'upi_collect', 'card', 'split', 'razorpay'];

  try {
    const order = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ message: 'Order is already completed' });
    }

    const update: Record<string, unknown> = {};

    if (paymentMethod && VALID_PM.includes(paymentMethod)) {
      update.paymentMethod = paymentMethod;
    }
    // (split is validated below, after any discount, against what will be owed)
    if (tipAmount != null) {
      const rawTip = Number(tipAmount);
      if (!isFinite(rawTip) || rawTip < 0) {
        return res.status(400).json({ message: 'tipAmount must be a non-negative number' });
      }
      // C-fix: cap tip to ₹500 or 50% of grandTotal, whichever is higher
      const tipCap = Math.max(500, order.grandTotal * 0.5);
      if (rawTip > tipCap) {
        return res.status(400).json({
          message: `tipAmount (${rawTip.toFixed(2)}) exceeds the maximum allowed (${tipCap.toFixed(2)})`,
        });
      }
      update.tipAmount = rawTip;
      // Batch 3: how the tip is paid — given by the dialog, else the payment method; a split
      // covers the bill only, so its tip is taken on top in cash unless said otherwise.
      const asked = String(req.body?.tipMethod ?? '');
      const pm = String(paymentMethod || order.paymentMethod || '');
      const fromPm = ledgerMethod(pm);
      update.tipMethod = rawTip > 0
        ? (['cash', 'upi', 'card'].includes(asked) ? asked : ['cash', 'upi', 'card'].includes(fromPm) ? fromPm : 'cash')
        : '';
    }
    if (additionalDiscount != null && Number(additionalDiscount) > 0) {
      // RBAC: discount gate for additional post-order discount
      if (req.role !== 'admin') {
        const hotelCap2 = await Hotel.findById(req.hotelId).select('maxCashierDiscountPercent').lean() as any;
        const cap2: number = hotelCap2?.maxCashierDiscountPercent ?? 0;
        if (cap2 === 0) {
          return res.status(403).json({ message: 'Only admins can apply discounts.' });
        }
        // Batch 3 (3D): the limit covers ALL discount on this bill (given at order + at payment),
        // on the same base as the order-time check, so repeating small discounts cannot pass it.
        const discountBase = Number(order.subtotal) || 0;
        const totalDiscount = r2(
          (Number(order.discountAmount) || 0) + (Number((order as any).paymentDiscount) || 0)
          + Math.min(Number(additionalDiscount), order.grandTotal),
        );
        if (totalDiscount * 100 > discountBase * cap2 + 1e-6) {
          const totalPct = discountBase > 0 ? (totalDiscount / discountBase * 100) : 100;
          return res.status(403).json({ message: `Total discount on this bill (₹${totalDiscount.toFixed(2)}, ${totalPct.toFixed(1)}%) exceeds cashier limit of ${cap2}%. Contact admin.` });
        }
      }
      // Batch 2 (2B/2C): the discount must fit in what is still owed (a discount on money
      // already received would need a refund), is stored (it used to be dropped silently —
      // `additionalDiscount` is not a schema field), and comes off the guest's amount due.
      const owedNow = outstandingOf(order as any);
      const addDisc = r2(Math.min(Number(additionalDiscount), order.grandTotal));
      if (addDisc > owedNow + PAISE) {
        return res.status(409).json({
          code: 'DISCOUNT_EXCEEDS_DUE',
          message: `Discount (₹${addDisc.toFixed(2)}) is more than the amount still due (₹${owedNow.toFixed(2)}). Money already received would need a refund.`,
        });
      }
      update.paymentDiscount = r2((Number((order as any).paymentDiscount) || 0) + addDisc);
      update.grandTotal = r2(Math.max(0, order.grandTotal - addDisc));
    }

    // Batch 3 (3D): loyalty points redeemed in the payment dialog (they were never sent, so the
    // customer paid less at the counter than the bill said and kept the points). Only the bill's
    // own customer, once per bill, within the loyalty limits on what is still owed.
    let redemption: {
      points: number; value: number; profileId: mongoose.Types.ObjectId;
      orgCtx: OrgLoyaltyContext | null; cfg: Awaited<ReturnType<typeof getLoyaltyConfig>>;
    } | null = null;
    if (redeemRequest != null && Number(redeemRequest) !== 0) {
      const points = Number(redeemRequest);
      if (!Number.isInteger(points) || points < 0) {
        return res.status(400).json({ code: 'BAD_POINTS', message: 'Points to redeem must be a whole number.' });
      }
      if ((Number((order as any).redeemedPoints) || 0) > 0) {
        return res.status(409).json({ code: 'ALREADY_REDEEMED', message: 'Points have already been redeemed on this bill.' });
      }
      const billPhone = normalizePhone(order.customerPhone);
      const profile = billPhone
        ? await CustomerProfile.findOne({
            hotelId: new mongoose.Types.ObjectId(req.hotelId), phone: billPhone,
            status: 'active', loyaltyOptOut: { $ne: true },
          }).select('_id orgCustomerId') as { _id: mongoose.Types.ObjectId; orgCustomerId?: mongoose.Types.ObjectId | null } | null
        : null;
      if (!profile) {
        return res.status(409).json({ code: 'NOT_BILL_CUSTOMER', message: 'Only the customer on this bill can redeem points on it.' });
      }
      const orgCtx = await resolveOrgLoyalty(profile, req.hotelId!);
      const cfg = orgCtx ? orgCtx.hqConfig : await getLoyaltyConfig(req.hotelId!);
      if (!cfg.enabled) {
        return res.status(409).json({ code: 'LOYALTY_OFF', message: 'Loyalty is not switched on.' });
      }
      if (points < cfg.minimumRedeemPoints) {
        return res.status(400).json({ code: 'BELOW_MINIMUM', message: `At least ${cfg.minimumRedeemPoints} points must be redeemed.` });
      }
      const billBefore = Number(update.grandTotal ?? order.grandTotal);
      const dueBefore = outstandingOf({ ...(order.toObject() as any), grandTotal: billBefore });
      const value = calculateRedeemValue(points, cfg);
      const maxValue = r2(dueBefore * Math.min(cfg.maximumRedeemPercent, 100) / 100);
      if (value > maxValue) {
        return res.status(400).json({ code: 'OVER_REDEEM_LIMIT', message: `Points worth ₹${value.toFixed(2)} are more than the ₹${maxValue.toFixed(2)} that can be redeemed on this bill.` });
      }
      update.redeemedPoints = points;
      update.loyaltyDiscount = r2((Number((order as any).loyaltyDiscount) || 0) + value);
      update.grandTotal = r2(Math.max(0, billBefore - value));
      redemption = { points, value, profileId: profile._id, orgCtx, cfg };
    }

    // Split breakdown: the web POS sends an object { cash, upi, card }; the array form
    // ([{ amount }]) is still accepted. It must equal what will be owed, to the paisa (Batch 2;
    // the object form used to be dropped silently, so split bills lost their breakdown).
    if (splitDetails && (Array.isArray(splitDetails) ? splitDetails.length > 0 : typeof splitDetails === 'object')) {
      const owedAfter = outstandingOf({ ...(order.toObject() as any), grandTotal: update.grandTotal ?? order.grandTotal });
      const splitTotal = Array.isArray(splitDetails)
        ? r2(splitDetails.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0))
        : r2((Number(splitDetails.cash) || 0) + (Number(splitDetails.upi) || 0) + (Number(splitDetails.card) || 0));
      if (Math.abs(splitTotal - owedAfter) > PAISE) {
        return res.status(400).json({
          message: `Split payment total (${splitTotal.toFixed(2)}) must equal the amount due (${owedAfter.toFixed(2)})`,
        });
      }
      update.splitDetails = Array.isArray(splitDetails)
        ? splitDetails
        : { cash: r2(splitDetails.cash), upi: r2(splitDetails.upi), card: r2(splitDetails.card) };
    }

    // Batch 3 (3D): a change to the bill only applies to the exact state it was checked against,
    // so simultaneous discounts / redemptions cannot both pass the limit or stack.
    const billChanges = update.grandTotal !== undefined;
    const filter: Record<string, unknown> = { _id: req.params.id, hotelId: req.hotelId };
    if (billChanges) {
      filter.grandTotal = order.grandTotal;
      filter.paymentTime = null;
      filter.status = { $nin: ['completed', 'cancelled'] };
      if (r2((order as any).amountSettled) > 0) filter.amountSettled = (order as any).amountSettled;
      else filter.$or = [{ amountSettled: 0 }, { amountSettled: { $exists: false } }];
    }
    if (redemption) filter.redeemedPoints = { $not: { $gt: 0 } };

    let updated: any = null;
    if (redemption) {
      // The bill change and the points deduction commit together or not at all.
      const r = redemption;
      const NOT_ENOUGH_POINTS = new Error('loyalty_redeem_refused');
      const txn = await mongoose.startSession();
      try {
        await txn.withTransaction(async () => {
          updated = await Order.findOneAndUpdate(filter, { $set: update }, { new: true, session: txn });
          if (!updated) return;
          const ctx = { orderId: String(order._id), createdBy: req.cashierName || req.role || 'system' };
          try {
            if (r.orgCtx) {
              await redeemOrgPoints(
                r.orgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
                r.orgCtx.orgCustomer!.orgHotelId.toString(),
                req.hotelId!, r.profileId, r.points, r.cfg, ctx, txn,
              );
            } else {
              await redeemPoints(r.profileId, req.hotelId!, r.points, r.cfg, ctx, txn);
            }
          } catch (e: any) {
            if (/insufficient/i.test(String(e?.message))) throw NOT_ENOUGH_POINTS;
            throw e;
          }
        });
      } catch (e) {
        if (e === NOT_ENOUGH_POINTS) {
          return res.status(409).json({ code: 'NOT_ENOUGH_POINTS', message: 'The customer does not have enough points. Nothing was changed.' });
        }
        throw e;
      } finally {
        await txn.endSession();
      }
    } else {
      updated = await Order.findOneAndUpdate(filter, { $set: update }, { new: true });
    }
    if (!updated) {
      if (billChanges) {
        return res.status(409).json({ code: 'ORDER_CHANGED', message: 'This bill changed while you were updating it. Refresh and try again.' });
      }
      return res.status(404).json({ message: 'Order not found' });
    }

    // What came off the bill is no longer owed at the table either (see counterBilling).
    const billReduction = billChanges ? r2(order.grandTotal - updated.grandTotal) : 0;
    if (billReduction > 0 && order.guestId && isDueAtCounter(order as any)) {
      await Guest.updateOne(
        { _id: order.guestId, hotelId: req.hotelId },
        [{ $set: { totalAmount: { $max: [0, { $round: [{ $subtract: ['$totalAmount', billReduction] }, 2] }] } } }],
      );
    }

    logAudit(req, 'order.payment_updated', 'order', String(updated._id), {
      paymentMethod, splitDetails: splitDetails?.length, tipAmount, additionalDiscount,
      redeemedPoints: redemption?.points, loyaltyDiscount: redemption?.value,
    });
    res.json(updated);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /api/orders/:id/pay — take payment at the counter before the order is closed ──
// - Held for payment (pay before kitchen): recorded as paid and released to the kitchen
//   ('payment_pending' → 'pending') with its KOT and new_order.
// - Already in the kitchen (pending / preparing / ready / served): recorded as paid; it stays
//   in the kitchen and is closed later (handed over / served → completed).
// Online (Razorpay) orders are never paid here — only a verified online payment releases them.
router.post('/:id/pay', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    const paymentMethod = String(req.body?.paymentMethod ?? '');
    if (!COUNTER_PAY_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: 'Choose Cash, UPI, Card or Split to take payment.' });
    }
    // Phase 5 · Batch 5 (Decision 3): counter payments need an open shift
    if (await refuseWithoutShift(res, req.hotelId!)) return;

    const order = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId }).lean() as any;
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status === 'completed' || order.status === 'cancelled') {
      return res.status(409).json({ code: 'ORDER_CLOSED', message: `This bill is already ${order.status === 'completed' ? 'paid and closed' : 'cancelled'}.` });
    }
    if (order.paymentTime) {
      return res.status(409).json({ code: 'ALREADY_PAID', message: 'This bill is already paid.' });
    }
    if (order.status === 'payment_pending' && !isHeldForCounterPayment(order)) {
      return res.status(409).json({ code: 'ONLINE_PAYMENT_PENDING', message: 'This is an online order waiting for its online payment.' });
    }

    // Batch 2 (2B): every payment is a ledger entry with its own time. `amount` defaults to the
    // whole balance due; a smaller amount records a part payment (owner-approved, API only).
    // Split parts must add up to the amount to the paisa (was ±₹1).
    const outstanding = outstandingOf(order);
    const amount = req.body?.amount != null ? r2(req.body.amount) : outstanding;
    if (!(amount > 0) || amount > outstanding + PAISE) {
      return res.status(400).json({ code: 'BAD_AMOUNT', message: `Amount must be more than ₹0 and at most the balance due (₹${outstanding.toFixed(2)}).` });
    }
    const isFull = amount >= outstanding - PAISE;
    const parts = moneyParts(paymentMethod, amount, req.body?.splitDetails);
    if (!parts || parts.length === 0) {
      return res.status(400).json({ message: `Split amounts must add up to the amount paid (₹${amount.toFixed(2)}) exactly.` });
    }
    const held = isHeldForCounterPayment(order);
    if (held && !isFull) {
      return res.status(400).json({ code: 'FULL_PAYMENT_REQUIRED', message: 'An order held for payment must be paid in full before it goes to the kitchen.' });
    }
    const reference = String(req.body?.reference ?? req.body?.transactionId ?? '').trim().slice(0, 120);
    const settledBefore = r2(order.amountSettled);
    const set: Record<string, unknown> = { ledger: true };
    if (isFull) {
      set.paymentMethod = paymentMethod;
      if (paymentMethod === 'split') {
        const sd = req.body?.splitDetails ?? {};
        set.splitDetails = { cash: r2(sd.cash), upi: r2(sd.upi), card: r2(sd.card) };
      }
      if (reference) set.transactionId = reference;
      if (held) set.status = 'pending';
    }

    // Conditional write + ledger entries in one transaction: only one payment can win from the
    // state we checked (paymentTime null and the same amountSettled), and it is recorded once.
    const paidAt = new Date();
    let updated: any = null;
    const txn = await mongoose.startSession();
    try {
      await txn.withTransaction(async () => {
        updated = await Order.findOneAndUpdate(
          {
            _id: req.params.id, hotelId: req.hotelId, paymentTime: null,
            grandTotal: order.grandTotal,   // Batch 3: a discount landing now must not be overpaid
            ...(settledBefore > 0
              ? { amountSettled: order.amountSettled }
              : { $or: [{ amountSettled: 0 }, { amountSettled: { $exists: false } }] }),
            status: held ? 'payment_pending' : { $in: ['pending', 'preparing', 'ready', 'served'] },
          },
          { $set: set },
          { new: true, session: txn },
        );
        if (!updated) return;
        await recordEntries(req.hotelId!, parts.map(p => ({
          type: 'payment' as const, method: p.method, amount: p.amount, paidAt, source: 'pay',
          allocations: [{ orderId: order._id, amount: p.amount }],
          sessionId: order.sessionId, guestId: order.guestId, reference,
          recordedBy: req.cashierName || req.role || '',
          idempotencyKey: `pay:${order._id}:${Math.round(settledBefore * 100)}:${p.method}`,
        })), { session: txn });
        await recordTip(req.hotelId!, updated, paidAt, req.cashierName || req.role || '', txn);
        updated = await Order.findById(order._id).session(txn);
      });
    } finally {
      await txn.endSession();
    }
    if (!updated) {
      return res.status(409).json({ code: 'ORDER_CHANGED', message: 'This bill changed while you were paying. Refresh and try again.' });
    }

    // What was paid is no longer owed at the table (see counterBilling). Orders that were
    // held never added to the guest total, so only kitchen orders need taking off.
    if (!held && order.guestId && isDueAtCounter(order)) {
      await Guest.updateOne(
        { _id: order.guestId, hotelId: req.hotelId },
        [{ $set: { totalAmount: { $max: [0, { $round: [{ $subtract: ['$totalAmount', amount] }, 2] }] } } }],
      );
    }

    logAudit(req, 'order.paid', 'order', String(updated._id), {
      orderNumber: updated.orderNumber, paymentMethod, amount, partial: !isFull,
      grandTotal: updated.grandTotal, releasedToKitchen: held,
    });

    if (held) {
      scheduleKOTPrint(req.hotelId!, {
        _id:          updated._id,
        orderNumber:  updated.orderNumber,
        tableNumber:  updated.tableNumber,
        customerName: updated.customerName,
        items:        updated.items as { productName: string; quantity: number }[],
        notes:        updated.notes,
        orderSource:  updated.orderSource,
        createdAt:    (updated as any).createdAt,
        sessionId:    updated.sessionId,
        guestId:      (updated as any).guestId ?? undefined,
      }).catch(() => {});
      emitNewOrder(req.hotelId!, updated);
    }

    res.json(updated);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /api/orders/:id/refund — admin refund on a completed order ──────────
// Creates a refund record on the order (refundedAt, refundedBy, refundReason,
// refundAmount). Does NOT restore stock (food was served). Reverses loyalty,
// wallet, voucher balances using the same path as order cancellation.
router.post(
  '/:id/refund',
  // Batch 2 (2B): resolveHotelStatus(hotelId) is a lookup function, not middleware — in this
  // chain it never called next(), so every refund request hung. authMiddleware (also applied
  // router-wide) already resolves and enforces the hotel status.
  authMiddleware, requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const order = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId });
      if (!order) return res.status(404).json({ message: 'Order not found' });
      if (order.status !== 'completed') {
        return res.status(400).json({ message: `Only completed orders can be refunded (current status: ${order.status}).` });
      }
      if ((order as any).refundedAt) {
        return res.status(409).json({ message: 'This order has already been refunded.' });
      }

      // Accept `reason` (current) and `refundReason` (the name the old message asked for).
      const reason = String(req.body.reason || req.body.refundReason || '').trim();
      if (!reason) return res.status(400).json({ message: 'A refund reason is required (send it as `reason`).' });
      // Batch 2 (2B): online payments are refunded through the gateway refund
      // (POST /api/payments/:id/refund), which returns the money and records it; recording a
      // second refund here could count the same refund twice.
      if (order.paymentMethod === 'razorpay') {
        return res.status(409).json({ code: 'USE_GATEWAY_REFUND', message: 'This bill was paid online — refund it from the online payment so the money is returned through the gateway.' });
      }
      const requestedAmount = Number(req.body.refundAmount) || order.grandTotal;
      const refundAmount    = r2(Math.min(Math.max(0, requestedAmount), order.grandTotal));
      const refundedAt      = new Date();

      // Batch 2 (2B): atomic claim — the "already refunded" check above was a separate read,
      // so two simultaneous refunds could both be written.
      const claimedRefund = await Order.findOneAndUpdate(
        { _id: order._id, hotelId: req.hotelId, status: 'completed', refundedAt: null },
        { $set: {
          refundedAt,
          refundedBy:   String((req as any).cashierId || (req as any).adminId || ''),
          refundReason: reason,
          refundAmount,
        }},
      );
      if (!claimedRefund) {
        return res.status(409).json({ message: 'This order has already been refunded.' });
      }
      // The refund is its own ledger entry with its own time (reported apart from collections).
      await recordEntries(req.hotelId!, [{
        type: 'refund', method: ledgerMethod(order.paymentMethod), amount: refundAmount, paidAt: refundedAt,
        source: 'order_refund', allocations: [{ orderId: order._id as any, amount: refundAmount }],
        sessionId: order.sessionId, guestId: (order as any).guestId, reason,
        recordedBy: req.cashierName || req.role || '', idempotencyKey: `order-refund:${order._id}`,
      }]).catch(err => logger.error('[ledger] order refund not recorded', { orderId: String(order._id), error: String(err) }));

      logAudit(req, 'order.refunded', 'order', String(order._id), {
        orderNumber: order.orderNumber,
        refundAmount,
        reason,
      });

      // ── Loyalty + wallet + voucher reversal (fire-and-forget) ────────────────
      ;(async () => {
        try {
          const loyaltyCfg = await getLoyaltyConfig(req.hotelId!);
          const customerPhone = order.customerPhone;
          if (!customerPhone) return;
          const refundProfile = await CustomerProfile.findOne({
            hotelId: new mongoose.Types.ObjectId(req.hotelId),
            phone:   customerPhone,
            status:  { $ne: 'merged' },
          }).select('_id orgCustomerId').lean();
          if (!refundProfile) return;
          const refundOrgCtx = await resolveOrgLoyalty(refundProfile as any, req.hotelId!);
          const refundCfg    = refundOrgCtx ? refundOrgCtx.hqConfig : loyaltyCfg;
          if (!refundCfg.enabled && !refundOrgCtx) return;
          const profileId = (refundProfile as any)._id;
          const orderId   = String(order._id);

          // Reverse earned points (Razorpay path)
          const earnedPay = await Payment.findOne({
            orderId: order._id, hotelId: req.hotelId,
            loyaltyEarnPoints: { $gt: 0 }, loyaltyReversedAt: null,
          });
          if (earnedPay) {
            const claimed = await Payment.findOneAndUpdate(
              { _id: earnedPay._id, loyaltyReversedAt: null },
              { $set: { loyaltyReversedAt: new Date() } },
            );
            if (claimed) {
              if (refundOrgCtx) {
                await reverseOrgEarnedPoints(
                  refundOrgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
                  refundOrgCtx.orgCustomer!.orgHotelId.toString(),
                  req.hotelId!, profileId, claimed.loyaltyEarnPoints, refundCfg,
                  { orderId, paymentId: String(claimed._id), createdBy: 'system:refund', remarks: `Earn reversal: Order #${order.orderNumber} refunded` },
                );
              } else {
                await reverseEarnedPoints(profileId, req.hotelId!, claimed.loyaltyEarnPoints, refundCfg,
                  { orderId, paymentId: String(claimed._id), createdBy: 'system:refund', remarks: `Earn reversal: Order #${order.orderNumber} refunded` },
                );
              }
            }
          } else {
            // Reverse earned points (cash/UPI path)
            const earnTx = await LoyaltyTransaction.findOne({
              hotelId: new mongoose.Types.ObjectId(req.hotelId), customerId: profileId,
              orderId: order._id, transactionType: 'earn',
            }).sort({ createdAt: -1 }).lean();
            if (earnTx && earnTx.points > 0) {
              const claimedOrder = await Order.findOneAndUpdate(
                { _id: order._id, loyaltyEarnedAt: { $ne: null } },
                { $set: { loyaltyEarnedAt: null } },
              );
              if (claimedOrder) {
                if (refundOrgCtx) {
                  await reverseOrgEarnedPoints(
                    refundOrgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
                    refundOrgCtx.orgCustomer!.orgHotelId.toString(),
                    req.hotelId!, profileId, earnTx.points, refundCfg,
                    { orderId, createdBy: 'system:refund', remarks: `Earn reversal: Order #${order.orderNumber} refunded` },
                  );
                } else {
                  await reverseEarnedPoints(profileId, req.hotelId!, earnTx.points, refundCfg,
                    { orderId, createdBy: 'system:refund', remarks: `Earn reversal: Order #${order.orderNumber} refunded` },
                  );
                }
              }
            }
          }

          // Restore redeemed loyalty points
          const redeemedPts = (order as any).redeemedPoints ?? 0;
          if (redeemedPts > 0) {
            if (refundOrgCtx) {
              await earnOrgPoints(
                refundOrgCtx.orgCustomer!._id as mongoose.Types.ObjectId,
                refundOrgCtx.orgCustomer!.orgHotelId.toString(),
                req.hotelId!, profileId, redeemedPts, refundCfg,
                { orderId, createdBy: 'system:refund', remarks: `Redemption restore: Order #${order.orderNumber} refunded` },
              );
            } else {
              await earnPoints(profileId, req.hotelId!, redeemedPts, refundCfg,
                { orderId, createdBy: 'system:refund', remarks: `Redemption restore: Order #${order.orderNumber} refunded` },
              );
            }
          }
        } catch (loyaltyErr) {
          logger.error('[refund] loyalty reversal failed', { orderId: String(order._id), err: String(loyaltyErr) });
        }

        // Restore wallet
        try {
          const walletAmt = (order as any).walletAmount ?? 0;
          if (walletAmt > 0 && order.walletCustomerId) {
            const walletClaimed = await Order.findOneAndUpdate(
              { _id: order._id, walletRestoredAt: null },
              { $set: { walletRestoredAt: new Date() } },
            );
            if (walletClaimed) {
              await WalletTransaction.create({
                hotelId:    req.hotelId,
                customerId: order.walletCustomerId,
                type:       'credit',
                amount:     walletAmt,
                referenceId: String(order._id),
                description: `Wallet restore: Order #${order.orderNumber} refunded`,
              });
              await CustomerProfile.findByIdAndUpdate(order.walletCustomerId, { $inc: { walletBalance: walletAmt } });
            }
          }
        } catch (walletErr) {
          logger.error('[refund] wallet restore failed', { orderId: String(order._id), err: String(walletErr) });
        }

        // Restore gift voucher
        try {
          const voucherAmt = (order as any).giftVoucherAmount ?? 0;
          if (voucherAmt > 0 && order.giftVoucherId && !(order as any).giftVoucherRestoredAt) {
            const voucherClaimed = await Order.findOneAndUpdate(
              { _id: order._id, giftVoucherRestoredAt: null },
              { $set: { giftVoucherRestoredAt: new Date() } },
            );
            if (voucherClaimed) {
              await GiftVoucher.findByIdAndUpdate(order.giftVoucherId, { $inc: { balance: voucherAmt } });
            }
          }
        } catch (voucherErr) {
          logger.error('[refund] voucher restore failed', { orderId: String(order._id), err: String(voucherErr) });
        }
      })().catch(err => logger.error('[refund] reversal error', { orderId: String(order._id), err: String(err) }));

      res.json({ message: 'Refund processed.', refundAmount, orderId: String(order._id) });
    } catch (error) {
      sendError(res, 500, 'Server error', error);
    }
  },
);

export default router;
