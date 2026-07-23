import { Router, Response } from 'express';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import Order from '../models/Order';
import Settings from '../models/Settings';
import mongoose from 'mongoose';
import { sendError } from '../utils/sendError';
import { isValidDateParam } from '../utils/dateParam';
import { logger } from '../utils/logger';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

// GET /api/reports/gst?from=YYYY-MM-DD&to=YYYY-MM-DD
// Groups non-cancelled order items by tax rate, returns CGST/SGST breakdown
router.get('/gst', authMiddleware, async (req: AuthRequest, res: Response) => {
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

    const rows = await Order.aggregate([
      {
        $match: {
          hotelId,
          status: { $ne: 'cancelled' },
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
    ]);

    const result = rows.map(r => ({
      taxPercent:   r._id as number,
      taxableValue: r.taxableValue as number,
      cgst:         (r.taxAmount as number) / 2,
      sgst:         (r.taxAmount as number) / 2,
      totalTax:     r.taxAmount as number,
      totalValue:   (r.taxableValue as number) + (r.taxAmount as number),
      totalItems:   r.totalItems as number,
    }));

    res.json({
      from:              fromDate.toISOString().slice(0, 10),
      to:                toDate.toISOString().slice(0, 10),
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
router.get('/tally', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (from && !isValidDateParam(from)) return res.status(400).json({ message: 'Invalid from date. Use YYYY-MM-DD.' });
    if (to   && !isValidDateParam(to))   return res.status(400).json({ message: 'Invalid to date. Use YYYY-MM-DD.' });
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const today = new Date();
    let fromDate = from ? new Date(from) : new Date(today.getFullYear(), today.getMonth(), 1);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    // Cap range at 90 days to prevent loading years of orders into heap
    const maxFrom = new Date(toDate);
    maxFrom.setDate(maxFrom.getDate() - 90);
    if (fromDate < maxFrom) fromDate = maxFrom;

    const orders = await Order.find(
      { hotelId, status: { $ne: 'cancelled' }, createdAt: { $gte: fromDate, $lte: toDate } },
      { orderNumber: 1, createdAt: 1, customerName: 1, tableNumber: 1, paymentMethod: 1,
        subtotal: 1, taxTotal: 1, discountAmount: 1, grandTotal: 1, orderSource: 1 },
    ).sort({ createdAt: 1 }).lean();

    const ddmmyyyy = (d: Date) => {
      const dt = new Date(d);
      return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
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

    res.json({
      from:         fromDate.toISOString().slice(0, 10),
      to:           toDate.toISOString().slice(0, 10),
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
router.get('/gstr1-json', authMiddleware, async (req: AuthRequest, res: Response) => {
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

    // Cap at 92 days (~one quarter) to avoid heap pressure on large datasets
    const maxMs = 92 * 24 * 60 * 60 * 1000;
    if (toDate.getTime() - fromDate.getTime() > maxMs) {
      return res.status(400).json({ message: 'Date range cannot exceed 92 days for GSTR-1 export.' });
    }

    const settings = await Settings.findOne({ hotelId: req.hotelId });
    const gstin    = (settings?.gstNumber || '').toUpperCase().trim();
    const stateCode = gstin.length >= 2 ? gstin.substring(0, 2) : '33';
    const fp = `${String(fromDate.getMonth() + 1).padStart(2, '0')}${fromDate.getFullYear()}`;

    // M-9: stream aggregation entirely in MongoDB — never loads full order documents
    // into heap. $unwind + $lookup + $facet returns only grouped totals.
    const [agg] = await Order.aggregate([
      {
        $match: {
          hotelId,
          status: { $ne: 'cancelled' },
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
    ]) as [{ b2cs: any[]; hsn: any[] }];

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

export default router;
