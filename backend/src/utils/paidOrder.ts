/**
 * Orders that count as sales: billed (status 'completed'), or paid ahead and still
 * being prepared (paymentTime set). Unpaid open orders are not sales yet; their
 * paymentMethod is only the counter's default ('cash').
 *
 * Spread into a $match together with `status: { $ne: 'cancelled' }`.
 * Use for money figures only. Stock consumption, kitchen and popularity counts
 * should keep counting every non-cancelled order.
 */
export const PAID_ORDER = { $or: [{ status: 'completed' }, { paymentTime: { $ne: null } }] };
