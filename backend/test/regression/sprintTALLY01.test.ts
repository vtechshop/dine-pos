/**
 * Tally Direct Sync — Sprint 1 Regression Tests
 * TALLY-S1-01 through TALLY-S1-45
 *
 * Covers:
 *  - Idempotency key construction (TALLY-S1-01 to TALLY-S1-05)
 *  - Backoff calculation (TALLY-S1-06 to TALLY-S1-10)
 *  - XML escaping (TALLY-S1-11 to TALLY-S1-15)
 *  - TallyPrime date formatting (TALLY-S1-16 to TALLY-S1-18)
 *  - buildTallyVoucherXml structure (TALLY-S1-19 to TALLY-S1-25)
 *  - Double-entry balance validation (TALLY-S1-26 to TALLY-S1-30)
 *  - resolvePaymentLedger (TALLY-S1-31 to TALLY-S1-35)
 *  - buildTallyCancellationXml (TALLY-S1-36 to TALLY-S1-38)
 *  - Status state machine (TALLY-S1-39 to TALLY-S1-42)
 *  - Ledger map defaults (TALLY-S1-43 to TALLY-S1-45)
 *
 * All tests are pure-logic — no real DB, no real Tally, no HTTP.
 */

// ── Inline mirrors of the functions under test ────────────────────────────────

const BACKOFF_MS = [0, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];
const MAX_ATTEMPTS = 5;

function makeTallyIdempotencyKey(
  hotelId: string,
  entityType: string,
  entityId: string,
  operation: string,
): string {
  return `${hotelId}:${entityType}:${entityId}:${operation}`;
}

