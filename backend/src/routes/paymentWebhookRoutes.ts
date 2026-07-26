import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Payment from '../models/Payment';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import GatewayFactory from '../services/payment/GatewayFactory';
import { logger } from '../utils/logger';

const router = Router();

// ── POST /api/payment-webhooks/:gateway ───────────────────────────────────────
// Gateway calls this URL to notify of payment events.
// Raw body is already captured as req.rawBody by the express.json() verify hook.
// No auth middleware — webhook must be verified via gateway signature.

router.post('/:gateway', async (req: Request, res: Response) => {
  const { gateway } = req.params;
  const rawBody     = (req as Request & { rawBody?: string }).rawBody ?? '';
  const signature   = (req.headers['x-razorpay-signature'] ??
                       req.headers['x-cashfree-signature'] ??
                       req.headers['x-webhook-signature'] ??
                       req.headers['x-signature'] ?? '') as string;

  logger.info(`[Webhook] Received event from gateway: ${gateway}`);

  try {
    // Look up config by gateway type — must have webhook secret configured
    const supported = GatewayFactory.getSupportedTypes() as string[];
    if (!supported.includes(gateway)) {
      return res.status(400).json({ message: `Unknown gateway: ${gateway}` });
    }

    // Find any hotel's config for this gateway (webhooks arrive without hotelId in the path)
    // The gateway-specific implementation must identify the hotel from the payload
    const config = await PaymentGatewayConfig.findOne({ gatewayType: gateway, isActive: true, isDeleted: false });
    if (!config) {
      logger.warn(`[Webhook] No active config for gateway: ${gateway}`);
      return res.status(200).json({ message: 'acknowledged' }); // Return 200 to prevent gateway retries
    }

    // Verify webhook signature
    if (!GatewayFactory.isRegistered(gateway as Parameters<typeof GatewayFactory.isRegistered>[0])) {
      logger.warn(`[Webhook] Gateway '${gateway}' SDK not integrated. Signature cannot be verified. Event ignored.`);
      return res.status(200).json({ message: 'acknowledged' });
    }

    const gw = GatewayFactory.create(config);
    const webhookSecret = config.webhookSecretEnc; // decrypt happens inside GatewayFactory.create via runtime config

    // Verify the signature using the gateway implementation
    const isValid = gw.verifyWebhook(rawBody, signature, webhookSecret);
    if (!isValid) {
      logger.warn(`[Webhook] Invalid signature for gateway: ${gateway}`);
      return res.status(401).json({ message: 'Invalid webhook signature' });
    }

    // Parse event (structure is gateway-specific)
    const event = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
    const evData  = (event?.data  as Record<string, unknown> | undefined) ?? {};
    const evPay   = (evData?.payment as Record<string, unknown> | undefined) ?? {};
    const evDet   = (event?.paymentDetails as Record<string, unknown> | undefined) ?? {};

    // Extract gateway transaction ID from event (convention — gateway adapters must normalize this)
    const gatewayTransactionId = (
      (event?.payment_id as string | undefined) ??
      (evPay?.id         as string | undefined) ??
      (evDet?.paymentId  as string | undefined) ??
      ''
    );

    if (gatewayTransactionId) {
      const payment = await Payment.findOne({
        gatewayTransactionId,
        hotelId:     config.hotelId,
      });

      if (payment) {
        payment.webhookData = event as Record<string, unknown>;

        // Determine new status from event (gateway adapter should normalize event.status)
        const eventStatus = (event as Record<string, unknown>)?.status as string;
        if (['SUCCESS', 'PAID', 'CAPTURED', 'success', 'paid', 'captured'].includes(eventStatus)) {
          payment.status     = 'success';
          payment.settlementStatus = 'pending';
        } else if (['FAILED', 'FAILURE', 'failed'].includes(eventStatus)) {
          payment.status     = 'failed';
          payment.failureReason = String((event as Record<string, unknown>)?.error_description ?? '');
        } else if (['REFUNDED', 'refunded'].includes(eventStatus)) {
          payment.status     = 'refunded';
          payment.refundStatus = 'full';
        }

        await payment.save();
        logger.info(`[Webhook] Updated payment ${payment.internalTransactionId} → status: ${payment.status}`);
      } else {
        logger.warn(`[Webhook] No payment found for gatewayTransactionId: ${gatewayTransactionId}`);
      }
    }

    return res.status(200).json({ message: 'acknowledged' });
  } catch (err) {
    logger.error(`[Webhook] Error processing webhook from ${gateway}: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(200).json({ message: 'acknowledged' }); // Always return 200 to prevent gateway retries
  }
});

export default router;
