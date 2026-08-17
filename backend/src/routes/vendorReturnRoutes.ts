import { Router, Response } from 'express';
import mongoose from 'mongoose';
import VendorReturn from '../models/VendorReturn';
import VendorLedgerEntry from '../models/VendorLedgerEntry';
import Vendor from '../models/Vendor';
import GRN from '../models/GRN';
import Ingredient from '../models/Ingredient';
import StockMovement from '../models/StockMovement';
import DailyCounter from '../models/DailyCounter';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';

const router = Router();
router.use(authMiddleware, requireAdmin);

// ── GET / — List vendor returns ───────────────────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const {
      vendorId, grnId, status,
      from, to, search,
      sort = 'createdAt', dir = 'desc',
      limit = '50', skip = '0',
    } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { hotelId, isDeleted: false };
    if (vendorId) filter.vendorId = new mongoose.Types.ObjectId(vendorId);
    if (grnId)    filter.grnId    = new mongoose.Types.ObjectId(grnId);
    if (status)   filter.status   = status;

    if (from || to) {
      const dr: Record<string, Date> = {};
      if (from) dr.$gte = new Date(from);
      if (to)   dr.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
      filter.createdAt = dr;
    }

    if (search) {
      const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { returnNumber: re },
        { 'vendorSnapshot.businessName': re },
        { grnNumber: re },
        { poNumber: re },
      ];
    }

    const SORT_WHITELIST = new Set(['createdAt', 'returnNumber', 'returnValue', 'status']);
    const sortField = SORT_WHITELIST.has(sort) ? sort : 'createdAt';
    const sortDir   = dir === 'asc' ? 1 : -1;
    const lim       = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const sk        = Math.max(0, parseInt(skip, 10) || 0);

    const [returns, total] = await Promise.all([
      VendorReturn.find(filter).sort({ [sortField]: sortDir }).skip(sk).limit(lim).lean(),
      VendorReturn.countDocuments(filter),
    ]);

    return res.json({ returns, total, limit: lim, skip: sk });
  } catch (err) {
    return sendError(res, 500, 'Failed to list vendor returns', err);
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const vr = await VendorReturn.findOne({ _id: req.params.id, hotelId, isDeleted: false }).lean();
    if (!vr) return sendError(res, 404, 'Vendor return not found');
    return res.json(vr);
  } catch (err) {
    return sendError(res, 500, 'Failed to fetch vendor return', err);
  }
});

