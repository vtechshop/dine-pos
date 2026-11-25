import mongoose from 'mongoose';
import Order from '../models/Order';
import { logger } from './logger';

/**
 * Record a gateway refund on its order, so sales reports (which subtract
 * Order.refundAmount) see it. Refunds through /payments/:id/refund and the Razorpay
 * webhook are otherwise stored on the Payment only.
 *
 * Call once per new refund (inside the caller's idempotency check). The order's
 * refundAmount is capped at its grandTotal. Never throws: a failure is logged and the
 * refund itself stands.
 */
export async function addRefundToOrder(
  orderId: mongoose.Types.ObjectId | string,
  hotelId: mongoose.Types.ObjectId | string,
  amountPaise: number,
): Promise<void> {
  const rupees = Math.round(Number(amountPaise) || 0) / 100;
  if (!orderId || rupees <= 0) return;
  try {
    await Order.updateOne(
      { _id: orderId, hotelId },
      [{
        $set: {
          refundAmount: { $min: ['$grandTotal', { $add: [{ $ifNull: ['$refundAmount', 0] }, rupees] }] },
          refundedAt:   { $ifNull: ['$refundedAt', '$$NOW'] },
        },
      }],
    );
  } catch (err) {
    logger.error('[refund] could not record refund on order', { orderId: String(orderId), err: String(err) });
  }
}
