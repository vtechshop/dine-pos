// Mirrors backend/src/utils/counterBilling.ts and the payment ledger rule in
// backend/src/utils/paymentLedger.ts (outstandingOf) — keep them in sync.
//
// Batch 2 (2C): "owed" now means what is still OUTSTANDING on an order, not "a counter order".
// An order paid at the counter ahead of closing (/pay), closed and paid (completed), or part-paid
// is no longer (fully) owed. The old rule counted every counter order as owed, so the cashier's
// "Release Table" said "₹252 is still unpaid" after the bill was paid, and the billing drawer
// asked to collect paid-ahead orders again.

interface CounterOrder {
  status?:        string | null;
  paymentMethod?: string | null;
  grandTotal?:    number | null;
  paymentTime?:   string | Date | null;   // set once the order is fully settled
  amountSettled?: number | null;          // paid / tendered / written off so far (ledger)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isPrepaidOnline(o: CounterOrder): boolean {
  return o.paymentMethod === 'razorpay';
}

/** Settled at the counter at all (not cancelled, not awaiting / paid by online payment). */
export function isCounterOrder(o: CounterOrder): boolean {
  if (o.status === 'cancelled' || o.status === 'payment_pending') return false;
  return !isPrepaidOnline(o);
}

/** Amount still owed at the counter for this order (0 once fully settled). */
export function amountOwed(o: CounterOrder): number {
  if (!isCounterOrder(o) || o.paymentTime) return 0;
  return round2(Math.max(0, (Number(o.grandTotal) || 0) - (Number(o.amountSettled) || 0)));
}

/** Something is still owed at the counter for this order. */
export function isDueAtCounter(o: CounterOrder): boolean {
  return amountOwed(o) > 0.005;
}

/**
 * Total still owed. With `pick`, sums that field over the orders still owed (e.g. subtotal /
 * tax for display); without it, sums the outstanding amounts.
 */
export function sumDue<T extends CounterOrder>(orders: T[], pick?: (o: T) => number | null | undefined): number {
  if (!pick) return round2(orders.reduce((s, o) => s + amountOwed(o), 0));
  return orders.reduce((s, o) => s + (isDueAtCounter(o) ? Number(pick(o)) || 0 : 0), 0);
}

/** Total already paid online (released QR / kiosk-Razorpay orders). */
export function sumPaidOnline(orders: CounterOrder[]): number {
  return orders.reduce(
    (s, o) => s + (isPrepaidOnline(o) && o.status !== 'payment_pending' && o.status !== 'cancelled' ? Number(o.grandTotal) || 0 : 0),
    0,
  );
}
