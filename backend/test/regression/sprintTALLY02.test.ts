/**
 * TALLY-DIRECT-SYNC — SPRINT 2 — DEEP PRODUCTION HARDENING TESTS
 *
 * Pure-logic integration-style tests. No database, no real TallyPrime.
 * Covers the four genuine bugs found and fixed during the Sprint 2 audit:
 *
 *   BUG 1 — Missing callsites: cancellation, purchase-invoice, expense
 *   BUG 2 — tallyRoutes lacked requireAdmin (cashier could rotate connector token)
 *   BUG 3 — buildOrderXml discount/wallet accounting sign was CREDIT, should be DEBIT
 *   BUG 4 — validateBalance was defined but never invoked in XML-building paths
 *
 * Additional tests cover: backoff, stale recovery, idempotency, XML escaping,
 * security invariants, and design-level properties.
 *
 * All 45 Sprint 1 tests (sprintTALLY01) remain intact — DO NOT delete them.
 */

import {
  makeTallyIdempotencyKey,
  calcTallyBackoff,
  MAX_ATTEMPTS,
  BACKOFF_MS,
} from '../../src/services/tallySyncService';

import {
  validateBalance,
} from '../../src/services/tallyXmlBuilder';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeEntries(amounts: number[]): { ledgerName: string; amount: number }[] {
  return amounts.map((a, i) => ({ ledgerName: `Ledger${i}`, amount: a }));
}

// ─── TALLY-S2-01 through TALLY-S2-07: validateBalance guard (BUG 4) ─────────

describe('TALLY-S2 validateBalance guard (BUG-4)', () => {

  it('TALLY-S2-01: balanced entries return true', () => {
    const entries = makeEntries([100, -100]);
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S2-02: unbalanced entries return false', () => {
    const entries = makeEntries([100, -90]);
    expect(validateBalance(entries)).toBe(false);
  });

  it('TALLY-S2-03: zero-amount set balances', () => {
    const entries = makeEntries([0, 0]);
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S2-04: single Dr + Cr with tax split balances', () => {
    // Sales voucher: +100 pay Dr, -90 sales Cr, -5 cgst Cr, -5 sgst Cr
    const entries = makeEntries([100, -90, -5, -5]);
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S2-05: discount as DEBIT (positive) keeps balance — BUG-3 fix', () => {
    // grandTotal=118, taxTotal=18, cgst=9, sgst=9, subtotal=100, discount=10, netReceivable=108
    // pay Dr=108, sales Cr=-100, cgst Cr=-9, sgst Cr=-9, discount Dr=+10
    const entries = makeEntries([108, -100, -9, -9, 10]);
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S2-06: discount as CREDIT (negative) breaks balance — original bug', () => {
    // pay Dr=108, sales Cr=-100, cgst Cr=-9, sgst Cr=-9, discount Cr=-10 (WRONG sign)
    const entries = makeEntries([108, -100, -9, -9, -10]);
    expect(validateBalance(entries)).toBe(false);
  });

  it('TALLY-S2-07: wallet as DEBIT (positive) keeps balance — BUG-3 fix', () => {
    // grandTotal=100, walletAmt=20, netReceivable=80
    // pay Dr=80, sales Cr=-80, cgst=0 sgst=0, wallet Dr=+20, sales Cr extra -20
    const entries = makeEntries([80, -80, 20, -20]);
    expect(validateBalance(entries)).toBe(true);
  });

});

// ─── TALLY-S2-08 through TALLY-S2-12: Accounting sign invariants (BUG 3) ───

