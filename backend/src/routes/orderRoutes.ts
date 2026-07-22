import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Product from '../models/Product';
import Ingredient from '../models/Ingredient';
import DailyCounter from '../models/DailyCounter';
import TableSession from '../models/TableSession';
import Guest from '../models/Guest';
import CustomerProfile from '../models/CustomerProfile';
import { findOrCreateOpenSession, findOrCreateDefaultGuest } from '../utils/sessionUtils';
import { scheduleKOTPrint } from '../utils/printUtils';
import { authMiddleware, requireAdmin, requireKitchenOrAdmin, requireWaiterOrAdmin, requireCashierOrAdmin, requireWaiterOrCashierOrAdmin, resolveHotelStatus, AuthRequest } from '../middleware/auth';
import { requireActiveStaff } from '../middleware/staffAuth';
import { logAudit } from '../utils/audit';
import { logger } from '../utils/logger';
import { io } from '../server';
import { sendError } from '../utils/sendError';

const router = Router();

// ── C1: Server-side monetary recalculation ───────────────────────────────────
// The backend is the single source of truth for all monetary values.
// Client-supplied subtotal / taxTotal / discountAmount / grandTotal are
// ignored and recomputed from the raw items before any Order is persisted.
function recalcOrderTotals(
  rawItems: any[],
  rawDiscount: unknown,
  rawLoyaltyDiscount: unknown,
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
    return { ...item, quantity: qty, taxAmount: taxAmt, total: lineTotal };
  });

  subtotal = Math.round(subtotal * 100) / 100;
  taxTotal = Math.round(taxTotal * 100) / 100;
  const available        = subtotal + taxTotal;
  const discountAmount   = Math.min(Math.max(0, Number(rawDiscount) || 0), available);
  const loyaltyDiscount  = Math.min(Math.max(0, Number(rawLoyaltyDiscount) || 0), available - discountAmount);
  const grandTotal       = Math.max(0, Math.round((available - discountAmount - loyaltyDiscount) * 100) / 100);

  return { items, subtotal, taxTotal, discountAmount, loyaltyDiscount, grandTotal };
}

// Deduct (-1) or restore (+1) raw-material stock based on each product's recipe (BOM)
const applyIngredientStockChange = async (orderItems: { product?: any; quantity: number }[], hotelId: string, sign: 1 | -1) => {
  const productIds = orderItems.filter(i => i.product).map(i => i.product);
  if (productIds.length === 0) return;

  const productsWithRecipe = await Product.find({
    _id: { $in: productIds }, hotelId, 'recipe.0': { $exists: true },
  }).select('recipe');
  if (productsWithRecipe.length === 0) return;

  const deltas = new Map<string, number>();
  for (const item of orderItems) {
    if (!item.product) continue;
    const product = productsWithRecipe.find(p => p._id.toString() === item.product.toString());
    if (!product) continue;
    for (const r of product.recipe) {
      const key = r.ingredient.toString();
      deltas.set(key, (deltas.get(key) || 0) + r.quantity * item.quantity);
    }
  }
  if (deltas.size === 0) return;

  const bulkOps = Array.from(deltas.entries()).map(([ingredientId, qty]) => ({
    updateOne: {
      filter: { _id: ingredientId, hotelId },
      update: sign === -1
        ? [{ $set: { currentStock: { $max: [{ $subtract: ['$currentStock', qty] }, 0] } } }]
        : { $inc: { currentStock: qty } },
    },
  }));
  await Ingredient.bulkWrite(bulkOps as any);
};

// Helper: Generate order number like ORD-20260310-001 (per hotel)
// Uses an atomic MongoDB $inc counter — no race condition under concurrent tablets.
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

