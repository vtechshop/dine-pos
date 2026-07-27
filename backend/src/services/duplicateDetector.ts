// ─── Duplicate Invoice Detector ───────────────────────────────────────────────
// Checks for already-imported invoices using: invoice number, vendor, amount.
// Searches OcrJob history (approved jobs) and PurchaseOrders.
// Never writes to DB. Returns a warning if a duplicate is suspected.

import mongoose from 'mongoose';
import OcrJob from '../models/OcrJob';
import PurchaseOrder from '../models/PurchaseOrder';
import { IDuplicateWarning } from '../models/OcrJob';

// Amount proximity: within ±2% is considered a potential duplicate
const AMOUNT_TOLERANCE = 0.02;

function amountsMatch(a: number, b: number): boolean {
  if (a === 0 && b === 0) return false; // both zero → inconclusive
  if (a === 0 || b === 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= AMOUNT_TOLERANCE;
}

function normalizeInvoiceNumber(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function detectDuplicate(
  hotelId:       string,
  invoiceNumber: string,
  vendorName:    string,
  totalAmount:   number,
  excludeJobId?: string, // exclude the current job itself
): Promise<IDuplicateWarning> {
  const hotelOId = new mongoose.Types.ObjectId(hotelId);
  const normInv  = normalizeInvoiceNumber(invoiceNumber);

  // ── Check 1: existing approved OcrJob with same invoice number ────────────
  if (normInv) {
    const existingJobs = await OcrJob.find(
      {
        hotelId: hotelOId,
        status:  { $in: ['completed', 'approved'] },
        ...(excludeJobId ? { _id: { $ne: new mongoose.Types.ObjectId(excludeJobId) } } : {}),
      },
      { extractedData: 1, reviewedData: 1, status: 1, createdPoId: 1 },
    ).lean();

    for (const job of existingJobs) {
      const data = (job.reviewedData ?? job.extractedData) as any;
      if (!data?.invoiceNumber) continue;
      const existingNorm = normalizeInvoiceNumber(String(data.invoiceNumber));
      if (existingNorm && existingNorm === normInv) {
        return {
          isDuplicate:   true,
          matchedJobId:  job._id.toString(),
          matchedPoId:   job.createdPoId ?? null,
          reason:        `Invoice number "${invoiceNumber}" was already imported${job.status === 'approved' ? ' and approved' : ''}.`,
        };
      }
    }
  }

  // ── Check 2: PurchaseOrder with matching amount + vendor name proximity ────
  // PO doesn't store vendor invoice number, so we use total amount as signal
  if (totalAmount > 0) {
    const recentPos = await PurchaseOrder.find(
      {
        hotelId:   hotelOId,
        isDeleted: false,
        total:     {
          $gte: totalAmount * (1 - AMOUNT_TOLERANCE),
          $lte: totalAmount * (1 + AMOUNT_TOLERANCE),
        },
        createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }, // last 90 days
      },
      { total: 1, vendorSnapshot: 1 },
    ).lean();

    for (const po of recentPos) {
      const poVendor   = String((po.vendorSnapshot as any)?.businessName ?? '').toLowerCase();
      const queryVendor = vendorName.toLowerCase();
      // Vendor name must overlap somewhat (≥40% token match)
      const poTokens    = poVendor.split(/\s+/).filter((w) => w.length > 2);
      const qTokens     = queryVendor.split(/\s+/).filter((w) => w.length > 2);
      const overlap     = poTokens.filter((t) => queryVendor.includes(t)).length;
      const overlapRatio = qTokens.length > 0 ? overlap / qTokens.length : 0;

      if (overlapRatio >= 0.4) {
        return {
          isDuplicate:  true,
          matchedJobId: null,
          matchedPoId:  po._id.toString(),
          reason:       `A Purchase Order (₹${totalAmount}) from a similar vendor already exists within the last 90 days.`,
        };
      }
    }
  }

  return { isDuplicate: false, matchedJobId: null, matchedPoId: null, reason: '' };
}
