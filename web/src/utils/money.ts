// Phase 5 · Batch 3 (3A) — one money formatter for the POS. Exact paise, always two decimals,
// Indian digit grouping (₹1,23,456.78). Owner rule: no silent rounding on screen — what the
// cashier sees is exactly what is billed, stored and reported (₹574.80 stays ₹574.80).
// The app has no cash rounding; if it is ever added it must be shown as its own line.

const fmt = (n: number) =>
  (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,234.50 (negative amounts keep their minus sign). */
export function formatMoney(sym: string, n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v < 0 ? `-${sym}${fmt(-v)}` : `${sym}${fmt(v)}`;
}

/** ₹1,234.50 without a sign (for labels that already say "change", "short", …). */
export function formatMoneyAbs(sym: string, n: number): string {
  return `${sym}${fmt(Math.abs(Number(n) || 0))}`;
}

/** +₹10.00 / −₹10.00 / ₹0.00 */
export function formatMoneySigned(sym: string, n: number, minus = '-'): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  if (v < 0) return `${minus}${sym}${fmt(-v)}`;
  if (v > 0) return `+${sym}${fmt(v)}`;
  return `${sym}${fmt(0)}`;
}