// ── POST / — Create draft ─────────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const { vendorId, grnId, items, notes } = req.body as Record<string, unknown>;

    if (!vendorId)                           return sendError(res, 400, 'vendorId is required');
    if (!grnId)                              return sendError(res, 400, 'grnId is required');
    if (!Array.isArray(items) || items.length === 0) return sendError(res, 400, 'items array is required');

    // Hotel-scoped idempotency
    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idemKey) {
      const existing = await VendorReturn.findOne({ hotelId, idempotencyKey: idemKey }).lean();
      if (existing) return res.status(201).json(existing);
    }

    // Validate vendor belongs to this hotel
    const vendor = await Vendor.findOne({ _id: String(vendorId), hotelId, isDeleted: false });
    if (!vendor) return sendError(res, 404, 'Vendor not found');

    // Validate GRN belongs to this hotel and matches vendor
    const grn = await GRN.findOne({ _id: String(grnId), hotelId, isDeleted: false }).lean();
    if (!grn) return sendError(res, 404, 'GRN not found');
    if (String(grn.vendorId) !== String(vendorId)) {
      return sendError(res, 400, 'GRN does not belong to the selected vendor');
    }
    if (grn.status === 'cancelled') return sendError(res, 400, 'Cannot return items from a cancelled GRN');

    // Validate each return item — pre-validate before any mutation
    const processedItems: Array<{
      grnItemIndex: number;
      ingredientId?: mongoose.Types.ObjectId;
      productName: string;
      unit: string;
      purchasePrice: number;
      returnQty: number;
      reason: string;
      notes?: string;
    }> = [];

    let returnValue = 0;

    for (const raw of items as Array<Record<string, unknown>>) {
      const grnItemIndex = Number(raw.grnItemIndex);
      if (!Number.isInteger(grnItemIndex) || grnItemIndex < 0 || grnItemIndex >= grn.items.length) {
        return sendError(res, 400, `Invalid grnItemIndex: ${raw.grnItemIndex}. Must be 0–${grn.items.length - 1}`);
      }

      const grnItem = grn.items[grnItemIndex];
      const returnQty = Number(raw.returnQty);
      if (!returnQty || returnQty <= 0) {
        return sendError(res, 400, `returnQty must be > 0 for item "${grnItem.productName}"`);
      }

      const acceptedQty     = Math.max(0, grnItem.receivedQty - (grnItem.damagedQty || 0) - (grnItem.rejectedQty || 0));
      const alreadyReturned = grnItem.returnedQty || 0;
      const availableToReturn = Math.max(0, acceptedQty - alreadyReturned);

      if (returnQty > availableToReturn) {
        return sendError(
          res, 400,
          `Over-return: "${grnItem.productName}" accepted ${acceptedQty}, already returned ${alreadyReturned}, ` +
          `trying to return ${returnQty} (max ${availableToReturn})`,
        );
      }

      processedItems.push({
        grnItemIndex,
        ingredientId: grnItem.ingredientId ? new mongoose.Types.ObjectId(String(grnItem.ingredientId)) : undefined,
        productName:  grnItem.productName,
        unit:         grnItem.unit,
        purchasePrice: grnItem.purchasePrice,
        returnQty,
        reason: String(raw.reason || ''),
        notes:  String(raw.notes  || ''),
      });

      returnValue += returnQty * grnItem.purchasePrice;
    }

    // Generate return number
    const ctr = await DailyCounter.findOneAndUpdate(
      { key: `RTN-${req.hotelId}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const returnNumber = `RTN-${String(ctr.seq).padStart(4, '0')}`;
    const actor = req.cashierId || req.waiterId || req.hotelId || '';

    const [vr] = await VendorReturn.create([{
      hotelId,
      returnNumber,
      vendorId:       vendor._id,
      vendorSnapshot: { businessName: vendor.businessName, vendorCode: vendor.vendorCode, mobile: vendor.mobile },
      poId:     grn.poId,
      poNumber: grn.poNumber,
      grnId:    grn._id,
      grnNumber: grn.grnNumber,
      status:   'draft',
      items:    processedItems,
      returnValue: Math.round(returnValue * 100) / 100,
      notes:    String(notes || ''),
      createdBy: actor,
      ...(idemKey ? { idempotencyKey: idemKey } : {}),
    }]);

    logAudit(req, 'vendor_return.created', 'vendor_return', String(vr._id), {
      returnNumber, vendorId, grnId, itemCount: processedItems.length, returnValue,
    });

    return res.status(201).json(vr);
  } catch (err) {
    return sendError(res, 500, 'Failed to create vendor return', err);
  }
});

// ── POST /:id/approve — draft → approved ──────────────────────────────────────

router.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const vr = await VendorReturn.findOne({ _id: req.params.id, hotelId, isDeleted: false });
    if (!vr) return sendError(res, 404, 'Vendor return not found');
    if (vr.status !== 'draft') return sendError(res, 400, `Cannot approve a return in '${vr.status}' status`);

    const actor = req.cashierId || req.waiterId || req.hotelId || '';
    vr.status     = 'approved';
    vr.approvedBy = actor;
    vr.approvedAt = new Date();
    await vr.save();

    logAudit(req, 'vendor_return.approved', 'vendor_return', String(vr._id), { returnNumber: vr.returnNumber });
    return res.json(vr);
  } catch (err) {
    return sendError(res, 500, 'Failed to approve vendor return', err);
  }
});

// ── POST /:id/complete — approved → completed (atomic) ───────────────────────

router.post('/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);

    const vendorReturn = await VendorReturn.findOne({ _id: req.params.id, hotelId, isDeleted: false }).lean();
    if (!vendorReturn) return sendError(res, 404, 'Vendor return not found');

    // Idempotency: already completed — return current state
    if (vendorReturn.status === 'completed') {
      return res.json(vendorReturn);
    }
    if (vendorReturn.status !== 'approved') {
      return sendError(res, 400, `Cannot complete a return in '${vendorReturn.status}' status`);
    }

    // Load GRN for pre-validation
    const grn = await GRN.findOne({ _id: vendorReturn.grnId, hotelId, isDeleted: false }).lean();
    if (!grn) return sendError(res, 400, 'Associated GRN not found');

    const vendor = await Vendor.findOne({ _id: vendorReturn.vendorId, hotelId, isDeleted: false });
    if (!vendor) return sendError(res, 400, 'Associated vendor not found');

    // Pre-validate: no over-return, no negative inventory
    for (const item of vendorReturn.items) {
      const grnItem = grn.items[item.grnItemIndex];
      if (!grnItem) return sendError(res, 400, `GRN item at index ${item.grnItemIndex} not found`);

      const acceptedQty     = Math.max(0, grnItem.receivedQty - (grnItem.damagedQty || 0) - (grnItem.rejectedQty || 0));
      const alreadyReturned = grnItem.returnedQty || 0;
      const availableToReturn = Math.max(0, acceptedQty - alreadyReturned);

      if (item.returnQty > availableToReturn) {
        return sendError(
          res, 400,
          `Over-return on complete: "${grnItem.productName}" available ${availableToReturn}, trying to return ${item.returnQty}`,
        );
      }

      if (item.ingredientId) {
        const ing = await Ingredient.findOne({ _id: item.ingredientId, hotelId }).lean();
        if (!ing) return sendError(res, 400, `Ingredient not found for "${item.productName}"`);
        if (ing.currentStock < item.returnQty) {
          return sendError(
            res, 400,
            `Insufficient stock: "${item.productName}" has ${ing.currentStock} ${ing.unit}, cannot return ${item.returnQty}`,
          );
        }
      }
    }

    const actor = req.cashierId || req.waiterId || req.hotelId || '';
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // 1. Atomic status transition — prevents duplicate completion
        const updated = await VendorReturn.findOneAndUpdate(
          { _id: vendorReturn._id, hotelId, status: 'approved' },
          { $set: { status: 'completed', completedBy: actor, completedAt: new Date() } },
          { session, new: true },
        );
        if (!updated) throw new Error('ALREADY_COMPLETED_OR_CANCELLED');

        // 2. Decrement ingredient stock + create StockMovement per item
        for (const item of vendorReturn.items) {
          if (!item.ingredientId) continue;
          const ing = await Ingredient.findOneAndUpdate(
            { _id: item.ingredientId, hotelId },
            { $inc: { currentStock: -item.returnQty } },
            { new: true, session },
          );
          if (!ing) throw new Error(`Ingredient ${item.ingredientId} not found`);
          await StockMovement.create([{
            hotelId,
            ingredientId:   item.ingredientId,
            ingredientName: ing.name,
            type:           'vendor_return',
            delta:          -item.returnQty,
            previousStock:  ing.currentStock + item.returnQty,
            resultingStock: ing.currentStock,
            costPerUnit:    item.purchasePrice,
            totalCost:      -(item.returnQty * item.purchasePrice),
            referenceId:    String(vendorReturn._id),
            referenceType:  'vendor_return',
            reason:         `Return to vendor: ${item.reason || vendorReturn.returnNumber}`,
            notes:          item.notes || '',
            supplier:       vendor.businessName,
            invoiceNumber:  vendorReturn.returnNumber,
            performedBy:    actor,
          }], { session });
        }

        // 3. Increment GRN item returnedQty
        const grnInc: Record<string, number> = {};
        for (const item of vendorReturn.items) {
          const key = `items.${item.grnItemIndex}.returnedQty`;
          grnInc[key] = (grnInc[key] || 0) + item.returnQty;
        }
        await GRN.updateOne({ _id: vendorReturn.grnId, hotelId }, { $inc: grnInc }, { session });

        // 4. Reduce vendor outstanding
        const updatedVendor = await Vendor.findOneAndUpdate(
          { _id: vendorReturn.vendorId, hotelId },
          { $inc: { currentOutstanding: -vendorReturn.returnValue } },
          { new: true, session },
        );

        // 5. Create credit_note ledger entry
        await VendorLedgerEntry.create([{
          hotelId,
          vendorId:        vendorReturn.vendorId,
          entryType:       'credit_note',
          referenceId:     vendorReturn._id,
          referenceNumber: vendorReturn.returnNumber,
          debit:           0,
          credit:          vendorReturn.returnValue,
          runningBalance:  updatedVendor?.currentOutstanding ?? 0,
          description: `Return to vendor ${vendorReturn.returnNumber} (${vendorReturn.items.length} item${vendorReturn.items.length > 1 ? 's' : ''})`,
        }], { session });
      });
    } catch (txErr: any) {
      await session.endSession();
      if (txErr?.message === 'ALREADY_COMPLETED_OR_CANCELLED') {
        const current = await VendorReturn.findOne({ _id: req.params.id, hotelId }).lean();
        return res.json(current);
      }
      return sendError(res, 500, 'Failed to complete vendor return', txErr);
    }
    await session.endSession();

    logAudit(req, 'vendor_return.completed', 'vendor_return', String(vendorReturn._id), {
      returnNumber: vendorReturn.returnNumber,
      returnValue:  vendorReturn.returnValue,
      itemCount:    vendorReturn.items.length,
    });

    const result = await VendorReturn.findOne({ _id: vendorReturn._id, hotelId }).lean();
    return res.json(result);
  } catch (err) {
    return sendError(res, 500, 'Failed to complete vendor return', err);
  }
});

// ── POST /:id/cancel ──────────────────────────────────────────────────────────

router.post('/:id/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const hotelId = new mongoose.Types.ObjectId(req.hotelId!);
    const vr = await VendorReturn.findOne({ _id: req.params.id, hotelId, isDeleted: false });
    if (!vr) return sendError(res, 404, 'Vendor return not found');
    if (vr.status === 'completed') return sendError(res, 400, 'Cannot cancel a completed return');
    if (vr.status === 'cancelled') return sendError(res, 400, 'Return is already cancelled');

    const { reason } = req.body as { reason?: string };
    const actor = req.cashierId || req.waiterId || req.hotelId || '';

    vr.status      = 'cancelled';
    vr.cancelledBy = actor;
    vr.cancelledAt = new Date();
    vr.cancelReason = String(reason || '');
    await vr.save();

    logAudit(req, 'vendor_return.cancelled', 'vendor_return', String(vr._id), {
      returnNumber: vr.returnNumber, reason,
    });
    return res.json(vr);
  } catch (err) {
    return sendError(res, 500, 'Failed to cancel vendor return', err);
  }
});

export default router;
