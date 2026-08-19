import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Product from '../models/Product';
import ModifierGroup from '../models/ModifierGroup';
import DailyCounter from '../models/DailyCounter';
import TableSession from '../models/TableSession';
import Guest from '../models/Guest';
import CustomerProfile from '../models/CustomerProfile';
import { findOrCreateOpenSession, findOrCreateDefaultGuest } from '../utils/sessionUtils';
import { scheduleKOTPrint, scheduleOrderReceiptPrint } from '../utils/printUtils';
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
import LoyaltyTransaction from '../models/LoyaltyTransaction';
import { getLoyaltyConfig, calculateEarnedPoints, earnPoints, redeemPoints, reverseEarnedPoints } from '../utils/loyaltyUtils';
import Coupon from '../models/Coupon';
import CouponRedemption from '../models/CouponRedemption';
import GiftVoucher from '../models/GiftVoucher';
import { resolveCoupon, CouponResult } from '../utils/couponUtils';

const router = Router();

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
    return { ...item, quantity: qty, taxAmount: taxAmt, total: lineTotal, selectedModifiers };
  });

  subtotal = Math.round(subtotal * 100) / 100;
  taxTotal = Math.round(taxTotal * 100) / 100;
  const available        = subtotal + taxTotal;
  const discountAmount   = Math.min(Math.max(0, Number(rawManualDiscount) || 0), available);
  const couponDiscount   = Math.min(Math.max(0, serverCouponDiscount), available - discountAmount);
  const loyaltyDiscount  = Math.min(Math.max(0, Number(rawLoyaltyDiscount) || 0), available - discountAmount - couponDiscount);
  const grandTotal       = Math.max(0, Math.round((available - discountAmount - couponDiscount - loyaltyDiscount) * 100) / 100);

  return { items, subtotal, taxTotal, discountAmount, couponDiscount, loyaltyDiscount, grandTotal };
}



