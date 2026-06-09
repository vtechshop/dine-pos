import { Router, Request, Response } from 'express';
import Order from '../models/Order';
import Hotel from '../models/Hotel';
import { io } from '../server';

const router = Router();

type OrderSourceType = 'dine-in' | 'takeaway' | 'swiggy' | 'zomato' | 'qr';

const SOURCE_MAP: Record<string, OrderSourceType> = {
  swiggy:  'swiggy',
  zomato:  'zomato',
  qr:      'qr',
  takeaway:'takeaway',
};

// Generate order number helper
const generateOrderNumber = async (hotelId: string): Promise<string> => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `AGG-${dateStr}`;
  const startOfDay = new Date(today); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay   = new Date(today); endOfDay.setHours(23, 59, 59, 999);
  const lastOrder = await Order.findOne({
    hotelId,
    orderNumber: { $regex: `^AGG-${dateStr}` },
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  }).sort({ createdAt: -1 });
  let seq = 1;
  if (lastOrder) seq = parseInt(lastOrder.orderNumber.split('-').pop() || '0') + 1;
  return `${prefix}-${String(seq).padStart(3, '0')}`;
};

const WEBHOOK_SECRET = process.env.AGGREGATOR_SECRET || 'agg-secret-changeme';

// Shared order creation logic used by all source webhooks
const createAggregatorOrder = async (
  hotelId: string,
  source: OrderSourceType,
  items: any[],
  total: number,
  customerName: string,
  address: string,
  notes: string,
) => {
  const hotel = await Hotel.findById(hotelId);
  if (!hotel || hotel.status !== 'active') {
    throw Object.assign(new Error('Hotel not found or inactive'), { statusCode: 404 });
  }

  const normalizedItems = items.map((item: any) => ({
    product:     item.productId || null,
    productName: item.name || item.productName || 'Unknown',
    quantity:    item.quantity || 1,
    price:       item.price || 0,
    taxPercent:  item.taxPercent || 0,
    taxAmount:   item.taxAmount || 0,
    total:       (item.price || 0) * (item.quantity || 1),
  }));

  const subtotal    = normalizedItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
  const taxTotal    = normalizedItems.reduce((s: number, i: any) => s + i.taxAmount, 0);
  const orderNumber = await generateOrderNumber(hotelId);
  const srcLabel    = source.charAt(0).toUpperCase() + source.slice(1);

  const order = new Order({
    hotelId,
    orderNumber,
    items:         normalizedItems,
    subtotal,
    taxTotal,
    discountAmount: 0,
    grandTotal:    total || subtotal,
    paymentMethod: 'upi',
    status:        'pending',
    orderSource:   source,
    isParcel:      true,
    customerName:  customerName || 'Online Customer',
    tableNumber:   srcLabel,
    notes:         `${srcLabel} ORDER${address ? ' — ' + address : ''}${notes ? ' | ' + notes : ''}`.trim(),
  });

  await order.save();

  io.to(`hotel_${hotelId}`).emit('new_order', {
    _id:          order._id,
    orderNumber:  order.orderNumber,
    tableNumber:  srcLabel,
    customerName: order.customerName,
    grandTotal:   order.grandTotal,
    itemCount:    order.items.length,
    orderSource:  source,
  });

  return order;
};

// POST /api/aggregator/order — generic webhook (Swiggy/Zomato/any source)
// Header: X-Webhook-Secret must match AGGREGATOR_SECRET env var
router.post('/order', async (req: Request, res: Response) => {
  const incomingSecret = req.headers['x-webhook-secret'] as string | undefined;
  if (!incomingSecret || incomingSecret !== WEBHOOK_SECRET) {
    return res.status(401).json({ message: 'Unauthorized: invalid webhook secret' });
  }

  try {
    const { hotelId, source = 'takeaway', items = [], total = 0, customerName = '', address = '', notes = '' } = req.body;
    if (!hotelId) return res.status(400).json({ message: 'hotelId required' });

    const orderSource: OrderSourceType = SOURCE_MAP[source.toLowerCase()] || 'takeaway';
    const order = await createAggregatorOrder(hotelId, orderSource, items, total, customerName, address, notes);
    res.status(201).json({ success: true, orderNumber: order.orderNumber });
  } catch (error: any) {
    console.error('Aggregator webhook error:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
  }
});

// POST /api/aggregator/swiggy — Swiggy-specific webhook
// Future: verify Swiggy HMAC signature from X-Swiggy-Signature header
router.post('/swiggy', async (req: Request, res: Response) => {
  const incomingSecret = req.headers['x-webhook-secret'] as string | undefined;
  if (!incomingSecret || incomingSecret !== WEBHOOK_SECRET) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    const { hotelId, items = [], total = 0, customerName = '', address = '', notes = '' } = req.body;
    if (!hotelId) return res.status(400).json({ message: 'hotelId required' });
    const order = await createAggregatorOrder(hotelId, 'swiggy', items, total, customerName, address, notes);
    res.status(201).json({ success: true, orderNumber: order.orderNumber, source: 'swiggy' });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
  }
});

// POST /api/aggregator/zomato — Zomato-specific webhook
// Future: verify Zomato HMAC signature from X-Zomato-Signature header
router.post('/zomato', async (req: Request, res: Response) => {
  const incomingSecret = req.headers['x-webhook-secret'] as string | undefined;
  if (!incomingSecret || incomingSecret !== WEBHOOK_SECRET) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    const { hotelId, items = [], total = 0, customerName = '', address = '', notes = '' } = req.body;
    if (!hotelId) return res.status(400).json({ message: 'hotelId required' });
    const order = await createAggregatorOrder(hotelId, 'zomato', items, total, customerName, address, notes);
    res.status(201).json({ success: true, orderNumber: order.orderNumber, source: 'zomato' });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ message: error.message || 'Server error' });
  }
});

export default router;
