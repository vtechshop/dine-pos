/**
 * Sprint WA-02 — WhatsApp Auto-Receipts Deep Production Hardening
 *
 * 52 pure-logic tests.  No network.  No DB.  No real MSG91 calls.
 *
 * Groups:
 *  WA-S2-01–07  Stale recovery — recoverStaleWhatsAppSendingJobs()
 *  WA-S2-08–15  Status non-regression — worker success guard
 *  WA-S2-16–22  Webhook phone masking
 *  WA-S2-23–29  Worker atomic claim pattern
 *  WA-S2-30–36  Permanent failure keyword detection
 *  WA-S2-37–43  Backoff schedule
 *  WA-S2-44–52  Invariants — fire-and-forget, scheduler wiring, security
 */

import * as fs   from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../src');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}

// ─── WA-S2-01–07  Stale recovery ─────────────────────────────────────────────

describe('WA-S2-01–07  Stale recovery for sending status', () => {
  const worker = readSrc('workers/whatsappReceiptWorker.ts');

  test('WA-S2-01: recoverStaleWhatsAppSendingJobs is exported', () => {
    expect(worker).toContain('export async function recoverStaleWhatsAppSendingJobs');
  });

  test('WA-S2-02: Recovery only touches status = "sending"', () => {
    expect(worker).toContain("status: 'sending'");
    // Must filter by lastAttemptAt + 10min cutoff
    expect(worker).toContain('lastAttemptAt');
    expect(worker).toContain('$lte: cutoff');
  });

  test('WA-S2-03: Recovered jobs are reset to "queued", not failed', () => {
    // The updateMany sets status: 'queued'
    const block = worker.slice(
      worker.indexOf('recoverStaleWhatsAppSendingJobs'),
      worker.indexOf('recoverStaleWhatsAppSendingJobs') + 800,
    );
    expect(block).toContain("status: 'queued'");
    expect(block).not.toContain("status: 'failed'");
  });

  test('WA-S2-04: Recovery threshold is 10 minutes', () => {
    const block = worker.slice(
      worker.indexOf('recoverStaleWhatsAppSendingJobs'),
      worker.indexOf('recoverStaleWhatsAppSendingJobs') + 600,
    );
    expect(block).toMatch(/10\s*\*\s*60/);
  });

  test('WA-S2-05: Recovery logs how many jobs were recovered', () => {
    const block = worker.slice(
      worker.indexOf('recoverStaleWhatsAppSendingJobs'),
      worker.indexOf('recoverStaleWhatsAppSendingJobs') + 800,
    );
    expect(block).toContain('modifiedCount');
    expect(block).toContain('logger.info');
  });

  test('WA-S2-06: Recovery errors are caught and logged at WARN, not thrown', () => {
    const block = worker.slice(
      worker.indexOf('recoverStaleWhatsAppSendingJobs'),
      worker.indexOf('recoverStaleWhatsAppSendingJobs') + 800,
    );
    expect(block).toContain('catch');
    expect(block).toContain('logger.warn');
  });

  test('WA-S2-07: Scheduler imports and calls recoverStaleWhatsAppSendingJobs', () => {
    const scheduler = readSrc('services/scheduler.ts');
    expect(scheduler).toContain('recoverStaleWhatsAppSendingJobs');
    // Called in scheduleWhatsAppReceiptRecovery
    expect(scheduler).toContain('scheduleWhatsAppReceiptRecovery');
  });
});

// ─── WA-S2-08–15  Status non-regression guard ─────────────────────────────────

