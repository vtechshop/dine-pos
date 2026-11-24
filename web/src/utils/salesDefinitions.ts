// Mirrors backend/src/utils/financeDefinitions.ts (Phase 5 · Batch 2, owner-approved rules):
// SALES = served or completed orders, on the time they were served / completed, valued at
// grandTotal + gift-voucher + wallet tenders. Cancelled and unserved (incl. unpaid) orders are
// not sales. Money received is reported separately as collections (server reports).

interface SaleLike {
  status?: string | null;
  grandTotal?: number | null;
  giftVoucherAmount?: number | null;
  walletAmount?: number | null;
  servedAt?: string | Date | null;
  completedAt?: string | Date | null;
  createdAt?: string | Date | null;
}

export function isSale(o: SaleLike): boolean {
  return o.status === 'served' || o.status === 'completed';
}

/** When the sale happened: served, else completed, else (old orders) created. */
export function fulfilledAt(o: SaleLike): Date {
  return new Date((o.servedAt ?? o.completedAt ?? o.createdAt) as string | Date);
}

export function saleValue(o: SaleLike): number {
  return Math.round(((Number(o.grandTotal) || 0) + (Number(o.giftVoucherAmount) || 0) + (Number(o.walletAmount) || 0)) * 100) / 100;
}
