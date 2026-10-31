/**
 * "Pay before kitchen" — a per-hotel setting (Settings.payBeforeKitchen, default off).
 *
 * When on, an order that has not been paid is held in 'payment_pending': the kitchen
 * list skips it, no `new_order` is emitted and no KOT is printed. Taking payment at the
 * counter (POST /api/orders/:id/pay) records it as paid and releases it to the kitchen
 * as 'pending'. An order paid while it is being placed (payNow) goes straight to the
 * kitchen already paid.
 *
 * Online (Razorpay) orders already use 'payment_pending' for the same purpose; they are
 * told apart by paymentMethod 'razorpay' and are only ever released by a verified online
 * payment, never by the counter.
 *
 * "Paid" for an order that is not completed means paymentTime is set.
 */
import mongoose from 'mongoose';
import Settings from '../models/Settings';

export async function payBeforeKitchenEnabled(hotelId: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(hotelId)) return false;
  const s = await Settings.findOne({ hotelId: new mongoose.Types.ObjectId(hotelId) })
    .select('payBeforeKitchen').lean() as { payBeforeKitchen?: boolean } | null;
  return s?.payBeforeKitchen === true;
}

export interface HeldOrderLike {
  status?: string | null;
  paymentMethod?: string | null;
}

/** An order held at the counter until it is paid (not an online order awaiting its gateway). */
export function isHeldForCounterPayment(order: HeldOrderLike): boolean {
  return order.status === 'payment_pending' && order.paymentMethod !== 'razorpay';
}

/** Order statuses the kitchen works on. */
export const KITCHEN_STATUSES = ['pending', 'preparing', 'ready'] as const;