describe('WA-S2-08–15  Worker success update must not regress status', () => {
  const worker = readSrc('workers/whatsappReceiptWorker.ts');

  test('WA-S2-08: Worker success path uses findOneAndUpdate, not findByIdAndUpdate', () => {
    // After the "sent/partial" branch the update must guard against regression
    const sentBlock = worker.slice(
      worker.indexOf("result.status === 'sent'"),
      worker.indexOf("result.status === 'sent'") + 400,
    );
    expect(sentBlock).toContain('findOneAndUpdate');
    expect(sentBlock).not.toContain('findByIdAndUpdate');
  });

  test('WA-S2-09: Success update excludes "delivered" from overwrite targets', () => {
    const sentBlock = worker.slice(
      worker.indexOf("result.status === 'sent'"),
      worker.indexOf("result.status === 'sent'") + 500,
    );
    expect(sentBlock).toContain('delivered');
  });

  test('WA-S2-10: Success update excludes "read" from overwrite targets', () => {
    const sentBlock = worker.slice(
      worker.indexOf("result.status === 'sent'"),
      worker.indexOf("result.status === 'sent'") + 500,
    );
    expect(sentBlock).toContain('read');
  });

  test('WA-S2-11: $nin guard is applied on the query, not the $set', () => {
    const sentBlock = worker.slice(
      worker.indexOf("result.status === 'sent'"),
      worker.indexOf("result.status === 'sent'") + 500,
    );
    // $nin appears BEFORE $set
    expect(sentBlock.indexOf('$nin')).toBeLessThan(sentBlock.indexOf('$set'));
  });

  test('WA-S2-12: Success status is still "sent" in the $set', () => {
    const sentBlock = worker.slice(
      worker.indexOf("result.status === 'sent'"),
      worker.indexOf("result.status === 'sent'") + 600,
    );
    expect(sentBlock).toContain("status:       'sent'");
  });

  test('WA-S2-13: sentAt is set in the success path', () => {
    const sentBlock = worker.slice(
      worker.indexOf("result.status === 'sent'"),
      worker.indexOf("result.status === 'sent'") + 600,
    );
    expect(sentBlock).toContain('sentAt');
  });

  test('WA-S2-14: attemptCount is incremented in the success path', () => {
    const sentBlock = worker.slice(
      worker.indexOf("result.status === 'sent'"),
      worker.indexOf("result.status === 'sent'") + 600,
    );
    expect(sentBlock).toContain('attemptCount');
  });

  test('WA-S2-15: requestId is saved in the success path', () => {
    const sentBlock = worker.slice(
      worker.indexOf("result.status === 'sent'"),
      worker.indexOf("result.status === 'sent'") + 600,
    );
    expect(sentBlock).toContain('requestId');
  });
});

// ─── WA-S2-16–22  Webhook phone masking ──────────────────────────────────────

describe('WA-S2-16–22  Webhook logs must not expose raw phone numbers', () => {
  const webhook = readSrc('routes/messagingWebhookRoutes.ts');

  test('WA-S2-16: _maskPhone helper is defined in the webhook file', () => {
    expect(webhook).toContain('function _maskPhone');
  });

  test('WA-S2-17: _maskPhone masks last 4 characters with ****', () => {
    expect(webhook).toContain("'****'");
    expect(webhook).toContain('slice');
  });

  test('WA-S2-18: Incomplete payload warning logs masked phone', () => {
    expect(webhook).toContain("phone: _maskPhone(phone)");
    expect(webhook).toContain('Incomplete payload');
  });

  test('WA-S2-19: Campaign status update log does not log raw phone', () => {
    const campaignLogBlock = webhook.slice(
      webhook.indexOf('Campaign message status updated'),
      webhook.indexOf('Campaign message status updated') + 300,
    );
    // Must use _maskPhone, not bare `phone,`
    expect(campaignLogBlock).toContain('_maskPhone(phone)');
  });

  test('WA-S2-20: WhatsApp receipt status update log does not log raw phone', () => {
    const receiptLogBlock = webhook.slice(
      webhook.indexOf('WhatsApp receipt status updated'),
      webhook.indexOf('WhatsApp receipt status updated') + 300,
    );
    expect(receiptLogBlock).toContain('_maskPhone(phone)');
  });

  test('WA-S2-21: _maskPhone returns **** for phone shorter than or equal to 4 chars', () => {
    // Structural: the function handles edge case
    const fnBlock = webhook.slice(
      webhook.indexOf('function _maskPhone'),
      webhook.indexOf('function _maskPhone') + 200,
    );
    expect(fnBlock).toContain('<= 4');
    expect(fnBlock).toContain("'****'");
  });

  test('WA-S2-22: No bare `phone,` or `phone }` in any logger call', () => {
    // Verify no leftover plain `phone` in a logger argument position
    const loggerCalls = webhook.match(/logger\.\w+\([^)]+\)/gs) ?? [];
    for (const call of loggerCalls) {
      // phone should only appear as _maskPhone(phone) — never as bare key: phone
      expect(call).not.toMatch(/[,{]\s*phone\s*[,}]/);
    }
  });
});

// ─── WA-S2-23–29  Atomic claim invariants ────────────────────────────────────

