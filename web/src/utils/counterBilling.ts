// Mirrors backend/src/utils/counterBilling.ts — keep the two in sync.
// A table guest owes at the counter only for orders that aren't cancelled,
// aren't still awaiting an online payment, and weren't already paid online.

interface CounterOrder {
  status?:        string | null;
  paymentMethod?: string | null;
  grandTotal?:    number | null;
}

export function isPrepaidOnline(o: CounterOrder): boolean {
  return o.paymentMethod === 'razorpay';
}

export function isDueAtCounter(o: CounterOrder): boolean {
  if (o.status === 'cancelled' || o.status === 'payment_pending') return false;
  return !isPrepaidOnline(o);
}

export function sumDue<T extends CounterOrder>(orders: T[], pick: (o: T) => number | null | undefined = o => o.grandTotal): number {
  return orders.reduce((s, o) => s + (isDueAtCounter(o) ? Number(pick(o)) || 0 : 0), 0);
}

/** Total already paid online (released QR / kiosk-Razorpay orders). */
export function sumPaidOnline(orders: CounterOrder[]): number {
  return orders.reduce(
    (s, o) => s + (isPrepaidOnline(o) && o.status !== 'payment_pending' && o.status !== 'cancelled' ? Number(o.grandTotal) || 0 : 0),
    0,
  );
}
