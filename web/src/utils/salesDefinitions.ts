// Mirrors backend/src/utils/financeDefinitions.ts. Owner decision (27 Nov 2026, the rule live on main;
// it replaced the Batch 2 fulfilment basis): SALES = PAID orders — completed, or paid ahead
// (paymentTime set) — never cancelled, on the time they were created, valued at the bill less any
// refund. Money received is reported separately as collections (server reports).

interface SaleLike {
  status?: string | null;
  grandTotal?: number | null;
  refundAmount?: number | null;
  paymentTime?: string | Date | null;
  createdAt?: string | Date | null;
}

export function isSale(o: SaleLike): boolean {
  if (o.status === 'cancelled') return false;
  return o.status === 'completed' || !!o.paymentTime;
}

/** When the sale counts: the time the order was created. */
export function saleTime(o: SaleLike): Date {
  return new Date(o.createdAt as string | Date);
}

/** Sale value: the bill less any refund, to the paisa. */
export function saleValue(o: SaleLike): number {
  return Math.round(((Number(o.grandTotal) || 0) - (Number(o.refundAmount) || 0)) * 100) / 100;
}
