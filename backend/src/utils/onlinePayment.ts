import mongoose from 'mongoose';
import Payment from '../models/Payment';
import Order from '../models/Order';
import Guest from '../models/Guest';
import TableSession from '../models/TableSession';
import { logger } from './logger';
import { logAuditRaw } from './audit';

/**
 * Online (gateway) payments for orders — the single server-side rule for
 * "this order is paid online".
 *
 * An order counts as paid online ONLY when a Payment record of this hotel, for
 * this order, from an online gateway, is in status 'success', in INR, and its
 * amount matches the order total. The order's paymentMethod, transactionId or
 * any client-supplied flag is never enough on its own.
 *
 * Amount tolerance is ±₹1 (100 paise) — the same tolerance POST /api/payments/create
 * already applies when the payment is created from the order total.
 */
export const ONLINE_PAYMENT_METHOD = 'razorpay';
export const ONLINE_GATEWAY_TYPES = ['razorpay', 'razorpay_link'];
export const ONLINE_PAYMENT_CURRENCY = 'INR';
export const AMOUNT_TOLERANCE_PAISE = 100;

export type OnlinePaymentProblem =
  | 'missing'          // no online Payment record for this order
  | 'not_successful'   // only pending / processing / failed / cancelled attempts
  | 'refunded'         // payment was refunded (fully or partly) — not a clean capture
  | 'amount_mismatch'  // successful payment does not match the order total
  | 'currency_mismatch';

export interface OnlinePaymentCheck {
  verified: boolean;
  paymentId?: string;
  problem?: OnlinePaymentProblem;
}

interface OrderRef {
  _id: mongoose.Types.ObjectId | string;
  grandTotal?: number | null;
}

const PROBLEM_TEXT: Record<OnlinePaymentProblem, string> = {
  missing:           'no online payment was found',
  not_successful:    'the online payment has not succeeded',
  refunded:          'the online payment was refunded',
  amount_mismatch:   'the online payment amount does not match the order total',
  currency_mismatch: 'the online payment is not in INR',
};

export function describeOnlinePaymentProblem(p: OnlinePaymentProblem): string {
  return PROBLEM_TEXT[p];
}

function classify(order: OrderRef, payments: Array<{ _id: unknown; status: string; amount: number; currency?: string }>): OnlinePaymentCheck {
  if (payments.length === 0) return { verified: false, problem: 'missing' };
  const expectedPaise = Math.round((Number(order.grandTotal) || 0) * 100);
  const successes = payments.filter(p => p.status === 'success');
  if (successes.length === 0) {
    const refunded = payments.some(p => p.status === 'refunded' || p.status === 'partial_refunded');
    return { verified: false, problem: refunded ? 'refunded' : 'not_successful' };
  }
  const inr = successes.filter(p => String(p.currency || ONLINE_PAYMENT_CURRENCY).toUpperCase() === ONLINE_PAYMENT_CURRENCY);
  if (inr.length === 0) return { verified: false, problem: 'currency_mismatch' };
  const match = inr.find(p => Math.abs(Number(p.amount) - expectedPaise) <= AMOUNT_TOLERANCE_PAISE);
  if (!match) return { verified: false, problem: 'amount_mismatch' };
  return { verified: true, paymentId: String(match._id) };
}

/** Verifies one order against its Payment records (hotel-scoped). */
export async function verifyOnlinePayment(
  hotelId: string,
  order: OrderRef,
  session?: mongoose.ClientSession,
): Promise<OnlinePaymentCheck> {
  const payments = await Payment.find(
    {
      hotelId:     new mongoose.Types.ObjectId(hotelId),
      orderId:     new mongoose.Types.ObjectId(String(order._id)),
      gatewayType: { $in: ONLINE_GATEWAY_TYPES },
    },
    { status: 1, amount: 1, currency: 1 },
    { session },
  ).lean();
  return classify(order, payments as any[]);
}

export interface BlockingOnlineOrder {
  _id: string;
  orderNumber?: string;
  guestId?: string;
  grandTotal: number;
  reason: 'payment_pending' | OnlinePaymentProblem;
}

export interface OnlineBillingCheck {
  pending:    BlockingOnlineOrder[];   // online payment not finished (payment_pending)
  unverified: BlockingOnlineOrder[];   // marked paid online but no matching successful payment
}

/**
 * Before a guest / table is billed: every online order in scope must be resolved.
 *   • payment_pending → billing must wait (or staff cancel that order).
 *   • released online orders (paymentMethod 'razorpay') must each have a verified
 *     successful payment; otherwise they would be closed as "paid online" with no
 *     money behind them.
 * Cancelled and already-completed orders are ignored.
 */
