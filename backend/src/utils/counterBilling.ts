/**
 * What a table guest owes at the counter.
 *
 * QR / kiosk-Razorpay orders are paid online before the kitchen sees them
 * (paymentMethod 'razorpay'). Until that payment lands they sit in
 * 'payment_pending' and are never cooked. Neither kind may be charged again at
 * the counter, and cancelled orders are never charged.
 *
 * Guest.totalAmount ("amount due") must only ever move by orders that pass
 * isDueAtCounter — on create, cancel, split and bill.
 */
export interface CounterBillableOrder {
  status?:        string | null;
  paymentMethod?: string | null;
}

export function isPrepaidOnline(order: CounterBillableOrder): boolean {
  return order.paymentMethod === 'razorpay';
}

export function isDueAtCounter(order: CounterBillableOrder): boolean {
  if (order.status === 'cancelled' || order.status === 'payment_pending') return false;
  return !isPrepaidOnline(order);
}

export function amountDueAtCounter(orders: Array<CounterBillableOrder & { grandTotal?: number | null }>): number {
  const sum = orders.reduce((s, o) => s + (isDueAtCounter(o) ? Number(o.grandTotal) || 0 : 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Order updates when a guest (or a whole table) is billed at the counter.
 * - counter orders: completed with the counter payment method
 * - prepaid online orders that were released to the kitchen: completed, but keep
 *   'razorpay' as their payment method
 * - payment_pending (never paid, never cooked) and cancelled: left untouched
 */
export function counterBillingOrderUpdates(scope: Record<string, unknown>, paymentMethod: string) {
  return {
    counter: {
      filter: { ...scope, status: { $nin: ['cancelled', 'payment_pending', 'completed'] }, paymentMethod: { $ne: 'razorpay' } },
      update: { $set: { paymentMethod, status: 'completed' } },
    },
    prepaid: {
      filter: { ...scope, status: { $nin: ['cancelled', 'payment_pending', 'completed'] }, paymentMethod: 'razorpay' },
      update: { $set: { status: 'completed' } },
    },
  };
}
