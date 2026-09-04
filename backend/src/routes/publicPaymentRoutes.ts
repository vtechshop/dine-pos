import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import Order from '../models/Order';
import Payment from '../models/Payment';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import GatewayFactory from '../services/payment/GatewayFactory';
import { ensureValidOAuthConfig } from '../services/payment/razorpayTokenRefresh';
import { io } from '../server';
import { scheduleKOTPrint } from '../utils/printUtils';
import { logger } from '../utils/logger';

const router = Router();

const publicPaymentLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req: any) => `pub:pay:${ipKeyGenerator(req.ip ?? '')}`,
  skip: () => process.env.NODE_ENV === 'test',
  standardHeaders: true,
  legacyHeaders: false,
});

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

router.post('/razorpay-order', publicPaymentLimiter, async (req: Request, res: Response) => {
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

    // Enforce amount matches order total — prevents underpayment via crafted requests
    if (Math.round(amount * 100) !== Math.round((order.grandTotal || 0) * 100)) {
      return res.status(400).json({ message: 'Amount does not match order total.' });
    }

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

    // Reject duplicate payment if the order already has a confirmed successful payment.
    const existingSuccess = await Payment.findOne({
      orderId:  new mongoose.Types.ObjectId(orderId),
      hotelId:  new mongoose.Types.ObjectId(hotelId),
      status:   'success',
    });
    if (existingSuccess) {
      return res.status(409).json({ message: 'Order has already been paid.' });
    }

    const internalTransactionId = generateTxnId();
    const amountPaise           = Math.round(amount * 100);

    // Create the Payment record in 'pending' state before calling the gateway.
    // The unique partial index on (orderId, hotelId) where status IN ['pending','processing']
    // ensures two concurrent requests cannot both create a Payment — the second gets E11000.
    let payment: InstanceType<typeof Payment>;
    try {
      payment = await Payment.create({
        hotelId:               new mongoose.Types.ObjectId(hotelId),
        orderId:               new mongoose.Types.ObjectId(orderId),
        internalTransactionId,
        gatewayType:           config.gatewayType,
        status:                'pending',
        amount:                amountPaise,
        currency:              currency.toUpperCase(),
        initiatedBy:           'customer-qr',
      });
    } catch (createErr: any) {
      if (createErr?.code === 11000) {
        return res.status(409).json({ message: 'A payment is already in progress for this order.' });
      }
      throw createErr;
    }

    try {
      const effectiveConfig = config.isOAuthConnected
        ? await ensureValidOAuthConfig(config)
        : config;
      const gateway = GatewayFactory.create(effectiveConfig);
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
    } catch (gatewayErr) {
      // Mark failed so the Payment record doesn't stay stuck at 'pending'.
      payment.status        = 'failed';
      payment.failureReason = gatewayErr instanceof Error ? gatewayErr.message : String(gatewayErr);
      await payment.save().catch(() => {});
      return res.status(500).json({
        message: 'Failed to create payment: ' + (gatewayErr instanceof Error ? gatewayErr.message : String(gatewayErr)),
      });
    }
  } catch (err) {
    return res.status(500).json({
      message: 'Failed to create payment: ' + (err instanceof Error ? err.message : String(err)),
    });
  }
});

// ── POST /api/public/payments/qr-verify ──────────────────────────────────────
// Verify Razorpay payment after customer completes checkout on their phone.
// Atomically transitions the order from payment_pending → pending and emits new_order.
// Idempotent: safe if called multiple times or if webhook arrives first.

