import { Router, Request, Response } from 'express';
import Product from '../models/Product';
import { makeRateLimiter } from '../utils/rateLimiter';
import Category from '../models/Category';
import Settings from '../models/Settings';
import Order from '../models/Order';
import Hotel from '../models/Hotel';
import DailyCounter from '../models/DailyCounter';
import mongoose from 'mongoose';
import { io } from '../server';
import { sendError } from '../utils/sendError';
import { logger } from '../utils/logger';
import { scheduleKOTPrint } from '../utils/printUtils';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import GatewayFactory from '../services/payment/GatewayFactory';

const router = Router();

// Public API rate limits — unauthenticated endpoints, per-IP
const publicReadLimiter = makeRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many requests. Please slow down.' },
});

const publicWriteLimiter = makeRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many requests. Please slow down.' },
});

// ─── Helper: resolve hotelId from query param ─────────────────────────────────
const resolveHotelId = async (hotelParam?: string): Promise<mongoose.Types.ObjectId | undefined> => {
  if (hotelParam && mongoose.Types.ObjectId.isValid(hotelParam)) {
    return new mongoose.Types.ObjectId(hotelParam);
  }
  return undefined;
};

// ─── Helper: generate order number (atomic — same counter as orderRoutes.ts) ──
const generateOrderNumber = async (hotelId: string): Promise<string> => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = `ORD-${dateStr}-${hotelId}`;
  const counter = await DailyCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    { upsert: true, new: true },
  );
  return `ORD-${dateStr}-${String(counter!.seq).padStart(3, '0')}`;
};

