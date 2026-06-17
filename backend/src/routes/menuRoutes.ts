import { Router, Request, Response } from 'express';
import Product from '../models/Product';
import Category from '../models/Category';
import Settings from '../models/Settings';
import Order from '../models/Order';
import mongoose from 'mongoose';

const router = Router();

// ─── Helper: resolve hotelId from query param ─────────────────────────────────
const resolveHotelId = async (hotelParam?: string): Promise<mongoose.Types.ObjectId | undefined> => {
  if (hotelParam && mongoose.Types.ObjectId.isValid(hotelParam)) {
    return new mongoose.Types.ObjectId(hotelParam);
  }
  return undefined;
};

// ─── Helper: generate order number ───────────────────────────────────────────
const generateOrderNumber = async (hotelId: string): Promise<string> => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ORD-${dateStr}`;
  const startOfDay = new Date(today); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay   = new Date(today); endOfDay.setHours(23, 59, 59, 999);
  const lastOrder = await Order.findOne({
    hotelId, createdAt: { $gte: startOfDay, $lte: endOfDay },
  }).sort({ createdAt: -1 });
  let seq = 1;
  if (lastOrder) seq = parseInt(lastOrder.orderNumber.split('-').pop() || '0') + 1;
  return `${prefix}-${String(seq).padStart(3, '0')}`;
};

// GET /api/public/menu?hotel=<hotelId>
// Public menu — no auth needed, used by customer kiosk / QR menu
router.get('/menu', async (req: Request, res: Response) => {
  try {
    const hotelId = await resolveHotelId(req.query.hotel as string | undefined);

    const catFilter:  any = { isActive: true, isDeleted: false };
    const prodFilter: any = { isAvailable: true, isDeleted: false };
    const settingsFilter: any = {};

    if (hotelId) {
      catFilter.hotelId    = hotelId;
      prodFilter.hotelId   = hotelId;
      settingsFilter.hotelId = hotelId;
    }

    const [categories, products, settingsDoc] = await Promise.all([
      Category.find(catFilter).sort({ sortOrder: 1 }),
      Product.find(prodFilter).select('-recipe').populate('category', 'name icon color').sort({ name: 1 }),
      Settings.findOne(settingsFilter),
    ]);

    // Top-5 bestselling product IDs by total quantity ordered (non-critical)
    let bestsellerIds: string[] = [];
    if (hotelId) {
      try {
        const bs = await Order.aggregate([
          { $match: { hotelId, status: { $ne: 'cancelled' } } },
          { $unwind: '$items' },
          { $group: { _id: '$items.product', count: { $sum: '$items.quantity' } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
        ]);
        bestsellerIds = bs.map((b: any) => b._id?.toString()).filter(Boolean);
      } catch { /* non-critical */ }
    }

    const settings = settingsDoc || { hotelName: 'My Hotel', address: '', phone: '', currencySymbol: '₹' };

    // Resolve hotelId: prefer products (always have it), fall back to settings
    const resolvedHotelId =
      (products[0] as any)?.hotelId?.toString() ||
      (settingsDoc as any)?.hotelId?.toString();

    res.json({
      hotel: {
        id:       resolvedHotelId,
        name:     settings.hotelName,
        address:  settings.address,
        phone:    settings.phone,
        currency: settings.currencySymbol,
      },
      categories,
      products,
      bestsellerIds,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

// POST /api/public/orders
// Public order placement — no auth, used by QR menu customers
router.post('/orders', async (req: Request, res: Response) => {
  try {
    const { hotel, ...body } = req.body;

    // Resolve hotelId using best available source (most reliable first)
    let hotelId: string | undefined;

    // 1. From the payload (menu response included it)
    if (hotel && mongoose.Types.ObjectId.isValid(hotel)) {
      hotelId = hotel;
    }

    // 2. Look it up from the first ordered product (always correct)
    if (!hotelId && body.items?.length > 0) {
      const firstProductId = body.items[0].product;
      if (firstProductId && mongoose.Types.ObjectId.isValid(firstProductId)) {
        const prod = await Product.findById(firstProductId).select('hotelId').lean();
        hotelId = (prod as any)?.hotelId?.toString();
      }
    }

    // 3. Last resort — first hotel in DB (single-hotel setup)
    if (!hotelId) {
      const Hotel = (await import('../models/Hotel')).default;
      const h = await Hotel.findOne({}).select('_id').lean();
      hotelId = (h as any)?._id?.toString();
    }

    if (!hotelId) {
      return res.status(400).json({ message: 'Hotel not found' });
    }

    const orderNumber = await generateOrderNumber(hotelId);
    const order = new Order({ ...body, hotelId, orderNumber });
    await order.save();

    // Emit socket event so admin sees the order instantly
    try {
      const { io } = await import('../server');
      io.to(`hotel_${hotelId}`).emit('new_order', {
        _id:          order._id,
        orderNumber:  order.orderNumber,
        tableNumber:  order.tableNumber,
        customerName: order.customerName,
        grandTotal:   order.grandTotal,
        itemCount:    order.items.length,
      });
    } catch (_) {}

    res.status(201).json(order);
  } catch (error) {
    res.status(400).json({ message: 'Invalid order data', error });
  }
});

export default router;
