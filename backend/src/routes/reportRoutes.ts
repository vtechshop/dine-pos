import { Router, Response } from 'express';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import Order from '../models/Order';
import Settings from '../models/Settings';
import GiftVoucher from '../models/GiftVoucher';
import CouponRedemption from '../models/CouponRedemption';
import PurchaseOrder from '../models/PurchaseOrder';
import GRN from '../models/GRN';
import VendorPayment from '../models/VendorPayment';
import VendorReturn from '../models/VendorReturn';
import Vendor from '../models/Vendor';
import mongoose from 'mongoose';
import { sendError } from '../utils/sendError';
import { isValidDateParam } from '../utils/dateParam';
import { logger } from '../utils/logger';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('reports'));

// IST = UTC+05:30. Convert a YYYY-MM-DD string to the correct UTC Date for that
// day's start (00:00:00 IST) or end (23:59:59.999 IST) so MongoDB $match
// boundaries land on the right day regardless of server timezone.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDay(isoDate: string, endOfDay = false): Date {
  return new Date(isoDate + (endOfDay ? 'T23:59:59.999+05:30' : 'T00:00:00+05:30'));
}
function nowISTDateStr(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}
function thisMonthStartISTStr(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// GET /api/reports/gst?from=YYYY-MM-DD&to=YYYY-MM-DD
// Groups completed order items by tax rate, returns CGST/SGST breakdown
router.get('/gst', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (from && !isValidDateParam(from)) return res.status(400).json({ message: 'Invalid from date. Use YYYY-MM-DD.' });
    if (to   && !isValidDateParam(to))   return res.status(400).json({ message: 'Invalid to date. Use YYYY-MM-DD.' });
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const fromStr  = from || thisMonthStartISTStr();
    const toStr    = to   || nowISTDateStr();
    const fromDate = istDay(fromStr, false);
    const toDate   = istDay(toStr, true);

    const rows = await Order.aggregate([
      {
        $match: {
          hotelId,
          status: 'completed',
          createdAt: { $gte: fromDate, $lte: toDate },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.taxPercent',
          taxableValue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          taxAmount:    { $sum: '$items.taxAmount' },
          totalItems:   { $sum: '$items.quantity' },
        },
      },
      { $sort: { _id: 1 } },
    ]).option({ maxTimeMS: 30_000 });

    const result = rows.map(r => ({
      taxPercent:   r._id as number,
      taxableValue: r.taxableValue as number,
      cgst:         (r.taxAmount as number) / 2,
      sgst:         (r.taxAmount as number) / 2,
      totalTax:     r.taxAmount as number,
      totalValue:   (r.taxableValue as number) + (r.taxAmount as number),
      totalItems:   r.totalItems as number,
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      from:              fromStr,
      to:                toStr,
      rows:              result,
      totalTaxableValue: result.reduce((s, r) => s + r.taxableValue, 0),
      totalCGST:         result.reduce((s, r) => s + r.cgst, 0),
      totalSGST:         result.reduce((s, r) => s + r.sgst, 0),
      totalTax:          result.reduce((s, r) => s + r.totalTax, 0),
      totalValue:        result.reduce((s, r) => s + r.totalValue, 0),
    });
  } catch (err) {
    logger.error('GST report error', { err });
    sendError(res, 500, 'Failed to generate GST report', err);
  }
});

