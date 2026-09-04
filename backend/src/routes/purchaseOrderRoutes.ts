import { Router, Response } from 'express';
import mongoose from 'mongoose';
import PurchaseOrder, { POStatus } from '../models/PurchaseOrder';
import Vendor from '../models/Vendor';
import DailyCounter from '../models/DailyCounter';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware);
router.use(requireAdmin);
router.use(requireFeature('supplyChain'));

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeTotals(
  rawItems: Array<{
    productId?: string;
    productName: string;
    variantId?: string;
    variantName?: string;
    orderedQty: number;
    receivedQty?: number;
    unit?: string;
    unitPrice: number;
    discount?: number;
    taxPercent?: number;
    notes?: string;
  }>,
  poDiscount = 0,
  poTax = 0,
  shipping = 0,
) {
  let subtotal = 0;
  let taxTotalAcc = 0;

  const items = rawItems.map(item => {
    const base        = (item.unitPrice || 0) * (item.orderedQty || 0);
    const itemDisc    = Math.max(0, item.discount || 0);
    const netBase     = Math.max(0, base - itemDisc);
    const taxAmt      = Math.round(netBase * (item.taxPercent || 0)) / 100;
    const lineTotal   = Math.round((netBase + taxAmt) * 100) / 100;
    subtotal    += Math.round(netBase * 100) / 100;
    taxTotalAcc += Math.round(taxAmt * 100) / 100;
    return {
      ...item,
      orderedQty:  item.orderedQty  || 0,
      receivedQty: item.receivedQty || 0,
      unitPrice:   item.unitPrice   || 0,
      discount:    itemDisc,
      taxPercent:  item.taxPercent  || 0,
      lineTotal,
    };
  });

  const total = Math.max(
    0,
    Math.round((subtotal + taxTotalAcc - Math.max(0, poDiscount) + Math.max(0, poTax) + Math.max(0, shipping)) * 100) / 100,
  );

  return {
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    taxTotal: Math.round(taxTotalAcc * 100) / 100,
    total,
  };
}

const EDITABLE_STATUSES: POStatus[] = ['draft', 'pending_approval'];
const DELETABLE_STATUSES: POStatus[] = ['draft'];
const APPROVABLE_STATUSES: POStatus[] = ['draft', 'pending_approval'];
const SUBMITTABLE_STATUSES: POStatus[] = ['draft'];
const SENDABLE_STATUSES: POStatus[] = ['approved'];
const CANCELLABLE_STATUSES: POStatus[] = ['draft', 'pending_approval', 'approved', 'sent'];

const ALLOWED_SORT = new Set(['orderDate', 'poNumber', 'total', 'status', 'createdAt']);

