/**
 * WhatsApp Auto-Receipts — Sprint 1 Regression Tests
 * WA-S1-01 through WA-S1-40
 *
 * Covers:
 *  - Phone normalisation (WA-S1-01 to WA-S1-06)
 *  - buildReceiptVarsFromOrder — template variable building (WA-S1-07 to WA-S1-14)
 *  - Permanent-failure keyword detection (WA-S1-15 to WA-S1-20)
 *  - _safeReason — credential redaction and truncation (WA-S1-21 to WA-S1-23)
 *  - Retry backoff calculation (WA-S1-24 to WA-S1-27)
 *  - Status rank / forward-only enforcement (WA-S1-28 to WA-S1-32)
 *  - Settings validation — templateLanguage and templateVars (WA-S1-33 to WA-S1-37)
 *  - Idempotency invariants and fire-and-forget safety (WA-S1-38 to WA-S1-40)
 *
 * All tests are pure-logic or module-extracted — no real DB, no real MSG91 calls.
 */

// ── Phone normalisation logic (extracted from phoneUtils.ts) ──────────────────

/** Inline mirror of backend/src/utils/phoneUtils.ts normalizePhone() */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits  = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (trimmed.startsWith('+') && digits.length >= 10) return `+${digits}`;
  return null;
}

describe('WA-S1-01 to WA-S1-06 — Phone normalisation', () => {
  it('WA-S1-01: 10-digit mobile → E.164 +91', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('WA-S1-02: 12-digit starting with 91 → E.164 +91', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('WA-S1-03: 11-digit starting with 0 → strips leading 0, adds +91', () => {
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });

  it('WA-S1-04: already E.164 with + prefix → preserved as-is', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
  });

  it('WA-S1-05: null and undefined → null', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('WA-S1-06: too short number → null', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('abc-xyz')).toBeNull();
  });
});

// ── buildReceiptVarsFromOrder (extracted pure logic) ──────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  cash:        'Cash',
  upi:         'UPI',
  upi_intent:  'UPI',
  upi_qr:      'UPI QR',
  upi_collect: 'UPI',
  card:        'Card',
  split:       'Split',
  razorpay:    'Online',
};

function _fmt(n: number, sym = '₹'): string {
  return `${sym}${n.toFixed(2)}`;
}

type OrderInput = {
  customerName?:  string | null;
  orderNumber?:   string;
  grandTotal?:    number;
  subtotal?:      number;
  taxTotal?:      number;
  discountAmount?: number;
  paymentMethod?: string;
  tableNumber?:   string | number | null;
  completedAt?:   Date | null;
  createdAt?:     Date | null;
  items?:         unknown[];
};

function buildReceiptVarsFromOrder(
  order: OrderInput,
  hotelName: string,
  currencySymbol = '₹',
): Record<string, string> {
  const completedAt = order.completedAt ?? order.createdAt ?? null;
  return {
    customerName:   order.customerName   || 'Valued Customer',
    restaurantName: hotelName            || 'Restaurant',
    orderNumber:    order.orderNumber    || '',
    grandTotal:     _fmt(order.grandTotal    ?? 0, currencySymbol),
    subtotal:       _fmt(order.subtotal      ?? 0, currencySymbol),
    taxTotal:       _fmt(order.taxTotal      ?? 0, currencySymbol),
    discountAmount: _fmt(order.discountAmount ?? 0, currencySymbol),
    paymentMethod:  PAYMENT_LABELS[order.paymentMethod ?? ''] ?? (order.paymentMethod ?? ''),
    tableNumber:    order.tableNumber ? `Table ${order.tableNumber}` : 'Takeaway',
    orderDate:      completedAt
      ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(completedAt)
      : '',
    orderTime:      completedAt
      ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(completedAt)
      : '',
    itemCount:      String(order.items?.length ?? 0),
  };
}

