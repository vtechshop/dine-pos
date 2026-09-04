/**
 * Purchase Invoice Routes  (Vendor Bills)
 * Mount point: /api/purchase-invoices
 *
 * Endpoints:
 *   GET  /                         — list invoices (admin)
 *   POST /                         — create invoice (admin)
 *   GET  /:id                      — invoice detail (admin)
 *   PATCH /:id                     — update invoice (admin, draft only)
 *   POST /:id/verify               — mark as verified (admin)
 *   POST /:id/mark-paid            — mark as paid (admin)
 *   DELETE /:id                    — cancel invoice (admin)
 *   POST /:id/attachments          — upload attachment URL (admin)
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import {
  authMiddleware, requireAdmin, AuthRequest,
} from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { sendError } from '../utils/sendError';
import PurchaseInvoice from '../models/PurchaseInvoice';
import Vendor from '../models/Vendor';
import GRN from '../models/GRN';
import DailyCounter from '../models/DailyCounter';
import { logAudit } from '../utils/audit';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('supplyChain'));

async function generateInvoiceNumber(hotelId: string): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 7).replace('-', '');
  const key     = `PINV-${dateStr}-${hotelId}`;
  const counter = await DailyCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 }, $setOnInsert: { key } },
    { upsert: true, new: true },
  );
  return `PINV-${dateStr}-${String(counter!.seq).padStart(4, '0')}`;
}

// ── List ──────────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId);
    const { page = '1', limit = '30', status, vendorId, from, to } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));

    const filter: Record<string, any> = { hotelId, isDeleted: false };
    if (status)   filter.status   = status;
    if (vendorId) filter.vendorId = new mongoose.Types.ObjectId(vendorId);
    if (from || to) {
      filter.invoiceDate = {};
      if (from) { const d = new Date(from); d.setHours(0,0,0,0); filter.invoiceDate.$gte = d; }
      if (to)   { const d = new Date(to);   d.setHours(23,59,59,999); filter.invoiceDate.$lte = d; }
    }

    const [invoices, total] = await Promise.all([
      PurchaseInvoice.find(filter)
        .sort({ invoiceDate: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select('-attachments')
        .lean(),
      PurchaseInvoice.countDocuments(filter),
    ]);

    res.json({ invoices, total, page: pageNum, limit: limitNum });
  } catch (err) {
    sendError(res, 500, 'Failed to list invoices', err);
  }
});

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      vendorId, vendorInvoiceNo, invoiceDate,
      grnIds, subtotal, taxBreakup, taxTotal,
      freight, otherCharges, discount, grandTotal, notes,
    } = req.body as Record<string, any>;

    if (!vendorId || subtotal === undefined || grandTotal === undefined) {
      res.status(400).json({ message: 'vendorId, subtotal, grandTotal are required' });
      return;
    }

    const hotelId    = new mongoose.Types.ObjectId(req.hotelId);
    const vendor     = await Vendor.findOne({ _id: vendorId, hotelId, isDeleted: false });
    if (!vendor) { res.status(404).json({ message: 'Vendor not found' }); return; }

    let grnDocs: any[] = [];
    let grnNumbers: string[] = [];
    if (Array.isArray(grnIds) && grnIds.length > 0) {
      grnDocs    = await GRN.find({ _id: { $in: grnIds }, hotelId }).lean();
      grnNumbers = grnDocs.map(g => g.grnNumber);
    }

    const computedTotal = Math.round((
      (Number(subtotal) || 0) +
      (Number(taxTotal) || 0) +
      (Number(freight) || 0) +
      (Number(otherCharges) || 0) -
      (Number(discount) || 0)
    ) * 100) / 100;
    if (Math.abs(computedTotal - Number(grandTotal)) > 1) {
      res.status(400).json({ message: `grandTotal ₹${Number(grandTotal).toFixed(2)} does not match computed ₹${computedTotal.toFixed(2)}` });
      return;
    }

    const invoiceNumber = await generateInvoiceNumber(req.hotelId!);

    const invoice = await PurchaseInvoice.create({
      hotelId,
      invoiceNumber,
      vendorInvoiceNo:  vendorInvoiceNo ? String(vendorInvoiceNo).trim() : '',
      invoiceDate:      invoiceDate ? new Date(invoiceDate) : new Date(),
      vendorId:         vendor._id,
      vendorSnapshot: {
        businessName: vendor.businessName,
        gstNumber:    vendor.gstNumber,
        pan:          vendor.pan,
        vendorCode:   vendor.vendorCode,
      },
      grnIds:       grnDocs.map(g => g._id),
      grnNumbers,
      subtotal:     Number(subtotal),
      taxBreakup:   Array.isArray(taxBreakup) ? taxBreakup : [],
      taxTotal:     Number(taxTotal) || 0,
      freight:      Number(freight) || 0,
      otherCharges: Number(otherCharges) || 0,
      discount:     Number(discount) || 0,
      grandTotal:   Number(grandTotal),
      status:       'draft',
      notes:        notes ? String(notes).trim().slice(0, 1000) : '',
      createdBy:    `admin:${req.hotelId}`,
    });

    logAudit(req, 'purchaseinvoice.create', 'PurchaseInvoice', invoice._id.toString(), { invoiceNumber, vendorId, grandTotal });
    res.status(201).json({ invoice });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ message: 'Invoice number collision — try again' });
      return;
    }
    sendError(res, 500, 'Failed to create invoice', err);
  }
});

// ── Detail ────────────────────────────────────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const invoice = await PurchaseInvoice.findOne({
      _id: req.params.id,
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      isDeleted: false,
    }).lean();
    if (!invoice) { res.status(404).json({ message: 'Invoice not found' }); return; }
    res.json({ invoice });
  } catch (err) {
    sendError(res, 500, 'Failed to fetch invoice', err);
  }
});

// ── Update (draft only) ───────────────────────────────────────────────────────

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const invoice = await PurchaseInvoice.findOne({
      _id: req.params.id,
      hotelId: new mongoose.Types.ObjectId(req.hotelId),
      isDeleted: false,
    });
    if (!invoice) { res.status(404).json({ message: 'Invoice not found' }); return; }
    if (invoice.status !== 'draft') {
      res.status(409).json({ message: `Cannot edit invoice in "${invoice.status}" status` });
      return;
    }

    const allowed = ['vendorInvoiceNo', 'invoiceDate', 'subtotal', 'taxBreakup', 'taxTotal', 'freight', 'otherCharges', 'discount', 'grandTotal', 'notes'] as const;
    for (const key of allowed) {
      if (req.body[key] !== undefined) (invoice as any)[key] = req.body[key];
    }
    await invoice.save();

    logAudit(req, 'purchaseinvoice.update', 'PurchaseInvoice', invoice._id.toString(), { fields: Object.keys(req.body) });
    res.json({ invoice });
  } catch (err) {
    sendError(res, 500, 'Failed to update invoice', err);
  }
});

// ── Verify ────────────────────────────────────────────────────────────────────

router.post('/:id/verify', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const invoice = await PurchaseInvoice.findOneAndUpdate(
      { _id: req.params.id, hotelId: new mongoose.Types.ObjectId(req.hotelId), status: 'draft', isDeleted: false },
      { $set: { status: 'verified', verifiedBy: `admin:${req.hotelId}`, verifiedAt: new Date() } },
      { new: true },
    );
    if (!invoice) { res.status(404).json({ message: 'Invoice not found or not in draft status' }); return; }
    logAudit(req, 'purchaseinvoice.verify', 'PurchaseInvoice', invoice._id.toString(), {});
    res.json({ invoice });
  } catch (err) {
    sendError(res, 500, 'Failed to verify invoice', err);
  }
});

// ── Mark paid ─────────────────────────────────────────────────────────────────

router.post('/:id/mark-paid', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { paymentRef } = req.body as { paymentRef?: string };
    const invoice = await PurchaseInvoice.findOneAndUpdate(
      {
        _id: req.params.id,
        hotelId: new mongoose.Types.ObjectId(req.hotelId),
        status: 'verified',
        isDeleted: false,
      },
      { $set: { status: 'paid', paidAt: new Date(), paymentRef: paymentRef || '' } },
      { new: true },
    );
    if (!invoice) { res.status(404).json({ message: 'Invoice not found or already in terminal status' }); return; }
    logAudit(req, 'purchaseinvoice.paid', 'PurchaseInvoice', invoice._id.toString(), { paymentRef });
    res.json({ invoice });
  } catch (err) {
    sendError(res, 500, 'Failed to mark invoice as paid', err);
  }
});

// ── Cancel ────────────────────────────────────────────────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { reason } = req.body as { reason?: string };
    const invoice = await PurchaseInvoice.findOneAndUpdate(
      {
        _id: req.params.id,
        hotelId: new mongoose.Types.ObjectId(req.hotelId),
        status: { $in: ['draft', 'verified'] },
        isDeleted: false,
      },
      { $set: { status: 'cancelled', cancelReason: reason || '', isDeleted: true } },
      { new: true },
    );
    if (!invoice) { res.status(404).json({ message: 'Invoice not found or already paid/cancelled' }); return; }
    logAudit(req, 'purchaseinvoice.cancel', 'PurchaseInvoice', invoice._id.toString(), { reason });
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to cancel invoice', err);
  }
});

// ── Add attachment (URL only — upload handled by /uploads endpoint) ────────────

router.post('/:id/attachments', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { filename, url, fileSize, mimeType } = req.body as Record<string, any>;
    if (!filename || !url) { res.status(400).json({ message: 'filename and url are required' }); return; }

    const invoice = await PurchaseInvoice.findOneAndUpdate(
      { _id: req.params.id, hotelId: new mongoose.Types.ObjectId(req.hotelId), isDeleted: false },
      {
        $push: {
          attachments: {
            filename:   String(filename),
            url:        String(url),
            fileSize:   Number(fileSize) || 0,
            mimeType:   String(mimeType || ''),
            uploadedAt: new Date(),
            uploadedBy: `admin:${req.hotelId}`,
          },
        },
      },
      { new: true, select: 'attachments' },
    );
    if (!invoice) { res.status(404).json({ message: 'Invoice not found' }); return; }
    res.json({ attachments: invoice.attachments });
  } catch (err) {
    sendError(res, 500, 'Failed to add attachment', err);
  }
});

export default router;
