import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Product from '../models/Product';
import Ingredient from '../models/Ingredient';
import DailyCounter from '../models/DailyCounter';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { io } from '../server';

const router = Router();

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
router.get('/reports/daily', authMiddleware, async (req: AuthRequest, res: Response) => {
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

    const empty = {
      totalSales: 0, totalTax: 0, totalDiscount: 0, totalOrders: 0, parcelOrders: 0,
      cashTotal: 0, upiTotal: 0, cardTotal: 0, splitTotal: 0,
      dineInOrders: 0, dineInTotal: 0, takeawayOrders: 0, takeawayTotal: 0,
      swiggyOrders: 0, swiggyTotal: 0, zomatoOrders: 0, zomatoTotal: 0,
      qrOrders: 0, qrTotal: 0,
    };
    const r = result || empty;

    res.json({
      date: dateStr,
      totalSales: r.totalSales,
      totalTax: r.totalTax,
      totalDiscount: r.totalDiscount,
      totalOrders: r.totalOrders,
      parcelOrders: r.parcelOrders,
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
    res.status(500).json({ message: 'Server error', error });
  }
});

// Product-wise sales report for a date
router.get('/reports/products', authMiddleware, async (req: AuthRequest, res: Response) => {
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
        totalQty:     { $sum: '$items.quantity' },
        totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
      }},
      { $sort: { totalQty: -1 } },
      { $limit: 20 },
      { $project: { _id: 0, productName: '$_id', totalQty: 1, totalRevenue: 1 } },
    ]);

    res.json({ date: dateStr, products: results });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// All remaining routes require auth
router.use(authMiddleware);

// GET /api/orders/kitchen — active orders for KDS (pending + preparing), oldest first
router.get('/kitchen', async (req: AuthRequest, res: Response) => {
  try {
    const orders = await Order.find(
      { hotelId: req.hotelId, status: { $in: ['pending', 'preparing'] } },
      { orderNumber: 1, tableNumber: 1, customerName: 1, notes: 1, status: 1, createdAt: 1,
        'items.productName': 1, 'items.quantity': 1 },
    ).sort({ createdAt: 1 }).lean();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// GET all orders
router.get('/', async (req: AuthRequest, res: Response) => {
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
    res.status(500).json({ message: 'Server error', error });
  }
});

// GET customer list — aggregated from orders (name, phone, totalOrders, totalSpent, lastOrderDate)
router.get('/customers', async (req: AuthRequest, res: Response) => {
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
    res.status(500).json({ message: 'Server error', error });
  }
});

// GET single order
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// POST create order — idempotent, deducts stock, emits socket alert
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
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

    const orderNumber = await generateOrderNumber(req.hotelId!);
    const order = new Order({ ...req.body, hotelId: req.hotelId, orderNumber });
    await order.save();

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

    io.to(`hotel_${req.hotelId}`).emit('new_order', {
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
    res.status(400).json({ message: 'Invalid data', error });
  }
});

// PATCH update order status only
router.patch('/:id/status', async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const allowed = ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  try {
    const existing = await Order.findOne({ _id: req.params.id, hotelId: req.hotelId });
    if (!existing) return res.status(404).json({ message: 'Order not found' });

    // Restore stock when cancelling a non-cancelled order
    if (status === 'cancelled' && existing.status !== 'cancelled') {
      const bulkOps = existing.items.filter(i => i.product).map(item => ({
        updateOne: {
          filter: { _id: item.product, hotelId: req.hotelId, stock: { $gte: 0 } },
          update: { $inc: { stock: item.quantity }, $set: { isAvailable: true } },
        },
      }));
      if (bulkOps.length > 0) await Product.bulkWrite(bulkOps as any);
      await applyIngredientStockChange(existing.items, req.hotelId!, 1);
    }

    existing.status = status;
    await existing.save();

    io.to(`hotel_${req.hotelId}`).emit('order_status_update', {
      orderId: existing._id,
      orderNumber: existing.orderNumber,
      status: existing.status,
    });

    res.json(existing);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// PUT update order status
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(400).json({ message: 'Invalid data', error });
  }
});

export default router;
