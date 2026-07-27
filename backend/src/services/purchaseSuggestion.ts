// ─── Purchase Suggestion — Review Screen + Approval Logic ────────────────────
// Orchestrates the OCR → review → approve → PO + GRN pipeline.
// User MUST approve before any data is written to PO/GRN/Inventory.
// Gemini never writes to the database.

import mongoose from 'mongoose';
import OcrJob, { IExtractedInvoice, IExtractedItem } from '../models/OcrJob';
import { createApprovedPO, createGRNForApproval, GRNServiceItem } from './grnService';
import { logger } from '../utils/logger';

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
