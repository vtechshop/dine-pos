import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import Order from '../models/Order';
import mongoose from 'mongoose';

const router = Router();

// GET /api/reports/gst?from=YYYY-MM-DD&to=YYYY-MM-DD
// Groups non-cancelled order items by tax rate, returns CGST/SGST breakdown
router.get('/gst', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
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
    res.status(500).json({ error: 'Failed to generate GST report' });
  }
});

export default router;
