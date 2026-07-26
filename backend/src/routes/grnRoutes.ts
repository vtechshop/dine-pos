import { Router, Response } from 'express';
import mongoose from 'mongoose';
import GRN from '../models/GRN';
import PurchaseOrder from '../models/PurchaseOrder';
import Ingredient from '../models/Ingredient';
import DailyCounter from '../models/DailyCounter';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);

const RECEIVABLE_STATUSES = ['approved', 'sent', 'partially_received'];
const VALID_SORT = new Set(['receiveDate', 'grnNumber', 'status', 'createdAt']);

// ── GET /report ───────────────────────────────────────────────────────────────

router.get('/report', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const matchBase: Record<string, unknown> = { hotelId: req.hotelId, isDeleted: false };
    if (from || to) {
      const dateRange: Record<string, Date> = {};
      if (from) dateRange.$gte = new Date(String(from));
      if (to)   dateRange.$lte = new Date(new Date(String(to)).setHours(23, 59, 59, 999));
      matchBase.receiveDate = dateRange;
    }

    const [statusAgg, itemAgg, vendorAgg, monthAgg, pendingPOs] = await Promise.all([
      GRN.aggregate([
        { $match: matchBase },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      GRN.aggregate([
        { $match: matchBase },
        { $unwind: { path: '$items', preserveNullAndEmptyArrays: false } },
        { $group: {
          _id: null,
          totalReceived: { $sum: '$items.receivedQty' },
          totalDamaged:  { $sum: '$items.damagedQty' },
          totalRejected: { $sum: '$items.rejectedQty' },
        }},
      ]),
      GRN.aggregate([
        { $match: matchBase },
        { $group: {
          _id: '$vendorId',
          businessName:  { $first: '$vendorSnapshot.businessName' },
          grnCount:      { $sum: 1 },
          totalReceived: { $sum: { $reduce: { input: '$items', initialValue: 0, in: { $add: ['$$value', '$$this.receivedQty'] } } } },
          totalDamaged:  { $sum: { $reduce: { input: '$items', initialValue: 0, in: { $add: ['$$value', '$$this.damagedQty'] } } } },
        }},
        { $sort: { grnCount: -1 } },
        { $limit: 10 },
      ]),
      GRN.aggregate([
        { $match: matchBase },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$receiveDate' } },
          grnCount:      { $sum: 1 },
          totalReceived: { $sum: { $reduce: { input: '$items', initialValue: 0, in: { $add: ['$$value', '$$this.receivedQty'] } } } },
        }},
        { $sort: { _id: -1 } },
        { $limit: 12 },
      ]),
      PurchaseOrder.countDocuments({
        hotelId: req.hotelId,
        isDeleted: false,
        status: { $in: RECEIVABLE_STATUSES },
      }),
    ]);

    let totalGRNs = 0, partialCount = 0, completedCount = 0, cancelledCount = 0, pendingCount = 0;
    for (const s of statusAgg) {
      totalGRNs += s.count;
      if (s._id === 'partial')   partialCount   = s.count;
      if (s._id === 'completed') completedCount = s.count;
      if (s._id === 'cancelled') cancelledCount = s.count;
      if (s._id === 'pending')   pendingCount   = s.count;
    }
    const totals = itemAgg[0] ?? { totalReceived: 0, totalDamaged: 0, totalRejected: 0 };

    return res.json({
      totalGRNs, pendingCount, partialCount, completedCount, cancelledCount,
      totalReceived: totals.totalReceived,
      totalDamaged:  totals.totalDamaged,
      totalRejected: totals.totalRejected,
      pendingPOs,
      byVendor: vendorAgg,
      byMonth:  monthAgg,
    });
  } catch (err) {
    return sendError(res, 500, 'Report failed', err);
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { search, status, poId, vendorId, from, to, sort = 'receiveDate', dir = 'desc', limit = '50', skip = '0' } = req.query;

    const filter: Record<string, unknown> = { hotelId: req.hotelId, isDeleted: false };
    if (status)   filter.status  = String(status);
    if (poId)     filter.poId    = new mongoose.Types.ObjectId(String(poId));
    if (vendorId) filter.vendorId = new mongoose.Types.ObjectId(String(vendorId));

    if (from || to) {
      const dr: Record<string, Date> = {};
      if (from) dr.$gte = new Date(String(from));
      if (to)   dr.$lte = new Date(new Date(String(to)).setHours(23, 59, 59, 999));
      filter.receiveDate = dr;
    }

    if (search) {
      const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ grnNumber: re }, { poNumber: re }, { 'vendorSnapshot.businessName': re }, { notes: re }];
    }

    const sortField = VALID_SORT.has(String(sort)) ? String(sort) : 'receiveDate';
    const sortDir   = String(dir) === 'asc' ? 1 : -1;
    const lim       = Math.min(Math.max(1, parseInt(String(limit), 10) || 50), 200);
    const sk        = Math.max(0, parseInt(String(skip), 10) || 0);

    const [grns, total] = await Promise.all([
      GRN.find(filter).sort({ [sortField]: sortDir }).skip(sk).limit(lim).lean(),
      GRN.countDocuments(filter),
    ]);

    return res.json({ grns, total, limit: lim, skip: sk });
  } catch (err) {
    return sendError(res, 500, 'Failed to list GRNs', err);
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const grn = await GRN.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false }).lean();
    if (!grn) return sendError(res, 404, 'GRN not found');
    return res.json(grn);
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch GRN', err);
  }
});

