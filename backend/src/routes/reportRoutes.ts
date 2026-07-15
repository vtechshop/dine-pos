import { Router, Response } from 'express';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import Order from '../models/Order';
import Settings from '../models/Settings';
import mongoose from 'mongoose';
import { sendError } from '../utils/sendError';
import { isValidDateParam } from '../utils/dateParam';

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
    console.error('GST report error:', err);
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
    console.error('Tally export error:', err);
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

    const orders = await Order.find({
      hotelId,
      status: { $ne: 'cancelled' },
      createdAt: { $gte: fromDate, $lte: toDate },
    }).populate('items.product', 'hsnCode name').lean();

    // Aggregate B2CS (all intra-state B2C sales) and HSN summary in one pass
    const taxMap:  Record<number, { txval: number; camt: number; samt: number }> = {};
    const hsnMap:  Record<string, { desc: string; qty: number; val: number; txval: number; camt: number; samt: number; rt: number }> = {};

    for (const order of orders as any[]) {
      for (const item of order.items) {
        const rt      = +(item.taxPercent || 0);
        const taxable = +(item.price * item.quantity).toFixed(2);
        const taxAmt  = +(item.taxAmount || 0);
        const total   = +(taxable + taxAmt).toFixed(2);
        const half    = +(taxAmt / 2).toFixed(4);

        // B2CS: group by tax rate (skip 0% items — not required in GSTR-1 B2CS)
        if (rt > 0) {
          if (!taxMap[rt]) taxMap[rt] = { txval: 0, camt: 0, samt: 0 };
          taxMap[rt].txval += taxable;
          taxMap[rt].camt  += half;
          taxMap[rt].samt  += half;
        }

        // HSN: group by product hsnCode (SAC 9963 default)
        const product  = item.product as any;
        const hsnCode  = ((product?.hsnCode || '') as string).trim() || '9963';
        const hsnDesc  = hsnCode === '9963' ? 'Restaurant Services' : (product?.name || 'Food & Beverages');
        if (!hsnMap[hsnCode]) hsnMap[hsnCode] = { desc: hsnDesc, qty: 0, val: 0, txval: 0, camt: 0, samt: 0, rt };
        hsnMap[hsnCode].qty   += item.quantity;
        hsnMap[hsnCode].txval += taxable;
        hsnMap[hsnCode].val   += total;
        hsnMap[hsnCode].camt  += half;
        hsnMap[hsnCode].samt  += half;
      }
    }

    const b2cs = Object.entries(taxMap).map(([rateStr, v]) => ({
      camt:    +v.camt.toFixed(2),
      csamt:   0,
      iamt:    0,
      pos:     stateCode,
      rt:      parseFloat(rateStr),
      samt:    +v.samt.toFixed(2),
      sply_ty: 'INTRA',
      txval:   +v.txval.toFixed(2),
      typ:     'OE',
    }));

    const hsnB2c = Object.entries(hsnMap).map(([hsn_sc, v], idx) => ({
      num:    idx + 1,
      hsn_sc,
      desc:   v.desc,
      uqc:    'OTH',
      qty:    v.qty,
      val:    +v.val.toFixed(2),
      txval:  +v.txval.toFixed(2),
      iamt:   0,
      camt:   +v.camt.toFixed(2),
      samt:   +v.samt.toFixed(2),
      csamt:  0,
      rt:     v.rt,
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
    console.error('GSTR-1 JSON error:', err);
    sendError(res, 500, 'Failed to generate GSTR-1 JSON', err);
  }
});

export default router;
