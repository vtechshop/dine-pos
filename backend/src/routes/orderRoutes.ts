import { Router, Response } from 'express';
import Order from '../models/Order';
import Product from '../models/Product';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { io } from '../server';

const router = Router();

// Helper: Generate order number like ORD-20260310-001 (per hotel)
const generateOrderNumber = async (hotelId: string): Promise<string> => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ORD-${dateStr}`;

  const startOfDay = new Date(today); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today); endOfDay.setHours(23, 59, 59, 999);

  const lastOrder = await Order.findOne({
    hotelId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  }).sort({ createdAt: -1 });

  let sequence = 1;
  if (lastOrder) {
    const lastSeq = parseInt(lastOrder.orderNumber.split('-').pop() || '0');
    sequence = lastSeq + 1;
  }

  return `${prefix}-${String(sequence).padStart(3, '0')}`;
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
        totalSales:    { $sum: '$grandTotal' },
        totalTax:      { $sum: '$taxTotal' },
        totalDiscount: { $sum: { $ifNull: ['$discountAmount', 0] } },
        totalOrders:   { $sum: 1 },
        parcelOrders:  { $sum: { $cond: ['$isParcel', 1, 0] } },
        cashTotal:     { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash']  }, '$grandTotal', 0] } },
        upiTotal:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'upi']   }, '$grandTotal', 0] } },
        cardTotal:     { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card']  }, '$grandTotal', 0] } },
        splitTotal:    { $sum: { $cond: [{ $eq: ['$paymentMethod', 'split'] }, '$grandTotal', 0] } },
      }},
    ]);

    const empty = { totalSales: 0, totalTax: 0, totalDiscount: 0, totalOrders: 0, parcelOrders: 0, cashTotal: 0, upiTotal: 0, cardTotal: 0, splitTotal: 0 };
    const r = result || empty;

    res.json({
      date: dateStr,
      totalSales: r.totalSales,
      totalTax: r.totalTax,
      totalDiscount: r.totalDiscount,
      totalOrders: r.totalOrders,
      parcelOrders: r.parcelOrders,
      paymentBreakdown: { cash: r.cashTotal, upi: r.upiTotal, card: r.cardTotal, split: r.splitTotal },
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

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), 200);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, total, page, pages: Math.ceil(total / limit) });
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

// POST create order — deducts stock, emits socket alert
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const orderNumber = await generateOrderNumber(req.hotelId!);
    const order = new Order({ ...req.body, hotelId: req.hotelId, orderNumber });
    await order.save();

    // Auto-deduct stock for tracked products (stock > 0, -1 = unlimited)
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

    io.to(`hotel_${req.hotelId}`).emit('new_order', {
      _id: order._id,
      orderNumber: order.orderNumber,
      tableNumber: order.tableNumber,
      customerName: order.customerName,
      grandTotal: order.grandTotal,
      itemCount: order.items.length,
    });

    res.status(201).json(order);
  } catch (error) {
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
