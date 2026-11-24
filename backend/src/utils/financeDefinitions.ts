/**
 * financeDefinitions.ts — ONE definition of the money figures for every report
 * (Phase 5 · Batch 2 · 2D; owner-approved rules, 2026-11-21).
 *
 *  SALES        orders that are served or completed (never cancelled), counted on the
 *               fulfilment day: servedAt, else completedAt (legacy fallback: createdAt).
 *               Sale value = grandTotal + gift-voucher + wallet tenders taken at order time
 *               (vouchers / wallet are tenders, not discounts). Net sales also subtract
 *               settlement discounts (loyalty / complimentary given when a table is billed).
 *  COLLECTIONS  money actually received (cash, UPI, card, online gateway), each payment on
 *               its own time — from the PaymentEntry ledger. Orders paid before the ledger
 *               existed are read through a fallback from their stored payment fields.
 *  TENDERS      voucher / wallet used to settle bills — shown apart, not collections.
 *  REFUNDS      money given back, on the refund time — apart from collections.
 *  WRITE-OFFS   unpaid amounts a manager wrote off (walk-outs).
 *  ADVANCES     money held for orders not yet served / completed (as of now).
 *  RECEIVABLES  served / completed orders still owed (as of now); platform orders separate.
 *
 * GST / Tally / GSTR-1 use the SALES basis (owner decision; for CA validation).
 * Day boundaries are IST (00:00–23:59:59.999 +05:30) regardless of the server time zone.
 */
import mongoose from 'mongoose';
import Order from '../models/Order';
import PaymentEntry from '../models/PaymentEntry';

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

export const SALE_STATUSES = ['served', 'completed'];
export const PLATFORM_SOURCES = ['swiggy', 'zomato'];

/** Start (00:00 IST) or end (23:59:59.999 IST) of a YYYY-MM-DD day, as a UTC Date. */
export function istDay(isoDate: string, endOfDay = false): Date {
  return new Date(isoDate + (endOfDay ? 'T23:59:59.999+05:30' : 'T00:00:00+05:30'));
}
/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

/** $match for SALES fulfilled in [from, to]. */
export function salesMatch(hotelId: mongoose.Types.ObjectId, from: Date, to: Date): Record<string, unknown> {
  return {
    hotelId,
    status: { $in: SALE_STATUSES },
    // an order is fulfilled after it is created; the lower bound only keeps the scan small
    createdAt: { $lte: to, $gte: new Date(from.getTime() - 62 * DAY_MS) },
    $or: [
      { servedAt: { $gte: from, $lte: to } },
      { servedAt: null, completedAt: { $gte: from, $lte: to } },
      { servedAt: null, completedAt: null, createdAt: { $gte: from, $lte: to } },
    ],
  };
}
/** Sale value of an order (aggregation expression). */
export const saleValueExpr = {
  $add: ['$grandTotal', { $ifNull: ['$giftVoucherAmount', 0] }, { $ifNull: ['$walletAmount', 0] }],
};
/** Discounts inside an order (manual, coupon, loyalty at order time, discount at payment). */
export const orderDiscountExpr = {
  $add: [
    { $ifNull: ['$discountAmount', 0] }, { $ifNull: ['$couponDiscount', 0] },
    { $ifNull: ['$loyaltyDiscount', 0] }, { $ifNull: ['$paymentDiscount', 0] },
  ],
};
/** Fulfilment time of an order (aggregation expression). */
export const fulfilledAtExpr = { $ifNull: ['$servedAt', { $ifNull: ['$completedAt', '$createdAt'] }] };

export interface MoneyByMethod { cash: number; upi: number; card: number; online: number; other: number; total: number }
const emptyMoney = (): MoneyByMethod => ({ cash: 0, upi: 0, card: 0, online: 0, other: 0, total: 0 });
function addMoney(m: MoneyByMethod, method: string, amount: number) {
  const k = (['cash', 'upi', 'card', 'online'].includes(method) ? method : 'other') as keyof MoneyByMethod;
  m[k] = r2(m[k] + amount);
  m.total = r2(m.total + amount);
}
/** Order payment method → collection bucket (legacy fallback). */
function legacyMethod(pm: string | null | undefined): string {
  if (pm === 'cash' || pm === 'card') return pm;
  if (pm === 'razorpay') return 'online';
  if (pm && pm.startsWith('upi')) return 'upi';
  return 'other';
}

export interface MoneyMovements {
  collections: MoneyByMethod;                     // money received
  tenders: { voucher: number; wallet: number; total: number };
  settlementDiscounts: { loyalty: number; complimentary: number; other: number; total: number };
  refunds: MoneyByMethod;
  reversals: MoneyByMethod;                       // Batch 3 (3E): money of reopened bills reversed
  tips: MoneyByMethod;                            // Batch 3: gratuities — not sales, not collections
  writeOffs: number;
  netCollections: number;                         // collections − refunds
}

