// ─── GRN Service — Shared GRN Creation Logic ─────────────────────────────────
// Extracted from grnRoutes.ts so the OCR approval flow can reuse it.
// The existing grnRoutes.ts is NOT modified — it retains its own inline logic.
// This service is called ONLY from purchaseSuggestion.ts (OCR approval path).

import mongoose from 'mongoose';
import GRN from '../models/GRN';
import PurchaseOrder from '../models/PurchaseOrder';
import Ingredient from '../models/Ingredient';
import DailyCounter from '../models/DailyCounter';
import Vendor from '../models/Vendor';
import VendorLedgerEntry from '../models/VendorLedgerEntry';
import StockMovement from '../models/StockMovement';
import { logger } from '../utils/logger';

export interface GRNServiceItem {
  productName:      string;
  ingredientId:     string | null;
  orderedQty:       number;
  receivedQty:      number;
  damagedQty?:      number;
  rejectedQty?:     number;
  unit:             string;
  purchasePrice:    number;
  taxPercent?:      number;
}

export interface GRNServiceResult {
  poId:       string;
  poNumber:   string;
  grnId:      string;
  grnNumber:  string;
  grnStatus:  string;
  grnValue:   number;
}

// ─── PO creation for OCR approval ────────────────────────────────────────────
// Creates a PO directly in 'approved' status (the user has already reviewed).

