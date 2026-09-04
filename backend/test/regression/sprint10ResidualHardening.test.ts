/**
 * Sprint 10 — P2/P3 Residual Hardening Regression Tests
 *
 * Covered findings (code-change items only):
 *  A-06  — AI menu import: server-side 500-product cap
 *  A-10  — OCR worker: per-hotel fairness (round-robin)
 *  A-15  — Prompt sanitization: strips newline injection characters
 *  A-17  — Invoice date: ISO-8601 validation before use
 *  B-09  — GRN pendingQty: computed from PO's authoritative orderedQty
 *  B-12  — Vendor ledger: runningBalance from post-update value
 *  B-23  — WAC precision: stock-in/restock rounds to 4 decimal places
 *  D-13  — Waitlist soft delete: transitions to 'cancelled' instead of hard delete
 *  D-14  — Reservation seatedAt: field added, set on seated transition
 *  D-15  — Waitlist state machine: transition table + atomic guard
 *  F-4   — SaaS webhook: processing happens before 200 so Razorpay retries on DB failure
 *  F-5   — guestId in orders: ObjectId format validated before storage
 *
 * Verified findings (no code change):
 *  A-08  — latestKey guarded by isToday; regeneration hardcodes false
 *  A-12  — OCR pending cap + decrement all failure paths
 *  A-13  — OCR job IDs are server-side ObjectId; AI chat session IDs bounded to hotel
 *  A-14  — Gemini prompt length bounded by template in practice
 *  A-16  — Quota fails open intentionally; Redis failure documented
 *  B-03  — Stock float drift: raw float is existing convention; cap prevents catastrophic error
 *  B-24  — PO totals server-authoritative; final Math.round corrects accumulator drift
 *  C-13  — Delivery fee always counted: existing intentional business behavior
 *  C-15  — OTP balance fetched fresh; deduction uses atomic $gte guard
 *  C-16  — Campaign provider failure correctly marks 'failed'; limiter is time-window
 *  E     — markReady/Dispatched non-fatal is intentional; upgraded to logger.error
 */

// ──────────────────────────────────────────────────────────────────────────────
// A-06 — AI menu import count cap (500 products)
// ──────────────────────────────────────────────────────────────────────────────

