import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Payment from '../models/Payment';
import Order   from '../models/Order';
import GiftVoucher from '../models/GiftVoucher';
import CustomerProfile from '../models/CustomerProfile';
import PaymentGatewayConfig from '../models/PaymentGatewayConfig';
import GatewayFactory from '../services/payment/GatewayFactory';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { getLoyaltyConfig, calculateEarnedPoints, earnPoints, reverseEarnedPoints } from '../utils/loyaltyUtils';
import { io } from '../server';
import { scheduleKOTPrint } from '../utils/printUtils';

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

    // Reject outright if no webhook secret is configured — verifying with an empty
    // secret is insecure (HMAC with empty key is deterministic and forgeable).
    if (!config.webhookSecretEnc) {
      logger.warn(`[Webhook] Webhook secret not configured — gateway: ${gateway}, hotel: ${hotelId}. Add it in Payment Settings.`);
      return res.status(401).json({ message: 'Webhook secret not configured for this gateway.' });
    }

    // Decrypt webhook secret — pass explicitly to verifyWebhook; the gateway instance
    // is only used for the signature helper, not for any live API calls here.
    const webhookSecret = decrypt(config.webhookSecretEnc);
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

    // payment.authorized fires before capture in Razorpay's two-step flow.
    // We store the gatewayTransactionId so subsequent lookups by txnId work even
    // before payment.captured arrives. Status stays 'processing'.
    case 'payment.authorized': {
      const gatewayTxnId = String(payEntity?.id ?? '');
      if (!gatewayTxnId) return;
      const razorOrderId = String(payEntity?.order_id ?? '');
      if (!razorOrderId) return;
      const pay = await Payment.findOne({ gatewayOrderId: razorOrderId, hotelId });
      if (!pay || pay.gatewayTransactionId) return; // already has txnId or not found
      pay.gatewayTransactionId = gatewayTxnId;
      pay.webhookData          = event;
      await pay.save();
      logger.info(`[Webhook] payment.authorized → ${pay.internalTransactionId}`);
      break;
    }

    case 'payment.captured':
    case 'order.paid': {
      const gatewayTxnId = String(payEntity?.id ?? (ordEntity as any)?.payment_id ?? '');
      if (!gatewayTxnId) return;

      // Try by gatewayTransactionId first, then fall back to gatewayOrderId.
      // Both must be scoped to the webhook's hotelId — no cross-tenant lookup.
      let pay = await Payment.findOne({ gatewayTransactionId: gatewayTxnId, hotelId });
      if (!pay) {
        const razorOrderId = String(payEntity?.order_id ?? ordEntity?.id ?? '');
        if (razorOrderId) {
          pay = await Payment.findOne({ gatewayOrderId: razorOrderId, hotelId });
        }
      }
      if (!pay) return;

      // Idempotency: already marked success — do not re-process.
      if (pay.status === 'success') return;

      pay.gatewayTransactionId = gatewayTxnId;
      pay.status               = 'success';
      pay.settlementStatus     = 'pending';
      pay.webhookData          = event;
      const method = String((payEntity as any)?.method ?? '');
      if (method) pay.paymentMethod = mapRazorpayMethod(method);
      await pay.save();

      // Update the associated Order's payment timestamp and transaction reference.
      // Non-fatal: Payment is the source of truth; Order update is for UX convenience.
      await Order.findByIdAndUpdate(pay.orderId, {
        $set: { transactionId: gatewayTxnId, paymentTime: new Date() },
      }).catch((e: unknown) => {
        logger.warn(`[Webhook] Order update failed after payment.captured (non-fatal)`, {
          paymentId: String(pay._id),
          err:       String(e),
        });
      });

      // Release QR payment-pending orders — atomic, idempotent (only the first caller wins).
      // qr-verify may have already released the order; in that case this is a no-op.
      const qrReleased = await Order.findOneAndUpdate(
        { _id: pay.orderId, hotelId, status: 'payment_pending' },
        { $set: { status: 'pending' } },
        { new: true },
      ).catch(() => null);
      if (qrReleased) {
        try {
          io.to(`hotel_${hotelId}`).emit('new_order', {
            _id:           qrReleased._id.toString(),
            orderNumber:   qrReleased.orderNumber,
            tableNumber:   qrReleased.tableNumber,
            customerName:  qrReleased.customerName,
            customerPhone: qrReleased.customerPhone,
            grandTotal:    qrReleased.grandTotal,
            itemCount:     qrReleased.items.length,
            orderSource:   qrReleased.orderSource,
            items:         qrReleased.items.map((i: any) => ({
              productName: i.productName,
              quantity:    i.quantity,
              price:       i.price,
            })),
          });
        } catch {}
        scheduleKOTPrint(hotelId, {
          _id:          qrReleased._id,
          orderNumber:  qrReleased.orderNumber,
          tableNumber:  qrReleased.tableNumber,
          customerName: qrReleased.customerName,
          items:        qrReleased.items as { productName: string; quantity: number }[],
          notes:        qrReleased.notes,
          orderSource:  qrReleased.orderSource,
          createdAt:    qrReleased.createdAt,
          sessionId:    qrReleased.sessionId ?? undefined,
          guestId:      qrReleased.guestId ?? undefined,
        }).catch(() => {});
        logger.info(`[Webhook] QR payment_pending order released → ${qrReleased.orderNumber}`);
      }

      // Loyalty earn — atomic claim prevents double-earn with concurrent verify
      ;(async () => {
        try {
          // Atomic claim: only the first caller (webhook OR verify) wins.
          // findOneAndUpdate returns the OLD doc; null means slot already taken.
          const claimed = await Payment.findOneAndUpdate(
            { _id: pay._id, hotelId, loyaltyEarnedAt: null },
            { $set: { loyaltyEarnedAt: new Date() } },
          );
          if (!claimed) return; // verify already claimed the earn slot

          const order = await Order.findById(pay.orderId).lean();
          if (!order) return;
          const customerPhone: string | undefined = (order as any).customerPhone;
          if (!customerPhone) return;

          const loyaltyCfg = await getLoyaltyConfig(hotelId);
          if (!loyaltyCfg.enabled) return;

          const profile = await CustomerProfile.findOne({
            hotelId: new mongoose.Types.ObjectId(hotelId),
            phone:   customerPhone,
            status:  'active',
            loyaltyOptOut: { $ne: true },
          }).select('_id').lean();
          if (!profile) return;

          const billAmount = (order as any).grandTotal ?? (pay.amount / 100);
          const pts = calculateEarnedPoints(billAmount, loyaltyCfg);
          if (pts <= 0) return;

          await earnPoints(
            (profile as any)._id,
            hotelId,
            pts,
            loyaltyCfg,
            {
              orderId:   String(pay.orderId),
              paymentId: String(pay._id),
              createdBy: 'system:webhook',
            },
          );

          // Stamp loyaltyEarnPoints (loyaltyEarnedAt already set by the atomic claim above)
          await Payment.updateOne(
            { _id: pay._id },
            { $set: { loyaltyEarnPoints: pts } },
          );
        } catch (e) {
          logger.warn(`[Webhook] loyalty earn failed`, { paymentId: String(pay._id), err: String(e) });
        }
      })();

      logger.info(`[Webhook] payment.captured → ${pay.internalTransactionId}`);
      break;
    }

    case 'payment.failed': {
      const gatewayTxnId = String(payEntity?.id ?? '');
      if (!gatewayTxnId) return;
      const pay = await Payment.findOne({ gatewayTransactionId: gatewayTxnId, hotelId })
        ?? await Payment.findOne({ gatewayOrderId: String(payEntity?.order_id ?? ''), hotelId });
      if (!pay) return;

      // Idempotency: already in a terminal state — do not overwrite.
      if (['failed', 'cancelled', 'refunded', 'success'].includes(pay.status)) return;

      pay.status        = 'failed';
      pay.failureReason = String(payEntity?.error_description ?? payEntity?.error_reason ?? 'Payment failed');
      pay.webhookData   = event;
      await pay.save();
      logger.info(`[Webhook] payment.failed → ${pay.internalTransactionId}`);
      break;
    }

    case 'refund.processed':
    case 'refund.created': {
      const refundId  = String(refEntity?.id         ?? '');
      const paymentId = String(refEntity?.payment_id ?? '');
      const refundAmt = Number(refEntity?.amount      ?? 0);
      if (!paymentId) return;

      const pay = await Payment.findOne({ gatewayTransactionId: paymentId, hotelId });
      if (!pay) return;

      // Idempotency: only add the refund entry once per refundId.
      if (refundId && !pay.refunds.some(r => r.refundId === refundId)) {
        pay.refunds.push({
          refundId,
          amount:                 refundAmt,
          reason:                 'webhook',
          initiatedBy:            'razorpay-webhook',
          refundedAt:             new Date(),
          gatewayResponse:        refEntity,
          loyaltyReversedAt:      null,
          giftVoucherRestoredAt:  null,
        });
        pay.refundedAmount += refundAmt;
        pay.refundStatus    = pay.refundedAmount >= pay.amount ? 'full'     : 'partial';
        pay.status          = pay.refundedAmount >= pay.amount ? 'refunded' : 'partial_refunded';
      }
      pay.webhookData = event;
      await pay.save();
      logger.info(`[Webhook] refund.processed → ${pay.internalTransactionId}, refundId: ${refundId}`);

      // Fire-and-forget loyalty reversal — per-refund atomic guard prevents double-reversal on retry
      ;(async () => {
        try {
          if (!refundId || pay.loyaltyEarnPoints <= 0) return;

          // Atomic per-refund claim via arrayFilters — returns null if already claimed
          const claimedPay = await Payment.findOneAndUpdate(
            { _id: pay._id, hotelId, refunds: { $elemMatch: { refundId, loyaltyReversedAt: null } } },
            { $set: { 'refunds.$[ref].loyaltyReversedAt': new Date() } },
            { arrayFilters: [{ 'ref.refundId': refundId, 'ref.loyaltyReversedAt': null }], new: false },
          );
          if (!claimedPay) return;

          const ptsToReverse = Math.min(
            pay.loyaltyEarnPoints,
            Math.floor(pay.loyaltyEarnPoints * refundAmt / pay.amount),
          );
          if (ptsToReverse <= 0) return;

          const order = await Order.findById(pay.orderId).lean();
          const customerPhone: string | undefined = (order as any)?.customerPhone;
          if (!customerPhone) return;

          const loyaltyCfg = await getLoyaltyConfig(hotelId);
          if (!loyaltyCfg.enabled) return;

          const profile = await CustomerProfile.findOne({
            hotelId: new mongoose.Types.ObjectId(hotelId),
            phone:   customerPhone,
            status:  { $ne: 'merged' },
          }).select('_id').lean();
          if (!profile) return;

          await reverseEarnedPoints(
            (profile as any)._id,
            hotelId,
            ptsToReverse,
            loyaltyCfg,
            {
              orderId:   String(pay.orderId),
              paymentId: String(pay._id),
              createdBy: 'system:refund-webhook',
            },
          );

          // Full refund: stamp top-level loyaltyReversedAt so the cancellation path skips re-reversal
          if (pay.refundedAmount >= pay.amount) {
            await Payment.findOneAndUpdate(
              { _id: pay._id, loyaltyReversedAt: null },
              { $set: { loyaltyReversedAt: new Date() } },
            );
          }
        } catch (e) {
          logger.warn(`[Webhook] loyalty reversal failed`, { paymentId: String(pay._id), err: String(e) });
        }
      })();

      // Gift voucher restoration on full refund (fire-and-forget, idempotent via giftVoucherRestoredAt)
      if (pay.refundedAmount >= pay.amount) {
        ;(async () => {
          try {
            const orderForVoucher = await Order.findOne({ _id: pay.orderId, hotelId })
              .select('giftVoucherId giftVoucherAmount giftVoucherRestoredAt orderNumber').lean();
            const vAmt = (orderForVoucher as any)?.giftVoucherAmount as number | undefined;
            if (!orderForVoucher || !(orderForVoucher as any).giftVoucherId || !vAmt || vAmt <= 0) return;
            if ((orderForVoucher as any).giftVoucherRestoredAt) return;
            const claimedOrder = await Order.findOneAndUpdate(
              { _id: pay.orderId, hotelId, giftVoucherRestoredAt: null },
              { $set: { giftVoucherRestoredAt: new Date() } },
            );
            if (!claimedOrder) return;
            const refNow = new Date();
            await GiftVoucher.findOneAndUpdate(
              {
                _id: (orderForVoucher as any).giftVoucherId,
                hotelId,
                transactions: { $not: { $elemMatch: { type: 'refund', orderId: pay.orderId } } },
              },
              [
                { $set: { balance: { $add: ['$balance', vAmt] }, isActive: true } },
                { $set: { transactions: { $concatArrays: [{ $ifNull: ['$transactions', []] }, [{ type: 'refund', amount: vAmt, balanceAfter: { $ifNull: ['$balance', 0] }, orderId: pay.orderId, remarks: `Full refund webhook: Payment ${String(pay._id)}`, createdBy: 'system:refund-webhook', createdAt: refNow }]] } } },
              ] as any,
            );
          } catch (e) {
            logger.warn(`[Webhook] gift-voucher restoration failed`, { paymentId: String(pay._id), err: String(e) });
          }
        })();
      }

      // Gift voucher partial restoration (fire-and-forget, idempotent via per-refund giftVoucherRestoredAt)
      if (pay.refundedAmount < pay.amount && refundId) {
        ;(async () => {
          try {
            const orderForVoucher = await Order.findOne({ _id: pay.orderId, hotelId })
              .select('giftVoucherId giftVoucherAmount giftVoucherRestoredAt').lean();
            const vAmt = (orderForVoucher as any)?.giftVoucherAmount as number | undefined;
            if (!orderForVoucher || !(orderForVoucher as any).giftVoucherId || !vAmt || vAmt <= 0) return;
            if ((orderForVoucher as any).giftVoucherRestoredAt) return;
            const restoreAmt = Math.round(vAmt * (refundAmt / pay.amount) * 100) / 100;
            if (restoreAmt <= 0) return;
            const claimedPay = await Payment.findOneAndUpdate(
              { _id: pay._id, hotelId, refunds: { $elemMatch: { refundId, giftVoucherRestoredAt: null } } },
              { $set: { 'refunds.$[rf].giftVoucherRestoredAt': new Date() } },
              { arrayFilters: [{ 'rf.refundId': refundId, 'rf.giftVoucherRestoredAt': null }], new: false },
            );
            if (!claimedPay) return;
            const refNow = new Date();
            await GiftVoucher.findOneAndUpdate(
              { _id: (orderForVoucher as any).giftVoucherId, hotelId },
              [
                { $set: { balance: { $add: ['$balance', restoreAmt] }, isActive: true } },
                { $set: { transactions: { $concatArrays: [{ $ifNull: ['$transactions', []] }, [{ type: 'refund', amount: restoreAmt, balanceAfter: { $ifNull: ['$balance', 0] }, orderId: pay.orderId, remarks: `Partial refund webhook: Payment ${String(pay._id)}`, createdBy: 'system:refund-webhook', createdAt: refNow }]] } } },
              ] as any,
            );
          } catch (e) {
            logger.warn(`[Webhook] gift-voucher partial restoration failed`, { paymentId: String(pay._id), err: String(e) });
          }
        })();
      }

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