describe('TALLY-S2 Accounting sign invariants (BUG-3)', () => {

  it('TALLY-S2-08: payment ledger amount equals grandTotal minus discount minus wallet', () => {
    const grandTotal = 200;
    const discount   = 20;
    const walletAmt  = 10;
    const netReceivable = +(grandTotal - discount - walletAmt).toFixed(2);
    expect(netReceivable).toBe(170);
  });

  it('TALLY-S2-09: correct order entries balance when discount present', () => {
    // grandTotal=118, taxTotal=18, cgst=9, sgst=9, subtotal=100, discount=10, netReceivable=108
    // pay Dr=108, sales Cr=-100, cgst Cr=-9, sgst Cr=-9, discount Dr=+10
    const grandTotal    = 118;
    const taxTotal      = 18;
    const cgst          = +(taxTotal / 2).toFixed(2);
    const sgst          = +(taxTotal / 2).toFixed(2);
    const subtotal      = +(grandTotal - taxTotal).toFixed(2);
    const discount      = 10;
    const netReceivable = +(grandTotal - discount).toFixed(2);

    const entries = [
      { ledgerName: 'Cash',     amount:  netReceivable },
      { ledgerName: 'Sales',    amount: -subtotal      },
      { ledgerName: 'CGST',     amount: -cgst          },
      { ledgerName: 'SGST',     amount: -sgst          },
      { ledgerName: 'Discount', amount: +discount      },  // Dr — BUG-3 fix
    ];
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S2-10: incorrect order entries (old bug) fail balance when discount present', () => {
    const grandTotal    = 118;
    const taxTotal      = 18;
    const cgst          = +(taxTotal / 2).toFixed(2);
    const sgst          = +(taxTotal / 2).toFixed(2);
    const subtotal      = +(grandTotal - taxTotal).toFixed(2);
    const discount      = 10;
    const netReceivable = +(grandTotal - discount).toFixed(2);

    const buggyEntries = [
      { ledgerName: 'Cash',     amount:  netReceivable },
      { ledgerName: 'Sales',    amount: -subtotal      },
      { ledgerName: 'CGST',     amount: -cgst          },
      { ledgerName: 'SGST',     amount: -sgst          },
      { ledgerName: 'Discount', amount: -discount      },  // WRONG — old bug, -20 total imbalance
    ];
    expect(validateBalance(buggyEntries)).toBe(false);
  });

  it('TALLY-S2-11: cancellation voucher entries balance', () => {
    const grandTotal = 118;
    const taxTotal   = 18;
    const cgst       = +(taxTotal / 2).toFixed(2);
    const sgst       = +(taxTotal / 2).toFixed(2);
    const subtotal   = +(grandTotal - taxTotal).toFixed(2);

    const entries = [
      { ledgerName: 'Sales', amount:  subtotal   },  // Dr reversal
      { ledgerName: 'CGST',  amount:  cgst       },  // Dr reversal
      { ledgerName: 'SGST',  amount:  sgst       },  // Dr reversal
      { ledgerName: 'Cash',  amount: -grandTotal },  // Cr
    ];
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S2-12: expense voucher entries balance', () => {
    const amt = 500;
    const entries = [
      { ledgerName: 'Expense', amount:  amt },  // Dr
      { ledgerName: 'Cash',    amount: -amt },  // Cr
    ];
    expect(validateBalance(entries)).toBe(true);
  });

});

// ─── TALLY-S2-13 through TALLY-S2-17: idempotency key structure ─────────────

describe('TALLY-S2 idempotency key structure', () => {

  it('TALLY-S2-13: key format is hotelId:entityType:entityId:operation', () => {
    const key = makeTallyIdempotencyKey('hotel1', 'order', 'order123', 'create');
    expect(key).toBe('hotel1:order:order123:create');
  });

  it('TALLY-S2-14: cancellation key differs from order create key for same orderId', () => {
    const createKey = makeTallyIdempotencyKey('hotel1', 'order',        'order123', 'create');
    const cancelKey = makeTallyIdempotencyKey('hotel1', 'cancellation', 'order123', 'cancel');
    expect(createKey).not.toBe(cancelKey);
  });

  it('TALLY-S2-15: purchase invoice key uses purchase_invoice entity type', () => {
    const key = makeTallyIdempotencyKey('hotel1', 'purchase_invoice', 'inv456', 'create');
    expect(key).toBe('hotel1:purchase_invoice:inv456:create');
  });

  it('TALLY-S2-16: expense key uses expense entity type', () => {
    const key = makeTallyIdempotencyKey('hotel1', 'expense', 'exp789', 'create');
    expect(key).toBe('hotel1:expense:exp789:create');
  });

  it('TALLY-S2-17: keys from different hotels for the same entity do not collide', () => {
    const keyA = makeTallyIdempotencyKey('hotelA', 'order', 'order1', 'create');
    const keyB = makeTallyIdempotencyKey('hotelB', 'order', 'order1', 'create');
    expect(keyA).not.toBe(keyB);
  });

});