export async function checkOnlineOrdersForBilling(
  hotelId: string,
  scope: { sessionId: unknown; guestId?: unknown },
): Promise<OnlineBillingCheck> {
  const filter: Record<string, unknown> = {
    hotelId:   new mongoose.Types.ObjectId(hotelId),
    sessionId: scope.sessionId,
    status:    { $nin: ['cancelled', 'completed'] },
    $or: [{ status: 'payment_pending' }, { paymentMethod: ONLINE_PAYMENT_METHOD }],
  };
  if (scope.guestId) filter.guestId = scope.guestId;

  const orders = await Order.find(filter, { _id: 1, orderNumber: 1, guestId: 1, status: 1, grandTotal: 1 }).lean();
  const result: OnlineBillingCheck = { pending: [], unverified: [] };
  if (orders.length === 0) return result;

  const toRow = (o: any, reason: BlockingOnlineOrder['reason']): BlockingOnlineOrder => ({
    _id: String(o._id), orderNumber: o.orderNumber, guestId: o.guestId ? String(o.guestId) : undefined,
    grandTotal: Number(o.grandTotal) || 0, reason,
  });

  const released = orders.filter(o => o.status !== 'payment_pending');
  for (const o of orders) if (o.status === 'payment_pending') result.pending.push(toRow(o, 'payment_pending'));
  if (released.length === 0) return result;

  const payments = await Payment.find(
    {
      hotelId:     new mongoose.Types.ObjectId(hotelId),
      orderId:     { $in: released.map(o => o._id) },
      gatewayType: { $in: ONLINE_GATEWAY_TYPES },
    },
    { orderId: 1, status: 1, amount: 1, currency: 1 },
  ).lean();
  const byOrder = new Map<string, any[]>();
  for (const p of payments as any[]) {
    const k = String(p.orderId);
    if (!byOrder.has(k)) byOrder.set(k, []);
    byOrder.get(k)!.push(p);
  }
  for (const o of released) {
    const check = classify(o as any, byOrder.get(String(o._id)) ?? []);
    if (!check.verified) result.unverified.push(toRow(o, check.problem!));
  }
  return result;
}

/** 409 body for a billing attempt blocked by unresolved online orders, or null. */
export function onlineBillingBlockResponse(check: OnlineBillingCheck): Record<string, unknown> | null {
  if (check.pending.length > 0) {
    const n = check.pending.length;
    return {
      code:    'ONLINE_PAYMENT_PENDING',
      message: `Cannot bill yet: ${n} online order${n > 1 ? 's are' : ' is'} still waiting for payment `
             + `(${check.pending.map(o => o.orderNumber ?? o._id).join(', ')}). `
             + 'Wait for the payment to complete, or cancel the unpaid order, then bill again.',
      pendingOnlinePayments: n,
      orders:  check.pending,
      actions: ['wait_for_payment', 'cancel_unpaid_order'],
    };
  }
  if (check.unverified.length > 0) {
    const n = check.unverified.length;
    return {
      code:    'ONLINE_PAYMENT_UNVERIFIED',
      message: `Cannot bill: ${n} order${n > 1 ? 's are' : ' is'} marked as paid online but `
             + `${n > 1 ? 'have' : 'has'} no matching successful payment `
             + `(${check.unverified.map(o => `${o.orderNumber ?? o._id}: ${describeOnlinePaymentProblem(o.reason as OnlinePaymentProblem)}`).join('; ')}). `
             + 'Change the order to a counter payment method or cancel it, then bill again.',
      unverifiedOnlinePayments: n,
      orders:  check.unverified,
      actions: ['change_payment_method', 'cancel_order'],
    };
  }
  return null;
}

/**
 * May a payment that just succeeded release this payment_pending order to the
 * kitchen? Not if its table guest was already billed / left or its table session
 * was closed — the order would be cooked and never billed. The payment itself is
 * still recorded as successful (that is what the gateway says); the order stays
 * payment_pending and is reported for reconciliation (refund or manual handling
 * under the existing refund rules).
 */
export async function canReleasePaidOrder(
  order: { hotelId: unknown; sessionId?: unknown; guestId?: unknown },
): Promise<{ ok: true } | { ok: false; reason: 'guest_closed' | 'session_closed' }> {
  if (order.guestId) {
    const g = await Guest.findOne({ _id: order.guestId, hotelId: order.hotelId }, { status: 1 }).lean();
    if (!g || (g as any).status !== 'active') return { ok: false, reason: 'guest_closed' };
  }
  if (order.sessionId) {
    const s = await TableSession.findOne({ _id: order.sessionId, hotelId: order.hotelId }, { status: 1, billingStartedAt: 1 }).lean();
    if (!s || (s as any).status !== 'open' || (s as any).billingStartedAt) return { ok: false, reason: 'session_closed' };
  }
  return { ok: true };
}

/** Is this a change that moves an order into or out of "paid online"? */
export function touchesOnlinePayment(currentMethod: unknown, nextMethod: unknown): boolean {
  if (nextMethod === undefined || nextMethod === null || nextMethod === currentMethod) return false;
  return currentMethod === ONLINE_PAYMENT_METHOD || nextMethod === ONLINE_PAYMENT_METHOD;
}