/** Collections, tenders, settlement discounts, refunds and write-offs whose own time is in [from, to]. */
export async function moneyMovements(hotelId: mongoose.Types.ObjectId, from: Date, to: Date): Promise<MoneyMovements> {
  const out: MoneyMovements = {
    collections: emptyMoney(), tenders: { voucher: 0, wallet: 0, total: 0 },
    settlementDiscounts: { loyalty: 0, complimentary: 0, other: 0, total: 0 },
    refunds: emptyMoney(), reversals: emptyMoney(), tips: emptyMoney(), writeOffs: 0, netCollections: 0,
  };
  const ledger = await PaymentEntry.aggregate([
    { $match: { hotelId, paidAt: { $gte: from, $lte: to } } },
    { $group: { _id: { type: '$type', method: '$method' }, amount: { $sum: '$amount' } } },
  ]);
  for (const row of ledger) {
    const { type, method } = row._id as { type: string; method: string };
    const amount = r2(row.amount);
    if (type === 'payment' && (method === 'voucher' || method === 'wallet')) {
      out.tenders[method] = r2(out.tenders[method] + amount);
      out.tenders.total = r2(out.tenders.total + amount);
    } else if (type === 'payment') addMoney(out.collections, method, amount);
    else if (type === 'refund') addMoney(out.refunds, method, amount);
    else if (type === 'reversal') {
      // Batch 3 (3E): a reopened bill's entries are reversed explicitly (originals kept).
      if (method === 'voucher' || method === 'wallet') {
        out.tenders[method] = r2(out.tenders[method] - amount);
        out.tenders.total = r2(out.tenders.total - amount);
      } else if (method === 'loyalty' || method === 'complimentary') {
        out.settlementDiscounts[method] = r2(out.settlementDiscounts[method] - amount);
        out.settlementDiscounts.total = r2(out.settlementDiscounts.total - amount);
      } else addMoney(out.reversals, method, amount);
    }
    else if (type === 'tip') addMoney(out.tips, method, amount);
    else if (type === 'write_off') out.writeOffs = r2(out.writeOffs + amount);
    else if (type === 'discount') {
      const k = method === 'loyalty' || method === 'complimentary' ? method : 'other';
      out.settlementDiscounts[k] = r2(out.settlementDiscounts[k] + amount);
      out.settlementDiscounts.total = r2(out.settlementDiscounts.total + amount);
    }
  }
  // Legacy fallback (read-only): orders paid before the ledger existed carry their payment
  // on the order itself — one payment of grandTotal at paymentTime, split by splitDetails.
  const legacy = await Order.find({
    hotelId, ledger: { $ne: true }, paymentTime: { $gte: from, $lte: to },
  }).select('grandTotal paymentMethod splitDetails').lean();
  for (const o of legacy as any[]) {
    const sd = o.splitDetails ?? {};
    const parts = [['cash', sd.cash], ['upi', sd.upi], ['card', sd.card]].filter(([, v]) => Number(v) > 0) as Array<[string, number]>;
    if (o.paymentMethod === 'split' && parts.length) parts.forEach(([m, v]) => addMoney(out.collections, m, r2(v)));
    else addMoney(out.collections, legacyMethod(o.paymentMethod), r2(o.grandTotal));
  }
  const legacyRefunds = await Order.find({
    hotelId, ledger: { $ne: true }, refundedAt: { $gte: from, $lte: to }, refundAmount: { $gt: 0 },
  }).select('refundAmount paymentMethod').lean();
  for (const o of legacyRefunds as any[]) addMoney(out.refunds, legacyMethod(o.paymentMethod), r2(o.refundAmount));
  out.netCollections = r2(out.collections.total - out.refunds.total - out.reversals.total);
  return out;
}