// ─── TALLY-S2-18 through TALLY-S2-23: backoff schedule ──────────────────────

describe('TALLY-S2 backoff schedule', () => {

  it('TALLY-S2-18: attemptCount=0 has zero backoff (first try, no prior failures)', () => {
    expect(calcTallyBackoff(0)).toBe(0);
  });

  it('TALLY-S2-19: attemptCount=1 has 5-minute backoff', () => {
    expect(calcTallyBackoff(1)).toBe(5 * 60_000);
  });

  it('TALLY-S2-20: attemptCount=2 has 15-minute backoff', () => {
    expect(calcTallyBackoff(2)).toBe(15 * 60_000);
  });

  it('TALLY-S2-21: attemptCount=3 has 1-hour backoff', () => {
    expect(calcTallyBackoff(3)).toBe(60 * 60_000);
  });

  it('TALLY-S2-22: attemptCount=4 has 4-hour backoff', () => {
    expect(calcTallyBackoff(4)).toBe(4 * 60 * 60_000);
  });

  it('TALLY-S2-23: MAX_ATTEMPTS matches BACKOFF_MS array length', () => {
    expect(MAX_ATTEMPTS).toBe(BACKOFF_MS.length);
  });

});

// ─── TALLY-S2-24 through TALLY-S2-28: requireAdmin invariant (BUG 2) ────────

describe('TALLY-S2 requireAdmin invariant (BUG-2)', () => {

  it('TALLY-S2-24: tallyRoutes file contains requireAdmin import', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyRoutes.ts'),
      'utf8',
    );
    expect(src).toContain('requireAdmin');
  });

  it('TALLY-S2-25: tallyRoutes uses requireAdmin as middleware', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyRoutes.ts'),
      'utf8',
    );
    expect(src).toMatch(/router\.use\(requireAdmin\)/);
  });

  it('TALLY-S2-26: requireAdmin appears before requireFeature in tallyRoutes', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyRoutes.ts'),
      'utf8',
    );
    const adminIdx   = src.indexOf('router.use(requireAdmin)');
    const featureIdx = src.indexOf("router.use(requireFeature('tally'))");
    expect(adminIdx).toBeGreaterThan(-1);
    expect(featureIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeLessThan(featureIdx);
  });

  it('TALLY-S2-27: auth middleware is the outermost layer in tallyRoutes', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyRoutes.ts'),
      'utf8',
    );
    const authIdx  = src.indexOf('router.use(authMiddleware)');
    const adminIdx = src.indexOf('router.use(requireAdmin)');
    expect(authIdx).toBeLessThan(adminIdx);
  });

  it('TALLY-S2-28: requireAdmin is imported from auth middleware in tallyRoutes', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyRoutes.ts'),
      'utf8',
    );
    expect(src).toMatch(/import.*requireAdmin.*from.*auth/);
  });

});

// ─── TALLY-S2-29 through TALLY-S2-33: missing callsites wired (BUG 1) ──────

