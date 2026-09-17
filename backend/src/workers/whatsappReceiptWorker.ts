/**
 * WhatsApp Receipt Worker
 *
 * processQueuedWhatsAppReceipts() — called by scheduler.ts every 30s.
 *  1. Finds up to MAX_BATCH queued records whose nextRetryAt has passed.
 *  2. Atomically claims each by setting status='sending'.
 *  3. Builds template vars from the order/guest document.
 *  4. Calls the hotel's MSG91 provider.
 *  5. On provider acceptance: status='sent', requestId saved.
 *  6. On retryable failure: exponential backoff, status='queued', attemptCount++.
 *  7. On permanent failure or max attempts exceeded: status='failed'.
 *
 * Retry policy:
 *  - attempt 1 (initial):  immediate
 *  - attempt 2:            5 minutes
 *  - attempt 3 (final):    15 minutes
 *  - maxAttempts default:  3
 *
 * Permanent-failure keywords (no retry regardless of attempt count):
 *  'invalid', 'blocked', 'opt', 'not registered', 'unsubscribed', 'unauthorized', 'forbidden'
 *
 * Security invariants:
 *  - All DB lookups are hotel-scoped via hotelId
 *  - Provider credentials are never logged
 *  - failureReason stored on record is stripped of provider internals
 */

import WhatsAppReceipt from '../models/WhatsAppReceipt';
import type { IWhatsAppReceipt } from '../models/WhatsAppReceipt';
import { getMessagingProvider } from '../services/messagingProvider';
import { buildReceiptVars }     from '../services/whatsappReceiptService';
import { logger }               from '../utils/logger';

const MAX_BATCH = 20;

const BACKOFF_MS: number[] = [
  0,              // attempt 1 → no delay
  5  * 60_000,   // attempt 2 → 5 min
  15 * 60_000,   // attempt 3 → 15 min
];

const PERMANENT_KEYWORDS = [
  'invalid', 'blocked', 'opt', 'not registered',
  'unsubscribed', 'unauthorized', 'forbidden',
];

function _isPermanentFailure(reason: string): boolean {
  const lower = reason.toLowerCase();
  return PERMANENT_KEYWORDS.some(kw => lower.includes(kw));
}

function _safeReason(raw: string): string {
  // Strip any DB-internal / credential detail the provider might include
  if (!raw) return 'WhatsApp receipt could not be sent. Please try again.';
  // Truncate and redact common leak patterns
  return raw
    .replace(/authkey[^\s,;]*/gi, '[redacted]')
    .replace(/api[_-]?key[^\s,;]*/gi, '[redacted]')
    .slice(0, 300);
}

/**
 * Recover WhatsApp receipt jobs stuck in 'sending' status.
 * If the worker process crashes after claiming a job (status → 'sending')
 * but before completing the send, the job is otherwise permanently stuck —
 * it is not swept by the normal queue (which only looks for 'queued') and
 * cannot be manually retried (retry route only accepts 'failed' | 'skipped').
 *
 * Reset threshold: 10 minutes (same as Tally stale recovery).
 * Called by the scheduler every 5 minutes.
 */
export async function recoverStaleWhatsAppSendingJobs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 10 * 60_000);
    const result = await WhatsAppReceipt.updateMany(
      { status: 'sending', lastAttemptAt: { $lte: cutoff } },
      { $set: { status: 'queued', nextRetryAt: null } },
    );
    if (result.modifiedCount > 0) {
      logger.info('[WhatsApp] Recovered stale sending receipts', { count: result.modifiedCount });
    }
  } catch (e) {
    logger.warn('[WhatsApp] Stale receipt recovery failed', { err: String(e) });
  }
}

export async function processQueuedWhatsAppReceipts(): Promise<void> {
  const now = new Date();

  // Find queued records that are ready to send (nextRetryAt null or past)
  const records = await WhatsAppReceipt.find({
    status: 'queued',
    $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
  })
    .limit(MAX_BATCH)
    .lean<IWhatsAppReceipt[]>();

  for (const rec of records) {
    // Atomic claim — prevents a second concurrent worker sweep from double-sending
    const claimed = await WhatsAppReceipt.findOneAndUpdate(
      { _id: rec._id, status: 'queued' },
      { $set: { status: 'sending', lastAttemptAt: now } },
      { new: false },
    );
    if (!claimed) continue; // Already claimed by another iteration

    try {
      await _sendReceipt(rec, now);
    } catch (err) {
      // Unexpected error — put it back to queued so it retries
      logger.error('[WhatsApp] Unexpected error sending receipt', {
        receiptId: String(rec._id),
        hotelId:   String(rec.hotelId),
        err:       String(err),
      });
      await _handleRetry(rec, 'Unexpected internal error. Will retry.', now);
    }
  }
}

