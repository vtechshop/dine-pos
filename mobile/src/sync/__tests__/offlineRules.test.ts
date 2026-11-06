import {
  classifyError, assertOfflineQueueable, OfflineNotAllowedError,
  submitCashierBill, CashierSubmitDeps, QueuedBill,
} from '../offlineRules';

const httpErr = (status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { status, ...extra });

describe('classifyError', () => {
  test.each([
    [httpErr(401), 'auth'],
    [Object.assign(new Error('Session expired'), { code: 'SESSION_EXPIRED' }), 'auth'],
    [httpErr(403, { code: 'TRIAL_EXPIRED' }), 'auth'],
    [httpErr(422), 'permanent'],
    [httpErr(409), 'permanent'],
    [httpErr(429), 'retryable'],
    [httpErr(503), 'retryable'],
    [new Error('Request timed out. Check your connection.'), 'retryable'],
    [new Error('Server unreachable. Check Wi-Fi and server.'), 'retryable'],
    [new TypeError('Network request failed'), 'retryable'],
  ])('%s → %s', (err, kind) => {
    expect(classifyError(err).kind).toBe(kind);
  });
});

describe('assertOfflineQueueable (wallet must never be queued offline)', () => {
  test('cash / card bills are allowed', () => {
    expect(() => assertOfflineQueueable({ paymentMethod: 'cash', discountAmount: 20 })).not.toThrow();
    expect(() => assertOfflineQueueable({ paymentMethod: 'card' })).not.toThrow();
  });
  test.each([
    [{ walletCustomerId: 'c1', walletAmount: 150 }],
    [{ useWallet: true }],
    [{ redeemedPoints: 100 }],
    [{ paymentMethod: 'razorpay' }],
  ])('%j is refused', payload => {
    expect(() => assertOfflineQueueable(payload)).toThrow(OfflineNotAllowedError);
  });
});

describe('submitCashierBill', () => {
  const bill = (over: Partial<QueuedBill> = {}): QueuedBill => ({
    offlineId: 'cashier_1_x', payload: { paymentMethod: 'cash', items: [] },
    afterCreate: { markServed: true, complete: true }, ...over,
  });
  function deps(over: Partial<CashierSubmitDeps> = {}) {
    const calls: string[] = [];
    const d: CashierSubmitDeps = {
      createOrder: jest.fn(async (p: any) => { calls.push(`create:${p.offlineId}`); return { _id: 'srv1', status: 'pending', orderNumber: 'ORD-1' }; }),
      markServed:  jest.fn(async () => { calls.push('served'); }),
      complete:    jest.fn(async (_id: string, pm: string) => { calls.push(`complete:${pm}`); }),
      ...over,
    };
    return { d, calls };
  }

  test('synced only after create + served + completed all succeed', async () => {
    const { d, calls } = deps();
    const out = await submitCashierBill(bill(), d);
    expect(out).toEqual({ kind: 'synced', serverId: 'srv1', orderNumber: 'ORD-1' });
    expect(calls).toEqual(['create:cashier_1_x', 'served', 'complete:cash']);
  });

  test('completion fails → NOT synced, server id kept, retryable', async () => {
    const { d } = deps({ complete: jest.fn(async () => { throw httpErr(503); }) });
    const out = await submitCashierBill(bill(), d);
    expect(out.kind).toBe('retryable');
    expect(out.serverId).toBe('srv1');
    expect((out as any).reason).toMatch(/Saved on server but not closed/);
  });

  test('completion 401 → auth (no logout, not synced)', async () => {
    const { d } = deps({ complete: jest.fn(async () => { throw httpErr(401); }) });
    const out = await submitCashierBill(bill(), d);
    expect(out.kind).toBe('auth');
    expect(out.serverId).toBe('srv1');
  });

  test('retry after an earlier partial success skips steps already done on the server', async () => {
    const { d, calls } = deps({
      createOrder: jest.fn(async () => ({ _id: 'srv1', status: 'completed', orderNumber: 'ORD-1' })),
    });
    const out = await submitCashierBill(bill({ serverId: 'srv1' }), d);
    expect(out.kind).toBe('synced');
    expect(calls).toEqual([]); // no second served/complete
  });

  test('every retry sends the SAME offlineId (server returns the existing order)', async () => {
    const seen: string[] = [];
    let n = 0;
    const { d } = deps({
      createOrder: jest.fn(async (p: any) => {
        seen.push(p.offlineId);
        if (++n === 1) throw new Error('Request timed out. Check your connection.');
        return { _id: 'srv1', status: 'pending' };
      }),
    });
    expect((await submitCashierBill(bill(), d)).kind).toBe('retryable');
    expect((await submitCashierBill(bill(), d)).kind).toBe('synced');
    expect(seen).toEqual(['cashier_1_x', 'cashier_1_x']);
  });

  test('server refusal on create → permanent', async () => {
    const { d } = deps({ createOrder: jest.fn(async () => { throw httpErr(422, { message: 'Each item must reference a valid product' }); }) });
    const out = await submitCashierBill(bill(), d);
    expect(out.kind).toBe('permanent');
    expect(out.serverId).toBeNull();
  });
});
