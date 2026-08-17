// ─── Purchase Suggestion Service ──────────────────────────────────────────────
// Computes data-driven purchase recommendations from inventory + sales data.
// NEVER invents prices or quantities. Uses only real stock + GRN data.

import mongoose from 'mongoose';
import Ingredient from '../models/Ingredient';
import PurchaseOrder from '../models/PurchaseOrder';
import OcrJob, { IExtractedInvoice, IExtractedItem } from '../models/OcrJob';
import { createApprovedPO, createGRNForApproval, GRNServiceItem } from './grnService';
import { logger } from '../utils/logger';

export interface PurchaseSuggestion {
  ingredientId:    string;
  name:            string;
  unit:            string;
  currentStock:    number;
  lowStockThreshold: number;
  daysRemaining:   number | null;  // null = no consumption data
  suggestedQty:    number;
  estimatedCost:   number | null;  // null = no cost data
  reason:          string;
  urgency:         'critical' | 'soon' | 'plan';
  hasPendingPO:    boolean;
  usageSource:     'configured' | 'none';
  suggestedVendor:   string | null;
  lastPurchasePrice: number | null;
  lastGrnDate:       string | null;
}

export interface PurchaseSuggestionResult {
  suggestions:     PurchaseSuggestion[];
  totalEstimatedCost: number | null;
  dataLimitations: string[];
}