/** Net sales for [from, to] — the same figure as salesReport().totalSales (for P&L / finance). */
export async function netSales(hotelId: mongoose.Types.ObjectId, from: Date, to: Date): Promise<{ gross: number; net: number; orders: number }> {
  const [s] = await Order.aggregate([
    { $match: salesMatch(hotelId, from, to) },
    { $group: { _id: null, gross: { $sum: saleValueExpr }, orders: { $sum: 1 } } },
  ]);
  // Settlement discounts, less those reversed when a bill was reopened (Batch 3 · 3E).
  const [d] = await PaymentEntry.aggregate([
    { $match: { hotelId, paidAt: { $gte: from, $lte: to }, $or: [
      { type: 'discount' },
      { type: 'reversal', method: { $in: ['loyalty', 'complimentary'] } },
    ] } },
    { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$type', 'reversal'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
  ]);
  const gross = r2(s?.gross);
  return { gross, net: r2(gross - r2(d?.total)), orders: s?.orders ?? 0 };
}

export interface Position {
  advances:    { amount: number; orders: number };
  receivables: { amount: number; orders: number; platformAmount: number; platformOrders: number };
}
/** Money held for unserved orders and money still owed on served / completed orders — now. */
export async function positionNow(hotelId: mongoose.Types.ObjectId): Promise<Position> {
  const [adv] = await Order.aggregate([
    { $match: {
      hotelId, status: { $nin: [...SALE_STATUSES, 'cancelled'] },
      $or: [{ amountSettled: { $gt: 0 } }, { ledger: { $ne: true }, paymentTime: { $ne: null } }],
    } },
    { $group: { _id: null, amount: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$amountSettled', 0] }, 0] }, '$amountSettled', '$grandTotal'] } }, orders: { $sum: 1 } } },
  ]);
  // Receivables: fulfilled and not fully settled. Legacy completed orders (before the ledger)
  // are treated as settled — the old code completed table bills without a payment time.
  const rec = await Order.aggregate([
    { $match: {
      hotelId, status: { $in: SALE_STATUSES }, paymentTime: null,
      $or: [{ ledger: true }, { status: 'served' }],
    } },
    { $project: { orderSource: 1, owed: { $max: [0, { $subtract: ['$grandTotal', { $ifNull: ['$amountSettled', 0] }] }] } } },
    { $match: { owed: { $gt: 0.005 } } },
    { $group: { _id: { $in: ['$orderSource', PLATFORM_SOURCES] }, amount: { $sum: '$owed' }, orders: { $sum: 1 } } },
  ]);
  const own = rec.find(x => x._id === false);
  const plat = rec.find(x => x._id === true);
  return {
    advances: { amount: r2(adv?.amount), orders: adv?.orders ?? 0 },
    receivables: { amount: r2(own?.amount), orders: own?.orders ?? 0, platformAmount: r2(plat?.amount), platformOrders: plat?.orders ?? 0 },
  };
}

/**
 * Bills with money still owed at the counter, now (Batch 3). Based on the outstanding balance,
 * never on kitchen status: an order paid in full while cooking is an advance, not pending.
 * Online-payment orders and platform (Swiggy / Zomato) orders are not collected at the counter.
 * Legacy completed orders (before the ledger) are treated as settled, as in positionNow().
 */
export async function pendingPayments(hotelId: mongoose.Types.ObjectId): Promise<{ orders: number; amount: number }> {
  const [row] = await Order.aggregate([
    { $match: {
      hotelId, paymentTime: null,
      paymentMethod: { $ne: 'razorpay' },
      orderSource: { $nin: PLATFORM_SOURCES },
      $or: [
        { status: { $in: ['payment_pending', 'pending', 'preparing', 'ready', 'served'] } },
        { status: 'completed', ledger: true },
      ],
    } },
    { $project: { owed: { $round: [{ $max: [0, { $subtract: ['$grandTotal', { $ifNull: ['$amountSettled', 0] }] }] }, 2] } } },
    { $match: { owed: { $gt: 0.005 } } },
    { $group: { _id: null, orders: { $sum: 1 }, amount: { $sum: '$owed' } } },
  ]);
  return { orders: row?.orders ?? 0, amount: r2(row?.amount) };
}

/**
 * The daily / range sales report. Keeps the long-standing response shape (web dashboard,
 * mobile app): totalSales = NET SALES, paymentBreakdown = COLLECTIONS by method; adds the
 * explicit blocks `sales`, `collections`, `tenders`, `refunds`, `writeOffs`, `advances`,
 * `receivables` and `definitions`.
 */
export interface DrawerCash {
  openingCash: number;
  cashCollected: number;   // cash payments taken in the shift (including the cash part of splits)
  cashRefunds: number;     // cash given back
  cashReversals: number;   // cash of reopened bills reversed
  cashTips: number;        // tips received in cash
  cashIn: number;
  cashOut: number;
  expected: number;        // what should be in the drawer now
}

/**
 * Batch 3 — the cash that should be in the drawer for a shift, from the payment ledger: each
 * payment counts at the time it was taken (also for orders placed before the shift, or still in
 * the kitchen). The dashboard tile, the Shift tab, the drawer limit and the shift close all use
 * this one figure.
 */
export async function drawerCash(
  hotelId: mongoose.Types.ObjectId,
  shift: { openedAt: Date | string; openingCash?: number; cashIn?: number; cashOut?: number },
  to: Date = new Date(),
): Promise<DrawerCash> {
  const m = await moneyMovements(hotelId, new Date(shift.openedAt), to);
  const d = {
    openingCash: r2(shift.openingCash), cashCollected: m.collections.cash, cashRefunds: m.refunds.cash,
    cashReversals: m.reversals.cash, cashTips: m.tips.cash, cashIn: r2(shift.cashIn), cashOut: r2(shift.cashOut),
  };
  return {
    ...d,
    expected: r2(d.openingCash + d.cashCollected - d.cashRefunds - d.cashReversals + d.cashTips + d.cashIn - d.cashOut),
  };
}

export async function salesReport(hotelId: mongoose.Types.ObjectId, from: Date, to: Date) {
  const sourceSum = (src: string) => ({ $sum: { $cond: [{ $eq: ['$orderSource', src] }, saleValueExpr, 0] } });
  const sourceCount = (src: string) => ({ $sum: { $cond: [{ $eq: ['$orderSource', src] }, 1, 0] } });
  const [s] = await Order.aggregate([
    { $match: salesMatch(hotelId, from, to) },
    { $group: {
      _id: null,
      gross: { $sum: saleValueExpr }, tax: { $sum: '$taxTotal' }, discount: { $sum: orderDiscountExpr },
      voucherAtOrder: { $sum: { $ifNull: ['$giftVoucherAmount', 0] } }, walletAtOrder: { $sum: { $ifNull: ['$walletAmount', 0] } },
      orders: { $sum: 1 },
      parcelOrders: { $sum: { $cond: ['$isParcel', 1, 0] } }, parcelRevenue: { $sum: { $cond: ['$isParcel', saleValueExpr, 0] } },
      dineInOrders: sourceCount('dine-in'), dineInTotal: sourceSum('dine-in'),
      takeawayOrders: sourceCount('takeaway'), takeawayTotal: sourceSum('takeaway'),
      swiggyOrders: sourceCount('swiggy'), swiggyTotal: sourceSum('swiggy'),
      zomatoOrders: sourceCount('zomato'), zomatoTotal: sourceSum('zomato'),
      qrOrders: sourceCount('qr'), qrTotal: sourceSum('qr'),
    } },
  ]);
  const [money, position, cancelledOrders] = await Promise.all([
    moneyMovements(hotelId, from, to),
    positionNow(hotelId),
    Order.countDocuments({ hotelId, status: 'cancelled', createdAt: { $gte: from, $lte: to } }),
  ]);
  const gross = r2(s?.gross);
  const net = r2(gross - money.settlementDiscounts.total);
  const c = money.collections;
  // Tenders taken when the order was placed (part of the sale value) + those used at billing.
  const tenders = {
    voucher: r2(money.tenders.voucher + r2(s?.voucherAtOrder)),
    wallet:  r2(money.tenders.wallet + r2(s?.walletAtOrder)),
    total:   0,
  };
  tenders.total = r2(tenders.voucher + tenders.wallet);
  return {
    totalSales: net,
    totalRevenue: net,
    totalTax: r2(s?.tax),
    totalDiscount: r2(r2(s?.discount) + money.settlementDiscounts.total),
    totalOrders: s?.orders ?? 0,
    parcelOrders: s?.parcelOrders ?? 0,
    parcelRevenue: r2(s?.parcelRevenue),
    cancelledOrders,
    // Collections by method (money received in the period). UPI sub-types are not tracked
    // separately in the ledger; split payments appear under their parts.
    paymentBreakdown: { cash: c.cash, upi: c.upi, upi_intent: 0, upi_qr: 0, upi_collect: 0, card: c.card, split: 0, online: c.online, other: c.other },
    sourceBreakdown: {
      'dine-in': { orders: s?.dineInOrders ?? 0, revenue: r2(s?.dineInTotal) },
      takeaway:  { orders: s?.takeawayOrders ?? 0, revenue: r2(s?.takeawayTotal) },
      swiggy:    { orders: s?.swiggyOrders ?? 0, revenue: r2(s?.swiggyTotal) },
      zomato:    { orders: s?.zomatoOrders ?? 0, revenue: r2(s?.zomatoTotal) },
      qr:        { orders: s?.qrOrders ?? 0, revenue: r2(s?.qrTotal) },
    },
    sales: { gross, settlementDiscounts: money.settlementDiscounts, net, orders: s?.orders ?? 0, tax: r2(s?.tax) },
    collections: c,
    tenders,
    refunds: money.refunds,
    reversals: money.reversals,
    tips: money.tips,
    writeOffs: money.writeOffs,
    netCollections: money.netCollections,
    advances: position.advances,
    receivables: position.receivables,
    definitions: {
      sales: 'Served or completed orders on the day they were served / completed (net of settlement discounts).',
      collections: 'Money received (cash, UPI, card, online) on the time each payment was taken.',
      advances: 'Money held now for orders not yet served or completed.',
      receivables: 'Money still owed now on served or completed orders (platform orders shown separately).',
    },
  };
}