// GET /api/reports/tally?from=YYYY-MM-DD&to=YYYY-MM-DD
// Order-level CSV export in Tally-compatible format (DD-MM-YYYY dates, CGST/SGST split)
router.get('/tally', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (from && !isValidDateParam(from)) return res.status(400).json({ message: 'Invalid from date. Use YYYY-MM-DD.' });
    if (to   && !isValidDateParam(to))   return res.status(400).json({ message: 'Invalid to date. Use YYYY-MM-DD.' });
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const toStr    = to   || nowISTDateStr();
    const toDate   = istDay(toStr, true);

    // Cap range at 90 days to prevent loading years of orders into heap
    const maxFromMs  = toDate.getTime() - 90 * 24 * 60 * 60 * 1000;
    const defaultStr = thisMonthStartISTStr();
    const fromStr    = from || defaultStr;
    let fromDate     = istDay(fromStr, false);
    if (fromDate.getTime() < maxFromMs) fromDate = new Date(maxFromMs);

    const orders = await Order.find(
      { hotelId, status: 'completed', createdAt: { $gte: fromDate, $lte: toDate } },
      { orderNumber: 1, createdAt: 1, customerName: 1, tableNumber: 1, paymentMethod: 1,
        subtotal: 1, taxTotal: 1, discountAmount: 1, grandTotal: 1, orderSource: 1 },
    ).sort({ createdAt: 1 }).lean();

    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const ddmmyyyy = (d: Date) => {
      const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS);
      return `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`;
    };

    const rows = (orders as any[]).map(o => ({
      date:        ddmmyyyy(o.createdAt),
      voucherNo:   o.orderNumber,
      party:       o.customerName || (o.tableNumber ? `Table ${o.tableNumber}` : 'Walk-in'),
      paymentMode: (o.paymentMethod || 'cash').toUpperCase(),
      subtotal:    +(o.subtotal || 0).toFixed(2),
      cgst:        +((o.taxTotal || 0) / 2).toFixed(2),
      sgst:        +((o.taxTotal || 0) / 2).toFixed(2),
      discount:    +(o.discountAmount || 0).toFixed(2),
      grandTotal:  +(o.grandTotal || 0).toFixed(2),
      narration:   `${o.orderSource || 'dine-in'} - Table ${o.tableNumber || 'Walk-in'}`,
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      from:         fromStr,
      to:           toStr,
      rows,
      totalOrders:  rows.length,
      totalRevenue: +rows.reduce((s, r) => s + r.grandTotal, 0).toFixed(2),
      totalTax:     +rows.reduce((s, r) => s + r.cgst + r.sgst, 0).toFixed(2),
    });
  } catch (err) {
    logger.error('Tally export error', { err });
    sendError(res, 500, 'Failed to generate Tally export', err);
  }
});

// GET /api/reports/gstr1-json?from=YYYY-MM-DD&to=YYYY-MM-DD
// Generates official GSTR-1 JSON in portal-upload format (GST3.1.7)
// B2B is empty (no customer GSTIN stored); B2CS covers all walk-in / dine-in sales
// HSN uses product.hsnCode; items without one fall under SAC 9963 (restaurant services)
router.get('/gstr1-json', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (from && !isValidDateParam(from)) return res.status(400).json({ message: 'Invalid from date. Use YYYY-MM-DD.' });
    if (to   && !isValidDateParam(to))   return res.status(400).json({ message: 'Invalid to date. Use YYYY-MM-DD.' });
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const fromStr  = from || thisMonthStartISTStr();
    const toStr    = to   || nowISTDateStr();
    const fromDate = istDay(fromStr, false);
    const toDate   = istDay(toStr, true);

    // Cap at 92 days (~one quarter) to avoid heap pressure on large datasets
    const maxMs = 92 * 24 * 60 * 60 * 1000;
    if (toDate.getTime() - fromDate.getTime() > maxMs) {
      return res.status(400).json({ message: 'Date range cannot exceed 92 days for GSTR-1 export.' });
    }

    const settings = await Settings.findOne({ hotelId: req.hotelId }).maxTimeMS(10_000);
    const gstin    = (settings?.gstNumber || '').toUpperCase().trim();
    const stateCode = gstin.length >= 2 ? gstin.substring(0, 2) : '33';
    // fp (filing period) uses the IST month/year from the fromStr date string
    const fp = `${fromStr.slice(5, 7)}${fromStr.slice(0, 4)}`;

    const [agg] = await Order.aggregate([
      {
        $match: {
          hotelId,
          status: 'completed',
          createdAt: { $gte: fromDate, $lte: toDate },
        },
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          pipeline: [{ $project: { hsnCode: 1, name: 1 } }],
          as: '_prod',
        },
      },
      {
        $set: {
          _rawHsn:   { $trim: { input: { $ifNull: [{ $arrayElemAt: ['$_prod.hsnCode', 0] }, ''] } } },
          _prodName: { $ifNull: [{ $arrayElemAt: ['$_prod.name', 0] }, '$items.productName'] },
          _taxable:  { $multiply: ['$items.price', '$items.quantity'] },
          _half:     { $divide: [{ $ifNull: ['$items.taxAmount', 0] }, 2] },
          _total:    { $add: [{ $multiply: ['$items.price', '$items.quantity'] }, { $ifNull: ['$items.taxAmount', 0] }] },
          _rt:       { $ifNull: ['$items.taxPercent', 0] },
        },
      },
      {
        $set: {
          _hsn:  { $cond: [{ $eq: ['$_rawHsn', ''] }, '9963', '$_rawHsn'] },
          _desc: { $cond: [{ $eq: ['$_rawHsn', ''] }, 'Restaurant Services', '$_prodName'] },
        },
      },
      {
        $facet: {
          b2cs: [
            { $match: { _rt: { $gt: 0 } } },
            { $group: { _id: '$_rt', txval: { $sum: '$_taxable' }, camt: { $sum: '$_half' }, samt: { $sum: '$_half' } } },
          ],
          hsn: [
            {
              $group: {
                _id:  { hsn: '$_hsn', rt: '$_rt', desc: '$_desc' },
                qty:  { $sum: '$items.quantity' },
                val:  { $sum: '$_total' },
                txval:{ $sum: '$_taxable' },
                camt: { $sum: '$_half' },
                samt: { $sum: '$_half' },
              },
            },
          ],
        },
      },
    ]).option({ maxTimeMS: 30_000 }) as [{ b2cs: any[]; hsn: any[] }];

    const b2cs = (agg?.b2cs ?? []).map((row: any) => ({
      camt:    +row.camt.toFixed(2),
      csamt:   0,
      iamt:    0,
      pos:     stateCode,
      rt:      row._id,
      samt:    +row.samt.toFixed(2),
      sply_ty: 'INTRA',
      txval:   +row.txval.toFixed(2),
      typ:     'OE',
    }));

    const hsnB2c = (agg?.hsn ?? []).map((row: any, idx: number) => ({
      num:    idx + 1,
      hsn_sc: row._id.hsn,
      desc:   row._id.desc,
      uqc:    'OTH',
      qty:    row.qty,
      val:    +row.val.toFixed(2),
      txval:  +row.txval.toFixed(2),
      iamt:   0,
      camt:   +row.camt.toFixed(2),
      samt:   +row.samt.toFixed(2),
      csamt:  0,
      rt:     row._id.rt,
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      gstin,
      fp,
      version: 'GST3.1.7',
      hash:    'hash',
      b2b:     [],
      b2cs,
      hsn: {
        hsn_b2b: [],
        hsn_b2c: hsnB2c,
      },
    });
  } catch (err) {
    logger.error('GSTR-1 JSON error', { err });
    sendError(res, 500, 'Failed to generate GSTR-1 JSON', err);
  }
});