export async function buildPurchaseSuggestions(
  hotelId: string,
): Promise<PurchaseSuggestionResult> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const limitations: string[] = [];

  // ── 1. Fetch all ingredients below or near threshold ─────────────────────
  const ingredients = await Ingredient.find(
    { hotelId: hotelOId },
    {
      name: 1, unit: 1, currentStock: 1,
      lowStockThreshold: 1, costPerUnit: 1,
      dailyConsumption: 1, reorderQty: 1,
    },
  ).lean();

  if (ingredients.length === 0) {
    limitations.push('No ingredients configured. Set up your ingredient list first.');
    return { suggestions: [], totalEstimatedCost: null, dataLimitations: limitations };
  }

  // ── 2. Fetch pending POs to avoid duplicate suggestions ──────────────────
  const pendingPOs = await PurchaseOrder.find(
    { hotelId: hotelOId, status: { $in: ['pending', 'sent', 'partial'] } },
    { 'items.ingredientId': 1 },
  ).lean();

  const pendingIngredientIds = new Set<string>();
  for (const po of pendingPOs) {
    for (const item of (po as any).items ?? []) {
      if (item.ingredientId) pendingIngredientIds.add(item.ingredientId.toString());
    }
  }

  // ── 3. Find the most recent vendor for each ingredient (from GRN history) ──
  const GRN = (await import('../models/GRN')).default;
  const Vendor = (await import('../models/Vendor')).default;

  const grnHistory = await GRN.aggregate([
    { $match: { hotelId: hotelOId, status: 'approved' } },
    { $unwind: '$items' },
    { $match: { 'items.ingredientId': { $ne: null } } },
    { $sort: { receivedAt: -1 } },
    {
      $group: {
        _id:      '$items.ingredientId',
        vendorId: { $first: '$vendorId' },
        lastPurchasePrice: { $first: '$items.purchasePrice' },
        lastGrnDate:       { $first: '$receivedAt' },
      },
    },
  ]);

  const ingredientVendorMap = new Map<string, { vendorId: string; lastPrice: number; lastDate: Date }>();
  for (const g of grnHistory as any[]) {
    ingredientVendorMap.set(g._id.toString(), {
      vendorId:  g.vendorId?.toString() ?? '',
      lastPrice: g.lastPurchasePrice ?? 0,
      lastDate:  g.lastGrnDate,
    });
  }

  // Fetch vendor names for all referenced vendors
  const vendorIds = [...new Set([...ingredientVendorMap.values()].map((v) => v.vendorId).filter(Boolean))];
  const vendors = vendorIds.length > 0
    ? await Vendor.find({ _id: { $in: vendorIds } }, { businessName: 1 }).lean()
    : [];
  const vendorNameMap = new Map<string, string>(
    (vendors as any[]).map((v) => [v._id.toString(), v.businessName ?? 'Unknown vendor']),
  );

  // ── 4. Build suggestions ──────────────────────────────────────────────────
  const suggestions: PurchaseSuggestion[] = [];

  for (const ing of ingredients) {
    const i = ing as any;
    const stock     = Number(i.currentStock     ?? 0);
    const threshold = Number(i.lowStockThreshold ?? 0);

    // Only suggest if stock is at or below threshold
    if (stock > threshold) continue;

    const dailyUse  = Number(i.dailyConsumption ?? 0);
    const daysLeft  = dailyUse > 0 ? Math.floor(stock / dailyUse) : null;
    const reorderQty = Number(i.reorderQty ?? 0) || Math.max(threshold * 2, 1);
    const costPerUnit = Number(i.costPerUnit ?? 0);
    const estimatedCost = costPerUnit > 0 ? +(reorderQty * costPerUnit).toFixed(2) : null;

    let urgency: 'critical' | 'soon' | 'plan' = 'plan';
    if (stock <= 0 || (daysLeft !== null && daysLeft <= 1)) urgency = 'critical';
    else if (daysLeft !== null && daysLeft <= 3) urgency = 'soon';
    else if (stock <= threshold * 0.5) urgency = 'soon';

    let reason = `Stock (${stock} ${i.unit}) is at or below reorder level (${threshold} ${i.unit})`;
    if (daysLeft !== null) {
      reason += `. At current usage, ~${daysLeft} day(s) of stock remaining`;
    }
    if (i.dailyConsumption === undefined || i.dailyConsumption === 0) {
      limitations.push(`"${i.name}": daily consumption not configured — quantity estimate uses reorder threshold`);
    }

    suggestions.push({
      ingredientId:      i._id.toString(),
      name:              i.name,
      unit:              i.unit,
      currentStock:      stock,
      lowStockThreshold: threshold,
      daysRemaining:     daysLeft,
      suggestedQty:      reorderQty,
      estimatedCost,
      reason,
      urgency,
      hasPendingPO:      pendingIngredientIds.has(i._id.toString()),
      usageSource:       dailyUse > 0 ? 'configured' : 'none',
      suggestedVendor:   ingredientVendorMap.get(i._id.toString())
        ? vendorNameMap.get(ingredientVendorMap.get(i._id.toString())!.vendorId) ?? null
        : null,
      lastPurchasePrice: ingredientVendorMap.get(i._id.toString())?.lastPrice ?? null,
      lastGrnDate:       ingredientVendorMap.get(i._id.toString())?.lastDate?.toISOString().slice(0, 10) ?? null,
    });
  }

  // Sort: critical first, then soon, then plan; within each group: most urgent first
  const urgencyOrder = { critical: 0, soon: 1, plan: 2 };
  suggestions.sort((a, b) => {
    const uDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (uDiff !== 0) return uDiff;
    return (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999);
  });

  const totalCostItems = suggestions.filter((s) => s.estimatedCost !== null);
  const totalEstimatedCost = totalCostItems.length > 0
    ? +totalCostItems.reduce((s, item) => s + (item.estimatedCost ?? 0), 0).toFixed(2)
    : null;

  if (totalCostItems.length < suggestions.length) {
    limitations.push('Some items have no costPerUnit configured — total cost estimate is partial.');
  }

  return {
    suggestions,
    totalEstimatedCost,
    dataLimitations: [...new Set(limitations)],
  };
}

// ─── OCR Review Screen + Approval Logic ──────────────────────────────────────
// Orchestrates the OCR → review → approve → PO + GRN pipeline.

// ─── Review data ──────────────────────────────────────────────────────────────

export interface ReviewScreen {
  jobId:             string;
  status:            string;
  extractedData:     IExtractedInvoice | null;
  reviewedData:      IExtractedInvoice | null;
  matchedVendors:    Array<{
    vendorId: string; businessName: string; gstNumber: string; confidence: number;
  }>;
  selectedVendorId:  string | null;
  duplicateWarning:  {
    isDuplicate: boolean; matchedJobId: string | null; matchedPoId: string | null; reason: string;
  } | null;
  // Active data = reviewedData if set, else extractedData
  activeData: IExtractedInvoice | null;
  createdAt:  Date;
}