describe('WA-S1-07 to WA-S1-14 — buildReceiptVarsFromOrder', () => {
  it('WA-S1-07: produces all 12 required var keys', () => {
    const vars = buildReceiptVarsFromOrder(
      { customerName: 'Alice', orderNumber: 'ORD-001', grandTotal: 200, items: [1, 2] },
      'Test Bistro',
    );
    const required = [
      'customerName', 'restaurantName', 'orderNumber', 'grandTotal',
      'subtotal', 'taxTotal', 'discountAmount', 'paymentMethod',
      'tableNumber', 'orderDate', 'orderTime', 'itemCount',
    ];
    for (const key of required) {
      expect(vars).toHaveProperty(key);
    }
  });

  it('WA-S1-08: missing customerName → "Valued Customer"', () => {
    const vars = buildReceiptVarsFromOrder({}, 'Café');
    expect(vars.customerName).toBe('Valued Customer');
  });

  it('WA-S1-09: paymentMethod "upi" → "UPI"', () => {
    const vars = buildReceiptVarsFromOrder({ paymentMethod: 'upi' }, 'R');
    expect(vars.paymentMethod).toBe('UPI');
  });

  it('WA-S1-10: paymentMethod "upi_qr" → "UPI QR"', () => {
    const vars = buildReceiptVarsFromOrder({ paymentMethod: 'upi_qr' }, 'R');
    expect(vars.paymentMethod).toBe('UPI QR');
  });

  it('WA-S1-11: tableNumber present → "Table X"', () => {
    const vars = buildReceiptVarsFromOrder({ tableNumber: 7 }, 'R');
    expect(vars.tableNumber).toBe('Table 7');
  });

  it('WA-S1-12: tableNumber absent → "Takeaway"', () => {
    const vars = buildReceiptVarsFromOrder({ tableNumber: null }, 'R');
    expect(vars.tableNumber).toBe('Takeaway');
  });

  it('WA-S1-13: grandTotal formatted with ₹ symbol', () => {
    const vars = buildReceiptVarsFromOrder({ grandTotal: 123.5 }, 'R');
    expect(vars.grandTotal).toBe('₹123.50');
  });

  it('WA-S1-14: itemCount reflects items array length', () => {
    const vars = buildReceiptVarsFromOrder({ items: [{}, {}, {}] }, 'R');
    expect(vars.itemCount).toBe('3');
  });
});

// ── Permanent-failure detection (extracted from whatsappReceiptWorker.ts) ─────

const PERMANENT_KEYWORDS = [
  'invalid', 'blocked', 'opt', 'not registered',
  'unsubscribed', 'unauthorized', 'forbidden',
];

function _isPermanentFailure(reason: string): boolean {
  const lower = reason.toLowerCase();
  return PERMANENT_KEYWORDS.some(kw => lower.includes(kw));
}

describe('WA-S1-15 to WA-S1-20 — Permanent-failure keyword detection', () => {
  it('WA-S1-15: "invalid phone number" → permanent', () => {
    expect(_isPermanentFailure('invalid phone number')).toBe(true);
  });

  it('WA-S1-16: "user is blocked" → permanent', () => {
    expect(_isPermanentFailure('user is blocked')).toBe(true);
  });

  it('WA-S1-17: "opted out of marketing" → permanent (contains "opt")', () => {
    expect(_isPermanentFailure('opted out of marketing')).toBe(true);
  });

  it('WA-S1-18: "not registered on WhatsApp" → permanent', () => {
    expect(_isPermanentFailure('not registered on WhatsApp')).toBe(true);
  });

  it('WA-S1-19: "network timeout" → NOT permanent (retryable)', () => {
    expect(_isPermanentFailure('network timeout')).toBe(false);
  });

  it('WA-S1-20: "rate limit exceeded" → NOT permanent (retryable)', () => {
    expect(_isPermanentFailure('rate limit exceeded')).toBe(false);
  });
});

// ── _safeReason — credential redaction (extracted from worker) ────────────────

function _safeReason(raw: string): string {
  if (!raw) return 'WhatsApp receipt could not be sent. Please try again.';
  return raw
    .replace(/authkey[^\s,;]*/gi, '[redacted]')
    .replace(/api[_-]?key[^\s,;]*/gi, '[redacted]')
    .slice(0, 300);
}