async function _sendReceipt(rec: IWhatsAppReceipt, now: Date): Promise<void> {
  const hotelIdStr = String(rec.hotelId);

  // Build vars from server-authoritative order/guest data
  const vars = await buildReceiptVars(hotelIdStr, rec.orderId, rec.guestId);

  // Resolve provider — hotel-scoped, credentials decrypted server-side
  const provider = await getMessagingProvider(hotelIdStr, 'whatsapp');

  if (provider.name === 'none') {
    // No provider configured — mark skipped, do not retry (not a delivery failure)
    await WhatsAppReceipt.findByIdAndUpdate(rec._id, {
      $set: {
        status:        'skipped',
        failureCode:   'no_provider',
        failureReason: 'No messaging provider configured for this hotel.',
      },
    });
    return;
  }

  const result = await provider.sendMessages(
    `receipt-${String(rec._id)}`,
    'whatsapp',
    [{
      phone:   rec.normalizedPhone,
      message: '',
      vars,
    }],
    {
      templateName:      rec.templateName,
      templateLanguage:  rec.templateLanguage,
      templateNamespace: '',
      templateVars:      rec.templateVars,
    },
  );

  if (result.status === 'sent' || result.status === 'partial') {
    // Provider accepted the message — NOT yet delivered (delivery comes via webhook).
    // Guard: don't regress if webhook already advanced the status to 'delivered'/'read'
    // in the race between MSG91 responding and this write.
    const requestId = result.recipients[0]?.requestId ?? null;
    await WhatsAppReceipt.findOneAndUpdate(
      { _id: rec._id, status: { $nin: ['delivered', 'read'] } },
      {
        $set: {
          status:       'sent',
          sentAt:       now,
          requestId,
          attemptCount: (rec.attemptCount ?? 0) + 1,
        },
      },
    );
    logger.info('[WhatsApp] Receipt sent', {
      receiptId:  String(rec._id),
      hotelId:    hotelIdStr,
      requestId,
    });
    return;
  }

  // Failure path
  const rawReason = result.reason
    ?? result.recipients[0]?.failureReason
    ?? 'Provider did not accept the message.';

  if (_isPermanentFailure(rawReason) || (rec.attemptCount ?? 0) + 1 >= rec.maxAttempts) {
    const isFinal = (rec.attemptCount ?? 0) + 1 >= rec.maxAttempts;
    await WhatsAppReceipt.findByIdAndUpdate(rec._id, {
      $set: {
        status:       'failed',
        failedAt:     now,
        failureCode:  _isPermanentFailure(rawReason) ? 'permanent' : 'max_attempts',
        failureReason: isFinal
          ? 'Receipt could not be sent after multiple attempts.'
          : _safeReason(rawReason),
        attemptCount: (rec.attemptCount ?? 0) + 1,
      },
    });
    logger.warn('[WhatsApp] Receipt permanently failed', {
      receiptId: String(rec._id),
      hotelId:   hotelIdStr,
      reason:    rawReason.slice(0, 100),
    });
    return;
  }

  await _handleRetry(rec, _safeReason(rawReason), now);
}

async function _handleRetry(
  rec: IWhatsAppReceipt,
  reason: string,
  now: Date,
): Promise<void> {
  const nextAttempt = (rec.attemptCount ?? 0) + 1;
  const backoffMs   = BACKOFF_MS[nextAttempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 15 * 60_000;
  const nextRetryAt = new Date(now.getTime() + backoffMs);

  await WhatsAppReceipt.findByIdAndUpdate(rec._id, {
    $set: {
      status:        'queued',
      failureReason: reason,
      attemptCount:  nextAttempt,
      nextRetryAt,
    },
  });

  logger.info('[WhatsApp] Receipt queued for retry', {
    receiptId:  String(rec._id),
    attempt:    nextAttempt,
    nextRetryAt: nextRetryAt.toISOString(),
  });
}