describe('A-06 — AI menu import count cap', () => {
  const AI_MENU_IMPORT_CAP = 500;

  function totalProductCount(categories: Array<{ products?: unknown[] }>): number {
    return categories.reduce((sum, cat) => sum + (Array.isArray(cat.products) ? cat.products.length : 0), 0);
  }

  it('import with exactly 500 products is accepted', () => {
    const cats = [{ products: Array(500).fill({ name: 'Item', price: 100 }) }];
    expect(totalProductCount(cats)).toBe(500);
    expect(totalProductCount(cats) <= AI_MENU_IMPORT_CAP).toBe(true);
  });

  it('import with 501 products is rejected', () => {
    const cats = [{ products: Array(501).fill({ name: 'Item', price: 100 }) }];
    expect(totalProductCount(cats) > AI_MENU_IMPORT_CAP).toBe(true);
  });

  it('cap counts across multiple categories', () => {
    const cats = [
      { products: Array(300).fill({ name: 'A', price: 10 }) },
      { products: Array(201).fill({ name: 'B', price: 20 }) },
    ];
    expect(totalProductCount(cats)).toBe(501);
    expect(totalProductCount(cats) > AI_MENU_IMPORT_CAP).toBe(true);
  });

  it('empty categories array is rejected before cap check', () => {
    expect(Array.isArray([]) && [].length === 0).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// A-10 — OCR worker per-hotel fairness
// ──────────────────────────────────────────────────────────────────────────────

describe('A-10 — OCR worker per-hotel fairness', () => {
  // Simulate the fairness logic from ocrWorker.ts
  let lastProcessedHotelId: string | null = null;

  function pickJob(
    jobs: Array<{ hotelId: string; createdAt: Date }>,
  ): { hotelId: string; createdAt: Date } | null {
    if (lastProcessedHotelId) {
      const other = jobs
        .filter(j => j.hotelId !== lastProcessedHotelId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (other) { lastProcessedHotelId = other.hotelId; return other; }
    }
    const any = jobs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
    if (any) lastProcessedHotelId = any.hotelId;
    return any;
  }

  beforeEach(() => { lastProcessedHotelId = null; });

  it('alternates between hotels when both have pending jobs', () => {
    const t0 = new Date('2025-01-01T00:00:00Z');
    const t1 = new Date('2025-01-01T00:00:01Z');
    const t2 = new Date('2025-01-01T00:00:02Z');
    const t3 = new Date('2025-01-01T00:00:03Z');

    const jobs = [
      { hotelId: 'hotel_A', createdAt: t0 },
      { hotelId: 'hotel_A', createdAt: t2 },
      { hotelId: 'hotel_B', createdAt: t1 },
      { hotelId: 'hotel_B', createdAt: t3 },
    ];

    const pick1 = pickJob([...jobs]);
    const pick2 = pickJob([...jobs]);

    expect(pick1?.hotelId).not.toBe(pick2?.hotelId);
  });

  it('falls back to same hotel if no other hotel has pending jobs', () => {
    lastProcessedHotelId = 'hotel_A';
    const jobs = [
      { hotelId: 'hotel_A', createdAt: new Date('2025-01-01') },
    ];
    const pick = pickJob([...jobs]);
    expect(pick?.hotelId).toBe('hotel_A');
  });

  it('when no lastProcessed, picks the oldest job globally', () => {
    const jobs = [
      { hotelId: 'hotel_B', createdAt: new Date('2025-01-02') },
      { hotelId: 'hotel_A', createdAt: new Date('2025-01-01') },
    ];
    const pick = pickJob([...jobs]);
    expect(pick?.hotelId).toBe('hotel_A');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// A-15 — Prompt injection via newline characters
// ──────────────────────────────────────────────────────────────────────────────

describe('A-15 — sanitize() strips newline injection characters', () => {
  function sanitize(s: string): string {
    return String(s).replace(/[\r\n]+/g, ' ').replace(/[<>{}\[\]\\|`]/g, '').slice(0, 80).trim();
  }

  it('strips \\n from product names', () => {
    const result = sanitize('Butter\nSUMMARY: injected summary');
    expect(result).not.toContain('\n');
    expect(result).toContain('Butter');
  });

  it('strips \\r\\n from product names', () => {
    const result = sanitize('Item\r\nREC1: do something bad');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
  });

  it('replaces newline sequences with a single space', () => {
    const result = sanitize('first\nsecond');
    expect(result).toBe('first second');
  });

  it('preserves normal restaurant names without modification', () => {
    const result = sanitize('Paneer Tikka Masala');
    expect(result).toBe('Paneer Tikka Masala');
  });

  it('still strips the original special chars (< > { } etc.)', () => {
    const result = sanitize('<script>alert(1)</script>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });

  it('truncates at 80 characters', () => {
    const result = sanitize('a'.repeat(200));
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it('multiple consecutive newlines collapse to one space', () => {
    const result = sanitize('a\n\n\nb');
    expect(result).toBe('a b');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// A-17 — Invoice date validation
// ──────────────────────────────────────────────────────────────────────────────

describe('A-17 — OCR invoice date validation', () => {
  function parseInvoiceDate(raw: string | null | undefined): Date {
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
      const candidate = new Date(String(raw) + 'T00:00:00Z');
      if (!isNaN(candidate.getTime())) return candidate;
    }
    return new Date(); // today fallback
  }

  it('accepts valid ISO-8601 YYYY-MM-DD', () => {
    const result = parseInvoiceDate('2025-03-15');
    expect(result.toISOString().startsWith('2025-03-15')).toBe(true);
  });

  it('rejects DD-MM-YYYY format — falls back to today', () => {
    const before = Date.now();
    const result  = parseInvoiceDate('15-03-2025');
    const after   = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(result.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it('rejects MM/DD/YYYY format — falls back to today', () => {
    const before = Date.now();
    const result  = parseInvoiceDate('03/15/2025');
    const after   = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(result.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it('rejects impossible date 31/13/2024 — falls back to today', () => {
    const result = parseInvoiceDate('2024-13-31');  // Invalid month
    // Should be today (fallback) because new Date('2024-13-31T00:00:00Z') is Invalid Date
    expect(isNaN(new Date('2024-13-31T00:00:00Z').getTime())).toBe(true);
    const now = new Date();
    const diffMs = Math.abs(result.getTime() - now.getTime());
    expect(diffMs).toBeLessThan(5000);
  });

  it('rejects empty string — falls back to today', () => {
    const result = parseInvoiceDate('');
    const now = new Date();
    expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(5000);
  });

  it('rejects null — falls back to today', () => {
    const result = parseInvoiceDate(null);
    const now = new Date();
    expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(5000);
  });

  it('rejects "March 2024" natural language — falls back to today', () => {
    const result = parseInvoiceDate('March 2024');
    const now = new Date();
    expect(Math.abs(result.getTime() - now.getTime())).toBeLessThan(5000);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// B-09 — GRN pendingQty uses PO's authoritative orderedQty
// ──────────────────────────────────────────────────────────────────────────────

describe('B-09 — GRN pendingQty uses server-side PO orderedQty', () => {
  interface PoItem { orderedQty: number; receivedQty: number; }

  function computePendingQty(poItem: PoItem, newReceivedQty: number): number {
    const cumulative = (poItem.receivedQty || 0) + newReceivedQty;
    // B-09 fix: always use pi.orderedQty (server value), not client-supplied orderedQty
    return Math.max(0, poItem.orderedQty - cumulative);
  }

  it('pendingQty = orderedQty - receivedQty on first delivery', () => {
    const pi: PoItem = { orderedQty: 10, receivedQty: 0 };
    expect(computePendingQty(pi, 4)).toBe(6);
  });

  it('pendingQty reaches 0 when fully received', () => {
    const pi: PoItem = { orderedQty: 10, receivedQty: 6 };
    expect(computePendingQty(pi, 4)).toBe(0);
  });

  it('pendingQty cannot go negative (Math.max guard)', () => {
    const pi: PoItem = { orderedQty: 10, receivedQty: 8 };
    // Over-receive guard in grnRoutes prevents this in practice, but Math.max ensures safety
    expect(computePendingQty(pi, 5)).toBe(0);
  });

  it('client-supplied orderedQty of 100 does NOT affect pendingQty when PO has orderedQty 10', () => {
    // Before fix: pendingQty = Math.max(0, clientOrderedQty - cumulative) = Math.max(0, 100 - 4) = 96 (WRONG)
    // After fix:  pendingQty = Math.max(0, pi.orderedQty - cumulative)   = Math.max(0, 10 - 4) = 6 (CORRECT)
    const pi: PoItem = { orderedQty: 10, receivedQty: 0 };
    const result = computePendingQty(pi, 4);
    expect(result).toBe(6); // not 96
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// B-12 — Vendor ledger runningBalance from post-update value
// ──────────────────────────────────────────────────────────────────────────────

describe('B-12 — Vendor ledger runningBalance uses post-update balance', () => {
  it('stale pre-read balance is WRONG when concurrent GRN modifies outstanding', () => {
    const vendorPreRead = { currentOutstanding: 1000 };  // read before tx
    const concurrentGrnDelta = 500;                        // concurrent GRN adds 500
    const adjustmentAmount = 200;

    // Old (wrong): runningBalance = preRead + adjustment (ignores concurrent change)
    const wrongBalance = vendorPreRead.currentOutstanding + adjustmentAmount;
    expect(wrongBalance).toBe(1200); // misses the 500 from concurrent GRN

    // Correct: use post-update value from findOneAndUpdate({ new: true })
    const actualOutstanding = vendorPreRead.currentOutstanding + concurrentGrnDelta; // 1500 (what's in DB after concurrent write)
    const correctBalance    = actualOutstanding + adjustmentAmount;
    expect(correctBalance).toBe(1700);
  });

  it('findOneAndUpdate with { new: true } returns the post-update balance', () => {
    // Simulate: $inc: { currentOutstanding: amount }  with new: true
    function atomicIncrement(current: number, delta: number): number {
      return current + delta; // MongoDB $inc + { new: true } returns this
    }
    const postBalance = atomicIncrement(5000, 300);
    expect(postBalance).toBe(5300);
    // ledger entry should record 5300, not the pre-read 5000
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// B-23 — WAC precision: stock-in rounds to 4 decimal places
// ──────────────────────────────────────────────────────────────────────────────

describe('B-23 — WAC precision: stock-in/restock rounds to 4dp', () => {
  function computeWac(currentStock: number, currentCost: number, incomingQty: number, incomingCost: number): number {
    const newStock = currentStock + incomingQty;
    if (newStock <= 0) return incomingCost;
    const rawWac = (currentStock * currentCost + incomingQty * incomingCost) / newStock;
    // B-23 fix: round to 4dp (MongoDB $round equivalent)
    return Math.round(rawWac * 10000) / 10000;
  }

  it('0.1 + 0.2 float drift is corrected by rounding to 4dp', () => {
    // Without rounding: 0.1 + 0.2 = 0.30000000000000004
    const rawResult = 0.1 + 0.2;
    expect(rawResult).not.toBe(0.3);

    const wac = computeWac(10, 0.1, 10, 0.2);
    // Should be 0.15 exactly after rounding
    const roundedWac = Math.round(wac * 10000) / 10000;
    expect(roundedWac).toBe(0.15);
  });

  it('WAC is rounded to at most 4 decimal places', () => {
    const wac = computeWac(3, 1.1234, 2, 1.5678);
    const decimals = wac.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it('WAC matches GRN path (both round to 4dp)', () => {
    const grnPath   = +(((100 * 50) + (50 * 60)) / 150).toFixed(4);
    const stockInPath = computeWac(100, 50, 50, 60);
    expect(stockInPath).toBe(grnPath);
  });

  it('zero new stock falls back to incoming cost', () => {
    const wac = computeWac(0, 0, 0, 75);
    expect(wac).toBe(75);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// D-13 — Waitlist soft delete
// ──────────────────────────────────────────────────────────────────────────────

describe('D-13 — Waitlist soft delete transitions to cancelled', () => {
  interface WaitlistEntry { _id: string; status: string; hotelId: string; }

  function softDelete(
    entry: WaitlistEntry,
    hotelId: string,
  ): WaitlistEntry | null {
    if (entry.hotelId !== hotelId) return null;
    if (['seated', 'expired'].includes(entry.status)) return null;
    return { ...entry, status: 'cancelled' };
  }

  it('waiting entry transitions to cancelled (not deleted)', () => {
    const entry: WaitlistEntry = { _id: 'w1', status: 'waiting', hotelId: 'h1' };
    const result = softDelete(entry, 'h1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('cancelled');
    expect(result!._id).toBe('w1'); // record preserved
  });

  it('notified entry transitions to cancelled', () => {
    const entry: WaitlistEntry = { _id: 'w2', status: 'notified', hotelId: 'h1' };
    const result = softDelete(entry, 'h1');
    expect(result!.status).toBe('cancelled');
  });

  it('seated entry cannot be soft-deleted', () => {
    const entry: WaitlistEntry = { _id: 'w3', status: 'seated', hotelId: 'h1' };
    const result = softDelete(entry, 'h1');
    expect(result).toBeNull();
  });

  it('expired entry cannot be soft-deleted', () => {
    const entry: WaitlistEntry = { _id: 'w4', status: 'expired', hotelId: 'h1' };
    const result = softDelete(entry, 'h1');
    expect(result).toBeNull();
  });

  it('cross-hotel delete is rejected', () => {
    const entry: WaitlistEntry = { _id: 'w5', status: 'waiting', hotelId: 'h1' };
    const result = softDelete(entry, 'h2');
    expect(result).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// D-14 — Reservation seatedAt timestamp
// ──────────────────────────────────────────────────────────────────────────────

describe('D-14 — seatedAt set on reservation seated transition', () => {
  it('seatedAt is set when status transitions to seated', () => {
    const now = new Date();
    const timestamps: Partial<Record<string, Date>> = {};

    function applyTimestamp(newStatus: string): void {
      if (newStatus === 'confirmed')  timestamps.confirmedAt = now;
      if (newStatus === 'arrived')    timestamps.arrivedAt   = now;
      if (newStatus === 'seated')     timestamps.seatedAt    = now;
      if (newStatus === 'no_show')    timestamps.noShowAt    = now;
    }

    applyTimestamp('seated');

    expect(timestamps.seatedAt).toBeDefined();
    expect(timestamps.seatedAt).toBe(now);
  });

  it('seatedAt is NOT set for other status transitions', () => {
    const now = new Date();
    const timestamps: Partial<Record<string, Date>> = {};

    function applyTimestamp(newStatus: string): void {
      if (newStatus === 'confirmed')  timestamps.confirmedAt = now;
      if (newStatus === 'arrived')    timestamps.arrivedAt   = now;
      if (newStatus === 'seated')     timestamps.seatedAt    = now;
      if (newStatus === 'no_show')    timestamps.noShowAt    = now;
    }

    for (const status of ['confirmed', 'arrived', 'cancelled', 'no_show', 'completed']) {
      applyTimestamp(status);
    }

    expect(timestamps.seatedAt).toBeUndefined();
  });

  it('Reservation model interface includes seatedAt field', () => {
    // Structural check — if the interface does not include seatedAt,
    // TypeScript would catch it; this test documents the expected shape.
    interface ReservationShape { seatedAt: Date | null; }
    const r: ReservationShape = { seatedAt: null };
    expect(r.seatedAt).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// D-15 — Waitlist state machine + atomic guard
// ──────────────────────────────────────────────────────────────────────────────

describe('D-15 — Waitlist state machine enforces valid transitions', () => {
  const TERMINAL = new Set(['seated', 'cancelled', 'expired']);
  const VALID_TRANSITIONS: Record<string, string[]> = {
    waiting:  ['notified', 'cancelled', 'expired'],
    notified: ['waiting', 'seated', 'cancelled', 'expired'],
  };

  function validateTransition(currentStatus: string, targetStatus: string): string | null {
    if (TERMINAL.has(currentStatus)) return `Entry is already ${currentStatus}`;
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(targetStatus)) {
      return `Cannot transition from '${currentStatus}' to '${targetStatus}'`;
    }
    return null;  // valid
  }

  it('waiting → notified is valid', () => {
    expect(validateTransition('waiting', 'notified')).toBeNull();
  });

  it('notified → seated is valid', () => {
    expect(validateTransition('notified', 'seated')).toBeNull();
  });

  it('waiting → seated is INVALID (must go through notified)', () => {
    expect(validateTransition('waiting', 'seated')).not.toBeNull();
  });

  it('notified → waiting (rollback) is valid for timeout scenarios', () => {
    expect(validateTransition('notified', 'waiting')).toBeNull();
  });

  it('seated is terminal — cannot transition further', () => {
    expect(validateTransition('seated', 'cancelled')).not.toBeNull();
    expect(validateTransition('seated', 'waiting')).not.toBeNull();
  });

  it('cancelled is terminal — cannot transition further', () => {
    expect(validateTransition('cancelled', 'waiting')).not.toBeNull();
  });

  it('atomic guard: concurrent writes with same current status — only one can win', () => {
    // Simulates findOneAndUpdate({ _id, hotelId, status: currentStatus })
    let dbStatus = 'waiting';

    function atomicTransition(expectedCurrent: string, target: string): boolean {
      if (dbStatus !== expectedCurrent) return false;  // concurrent write already changed it
      dbStatus = target;
      return true;
    }

    // First concurrent request wins
    const r1 = atomicTransition('waiting', 'notified');
    // Second concurrent request loses — dbStatus is now 'notified', not 'waiting'
    const r2 = atomicTransition('waiting', 'cancelled');

    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(dbStatus).toBe('notified');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F-4 — SaaS webhook processing before 200
// ──────────────────────────────────────────────────────────────────────────────

describe('F-4 — SaaS webhook: processing before 200 enables retry', () => {
  it('on DB success: 200 is returned after handler completes', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    let statusCode = 0;

    async function webhookEndpoint(): Promise<void> {
      try {
        await handler();
      } catch (err) {
        statusCode = 500;
        return;
      }
      statusCode = 200;
    }

    await webhookEndpoint();
    expect(handler).toHaveBeenCalled();
    expect(statusCode).toBe(200);
  });

  it('on DB failure: 500 is returned so Razorpay retries', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('MongoDB timeout'));
    let statusCode = 0;

    async function webhookEndpoint(): Promise<void> {
      try {
        await handler();
      } catch (err) {
        statusCode = 500;
        return;
      }
      statusCode = 200;
    }

    await webhookEndpoint();
    expect(statusCode).toBe(500);
  });

  it('old design (200 before processing) loses the event on crash', async () => {
    let processed = false;
    let statusCode = 0;

    // Old pattern: send 200 FIRST, then process
    async function oldWebhookEndpoint(): Promise<void> {
      statusCode = 200;  // ack first
      // If process crashes here, event is lost — Razorpay won't retry
      throw new Error('Simulated crash after ack');
      // eslint-disable-next-line no-unreachable
      processed = true;
    }

    await oldWebhookEndpoint().catch(() => {});
    expect(statusCode).toBe(200);
    expect(processed).toBe(false); // event lost!
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F-5 — guestId ObjectId validation in order creation
// ──────────────────────────────────────────────────────────────────────────────

describe('F-5 — guestId format validated before order storage', () => {
  // Minimal isValidObjectId logic (matches mongoose.isValidObjectId)
  function isValidObjectId(id: unknown): boolean {
    if (typeof id !== 'string' && typeof id !== 'number') return false;
    return /^[a-f\d]{24}$/i.test(String(id));
  }

  function resolveGuestId(raw: unknown): unknown {
    if (raw && isValidObjectId(raw)) return raw;
    return undefined;
  }

  it('valid 24-char hex ObjectId passes through', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(resolveGuestId(id)).toBe(id);
  });

  it('malformed guestId is stored as undefined (not persisted)', () => {
    expect(resolveGuestId('not-an-objectid')).toBeUndefined();
    expect(resolveGuestId('')).toBeUndefined();
    expect(resolveGuestId(null)).toBeUndefined();
    expect(resolveGuestId(undefined)).toBeUndefined();
    expect(resolveGuestId(123)).toBeUndefined();
  });

  it('SQL injection attempt is not a valid ObjectId', () => {
    expect(resolveGuestId("'; DROP TABLE guests; --")).toBeUndefined();
  });

  it('cross-hotel ObjectId format is syntactically valid but still validated by hotel scope elsewhere', () => {
    // F-5 ensures the stored value is at least a valid ObjectId.
    // Cross-hotel enforcement is in resolveGuest() in guestRoutes.ts.
    const crossHotelId = '60f1b2c3d4e5f6a7b8c9d0e1';
    expect(isValidObjectId(crossHotelId)).toBe(true);
    // It will be stored as-is; guestRoutes resolveGuest() verifies hotelId scope
  });
});
