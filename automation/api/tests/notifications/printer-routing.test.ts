/**
 * Printer Routing — Single vs Dual mode (PRN)
 *
 * Verifies that print jobs are dispatched to the correct target based on
 * printerMode setting, and that KOT is suppressed in single-printer mode.
 *
 * Single-printer mode (small cafes, tea shops):
 *   - KOT: NOT created — no print job of type 'kot' is dispatched
 *   - Receipt/Bill: targets 'cashier' printer (auto)
 *
 * Dual-printer mode:
 *   - KOT: targets 'kitchen' printer
 *   - Receipt/Bill: targets 'cashier' printer
 *
 * PRN-001: SINGLE + order placed → NO KOT job created
 * PRN-002: SINGLE + order completed → cashier receipt job (auto print)
 * PRN-003: DUAL   + order placed → kitchen KOT job
 * PRN-004: DUAL   + order completed → cashier receipt job
 * PRN-005: Offline: receipt job stays 'pending' when no device registered
 */

import { api } from '../../../utils/api-client';
import { authHeaders } from '../../../utils/env';
import { getHotelA } from '../../setup/testEnv';
import { createOrder } from '../../helpers/order.helper';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Printer Routing — Single vs Dual mode', () => {
  let adminToken:   string;
  let kitchenToken: string;
  let waiterToken:  string;
  let cashierToken: string;

  // Track printerMode so afterAll can restore it
  let originalMode: string | null = null;

  beforeAll(async () => {
    const hotelA = getHotelA();
    adminToken   = hotelA.adminToken;
    kitchenToken = hotelA.kitchenToken;
    waiterToken  = hotelA.waiterToken;
    cashierToken = hotelA.cashierToken;

    // Capture current settings so we can restore after the suite
    const settingsRes = await api.get('/api/settings').set(authHeaders(adminToken));
    if (settingsRes.status === 200) {
      originalMode = (settingsRes.body.printerMode as string) ?? 'single';
    }
  });

  afterAll(async () => {
    // Restore original mode so other test suites see the baseline
    if (originalMode) {
      await api.put('/api/settings').set(authHeaders(adminToken)).send({ printerMode: originalMode });
    }
  });

  async function setMode(mode: 'single' | 'dual'): Promise<void> {
    const res = await api.put('/api/settings').set(authHeaders(adminToken)).send({ printerMode: mode });
    expect([200, 201]).toContain(res.status);
  }

  async function getJobsSince(
    jobType: 'kot' | 'receipt',
    since: number,
  ): Promise<any[]> {
    const res = await api
      .get(`/api/print-jobs?jobType=${jobType}`)
      .set(authHeaders(adminToken));
    expect(res.status).toBe(200);
    const jobs: any[] = res.body.jobs ?? [];
    return jobs.filter(j => new Date(j.createdAt).getTime() >= since);
  }

  // ── PRN-001 ────────────────────────────────────────────────────────────────
  // Single mode: no KOT job must be created after order placement.
  it('PRN-001 single mode: order placed → NO KOT print job created', async () => {
    await setMode('single');
    const since = Date.now();

    await createOrder(adminToken, { tableNumber: 'PRN1' });
    await sleep(600); // allow fire-and-forget to settle

    const kotJobs = await getJobsSince('kot', since);
    expect(kotJobs.length).toBe(0);
  }, 15_000);

  // ── PRN-002 ────────────────────────────────────────────────────────────────
  // Single mode: completing an order must produce exactly one 'cashier' receipt job.
  it('PRN-002 single mode: order completed → cashier receipt job (auto)', async () => {
    await setMode('single');

    const { orderId } = await createOrder(adminToken, { tableNumber: 'PRN2' });
    const since = Date.now();

    await createCompletedOrder_fromId(orderId);
    await sleep(600);

    const receiptJobs = await getJobsSince('receipt', since);
    expect(receiptJobs.length).toBeGreaterThanOrEqual(1);
    receiptJobs.forEach(j => expect(j.printerTarget).toBe('cashier'));
  }, 20_000);

  // ── PRN-003 ────────────────────────────────────────────────────────────────
  // Dual mode: order placement must create a 'kitchen' KOT job.
  it('PRN-003 dual mode: order placed → kitchen KOT print job', async () => {
    await setMode('dual');
    const since = Date.now();

    await createOrder(adminToken, { tableNumber: 'PRN3' });
    await sleep(600);

    const kotJobs = await getJobsSince('kot', since);
    expect(kotJobs.length).toBeGreaterThanOrEqual(1);
    kotJobs.forEach(j => expect(j.printerTarget).toBe('kitchen'));
  }, 15_000);

  // ── PRN-004 ────────────────────────────────────────────────────────────────
  // Dual mode: completing an order must produce a 'cashier' receipt job.
  it('PRN-004 dual mode: order completed → cashier receipt job', async () => {
    await setMode('dual');

    const { orderId } = await createOrder(adminToken, { tableNumber: 'PRN4' });
    const since = Date.now();

    await createCompletedOrder_fromId(orderId);
    await sleep(600);

    const receiptJobs = await getJobsSince('receipt', since);
    expect(receiptJobs.length).toBeGreaterThanOrEqual(1);
    receiptJobs.forEach(j => expect(j.printerTarget).toBe('cashier'));
  }, 20_000);

  // ── PRN-005 ────────────────────────────────────────────────────────────────
  // Queue behavior unchanged: receipt job stays 'pending' when no printer device
  // is registered (no socket-connected device in the test environment).
  it('PRN-005 offline printer: receipt job stays pending when no device registered', async () => {
    await setMode('single');

    const { orderId } = await createOrder(adminToken, { tableNumber: 'PRN5' });
    const since = Date.now();

    await createCompletedOrder_fromId(orderId);
    await sleep(600);

    const receiptJobs = await getJobsSince('receipt', since);
    expect(receiptJobs.length).toBeGreaterThanOrEqual(1);
    // No PrinterDevice registered in test env — dispatchPrintJob queues as 'pending'
    receiptJobs.forEach(j => expect(j.status).toBe('pending'));
  }, 20_000);

  // ── Helper: walk an existing order through the full state machine ──────────
  async function createCompletedOrder_fromId(orderId: string): Promise<void> {
    const steps: [string, string][] = [
      [kitchenToken, 'preparing'],
      [kitchenToken, 'ready'],
      [waiterToken,  'served'],
      [cashierToken, 'completed'],
    ];
    for (const [token, status] of steps) {
      const res = await api
        .patch(`/api/orders/${orderId}/status`)
        .set(authHeaders(token))
        .send({ status });
      // Some steps may return 200 or 204; throw only on server errors
      if (res.status >= 500) {
        throw new Error(`Order status update to '${status}' failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
  }
});
