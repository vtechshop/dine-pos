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
    if (!hotelId) return res.status(400).json({ error: 'hotel param required' });

    const catFilter:  any = { isActive: true, isDeleted: false, hotelId };
    const prodFilter: any = { isAvailable: true, isDeleted: false, hotelId };
    const settingsFilter: any = { hotelId };

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
    const { hotel, items: clientItems, tableNumber, customerName, notes, isParcel, source } = req.body;

    if (!hotel || !mongoose.Types.ObjectId.isValid(hotel)) {
      return res.status(400).json({ message: 'hotel param required' });
    }
    if (!clientItems?.length) {
      return res.status(400).json({ message: 'items required' });
    }

    const hotelId = String(hotel);

    // Server-side price recalculation — never trust client-submitted totals
    const productIds = clientItems
      .map((i: any) => i.product)
      .filter((id: any) => mongoose.Types.ObjectId.isValid(id));
    const dbProducts = await Product.find({
      _id: { $in: productIds },
      hotelId,
      isAvailable: true,
      isDeleted: { $ne: true },
    }).select('_id name price taxPercent').lean();
    const productMap: Record<string, any> = {};
    for (const p of dbProducts) productMap[(p._id as mongoose.Types.ObjectId).toString()] = p;

    let subtotal = 0;
    let taxTotal = 0;
    const validatedItems: any[] = [];

    for (const ci of clientItems) {
      const prod = productMap[String(ci.product)];
      if (!prod) continue; // skip unknown / unavailable products
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
      return res.status(400).json({ message: 'No valid items' });
    }

    const grandTotal = subtotal + taxTotal;
    const orderNumber = await generateOrderNumber(hotelId);
    const order = new Order({
      hotelId,
      orderNumber,
      items:        validatedItems,
      subtotal:     +subtotal.toFixed(2),
      taxTotal:     +taxTotal.toFixed(2),
      discountAmount: 0,
      grandTotal:   +grandTotal.toFixed(2),
      tableNumber:  String(tableNumber || '').slice(0, 20),
      customerName: String(customerName || '').slice(0, 60),
      notes:        String(notes || '').slice(0, 200),
      isParcel:     Boolean(isParcel),
      orderSource:  source === 'dine-in' ? 'dine-in' : 'qr',
      paymentMethod: 'cash',
    });
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
  } catch (error: any) {
    console.error('Public order error:', error?.message || error);
    res.status(400).json({ message: error?.message || 'Invalid order data', error });
  }
});

// GET /api/public/bill?table=<tableNumber>&hotel=<hotelId>
// Returns running bill for a table (all today's non-cancelled orders)
router.get('/bill', async (req: Request, res: Response) => {
  try {
    const { table, hotel } = req.query as { table?: string; hotel?: string };
    if (!table) return res.status(400).json({ message: 'table param required' });

    const hotelId = await resolveHotelId(hotel);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const filter: any = {
      tableNumber: table,
      status: { $nin: ['cancelled'] },
      createdAt: { $gte: startOfDay },
    };
    if (hotelId) filter.hotelId = hotelId;

    const orders = await Order.find(filter).sort({ createdAt: 1 }).lean();

    // Merge items across all orders by (name + price) key
    const itemMap: Record<string, { productName: string; quantity: number; price: number; taxPercent: number; total: number }> = {};
    let subtotal = 0;
    let taxTotal = 0;

    for (const order of orders as any[]) {
      for (const item of order.items) {
        const key = `${item.productName}__${item.price}`;
        if (itemMap[key]) {
          itemMap[key].quantity += item.quantity;
          itemMap[key].total    += item.price * item.quantity;
        } else {
          itemMap[key] = {
            productName: item.productName,
            quantity:    item.quantity,
            price:       item.price,
            taxPercent:  item.taxPercent || 0,
            total:       item.price * item.quantity,
          };
        }
        subtotal += item.price * item.quantity;
        taxTotal += item.taxAmount || 0;
      }
    }

    res.json({
      table,
      orderCount: orders.length,
      items:      Object.values(itemMap),
      subtotal:   +subtotal.toFixed(2),
      taxTotal:   +taxTotal.toFixed(2),
      grandTotal: +(subtotal + taxTotal).toFixed(2),
      fetchedAt:  new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bill' });
  }
});

export default router;
