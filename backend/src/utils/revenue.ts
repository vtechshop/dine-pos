import mongoose from 'mongoose';
import Order from '../models/Order';

// ── Shared money definitions for reports and shifts ──────────────────────────
//
// Rules taken from the existing code/docs (not new policy):
//   • Revenue = COMPLETED (paid/settled) orders only.
//       shiftRoutes: "Only counts completed orders so pending/preparing tickets
//       don't inflate cash"; superAdminRoutes: "Only status:'completed' orders
//       are counted — these are paid/settled orders"; GST/Tally/org-summary
//       reports already use status:'completed'.
//     Unpaid statuses (pending, payment_pending, preparing, ready, served) are
//     reported separately as "open orders", never as revenue.
//   • Complimentary bills are not revenue (UAT CSH-07: "Daily revenue report
//     total is unchanged").
//   • Refunds are reported separately and reduce net sales. They are bucketed by
//     the date the refund was issued (refundedAt) — a default pending accounting
//     confirmation (docs/decisions/2026-10-accounting-and-ordering-decisions.md).
//     GST/GSTR-1/Tally reports are NOT changed (credit-note treatment undecided).
//
// Wallet / gift-voucher treatment (policy B) and GST-after-discount (policy A)
// are deliberately untouched.

export const NON_REVENUE_PAYMENT_METHODS = ['complimentary'];

/** Spread into an Order $match to count only revenue (paid, non-comp) orders. */
export const REVENUE_FILTER = {
  status:        'completed',
  paymentMethod: { $nin: NON_REVENUE_PAYMENT_METHODS },
} as const;

/** Statuses of orders that exist but are not paid yet. */
export const OPEN_ORDER_STATUSES = ['pending', 'payment_pending', 'preparing', 'ready', 'served'];

/**
 * Cash physically received for ONE order (aggregation expression):
 *   cash  → grandTotal
 *   split → splitDetails.cash (only for split — never added for other methods)
 *   other → 0 (UPI / card / online money never enters the drawer)
 */
export const ORDER_CASH_TENDER_EXPR = {
  $switch: {
    branches: [
      { case: { $eq: ['$paymentMethod', 'cash'] },  then: '$grandTotal' },
      { case: { $eq: ['$paymentMethod', 'split'] }, then: { $ifNull: ['$splitDetails.cash', 0] } },
    ],
    default: 0,
  },
};

export const UPI_METHODS = ['upi', 'upi_intent', 'upi_qr', 'upi_collect'];

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

export interface RefundSummary { count: number; amount: number; cashAmount: number; }

/** Refunds ISSUED in [from, to] (by refundedAt). cashAmount only where refundMethod === 'cash'. */
export async function summarizeRefunds(hotelId: string, from: Date, to: Date): Promise<RefundSummary> {
  const [agg] = await Order.aggregate([
    { $match: { hotelId: new mongoose.Types.ObjectId(hotelId), refundedAt: { $gte: from, $lte: to } } },
    { $group: {
      _id: null,
      count:      { $sum: 1 },
      amount:     { $sum: { $ifNull: ['$refundAmount', 0] } },
      cashAmount: { $sum: { $cond: [{ $eq: ['$refundMethod', 'cash'] }, { $ifNull: ['$refundAmount', 0] }, 0] } },
    } },
  ]);
  return { count: agg?.count ?? 0, amount: r2(agg?.amount), cashAmount: r2(agg?.cashAmount) };
}

/** Orders created in [from, to] that are not paid yet (and not cancelled). */
export async function summarizeOpenOrders(hotelId: string, from: Date, to: Date): Promise<{ count: number; value: number }> {
  const [agg] = await Order.aggregate([
    { $match: { hotelId: new mongoose.Types.ObjectId(hotelId), status: { $in: OPEN_ORDER_STATUSES }, createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$grandTotal' } } },
  ]);
  return { count: agg?.count ?? 0, value: r2(agg?.value) };
}
