import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order';
import Payment from '../models/Payment';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import GatewayFactory from '../services/payment/GatewayFactory';

const router = Router();

// No auth middleware — these routes are public (QR customer flow).
// Security: hotelId is validated via DB lookup, orderId must belong to that hotel.

function generateTxnId(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TXN-${ts}-${rand}`;
}

// ── GET /api/public/payments/gateway/:hotelId ─────────────────────────────────
// Returns active gateway type for the QR ordering flow (no secrets exposed).

router.get('/gateway/:hotelId', async (req: Request, res: Response) => {
  const { hotelId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(hotelId)) {
    return res.status(400).json({ message: 'Invalid hotelId' });
  }
  try {
    const config = await PaymentGatewayConfig.findOne({
      hotelId:   new mongoose.Types.ObjectId(hotelId),
      isActive:  true,
      isDeleted: false,
    }).lean();

    if (!config) return res.json({ active: false });

    return res.json({
      active:       true,
      gatewayType:  config.gatewayType,
      isIntegrated: GatewayFactory.isRegistered(
        config.gatewayType as Parameters<typeof GatewayFactory.isRegistered>[0],
      ),
      displayName: config.displayName,
    });
  } catch {
    return res.status(500).json({ message: 'Failed to fetch gateway info' });
  }
});

// ── POST /api/public/payments/razorpay-order ──────────────────────────────────
// Creates a Razorpay order so the customer's phone can open the checkout modal.
// The public order must already exist (created by POST /api/public/orders).

router.post('/razorpay-order', async (req: Request, res: Response) => {
  const {
    hotelId, orderId, amount,
    currency = 'INR', customerName,
  } = req.body as {
    hotelId:       string;
    orderId:       string;
    amount:        number;
    currency?:     string;
    customerName?: string;
  };

  if (!hotelId || !orderId || !amount || amount <= 0) {
    return res.status(400).json({ message: 'hotelId, orderId, and amount (> 0) are required' });
  }
  if (!mongoose.Types.ObjectId.isValid(hotelId) || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ message: 'Invalid hotelId or orderId' });
  }

  try {
    // Validate order belongs to this hotel
    const order = await Order.findOne({ _id: orderId, hotelId });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const config = await PaymentGatewayConfig.findOne({
      hotelId:   new mongoose.Types.ObjectId(hotelId),
      isActive:  true,
      isDeleted: false,
    });
    if (!config) {
      return res.status(422).json({ message: 'No active payment gateway configured for this hotel.' });
    }
    if (!GatewayFactory.isRegistered(config.gatewayType as Parameters<typeof GatewayFactory.isRegistered>[0])) {
      return res.status(422).json({ message: `Gateway '${config.gatewayType}' SDK is not integrated.` });
    }

    const internalTransactionId = generateTxnId();
    const amountPaise           = Math.round(amount * 100);

    const payment = await Payment.create({
      hotelId:               new mongoose.Types.ObjectId(hotelId),
      orderId:               new mongoose.Types.ObjectId(orderId),
      internalTransactionId,
      gatewayType:           config.gatewayType,
      status:                'pending',
      amount:                amountPaise,
      currency:              currency.toUpperCase(),
      initiatedBy:           'customer-qr',
    });

    const gateway = GatewayFactory.create(config);
    const result  = await gateway.createPayment({
      amount:                amountPaise,
      currency,
      orderId,
      hotelId,
      internalTransactionId,
      customerName,
      description: `Order ${order.orderNumber}`,
    });

    payment.gatewayTransactionId = result.gatewayTransactionId;
    payment.gatewayOrderId       = result.gatewayOrderId ?? '';
    payment.status               = 'processing';
    await payment.save();

    const meta = result.metadata as Record<string, unknown> | undefined;

    return res.json({
      keyId:                 (meta?.keyId         as string | undefined) ?? '',
      razorpayOrderId:       (meta?.orderId       as string | undefined) ?? result.gatewayOrderId,
      internalTransactionId,
      amount:                amountPaise,
      currency:              currency.toUpperCase(),
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Failed to create payment: ' + (err instanceof Error ? err.message : String(err)),
    });
  }
});

export default router;