// ── GET /api/reports/modifiers?from=YYYY-MM-DD&to=YYYY-MM-DD ─────────────────
// Aggregates selectedModifiers across all non-cancelled orders.
// Returns: topModifiers[], modifierGroupRevenue[], totalModifierRevenue, totalModifierOrders
router.get('/modifiers', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (from && !isValidDateParam(from)) return res.status(400).json({ message: 'Invalid from date. Use YYYY-MM-DD.' });
    if (to   && !isValidDateParam(to))   return res.status(400).json({ message: 'Invalid to date. Use YYYY-MM-DD.' });
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const today = new Date();
    const fromDate = from ? new Date(from) : new Date(today.getFullYear(), today.getMonth(), 1);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const [topModifiers, groupRevenue] = await Promise.all([
      // Top modifier options by quantity and revenue
      Order.aggregate([
        { $match: { hotelId, status: { $ne: 'cancelled' }, createdAt: { $gte: fromDate, $lte: toDate } } },
        { $unwind: '$items' },
        { $unwind: '$items.selectedModifiers' },
        {
          $group: {
            _id:  { optionId: '$items.selectedModifiers.modifierOptionId', optionName: '$items.selectedModifiers.modifierOptionName', groupName: '$items.selectedModifiers.modifierGroupName' },
            totalQty:     { $sum: '$items.quantity' },
            totalRevenue: { $sum: { $multiply: ['$items.selectedModifiers.modifierPrice', '$items.quantity'] } },
            orderCount:   { $sum: 1 },
          },
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 20 },
        {
          $project: {
            _id:          0,
            optionId:     '$_id.optionId',
            optionName:   '$_id.optionName',
            groupName:    '$_id.groupName',
            totalQty:     1,
            totalRevenue: 1,
            orderCount:   1,
          },
        },
      ]).option({ maxTimeMS: 30_000 }),

      // Revenue by modifier group
      Order.aggregate([
        { $match: { hotelId, status: { $ne: 'cancelled' }, createdAt: { $gte: fromDate, $lte: toDate } } },
        { $unwind: '$items' },
        { $unwind: '$items.selectedModifiers' },
        {
          $group: {
            _id:  { groupId: '$items.selectedModifiers.modifierGroupId', groupName: '$items.selectedModifiers.modifierGroupName' },
            totalRevenue: { $sum: { $multiply: ['$items.selectedModifiers.modifierPrice', '$items.quantity'] } },
            totalQty:     { $sum: '$items.quantity' },
            orderCount:   { $sum: 1 },
          },
        },
        { $sort: { totalRevenue: -1 } },
        {
          $project: {
            _id:          0,
            groupId:      '$_id.groupId',
            groupName:    '$_id.groupName',
            totalRevenue: 1,
            totalQty:     1,
            orderCount:   1,
          },
        },
      ]).option({ maxTimeMS: 30_000 }),
    ]);

    const totalModifierRevenue = groupRevenue.reduce((s: number, r: any) => s + (r.totalRevenue || 0), 0);
    const totalModifierOrders  = groupRevenue.reduce((s: number, r: any) => s + (r.orderCount  || 0), 0);

    res.json({ from: fromDate, to: toDate, topModifiers, groupRevenue, totalModifierRevenue: +totalModifierRevenue.toFixed(2), totalModifierOrders });
  } catch (err) {
    logger.error('Modifier report error', { err });
    sendError(res, 500, 'Failed to generate modifier report', err);
  }
});