export async function createApprovedPO(
  hotelId:   string,
  vendorId:  string,
  items:     GRNServiceItem[],
  discount:  number = 0,
  notes:     string = '',
): Promise<{ po: InstanceType<typeof PurchaseOrder>; poNumber: string }> {
  const hotelOId   = new mongoose.Types.ObjectId(hotelId);
  const vendorOId  = new mongoose.Types.ObjectId(vendorId);

  const vendor = await Vendor.findOne({ _id: vendorOId, hotelId: hotelOId, isDeleted: false });
  if (!vendor) throw new Error(`Vendor ${vendorId} not found`);

  // PO number via DailyCounter (same pattern as purchaseOrderRoutes.ts)
  const counter = await DailyCounter.findOneAndUpdate(
    { key: `PO-${hotelId}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const poNumber = `PO-${String(counter.seq).padStart(4, '0')}`;

  let subtotal = 0, taxTotal = 0;
  const poItems = items.map((item, idx) => {
    const base      = item.purchasePrice * item.orderedQty;
    const tax       = Math.round(base * ((item.taxPercent ?? 0) / 100) * 100) / 100;
    const lineTotal = Math.round((base + tax) * 100) / 100;
    subtotal  += Math.round(base * 100) / 100;
    taxTotal  += tax;
    return {
      productName:  item.productName,
      variantId:    '',
      variantName:  '',
      orderedQty:   item.orderedQty,
      receivedQty:  0,
      unit:         item.unit,
      unitPrice:    item.purchasePrice,
      discount:     0,
      taxPercent:   item.taxPercent ?? 0,
      lineTotal,
    };
  });

  const total = Math.max(0, Math.round((subtotal + taxTotal - Math.max(0, discount)) * 100) / 100);

  const po = await PurchaseOrder.create({
    hotelId:              hotelOId,
    poNumber,
    vendorId:             vendorOId,
    vendorSnapshot: {
      businessName: vendor.businessName,
      vendorCode:   vendor.vendorCode ?? '',
      mobile:       vendor.mobile ?? '',
      gstNumber:    vendor.gstNumber ?? '',
    },
    status:               'approved',
    orderDate:            new Date(),
    expectedDeliveryDate: null,
    currency:             'INR',
    notes,
    items:                poItems,
    subtotal:             Math.round(subtotal * 100) / 100,
    taxTotal:             Math.round(taxTotal * 100) / 100,
    discount:             Math.max(0, discount),
    tax:                  0,
    shipping:             0,
    total,
    createdBy:            'ocr-assistant',
    updatedBy:            'ocr-assistant',
    approvedBy:           'ocr-assistant',
    approvedAt:           new Date(),
    cancelReason:         '',
    isDeleted:            false,
  });

  return { po, poNumber };
}

// ─── GRN creation (mirrors grnRoutes.ts POST / logic exactly) ────────────────

export async function createGRNForApproval(
  hotelId:         string,
  poId:            string,
  items:           GRNServiceItem[],
  receiveDate:     Date = new Date(),
  notes:           string = '',
  idempotencyKey?: string,
): Promise<GRNServiceResult> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  // B-07: Idempotency pre-check — mirrors the grnRoutes.ts inline pattern.
  // Performed outside the transaction (same reason: avoids write-conflict on counter).
  if (idempotencyKey) {
    const existingGrn = await GRN.findOne({ hotelId: hotelOId, idempotencyKey }).lean();
    if (existingGrn) {
      logger.info('[grnService] createGRNForApproval: idempotent duplicate', { idempotencyKey, grnNumber: (existingGrn as any).grnNumber });
      return {
        poId:      String((existingGrn as any).poId ?? ''),
        poNumber:  String((existingGrn as any).poNumber ?? ''),
        grnId:     String((existingGrn as any)._id),
        grnNumber: String((existingGrn as any).grnNumber),
        grnStatus: String((existingGrn as any).status),
        grnValue:  0,
      };
    }
  }

  // GRN number is allocated outside the transaction — same pattern as grnRoutes.ts.
  // If the transaction is retried by MongoDB the counter increments again (a sequence
  // gap), which is acceptable. The counter must not be inside withTransaction because
  // a upsert-based counter can cause write-conflict aborts on concurrent GRNs.
  const counter = await DailyCounter.findOneAndUpdate(
    { key: `GRN-${hotelId}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const grnNumber = `GRN-${String(counter.seq).padStart(4, '0')}`;

  // All five writes (PO, GRN, stock increments, WAC, vendor ledger) are wrapped in
  // a single transaction so any failure rolls back everything atomically.
  let result!: GRNServiceResult;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Re-read PO inside the transaction for a consistent snapshot.
      const po = await PurchaseOrder.findOne(
        { _id: poId, hotelId: hotelOId, isDeleted: false },
        null,
        { session },
      );
      if (!po) throw new Error(`PurchaseOrder ${poId} not found`);
      if (!['approved', 'sent', 'partially_received'].includes(po.status)) {
        throw new Error(`Cannot receive against PO in status "${po.status}"`);
      }

      // Process items (pure computation, no DB calls)
      const processedItems: Record<string, unknown>[] = [];
      const inventoryUpdates: Array<{ filter: object; update: object }> = [];

      for (let idx = 0; idx < items.length; idx++) {
        const raw          = items[idx];
        const receivedQty  = Math.max(0, raw.receivedQty);
        const damagedQty   = Math.max(0, raw.damagedQty ?? 0);
        const rejectedQty  = Math.max(0, raw.rejectedQty ?? 0);
        const acceptedQty  = Math.max(0, receivedQty - damagedQty - rejectedQty);

        if (idx < po.items.length) {
          po.items[idx].receivedQty = (po.items[idx].receivedQty || 0) + receivedQty;
        }
        const pendingQty = Math.max(0, raw.orderedQty - receivedQty);

        processedItems.push({
          poItemIndex:   idx,
          ingredientId:  raw.ingredientId ? new mongoose.Types.ObjectId(raw.ingredientId) : null,
          productName:   raw.productName,
          variantId:     '',
          variantName:   '',
          orderedQty:    raw.orderedQty,
          receivedQty,
          damagedQty,
          rejectedQty,
          pendingQty,
          unit:          raw.unit,
          purchasePrice: raw.purchasePrice,
        });

        if (acceptedQty > 0 && raw.ingredientId) {
          const iId = new mongoose.Types.ObjectId(raw.ingredientId);
          inventoryUpdates.push({
            filter: { _id: iId, hotelId: hotelOId },
            update: { $inc: { currentStock: acceptedQty } },
          });
        }
      }

      // ── Write 1: PO status + received quantities ────────────────────────────
      po.markModified('items');
      const allReceived = po.items.every((pi) => (pi.receivedQty || 0) >= pi.orderedQty);
      const anyReceived = po.items.some((pi) => (pi.receivedQty || 0) > 0);
      if (allReceived)      po.status = 'received';
      else if (anyReceived) po.status = 'partially_received';
      await po.save({ session });

      // ── Write 2: GRN document ───────────────────────────────────────────────
      const [grn] = await GRN.create(
        [{
          hotelId:        hotelOId,
          grnNumber,
          poId:           po._id,
          poNumber:       po.poNumber,
          vendorId:       po.vendorId,
          vendorSnapshot: po.vendorSnapshot,
          receiveDate,
          status:         allReceived ? 'completed' : 'partial',
          items:          processedItems,
          notes,
          receivedBy:     'ocr-assistant',
          cancelReason:   '',
          isDeleted:      false,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }],
        { session },
      );

      // ── Write 3: ingredient stock increments ────────────────────────────────
      for (const op of inventoryUpdates) {
        await Ingredient.updateOne(op.filter, op.update, { session });
      }

      // ── Write 4: WAC update + StockMovement records ────────────────────────
      // The findOne reads AFTER the $inc above, so currentStock is already the
      // post-receipt value within the same transaction (read-your-own-writes).
      const smDocs: Record<string, unknown>[] = [];
      for (let itemIdx = 0; itemIdx < processedItems.length; itemIdx++) {
        const item = processedItems[itemIdx];
        if (!item.ingredientId) continue; // no ingredient link — skip
        const accepted = Math.max(0,
          (item.receivedQty  as number) -
          (item.damagedQty   as number || 0) -
          (item.rejectedQty  as number || 0),
        );
        if (accepted <= 0) continue;
        const iId = item.ingredientId as mongoose.Types.ObjectId;
        const ing = await Ingredient.findOne(
          { _id: iId, hotelId: hotelOId },
          'costPerUnit currentStock name',
          { session },
        );
        if (!ing || ing.currentStock <= 0) continue;
        const prevStock       = Math.max(0, ing.currentStock - accepted);
        const prevCostPerUnit = ing.costPerUnit;  // B-06: snapshot WAC before this GRN changes it
        let   finalCost       = prevCostPerUnit;
        if ((item.purchasePrice as number) > 0) {
          const newCost = (prevStock * ing.costPerUnit + accepted * (item.purchasePrice as number)) / ing.currentStock;
          if (!isNaN(newCost) && newCost > 0) {
            finalCost = +newCost.toFixed(4);
            await Ingredient.updateOne(
              { _id: iId, hotelId: hotelOId },
              { $set: { costPerUnit: finalCost } },
              { session },
            );
            // B-06: Persist pre-GRN WAC on the GRN item so GRN cancellation can reverse it.
            await GRN.updateOne(
              { _id: grn._id },
              { $set: { [`items.${itemIdx}.prevCostPerUnit`]: prevCostPerUnit } },
              { session },
            );
          }
        }
        smDocs.push({
          hotelId:        hotelOId,
          ingredientId:   iId,
          ingredientName: ing.name || (item.productName as string),
          type:           'grn',
          delta:          accepted,
          previousStock:  prevStock,
          resultingStock: ing.currentStock,
          costPerUnit:    finalCost,
          totalCost:      +(finalCost * accepted).toFixed(4),
          referenceId:    grn._id.toString(),
          referenceType:  'grn',
          reason:         `GRN ${grnNumber} received via OCR import`,
          notes:          '',
          supplier:       grn.vendorSnapshot?.businessName ?? '',
          invoiceNumber:  '',
          performedBy:    'ocr-assistant',
        });
      }
      if (smDocs.length > 0) {
        await StockMovement.insertMany(smDocs, { session });
      }

      // ── Write 5: vendor outstanding + ledger entry ──────────────────────────
      const grnValue = processedItems.reduce((sum, item) => {
        const accepted = Math.max(0,
          (item.receivedQty  as number) -
          (item.damagedQty   as number || 0) -
          (item.rejectedQty  as number || 0),
        );
        return sum + accepted * ((item.purchasePrice as number) || 0);
      }, 0);

      if (grnValue > 0) {
        const updatedVendor = await Vendor.findOneAndUpdate(
          { _id: grn.vendorId, hotelId: hotelOId },
          { $inc: { currentOutstanding: grnValue } },
          { new: true, session },
        );
        await VendorLedgerEntry.create(
          [{
            hotelId:         hotelOId,
            vendorId:        grn.vendorId,
            entryType:       'grn',
            referenceId:     grn._id,
            referenceNumber: grnNumber,
            debit:           grnValue,
            credit:          0,
            runningBalance:  updatedVendor?.currentOutstanding ?? grnValue,
            description:     `GRN ${grnNumber} received via OCR import from ${po.vendorSnapshot.businessName}`,
          }],
          { session },
        );
      }

      logger.info('[grnService] GRN created', { grnNumber, poId, hotelId, grnValue });

      result = {
        poId:      po._id.toString(),
        poNumber:  po.poNumber,
        grnId:     grn._id.toString(),
        grnNumber,
        grnStatus: grn.status,
        grnValue:  +grnValue.toFixed(2),
      };
    });
  } catch (err: any) {
    await session.endSession();
    // B-07: concurrent request won the race and created the GRN first — return it
    if (err.code === 11000 && err.keyPattern?.idempotencyKey && idempotencyKey) {
      const existingGrn = await GRN.findOne({ hotelId: hotelOId, idempotencyKey }).lean();
      if (existingGrn) {
        return {
          poId:      String((existingGrn as any).poId ?? ''),
          poNumber:  String((existingGrn as any).poNumber ?? ''),
          grnId:     String((existingGrn as any)._id),
          grnNumber: String((existingGrn as any).grnNumber),
          grnStatus: String((existingGrn as any).status),
          grnValue:  0,
        };
      }
    }
    throw err;
  }
  await session.endSession();

  return result;
}

