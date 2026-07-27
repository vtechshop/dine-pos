// ─── OCR Background Worker ────────────────────────────────────────────────────
// Polls OcrJob for pending jobs every 10 seconds.
// Atomic pickup: findOneAndUpdate status pending→processing prevents double-processing.
// Flow: extract → match vendors → detect duplicates → save result → clear fileData.

import OcrJob from '../models/OcrJob';
import { extractInvoiceData } from '../services/ocrPipeline';
import { matchVendors } from '../services/vendorMatcher';
import { detectDuplicate } from '../services/duplicateDetector';
import { logger } from '../utils/logger';

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

// ─── Single job processor ─────────────────────────────────────────────────────

async function processNextJob(): Promise<void> {
  // Atomic pick-up: only one instance grabs this job
  const job = await OcrJob.findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'processing' } },
    { sort: { createdAt: 1 }, new: true },
  );

  if (!job) return; // nothing to process

  const jobId   = job._id.toString();
  const hotelId = job.hotelId.toString();

  logger.info('[ocrWorker] Processing job', { jobId, fileName: job.fileName });

  try {
    // ── Step 1: Gemini Vision OCR ────────────────────────────────────────
    const extracted = job.fileData
      ? await extractInvoiceData(job.fileData, job.fileMimeType, job.fileName)
      : null;

    if (!extracted) {
      job.status       = 'failed';
      job.errorMessage = 'Gemini OCR extraction returned no data. Gemini API may be unavailable or the file is unreadable.';
      job.fileData     = ''; // clear regardless
      await job.save();
      logger.warn('[ocrWorker] Extraction failed', { jobId });
      return;
    }

    // ── Step 2: Vendor matching ──────────────────────────────────────────
    const matchedVendors = await matchVendors(
      hotelId,
      extracted.vendorName,
      extracted.gstNumber,
    );

    // ── Step 3: Duplicate detection ──────────────────────────────────────
    const duplicateWarning = await detectDuplicate(
      hotelId,
      extracted.invoiceNumber,
      extracted.vendorName,
      extracted.totalAmount,
      jobId,
    );

    // ── Step 4: Save result + clear fileData ─────────────────────────────
    job.status           = 'completed';
    job.extractedData    = extracted as any;
    job.matchedVendors   = matchedVendors as any;
    job.duplicateWarning = duplicateWarning as any;
    job.fileData         = ''; // free storage after OCR
    job.errorMessage     = null;

    // Auto-select vendor if top match has confidence ≥ 0.9
    if (matchedVendors.length > 0 && matchedVendors[0].confidence >= 0.9) {
      job.selectedVendorId = matchedVendors[0].vendorId;
    }

    await job.save();

    logger.info('[ocrWorker] Job completed', {
      jobId,
      vendor:          extracted.vendorName,
      invoiceNumber:   extracted.invoiceNumber,
      itemCount:       extracted.items.length,
      vendorMatches:   matchedVendors.length,
      isDuplicate:     duplicateWarning.isDuplicate,
    });
  } catch (err) {
    logger.error('[ocrWorker] Unexpected error', { jobId, err: String(err) });
    try {
      await OcrJob.updateOne(
        { _id: job._id },
        {
          $set: {
            status:       'failed',
            errorMessage: `Worker error: ${String(err)}`,
            fileData:     '', // always clear
          },
        },
      );
    } catch { /* last-resort — ignore update failure */ }
  }
}

// ─── Worker tick ──────────────────────────────────────────────────────────────
// Process one job per tick. Multiple pending jobs are queued naturally —
// the next tick picks up the next one (10s interval).

async function tick(): Promise<void> {
  try {
    await processNextJob();
  } catch (err) {
    logger.error('[ocrWorker] Tick error', { err: String(err) });
  }
}

// ─── Start / stop ─────────────────────────────────────────────────────────────

export function startOcrWorker(): void {
  if (_timer !== null) {
    logger.warn('[ocrWorker] Already running — ignoring duplicate start');
    return;
  }
  logger.info('[ocrWorker] Starting (10s poll interval)');
  // Run immediately on start, then every 10s
  tick();
  _timer = setInterval(tick, 10_000);
}

export function stopOcrWorker(): void {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
    logger.info('[ocrWorker] Stopped');
  }
}