export async function getReviewScreen(
  hotelId: string,
  jobId:   string,
): Promise<ReviewScreen | null> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const job = await OcrJob.findOne({ _id: jobId, hotelId: hotelOId }).lean();
  if (!job) return null;

  return {
    jobId:            job._id.toString(),
    status:           job.status,
    extractedData:    job.extractedData   ?? null,
    reviewedData:     job.reviewedData    ?? null,
    matchedVendors:   (job.matchedVendors as any[]) ?? [],
    selectedVendorId: job.selectedVendorId ?? null,
    duplicateWarning: job.duplicateWarning ?? null,
    activeData:       job.reviewedData ?? job.extractedData ?? null,
    createdAt:        job.createdAt,
  };
}

// ─── Update reviewed data ─────────────────────────────────────────────────────
// User edits the OCR result on the review screen before approving.

export async function updateReviewedData(
  hotelId:          string,
  jobId:            string,
  reviewedData:     IExtractedInvoice,
  selectedVendorId: string | null,
): Promise<boolean> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const result = await OcrJob.updateOne(
    { _id: jobId, hotelId: hotelOId, status: 'completed' },
    { $set: { reviewedData, selectedVendorId } },
  );
  return result.modifiedCount > 0;
}

// ─── Approval ─────────────────────────────────────────────────────────────────
// Creates PO (status=approved) + GRN + stock update + WAC + vendor ledger.
// Only runs if job is in 'completed' status (OCR done, not yet approved).

export interface ApprovalResult {
  jobId:     string;
  poId:      string;
  poNumber:  string;
  grnId:     string;
  grnNumber: string;
  grnStatus: string;
  grnValue:  number;
}

export async function approveOcrJob(
  hotelId:          string,
  jobId:            string,
  selectedVendorId: string,
  reviewedData?:    IExtractedInvoice,
  approvedBy:       string = 'admin',
): Promise<ApprovalResult> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);

  const job = await OcrJob.findOne({ _id: jobId, hotelId: hotelOId });
  if (!job) throw new Error('OCR job not found');
  if (job.status !== 'completed') throw new Error(`Job is not in completed state (current: ${job.status})`);

  // Use reviewedData from request if provided, else from DB, else extractedData
  const activeData: IExtractedInvoice | null =
    reviewedData ?? job.reviewedData ?? job.extractedData ?? null;

  if (!activeData || activeData.items.length === 0) {
    throw new Error('No invoice data available to approve');
  }

  // Build GRN service items
  const items: GRNServiceItem[] = activeData.items.map((item: IExtractedItem) => ({
    productName:   item.productName,
    ingredientId:  item.ingredientId ?? null,
    orderedQty:    item.quantity,
    receivedQty:   item.quantity, // fully received on approval
    unit:          item.unit,
    purchasePrice: item.unitPrice,
    taxPercent:    item.taxPercent,
  }));

  // Step 1: Create PO (status=approved)
  const { po, poNumber } = await createApprovedPO(
    hotelId,
    selectedVendorId,
    items,
    0,
    `Imported via OCR — Invoice: ${activeData.invoiceNumber} | ${activeData.vendorName}`,
  );

  // Step 2: Create GRN + stock update + WAC + ledger
  const grnResult = await createGRNForApproval(
    hotelId,
    po._id.toString(),
    items,
    activeData.invoiceDate ? new Date(activeData.invoiceDate) : new Date(),
    `OCR import — Invoice ${activeData.invoiceNumber}`,
  );

  // Step 3: Mark OcrJob as approved
  job.status            = 'approved';
  job.reviewedData      = reviewedData ?? job.reviewedData ?? null;
  job.selectedVendorId  = selectedVendorId;
  job.createdPoId       = grnResult.poId;
  job.createdGrnId      = grnResult.grnId;
  job.approvedBy        = approvedBy;
  job.approvedAt        = new Date();
  await job.save();

  logger.info('[purchaseSuggestion] OCR job approved', {
    jobId, poId: grnResult.poId, grnId: grnResult.grnId,
  });

  return { jobId, ...grnResult };
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectOcrJob(
  hotelId:  string,
  jobId:    string,
  reason:   string = '',
): Promise<boolean> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const result = await OcrJob.updateOne(
    { _id: jobId, hotelId: hotelOId, status: { $in: ['completed', 'failed'] } },
    { $set: { status: 'rejected', errorMessage: reason || 'Rejected by user' } },
  );
  return result.modifiedCount > 0;
}