// Daily report — uses aggregation pipeline (single DB pass, faster than multiple reduce loops)
router.get('/reports/daily', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date = new Date(dateStr);
    const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date); endOfDay.setHours(23, 59, 59, 999);

    const [result] = await Order.aggregate([
      { $match: { hotelId: new (require('mongoose').Types.ObjectId)(req.hotelId), status: { $ne: 'cancelled' }, createdAt: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: {
        _id: null,
        totalSales:     { $sum: '$grandTotal' },
        totalTax:       { $sum: '$taxTotal' },
        totalDiscount:  { $sum: { $ifNull: ['$discountAmount', 0] } },
        totalOrders:    { $sum: 1 },
        parcelOrders:   { $sum: { $cond: ['$isParcel', 1, 0] } },
        parcelRevenue:  { $sum: { $cond: ['$isParcel', '$grandTotal', 0] } },
        cashTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash']  }, '$grandTotal', 0] } },
        upiTotal:       { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi']   }, '$grandTotal', 0] } },
        cardTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card']  }, '$grandTotal', 0] } },
        splitTotal:     { $sum: { $cond: [{ $eq: ['$paymentMethod', 'split'] }, '$grandTotal', 0] } },
        dineInOrders:   { $sum: { $cond: [{ $eq: ['$orderSource', 'dine-in']  }, 1, 0] } },
        dineInTotal:    { $sum: { $cond: [{ $eq: ['$orderSource', 'dine-in']  }, '$grandTotal', 0] } },
        takeawayOrders: { $sum: { $cond: [{ $eq: ['$orderSource', 'takeaway'] }, 1, 0] } },
        takeawayTotal:  { $sum: { $cond: [{ $eq: ['$orderSource', 'takeaway'] }, '$grandTotal', 0] } },
        swiggyOrders:   { $sum: { $cond: [{ $eq: ['$orderSource', 'swiggy']   }, 1, 0] } },
        swiggyTotal:    { $sum: { $cond: [{ $eq: ['$orderSource', 'swiggy']   }, '$grandTotal', 0] } },
        zomatoOrders:   { $sum: { $cond: [{ $eq: ['$orderSource', 'zomato']   }, 1, 0] } },
        zomatoTotal:    { $sum: { $cond: [{ $eq: ['$orderSource', 'zomato']   }, '$grandTotal', 0] } },
        qrOrders:       { $sum: { $cond: [{ $eq: ['$orderSource', 'qr']       }, 1, 0] } },
        qrTotal:        { $sum: { $cond: [{ $eq: ['$orderSource', 'qr']       }, '$grandTotal', 0] } },
      }},
    ]);

    // Loyalty discounts applied at Guest level (session billing) are not reflected in
    // Order.grandTotal. Subtract them so totalSales is net actual revenue.
    const [loyaltyAgg] = await Guest.aggregate([
      { $match: { hotelId: new (require('mongoose').Types.ObjectId)(req.hotelId), status: 'billed', loyaltyDiscountAmount: { $gt: 0 }, updatedAt: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: { _id: null, total: { $sum: '$loyaltyDiscountAmount' } } },
    ]);
    const sessionLoyaltyDiscount = loyaltyAgg?.total ?? 0;

    const empty = {
      totalSales: 0, totalTax: 0, totalDiscount: 0, totalOrders: 0, parcelOrders: 0, parcelRevenue: 0,
      cashTotal: 0, upiTotal: 0, cardTotal: 0, splitTotal: 0,
      dineInOrders: 0, dineInTotal: 0, takeawayOrders: 0, takeawayTotal: 0,
      swiggyOrders: 0, swiggyTotal: 0, zomatoOrders: 0, zomatoTotal: 0,
      qrOrders: 0, qrTotal: 0,
    };
    const r = result || empty;
    const netSales = +(r.totalSales - sessionLoyaltyDiscount).toFixed(2);

    res.json({
      date: dateStr,
      totalSales: netSales,
      totalRevenue: netSales,
      totalTax: r.totalTax,
      totalDiscount: r.totalDiscount,
      totalOrders: r.totalOrders,
      parcelOrders: r.parcelOrders,
      parcelRevenue: r.parcelRevenue,
      paymentBreakdown: { cash: r.cashTotal, upi: r.upiTotal, card: r.cardTotal, split: r.splitTotal },
      sourceBreakdown: {
        'dine-in':  { orders: r.dineInOrders,    revenue: r.dineInTotal },
        takeaway:   { orders: r.takeawayOrders,  revenue: r.takeawayTotal },
        swiggy:     { orders: r.swiggyOrders,    revenue: r.swiggyTotal },
        zomato:     { orders: r.zomatoOrders,    revenue: r.zomatoTotal },
        qr:         { orders: r.qrOrders,        revenue: r.qrTotal },
      },
    });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// Range report (weekly / monthly) — same shape as daily
router.get('/reports/range', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Both from and to are required — a range without explicit bounds is ambiguous
    if (!req.query.from || !req.query.to) {
      return res.status(400).json({ message: 'Both from and to date params are required' });
    }
    const fromStr = req.query.from as string;
    const toStr   = req.query.to   as string;
    const start   = new Date(fromStr); start.setHours(0, 0, 0, 0);
    const end     = new Date(toStr);   end.setHours(23, 59, 59, 999);

    const [result] = await Order.aggregate([
      { $match: { hotelId: new (require('mongoose').Types.ObjectId)(req.hotelId), status: { $ne: 'cancelled' }, createdAt: { $gte: start, $lte: end } } },
      { $group: {
        _id: null,
        totalSales:     { $sum: '$grandTotal' },
        totalTax:       { $sum: '$taxTotal' },
        totalDiscount:  { $sum: { $ifNull: ['$discountAmount', 0] } },
        totalOrders:    { $sum: 1 },
        parcelOrders:   { $sum: { $cond: ['$isParcel', 1, 0] } },
        parcelRevenue:  { $sum: { $cond: ['$isParcel', '$grandTotal', 0] } },
        cashTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash']  }, '$grandTotal', 0] } },
        upiTotal:       { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi']   }, '$grandTotal', 0] } },
        cardTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card']  }, '$grandTotal', 0] } },
        splitTotal:     { $sum: { $cond: [{ $eq: ['$paymentMethod', 'split'] }, '$grandTotal', 0] } },
        dineInOrders:   { $sum: { $cond: [{ $eq: ['$orderSource', 'dine-in']  }, 1, 0] } },
        dineInTotal:    { $sum: { $cond: [{ $eq: ['$orderSource', 'dine-in']  }, '$grandTotal', 0] } },
        takeawayOrders: { $sum: { $cond: [{ $eq: ['$orderSource', 'takeaway'] }, 1, 0] } },
        takeawayTotal:  { $sum: { $cond: [{ $eq: ['$orderSource', 'takeaway'] }, '$grandTotal', 0] } },
        swiggyOrders:   { $sum: { $cond: [{ $eq: ['$orderSource', 'swiggy']   }, 1, 0] } },
        swiggyTotal:    { $sum: { $cond: [{ $eq: ['$orderSource', 'swiggy']   }, '$grandTotal', 0] } },
        zomatoOrders:   { $sum: { $cond: [{ $eq: ['$orderSource', 'zomato']   }, 1, 0] } },
        zomatoTotal:    { $sum: { $cond: [{ $eq: ['$orderSource', 'zomato']   }, '$grandTotal', 0] } },
        qrOrders:       { $sum: { $cond: [{ $eq: ['$orderSource', 'qr']       }, 1, 0] } },
        qrTotal:        { $sum: { $cond: [{ $eq: ['$orderSource', 'qr']       }, '$grandTotal', 0] } },
      }},
    ]);

    const [rangeLoyaltyAgg] = await Guest.aggregate([
      { $match: { hotelId: new (require('mongoose').Types.ObjectId)(req.hotelId), status: 'billed', loyaltyDiscountAmount: { $gt: 0 }, updatedAt: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$loyaltyDiscountAmount' } } },
    ]);
    const rangeSessionLoyaltyDiscount = rangeLoyaltyAgg?.total ?? 0;

    const empty = { totalSales: 0, totalTax: 0, totalDiscount: 0, totalOrders: 0, parcelOrders: 0, parcelRevenue: 0, cashTotal: 0, upiTotal: 0, cardTotal: 0, splitTotal: 0, dineInOrders: 0, dineInTotal: 0, takeawayOrders: 0, takeawayTotal: 0, swiggyOrders: 0, swiggyTotal: 0, zomatoOrders: 0, zomatoTotal: 0, qrOrders: 0, qrTotal: 0 };
    const r = result || empty;
    const netRangeSales = +(r.totalSales - rangeSessionLoyaltyDiscount).toFixed(2);
    res.json({
      from: fromStr, to: toStr,
      totalSales: netRangeSales, totalTax: r.totalTax, totalDiscount: r.totalDiscount,
      totalOrders: r.totalOrders, parcelOrders: r.parcelOrders, parcelRevenue: r.parcelRevenue,
      paymentBreakdown: { cash: r.cashTotal, upi: r.upiTotal, card: r.cardTotal, split: r.splitTotal },
      sourceBreakdown: {
        'dine-in':  { orders: r.dineInOrders,    revenue: r.dineInTotal },
        takeaway:   { orders: r.takeawayOrders,  revenue: r.takeawayTotal },
        swiggy:     { orders: r.swiggyOrders,    revenue: r.swiggyTotal },
        zomato:     { orders: r.zomatoOrders,    revenue: r.zomatoTotal },
        qr:         { orders: r.qrOrders,        revenue: r.qrTotal },
      },
    });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// Product-wise sales report for a date
router.get('/reports/products', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date = new Date(dateStr);
    const startOfDay = new Date(date); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(date); endOfDay.setHours(23, 59, 59, 999);

    const results = await Order.aggregate([
      { $match: { hotelId: new (require('mongoose').Types.ObjectId)(req.hotelId), status: { $ne: 'cancelled' }, createdAt: { $gte: startOfDay, $lte: endOfDay } } },
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

// GET /api/orders/kitchen — active orders for KDS (pending + preparing), oldest first
router.get('/kitchen', requireKitchenOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await Order.find(
      { hotelId: req.hotelId, status: { $in: ['pending', 'preparing'] } },
      { orderNumber: 1, tableNumber: 1, customerName: 1, notes: 1, status: 1, isParcel: 1, createdAt: 1,
        'items.productName': 1, 'items.quantity': 1 },
    ).sort({ createdAt: 1 }).lean();
    res.json(orders);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
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

// GET /api/orders/cashier — served orders awaiting payment completion
router.get('/cashier', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orders = await Order.find(
      {
        hotelId: req.hotelId,
        status: 'served',
      },
      {
        orderNumber: 1, tableNumber: 1, customerName: 1, notes: 1,
        status: 1, paymentMethod: 1, grandTotal: 1, subtotal: 1, taxTotal: 1, discountAmount: 1,
        orderSource: 1, isParcel: 1, createdAt: 1, completedBy: 1, completedAt: 1, cashierId: 1,
        'items.productName': 1, 'items.quantity': 1, 'items.price': 1, 'items.total': 1,
      }
    ).sort({ createdAt: -1 }).lean();
    res.json(orders);
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
    if (req.query.from && req.query.to) {
      const from = new Date(req.query.from as string);
      const to = new Date(req.query.to as string);
      to.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: from, $lte: to };
    }
    if (req.query.status) filter.status = req.query.status;
    if (req.query.source) filter.orderSource = req.query.source;

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), 200);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// GET customer list — aggregated from orders (name, phone, totalOrders, totalSpent, lastOrderDate)
router.get('/customers', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const match: any = {
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      status: { $ne: 'cancelled' },
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
        totalSpent:     { $sum: '$grandTotal' },
        lastOrderDate:  { $max: '$createdAt' },
        firstOrderDate: { $min: '$createdAt' },
      }},
      { $sort: { lastOrderDate: -1 } },
      { $project: { _id: 0, phone: '$_id', customerName: 1, totalOrders: 1, totalSpent: 1, lastOrderDate: 1, firstOrderDate: 1 } },
    ]);

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
    // Every order must have at least one item and at most 100 items
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }
    if (req.body.items.length > 100) {
      return res.status(400).json({ message: 'Order cannot contain more than 100 items' });
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

    // ── Phase 4: Order Route Guard ────────────────────────────────────────────
    // When sessionId + guestId are both provided, validate the ownership chain:
    //   hotel → session open → guest active + belongs to this session.
    // If either lookup returns null the order is rejected (guest stale/wrong hotel).
    // Hotels without tableSessions simply have no sessions — validation returns null
    // naturally, so an explicit feature-flag check is not needed here.
    let linkedGuestId: mongoose.Types.ObjectId | null = null;

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

      // CustomerProfile find/create when phone + name provided and guest has no profile yet
      const { customerPhone, customerName } = req.body;
      if (customerPhone && !linkedGuest.customerId) {
        try {
          const entry = await resolveHotelStatus(req.hotelId!);
          if ((entry.features as any)?.customerIdentification === 'name_mobile') {
            const cleanPhone = String(customerPhone).trim().slice(0, 20);
            const cleanName  = String(customerName || '').trim().slice(0, 100);

            let profile = await CustomerProfile.findOne({
              hotelId: new mongoose.Types.ObjectId(req.hotelId),
              phone:   cleanPhone,
              status:  { $ne: 'merged' },
            });

            if (!profile && cleanName) {
              const counterKey = `CUST-${req.hotelId}`;
              const counter = await DailyCounter.findOneAndUpdate(
                { key: counterKey },
                { $inc: { seq: 1 }, $setOnInsert: { key: counterKey } },
                { upsert: true, new: true }
              );
              const newCustomerId = `CUST-${req.hotelId!.slice(-6).toUpperCase()}-${String(counter!.seq).padStart(4, '0')}`;
              profile = await CustomerProfile.create({
                hotelId:     new mongoose.Types.ObjectId(req.hotelId),
                customerId:  newCustomerId,
                name:        cleanName,
                phone:       cleanPhone,
                lastVisitAt: new Date(),
                visitCount:  1,
              });
              logger.info('CustomerProfile created', { customerId: String(newCustomerId), hotelId: req.hotelId });
            } else if (profile) {
              CustomerProfile.findByIdAndUpdate(profile._id, {
                $set: { lastVisitAt: new Date(), ...(cleanName ? { name: cleanName } : {}) },
                $inc: { visitCount: 1 },
              }).catch(() => {});
            }

            if (profile) {
              // Link profile to guest — non-blocking
              Guest.findByIdAndUpdate(linkedGuest._id, { $set: { customerId: profile._id } }).catch(() => {});
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

    const orderNumber = await generateOrderNumber(req.hotelId!);
    const recalc = recalcOrderTotals(req.body.items, req.body.discountAmount, req.body.loyaltyDiscount);
    const order = new Order({
      ...req.body,
      hotelId:        req.hotelId,
      orderNumber,
      items:           recalc.items,
      subtotal:        recalc.subtotal,
      taxTotal:        recalc.taxTotal,
      discountAmount:  recalc.discountAmount,
      loyaltyDiscount: recalc.loyaltyDiscount,
      grandTotal:      recalc.grandTotal,
    });
    await order.save();
    logger.info('Order saved', { orderId: String(order._id), orderNumber: order.orderNumber, hotelId: req.hotelId });

    // ── Phase 7: Fire-and-forget KOT print ───────────────────────────────────
    scheduleKOTPrint(req.hotelId!, {
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

    // ── Phase 4: Update guest running total ───────────────────────────────────
    if (linkedGuestId) {
      await Guest.findByIdAndUpdate(linkedGuestId, { $inc: { totalAmount: order.grandTotal } });
    }

    // ── Stock deduction ──────────────────────────────────────────────────────
    const stockItems = order.items.filter(i => i.product);
    if (stockItems.length > 0) {
      const bulkOps = stockItems.map(item => ({
        updateOne: {
          filter: { _id: item.product, hotelId: req.hotelId, stock: { $gt: 0 } },
          update: [
            { $set: { stock: { $max: [{ $subtract: ['$stock', item.quantity] }, 0] } } },
            { $set: { isAvailable: { $gt: ['$stock', 0] } } },
          ],
        },
      }));
      await Product.bulkWrite(bulkOps as any);
    }

    // Deduct raw-material (ingredient) stock based on product recipes
    await applyIngredientStockChange(order.items, req.hotelId!, -1);

    // ── Return stock updates to client ───────────────────────────────────────
    // Client applies these immediately so local cache reflects server truth
    // without waiting for the next full cache refresh.
    let stockUpdates: { productId: string; newStock: number }[] = [];
    if (stockItems.length > 0) {
      const updatedProducts = await Product.find({
        _id: { $in: stockItems.map(i => i.product) },
      }).select('_id stock');
      stockUpdates = updatedProducts.map(p => ({
        productId: (p._id as mongoose.Types.ObjectId).toString(),
        newStock:  (p as any).stock ?? 0,
      }));
    }

    const room = `hotel_${req.hotelId}`;
    const roomClients = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    logger.info('Emitting new_order', { room, clientsInRoom: roomClients, orderId: String(order._id) });
    io.to(room).emit('new_order', {
      _id: order._id,
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      customerName: order.customerName,
      grandTotal: order.grandTotal,
      itemCount: order.items.length,
    });

    res.status(201).json({ ...order.toObject(), stockUpdates });

  } catch (error: any) {
    // Race condition: two concurrent syncs of the same offlineId both pass the
    // findOne check before either inserts. The unique index rejects one of them
    // with code 11000. Return the already-saved order rather than a 400 error.
    if (error.code === 11000 && error.keyPattern?.offlineId) {
      const existing = await Order.findOne({
        offlineId: req.body.offlineId,
        hotelId: req.hotelId,
      });
      if (existing) return res.status(200).json(existing);
    }
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
  const role = req.role; // undefined = admin (no restriction)
  if (role === 'kitchen' && !['preparing', 'ready'].includes(status)) {
    return res.status(403).json({ message: 'Access denied.' });
  }
  if (role === 'waiter' && status !== 'served') {
    return res.status(403).json({ message: 'Access denied.' });
  }
  if (role === 'cashier' && status !== 'completed') {
    return res.status(403).json({ message: 'Access denied.' });
  }

  try {
    const existing = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!existing) return res.status(404).json({ message: 'Order not found' });

    // State machine: enforce valid source-state for each role's allowed transition
    // Kitchen:  can only act on pending/preparing orders
    // Waiter:   can only serve a ready order
    // Cashier:  can only complete a served order
    if (role === 'kitchen' && !['pending', 'preparing'].includes(existing.status)) {
      return res.status(400).json({ message: `Cannot update kitchen status from '${existing.status}'.` });
    }
    if (role === 'waiter' && existing.status !== 'ready') {
      return res.status(400).json({ message: `Order must be ready before it can be served (current: ${existing.status}).` });
    }
    if (role === 'cashier' && existing.status !== 'served') {
      return res.status(400).json({ message: `Order must be served before it can be completed (current: ${existing.status}).` });
    }

    // H-04: atomic cancellation guard — only the first concurrent request runs side-effects
    if (status === 'cancelled') {
      const prevDoc = await Order.findOneAndUpdate(
        { _id: req.params.id, hotelId: req.hotelId, status: { $ne: 'cancelled' } },
        { $set: { status: 'cancelled' } },
        { new: false }
      );
      if (prevDoc) {
        logAudit(req, 'order.cancelled', 'order', String(existing._id), {
          orderNumber: existing.orderNumber,
          prevStatus:  existing.status,
          grandTotal:  existing.grandTotal,
        });
        const bulkOps = existing.items.filter(i => i.product).map(item => ({
          updateOne: {
            filter: { _id: item.product, hotelId: req.hotelId, stock: { $gte: 0 } },
            update: { $inc: { stock: item.quantity }, $set: { isAvailable: true } },
          },
        }));
        if (bulkOps.length > 0) await Product.bulkWrite(bulkOps as any);
        await applyIngredientStockChange(existing.items, req.hotelId!, 1);
        if (existing.guestId) {
          await Guest.findByIdAndUpdate(existing.guestId, [
            { $set: { totalAmount: { $max: [0, { $subtract: ['$totalAmount', existing.grandTotal] }] } } },
          ]);
        }
      }
    }

    existing.status = status;
    if (status === 'served') {
      existing.servedBy = req.waiterName || req.waiterId || '';
      existing.servedAt = new Date();
    }
    if (status === 'completed') {
      existing.completedBy = req.cashierName || req.cashierId || '';
      existing.completedAt = new Date();
      existing.cashierId   = req.cashierId || '';
      if (paymentMethod && ['cash', 'upi', 'card', 'split'].includes(paymentMethod)) {
        existing.paymentMethod = paymentMethod;
      }
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
        servedBy: existing.servedBy || '',
      });
    }
    if (existing.status === 'completed') {
      io.to(`hotel_${req.hotelId}`).emit('order_completed', {
        orderId: existing._id,
        orderNumber: existing.orderNumber,
        tableNumber: existing.tableNumber || '',
        completedBy: existing.completedBy || '',
        paymentMethod: existing.paymentMethod,
        grandTotal: existing.grandTotal,
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
  'paymentStatus', 'paymentMethod', 'notes', 'discount',
  'tableNumber', 'isParcel', 'customerName', 'totalAmount', 'taxAmount',
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
    sendError(res, 400, 'Invalid data', error);
  }
});

export default router;
