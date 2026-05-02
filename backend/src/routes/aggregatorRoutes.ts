import { Router, Request, Response } from 'express';
import Order from '../models/Order';
import Hotel from '../models/Hotel';
import { io } from '../server';

const router = Router();

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

// POST /api/aggregator/order — receive order from Swiggy/Zomato webhook
// Requires X-Webhook-Secret header matching AGGREGATOR_SECRET env var
router.post('/order', async (req: Request, res: Response) => {
  const incomingSecret = req.headers['x-webhook-secret'] as string | undefined;
  if (!incomingSecret || incomingSecret !== WEBHOOK_SECRET) {
    return res.status(401).json({ message: 'Unauthorized: invalid webhook secret' });
  }

  try {
    const { hotelId, source = 'aggregator', items, total, customerName, address, notes } = req.body;

    if (!hotelId) return res.status(400).json({ message: 'hotelId required' });

    const hotel = await Hotel.findById(hotelId);
    if (!hotel || hotel.status !== 'active') {
      return res.status(404).json({ message: 'Hotel not found or inactive' });
    }

    // Normalize aggregator items to our order item format
    const normalizedItems = (items || []).map((item: any) => ({
      product:     item.productId || null,
      productName: item.name || item.productName || 'Unknown',
      quantity:    item.quantity || 1,
      price:       item.price || 0,
      taxPercent:  item.taxPercent || 0,
      taxAmount:   item.taxAmount || 0,
      total:       (item.price || 0) * (item.quantity || 1),
    }));

    const subtotal = normalizedItems.reduce((s: number, i: any) => s + i.price * i.quantity, 0);
    const orderNumber = await generateOrderNumber(hotelId);

    const order = new Order({
      hotelId,
      orderNumber,
      items:         normalizedItems,
      subtotal,
      taxTotal:      normalizedItems.reduce((s: number, i: any) => s + i.taxAmount, 0),
      discountAmount:0,
      grandTotal:    total || subtotal,
      paymentMethod: 'upi',
      status:        'pending',
      isParcel:      true,
      customerName:  customerName || 'Online Customer',
      tableNumber:   source,
      notes:         `${source.toUpperCase()} ORDER — ${address || ''} ${notes || ''}`.trim(),
    });

    await order.save();

    // Real-time alert to hotel admin
    io.to(`hotel_${hotelId}`).emit('new_order', {
      orderNumber:  order.orderNumber,
      tableNumber:  source,
      customerName: order.customerName,
      grandTotal:   order.grandTotal,
      itemCount:    order.items.length,
      source,
    });

    res.status(201).json({ success: true, orderNumber: order.orderNumber });
  } catch (error) {
    console.error('Aggregator webhook error:', error);
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
