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
let _running = false; // true while processNextJob is executing

// A job stuck in 'processing' for longer than this is assumed orphaned after crash
const STUCK_JOB_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes

// ─── Stuck-job recovery ───────────────────────────────────────────────────────
// Called once on startup. Resets jobs left in 'processing' by a previous crashed
// process so they re-enter the queue rather than being orphaned indefinitely.

async function recoverStuckJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);
  const { modifiedCount } = await OcrJob.updateMany(
    {
      status: 'processing',
      processingStartedAt: { $lt: cutoff },
    },
    {
      $set: { status: 'pending', processingStartedAt: null },
      $unset: { errorMessage: '' },
    },
  );
  if (modifiedCount > 0) {
    logger.warn('[ocrWorker] Reset stuck processing jobs', { count: modifiedCount });
  }
}

// ─── Single job processor ─────────────────────────────────────────────────────

async function processNextJob(): Promise<void> {
  // Atomic pick-up: only one instance grabs this job; record processingStartedAt
  // so stuck-job recovery can identify orphans after a crash.
  const job = await OcrJob.findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'processing', processingStartedAt: new Date() } },
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
      job.status              = 'failed';
      job.errorMessage        = 'Gemini OCR extraction returned no data. Gemini API may be unavailable or the file is unreadable.';
      job.processingStartedAt = null;
      job.fileData            = ''; // clear regardless
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
    job.status              = 'completed';
    job.extractedData       = extracted as any;
    job.matchedVendors      = matchedVendors as any;
    job.duplicateWarning    = duplicateWarning as any;
    job.fileData            = ''; // free storage after OCR
    job.errorMessage        = null;
    job.processingStartedAt = null;

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
            status:              'failed',
            errorMessage:        `Worker error: ${String(err)}`,
            fileData:            '', // always clear
            processingStartedAt: null,
          },
        },
      );
    } catch { /* last-resort — ignore update failure */ }
  }
}

// ─── Worker tick ──────────────────────────────────────────────────────────────
// Process one job per tick. _running prevents concurrent Gemini calls when
// a slow PDF causes a tick to overlap with the next 10-second interval.

async function tick(): Promise<void> {
  if (_running) return; // previous tick still in-flight — skip
  _running = true;
  try {
    await processNextJob();
  } catch (err) {
    logger.error('[ocrWorker] Tick error', { err: String(err) });
  } finally {
    _running = false;
  }
}

// ─── Start / stop ─────────────────────────────────────────────────────────────

export async function startOcrWorker(): Promise<void> {
  if (_timer !== null) {
    logger.warn('[ocrWorker] Already running — ignoring duplicate start');
    return;
  }
  logger.info('[ocrWorker] Starting (10s poll interval)');

  // Reset any jobs orphaned by a previous process crash before beginning
  try {
    await recoverStuckJobs();
  } catch (err) {
    logger.error('[ocrWorker] Stuck-job recovery failed', { err: String(err) });
  }

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