router.post('/qr-verify', publicPaymentLimiter, async (req: Request, res: Response) => {
  const {
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
    internalTransactionId,
    orderId,
    hotelId,
  } = req.body as {
    razorpay_payment_id:   string;
    razorpay_order_id:     string;
    razorpay_signature:    string;
    internalTransactionId: string;
    orderId:               string;
    hotelId:               string;
  };

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature ||
      !internalTransactionId || !orderId || !hotelId) {
    return res.status(400).json({ message: 'Missing required payment fields' });
  }
  if (!mongoose.Types.ObjectId.isValid(hotelId) || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ message: 'Invalid hotelId or orderId' });
  }

  try {
    // Find Payment by internalTransactionId scoped to hotel — prevents cross-tenant replay
    const pay = await Payment.findOne({ internalTransactionId, hotelId });
    if (!pay) return res.status(404).json({ message: 'Payment record not found' });

    // Idempotency: already verified (webhook may have arrived first, OR a prior call
    // saved pay.success but crashed before releasing the order). In the crash case
    // the order is still payment_pending — attempt release so it is not stuck forever.
    if (pay.status === 'success') {
      const recoverReleased = await Order.findOneAndUpdate(
        {
          _id:     new mongoose.Types.ObjectId(orderId),
          hotelId: new mongoose.Types.ObjectId(hotelId),
          status:  'payment_pending',
        },
        { $set: { status: 'pending', transactionId: pay.gatewayTransactionId, paymentTime: new Date() } },
        { new: true },
      );
      if (recoverReleased) {
        try {
          io.to(`hotel_${hotelId}`).emit('new_order', {
            _id:           recoverReleased._id.toString(),
            orderNumber:   recoverReleased.orderNumber,
            tableNumber:   recoverReleased.tableNumber,
            customerName:  recoverReleased.customerName,
            customerPhone: recoverReleased.customerPhone,
            grandTotal:    recoverReleased.grandTotal,
            itemCount:     recoverReleased.items.length,
            orderSource:   recoverReleased.orderSource,
            items:         recoverReleased.items.map((i: any) => ({
              productName: i.productName,
              quantity:    i.quantity,
              price:       i.price,
            })),
          });
        } catch (emitErr: any) {
          logger.warn('[qr-verify] crash-recovery socket emit failed', { orderId, error: emitErr?.message });
        }
        scheduleKOTPrint(hotelId, {
          _id:          recoverReleased._id,
          orderNumber:  recoverReleased.orderNumber,
          tableNumber:  recoverReleased.tableNumber,
          customerName: recoverReleased.customerName,
          items:        recoverReleased.items as { productName: string; quantity: number }[],
          notes:        recoverReleased.notes,
          orderSource:  recoverReleased.orderSource,
          createdAt:    recoverReleased.createdAt,
          sessionId:    recoverReleased.sessionId ?? undefined,
          guestId:      recoverReleased.guestId ?? undefined,
        }).catch(() => {});
        logger.info('[qr-verify] crash-recovery: order released', { orderId });
      }
      return res.json({ success: true });
    }

    // Validate orderId matches what the Payment record was created for
    if (pay.orderId.toString() !== orderId) {
      return res.status(422).json({ message: 'Payment does not belong to this order' });
    }

    // Load gateway config for signature verification
    const config = await PaymentGatewayConfig.findOne({
      hotelId:   new mongoose.Types.ObjectId(hotelId),
      isActive:  true,
      isDeleted: false,
    });
    if (!config) return res.status(422).json({ message: 'No active payment gateway configured' });

    const effectiveConfig = config.isOAuthConnected
      ? await ensureValidOAuthConfig(config)
      : config;
    const gateway = GatewayFactory.create(effectiveConfig);

    const result = await gateway.verifyPayment({
      gatewayTransactionId: razorpay_payment_id,
      gatewayOrderId:       razorpay_order_id,
      signature:            razorpay_signature,
    });

    if (!result.success) {
      return res.status(422).json({ message: 'Payment verification failed. Please contact staff.' });
    }

    // Mark Payment success
    pay.gatewayTransactionId = razorpay_payment_id;
    pay.status               = 'success';
    pay.settlementStatus     = 'pending';
    if (result.paymentMethod) pay.paymentMethod = result.paymentMethod;
    await pay.save();

    // Atomically release the order from payment_pending — only first caller wins
    const released = await Order.findOneAndUpdate(
      {
        _id:     new mongoose.Types.ObjectId(orderId),
        hotelId: new mongoose.Types.ObjectId(hotelId),
        status:  'payment_pending',
      },
      { $set: { status: 'pending', transactionId: razorpay_payment_id, paymentTime: new Date() } },
      { new: true },
    );

    if (released) {
      try {
        io.to(`hotel_${hotelId}`).emit('new_order', {
          _id:           released._id.toString(),
          orderNumber:   released.orderNumber,
          tableNumber:   released.tableNumber,
          customerName:  released.customerName,
          customerPhone: released.customerPhone,
          grandTotal:    released.grandTotal,
          itemCount:     released.items.length,
          orderSource:   released.orderSource,
          items:         released.items.map((i: any) => ({
            productName: i.productName,
            quantity:    i.quantity,
            price:       i.price,
          })),
        });
      } catch (emitErr: any) {
        logger.warn('[qr-verify] socket emit failed', { orderId, error: emitErr?.message });
      }
      scheduleKOTPrint(hotelId, {
        _id:          released._id,
        orderNumber:  released.orderNumber,
        tableNumber:  released.tableNumber,
        customerName: released.customerName,
        items:        released.items as { productName: string; quantity: number }[],
        notes:        released.notes,
        orderSource:  released.orderSource,
        createdAt:    released.createdAt,
        sessionId:    released.sessionId ?? undefined,
        guestId:      released.guestId ?? undefined,
      }).catch(() => {});
    }
    // else: webhook already released — still return success (idempotent)

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({
      message: 'Verification failed: ' + (err instanceof Error ? err.message : String(err)),
    });
  }
});

export default router;
