import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Payment from '../models/Payment';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import GatewayFactory from '../services/payment/GatewayFactory';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

const router = Router();

// ── POST /api/payment-webhooks/:gateway/:hotelId ──────────────────────────────
// Each hotel configures their own webhook URL that includes their hotelId.
// This makes webhook routing multi-tenant without credential sharing.
// Raw body is captured as req.rawBody by the express.json() verify hook.
// No auth middleware — webhook is authenticated via gateway signature.

router.post('/:gateway/:hotelId', async (req: Request, res: Response) => {
  const { gateway, hotelId } = req.params;
  const rawBody   = (req as Request & { rawBody?: string }).rawBody ?? '';
  const signature = (
    req.headers['x-razorpay-signature']  ??
    req.headers['x-cashfree-signature']  ??
    req.headers['x-webhook-signature']   ??
    req.headers['x-signature']           ?? ''
  ) as string;

  logger.info(`[Webhook] ${gateway} event for hotel ${hotelId}`);

  try {
    // Validate gateway type
    const supported = GatewayFactory.getSupportedTypes() as string[];
    if (!supported.includes(gateway)) {
      return res.status(400).json({ message: `Unknown gateway: ${gateway}` });
    }

    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({ message: 'Invalid hotelId in webhook URL' });
    }

    // Find the hotel's active config for this gateway
    const config = await PaymentGatewayConfig.findOne({
      hotelId:     new mongoose.Types.ObjectId(hotelId),
      gatewayType: gateway,
      isActive:    true,
      isDeleted:   false,
    });

    if (!config) {
      logger.warn(`[Webhook] No active config for gateway ${gateway} hotel ${hotelId}`);
      return res.status(200).json({ message: 'acknowledged' }); // 200 to prevent gateway retries
    }

    // SDK must be registered to verify the signature
    if (!GatewayFactory.isRegistered(gateway as Parameters<typeof GatewayFactory.isRegistered>[0])) {
      logger.warn(`[Webhook] Gateway '${gateway}' SDK not integrated. Cannot verify signature.`);
      return res.status(200).json({ message: 'acknowledged' });
    }

    // Decrypt webhook secret — GatewayFactory.create() decrypts into runtime config,
    // but we pass it explicitly to verifyWebhook so the gateway can use it directly.
    const webhookSecret = config.webhookSecretEnc ? decrypt(config.webhookSecretEnc) : '';
    const gw            = GatewayFactory.create(config);

    const isValid = gw.verifyWebhook(rawBody, signature, webhookSecret);
    if (!isValid) {
      logger.warn(`[Webhook] Invalid signature — gateway: ${gateway}, hotel: ${hotelId}`);
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }

    // Parse event body (may already be parsed by express.json middleware)
    const event   = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const eventType = String(event?.event ?? '');

    logger.info(`[Webhook] Event type: ${eventType}, hotel: ${hotelId}`);

    // ── Razorpay event handling ───────────────────────────────────────────────

    if (gateway === 'razorpay') {
      await handleRazorpayEvent(event, eventType, hotelId);
    } else {
      // Generic fallback for future gateways
      await handleGenericEvent(event, hotelId, config.hotelId.toString());
    }

    return res.status(200).json({ message: 'acknowledged' });
  } catch (err) {
    logger.error(`[Webhook] Error processing ${gateway} event: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(200).json({ message: 'acknowledged' }); // Always 200 to prevent gateway retries
  }
});

// ── Razorpay-specific event processor ────────────────────────────────────────

async function handleRazorpayEvent(event: Record<string, unknown>, eventType: string, hotelId: string): Promise<void> {
  const payload   = (event?.payload as Record<string, unknown>) ?? {};
  const payEntity = ((payload?.payment as Record<string, unknown>)?.entity as Record<string, unknown>) ?? {};
  const refEntity = ((payload?.refund  as Record<string, unknown>)?.entity as Record<string, unknown>) ?? {};
  const ordEntity = ((payload?.order   as Record<string, unknown>)?.entity as Record<string, unknown>) ?? {};

  switch (eventType) {
    case 'payment.captured':
    case 'order.paid': {
      const gatewayTxnId = String(payEntity?.id ?? (ordEntity as any)?.payment_id ?? '');
      if (!gatewayTxnId) return;

      const payment = await Payment.findOne({ gatewayTransactionId: gatewayTxnId, hotelId });
      if (!payment) {
        // Payment may have gatewayOrderId = razorpay order id; look up by order id
        const orderId = String(payEntity?.order_id ?? ordEntity?.id ?? '');
        const byOrder = orderId ? await Payment.findOne({ gatewayOrderId: orderId, hotelId }) : null;
        if (byOrder) {
          byOrder.gatewayTransactionId = gatewayTxnId;
          byOrder.status               = 'success';
          byOrder.settlementStatus     = 'pending';
          byOrder.webhookData          = event;
          const method = String((payEntity as any)?.method ?? '');
          if (method) byOrder.paymentMethod = mapRazorpayMethod(method);
          await byOrder.save();
          logger.info(`[Webhook] payment.captured → ${byOrder.internalTransactionId}`);
        }
        return;
      }
      // Update payment id from webhook (the actual razorpay_payment_id)
      payment.gatewayTransactionId = gatewayTxnId;
      payment.status               = 'success';
      payment.settlementStatus     = 'pending';
      payment.webhookData          = event;
      const method = String((payEntity as any)?.method ?? '');
      if (method) payment.paymentMethod = mapRazorpayMethod(method);
      await payment.save();
      logger.info(`[Webhook] payment.captured → ${payment.internalTransactionId}`);
      break;
    }

    case 'payment.failed': {
      const gatewayTxnId = String(payEntity?.id ?? '');
      if (!gatewayTxnId) return;
      const payment = await Payment.findOne({ gatewayTransactionId: gatewayTxnId, hotelId })
        ?? await Payment.findOne({ gatewayOrderId: String(payEntity?.order_id ?? ''), hotelId });
      if (!payment) return;
      payment.status        = 'failed';
      payment.failureReason = String(payEntity?.error_description ?? payEntity?.error_reason ?? 'Payment failed');
      payment.webhookData   = event;
      await payment.save();
      logger.info(`[Webhook] payment.failed → ${payment.internalTransactionId}`);
      break;
    }

    case 'refund.processed':
    case 'refund.created': {
      const refundId    = String(refEntity?.id        ?? '');
      const paymentId   = String(refEntity?.payment_id ?? '');
      const refundAmt   = Number(refEntity?.amount     ?? 0);
      if (!paymentId) return;

      const payment = await Payment.findOne({ gatewayTransactionId: paymentId, hotelId });
      if (!payment) return;

      // Only add refund entry if not already recorded
      const alreadyLogged = payment.refunds.some(r => r.refundId === refundId);
      if (!alreadyLogged && refundId) {
        payment.refunds.push({
          refundId,
          amount:      refundAmt,
          reason:      'webhook',
          initiatedBy: 'razorpay-webhook',
          refundedAt:  new Date(),
          gatewayResponse: refEntity,
        });
        payment.refundedAmount += refundAmt;
        payment.refundStatus    = payment.refundedAmount >= payment.amount ? 'full' : 'partial';
        payment.status          = payment.refundedAmount >= payment.amount ? 'refunded' : 'partial_refunded';
      }
      payment.webhookData = event;
      await payment.save();
      logger.info(`[Webhook] refund.processed → ${payment.internalTransactionId}, refundId: ${refundId}`);
      break;
    }

    default:
      logger.info(`[Webhook] Unhandled Razorpay event: ${eventType}`);
  }
}

// ── Generic fallback event processor ─────────────────────────────────────────

async function handleGenericEvent(event: Record<string, unknown>, hotelId: string, _configHotelId: string): Promise<void> {
  const evData = (event?.data    as Record<string, unknown>) ?? {};
  const evPay  = (evData?.payment as Record<string, unknown>) ?? {};
  const evDet  = (event?.paymentDetails as Record<string, unknown>) ?? {};

  const gatewayTransactionId = String(
    event?.payment_id ?? evPay?.id ?? evDet?.paymentId ?? '',
  );

  if (!gatewayTransactionId) return;

  const payment = await Payment.findOne({ gatewayTransactionId, hotelId });
  if (!payment) return;

  payment.webhookData = event;
  const status = String(event?.status ?? '').toUpperCase();
  if (['SUCCESS', 'PAID', 'CAPTURED'].includes(status)) {
    payment.status           = 'success';
    payment.settlementStatus = 'pending';
  } else if (['FAILED', 'FAILURE'].includes(status)) {
    payment.status        = 'failed';
    payment.failureReason = String(event?.error_description ?? '');
  }
  await payment.save();
}

// ── Helper ────────────────────────────────────────────────────────────────────

function mapRazorpayMethod(method: string): 'upi' | 'card' | 'netbanking' | 'wallet' | 'emi' | 'qr' | 'other' {
  switch (method) {
    case 'card':       return 'card';
    case 'netbanking': return 'netbanking';
    case 'wallet':     return 'wallet';
    case 'emi':        return 'emi';
    case 'upi':        return 'upi';
    default:           return 'other';
  }
}

export default router;