// GET /api/reports/gift-vouchers?from=YYYY-MM-DD&to=YYYY-MM-DD
// Aggregates gift voucher transactions (issue / redeem / refund / topup / expire) in the date range
// Plus a live outstanding snapshot (not date-filtered) for all active vouchers
router.get('/gift-vouchers', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (from && !isValidDateParam(from)) return res.status(400).json({ message: 'Invalid from date. Use YYYY-MM-DD.' });
    if (to   && !isValidDateParam(to))   return res.status(400).json({ message: 'Invalid to date. Use YYYY-MM-DD.' });
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const fromStr  = from || thisMonthStartISTStr();
    const toStr    = to   || nowISTDateStr();
    const fromDate = istDay(fromStr, false);
    const toDate   = istDay(toStr, true);

    const [txAgg, outstandingAgg] = await Promise.all([
      GiftVoucher.aggregate([
        { $match: { hotelId, isDeleted: false } },
        { $unwind: '$transactions' },
        { $match: { 'transactions.createdAt': { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: '$transactions.type', count: { $sum: 1 }, amount: { $sum: '$transactions.amount' } } },
      ]).option({ maxTimeMS: 30_000 }),
      GiftVoucher.aggregate([
        { $match: { hotelId, isDeleted: false, isActive: true, balance: { $gt: 0 } } },
        { $group: { _id: null, balance: { $sum: '$balance' }, count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 10_000 }),
    ]);

    const m: Record<string, { count: number; amount: number }> = {};
    for (const r of txAgg) m[String(r._id)] = { count: r.count, amount: r.amount };

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      from: fromStr,
      to:   toStr,
      issued:   { count: m.issue?.count  ?? 0, amount: +(m.issue?.amount  ?? 0).toFixed(2) },
      redeemed: { count: m.redeem?.count ?? 0, amount: +(m.redeem?.amount ?? 0).toFixed(2) },
      restored: {
        count:  (m.refund?.count ?? 0) + (m.topup?.count ?? 0),
        amount: +((m.refund?.amount ?? 0) + (m.topup?.amount ?? 0)).toFixed(2),
      },
      expired:     { count: m.expire?.count ?? 0, amount: +(m.expire?.amount ?? 0).toFixed(2) },
      outstanding: { balance: +(outstandingAgg[0]?.balance ?? 0).toFixed(2), activeVouchers: outstandingAgg[0]?.count ?? 0 },
    });
  } catch (err) {
    logger.error('Gift voucher report error', { err });
    sendError(res, 500, 'Failed to generate gift voucher report', err);
  }
});