// ── POST / — Create GRN (receive goods against PO) ───────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { poId, receiveDate, notes, items } = req.body;

    if (!poId) return sendError(res, 400, 'poId is required');
    if (!Array.isArray(items) || items.length === 0) return sendError(res, 400, 'items array is required');

    const po = await PurchaseOrder.findOne({ _id: poId, hotelId: req.hotelId, isDeleted: false });
    if (!po) return sendError(res, 404, 'Purchase Order not found');
    if (!RECEIVABLE_STATUSES.includes(po.status)) {
      return sendError(res, 409, `Cannot receive against PO in status "${po.status}". Must be approved, sent, or partially_received.`);
    }

    // Generate GRN number
    const counter = await DailyCounter.findOneAndUpdate(
      { key: `GRN-${req.hotelId}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const grnNumber = `GRN-${String(counter.seq).padStart(4, '0')}`;

    // Process items, accumulate PO receivedQty
    const processedItems: Array<Record<string, unknown>> = [];
    const inventoryOps: Array<() => Promise<unknown>> = [];

    for (const raw of items) {
      const receivedQty  = Math.max(0, Number(raw.receivedQty) || 0);
      const damagedQty   = Math.max(0, Number(raw.damagedQty) || 0);
      const rejectedQty  = Math.max(0, Number(raw.rejectedQty) || 0);
      const orderedQty   = Math.max(0, Number(raw.orderedQty) || 0);
      const acceptedQty  = Math.max(0, receivedQty - damagedQty - rejectedQty);

      // Update PO item cumulative receivedQty
      const poIdx = raw.poItemIndex !== undefined ? Number(raw.poItemIndex) : -1;
      let cumulativeReceived = receivedQty;
      if (poIdx >= 0 && poIdx < po.items.length) {
        po.items[poIdx].receivedQty = (po.items[poIdx].receivedQty || 0) + receivedQty;
        cumulativeReceived = po.items[poIdx].receivedQty;
      }

      const pendingQty = Math.max(0, orderedQty - cumulativeReceived);

      processedItems.push({
        poItemIndex:      poIdx >= 0 ? poIdx : undefined,
        productId:        raw.productId ? new mongoose.Types.ObjectId(String(raw.productId)) : null,
        ingredientId:     raw.ingredientId ? new mongoose.Types.ObjectId(String(raw.ingredientId)) : null,
        productName:      String(raw.productName || ''),
        variantId:        String(raw.variantId || ''),
        variantName:      String(raw.variantName || ''),
        orderedQty,
        receivedQty,
        damagedQty,
        rejectedQty,
        pendingQty,
        unit:             String(raw.unit || 'pcs'),
        purchasePrice:    Math.max(0, Number(raw.purchasePrice) || 0),
        batchNumber:      String(raw.batchNumber || ''),
        manufacturingDate: raw.manufacturingDate ? new Date(String(raw.manufacturingDate)) : null,
        expiryDate:       raw.expiryDate ? new Date(String(raw.expiryDate)) : null,
        warehouse:        String(raw.warehouse || ''),
        notes:            String(raw.notes || ''),
      });

      // Queue inventory update (only on accepted qty)
      if (acceptedQty > 0) {
        if (raw.ingredientId) {
          const iId = new mongoose.Types.ObjectId(String(raw.ingredientId));
          inventoryOps.push(() =>
            Ingredient.updateOne({ _id: iId, hotelId: req.hotelId }, { $inc: { currentStock: acceptedQty } }),
          );
        }
        // Product.stock update omitted — product stock is managed through Ingredient recipes
        // in this system; PO items use productId only as a reference, not a finished-goods counter
      }
    }

    // Mark Mongoose nested array dirty
    po.markModified('items');

    // Determine new PO status
    const allReceived = po.items.every(pi => (pi.receivedQty || 0) >= pi.orderedQty);
    const anyReceived = po.items.some(pi => (pi.receivedQty || 0) > 0);
    if (allReceived)       po.status = 'received';
    else if (anyReceived)  po.status = 'partially_received';
    await po.save();

    // Create GRN
    const grn = await GRN.create({
      hotelId:       req.hotelId,
      grnNumber,
      poId:          po._id,
      poNumber:      po.poNumber,
      vendorId:      po.vendorId,
      vendorSnapshot: po.vendorSnapshot,
      receiveDate:   receiveDate ? new Date(String(receiveDate)) : new Date(),
      status:        allReceived ? 'completed' : 'partial',
      items:         processedItems,
      notes:         String(notes || ''),
      receivedBy:    String(req.cashierId || req.waiterId || ''),
      cancelReason:  '',
      isDeleted:     false,
    });

    // Fire inventory updates in parallel (non-blocking audit)
    await Promise.all(inventoryOps.map(fn => fn()));

    logAudit(req, 'grn.created', 'grn', String(grn._id), {
      grnNumber,
      poNumber: po.poNumber,
      grnStatus: grn.status,
      newPOStatus: po.status,
      itemCount: items.length,
    });

    return res.status(201).json(grn);
  } catch (err) {
    return sendError(res, 500, 'Failed to create GRN', err);
  }
});

// ── POST /:id/cancel ──────────────────────────────────────────────────────────

router.post('/:id/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const grn = await GRN.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!grn) return sendError(res, 404, 'GRN not found');
    if (grn.status === 'cancelled') return sendError(res, 409, 'GRN is already cancelled');

    grn.status = 'cancelled';
    grn.cancelReason = String(req.body.reason || '');
    await grn.save();

    logAudit(req, 'grn.cancelled', 'grn', String(grn._id), {
      grnNumber:    grn.grnNumber,
      cancelReason: grn.cancelReason,
    });

    return res.json(grn);
  } catch (err) {
    return sendError(res, 500, 'Failed to cancel GRN', err);
  }
});

export default router;