// ─── Atomic PO + GRN creation for OCR approval (A-05) ────────────────────────
// Eliminates the orphaned-PO risk that existed when createApprovedPO (no tx)
// and createGRNForApproval (separate tx) were called sequentially. Both counter
// allocations remain OUTSIDE the transaction per the project invariant.

export async function createPOAndGRNAtomically(
  hotelId:         string,
  vendorId:        string,
  items:           GRNServiceItem[],
  receiveDate:     Date = new Date(),
  poNotes:         string = '',
  grnNotes:        string = '',
  discount:        number = 0,
  idempotencyKey?: string,
): Promise<GRNServiceResult> {
  const hotelOId  = new mongoose.Types.ObjectId(hotelId);
  const vendorOId = new mongoose.Types.ObjectId(vendorId);

  // B-07: Idempotency pre-check (outside transaction)
  if (idempotencyKey) {
    const existingGrn = await GRN.findOne({ hotelId: hotelOId, idempotencyKey }).lean();
    if (existingGrn) {
      logger.info('[grnService] createPOAndGRNAtomically: idempotent duplicate', { idempotencyKey, grnNumber: (existingGrn as any).grnNumber });
      return {
        poId:      String((existingGrn as any).poId ?? ''),
        poNumber:  String((existingGrn as any).poNumber ?? ''),
        grnId:     String((existingGrn as any)._id),
        grnNumber: String((existingGrn as any).grnNumber),
        grnStatus: String((existingGrn as any).status),
        grnValue:  0,
      };
    }
  }

  const vendor = await Vendor.findOne({ _id: vendorOId, hotelId: hotelOId, isDeleted: false });
  if (!vendor) throw new Error(`Vendor ${vendorId} not found`);

  const poCounter = await DailyCounter.findOneAndUpdate(
    { key: `PO-${hotelId}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const poNumber = `PO-${String(poCounter.seq).padStart(4, '0')}`;

  const grnCounter = await DailyCounter.findOneAndUpdate(
    { key: `GRN-${hotelId}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const grnNumber = `GRN-${String(grnCounter.seq).padStart(4, '0')}`;

  let result!: GRNServiceResult;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // ── PO computation (pure) ───────────────────────────────────────────────
      let subtotal = 0, taxTotal = 0;
      const poItems = items.map((item) => {
        const base      = item.purchasePrice * item.orderedQty;
        const tax       = Math.round(base * ((item.taxPercent ?? 0) / 100) * 100) / 100;
        const lineTotal = Math.round((base + tax) * 100) / 100;
        subtotal  += Math.round(base * 100) / 100;
        taxTotal  += tax;
        return {
          productName: item.productName,
          variantId:   '',
          variantName: '',
          orderedQty:  item.orderedQty,
          receivedQty: Math.max(0, item.receivedQty),
          unit:        item.unit,
          unitPrice:   item.purchasePrice,
          discount:    0,
          taxPercent:  item.taxPercent ?? 0,
          lineTotal,
        };
      });
      const total       = Math.max(0, Math.round((subtotal + taxTotal - Math.max(0, discount)) * 100) / 100);
      const allReceived = items.every((raw) => (raw.receivedQty ?? 0) >= raw.orderedQty);
      const anyReceived = items.some((raw)  => (raw.receivedQty ?? 0) > 0);
      const poStatus    = allReceived ? 'received' : (anyReceived ? 'partially_received' : 'approved');

      // ── Write 1: PO ─────────────────────────────────────────────────────────
      const [po] = await PurchaseOrder.create(
        [{
          hotelId:              hotelOId,
          poNumber,
          vendorId:             vendorOId,
          vendorSnapshot: {
            businessName: vendor.businessName,
            vendorCode:   vendor.vendorCode ?? '',
            mobile:       vendor.mobile ?? '',
            gstNumber:    vendor.gstNumber ?? '',
          },
          status:               poStatus,
          orderDate:            new Date(),
          expectedDeliveryDate: null,
          currency:             'INR',
          notes:                poNotes,
          items:                poItems,
          subtotal:             Math.round(subtotal * 100) / 100,
          taxTotal:             Math.round(taxTotal * 100) / 100,
          discount:             Math.max(0, discount),
          tax:                  0,
          shipping:             0,
          total,
          createdBy:            'ocr-assistant',
          updatedBy:            'ocr-assistant',
          approvedBy:           'ocr-assistant',
          approvedAt:           new Date(),
          cancelReason:         '',
          isDeleted:            false,
        }],
        { session },
      );

      // ── GRN item computation ─────────────────────────────────────────────────
      const processedItems: Record<string, unknown>[] = [];
      const inventoryUpdates: Array<{ filter: object; update: object }> = [];
      for (let idx = 0; idx < items.length; idx++) {
        const raw         = items[idx];
        const receivedQty = Math.max(0, raw.receivedQty);
        const damagedQty  = Math.max(0, raw.damagedQty ?? 0);
        const rejectedQty = Math.max(0, raw.rejectedQty ?? 0);
        const acceptedQty = Math.max(0, receivedQty - damagedQty - rejectedQty);
        processedItems.push({
          poItemIndex:  idx,
          ingredientId: raw.ingredientId ? new mongoose.Types.ObjectId(raw.ingredientId) : null,
          productName:  raw.productName,
          variantId:    '',
          variantName:  '',
          orderedQty:   raw.orderedQty,
          receivedQty,
          damagedQty,
          rejectedQty,
          pendingQty:   Math.max(0, raw.orderedQty - receivedQty),
          unit:         raw.unit,
          purchasePrice: raw.purchasePrice,
        });
        if (acceptedQty > 0 && raw.ingredientId) {
          inventoryUpdates.push({
            filter: { _id: new mongoose.Types.ObjectId(raw.ingredientId), hotelId: hotelOId },
            update: { $inc: { currentStock: acceptedQty } },
          });
        }
      }

      // ── Write 2: GRN ─────────────────────────────────────────────────────────
      const [grn] = await GRN.create(
        [{
          hotelId:        hotelOId,
          grnNumber,
          poId:           po._id,
          poNumber,
          vendorId:       vendorOId,
          vendorSnapshot: {
            businessName: vendor.businessName,
            vendorCode:   vendor.vendorCode ?? '',
            mobile:       vendor.mobile ?? '',
            gstNumber:    vendor.gstNumber ?? '',
          },
          receiveDate,
          status:         allReceived ? 'completed' : 'partial',
          items:          processedItems,
          notes:          grnNotes,
          receivedBy:     'ocr-assistant',
          cancelReason:   '',
          isDeleted:      false,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }],
        { session },
      );

      // ── Write 3: ingredient stock increments ─────────────────────────────────
      for (const op of inventoryUpdates) {
        await Ingredient.updateOne(op.filter, op.update, { session });
      }

      // ── Write 4: WAC + prevCostPerUnit snapshot + StockMovement records ─────────
      const smDocs2: Record<string, unknown>[] = [];
      for (let itemIdx = 0; itemIdx < processedItems.length; itemIdx++) {
        const item = processedItems[itemIdx];
        if (!item.ingredientId) continue;
        const accepted = Math.max(0,
          (item.receivedQty  as number) -
          (item.damagedQty   as number || 0) -
          (item.rejectedQty  as number || 0),
        );
        if (accepted <= 0) continue;
        const iId = item.ingredientId as mongoose.Types.ObjectId;
        const ing = await Ingredient.findOne(
          { _id: iId, hotelId: hotelOId },
          'costPerUnit currentStock name',
          { session },
        );
        if (!ing || ing.currentStock <= 0) continue;
        const prevStock       = Math.max(0, ing.currentStock - accepted);
        const prevCostPerUnit = ing.costPerUnit;
        let   finalCost       = prevCostPerUnit;
        if ((item.purchasePrice as number) > 0) {
          const newCost = (prevStock * ing.costPerUnit + accepted * (item.purchasePrice as number)) / ing.currentStock;
          if (!isNaN(newCost) && newCost > 0) {
            finalCost = +newCost.toFixed(4);
            await Ingredient.updateOne(
              { _id: iId, hotelId: hotelOId },
              { $set: { costPerUnit: finalCost } },
              { session },
            );
            await GRN.updateOne(
              { _id: grn._id },
              { $set: { [`items.${itemIdx}.prevCostPerUnit`]: prevCostPerUnit } },
              { session },
            );
          }
        }
        smDocs2.push({
          hotelId:        hotelOId,
          ingredientId:   iId,
          ingredientName: ing.name || (item.productName as string),
          type:           'grn',
          delta:          accepted,
          previousStock:  prevStock,
          resultingStock: ing.currentStock,
          costPerUnit:    finalCost,
          totalCost:      +(finalCost * accepted).toFixed(4),
          referenceId:    grn._id.toString(),
          referenceType:  'grn',
          reason:         `GRN ${grnNumber} received via OCR import`,
          notes:          '',
          supplier:       vendor.businessName ?? '',
          invoiceNumber:  '',
          performedBy:    'ocr-assistant',
        });
      }
      if (smDocs2.length > 0) {
        await StockMovement.insertMany(smDocs2, { session });
      }

      // ── Write 5: vendor outstanding + ledger ──────────────────────────────────
      const grnValue = processedItems.reduce((sum, item) => {
        const accepted = Math.max(0,
          (item.receivedQty  as number) -
          (item.damagedQty   as number || 0) -
          (item.rejectedQty  as number || 0),
        );
        return sum + accepted * ((item.purchasePrice as number) || 0);
      }, 0);

      if (grnValue > 0) {
        const updatedVendor = await Vendor.findOneAndUpdate(
          { _id: vendorOId, hotelId: hotelOId },
          { $inc: { currentOutstanding: grnValue } },
          { new: true, session },
        );
        await VendorLedgerEntry.create(
          [{
            hotelId:         hotelOId,
            vendorId:        vendorOId,
            entryType:       'grn',
            referenceId:     grn._id,
            referenceNumber: grnNumber,
            debit:           grnValue,
            credit:          0,
            runningBalance:  updatedVendor?.currentOutstanding ?? grnValue,
            description:     `GRN ${grnNumber} received via OCR import from ${vendor.businessName}`,
          }],
          { session },
        );
      }

      logger.info('[grnService] PO+GRN created atomically', { poNumber, grnNumber, hotelId, grnValue });

      result = {
        poId:      po._id.toString(),
        poNumber,
        grnId:     grn._id.toString(),
        grnNumber,
        grnStatus: grn.status,
        grnValue:  +grnValue.toFixed(2),
      };
    });
  } catch (err: any) {
    await session.endSession();
    // B-07: concurrent request won the race — return existing GRN
    if (err.code === 11000 && err.keyPattern?.idempotencyKey && idempotencyKey) {
      const existingGrn = await GRN.findOne({ hotelId: hotelOId, idempotencyKey }).lean();
      if (existingGrn) {
        return {
          poId:      String((existingGrn as any).poId ?? ''),
          poNumber:  String((existingGrn as any).poNumber ?? ''),
          grnId:     String((existingGrn as any)._id),
          grnNumber: String((existingGrn as any).grnNumber),
          grnStatus: String((existingGrn as any).status),
          grnValue:  0,
        };
      }
    }
    throw err;
  }
  await session.endSession();

  return result;
}