// GET /api/public/menu?hotel=<hotelId>
// Public menu — no auth needed, used by customer kiosk / QR menu
router.get('/menu', publicReadLimiter, async (req: Request, res: Response) => {
  try {
    const hotelId = await resolveHotelId(req.query.hotel as string | undefined);
    if (!hotelId) return res.status(400).json({ error: 'hotel param required' });

    // Return 404 for nonexistent hotels, 403 for suspended/inactive hotels
    const hotelDoc = await Hotel.findOne({ _id: hotelId }, { status: 1, features: 1 }).lean();
    if (!hotelDoc) return res.status(404).json({ error: 'Hotel not found' });
    if (!['trial', 'active'].includes((hotelDoc as any).status)) {
      return res.status(403).json({ error: 'This hotel is not currently active' });
    }

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

    const hf = (hotelDoc as any).features ?? {};
    res.json({
      hotel: {
        id:       resolvedHotelId,
        name:     settings.hotelName,
        address:  settings.address,
        phone:    settings.phone,
        currency: settings.currencySymbol,
        // QR client reads these to decide which ordering flow to use (additive; existing clients ignore unknown fields)
        features: {
          tableSessions:          Boolean(hf.tableSessions),
          customerIdentification: hf.customerIdentification ?? 'disabled',
          qrOrdering:             hf.qrOrdering !== false,
        },
      },
      categories,
      products: products.map(p => {
        const obj = (p as any).toObject ? (p as any).toObject() : { ...p };
        if (obj.imageStatus === 'placeholder') obj.image = '';
        return obj;
      }),
      bestsellerIds,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    sendError(res, 500, 'Failed to load menu', err);
  }
});

// POST /api/public/orders
// Public order placement — no auth, used by QR menu customers
router.post('/orders', publicWriteLimiter, async (req: Request, res: Response) => {
  try {
    // Accept both 'hotel' and 'hotelId' field names for backward compatibility
    const { hotel, hotelId: hotelIdField, items: clientItems, tableNumber, customerName, notes, isParcel, source, orderSource: reqOrderSource, paymentMethod: reqPaymentMethod } = req.body;
    const hotelParam = hotel || hotelIdField;

    if (!hotelParam || !mongoose.Types.ObjectId.isValid(hotelParam)) {
      return res.status(400).json({ message: 'hotel param required' });
    }
    if (!clientItems?.length) {
      return res.status(400).json({ message: 'items required' });
    }
    if (!String(customerName || '').trim()) {
      return res.status(400).json({ message: 'Customer name is required' });
    }

    // Verify hotel exists, is active, and has qrOrdering enabled
    const hotelDoc = await Hotel.findOne({ _id: hotelParam }, { status: 1, features: 1 }).lean();
    if (!hotelDoc) return res.status(404).json({ message: 'Hotel not found' });
    if (!['trial', 'active'].includes((hotelDoc as any).status)) {
      return res.status(403).json({ message: 'This hotel is not currently accepting orders' });
    }
    if ((hotelDoc as any).features?.qrOrdering === false) {
      return res.status(403).json({ code: 'FEATURE_DISABLED', message: 'QR ordering is not enabled for this hotel.' });
    }

    const hotelId = String(hotelParam);

    // Resolve orderSource from body (accepts 'orderSource' and legacy 'source' field)
    const rawSource = String(reqOrderSource || source || '');
    const orderSource: 'qr' | 'kiosk' | 'dine-in' =
      rawSource === 'kiosk' ? 'kiosk' :
      rawSource === 'dine-in' ? 'dine-in' : 'qr';

    const wantsRazorpay = String(reqPaymentMethod || '').toLowerCase() === 'razorpay';

    // QR orders are Razorpay-only — cash must be rejected before any DB work
    if (orderSource === 'qr' && !wantsRazorpay) {
      return res.status(400).json({
        code:    'CASH_NOT_ALLOWED',
        message: 'QR orders require Razorpay payment. Cash is not accepted for QR ordering.',
      });
    }

    // Idempotency guard: if the client sends an offlineId (UUID generated before the request),
    // return the existing order rather than creating a duplicate. The sparse unique index on
    // Order.offlineId is the DB-level guard; this findOne is the fast path.
    const offlineId: string | null =
      typeof req.body.offlineId === 'string' && req.body.offlineId.trim()
        ? req.body.offlineId.trim().slice(0, 64)
        : null;
    if (offlineId) {
      const dup = await Order.findOne({ offlineId, hotelId });
      if (dup) return res.status(200).json(dup);
    }

    // All items must reference a product by ObjectId so prices are always verified
    // against the server-side catalog. Items without a valid product ID are rejected.
    const productIds = clientItems
      .map((i: any) => i.product)
      .filter((id: any) => mongoose.Types.ObjectId.isValid(String(id ?? '')));
    const dbProducts = productIds.length > 0 ? await Product.find({
      _id: { $in: productIds },
      hotelId,
      isAvailable: true,
      isDeleted: { $ne: true },
    }).select('_id name price taxPercent channelPrices').lean() : [];
    const productMap: Record<string, any> = {};
    for (const p of dbProducts) productMap[(p._id as mongoose.Types.ObjectId).toString()] = p;

    let subtotal = 0;
    let taxTotal = 0;
    const validatedItems: any[] = [];

    for (const ci of clientItems) {
      if (ci.product && mongoose.Types.ObjectId.isValid(String(ci.product))) {
        // DB-verified item: price comes from our product catalog
        const prod = productMap[String(ci.product)];
        if (!prod) continue; // product not found / unavailable — skip
        const qty = Math.max(1, Math.floor(Number(ci.quantity) || 1));
        const channelPrice =
          orderSource === 'kiosk' ? ((prod as any).channelPrices?.kiosk || null) :
          orderSource === 'qr'    ? ((prod as any).channelPrices?.qr    || null) : null;
        const unitPrice = (channelPrice && channelPrice > 0) ? channelPrice : prod.price;
        const taxAmt = (unitPrice * qty * (prod.taxPercent || 0)) / 100;
        const total  = unitPrice * qty + taxAmt;
        validatedItems.push({
          product:     prod._id,
          productName: prod.name,
          quantity:    qty,
          price:       unitPrice,
          taxPercent:  prod.taxPercent || 0,
          taxAmount:   +taxAmt.toFixed(2),
          total:       +total.toFixed(2),
        });
        subtotal += unitPrice * qty;
        taxTotal += taxAmt;
      }
    }

    if (validatedItems.length === 0) {
      return res.status(400).json({ message: 'No valid items' });
    }

    // Verify Razorpay gateway is configured for orders that require it
    const isRazorpayOrder = wantsRazorpay && (orderSource === 'qr' || orderSource === 'kiosk');
    if (isRazorpayOrder) {
      const gwConfig = await PaymentGatewayConfig.findOne({
        hotelId:   new mongoose.Types.ObjectId(hotelId),
        isActive:  true,
        isDeleted: false,
      }).lean();
      if (!gwConfig || !GatewayFactory.isRegistered((gwConfig as any).gatewayType)) {
        return res.status(402).json({
          code:    'NO_PAYMENT_GATEWAY',
          message: 'Online payment is not configured for this hotel. Please pay at the counter.',
        });
      }
    }

    const orderStatus     = isRazorpayOrder ? 'payment_pending' : 'pending';
    const paymentMethodDb = isRazorpayOrder ? 'razorpay' : 'cash';

    const grandTotal = subtotal + taxTotal;
    const orderNumber = await generateOrderNumber(hotelId);
    const order = new Order({
      hotelId,
      offlineId: offlineId ?? undefined,
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
      orderSource:   orderSource,
      paymentMethod: paymentMethodDb,
      status:        orderStatus as any,
    });
    await order.save();

    // Only confirmed (cash) orders go to kitchen immediately.
    // Razorpay orders (QR or kiosk) stay as payment_pending until qr-verify releases them.
    if (orderStatus === 'pending') {
      // Fire-and-forget KOT print — never blocks the order response
      scheduleKOTPrint(hotelId, {
        _id:         order._id,
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        customerName: order.customerName,
        items:       order.items as { productName: string; quantity: number }[],
        notes:       order.notes,
        orderSource: order.orderSource,
        createdAt:   order.createdAt,
      }).catch(() => {});

      // Emit socket event so admin sees the order instantly
      try {
        if (!io) {
          logger.error('[menuRoutes] io is undefined — circular import issue');
        } else {
          const room = `hotel_${hotelId}`;
          const sockets = await io.in(room).allSockets();
          logger.info('[menuRoutes] emitting new_order', {
            room,
            clientsInRoom: sockets.size,
            socketIds:     Array.from(sockets),
          });
          io.to(room).emit('new_order', {
            _id:           order._id.toString(),
            orderNumber:   order.orderNumber,
            tableNumber:   order.tableNumber,
            customerName:  order.customerName,
            customerPhone: order.customerPhone,
            grandTotal:    order.grandTotal,
            itemCount:     order.items.length,
            orderSource:   order.orderSource,
            items:         order.items.map((i: any) => ({
              productName: i.productName,
              quantity:    i.quantity,
              price:       i.price,
            })),
          });
        }
      } catch (emitErr: any) {
        logger.error('[menuRoutes] socket emit error', { error: emitErr?.message || String(emitErr) });
      }
    }

    res.status(201).json(order);
  } catch (error: any) {
    // Two concurrent submissions of the same offlineId can race past the findOne above.
    // The sparse unique index then rejects the second insert with code 11000.
    // Return the already-saved order instead of a 400.
    if (error.code === 11000 && error.keyPattern?.offlineId) {
      try {
        const saved = await Order.findOne({
          offlineId: req.body.offlineId,
          hotelId:   String(req.body.hotel || req.body.hotelId || ''),
        });
        if (saved) return res.status(200).json(saved);
      } catch { /* fall through to generic error */ }
    }
    sendError(res, 400, error?.message || 'Invalid order data', error);
  }
});

// GET /api/public/bill?table=<tableNumber>&hotel=<hotelId>
// Returns running bill for a table (all today's non-cancelled orders)
router.get('/bill', publicReadLimiter, async (req: Request, res: Response) => {
  try {
    const { table, hotel } = req.query as { table?: string; hotel?: string };
    if (!table) return res.status(400).json({ message: 'table param required' });
    if (!hotel || !mongoose.Types.ObjectId.isValid(hotel)) {
      return res.status(400).json({ message: 'hotel param required' });
    }

    const hotelId = new mongoose.Types.ObjectId(hotel);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const filter: any = {
      hotelId,
      tableNumber: table,
      status: { $nin: ['cancelled'] },
      createdAt: { $gte: startOfDay },
    };

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
    sendError(res, 500, 'Failed to load bill', err);
  }
});

export default router;