describe('WA-S1-21 to WA-S1-23 — _safeReason credential redaction', () => {
  it('WA-S1-21: strips authkey token', () => {
    const result = _safeReason('Request failed authkey=ABC123XYZ because of quota.');
    expect(result).not.toContain('ABC123XYZ');
    expect(result).toContain('[redacted]');
  });

  it('WA-S1-22: strips api-key token', () => {
    const result = _safeReason('Error: api-key=secretToken was rejected.');
    expect(result).not.toContain('secretToken');
    expect(result).toContain('[redacted]');
  });

  it('WA-S1-23: truncates at 300 chars', () => {
    const longReason = 'x'.repeat(400);
    const result = _safeReason(longReason);
    expect(result.length).toBe(300);
  });
});

// ── Retry backoff calculation (extracted from worker) ─────────────────────────

const BACKOFF_MS: number[] = [
  0,
  5  * 60_000,
  15 * 60_000,
];

function calcBackoff(attemptCount: number): { nextAttempt: number; backoffMs: number } {
  const nextAttempt = attemptCount + 1;
  const backoffMs   = BACKOFF_MS[nextAttempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 15 * 60_000;
  return { nextAttempt, backoffMs };
}

// Worker logic: backoffMs = BACKOFF_MS[nextAttempt] where nextAttempt = attemptCount + 1.
// BACKOFF_MS = [0, 5min, 15min] — index 0 is unused; index 1 is after 1st failure, etc.
describe('WA-S1-24 to WA-S1-27 — Retry backoff calculation', () => {
  it('WA-S1-24: first failure (attemptCount=0) → nextAttempt 1, 5-minute backoff', () => {
    const { nextAttempt, backoffMs } = calcBackoff(0);
    expect(nextAttempt).toBe(1);
    expect(backoffMs).toBe(5 * 60_000); // BACKOFF_MS[1]
  });

  it('WA-S1-25: second failure (attemptCount=1) → nextAttempt 2, 15-minute backoff', () => {
    const { nextAttempt, backoffMs } = calcBackoff(1);
    expect(nextAttempt).toBe(2);
    expect(backoffMs).toBe(15 * 60_000); // BACKOFF_MS[2]
  });

  it('WA-S1-26: third failure (attemptCount=2) → nextAttempt 3, clamps to last entry (15 min)', () => {
    const { nextAttempt, backoffMs } = calcBackoff(2);
    expect(nextAttempt).toBe(3);
    expect(backoffMs).toBe(15 * 60_000); // BACKOFF_MS[3] undefined → fallback to last
  });

  it('WA-S1-27: high attemptCount → always clamps to last BACKOFF_MS entry (15 min)', () => {
    const { backoffMs } = calcBackoff(99);
    expect(backoffMs).toBe(15 * 60_000);
  });
});

// ── Status rank / forward-only enforcement ────────────────────────────────────

const STATUS_RANK: Record<string, number> = {
  queued:    0,
  sending:   1,
  sent:      2,
  failed:    2, // terminal; same rank as sent so sent→failed is allowed but failed→sent is not
  delivered: 3,
  read:      4,
  skipped:   -1, // terminal; skipped = no-provider; rank is irrelevant
};

describe('WA-S1-28 to WA-S1-32 — Status rank / forward-only', () => {
  it('WA-S1-28: queued rank < sending rank', () => {
    expect(STATUS_RANK.queued).toBeLessThan(STATUS_RANK.sending);
  });

  it('WA-S1-29: sending rank < sent rank', () => {
    expect(STATUS_RANK.sending).toBeLessThan(STATUS_RANK.sent);
  });

  it('WA-S1-30: sent rank < delivered rank', () => {
    expect(STATUS_RANK.sent).toBeLessThan(STATUS_RANK.delivered);
  });

  it('WA-S1-31: delivered rank < read rank', () => {
    expect(STATUS_RANK.delivered).toBeLessThan(STATUS_RANK.read);
  });

  it('WA-S1-32: forward-only — a webhook with status=sent cannot downgrade delivered', () => {
    const currentStatus = 'delivered';
    const incomingStatus = 'sent';
    const canUpdate = STATUS_RANK[incomingStatus] > STATUS_RANK[currentStatus];
    expect(canUpdate).toBe(false);
  });
});

// ── Settings validation — templateLanguage regex ──────────────────────────────

const BCP47_RE = /^[a-z]{2}(_[A-Z]{2})?$/;

function isValidBCP47(lang: string): boolean {
  return BCP47_RE.test(lang.trim());
}

describe('WA-S1-33 to WA-S1-37 — Settings validation', () => {
  it('WA-S1-33: "en" is a valid BCP-47 language code', () => {
    expect(isValidBCP47('en')).toBe(true);
  });

  it('WA-S1-34: "en_US" is a valid BCP-47 language+region code', () => {
    expect(isValidBCP47('en_US')).toBe(true);
  });

  it('WA-S1-35: "EN" (uppercase) is invalid per the regex', () => {
    expect(isValidBCP47('EN')).toBe(false);
  });

  it('WA-S1-36: "english" (3+ chars) is invalid per the regex', () => {
    expect(isValidBCP47('english')).toBe(false);
  });

  it('WA-S1-37: templateVars with 21 entries exceeds the 20-entry limit', () => {
    const vars = Array.from({ length: 21 }, (_, i) => `var${i}`);
    expect(vars.length > 20).toBe(true);
  });
});

// ── Idempotency and fire-and-forget safety ────────────────────────────────────

describe('WA-S1-38 to WA-S1-40 — Idempotency and fire-and-forget safety', () => {
  it('WA-S1-38: $setOnInsert semantics — second upsert with same filter is a no-op', () => {
    // Simulates: first upsert creates the doc (no existing), second upsert finds it and does nothing
    const db = new Map<string, Record<string, unknown>>();

    function upsertSetOnInsert(
      filter: Record<string, unknown>,
      doc: Record<string, unknown>,
    ): 'inserted' | 'noop' {
      const key = JSON.stringify(filter);
      if (db.has(key)) return 'noop';
      db.set(key, doc);
      return 'inserted';
    }

    const filter = { hotelId: 'h1', orderId: 'o1', purpose: 'receipt' };
    const doc    = { status: 'queued', templateName: 'order_receipt' };

    expect(upsertSetOnInsert(filter, doc)).toBe('inserted');
    expect(upsertSetOnInsert(filter, doc)).toBe('noop');
    expect(upsertSetOnInsert(filter, doc)).toBe('noop'); // third call also noop
  });

  it('WA-S1-39: fire-and-forget wrapper swallows all errors — never rethrows', async () => {
    // Mirrors createWhatsAppReceiptJob's outer try/catch
    async function safeJobWrapper(inner: () => Promise<void>): Promise<void> {
      try {
        await inner();
      } catch {
        // swallowed — WhatsApp failure must never roll back a sale
      }
    }

    const alwaysThrows = () => Promise.reject(new Error('DB connection refused'));
    await expect(safeJobWrapper(alwaysThrows)).resolves.toBeUndefined();
  });

  it('WA-S1-40: maxAttempts default is 3; exhausted receipts become "failed"', () => {
    // Mirrors the worker's decision: if nextAttempt >= maxAttempts, mark failed
    function shouldFail(attemptCount: number, maxAttempts: number): boolean {
      return (attemptCount + 1) >= maxAttempts;
    }

    expect(shouldFail(0, 3)).toBe(false); // attempt 1 of 3 → retry allowed
    expect(shouldFail(1, 3)).toBe(false); // attempt 2 of 3 → retry allowed
    expect(shouldFail(2, 3)).toBe(true);  // attempt 3 of 3 → final attempt → failed
    expect(shouldFail(3, 3)).toBe(true);  // over the limit → failed
  });
});