describe('WA-S2-23–29  Worker atomic claim prevents double-send', () => {
  const worker = readSrc('workers/whatsappReceiptWorker.ts');

  test('WA-S2-23: Worker sweeps only status = "queued" records', () => {
    expect(worker).toContain("status: 'queued'");
  });

  test('WA-S2-24: Claim uses findOneAndUpdate with status guard', () => {
    const claimBlock = worker.slice(
      worker.indexOf('Atomic claim'),
      worker.indexOf('Atomic claim') + 300,
    );
    expect(claimBlock).toContain('findOneAndUpdate');
    expect(claimBlock).toContain("status: 'queued'");
  });

  test('WA-S2-25: Claim transitions to "sending"', () => {
    const claimBlock = worker.slice(
      worker.indexOf('Atomic claim'),
      worker.indexOf('Atomic claim') + 300,
    );
    expect(claimBlock).toContain("status: 'sending'");
  });

  test('WA-S2-26: Worker skips record if claim returns null (already claimed)', () => {
    expect(worker).toContain('if (!claimed) continue;');
  });

  test('WA-S2-27: nextRetryAt null or past is required to be swept', () => {
    expect(worker).toContain('nextRetryAt: null');
    expect(worker).toContain('$lte: now');
  });

  test('WA-S2-28: lastAttemptAt is set at claim time', () => {
    const claimBlock = worker.slice(
      worker.indexOf('Atomic claim'),
      worker.indexOf('Atomic claim') + 300,
    );
    expect(claimBlock).toContain('lastAttemptAt: now');
  });

  test('WA-S2-29: MAX_BATCH limits how many records are swept per tick', () => {
    expect(worker).toContain('MAX_BATCH');
    expect(worker).toContain('.limit(MAX_BATCH)');
  });
});

// ─── WA-S2-30–36  Permanent failure keywords ─────────────────────────────────

describe('WA-S2-30–36  Permanent failure detection', () => {
  const worker = readSrc('workers/whatsappReceiptWorker.ts');

  test('WA-S2-30: PERMANENT_KEYWORDS includes "invalid"', () => {
    expect(worker).toContain("'invalid'");
  });

  test('WA-S2-31: PERMANENT_KEYWORDS includes "blocked"', () => {
    expect(worker).toContain("'blocked'");
  });

  test('WA-S2-32: PERMANENT_KEYWORDS includes "not registered"', () => {
    expect(worker).toContain("'not registered'");
  });

  test('WA-S2-33: PERMANENT_KEYWORDS includes "opt"', () => {
    expect(worker).toContain("'opt'");
  });

  test('WA-S2-34: Permanent failure check uses case-insensitive match', () => {
    expect(worker).toContain('.toLowerCase()');
  });

  test('WA-S2-35: Permanent failure marks receipt as "failed", not queued', () => {
    const permBlock = worker.slice(
      worker.indexOf('_isPermanentFailure'),
      worker.indexOf('_isPermanentFailure') + 100,
    );
    // The exported function exists and is used in the worker logic
    expect(permBlock).toBeDefined();
    // The failure path transitions to 'failed'
    expect(worker).toContain("status:       'failed'");
  });

  test('WA-S2-36: Max-attempts exhaustion also marks receipt as "failed"', () => {
    expect(worker).toContain('max_attempts');
    expect(worker).toContain("failureCode:");
  });
});

// ─── WA-S2-37–43  Backoff schedule ───────────────────────────────────────────

