import { Router, Response } from 'express';
import mongoose from 'mongoose';
import GRN from '../models/GRN';
import PurchaseOrder from '../models/PurchaseOrder';
import Ingredient from '../models/Ingredient';
import DailyCounter from '../models/DailyCounter';
import Vendor from '../models/Vendor';
import VendorLedgerEntry from '../models/VendorLedgerEntry';
import { authMiddleware, requireAdmin, AuthRequest } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { sendError } from '../utils/sendError';
import StockMovement from '../models/StockMovement';

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
  const idemKey = req.headers['x-idempotency-key'] as string | undefined;
  try {
    const { poId, receiveDate, notes, items } = req.body;

    if (!poId) return sendError(res, 400, 'poId is required');
    if (!Array.isArray(items) || items.length === 0) return sendError(res, 400, 'items array is required');

    // Idempotency check (hotel-scoped)
    if (idemKey) {
      const existing = await GRN.findOne({ hotelId: req.hotelId, idempotencyKey: idemKey }).lean();
      if (existing) return res.status(201).json(existing);
    }

    // Pre-flight validation — fast fail before acquiring session
    const poForValidation = await PurchaseOrder.findOne({ _id: poId, hotelId: req.hotelId, isDeleted: false });
    if (!poForValidation) return sendError(res, 404, 'Purchase Order not found');
    if (!RECEIVABLE_STATUSES.includes(poForValidation.status)) {
      return sendError(res, 409, `Cannot receive against PO in status "${poForValidation.status}". Must be approved, sent, or partially_received.`);
    }

    // Validate item structure (indices, basic qty) against initial PO read
    for (const raw of items) {
      const poIdx = raw.poItemIndex !== undefined && raw.poItemIndex !== null ? Number(raw.poItemIndex) : -1;
      if (!Number.isInteger(poIdx) || poIdx < 0 || poIdx >= poForValidation.items.length) {
        return sendError(res, 400, `Invalid or missing poItemIndex: ${raw.poItemIndex}. Must be an integer 0–${poForValidation.items.length - 1}`);
      }
    }

    // Generate GRN number (outside transaction — idempotency key guards duplicate creation)
    const counter = await DailyCounter.findOneAndUpdate(
      { key: `GRN-${req.hotelId}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const grnNumber = `GRN-${String(counter.seq).padStart(4, '0')}`;

    // ── Atomic transaction: re-validate PO, update PO, create GRN, update stock + ledger ──
    // withTransaction handles WriteConflict retries for concurrent requests.
    const session = await mongoose.startSession();
    let createdGrn: any = null;

    try {
      await session.withTransaction(async () => {
        // CRIT-2 FIX: Re-read PO inside transaction to see committed state.
        // Two concurrent requests both start; one commits → the other's retry sees the updated receivedQty
        // and re-validates against fresh data before writing.
        const po = await PurchaseOrder.findOne(
          { _id: poId, hotelId: req.hotelId, isDeleted: false },
          null,
          { session },
        );
        if (!po) throw Object.assign(new Error('PO_GONE'), { status: 404 });
        if (!RECEIVABLE_STATUSES.includes(po.status)) {
          throw Object.assign(new Error('PO_STATUS_INVALID'), { poStatus: po.status });
        }

        // Re-validate quantities against the committed PO state
        for (const raw of items) {
          const poIdx   = Number(raw.poItemIndex);
          const pi      = po.items[poIdx];
          const rxQty   = Math.max(0, Number(raw.receivedQty) || 0);
          const maxAllowed = Math.max(0, pi.orderedQty - (pi.receivedQty || 0));
          if (rxQty > maxAllowed) {
            throw Object.assign(new Error('OVER_RECEIVING'), {
              productName: raw.productName || `item[${poIdx}]`,
              orderedQty: pi.orderedQty,
              alreadyReceived: pi.receivedQty || 0,
              tryingToReceive: rxQty,
              maxAllowed,
            });
          }
        }

        // Build processedItems and inventory ops using the confirmed PO state
        const processedItems: Array<Record<string, unknown>> = [];
        const inventoryOps: Array<{ ingredientId: mongoose.Types.ObjectId; acceptedQty: number; purchasePrice: number }> = [];

        for (const raw of items) {
          const receivedQty  = Math.max(0, Number(raw.receivedQty) || 0);
          const damagedQty   = Math.max(0, Number(raw.damagedQty) || 0);
          const rejectedQty  = Math.max(0, Number(raw.rejectedQty) || 0);
          const orderedQty   = Math.max(0, Number(raw.orderedQty) || 0);
          const acceptedQty  = Math.max(0, receivedQty - damagedQty - rejectedQty);
          const poIdx        = Number(raw.poItemIndex);
          const purchasePrice = Math.max(0, Number(raw.purchasePrice) || 0);

          po.items[poIdx].receivedQty = (po.items[poIdx].receivedQty || 0) + receivedQty;
          const cumulativeReceived = po.items[poIdx].receivedQty;
          const pendingQty = Math.max(0, orderedQty - cumulativeReceived);

          processedItems.push({
            poItemIndex:      poIdx,
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
            purchasePrice,
            batchNumber:      String(raw.batchNumber || ''),
            manufacturingDate: raw.manufacturingDate ? new Date(String(raw.manufacturingDate)) : null,
            expiryDate:       raw.expiryDate ? new Date(String(raw.expiryDate)) : null,
            warehouse:        String(raw.warehouse || ''),
            notes:            String(raw.notes || ''),
          });

          if (acceptedQty > 0 && raw.ingredientId) {
            inventoryOps.push({
              ingredientId: new mongoose.Types.ObjectId(String(raw.ingredientId)),
              acceptedQty,
              purchasePrice,
            });
          }
        }

        po.markModified('items');
        const allReceived = po.items.every(pi => (pi.receivedQty || 0) >= pi.orderedQty);
        const anyReceived = po.items.some(pi => (pi.receivedQty || 0) > 0);
        if (allReceived)       po.status = 'received';
        else if (anyReceived)  po.status = 'partially_received';

        const grnValue = processedItems.reduce((sum, item) => {
          const accepted = Math.max(0, (item.receivedQty as number) - (item.damagedQty as number) - (item.rejectedQty as number));
          return sum + accepted * ((item.purchasePrice as number) || 0);
        }, 0);

        // 1. Save PO (with session — this is the write that produces WriteConflict under concurrency)
        await po.save({ session });

        // 2. Create GRN document
        const [grn] = await GRN.create([{
          hotelId:        req.hotelId,
          grnNumber,
          poId:           po._id,
          poNumber:       po.poNumber,
          vendorId:       po.vendorId,
          vendorSnapshot: po.vendorSnapshot,
          receiveDate:    receiveDate ? new Date(String(receiveDate)) : new Date(),
          status:         allReceived ? 'completed' : 'partial',
          items:          processedItems,
          notes:          String(notes || ''),
          receivedBy:     req.cashierId || req.waiterId || req.hotelId || '',
          cancelReason:   '',
          isDeleted:      false,
          ...(idemKey ? { idempotencyKey: idemKey } : {}),
        }], { session });

        // 3. Ingredient stock increments
        if (inventoryOps.length > 0) {
          await Ingredient.bulkWrite(
            inventoryOps.map(({ ingredientId, acceptedQty }) => ({
              updateOne: {
                filter: { _id: ingredientId, hotelId: req.hotelId },
                update: { $inc: { currentStock: acceptedQty } },
              },
            })),
            { session },
          );
        }

        // 4. WAC — reads post-increment stock via session for consistency
        for (const op of inventoryOps) {
          if (op.purchasePrice <= 0) continue;
          const ing = await Ingredient.findOne({ _id: op.ingredientId, hotelId: req.hotelId })
            .select('costPerUnit currentStock')
            .session(session);
          if (!ing || ing.currentStock <= 0) continue;
          const prevStock = Math.max(0, ing.currentStock - op.acceptedQty);
          const newCost   = (prevStock * ing.costPerUnit + op.acceptedQty * op.purchasePrice) / ing.currentStock;
          if (!isNaN(newCost) && newCost > 0) {
            await Ingredient.updateOne(
              { _id: op.ingredientId, hotelId: req.hotelId },
              { $set: { costPerUnit: +newCost.toFixed(4) } },
              { session },
            );
          }
        }

        // 5. StockMovement records — inside transaction (HIGH-1 fix: no longer best-effort)
        if (inventoryOps.length > 0) {
          const ingIds = inventoryOps.map(op => op.ingredientId);
          const ings   = await Ingredient.find({ _id: { $in: ingIds }, hotelId: req.hotelId })
            .select('_id name currentStock costPerUnit')
            .session(session);
          const ingMap = new Map((ings as any[]).map(i => [String(i._id), i]));
          const movements = inventoryOps.map(op => {
            const ing = ingMap.get(String(op.ingredientId));
            if (!ing) return null;
            const resultingStock = Number(ing.currentStock);
            return {
              hotelId:       req.hotelId,
              ingredientId:  op.ingredientId,
              ingredientName: String(ing.name),
              type:          'grn' as const,
              delta:         op.acceptedQty,
              previousStock: Math.max(0, resultingStock - op.acceptedQty),
              resultingStock,
              costPerUnit:   ing.costPerUnit ?? null,
              totalCost:     op.purchasePrice > 0 ? op.acceptedQty * op.purchasePrice : null,
              referenceId:   String(grn._id),
              referenceType: 'grn' as const,
              reason:        `GRN ${grnNumber}`,
              supplier:      String((po.vendorSnapshot as any)?.businessName ?? ''),
              invoiceNumber: grnNumber,
            };
          }).filter(Boolean);
          if (movements.length > 0) await StockMovement.insertMany(movements, { session });
        }

        // 6. Vendor outstanding and ledger entry
        if (grnValue > 0) {
          const updatedVendor = await Vendor.findOneAndUpdate(
            { _id: grn.vendorId, hotelId: req.hotelId },
            { $inc: { currentOutstanding: grnValue } },
            { new: true, session },
          );
          await VendorLedgerEntry.create([{
            hotelId:         req.hotelId,
            vendorId:        grn.vendorId,
            entryType:       'grn',
            referenceId:     grn._id,
            referenceNumber: grnNumber,
            debit:           grnValue,
            credit:          0,
            runningBalance:  updatedVendor?.currentOutstanding ?? grnValue,
            description:     `GRN ${grnNumber} received from ${po.vendorSnapshot.businessName}`,
          }], { session });
        }

        createdGrn = grn;
      });
    } catch (txErr: any) {
      await session.endSession();
      if (txErr?.message === 'PO_GONE') return sendError(res, 404, 'Purchase Order not found');
      if (txErr?.message === 'PO_STATUS_INVALID') {
        return sendError(res, 409, `Cannot receive against PO in status "${txErr.poStatus}"`);
      }
      if (txErr?.message === 'OVER_RECEIVING') {
        return sendError(res, 400,
          `Over-receiving: "${txErr.productName}" ordered ${txErr.orderedQty}, already received ${txErr.alreadyReceived}, ` +
          `trying to receive ${txErr.tryingToReceive} (max ${txErr.maxAllowed})`);
      }
      throw txErr;
    }
    await session.endSession();

    logAudit(req, 'grn.created', 'grn', String(createdGrn._id), {
      grnNumber,
      poNumber: poForValidation.poNumber,
      grnStatus: createdGrn.status,
      itemCount: items.length,
    });

    return res.status(201).json(createdGrn);
  } catch (err: any) {
    // HIGH-3: concurrent request with the same idempotency key lost the unique-index race
    if (err?.code === 11000 && err?.keyPattern?.idempotencyKey && idemKey) {
      const saved = await GRN.findOne({ hotelId: req.hotelId, idempotencyKey: idemKey }).lean();
      if (saved) return res.status(201).json(saved);
    }
    return sendError(res, 500, 'Failed to create GRN', err);
  }
});

// ── POST /:id/cancel ──────────────────────────────────────────────────────────

router.post('/:id/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const cancelReason = String(req.body.reason || '');

    // Quick existence check before acquiring session
    const exists = await GRN.exists({ _id: req.params.id, hotelId: req.hotelId, isDeleted: false });
    if (!exists) return sendError(res, 404, 'GRN not found');

    const session = await mongoose.startSession();
    let cancelledGrn: any = null;

    try {
      await session.withTransaction(async () => {
        // HIGH-2 FIX: Atomic status guard — only one concurrent request transitions to 'cancelled'.
        // The $ne filter ensures exactly-once execution even under races.
        const grn = await GRN.findOneAndUpdate(
          { _id: req.params.id, hotelId: req.hotelId, isDeleted: false, status: { $ne: 'cancelled' } },
          { $set: { status: 'cancelled', cancelReason } },
          { session, new: false }, // returns the PRE-CANCEL document
        );
        if (!grn) throw new Error('ALREADY_CANCELLED');

        // CRIT-3 FIX: Check stock before decrement — abort if any ingredient would go negative.
        // This runs inside the transaction so the check and decrement are atomic.
        for (const item of (grn.items as any[])) {
          if (!item.ingredientId) continue;
          const accepted = Math.max(0, (item.receivedQty || 0) - (item.damagedQty || 0) - (item.rejectedQty || 0));
          if (accepted <= 0) continue;

          const ing = await Ingredient.findOne(
            { _id: item.ingredientId, hotelId: req.hotelId },
            'currentStock name',
            { session },
          );
          if (!ing) {
            throw Object.assign(new Error('INGREDIENT_NOT_FOUND'), { productName: item.productName });
          }
          if (ing.currentStock < accepted) {
            throw Object.assign(new Error('INSUFFICIENT_STOCK'), {
              productName: item.productName,
              available: ing.currentStock,
              required: accepted,
            });
          }

          await Ingredient.updateOne(
            { _id: item.ingredientId, hotelId: req.hotelId },
            { $inc: { currentStock: -accepted } },
            { session },
          );

          // HIGH-1 FIX: StockMovement inside transaction — no longer best-effort
          await StockMovement.create([{
            hotelId:        req.hotelId,
            ingredientId:   item.ingredientId,
            ingredientName: ing.name,
            type:           'grn_cancel',
            delta:          -accepted,
            previousStock:  ing.currentStock,
            resultingStock: ing.currentStock - accepted,
            costPerUnit:    item.purchasePrice ?? null,
            referenceId:    String(grn._id),
            referenceType:  'grn',
            reason:         `GRN ${grn.grnNumber} cancelled`,
          }], { session });
        }

        // Reverse vendor outstanding and create credit ledger entry
        const grnLedger = await VendorLedgerEntry.findOne({
          hotelId: req.hotelId, referenceId: grn._id, entryType: 'grn',
        }).session(session);
        if (grnLedger && grnLedger.debit > 0) {
          const updatedVendor = await Vendor.findOneAndUpdate(
            { _id: grn.vendorId, hotelId: req.hotelId },
            { $inc: { currentOutstanding: -grnLedger.debit } },
            { new: true, session },
          );
          await VendorLedgerEntry.create([{
            hotelId:         req.hotelId,
            vendorId:        grn.vendorId,
            entryType:       'adjustment',
            referenceId:     grn._id,
            referenceNumber: grn.grnNumber,
            debit:           0,
            credit:          grnLedger.debit,
            runningBalance:  Math.max(0, updatedVendor?.currentOutstanding ?? 0),
            description:     `GRN ${grn.grnNumber} cancelled`,
          }], { session });
        }

        // CRIT-1 FIX: Reverse PO.receivedQty and recalculate PO status atomically.
        if (grn.poId) {
          const po = await PurchaseOrder.findOne({ _id: grn.poId, hotelId: req.hotelId }, null, { session });
          if (po) {
            for (const item of (grn.items as any[])) {
              const idx = typeof item.poItemIndex === 'number' ? item.poItemIndex : -1;
              if (idx >= 0 && po.items[idx]) {
                po.items[idx].receivedQty = Math.max(0, (po.items[idx].receivedQty || 0) - (item.receivedQty || 0));
              }
            }
            po.markModified('items');

            // Recalculate PO status after reversal
            const allReceived = po.items.every(pi => (pi.receivedQty || 0) >= pi.orderedQty);
            const anyReceived = po.items.some(pi => (pi.receivedQty || 0) > 0);
            if (allReceived)      po.status = 'received';
            else if (anyReceived) po.status = 'partially_received';
            else if (['received', 'partially_received'].includes(po.status)) {
              // Reopen PO for receiving — 'approved' is always a valid receivable state
              po.status = 'approved';
            }
            await po.save({ session });
          }
        }

        cancelledGrn = grn;
      });
    } catch (txErr: any) {
      await session.endSession();
      if (txErr?.message === 'ALREADY_CANCELLED') {
        return res.status(409).json({ message: 'GRN is already cancelled' });
      }
      if (txErr?.message === 'INSUFFICIENT_STOCK') {
        return res.status(409).json({
          message:
            `Cannot cancel GRN: "${txErr.productName}" has only ${txErr.available} in stock ` +
            `but this GRN credited ${txErr.required}. Adjust inventory to the correct level first.`,
        });
      }
      if (txErr?.message === 'INGREDIENT_NOT_FOUND') {
        return res.status(409).json({
          message: `Cannot cancel GRN: ingredient "${txErr.productName}" no longer exists. Contact support.`,
        });
      }
      throw txErr;
    }
    await session.endSession();

    logAudit(req, 'grn.cancelled', 'grn', String(cancelledGrn._id), {
      grnNumber:    cancelledGrn.grnNumber,
      cancelReason,
    });

    const updated = await GRN.findOne({ _id: req.params.id, hotelId: req.hotelId }).lean();
    return res.json(updated);
  } catch (err) {
    return sendError(res, 500, 'Failed to cancel GRN', err);
  }
});

export default router;
