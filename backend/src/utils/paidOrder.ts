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

/** Amount refunded on an order (0 when never refunded). */
export const REFUND_AMOUNT = { $ifNull: ['$refundAmount', 0] };

/** What the hotel kept from an order: the bill total less any refund. */
export const NET_TOTAL = { $subtract: ['$grandTotal', REFUND_AMOUNT] };

const SPLIT_SUM = {
  $add: [
    { $ifNull: ['$splitDetails.cash', 0] },
    { $ifNull: ['$splitDetails.upi', 0] },
    { $ifNull: ['$splitDetails.card', 0] },
  ],
};

// A split bill whose cash/UPI/card parts were saved on the order. Split bills settled
// per guest or per table keep their parts on the guest record instead, so they stay in
// the 'split' bucket.
const SPLIT_PARTS_KNOWN = {
  $and: [{ $eq: ['$paymentMethod', 'split'] }, { $gt: [SPLIT_SUM, 0] }],
};

const UPI_METHODS = ['upi', 'upi_intent', 'upi_qr', 'upi_collect'];

// Net amount collected by one payment method: whole bills paid that way, plus that
// method's share of split bills. The share is the part's proportion of the split
// applied to the net bill, so tips, round-off or a refund never push the buckets past
// the bill: cash + upi + card + split always equals totalSales.
function methodNet(match: object, splitPart: 'cash' | 'upi' | 'card') {
  const share = { $divide: [{ $ifNull: [`$splitDetails.${splitPart}`, 0] }, SPLIT_SUM] };
  return {
    $sum: {
      $add: [
        { $cond: [match, NET_TOTAL, 0] },
        { $cond: [SPLIT_PARTS_KNOWN, { $multiply: [share, NET_TOTAL] }, 0] },
      ],
    },
  };
}

const netIf = (match: object | string) => ({ $sum: { $cond: [match, NET_TOTAL, 0] } });
const countIf = (match: object | string) => ({ $sum: { $cond: [match, 1, 0] } });
const source = (s: string) => ({ $eq: ['$orderSource', s] });

/**
 * $group fields for the sales reports. Money is net of refunds. Split bills are
 * counted under cash/UPI/card when their parts are known; 'split' holds only split
 * bills whose parts are not on the order. cash + upi + card + split = totalSales.
 */
export function salesGroupFields() {
  return {
    totalSales:      { $sum: NET_TOTAL },
    grossSales:      { $sum: '$grandTotal' },
    totalRefunds:    { $sum: REFUND_AMOUNT },
    refundedOrders:  countIf({ $gt: [REFUND_AMOUNT, 0] }),
    totalTax:        { $sum: '$taxTotal' },
    totalDiscount:   { $sum: { $ifNull: ['$discountAmount', 0] } },
    totalOrders:     { $sum: 1 },
    parcelOrders:    countIf('$isParcel'),
    parcelRevenue:   netIf('$isParcel'),
    cashTotal:       methodNet({ $eq: ['$paymentMethod', 'cash'] }, 'cash'),
    upiTotal:        methodNet({ $in: ['$paymentMethod', UPI_METHODS] }, 'upi'),
    upiIntentTotal:  netIf({ $in: ['$paymentMethod', ['upi', 'upi_intent']] }),
    upiQrTotal:      netIf({ $eq: ['$paymentMethod', 'upi_qr'] }),
    upiCollectTotal: netIf({ $eq: ['$paymentMethod', 'upi_collect'] }),
    cardTotal:       methodNet({ $eq: ['$paymentMethod', 'card'] }, 'card'),
    splitTotal:      netIf({ $and: [{ $eq: ['$paymentMethod', 'split'] }, { $not: [SPLIT_PARTS_KNOWN] }] }),
    dineInOrders:    countIf(source('dine-in')),
    dineInTotal:     netIf(source('dine-in')),
    takeawayOrders:  countIf(source('takeaway')),
    takeawayTotal:   netIf(source('takeaway')),
    swiggyOrders:    countIf(source('swiggy')),
    swiggyTotal:     netIf(source('swiggy')),
    zomatoOrders:    countIf(source('zomato')),
    zomatoTotal:     netIf(source('zomato')),
    qrOrders:        countIf(source('qr')),
    qrTotal:         netIf(source('qr')),
  };
}

/** Round a money figure to paise (split parts scaled by a refund can carry long decimals). */
export const money = (n: number | undefined | null) => Math.round((Number(n) || 0) * 100) / 100;