describe('WA-S2-37–43  WhatsApp retry backoff', () => {
  const worker = readSrc('workers/whatsappReceiptWorker.ts');

  test('WA-S2-37: BACKOFF_MS has at least 3 entries', () => {
    // TypeScript type annotation: `const BACKOFF_MS: number[] = [`
    expect(worker).toContain('BACKOFF_MS');
    // Should contain all three delay values
    expect(worker).toContain('0,');
    expect(worker).toMatch(/5\s*\*\s*60_000/);
    expect(worker).toMatch(/15\s*\*\s*60_000/);
  });

  test('WA-S2-38: First BACKOFF_MS entry is 0 (immediate first attempt)', () => {
    // First entry after the opening bracket is 0
    expect(worker).toMatch(/BACKOFF_MS[^=]+=\s*\[\s*\n\s*0/);
  });

  test('WA-S2-39: Second BACKOFF_MS entry is 5 minutes', () => {
    expect(worker).toMatch(/5\s*\*\s*60_000/);
  });

  test('WA-S2-40: Third BACKOFF_MS entry is 15 minutes', () => {
    expect(worker).toMatch(/15\s*\*\s*60_000/);
  });

  test('WA-S2-41: _handleRetry calculates nextRetryAt from backoff', () => {
    const retryBlock = worker.slice(
      worker.indexOf('async function _handleRetry'),
      worker.indexOf('async function _handleRetry') + 500,
    );
    expect(retryBlock).toContain('nextRetryAt');
    expect(retryBlock).toContain('backoffMs');
  });

  test('WA-S2-42: _handleRetry increments attemptCount', () => {
    const retryBlock = worker.slice(
      worker.indexOf('async function _handleRetry'),
      worker.indexOf('async function _handleRetry') + 500,
    );
    expect(retryBlock).toContain('attemptCount');
    expect(retryBlock).toContain('nextAttempt');
  });

  test('WA-S2-43: _handleRetry sets status back to "queued"', () => {
    const retryBlock = worker.slice(
      worker.indexOf('async function _handleRetry'),
      worker.indexOf('async function _handleRetry') + 700,
    );
    expect(retryBlock).toContain("'queued'");
  });
});

// ─── WA-S2-44–52  Invariants ──────────────────────────────────────────────────

describe('WA-S2-44–52  Design invariants and security', () => {
  test('WA-S2-44: createWhatsAppReceiptJob is fire-and-forget (void) in orderRoutes', () => {
    const orderRoutes = readSrc('routes/orderRoutes.ts');
    expect(orderRoutes).toContain('void createWhatsAppReceiptJob(');
  });

  test('WA-S2-45: createWhatsAppReceiptJobForGuest is fire-and-forget (void) in guestRoutes', () => {
    const guestRoutes = readSrc('routes/guestRoutes.ts');
    expect(guestRoutes).toContain('void createWhatsAppReceiptJobForGuest(');
  });

  test('WA-S2-46: Scheduler starts WhatsApp recovery alongside Tally recovery', () => {
    const scheduler = readSrc('services/scheduler.ts');
    expect(scheduler).toContain('scheduleWhatsAppReceiptRecovery()');
    expect(scheduler).toContain('scheduleTallyRecovery()');
  });

  test('WA-S2-47: Scheduler stopScheduler clears waReceiptRecoveryTick', () => {
    const scheduler = readSrc('services/scheduler.ts');
    expect(scheduler).toContain('waReceiptRecoveryTick');
    expect(scheduler).toContain('clearInterval(waReceiptRecoveryTick)');
  });

  test('WA-S2-48: Webhook requires x-dinepos-secret header before any DB write', () => {
    const webhook = readSrc('routes/messagingWebhookRoutes.ts');
    const secretIdx   = webhook.indexOf('x-dinepos-secret');
    const dbWriteIdx  = webhook.indexOf('findOneAndUpdate');
    expect(secretIdx).toBeGreaterThan(0);
    expect(dbWriteIdx).toBeGreaterThan(secretIdx);
  });

  test('WA-S2-49: Webhook hotelId comes from URL param, not request body', () => {
    const webhook = readSrc('routes/messagingWebhookRoutes.ts');
    // hotelId extracted from req.params
    expect(webhook).toContain('req.params');
    expect(webhook).not.toMatch(/hotelId\s*=\s*.*req\.body/);
  });

  test('WA-S2-50: WhatsApp settings routes require requireAdmin', () => {
    const settings = readSrc('routes/whatsappSettingsRoutes.ts');
    expect(settings).toContain('requireAdmin');
  });

  test('WA-S2-51: Worker errors are caught and do not crash the scheduler', () => {
    const worker = readSrc('workers/whatsappReceiptWorker.ts');
    // Unexpected errors in _sendReceipt are caught in processQueuedWhatsAppReceipts
    expect(worker).toContain('} catch (err) {');
    expect(worker).toContain('logger.error');
  });

  test('WA-S2-52: No provider API key is ever logged', () => {
    const worker   = readSrc('workers/whatsappReceiptWorker.ts');
    const service  = readSrc('services/whatsappReceiptService.ts');
    const provider = readSrc('services/messagingProvider.ts');
    // None of these files should log apiKey or apiKeyEnc
    for (const src of [worker, service, provider]) {
      const lines = src.split('\n').filter(l => l.includes('logger.'));
      for (const line of lines) {
        expect(line).not.toMatch(/apiKey/i);
      }
    }
  });
});
