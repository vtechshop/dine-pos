/**
 * Counter orders that may be completed straight from 'pending' (paid at the counter,
 * no kitchen-to-table hand-off): takeaway, and counter delivery — created from the POS
 * as an 'admin'-source parcel. Everything else must be ready or served first.
 */
export function isQuickServiceOrder(order: { orderSource?: string | null; isParcel?: boolean | null }): boolean {
  return order.orderSource === 'takeaway' || (order.orderSource === 'admin' && order.isParcel === true);
}