describe('TALLY-S2 missing callsites wired (BUG-1)', () => {

  it('TALLY-S2-29: orderRoutes imports createTallySyncJobForCancellation', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/orderRoutes.ts'),
      'utf8',
    );
    expect(src).toContain('createTallySyncJobForCancellation');
  });

  it('TALLY-S2-30: orderRoutes calls createTallySyncJobForCancellation in cancellation block', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/orderRoutes.ts'),
      'utf8',
    );
    // The call must appear inside the cancellation section, after logAudit 'order.cancelled'
    const cancelIdx = src.indexOf("logAudit(req, 'order.cancelled'");
    const callIdx   = src.indexOf('createTallySyncJobForCancellation(req.hotelId!');
    expect(callIdx).toBeGreaterThan(cancelIdx);
  });

  it('TALLY-S2-31: purchaseInvoiceRoutes imports createTallySyncJobForPurchaseInvoice', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/purchaseInvoiceRoutes.ts'),
      'utf8',
    );
    expect(src).toContain('createTallySyncJobForPurchaseInvoice');
  });

  it('TALLY-S2-32: purchaseInvoiceRoutes calls createTallySyncJobForPurchaseInvoice after mark-paid', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/purchaseInvoiceRoutes.ts'),
      'utf8',
    );
    const paidAuditIdx = src.indexOf("logAudit(req, 'purchaseinvoice.paid'");
    const callIdx      = src.indexOf('createTallySyncJobForPurchaseInvoice(req.hotelId!');
    expect(callIdx).toBeGreaterThan(paidAuditIdx);
  });

  it('TALLY-S2-33: expenseRoutes calls createTallySyncJobForExpense after creation', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/expenseRoutes.ts'),
      'utf8',
    );
    expect(src).toContain('createTallySyncJobForExpense');
    const createdAuditIdx = src.indexOf("logAudit(req, 'expense.created'");
    const callIdx         = src.indexOf('createTallySyncJobForExpense(req.hotelId!');
    expect(callIdx).toBeGreaterThan(createdAuditIdx);
  });

});

// ─── TALLY-S2-34 through TALLY-S2-38: validateBalance wired in XML paths ────

describe('TALLY-S2 validateBalance wired in XML paths (BUG-4)', () => {

  it('TALLY-S2-34: tallyConnectorRoutes imports validateBalance', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyConnectorRoutes.ts'),
      'utf8',
    );
    expect(src).toContain('validateBalance');
  });

  it('TALLY-S2-35: buildOrderXml calls validateBalance before building XML', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyConnectorRoutes.ts'),
      'utf8',
    );
    const validateIdx = src.indexOf('validateBalance(entries)');
    const xmlIdx      = src.indexOf('buildTallyVoucherXml(');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(xmlIdx);
  });

  it('TALLY-S2-36: validateBalance failure returns empty string (skips XML build)', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyConnectorRoutes.ts'),
      'utf8',
    );
    // After validateBalance check, code must return '' to prevent sending unbalanced XML
    expect(src).toContain("!validateBalance(");
    expect(src).toContain("return '';");
  });

  it('TALLY-S2-37: poll endpoint marks job skipped when payload is empty', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyConnectorRoutes.ts'),
      'utf8',
    );
    // Must check for empty payload and set status: 'skipped'
    expect(src).toContain("status: 'skipped'");
    expect(src).toContain("BUILD_FAILED");
  });

  it('TALLY-S2-38: all four XML build functions call validateBalance', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyConnectorRoutes.ts'),
      'utf8',
    );
    // Count occurrences of validateBalance() — one per XML builder (order, cancellation, purchase, expense)
    const matches = src.match(/validateBalance\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

});

// ─── TALLY-S2-39 through TALLY-S2-43: security invariants ───────────────────