// ── C2: Server-side product + modifier validation ────────────────────────────
// For items that carry a product ObjectId reference, we:
//   • verify the product belongs to this hotel and is not deleted
//   • derive basePrice from the DB (variant price when variantId is set)
//   • for each selectedModifier, verify group + option are hotel-owned,
//     active, not deleted, and override the price from the DB value
//   • recompute item.price = dbBasePrice + sum(dbOptionPrices)
// Aggregator items without a product ref pass through unvalidated (no DB record to check).
async function validateAndEnrichItems(
  rawItems: any[],
  hotelId: string,
): Promise<{ items: any[]; error: string | null }> {
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
    // Items without a product ref are aggregator/manual lines — pass through
    if (!item.product || !mongoose.isValidObjectId(item.product)) {
      enriched.push(item);
      continue;
    }

    const product = productMap.get(String(item.product));
    if (!product) {
      return { items: [], error: `Product ${item.product} not found in this hotel or has been deleted` };
    }

    // Resolve base price: variant if specified, else product price
    let basePrice: number = Number(product.price) || 0;
    if (item.variantId && mongoose.isValidObjectId(item.variantId)) {
      const variant = (product.variants ?? []).find((v: any) => String(v._id) === String(item.variantId));
      if (!variant) {
        return { items: [], error: `Variant ${item.variantId} not found on product ${product.name}` };
      }
      basePrice = Number(variant.price) || 0;
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
      productName:       product.name,
      selectedModifiers: validatedModifiers,
    });
  }

  return { items: enriched, error: null };
}

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
        cashTotal:       { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash']  }, '$grandTotal', 0] } },
        upiTotal:        { $sum: { $cond: [{ $in: ['$paymentMethod', ['upi', 'upi_intent', 'upi_qr', 'upi_collect']] }, '$grandTotal', 0] } },
        upiIntentTotal:  { $sum: { $cond: [{ $in: ['$paymentMethod', ['upi', 'upi_intent']] }, '$grandTotal', 0] } },
        upiQrTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi_qr'] }, '$grandTotal', 0] } },
        upiCollectTotal: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi_collect'] }, '$grandTotal', 0] } },
        cardTotal:       { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card']  }, '$grandTotal', 0] } },
        splitTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'split'] }, '$grandTotal', 0] } },
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
    const [[loyaltyAgg], cancelledOrders] = await Promise.all([
      Guest.aggregate([
        { $match: { hotelId: new (require('mongoose').Types.ObjectId)(req.hotelId), status: 'billed', loyaltyDiscountAmount: { $gt: 0 }, billedAt: { $gte: startOfDay, $lte: endOfDay } } },
        { $group: { _id: null, total: { $sum: '$loyaltyDiscountAmount' } } },
      ]),
      Order.countDocuments({ hotelId: new mongoose.Types.ObjectId(req.hotelId!), status: 'cancelled', createdAt: { $gte: startOfDay, $lte: endOfDay } }),
    ]);
    const sessionLoyaltyDiscount = loyaltyAgg?.total ?? 0;

    const empty = {
      totalSales: 0, totalTax: 0, totalDiscount: 0, totalOrders: 0, parcelOrders: 0, parcelRevenue: 0,
      cashTotal: 0, upiTotal: 0, upiIntentTotal: 0, upiQrTotal: 0, upiCollectTotal: 0,
      cardTotal: 0, splitTotal: 0,
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
      cancelledOrders,
      paymentBreakdown: {
        cash: r.cashTotal,
        upi: r.upiTotal,
        upi_intent: r.upiIntentTotal,
        upi_qr: r.upiQrTotal,
        upi_collect: r.upiCollectTotal,
        card: r.cardTotal,
        split: r.splitTotal,
      },
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
        cashTotal:       { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash']  }, '$grandTotal', 0] } },
        upiTotal:        { $sum: { $cond: [{ $in: ['$paymentMethod', ['upi', 'upi_intent', 'upi_qr', 'upi_collect']] }, '$grandTotal', 0] } },
        upiIntentTotal:  { $sum: { $cond: [{ $in: ['$paymentMethod', ['upi', 'upi_intent']] }, '$grandTotal', 0] } },
        upiQrTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi_qr'] }, '$grandTotal', 0] } },
        upiCollectTotal: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi_collect'] }, '$grandTotal', 0] } },
        cardTotal:       { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card']  }, '$grandTotal', 0] } },
        splitTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'split'] }, '$grandTotal', 0] } },
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

    const [[rangeLoyaltyAgg], rangeCancelledOrders] = await Promise.all([
      Guest.aggregate([
        { $match: { hotelId: new (require('mongoose').Types.ObjectId)(req.hotelId), status: 'billed', loyaltyDiscountAmount: { $gt: 0 }, billedAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$loyaltyDiscountAmount' } } },
      ]),
      Order.countDocuments({ hotelId: new mongoose.Types.ObjectId(req.hotelId!), status: 'cancelled', createdAt: { $gte: start, $lte: end } }),
    ]);
    const rangeSessionLoyaltyDiscount = rangeLoyaltyAgg?.total ?? 0;

    const empty = {
      totalSales: 0, totalTax: 0, totalDiscount: 0, totalOrders: 0, parcelOrders: 0, parcelRevenue: 0,
      cashTotal: 0, upiTotal: 0, upiIntentTotal: 0, upiQrTotal: 0, upiCollectTotal: 0,
      cardTotal: 0, splitTotal: 0,
      dineInOrders: 0, dineInTotal: 0, takeawayOrders: 0, takeawayTotal: 0,
      swiggyOrders: 0, swiggyTotal: 0, zomatoOrders: 0, zomatoTotal: 0, qrOrders: 0, qrTotal: 0,
    };
    const r = result || empty;
    const netRangeSales = +(r.totalSales - rangeSessionLoyaltyDiscount).toFixed(2);
    res.json({
      from: fromStr, to: toStr,
      totalSales: netRangeSales, totalTax: r.totalTax, totalDiscount: r.totalDiscount,
      totalOrders: r.totalOrders, parcelOrders: r.parcelOrders, parcelRevenue: r.parcelRevenue,
      cancelledOrders: rangeCancelledOrders,
      paymentBreakdown: {
        cash: r.cashTotal,
        upi: r.upiTotal,
        upi_intent: r.upiIntentTotal,
        upi_qr: r.upiQrTotal,
        upi_collect: r.upiCollectTotal,
        card: r.cardTotal,
        split: r.splitTotal,
      },
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
        'items.selectedModifiers': 1 },
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
        ],
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
    // Accept both from/to (legacy) and dateFrom/dateTo (new) query params
    const fromStr = (req.query.from || req.query.dateFrom) as string | undefined;
    const toStr   = (req.query.to   || req.query.dateTo)   as string | undefined;
    if (fromStr && toStr) {
      const from = new Date(fromStr);
      const to = new Date(toStr);
      to.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: from, $lte: to };
    }
    if (req.query.status) filter.status = req.query.status;
    if (req.query.source) filter.orderSource = req.query.source;

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
    const { items: validatedItems, error: itemError } = await validateAndEnrichItems(
      req.body.items,
      req.hotelId!,
    );
    if (itemError) {
      return res.status(422).json({ message: itemError });
    }

    // ── Server-side coupon resolution ─────────────────────────────────────────
    // Compute item totals first (needed for coupon minimum order check).
    const preCoupon     = recalcOrderTotals(validatedItems, 0, 0);
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
    let h2RedeemProfile: { _id: mongoose.Types.ObjectId } | null = null;
    if (rawRedeemedPts > 0) {
      h2LoyaltyCfg = await getLoyaltyConfig(req.hotelId!);
      // maxAllowedDiscount = points × (pointValueInPaisa / 100) in rupees
      const maxAllowedDiscount = rawRedeemedPts * (h2LoyaltyCfg.pointValueInPaisa / 100);
      verifiedLoyaltyDiscount = Math.min(verifiedLoyaltyDiscount, maxAllowedDiscount);
      // Pre-fetch profile for H2 (redeemPoints moved inside transaction)
      if (h2LoyaltyCfg.enabled) {
        const e164Phone = normalizePhone(String(req.body.customerPhone || ''));
        if (e164Phone) {
          h2RedeemProfile = await CustomerProfile.findOne({
            hotelId:       new mongoose.Types.ObjectId(req.hotelId),
            phone:         e164Phone,
            status:        'active',
            loyaltyOptOut: { $ne: true },
          }).select('_id') as { _id: mongoose.Types.ObjectId } | null;
        }
      }
    } else {
      verifiedLoyaltyDiscount = 0; // no points redeemed → zero loyalty discount allowed
    }

    // RBAC: only admins may apply a manual discount (Gap 1 — discount gate)
    if (Number(req.body.discountAmount) > 0 && req.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can apply discounts.' });
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
    const finalGrandTotal = Math.round(Math.max(0, recalc.grandTotal - serverVoucherAmount + cappedDeliveryFee) * 100) / 100;
    const order = new Order({
      tableNumber:         b.tableNumber,
      customerName:        b.customerName,
      customerPhone:       b.customerPhone,
      notes:               b.notes,
      orderSource:         b.orderSource,
      isParcel:            b.isParcel,
      paymentMethod:       b.paymentMethod,
      splitDetails:        b.splitDetails,
      tableId:             b.tableId,
      sessionId:           b.sessionId,
      guestId:             b.guestId,
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
      grandTotal:          finalGrandTotal,
    });
    // ── Atomic transaction: persist order + deduct stock atomically ──────────
    // order.save() and both stock-deduction writes must succeed or fail together.
    // KOT print, guest total, stock-response read, and socket emit run AFTER
    // the transaction commits so they never see a rolled-back order.
    const stockItems = order.items.filter(i => i.product);
    const stockBulkOps = stockItems.map(item => ({
      updateOne: {
        filter: { _id: item.product, hotelId: req.hotelId, stock: { $gt: 0 } },
        update: [
          { $set: { stock: { $max: [{ $subtract: ['$stock', item.quantity] }, 0] } } },
          { $set: { isAvailable: { $gt: ['$stock', 0] } } },
        ],
      },
    }));

    let ingredientDeltas = new Map<string, number>();
    let saleMovementPrevStocks = new Map<string, number>();
    const txSession = await mongoose.startSession();
    try {
      await txSession.withTransaction(async () => {
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

        // Ingredient deduction runs first so we capture actual clamped deltas
        // and persist them on the order for use during cancellation restoration.
        const { actualDeltas, previousStocks } = await applyIngredientStockChange(order.items, req.hotelId!, -1, txSession);
        ingredientDeltas = actualDeltas;
        saleMovementPrevStocks = previousStocks;
        if (ingredientDeltas.size > 0) order.ingredientDeltas = ingredientDeltas;
        await order.save({ session: txSession });
        if (stockItems.length > 0) {
          await Product.bulkWrite(stockBulkOps as any, { session: txSession });
        }
        // H2: loyalty redemption inside transaction — if it fails the whole order is rolled back
        // so the loyalty ledger and order discount are always consistent.
        if (order.redeemedPoints > 0 && h2LoyaltyCfg?.enabled && h2RedeemProfile) {
          await redeemPoints(
            h2RedeemProfile._id as mongoose.Types.ObjectId,
            req.hotelId!,
            order.redeemedPoints,
            h2LoyaltyCfg,
            { orderId: String(order._id), createdBy: req.cashierName || 'cashier' },
          );
        }
      });
    } finally {
      await txSession.endSession();
    }

    // Best-effort: audit StockMovement records for recipe-based deductions (sale type).
    // Runs after the transaction so audit failure never rolls back the order.
    if (ingredientDeltas.size > 0) {
      const saleIngIds = Array.from(ingredientDeltas.keys());
      Ingredient.find({ _id: { $in: saleIngIds }, hotelId: req.hotelId }).select('_id name').lean()
        .then(ings => {
          const nameMap = new Map((ings as any[]).map(i => [String(i._id), String(i.name)]));
          const movements = saleIngIds.map(id => {
            const delta = ingredientDeltas.get(id)!;
            if (delta <= 0) return null;
            const prev = saleMovementPrevStocks.get(id) ?? 0;
            return {
              hotelId: req.hotelId,
              ingredientId: id,
              ingredientName: nameMap.get(id) ?? 'Unknown',
              type: 'sale' as const,
              delta: -delta,
              previousStock: prev,
              resultingStock: prev - delta,
              referenceId: String(order._id),
              referenceType: 'order' as const,
              reason: `Order #${order.orderNumber ?? ''}`,
              performedBy: String((req as any).cashierId ?? (req as any).waiterId ?? ''),
            };
          }).filter(Boolean);
          if (movements.length > 0) return StockMovement.insertMany(movements);
        })
        .catch(() => {});
    }

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
    logger.error('[POST /orders] Failed', { hotelId: req.hotelId, error: String(error), code: error.code });
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
    // C2: Takeaway/delivery orders can be completed directly from 'pending' (immediate counter payment)
    const isQuickService = (existing as any).orderSource === 'takeaway';
    if (role === 'cashier' && !['served', 'ready'].includes(existing.status)) {
      if (!(isQuickService && existing.status === 'pending')) {
        return res.status(400).json({ message: `Order must be ready or served before it can be completed (current: ${existing.status}).` });
      }
    }

    // H3: Block cancellation of completed (paid) orders — require a refund instead
    if (status === 'cancelled' && existing.status === 'completed') {
      return res.status(400).json({ message: 'Cannot cancel a completed order. Process a refund instead.' });
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
        // Wrap both stock restores in a transaction so they succeed or fail together.
        // Guest total update is outside the tx — it's a derived value that can be
        // recomputed, and cross-collection txns have higher abort risk.
        let cancelDeltas = new Map<string, number>();
        const cancelTx = await mongoose.startSession();
        try {
          await cancelTx.withTransaction(async () => {
            if (bulkOps.length > 0) await Product.bulkWrite(bulkOps as any, { session: cancelTx });
            // Pass stored deltas so we restore exactly what was deducted (not full recipe qty)
            const { actualDeltas } = await applyIngredientStockChange(existing.items, req.hotelId!, 1, cancelTx, existing.ingredientDeltas as Map<string, number> | undefined);
            cancelDeltas = actualDeltas;
          });
        } finally {
          await cancelTx.endSession();
        }

        // Best-effort: audit StockMovement records for cancellation restorations (sale_reversal type).
        // Reads current stock after restoration — resultingStock — then back-computes previousStock.
        if (cancelDeltas.size > 0) {
          const cancelIngIds = Array.from(cancelDeltas.keys());
          Ingredient.find({ _id: { $in: cancelIngIds }, hotelId: req.hotelId })
            .select('_id name currentStock')
            .lean()
            .then(ings => {
              const movements = (ings as any[]).map(i => {
                const id = String(i._id);
                const delta = cancelDeltas.get(id);
                if (!delta || delta <= 0) return null;
                const resultingStock = Number(i.currentStock);
                return {
                  hotelId: req.hotelId,
                  ingredientId: id,
                  ingredientName: String(i.name),
                  type: 'sale_reversal' as const,
                  delta: +delta,
                  previousStock: resultingStock - delta,
                  resultingStock,
                  referenceId: String(existing._id),
                  referenceType: 'order' as const,
                  reason: `Order #${existing.orderNumber ?? ''} cancelled`,
                  performedBy: String((req as any).cashierId ?? (req as any).waiterId ?? ''),
                };
              }).filter(Boolean);
              if (movements.length > 0) return StockMovement.insertMany(movements);
            })
            .catch(() => {});
        }
        if (existing.guestId) {
          await Guest.findByIdAndUpdate(existing.guestId, [
            { $set: { totalAmount: { $max: [0, { $subtract: ['$totalAmount', existing.grandTotal] }] } } },
          ]);
        }

        // ── Loyalty reversal on cancellation (fire-and-forget) ──────────────────
        ;(async () => {
          try {
            const loyaltyCfg = await getLoyaltyConfig(req.hotelId!);
            if (!loyaltyCfg.enabled) return;

            const customerPhone = existing.customerPhone;
            if (!customerPhone) return;

            const cancelProfile = await CustomerProfile.findOne({
              hotelId: new mongoose.Types.ObjectId(req.hotelId),
              phone:   customerPhone,
              status:  { $ne: 'merged' },
            }).select('_id').lean();
            if (!cancelProfile) return;

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
                await reverseEarnedPoints(profileId, req.hotelId!, claimedPay.loyaltyEarnPoints, loyaltyCfg, {
                  orderId,
                  paymentId: String(claimedPay._id),
                  createdBy: req.cashierName || 'system:cancel',
                  remarks:   `Earn reversal: Order #${existing.orderNumber ?? ''} cancelled`,
                });
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
                  await reverseEarnedPoints(profileId, req.hotelId!, earnTx.points, loyaltyCfg, {
                    orderId,
                    createdBy: req.cashierName || 'system:cancel',
                    remarks:   `Earn reversal: Order #${existing.orderNumber ?? ''} cancelled`,
                  });
                }
              }
            }

            // 2. Restore redeemed points
            const redeemedPts = (existing as any).redeemedPoints ?? 0;
            if (redeemedPts > 0) {
              await earnPoints(profileId, req.hotelId!, redeemedPts, loyaltyCfg, {
                orderId,
                createdBy: req.cashierName || 'system:cancel',
                remarks:   `Redemption restored: Order #${existing.orderNumber ?? ''} cancelled`,
              });
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
      }
    }

    // Atomic completion guard — mirrors the guard on the 'cancelled' path.
    // Only the request that wins the findOneAndUpdate runs the side effects
    // (receipt print + socket emit), preventing duplicate receipts from two
    // concurrent cashier taps on the same order.
    if (status === 'completed') {
      // M13: Razorpay orders must have a verified Payment record before completion
      if (paymentMethod === 'razorpay') {
        const razorpayPmt = await Payment.findOne({
          orderId: existing._id,
          hotelId: req.hotelId,
          status: 'success',
          method: { $in: ['razorpay', 'razorpay_link'] },
        }).select('_id').lean();
        if (!razorpayPmt) {
          return res.status(400).json({ message: 'Payment verification required before completing a Razorpay order.' });
        }
      }

      const VALID_PM = ['cash', 'upi', 'upi_intent', 'upi_qr', 'upi_collect', 'card', 'split', 'razorpay'];
      const completionFields: Record<string, unknown> = {
        status:      'completed',
        completedBy: req.cashierName || req.cashierId || '',
        completedAt: new Date(),
        cashierId:   req.cashierId || '',
        paymentTime: new Date(),
      };
      if (paymentMethod && VALID_PM.includes(paymentMethod)) {
        completionFields.paymentMethod = paymentMethod;
      }
      if (req.body.transactionId) completionFields.transactionId = req.body.transactionId;
      if (req.body.upiApp)        completionFields.upiApp        = req.body.upiApp;
      if (req.body.payments)      completionFields.payments      = req.body.payments;
      if (req.body.splitDetails)  completionFields.splitDetails  = req.body.splitDetails;

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
              phone,
              status:  { $ne: 'merged' },
            }).select('_id loyaltyOptOut').lean();
            if (!earnProfile) return;

            // lifetimeSpend is incremented once per completed order (gated by claimedOrder above)
            await CustomerProfile.findByIdAndUpdate(
              (earnProfile as any)._id,
              { $inc: { lifetimeSpend: existing.grandTotal }, $set: { lastVisitAt: new Date() } },
            ).catch(() => {});

            if (!loyaltyCfg.enabled || (earnProfile as any).loyaltyOptOut) return;

            const pts = calculateEarnedPoints(existing.grandTotal, loyaltyCfg);
            if (pts <= 0) return;

            await earnPoints(
              (earnProfile as any)._id,
              req.hotelId!,
              pts,
              loyaltyCfg,
              { orderId: String(existing._id), createdBy: req.cashierName || 'system:order_complete' },
            );
          } catch (e) {
            logger.warn('[loyalty] order completion earn failed', { orderId: String(existing._id), err: String(e) });
          }
        })();
      }

      return res.json(orderForResponse);
    }

    existing.status = status;
    if (status === 'served') {
      existing.servedBy = req.waiterName || req.waiterId || '';
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
    sendError(res, 400, 'Invalid data', error);
  }
});