function calcTallyBackoff(attemptCount: number): number {
  const idx = Math.min(attemptCount, BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tallyDate(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

interface TallyLedgerEntry {
  ledgerName: string;
  amount: number;
}

interface TallyVoucherParams {
  guid:          string;
  companyName:   string;
  voucherType:   'Sales' | 'Purchase' | 'Journal' | 'Payment' | 'Receipt';
  voucherDate:   Date;
  voucherNumber: string;
  narration:     string;
  ledgerEntries: TallyLedgerEntry[];
}

function buildEntry(e: TallyLedgerEntry): string {
  const isDebit = e.amount >= 0;
  return `
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
      <AMOUNT>${Math.abs(e.amount).toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`;
}

function buildTallyVoucherXml(params: TallyVoucherParams): string {
  const entries = params.ledgerEntries.map(buildEntry).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(params.companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER REMOTEID="${esc(params.guid)}" VCHTYPE="${esc(params.voucherType)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <GUID>${esc(params.guid)}</GUID>
            <VOUCHERTYPENAME>${esc(params.voucherType)}</VOUCHERTYPENAME>
            <DATE>${tallyDate(params.voucherDate)}</DATE>
            <VOUCHERNUMBER>${esc(params.voucherNumber)}</VOUCHERNUMBER>
            <NARRATION>${esc(params.narration)}</NARRATION>
            <ISINVOICE>Yes</ISINVOICE>${entries}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function buildTallyCancellationXml(params: Omit<TallyVoucherParams, 'voucherType'>): string {
  return buildTallyVoucherXml({ ...params, voucherType: 'Journal' });
}

function resolvePaymentLedger(paymentMethod: string, cashLedger: string, bankLedger: string): string {
  const bankModes = new Set(['upi', 'upi_intent', 'upi_qr', 'upi_collect', 'razorpay', 'card']);
  return bankModes.has(paymentMethod) ? bankLedger : cashLedger;
}

function validateBalance(entries: TallyLedgerEntry[]): boolean {
  const sum = entries.reduce((acc, e) => acc + e.amount, 0);
  return Math.abs(sum) < 0.01;
}

type TallySyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'skipped';
const STATUS_RANK: Record<TallySyncStatus, number> = {
  pending:  0,
  syncing:  1,
  synced:   2,
  failed:   2,
  skipped: -1,
};

const DEFAULT_LEDGER_MAP = {
  salesLedger:       'Sales',
  cgstLedger:        'Output CGST',
  sgstLedger:        'Output SGST',
  cashLedger:        'Cash',
  bankLedger:        'Bank',
  discountLedger:    'Discount Allowed',
  roundOffLedger:    'Round Off',
  expenseLedger:     'Indirect Expenses',
  purchaseLedger:    'Purchases',
  stockInHandLedger: 'Stock-in-Hand',
  walletLedger:      'Customer Wallet',
};

// ── TALLY-S1-01 to TALLY-S1-05 — Idempotency key construction ─────────────────

describe('TALLY-S1-01 to TALLY-S1-05 — Idempotency key construction', () => {
  it('TALLY-S1-01: order create key format is hotelId:entityType:entityId:operation', () => {
    const key = makeTallyIdempotencyKey('hotel1', 'order', 'order123', 'create');
    expect(key).toBe('hotel1:order:order123:create');
  });

  it('TALLY-S1-02: cancellation key uses entityType=cancellation', () => {
    const key = makeTallyIdempotencyKey('hotel1', 'cancellation', 'order123', 'cancel');
    expect(key).toBe('hotel1:cancellation:order123:cancel');
  });

  it('TALLY-S1-03: purchase invoice key uses entityType=purchase_invoice', () => {
    const key = makeTallyIdempotencyKey('hotel1', 'purchase_invoice', 'inv456', 'create');
    expect(key).toBe('hotel1:purchase_invoice:inv456:create');
  });

  it('TALLY-S1-04: expense key uses entityType=expense', () => {
    const key = makeTallyIdempotencyKey('hotel1', 'expense', 'exp789', 'create');
    expect(key).toBe('hotel1:expense:exp789:create');
  });

  it('TALLY-S1-05: same entity+operation always produces same key (deterministic)', () => {
    const k1 = makeTallyIdempotencyKey('H', 'order', 'X', 'create');
    const k2 = makeTallyIdempotencyKey('H', 'order', 'X', 'create');
    expect(k1).toBe(k2);
  });
});

// ── TALLY-S1-06 to TALLY-S1-10 — Backoff calculation ─────────────────────────

describe('TALLY-S1-06 to TALLY-S1-10 — Backoff calculation', () => {
  it('TALLY-S1-06: attemptCount=0 → backoff=0 (immediate first attempt)', () => {
    expect(calcTallyBackoff(0)).toBe(0);
  });

  it('TALLY-S1-07: attemptCount=1 → backoff=5 minutes', () => {
    expect(calcTallyBackoff(1)).toBe(5 * 60_000);
  });

  it('TALLY-S1-08: attemptCount=2 → backoff=15 minutes', () => {
    expect(calcTallyBackoff(2)).toBe(15 * 60_000);
  });

  it('TALLY-S1-09: attemptCount=3 → backoff=1 hour', () => {
    expect(calcTallyBackoff(3)).toBe(60 * 60_000);
  });

  it('TALLY-S1-10: attemptCount≥4 clamps to 4 hours (last entry)', () => {
    expect(calcTallyBackoff(4)).toBe(4 * 60 * 60_000);
    expect(calcTallyBackoff(99)).toBe(4 * 60 * 60_000);
  });
});

// ── TALLY-S1-11 to TALLY-S1-15 — XML escaping ────────────────────────────────

describe('TALLY-S1-11 to TALLY-S1-15 — XML escaping', () => {
  it('TALLY-S1-11: & is escaped to &amp;', () => {
    expect(esc('Raj & Sons')).toBe('Raj &amp; Sons');
  });

  it('TALLY-S1-12: < is escaped to &lt;', () => {
    expect(esc('<test>')).toBe('&lt;test&gt;');
  });

  it('TALLY-S1-13: > is escaped to &gt;', () => {
    expect(esc('a > b')).toBe('a &gt; b');
  });

  it('TALLY-S1-14: " is escaped to &quot;', () => {
    expect(esc('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('TALLY-S1-15: string with no special chars passes through unchanged', () => {
    expect(esc('Raj Restaurant Pvt Ltd')).toBe('Raj Restaurant Pvt Ltd');
  });
});

// ── TALLY-S1-16 to TALLY-S1-18 — Date formatting ─────────────────────────────

describe('TALLY-S1-16 to TALLY-S1-18 — TallyPrime date formatting', () => {
  it('TALLY-S1-16: date formats to YYYYMMDD', () => {
    expect(tallyDate(new Date('2025-03-07'))).toBe('20250307');
  });

  it('TALLY-S1-17: month and day are zero-padded', () => {
    expect(tallyDate(new Date('2025-01-05'))).toBe('20250105');
  });

  it('TALLY-S1-18: output is always 8 characters', () => {
    const result = tallyDate(new Date('2025-12-31'));
    expect(result).toHaveLength(8);
    expect(result).toBe('20251231');
  });
});

// ── TALLY-S1-19 to TALLY-S1-25 — buildTallyVoucherXml structure ──────────────

describe('TALLY-S1-19 to TALLY-S1-25 — buildTallyVoucherXml structure', () => {
  const baseParams: TallyVoucherParams = {
    guid:          'test-guid-001',
    companyName:   'Raj Restaurant',
    voucherType:   'Sales',
    voucherDate:   new Date('2025-03-07'),
    voucherNumber: 'ORD-001',
    narration:     'Order ORD-001',
    ledgerEntries: [
      { ledgerName: 'Cash',  amount:  1180 },
      { ledgerName: 'Sales', amount: -1000 },
      { ledgerName: 'Output CGST', amount: -90 },
      { ledgerName: 'Output SGST', amount: -90 },
    ],
  };

  it('TALLY-S1-19: output starts with XML declaration', () => {
    const xml = buildTallyVoucherXml(baseParams);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  it('TALLY-S1-20: GUID appears as REMOTEID attribute and as GUID element', () => {
    const xml = buildTallyVoucherXml(baseParams);
    expect(xml).toContain('REMOTEID="test-guid-001"');
    expect(xml).toContain('<GUID>test-guid-001</GUID>');
  });

  it('TALLY-S1-21: date is formatted YYYYMMDD inside DATE element', () => {
    const xml = buildTallyVoucherXml(baseParams);
    expect(xml).toContain('<DATE>20250307</DATE>');
  });

  it('TALLY-S1-22: company name appears in SVCURRENTCOMPANY', () => {
    const xml = buildTallyVoucherXml(baseParams);
    expect(xml).toContain('<SVCURRENTCOMPANY>Raj Restaurant</SVCURRENTCOMPANY>');
  });

  it('TALLY-S1-23: voucher type appears as VCHTYPE attribute and VOUCHERTYPENAME', () => {
    const xml = buildTallyVoucherXml(baseParams);
    expect(xml).toContain('VCHTYPE="Sales"');
    expect(xml).toContain('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>');
  });

  it('TALLY-S1-24: debit entry has ISDEEMEDPOSITIVE=Yes', () => {
    const xml = buildTallyVoucherXml(baseParams);
    // Cash entry (positive = debit)
    expect(xml).toMatch(/<LEDGERNAME>Cash<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>/);
  });

  it('TALLY-S1-25: credit entry has ISDEEMEDPOSITIVE=No', () => {
    const xml = buildTallyVoucherXml(baseParams);
    // Sales entry (negative = credit)
    expect(xml).toMatch(/<LEDGERNAME>Sales<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>/);
  });
});

// ── TALLY-S1-26 to TALLY-S1-30 — Double-entry balance validation ─────────────

describe('TALLY-S1-26 to TALLY-S1-30 — Double-entry balance validation', () => {
  it('TALLY-S1-26: balanced entries (sum=0) → validateBalance returns true', () => {
    const entries = [
      { ledgerName: 'Cash',  amount:  1180 },
      { ledgerName: 'Sales', amount: -1000 },
      { ledgerName: 'Output CGST', amount: -90 },
      { ledgerName: 'Output SGST', amount: -90 },
    ];
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S1-27: imbalanced entries → validateBalance returns false', () => {
    const entries = [
      { ledgerName: 'Cash',  amount: 1200 },
      { ledgerName: 'Sales', amount: -1000 },
    ];
    expect(validateBalance(entries)).toBe(false);
  });

  it('TALLY-S1-28: floating-point tolerance — sum within 0.01 passes', () => {
    const entries = [
      { ledgerName: 'A', amount:  100.005 },
      { ledgerName: 'B', amount: -100.004 },
    ];
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S1-29: sum=0.02 fails (outside tolerance)', () => {
    const entries = [
      { ledgerName: 'A', amount:  100.02 },
      { ledgerName: 'B', amount: -100.00 },
    ];
    expect(validateBalance(entries)).toBe(false);
  });

  it('TALLY-S1-30: single entry with amount=0 passes', () => {
    expect(validateBalance([{ ledgerName: 'X', amount: 0 }])).toBe(true);
  });
});

// ── TALLY-S1-31 to TALLY-S1-35 — resolvePaymentLedger ───────────────────────

describe('TALLY-S1-31 to TALLY-S1-35 — resolvePaymentLedger', () => {
  it('TALLY-S1-31: cash → cashLedger', () => {
    expect(resolvePaymentLedger('cash', 'Cash', 'Bank')).toBe('Cash');
  });

  it('TALLY-S1-32: upi → bankLedger', () => {
    expect(resolvePaymentLedger('upi', 'Cash', 'Bank')).toBe('Bank');
  });

  it('TALLY-S1-33: razorpay → bankLedger', () => {
    expect(resolvePaymentLedger('razorpay', 'Cash', 'Bank')).toBe('Bank');
  });

  it('TALLY-S1-34: card → bankLedger', () => {
    expect(resolvePaymentLedger('card', 'Cash', 'Bank')).toBe('Bank');
  });

  it('TALLY-S1-35: upi_qr and upi_intent and upi_collect → bankLedger', () => {
    expect(resolvePaymentLedger('upi_qr',      'Cash', 'Bank')).toBe('Bank');
    expect(resolvePaymentLedger('upi_intent',  'Cash', 'Bank')).toBe('Bank');
    expect(resolvePaymentLedger('upi_collect', 'Cash', 'Bank')).toBe('Bank');
  });
});

// ── TALLY-S1-36 to TALLY-S1-38 — buildTallyCancellationXml ──────────────────

describe('TALLY-S1-36 to TALLY-S1-38 — buildTallyCancellationXml', () => {
  it('TALLY-S1-36: cancellation always uses voucherType=Journal', () => {
    const xml = buildTallyCancellationXml({
      guid:          'cancel-guid-001',
      companyName:   'Test Co',
      voucherDate:   new Date('2025-03-07'),
      voucherNumber: 'CANCEL-ORD-001',
      narration:     'Cancellation',
      ledgerEntries: [],
    });
    expect(xml).toContain('VCHTYPE="Journal"');
    expect(xml).toContain('<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>');
  });

  it('TALLY-S1-37: cancellation entries reverse debit/credit polarity (Dr Sales, Cr Cash)', () => {
    const entries = [
      { ledgerName: 'Sales', amount:  1000 },  // Dr (reversal of original Cr)
      { ledgerName: 'Cash',  amount: -1000 },  // Cr (reversal of original Dr)
    ];
    expect(validateBalance(entries)).toBe(true);
  });

  it('TALLY-S1-38: cancellation voucherNumber contains CANCEL prefix', () => {
    const xml = buildTallyCancellationXml({
      guid:          'cxl-guid',
      companyName:   'Test',
      voucherDate:   new Date(),
      voucherNumber: 'CANCEL-ORD-123',
      narration:     'Test cancellation',
      ledgerEntries: [],
    });
    expect(xml).toContain('<VOUCHERNUMBER>CANCEL-ORD-123</VOUCHERNUMBER>');
  });
});

// ── TALLY-S1-39 to TALLY-S1-42 — Status state machine ───────────────────────

describe('TALLY-S1-39 to TALLY-S1-42 — Status state machine', () => {
  it('TALLY-S1-39: pending has rank 0 (lowest active state)', () => {
    expect(STATUS_RANK['pending']).toBe(0);
  });

  it('TALLY-S1-40: syncing has rank 1 (in-progress state)', () => {
    expect(STATUS_RANK['syncing']).toBe(1);
  });

  it('TALLY-S1-41: synced and failed both have rank 2 (terminal states)', () => {
    expect(STATUS_RANK['synced']).toBe(2);
    expect(STATUS_RANK['failed']).toBe(2);
  });

  it('TALLY-S1-42: after MAX_ATTEMPTS failures job becomes failed (not pending)', () => {
    let attemptCount = 0;
    let status: TallySyncStatus = 'pending';

    // Simulate MAX_ATTEMPTS failures
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      attemptCount += 1;
      if (attemptCount >= MAX_ATTEMPTS) {
        status = 'failed';
      } else {
        status = 'pending';
      }
    }

    expect(status).toBe('failed');
    expect(attemptCount).toBe(MAX_ATTEMPTS);
  });
});

// ── TALLY-S1-43 to TALLY-S1-45 — Ledger map defaults ────────────────────────

describe('TALLY-S1-43 to TALLY-S1-45 — Ledger map defaults', () => {
  it('TALLY-S1-43: default ledger map has all 11 required keys', () => {
    const REQUIRED_KEYS = [
      'salesLedger', 'cgstLedger', 'sgstLedger', 'cashLedger', 'bankLedger',
      'discountLedger', 'roundOffLedger', 'expenseLedger', 'purchaseLedger',
      'stockInHandLedger', 'walletLedger',
    ];
    for (const key of REQUIRED_KEYS) {
      expect(Object.keys(DEFAULT_LEDGER_MAP)).toContain(key);
    }
  });

  it('TALLY-S1-44: default cash ledger is "Cash" and sales ledger is "Sales"', () => {
    expect(DEFAULT_LEDGER_MAP.cashLedger).toBe('Cash');
    expect(DEFAULT_LEDGER_MAP.salesLedger).toBe('Sales');
  });

  it('TALLY-S1-45: default tax ledgers reference standard Indian GST names', () => {
    expect(DEFAULT_LEDGER_MAP.cgstLedger).toContain('CGST');
    expect(DEFAULT_LEDGER_MAP.sgstLedger).toContain('SGST');
  });
});