// ── GET /report — summary (must precede /:id) ─────────────────────────────────
router.get('/report', async (req: AuthRequest, res: Response) => {
  try {
    const hotelObjId = new mongoose.Types.ObjectId(req.hotelId);
    const base = { hotelId: hotelObjId, isDeleted: false };

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to   = req.query.to   ? new Date(String(req.query.to))   : null;
    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.$gte = from;
    if (to)   { (to as Date).setHours(23, 59, 59, 999); dateFilter.$lte = to; }
    const dateQ = Object.keys(dateFilter).length ? { orderDate: dateFilter } : {};

    const matchQ = { ...base, ...dateQ };

    const [statusCounts, financials, byVendor, byMonth] = await Promise.all([
      // Status breakdown
      PurchaseOrder.aggregate([
        { $match: matchQ },
        { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } },
      ]),
      // Overall financials
      PurchaseOrder.aggregate([
        { $match: { ...matchQ, status: { $ne: 'cancelled' } } },
        { $group: {
          _id: null,
          totalValue:   { $sum: '$total' },
          pendingValue: { $sum: {
            $cond: [{ $in: ['$status', ['pending_approval', 'approved', 'sent']] }, '$total', 0],
          }},
          totalPOs: { $sum: 1 },
        }},
      ]),
      // By vendor
      PurchaseOrder.aggregate([
        { $match: { ...matchQ, status: { $ne: 'cancelled' } } },
        { $group: {
          _id:        '$vendorId',
          businessName: { $first: '$vendorSnapshot.businessName' },
          poCount:    { $sum: 1 },
          totalValue: { $sum: '$total' },
        }},
        { $sort: { totalValue: -1 } },
        { $limit: 10 },
      ]),
      // By month (last 6 months)
      PurchaseOrder.aggregate([
        { $match: { ...base, status: { $ne: 'cancelled' } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$orderDate' } },
          poCount:    { $sum: 1 },
          totalValue: { $sum: '$total' },
        }},
        { $sort: { _id: -1 } },
        { $limit: 6 },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const counts: Record<string, number> = {};
    const values: Record<string, number> = {};
    for (const row of statusCounts) {
      counts[String(row._id)] = row.count as number;
      values[String(row._id)] = row.value as number;
    }

    const fin = financials[0] ?? { totalValue: 0, pendingValue: 0, totalPOs: 0 };

    res.json({
      totalPOs:          fin.totalPOs ?? 0,
      draftCount:        counts.draft             ?? 0,
      pendingCount:      counts.pending_approval  ?? 0,
      approvedCount:     counts.approved          ?? 0,
      sentCount:         counts.sent              ?? 0,
      partialCount:      counts.partially_received ?? 0,
      receivedCount:     counts.received          ?? 0,
      cancelledCount:    counts.cancelled         ?? 0,
      totalValue:        fin.totalValue  ?? 0,
      pendingValue:      fin.pendingValue ?? 0,
      byVendor,
      byMonth,
    });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── GET / — list ──────────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = { hotelId: req.hotelId, isDeleted: false };

    if (req.query.search) {
      const re = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { poNumber: re },
        { 'vendorSnapshot.businessName': re },
        { notes: re },
      ];
    }

    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.vendorId && mongoose.Types.ObjectId.isValid(String(req.query.vendorId))) {
      filter.vendorId = new mongoose.Types.ObjectId(String(req.query.vendorId));
    }

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to   = req.query.to   ? new Date(String(req.query.to))   : null;
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.$gte = from;
      if (to)   { to.setHours(23, 59, 59, 999); dateFilter.$lte = to; }
      filter.orderDate = dateFilter;
    }

    const limit   = Math.min(parseInt(String(req.query.limit || '50'))  || 50,  200);
    const skip    = Math.max(parseInt(String(req.query.skip  || '0'))   || 0,   0);
    const sortKey = ALLOWED_SORT.has(String(req.query.sort)) ? String(req.query.sort) : 'orderDate';
    const sortDir = req.query.dir === 'asc' ? 1 : -1;

    const [purchaseOrders, total] = await Promise.all([
      PurchaseOrder.find(filter)
        .sort({ [sortKey]: sortDir })
        .skip(skip)
        .limit(limit)
        .lean(),
      PurchaseOrder.countDocuments(filter),
    ]);

    res.json({ purchaseOrders, total, limit, skip });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── GET /:id — single ─────────────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const po = await PurchaseOrder.findOne({
      _id: req.params.id, hotelId: req.hotelId, isDeleted: false,
    }).lean();
    if (!po) return res.status(404).json({ message: 'Purchase order not found' });
    res.json(po);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { vendorId, items, discount, tax, shipping, status, ...rest } = req.body;

    if (!vendorId) return res.status(400).json({ message: 'Vendor is required' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'At least one item is required' });
    }

    const vendor = await Vendor.findOne({ _id: vendorId, hotelId: req.hotelId, isDeleted: false }).lean();
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const initialStatus: POStatus = (['draft', 'pending_approval'] as POStatus[]).includes(status)
      ? status as POStatus
      : 'draft';

    const counter = await DailyCounter.findOneAndUpdate(
      { key: `PO-${req.hotelId}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const poNumber = `PO-${String(counter.seq).padStart(4, '0')}`;

    const { items: computedItems, subtotal, taxTotal, total } = computeTotals(
      items, discount, tax, shipping,
    );

    const po = await PurchaseOrder.create({
      ...rest,
      hotelId: req.hotelId,
      poNumber,
      vendorId,
      vendorSnapshot: {
        businessName: vendor.businessName,
        vendorCode:   vendor.vendorCode,
        mobile:       vendor.mobile,
        gstNumber:    vendor.gstNumber,
      },
      status: initialStatus,
      items:    computedItems,
      subtotal,
      taxTotal,
      discount: Math.max(0, discount || 0),
      tax:      Math.max(0, tax || 0),
      shipping: Math.max(0, shipping || 0),
      total,
      createdBy: req.hotelId ?? '',
      updatedBy: req.hotelId ?? '',
    });

    logAudit(req, 'po.created', 'purchase_order', String(po._id), {
      poNumber: po.poNumber, vendorId, total: po.total,
    });
    res.status(201).json(po);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── PUT /:id — update (draft/pending_approval only) ───────────────────────────
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await PurchaseOrder.findOne({
      _id: req.params.id, hotelId: req.hotelId, isDeleted: false,
    });
    if (!existing) return res.status(404).json({ message: 'Purchase order not found' });
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      return res.status(409).json({ message: `Cannot edit a PO in "${existing.status}" status` });
    }

    const { poNumber: _pn, hotelId: _h, isDeleted: _d, createdBy: _c,
      status: _s, approvedBy: _ab, approvedAt: _aat, cancelReason: _cr,
      vendorId, items, discount, tax, shipping, ...rest } = req.body;

    // Re-resolve vendor if changed
    const resolvedVendorId = vendorId ?? String(existing.vendorId);
    if (vendorId && String(vendorId) !== String(existing.vendorId)) {
      const vendor = await Vendor.findOne({ _id: vendorId, hotelId: req.hotelId, isDeleted: false }).lean();
      if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
      existing.vendorId = new mongoose.Types.ObjectId(vendorId);
      existing.vendorSnapshot = {
        businessName: vendor.businessName,
        vendorCode:   vendor.vendorCode,
        mobile:       vendor.mobile,
        gstNumber:    vendor.gstNumber,
      };
    }

    const rawItems = Array.isArray(items) ? items : existing.items;
    const { items: computedItems, subtotal, taxTotal, total } = computeTotals(
      rawItems as any,
      discount ?? existing.discount,
      tax      ?? existing.tax,
      shipping ?? existing.shipping,
    );

    Object.assign(existing, {
      ...rest,
      vendorId: resolvedVendorId,
      items:    computedItems,
      subtotal,
      taxTotal,
      discount: Math.max(0, discount ?? existing.discount),
      tax:      Math.max(0, tax      ?? existing.tax),
      shipping: Math.max(0, shipping ?? existing.shipping),
      total,
      updatedBy: req.hotelId ?? '',
    });

    await existing.save();

    logAudit(req, 'po.updated', 'purchase_order', req.params.id, { poNumber: existing.poNumber });
    res.json(existing);
  } catch (error) {
    sendError(res, 400, 'Invalid data', error);
  }
});

// ── DELETE /:id — soft delete (draft only) ────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const po = await PurchaseOrder.findOne({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!po) return res.status(404).json({ message: 'Purchase order not found' });
    if (!DELETABLE_STATUSES.includes(po.status)) {
      return res.status(409).json({ message: 'Only draft purchase orders can be deleted' });
    }

    po.isDeleted = true;
    po.updatedBy = req.hotelId ?? '';
    await po.save();

    logAudit(req, 'po.deleted', 'purchase_order', req.params.id, { poNumber: po.poNumber });
    res.json({ message: 'Purchase order deleted' });
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /:id/submit — draft → pending_approval ───────────────────────────────
// B-17: Atomic findOneAndUpdate with status precondition eliminates the TOCTOU window
// between "check status" and "save new status".
router.post('/:id/submit', async (req: AuthRequest, res: Response) => {
  try {
    const po = await PurchaseOrder.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false, status: { $in: SUBMITTABLE_STATUSES } },
      { $set: { status: 'pending_approval', updatedBy: req.hotelId ?? '' } },
      { new: true },
    );
    if (!po) {
      const exists = await PurchaseOrder.exists({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
      return res.status(exists ? 409 : 404).json({
        message: exists ? `PO cannot be submitted from its current status` : 'Purchase order not found',
      });
    }
    logAudit(req, 'po.submitted', 'purchase_order', req.params.id, { poNumber: po.poNumber });
    res.json(po);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /:id/approve — pending_approval|draft → approved ─────────────────────
router.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const po = await PurchaseOrder.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false, status: { $in: APPROVABLE_STATUSES } },
      { $set: { status: 'approved', approvedBy: req.hotelId ?? '', approvedAt: now, updatedBy: req.hotelId ?? '' } },
      { new: true },
    );
    if (!po) {
      const exists = await PurchaseOrder.exists({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
      return res.status(exists ? 409 : 404).json({
        message: exists ? `PO cannot be approved from its current status` : 'Purchase order not found',
      });
    }
    logAudit(req, 'po.approved', 'purchase_order', req.params.id, { poNumber: po.poNumber });
    res.json(po);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /:id/send — approved → sent ─────────────────────────────────────────
router.post('/:id/send', async (req: AuthRequest, res: Response) => {
  try {
    const po = await PurchaseOrder.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false, status: { $in: SENDABLE_STATUSES } },
      { $set: { status: 'sent', updatedBy: req.hotelId ?? '' } },
      { new: true },
    );
    if (!po) {
      const exists = await PurchaseOrder.exists({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
      return res.status(exists ? 409 : 404).json({
        message: exists ? `PO cannot be sent from its current status` : 'Purchase order not found',
      });
    }
    logAudit(req, 'po.sent', 'purchase_order', req.params.id, { poNumber: po.poNumber });
    res.json(po);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /:id/cancel ──────────────────────────────────────────────────────────
router.post('/:id/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const cancelReason = String(req.body.reason || '').trim();
    const po = await PurchaseOrder.findOneAndUpdate(
      { _id: req.params.id, hotelId: req.hotelId, isDeleted: false, status: { $in: CANCELLABLE_STATUSES } },
      { $set: { status: 'cancelled', cancelReason, updatedBy: req.hotelId ?? '' } },
      { new: true },
    );
    if (!po) {
      const exists = await PurchaseOrder.exists({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
      return res.status(exists ? 409 : 404).json({
        message: exists ? `PO cannot be cancelled from its current status` : 'Purchase order not found',
      });
    }
    logAudit(req, 'po.cancelled', 'purchase_order', req.params.id, {
      poNumber: po.poNumber, reason: cancelReason,
    });
    res.json(po);
  } catch (error) {
    sendError(res, 500, 'Server error', error);
  }
});

// ── POST /:id/duplicate — clone as new draft ──────────────────────────────────
router.post('/:id/duplicate', async (req: AuthRequest, res: Response) => {
  try {
    const source = await PurchaseOrder.findOne({
      _id: req.params.id, hotelId: req.hotelId, isDeleted: false,
    }).lean();
    if (!source) return res.status(404).json({ message: 'Purchase order not found' });

    const counter = await DailyCounter.findOneAndUpdate(
      { key: `PO-${req.hotelId}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const poNumber = `PO-${String(counter.seq).padStart(4, '0')}`;

    const newPO = await PurchaseOrder.create({
      hotelId:              source.hotelId,
      poNumber,
      vendorId:             source.vendorId,
      vendorSnapshot:       source.vendorSnapshot,
      status:               'draft',
      orderDate:            new Date(),
      expectedDeliveryDate: null,
      currency:             source.currency,
      notes:                source.notes,
      items:                source.items.map(i => ({ ...i, receivedQty: 0 })),
      subtotal:             source.subtotal,
      taxTotal:             source.taxTotal,
      discount:             source.discount,
      tax:                  source.tax,
      shipping:             source.shipping,
      total:                source.total,
      createdBy:            req.hotelId ?? '',
      updatedBy:            req.hotelId ?? '',
      approvedBy:           '',
      approvedAt:           null,
      cancelReason:         '',
    });

    logAudit(req, 'po.duplicated', 'purchase_order', String(newPO._id), {
      sourcePO: source.poNumber, newPO: newPO.poNumber,
    });
    res.status(201).json(newPO);
  } catch (error) {
    sendError(res, 400, 'Duplicate failed', error);
  }
});

export default router;