// PATCH /:id/payment — cashier-safe endpoint to save payment method / split details / tip
// C3: replaces the admin-only PUT /:id for the specific fields cashiers need to update.
// M5: validates that split payment amounts sum to grandTotal.
router.patch('/:id/payment', requireCashierOrAdmin, async (req: AuthRequest, res: Response) => {
  const { paymentMethod, splitDetails, tipAmount, additionalDiscount } = req.body;
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
    if (splitDetails && Array.isArray(splitDetails) && splitDetails.length > 0) {
      // M5: reject if split amounts don't add up (within ±1 rupee for floating point)
      const splitTotal = splitDetails.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
      if (Math.abs(splitTotal - order.grandTotal) > 1) {
        return res.status(400).json({
          message: `Split payment total (${splitTotal.toFixed(2)}) must equal order total (${order.grandTotal.toFixed(2)})`,
        });
      }
      update.splitDetails = splitDetails;
    }
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
    }
    if (additionalDiscount != null && Number(additionalDiscount) > 0) {
      // RBAC: only admins may apply an additional discount (Gap 1 — discount gate)
      if (req.role !== 'admin') {
        return res.status(403).json({ message: 'Only admins can apply discounts.' });
      }
      const addDisc = Math.min(Number(additionalDiscount), order.grandTotal);
      update.additionalDiscount = addDisc;
      update.grandTotal = Math.max(0, Math.round((order.grandTotal - addDisc) * 100) / 100);
    }

    const updated = await Order.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      { $set: update },
      { new: true },
    );
    if (!updated) return res.status(404).json({ message: 'Order not found' });

    logAudit(req, 'order.payment_updated', 'order', String(updated._id), {
      paymentMethod, splitDetails: splitDetails?.length, tipAmount, additionalDiscount,
    });
    res.json(updated);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

export default router;
