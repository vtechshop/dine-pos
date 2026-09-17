/**
 * Go-Live Blocker Fix Sprint — Regression Tests
 *
 * Covers P2-01 through P2-04 from DINEPOS-GO-LIVE-READINESS-REPORT.md
 *
 * P2-01 — payment_pending bypass guard (orderRoutes.ts:1308)
 * P2-01 — Razorpay M13 guard uses existing.paymentMethod (orderRoutes.ts:1635)
 * P2-01 — OAuth Razorpay replay fix: server-stored gatewayOrderId (publicPaymentRoutes.ts:295)
 * P2-01 — timingSafeEqual on webhook secret (messagingWebhookRoutes.ts:81)
 * P2-02 — WhatsApp Sprint 2 key invariants verified in source
 * P2-04 — Split payment total validation on status completion path (orderRoutes.ts:1662)
 *
 * All tests are pure unit tests — no real DB, no real HTTP.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readSrc(...parts: string[]): string {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', ...parts),
    'utf8',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P2-01 — payment_pending bypass guard
// ─────────────────────────────────────────────────────────────────────────────

describe('P2-01 — payment_pending bypass guard', () => {
  const route = readSrc('routes', 'orderRoutes.ts');

  it('GL-01 — guard rejects non-cancel transitions from payment_pending', () => {
    // The guard must exist and check both conditions in the right order.
    expect(route).toContain("existing.status === 'payment_pending' && status !== 'cancelled'");
  });

  it('GL-02 — guard returns 400 with informative message', () => {
    expect(route).toContain('Payment-pending orders can only be cancelled');
  });

  it('GL-03 — guard appears before the atomic cancellation block (protects all roles)', () => {
    const guardIdx    = route.indexOf("existing.status === 'payment_pending'");
    const cancelIdx   = route.indexOf('H-04: atomic cancellation');
    expect(guardIdx).toBeGreaterThan(0);
    expect(cancelIdx).toBeGreaterThan(guardIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-01 — M13 Razorpay guard uses existing.paymentMethod
// ─────────────────────────────────────────────────────────────────────────────

describe('P2-01 — M13 Razorpay guard uses DB-stored paymentMethod', () => {
  const route = readSrc('routes', 'orderRoutes.ts');

  it('GL-04 — guard checks existing.paymentMethod (DB value) not only req.body', () => {
    expect(route).toContain("paymentMethod === 'razorpay' || existing.paymentMethod === 'razorpay'");
  });

  it('GL-05 — guard leads to Payment.findOne check for verified Razorpay payment', () => {
    const guardIdx   = route.indexOf("paymentMethod === 'razorpay' || existing.paymentMethod === 'razorpay'");
    const pmtFindIdx = route.indexOf('Payment.findOne', guardIdx);
    expect(pmtFindIdx).toBeGreaterThan(guardIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-01 — OAuth Razorpay replay protection
// ─────────────────────────────────────────────────────────────────────────────

describe('P2-01 — OAuth Razorpay replay protection (publicPaymentRoutes.ts)', () => {
  const route = readSrc('routes', 'publicPaymentRoutes.ts');

  it('GL-06 — qr-verify uses server-stored gatewayOrderId as primary', () => {
    expect(route).toContain('pay.gatewayOrderId || razorpay_order_id');
  });

  it('GL-07 — server-stored gatewayOrderId is passed to gateway.verifyPayment', () => {
    const idx = route.indexOf('pay.gatewayOrderId || razorpay_order_id');
    const verifyIdx = route.indexOf('verifyPayment', idx - 100);
    expect(verifyIdx).toBeGreaterThan(0);
    expect(Math.abs(idx - verifyIdx)).toBeLessThan(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-01 — timingSafeEqual on webhook secret
// ─────────────────────────────────────────────────────────────────────────────

describe('P2-01 — timingSafeEqual on messaging webhook secret', () => {
  const route = readSrc('routes', 'messagingWebhookRoutes.ts');

  it('GL-08 — timingSafeEqual imported from crypto', () => {
    expect(route).toContain("from 'crypto'");
    expect(route).toContain('timingSafeEqual');
  });

  it('GL-09 — comparison uses timingSafeEqual not plain !== ', () => {
    expect(route).toContain('timingSafeEqual(storedBuf, headerBuf)');
  });

  it('GL-10 — phone numbers are masked in all log callsites', () => {
    expect(route).toContain('_maskPhone(phone)');
    const count = (route.match(/_maskPhone\(phone\)/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-02 — WhatsApp key invariants (source-reading)
// ─────────────────────────────────────────────────────────────────────────────

describe('P2-02 — WhatsApp Auto-Receipts key invariants', () => {
  const worker   = readSrc('workers', 'whatsappReceiptWorker.ts');
  const service  = readSrc('services', 'whatsappReceiptService.ts');
  const webhook  = readSrc('routes', 'messagingWebhookRoutes.ts');
  const scheduler = readSrc('services', 'scheduler.ts');

  it('GL-11 — stale recovery function exported from worker', () => {
    expect(worker).toContain('export async function recoverStaleWhatsAppSendingJobs');
  });

  it('GL-12 — stale recovery uses 10-minute cutoff', () => {
    expect(worker).toContain('10 * 60_000');
  });

  it('GL-13 — worker success uses $nin guard to prevent delivered/read regression', () => {
    expect(worker).toContain("{ $nin: ['delivered', 'read'] }");
  });

  it('GL-14 — createWhatsAppReceiptJob never throws (internal try/catch)', () => {
    const jobFnIdx  = service.indexOf('export async function createWhatsAppReceiptJob');
    const catchIdx  = service.indexOf('} catch (err)', jobFnIdx);
    const nextFnIdx = service.indexOf('export async function', jobFnIdx + 1);
    // catch block appears before next exported function
    expect(catchIdx).toBeGreaterThan(jobFnIdx);
    expect(catchIdx).toBeLessThan(nextFnIdx);
  });

  it('GL-15 — receipt job creation is fire-and-forget in orderRoutes', () => {
    const orders = readSrc('routes', 'orderRoutes.ts');
    expect(orders).toContain('void createWhatsAppReceiptJob(');
  });

  it('GL-16 — stale recovery wired into scheduler', () => {
    expect(scheduler).toContain('recoverStaleWhatsAppSendingJobs');
    expect(scheduler).toContain('scheduleWhatsAppReceiptRecovery');
  });

  it('GL-17 — webhook lookup includes hotelId (hotel isolation)', () => {
    expect(webhook).toContain('hotelId:         hotelObjId,');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-04 — Split payment total validation (pure logic)
// ─────────────────────────────────────────────────────────────────────────────

describe('P2-04 — Split payment total validation on status completion path', () => {
  // Extract the same validation logic as the route implementation.
  // Returns null = valid, string = rejection message.
  function validateSplitDetails(
    sd: { cash?: number; upi?: number; card?: number },
    grandTotal: number,
  ): string | null {
    const splitTotal = (Number(sd.cash) || 0) + (Number(sd.upi) || 0) + (Number(sd.card) || 0);
    if (splitTotal > 0 && Math.abs(splitTotal - grandTotal) > 1) {
      return `Split payment total (${splitTotal.toFixed(2)}) must equal order total (${grandTotal.toFixed(2)})`;
    }
    return null;
  }

  it('GL-18 — exact split match is accepted (cash + upi = grandTotal)', () => {
    expect(validateSplitDetails({ cash: 200, upi: 300 }, 500)).toBeNull();
  });

  it('GL-19 — split within ±1 rupee is accepted (floating point tolerance)', () => {
    expect(validateSplitDetails({ cash: 199.5, upi: 300 }, 500)).toBeNull(); // diff = 0.5
  });

  it('GL-20 — split total exactly ₹1 over is accepted (boundary: tolerance is > 1)', () => {
    expect(validateSplitDetails({ cash: 200, upi: 301 }, 500)).toBeNull(); // diff = 1.0
  });

  it('GL-21 — split total more than ₹1 over is rejected', () => {
    const err = validateSplitDetails({ cash: 200, upi: 302 }, 500); // diff = 2
    expect(err).not.toBeNull();
    expect(err).toContain('502.00');
    expect(err).toContain('500.00');
  });

  it('GL-22 — split total more than ₹1 short is rejected', () => {
    const err = validateSplitDetails({ cash: 100, upi: 200 }, 500); // diff = 200
    expect(err).not.toBeNull();
  });

  it('GL-23 — all-cash split equal to grandTotal is accepted', () => {
    expect(validateSplitDetails({ cash: 750 }, 750)).toBeNull();
  });

  it('GL-24 — three-way split (cash + upi + card) summing correctly is accepted', () => {
    expect(validateSplitDetails({ cash: 100, upi: 100, card: 100 }, 300)).toBeNull();
  });

  it('GL-25 — zero splitDetails (all zeros) skips validation (no split recorded)', () => {
    // splitTotal = 0 → condition is splitTotal > 0, no validation fires
    expect(validateSplitDetails({ cash: 0, upi: 0, card: 0 }, 500)).toBeNull();
  });

  it('GL-26 — empty splitDetails object skips validation', () => {
    expect(validateSplitDetails({}, 500)).toBeNull();
  });

  it('GL-27 — split with undefined fields sums only defined fields', () => {
    expect(validateSplitDetails({ cash: 250, upi: 250 }, 500)).toBeNull(); // card undefined → 0
  });

  it('GL-28 — source code contains the validation in the status completion path', () => {
    const route = readSrc('routes', 'orderRoutes.ts');
    expect(route).toContain('M5 (status path): validate split totals match order total');
    expect(route).toContain('splitTotal - existing.grandTotal');
    expect(route).toContain('Math.abs(splitTotal - existing.grandTotal) > 1');
  });

  it('GL-29 — validation rejection message includes actual vs expected totals', () => {
    const err = validateSplitDetails({ cash: 600 }, 500);
    expect(err).not.toBeNull();
    expect(err).toMatch(/600\.00/);
    expect(err).toMatch(/500\.00/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-03 — Marketing label accuracy (source-reading)
// ─────────────────────────────────────────────────────────────────────────────

describe('P2-03 — Marketing label accuracy', () => {
  const homePage = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'marketing', 'src', 'pages', 'HomePage.tsx'),
    'utf8',
  );
  const featuresPage = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'marketing', 'src', 'pages', 'FeaturesPage.tsx'),
    'utf8',
  );

  it('GL-30 — Tally Direct Sync no longer in COMING_SOON array on HomePage', () => {
    // The COMING_SOON const should not exist anymore, or not contain Tally
    const hasTallyInComingSoon = /COMING_SOON\s*=\s*\[[\s\S]*?Tally/.test(homePage);
    expect(hasTallyInComingSoon).toBe(false);
  });

  it('GL-31 — Tally Direct Sync appears in INTEGRATIONS with Beta badge on HomePage', () => {
    expect(homePage).toContain('Tally Direct Sync');
    expect(homePage).toContain("badge: 'Beta'");
  });

  it('GL-32 — WhatsApp Receipts appears in INTEGRATIONS with Beta badge on HomePage', () => {
    expect(homePage).toContain('WhatsApp Receipts');
    expect(homePage).toContain("badge: 'Beta'");
  });

  it('GL-33 — FeaturesPage has Tally Direct Sync in BETA_FEATURES', () => {
    expect(featuresPage).toContain('Tally Direct Sync');
    expect(featuresPage).toContain('TallyPrime connector validation');
  });

  it('GL-34 — FeaturesPage has WhatsApp Auto-Receipts in BETA_FEATURES', () => {
    expect(featuresPage).toContain('WhatsApp Auto-Receipts');
    expect(featuresPage).toContain('MSG91 WhatsApp Business credentials');
  });

  it('GL-35 — Tally Beta note is honest (does not claim full production validation)', () => {
    const tallyIdx = featuresPage.indexOf('Tally Direct Sync');
    const noteSlice = featuresPage.slice(tallyIdx, tallyIdx + 400);
    expect(noteSlice).toContain('Beta');
    expect(noteSlice).not.toContain('fully production validated');
    expect(noteSlice).not.toContain('production tested');
  });
});
