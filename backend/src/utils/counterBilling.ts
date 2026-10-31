/**
 * What a table guest owes at the counter.
 *
 * QR / kiosk-Razorpay orders are paid online before the kitchen sees them
 * (paymentMethod 'razorpay'). Until that payment lands they sit in
 * 'payment_pending' and are never cooked. Orders the counter has already taken
 * payment for (paymentTime set by POST /orders/:id/pay or payNow) are paid too.
 * None of these may be charged again at the counter, and cancelled orders are
 * never charged.
 *
 * Guest.totalAmount ("amount due") must only ever move by orders that pass
 * isDueAtCounter — on create, cancel, split and bill.
 */
export interface CounterBillableOrder {
  status?:        string | null;
  paymentMethod?: string | null;
  paymentTime?:   Date | string | null;
}

export function isPrepaidOnline(order: CounterBillableOrder): boolean {
  return order.paymentMethod === 'razorpay';
}

/** Paid before the bill: online, or at the counter ahead of closing the order. */
export function isPaidAhead(order: CounterBillableOrder): boolean {
  return isPrepaidOnline(order) || (order.paymentTime != null && order.status !== 'completed');
}

export function isDueAtCounter(order: CounterBillableOrder): boolean {
  if (order.status === 'cancelled' || order.status === 'payment_pending') return false;
  return !isPaidAhead(order);
}

export function amountDueAtCounter(orders: Array<CounterBillableOrder & { grandTotal?: number | null }>): number {
  const sum = orders.reduce((s, o) => s + (isDueAtCounter(o) ? Number(o.grandTotal) || 0 : 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Order updates when a guest (or a whole table) is billed at the counter.
 * - counter orders not paid yet: completed with the counter payment method
 * - orders paid ahead (online, or at the counter): completed, keeping the method
 *   they were paid with
 * - payment_pending (never paid, never cooked) and cancelled: left untouched
 */
export function counterBillingOrderUpdates(scope: Record<string, unknown>, paymentMethod: string) {
  return {
    counter: {
      filter: { ...scope, status: { $nin: ['cancelled', 'payment_pending', 'completed'] }, paymentMethod: { $ne: 'razorpay' }, paymentTime: null },
      update: { $set: { paymentMethod, status: 'completed' } },
    },
    prepaid: {
      filter: {
        ...scope, status: { $nin: ['cancelled', 'payment_pending', 'completed'] },
        $or: [{ paymentMethod: 'razorpay' }, { paymentTime: { $ne: null } }],
      },
      update: { $set: { status: 'completed' } },
    },
  };
}