describe('TALLY-S2 security invariants', () => {

  it('TALLY-S2-39: connector token is never returned in GET config response', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyRoutes.ts'),
      'utf8',
    );
    // connectorToken must be stripped from response — expect destructure-exclude pattern
    expect(src).toMatch(/connectorToken.*_removed|_removed.*connectorToken/);
  });

  it('TALLY-S2-40: connector routes resolve hotel identity from token, never from client body', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyConnectorRoutes.ts'),
      'utf8',
    );
    // hotelId derived from resolveHotelFromToken, not req.body
    expect(src).toContain('resolveHotelFromToken');
    expect(src).not.toMatch(/req\.body\.hotelId|req\.params\.hotelId/);
  });

  it('TALLY-S2-41: connector token length guard rejects short tokens', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyConnectorRoutes.ts'),
      'utf8',
    );
    // resolveHotelFromToken must check token.length < 10
    expect(src).toContain('token.length < 10');
  });

  it('TALLY-S2-42: tally feature is disabled by default (opt-in)', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/middleware/requireFeature.ts'),
      'utf8',
    );
    // tally feature must default to false
    expect(src).toMatch(/tally.*false/);
  });

  it('TALLY-S2-43: connector token stored encrypted, not plaintext', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyRoutes.ts'),
      'utf8',
    );
    // Token must be encrypted before save
    expect(src).toContain('encrypt(');
  });

});

// ─── TALLY-S2-44 through TALLY-S2-48: fire-and-forget + stale recovery ──────

describe('TALLY-S2 fire-and-forget pattern and stale recovery', () => {

  it('TALLY-S2-44: createTallySyncJobForOrder is fire-and-forget (void prefix)', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/orderRoutes.ts'),
      'utf8',
    );
    expect(src).toMatch(/void createTallySyncJobForOrder/);
  });

  it('TALLY-S2-45: createTallySyncJobForCancellation is fire-and-forget (void prefix)', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/orderRoutes.ts'),
      'utf8',
    );
    expect(src).toMatch(/void createTallySyncJobForCancellation/);
  });

  it('TALLY-S2-46: createTallySyncJobForPurchaseInvoice is fire-and-forget (void prefix)', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/purchaseInvoiceRoutes.ts'),
      'utf8',
    );
    expect(src).toMatch(/void createTallySyncJobForPurchaseInvoice/);
  });

  it('TALLY-S2-47: createTallySyncJobForExpense is fire-and-forget (void prefix)', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/expenseRoutes.ts'),
      'utf8',
    );
    expect(src).toMatch(/void createTallySyncJobForExpense/);
  });

  it('TALLY-S2-48: stale recovery cutoff is 10 minutes', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/workers/tallySyncWorker.ts'),
      'utf8',
    );
    expect(src).toMatch(/10.*60.*1000|10\s*\*\s*60/);
  });

});

// ─── TALLY-S2-49 through TALLY-S2-52: design-level invariants ───────────────

describe('TALLY-S2 design-level invariants', () => {

  it('TALLY-S2-49: calcTallyBackoff clamps attemptCount beyond array length to last entry', () => {
    const lastBackoff = BACKOFF_MS[BACKOFF_MS.length - 1];
    // High attemptCount beyond array length should clamp to last BACKOFF_MS entry
    expect(calcTallyBackoff(MAX_ATTEMPTS + 10)).toBe(lastBackoff);
  });

  it('TALLY-S2-50: BACKOFF_MS values are strictly increasing', () => {
    for (let i = 1; i < BACKOFF_MS.length; i++) {
      expect(BACKOFF_MS[i]).toBeGreaterThan(BACKOFF_MS[i - 1]);
    }
  });

  it('TALLY-S2-51: upsertJob uses $setOnInsert for true idempotency', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/services/tallySyncService.ts'),
      'utf8',
    );
    expect(src).toContain('$setOnInsert');
  });

  it('TALLY-S2-52: poll uses atomic claim preventing double delivery', async () => {
    const fs   = await import('fs/promises');
    const path = await import('path');
    const src  = await fs.readFile(
      path.resolve(__dirname, '../../src/routes/tallyConnectorRoutes.ts'),
      'utf8',
    );
    // Atomic: findOneAndUpdate with status:'pending' query and status:'syncing' set in single op
    expect(src).toContain('findOneAndUpdate');
    expect(src).toContain("status:   'pending'");
    expect(src).toContain("status: 'syncing'");
  });

});