// GET /api/reports/coupons?from=YYYY-MM-DD&to=YYYY-MM-DD
// Aggregates coupon redemptions in the date range, ranked by discount given
router.get('/coupons', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (from && !isValidDateParam(from)) return res.status(400).json({ message: 'Invalid from date. Use YYYY-MM-DD.' });
    if (to   && !isValidDateParam(to))   return res.status(400).json({ message: 'Invalid to date. Use YYYY-MM-DD.' });
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const fromStr  = from || thisMonthStartISTStr();
    const toStr    = to   || nowISTDateStr();
    const fromDate = istDay(fromStr, false);
    const toDate   = istDay(toStr, true);

    const [rows, totalsAgg] = await Promise.all([
      CouponRedemption.aggregate([
        { $match: { hotelId, status: 'redeemed', redeemedAt: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: '$couponCode', usageCount: { $sum: 1 }, totalDiscount: { $sum: '$discountAmount' } } },
        { $sort: { totalDiscount: -1 } },
        { $limit: 50 },
      ]).option({ maxTimeMS: 30_000 }),
      CouponRedemption.aggregate([
        { $match: { hotelId, status: 'redeemed', redeemedAt: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: null, totalUsage: { $sum: 1 }, totalDiscount: { $sum: '$discountAmount' }, uniqueCoupons: { $addToSet: '$couponId' } } },
        { $project: { totalUsage: 1, totalDiscount: 1, uniqueCoupons: { $size: '$uniqueCoupons' } } },
      ]).option({ maxTimeMS: 10_000 }),
    ]);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      from:          fromStr,
      to:            toStr,
      rows:          rows.map((r: any) => ({ couponCode: r._id, usageCount: r.usageCount, totalDiscount: +r.totalDiscount.toFixed(2) })),
      totalUsage:    totalsAgg[0]?.totalUsage    ?? 0,
      totalDiscount: +((totalsAgg[0]?.totalDiscount ?? 0).toFixed(2)),
      uniqueCoupons: totalsAgg[0]?.uniqueCoupons ?? 0,
    });
  } catch (err) {
    logger.error('Coupon report error', { err });
    sendError(res, 500, 'Failed to generate coupon report', err);
  }
});

// GET /api/reports/vendor-procurement?from=YYYY-MM-DD&to=YYYY-MM-DD
// Summary of POs, GRNs, vendor payments, returns, and current outstanding in date range
router.get('/vendor-procurement', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (from && !isValidDateParam(from)) return res.status(400).json({ message: 'Invalid from date. Use YYYY-MM-DD.' });
    if (to   && !isValidDateParam(to))   return res.status(400).json({ message: 'Invalid to date. Use YYYY-MM-DD.' });
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const fromStr  = from || thisMonthStartISTStr();
    const toStr    = to   || nowISTDateStr();
    const fromDate = istDay(fromStr, false);
    const toDate   = istDay(toStr, true);

    const [poAgg, grnAgg, payAgg, retAgg, outAgg] = await Promise.all([
      PurchaseOrder.aggregate([
        { $match: { hotelId, isDeleted: false, createdAt: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: null, count: { $sum: 1 }, totalValue: { $sum: '$grandTotal' } } },
      ]).option({ maxTimeMS: 15_000 }),
      GRN.aggregate([
        { $match: { hotelId, isDeleted: false, createdAt: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: null, count: { $sum: 1 }, totalValue: { $sum: '$grandTotal' } } },
      ]).option({ maxTimeMS: 15_000 }),
      VendorPayment.aggregate([
        { $match: { hotelId, isDeleted: false, paymentDate: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
      ]).option({ maxTimeMS: 15_000 }),
      VendorReturn.aggregate([
        { $match: { hotelId, isDeleted: false, status: 'completed', completedAt: { $gte: fromDate, $lte: toDate } } },
        { $group: { _id: null, count: { $sum: 1 }, totalValue: { $sum: '$returnValue' } } },
      ]).option({ maxTimeMS: 15_000 }),
      Vendor.aggregate([
        { $match: { hotelId, isDeleted: false, currentOutstanding: { $gt: 0 } } },
        { $group: { _id: null, totalOutstanding: { $sum: '$currentOutstanding' }, vendorCount: { $sum: 1 } } },
      ]).option({ maxTimeMS: 10_000 }),
    ]);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      from: fromStr,
      to:   toStr,
      purchaseOrders: { count: poAgg[0]?.count ?? 0, totalValue:  +((poAgg[0]?.totalValue  ?? 0).toFixed(2)) },
      grns:           { count: grnAgg[0]?.count ?? 0, totalValue:  +((grnAgg[0]?.totalValue  ?? 0).toFixed(2)) },
      vendorPayments: { count: payAgg[0]?.count ?? 0, totalAmount: +((payAgg[0]?.totalAmount ?? 0).toFixed(2)) },
      vendorReturns:  { count: retAgg[0]?.count ?? 0, totalValue:  +((retAgg[0]?.totalValue  ?? 0).toFixed(2)) },
      outstanding:    { totalOutstanding: +((outAgg[0]?.totalOutstanding ?? 0).toFixed(2)), vendorCount: outAgg[0]?.vendorCount ?? 0 },
    });
  } catch (err) {
    logger.error('Vendor procurement report error', { err });
    sendError(res, 500, 'Failed to generate vendor procurement report', err);
  }
});

export default router;