/**
 * Validates a staff change of an order's payment method to or from 'razorpay'.
 * Returns an error (status + message) or the guest-total adjustment to apply:
 *   • to 'razorpay'  — requires a verified successful payment; a table guest's
 *     amount due drops by the order total (it is now prepaid).
 *   • from 'razorpay' — refused if the order has a verified payment (money was
 *     taken online — use the refund flow) or is still payment_pending; otherwise
 *     (e.g. the staff checkout failed) allowed, and a table guest's amount due
 *     rises by the order total (it is now payable at the counter).
 */
export async function validateOnlinePaymentMethodChange(
  hotelId: string,
  order: { _id: unknown; status: string; paymentMethod?: string | null; grandTotal: number; guestId?: unknown },
  nextMethod: string,
): Promise<{ error: { status: number; message: string; code: string } } | { guestDelta: number }> {
  if (order.status === 'payment_pending') {
    return { error: { status: 400, code: 'ONLINE_PAYMENT_PENDING',
      message: 'This order is waiting for online payment. It can only be paid through the payment flow or cancelled.' } };
  }
  if (order.guestId) {
    // The guest's amount due moves with this change — only while the guest is
    // still open; a billed guest's bill must not change behind the cashier's back.
    const g = await Guest.findOne({ _id: order.guestId, hotelId }, { status: 1 }).lean();
    if (!g || (g as any).status !== 'active') {
      return { error: { status: 409, code: 'GUEST_ALREADY_BILLED',
        message: "This order's table guest is already billed. Its payment method can no longer be changed." } };
    }
  }
  const check = await verifyOnlinePayment(hotelId, order as OrderRef);
  if (nextMethod === ONLINE_PAYMENT_METHOD) {
    if (!check.verified) {
      return { error: { status: 400, code: 'ONLINE_PAYMENT_UNVERIFIED',
        message: `Cannot mark this order as paid online: ${describeOnlinePaymentProblem(check.problem!)}.` } };
    }
    return { guestDelta: order.guestId ? -order.grandTotal : 0 };
  }
  // moving away from 'razorpay'
  if (check.verified) {
    return { error: { status: 400, code: 'ONLINE_PAYMENT_CAPTURED',
      message: 'This order was paid online. Its payment method cannot be changed — use a refund instead.' } };
  }
  return { guestDelta: order.guestId ? order.grandTotal : 0 };
}

/** Applies a guest amount-due adjustment (never below 0), hotel-scoped. */
export async function adjustGuestAmountDue(hotelId: string, guestId: unknown, delta: number): Promise<void> {
  if (!guestId || !delta) return;
  await Guest.updateOne({ _id: guestId, hotelId }, [
    { $set: { totalAmount: { $max: [0, { $round: [{ $add: ['$totalAmount', delta] }, 2] }] } } },
  ]);
}

/**
 * Releases a payment_pending order to the kitchen after its online payment
 * succeeded (qr-verify, its crash-recovery branch, and the payment webhook all
 * call this). Atomic and idempotent: only the first caller flips
 * payment_pending → pending; later callers get { released: null }.
 *
 * Not released — and recorded for reconciliation instead (audit log + warning) —
 * when the order's table guest / session is already closed (late payment after
 * billing) or the order was cancelled. The Payment stays 'success' (the gateway
 * captured the money); refunds follow the existing refund flow.
 */
export async function releasePaidOnlineOrder(
  hotelId: string,
  orderId: string,
  set: Record<string, unknown>,
  source: 'qr-verify' | 'qr-verify-recovery' | 'webhook',
  paymentId?: string,
): Promise<{ released: any | null; blocked?: 'guest_closed' | 'session_closed' | 'order_cancelled' }> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const orderOId = new mongoose.Types.ObjectId(orderId);
  const order = await Order.findOne({ _id: orderOId, hotelId: hotelOId }, { status: 1, sessionId: 1, guestId: 1, orderNumber: 1, grandTotal: 1 }).lean();
  if (!order) return { released: null };

  const reconcile = (reason: 'guest_closed' | 'session_closed' | 'order_cancelled') => {
    logger.warn('[payment] online payment succeeded for an order that cannot be released — needs reconciliation', {
      hotelId, orderId, orderNumber: (order as any).orderNumber, reason, source, paymentId,
    });
    logAuditRaw({
      hotelId, actorId: `system:${source}`, actorRole: 'system',
      action: 'payment.late_success_needs_reconciliation', targetType: 'order', targetId: orderId,
      metadata: { reason, source, paymentId, orderNumber: (order as any).orderNumber, grandTotal: (order as any).grandTotal },
    });
    return { released: null, blocked: reason };
  };

  if ((order as any).status === 'cancelled') return reconcile('order_cancelled');
  if ((order as any).status !== 'payment_pending') return { released: null }; // already released (idempotent)

  const can = await canReleasePaidOrder({ hotelId: hotelOId, sessionId: (order as any).sessionId, guestId: (order as any).guestId });
  if (can.ok === false) return reconcile(can.reason);

  const released = await Order.findOneAndUpdate(
    { _id: orderOId, hotelId: hotelOId, status: 'payment_pending' },
    { $set: { ...set, status: 'pending' } },
    { new: true },
  );
  return { released };
}
