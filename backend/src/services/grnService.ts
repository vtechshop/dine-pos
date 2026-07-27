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
  hotelId:     string,
  poId:        string,
  items:       GRNServiceItem[],
  receiveDate: Date = new Date(),
  notes:       string = '',
): Promise<GRNServiceResult> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const po = await PurchaseOrder.findOne({ _id: poId, hotelId: hotelOId, isDeleted: false });
  if (!po) throw new Error(`PurchaseOrder ${poId} not found`);
  if (!['approved', 'sent', 'partially_received'].includes(po.status)) {
    throw new Error(`Cannot receive against PO in status "${po.status}"`);
  }

  // GRN number
  const counter = await DailyCounter.findOneAndUpdate(
    { key: `GRN-${hotelId}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const grnNumber = `GRN-${String(counter.seq).padStart(4, '0')}`;

  // Process items
  const processedItems: Record<string, unknown>[] = [];
  const inventoryOps: Array<() => Promise<unknown>> = [];

  for (let idx = 0; idx < items.length; idx++) {
    const raw          = items[idx];
    const receivedQty  = Math.max(0, raw.receivedQty);
    const damagedQty   = Math.max(0, raw.damagedQty ?? 0);
    const rejectedQty  = Math.max(0, raw.rejectedQty ?? 0);
    const acceptedQty  = Math.max(0, receivedQty - damagedQty - rejectedQty);

    // Update PO item receivedQty
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
      inventoryOps.push(() =>
        Ingredient.updateOne(
          { _id: iId, hotelId: hotelOId },
          { $inc: { currentStock: acceptedQty } },
        ),
      );
    }
  }

  po.markModified('items');
  const allReceived = po.items.every((pi) => (pi.receivedQty || 0) >= pi.orderedQty);
  const anyReceived = po.items.some((pi) => (pi.receivedQty || 0) > 0);
  if (allReceived)      po.status = 'received';
  else if (anyReceived) po.status = 'partially_received';
  await po.save();

  // Create GRN
  const grn = await GRN.create({
    hotelId:      hotelOId,
    grnNumber,
    poId:         po._id,
    poNumber:     po.poNumber,
    vendorId:     po.vendorId,
    vendorSnapshot: po.vendorSnapshot,
    receiveDate,
    status:       allReceived ? 'completed' : 'partial',
    items:        processedItems,
    notes,
    receivedBy:   'ocr-assistant',
    cancelReason: '',
    isDeleted:    false,
  });

  // Stock update
  await Promise.all(inventoryOps.map((fn) => fn()));

  // WAC update (identical to grnRoutes.ts)
  const wacOps = processedItems
    .filter((item) => item.ingredientId && (item.purchasePrice as number) > 0)
    .map(async (item) => {
      const accepted = Math.max(0,
        (item.receivedQty  as number) -
        (item.damagedQty   as number || 0) -
        (item.rejectedQty  as number || 0),
      );
      if (accepted <= 0) return;
      const iId = item.ingredientId as mongoose.Types.ObjectId;
      const ing = await Ingredient.findOne({ _id: iId, hotelId: hotelOId }).select('costPerUnit currentStock');
      if (!ing || ing.currentStock <= 0) return;
      const prevStock = Math.max(0, ing.currentStock - accepted);
      const newCost   = (prevStock * ing.costPerUnit + accepted * (item.purchasePrice as number)) / ing.currentStock;
      if (!isNaN(newCost) && newCost > 0) {
        await Ingredient.updateOne(
          { _id: iId, hotelId: hotelOId },
          { $set: { costPerUnit: +newCost.toFixed(4) } },
        );
      }
    });
  await Promise.all(wacOps);

  // Vendor ledger
  const grnValue = processedItems.reduce((sum, item) => {
    const accepted = Math.max(0,
      (item.receivedQty  as number) - (item.rejectedQty as number || 0),
    );
    return sum + accepted * ((item.purchasePrice as number) || 0);
  }, 0);

  if (grnValue > 0) {
    const updatedVendor = await Vendor.findByIdAndUpdate(
      grn.vendorId,
      { $inc: { currentOutstanding: grnValue } },
      { new: true },
    );
    await VendorLedgerEntry.create({
      hotelId:         hotelOId,
      vendorId:        grn.vendorId,
      entryType:       'grn',
      referenceId:     grn._id,
      referenceNumber: grnNumber,
      debit:           grnValue,
      credit:          0,
      runningBalance:  updatedVendor?.currentOutstanding ?? grnValue,
      description:     `GRN ${grnNumber} received via OCR import from ${po.vendorSnapshot.businessName}`,
    });
  }

  logger.info('[grnService] GRN created', { grnNumber, poId, hotelId, grnValue });

  return {
    poId:      po._id.toString(),
    poNumber:  po.poNumber,
    grnId:     grn._id.toString(),
    grnNumber,
    grnStatus: grn.status,
    grnValue:  +grnValue.toFixed(2),
  };
}
