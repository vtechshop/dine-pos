import mongoose from 'mongoose';
import Order from '../models/Order';
import Guest from '../models/Guest';
import TableSession from '../models/TableSession';
import { REVENUE_FILTER, UPI_METHODS, summarizeRefunds, RefundSummary } from './revenue';

// Shift totals = money actually taken during the shift window.
//
// Sources (each payment counted exactly once):
//   1. Orders paid directly at the POS (not settled via guest/table billing):
//      bucketed by completedAt (payment time); legacy orders without completedAt
//      fall back to createdAt. Cash = cash → grandTotal, split → splitDetails.cash.
//   2. Individual guest bills: Guest.collectedAmount / cashCollected recorded at
//      billing (net of loyalty, voucher and verified online prepayment).
//   3. Table bulk bills: TableSession.collectedAmount / cashCollected.
// Orders settled through 2/3 carry settledVia:'guest'|'session' and are excluded
// from 1, so a guest-billed order is never counted twice. Online (Razorpay)
// payments are reported but never enter the cash drawer.
//
// Refunds: reported (refunds.cashAmount = refunds recorded with refundMethod
// 'cash'). They are NOT auto-subtracted from expected cash: today cash refunds
// are recorded as a manual cash-out ("Refund to customer"), and subtracting both
// would double-count. Whether to switch to automatic subtraction is an open
// decision (docs/decisions/2026-10-accounting-and-ordering-decisions.md).

export interface ShiftTotals {
  totalOrders:    number;
  totalSales:     number;
  cashSales:      number;   // cash-method payments
  splitCashSales: number;   // cash share of split payments
  upiSales:       number;
  cardSales:      number;
  onlineSales:    number;   // verified gateway (Razorpay) payments — not in drawer
  otherSales:     number;
  refunds:        RefundSummary;
}

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

export async function computeShiftTotals(
  hotelId: string, from: Date, to: Date, session?: mongoose.ClientSession,
): Promise<ShiftTotals> {
  const hid = new mongoose.Types.ObjectId(hotelId);

  const ordersAgg = Order.aggregate([
    { $match: {
      hotelId: hid,
      ...REVENUE_FILTER,
      settledVia: { $nin: ['guest', 'session'] },
      $or: [
        { completedAt: { $gte: from, $lte: to } },
        { completedAt: null, createdAt: { $gte: from, $lte: to } },
      ],
    } },
    { $group: {
      _id: null,
      totalOrders:    { $sum: 1 },
      totalSales:     { $sum: '$grandTotal' },
      cashSales:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$grandTotal', 0] } },
      splitCashSales: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'split'] }, { $ifNull: ['$splitDetails.cash', 0] }, 0] } },
      upiSales:       { $sum: { $cond: [{ $in: ['$paymentMethod', UPI_METHODS] }, '$grandTotal', 0] } },
      splitUpi:       { $sum: { $cond: [{ $eq: ['$paymentMethod', 'split'] }, { $ifNull: ['$splitDetails.upi', 0] }, 0] } },
      cardSales:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'card'] }, '$grandTotal', 0] } },
      splitCard:      { $sum: { $cond: [{ $eq: ['$paymentMethod', 'split'] }, { $ifNull: ['$splitDetails.card', 0] }, 0] } },
      onlineSales:    { $sum: { $cond: [{ $eq: ['$paymentMethod', 'razorpay'] }, '$grandTotal', 0] } },
    } },
  ]);
  if (session) ordersAgg.session(session);

  // Guest / table bills record what was collected at the counter.
  const billGroup = (methodField: string, splitField: string) => ({
    _id: null,
    count:          { $sum: 1 },
    collected:      { $sum: '$collectedAmount' },
    cash:           { $sum: { $cond: [{ $eq: [methodField, 'cash'] }, '$cashCollected', 0] } },
    splitCash:      { $sum: { $cond: [{ $eq: [methodField, 'split'] }, '$cashCollected', 0] } },
    upi:            { $sum: { $cond: [{ $eq: [methodField, 'upi'] }, '$collectedAmount',
                      { $cond: [{ $eq: [methodField, 'split'] }, { $ifNull: [`${splitField}.upi`, 0] }, 0] }] } },
    card:           { $sum: { $cond: [{ $eq: [methodField, 'card'] }, '$collectedAmount',
                      { $cond: [{ $eq: [methodField, 'split'] }, { $ifNull: [`${splitField}.card`, 0] }, 0] }] } },
  });

  const guestsAgg = Guest.aggregate([
    { $match: { hotelId: hid, status: 'billed', billedAt: { $gte: from, $lte: to }, collectedAmount: { $ne: null } } },
    { $group: billGroup('$paymentMethod', '$splitDetails') },
  ]);
  const sessionsAgg = TableSession.aggregate([
    { $match: { hotelId: hid, billedAt: { $gte: from, $lte: to }, collectedAmount: { $ne: null } } },
    { $group: billGroup('$billPaymentMethod', '$billSplitDetails') },
  ]);
  if (session) { guestsAgg.session(session); sessionsAgg.session(session); }

  const [[o], [g], [s], refunds] = await Promise.all([ordersAgg, guestsAgg, sessionsAgg, summarizeRefunds(hotelId, from, to)]);
  const n = (x: any, k: string) => Number(x?.[k] ?? 0);

  const totalSales  = n(o, 'totalSales') + n(g, 'collected') + n(s, 'collected');
  const cashSales   = n(o, 'cashSales') + n(g, 'cash') + n(s, 'cash');
  const splitCash   = n(o, 'splitCashSales') + n(g, 'splitCash') + n(s, 'splitCash');
  const upiSales    = n(o, 'upiSales') + n(o, 'splitUpi') + n(g, 'upi') + n(s, 'upi');
  const cardSales   = n(o, 'cardSales') + n(o, 'splitCard') + n(g, 'card') + n(s, 'card');
  const onlineSales = n(o, 'onlineSales');
  const otherSales  = Math.max(0, totalSales - cashSales - splitCash - upiSales - cardSales - onlineSales);

  return {
    totalOrders:    n(o, 'totalOrders') + n(g, 'count') + n(s, 'count'),
    totalSales:     r2(totalSales),
    cashSales:      r2(cashSales),
    splitCashSales: r2(splitCash),
    upiSales:       r2(upiSales),
    cardSales:      r2(cardSales),
    onlineSales:    r2(onlineSales),
    otherSales:     r2(otherSales),
    refunds,
  };
}

/** Expected drawer cash. Unchanged formula; inputs now reflect cash actually received. */
export function expectedDrawerCash(openingCash: number, t: ShiftTotals, cashIn: number, cashOut: number): number {
  return r2(openingCash + t.cashSales + t.splitCashSales + cashIn - cashOut);
}

