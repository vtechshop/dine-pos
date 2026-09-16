import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach, vi } from 'vitest';
// Source files read as text, for the structural checks on payment, printing and pricing rules.
import newOrderPanelSource from '../../components/cashier/NewOrderPanel.tsx?raw';
import qrMenuSource from '../../../../qr/src/pages/MenuPage.tsx?raw';
import printUtilsSource from '../../../../backend/src/utils/printUtils.ts?raw';
import orderRoutesSource from '../../../../backend/src/routes/orderRoutes.ts?raw';
import syncEngineSource from '../syncEngine.ts?raw';
import offlineQueueSource from '../../utils/offlineQueue.ts?raw';
import useConnectivitySource from '../../hooks/useConnectivity.ts?raw';
import offlineBannerSource from '../../components/cashier/OfflineBanner.tsx?raw';
import { getDb, resetDbForTesting } from '../../db/offlineDb';
import { ApiError } from '../../api/client';
import type { CashierOrderItem, CreateOrderPayload } from '../../api/orders';
import {
  LEGACY_QUEUE_KEY_PREFIX,
  claimForSync,
  enqueueOrder,
  getAllOrders,
  getFailedCount,
  getPendingCount,
  getQueue,
  getQueueSummary,
  markFailed,
  markRetry,
  markSynced,
  migrateLegacyQueue,
  newOfflineId,
  nextWakeAt,
  OfflineQueueError,
  pruneSynced,
  recoverStaleSyncing,
  requeueFailed,
} from '../../utils/offlineQueue';
import {
  backoffDelayMs,
  classifySyncError,
  configureSyncEngine,
  resetSyncEngineForTesting,
  startAutoSync,
  syncNow,
} from '../syncEngine';
import {
  checkBackendHealth,
  deriveConnectivityStatus,
  HEALTH_CHECK_TIMEOUT_MS,
} from '../../hooks/useConnectivity';
import {
  cacheCategories,
  cacheProducts,
  getLocalProducts,
} from '../../db/productCache';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const HOTEL_A = 'hotel-a';
const HOTEL_B = 'hotel-b';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let clock = 1_750_000_000_000;

function orderPayload(overrides: Partial<CreateOrderPayload> & Record<string, unknown> = {}): CreateOrderPayload {
  return {
    items: [{ product: 'p1', productName: 'Masala Dosa', quantity: 2, price: 80, taxPercent: 5 }],
    orderSource: 'takeaway',
    customerName: 'Ravi',
    customerPhone: '9876543210',
    paymentMethod: 'cash',
    ...overrides,
  } as CreateOrderPayload;
}

/** A stand-in for the backend's idempotent POST /orders: one order per (hotel, offlineId). */
class FakeServer {
  orders = new Map<string, CashierOrderItem>();
  calls: CreateOrderPayload[] = [];
  failures: unknown[] = [];
  loseNextResponse = false;

  createOrder = vi.fn(async (payload: CreateOrderPayload): Promise<CashierOrderItem> => {
    this.calls.push(payload);
    if (this.failures.length) throw this.failures.shift();
    const key = payload.offlineId!;
    const existing = this.orders.get(key);
    if (existing) return existing; // the backend's 200 for a repeated offlineId
    const order: CashierOrderItem = {
      _id: `srv-${this.orders.size + 1}`,
      orderNumber: `ORD-${this.orders.size + 1}`,
      tableNumber: payload.tableNumber ?? '',
      grandTotal: 168, subtotal: 160, taxTotal: 8,
      status: 'pending',
      orderSource: payload.orderSource,
      isParcel: payload.orderSource !== 'dine-in',
      items: [],
      createdAt: new Date(clock).toISOString(),
    };
    this.orders.set(key, order);
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new TypeError('Failed to fetch'); // saved on the server, response lost on the way back
    }
    return order;
  });

  updateOrderStatus = vi.fn(async (id: string, status: string) => {
    for (const order of this.orders.values()) if (order._id === id) order.status = status;
  });

  completeOrder = vi.fn(async (id: string) => {
    for (const order of this.orders.values()) if (order._id === id) order.status = 'completed';
  });
}

function useServer(server: FakeServer, currentHotel: string | null = HOTEL_A, locks: Parameters<typeof configureSyncEngine>[0]['locks'] = null) {
  configureSyncEngine({
    createOrder: server.createOrder,
    updateOrderStatus: server.updateOrderStatus,
    completeOrder: server.completeOrder,
    now: () => clock,
    currentHotelId: () => currentHotel,
    locks,
  });
}

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return Array.from(this.data.keys())[index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

const SOURCES: Record<string, string> = {
  'web/src/components/cashier/NewOrderPanel.tsx': newOrderPanelSource,
  'qr/src/pages/MenuPage.tsx': qrMenuSource,
  'backend/src/utils/printUtils.ts': printUtilsSource,
  'backend/src/routes/orderRoutes.ts': orderRoutesSource,
  'web/src/sync/syncEngine.ts': syncEngineSource,
  'web/src/utils/offlineQueue.ts': offlineQueueSource,
  'web/src/hooks/useConnectivity.ts': useConnectivitySource,
  'web/src/components/cashier/OfflineBanner.tsx': offlineBannerSource,
};
const repoFile = (relative: string): string => {
  const text = SOURCES[relative];
  if (!text || text.length < 200) throw new Error(`source not readable: ${relative}`);
  return text;
};

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetDbForTesting();
  resetSyncEngineForTesting();
  clock = 1_750_000_000_000;
});

// ── OFF-S2-01 ────────────────────────────────────────────────────────────────
describe('OFF-S2-01 enqueue order into IndexedDB', () => {
  it('writes a queued, hotel-scoped record with every tracking field', async () => {
    const record = await enqueueOrder(HOTEL_A, orderPayload(), { now: clock });
    const db = await getDb();
    const stored = await db.get('pendingOrders', record.offlineId);
    expect(stored).toMatchObject({
      hotelId: HOTEL_A,
      syncStatus: 'queued',
      retryCount: 0,
      lastAttemptAt: null,
      errorReason: null,
      serverId: null,
      syncedAt: null,
      afterCreate: { markServed: true, complete: true },
    });
    expect(stored?.queuedAt).toBe(new Date(clock).toISOString());
  });
});

// ── OFF-S2-02 ────────────────────────────────────────────────────────────────
describe('OFF-S2-02 offlineId generated and preserved', () => {
  it('generates a v4 UUID, stores it on the payload, and honours an id the online attempt already sent', async () => {
    const generated = await enqueueOrder(HOTEL_A, orderPayload());
    expect(generated.offlineId).toMatch(UUID_V4);
    expect(generated.payload.offlineId).toBe(generated.offlineId);

    const reused = await enqueueOrder(HOTEL_A, orderPayload(), { offlineId: 'abc-12345-online-attempt' });
    expect(reused.offlineId).toBe('abc-12345-online-attempt');
  });

  it('keeps one record when the same bill is enqueued twice, and refuses a queue with no hotel', async () => {
    await enqueueOrder(HOTEL_A, orderPayload(), { offlineId: 'double-click-0001' });
    await enqueueOrder(HOTEL_A, orderPayload(), { offlineId: 'double-click-0001' });
    expect(await getQueue(HOTEL_A)).toHaveLength(1);
    await expect(enqueueOrder('', orderPayload())).rejects.toThrow(/Sign in/);
  });
});

// ── OFF-S2-03 ────────────────────────────────────────────────────────────────
describe('OFF-S2-03 hotel isolation', () => {
  it('Hotel B sees and syncs none of Hotel A\'s queued bills', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    // logout of A, login as B
    const server = new FakeServer();
    useServer(server, HOTEL_B);

    expect(await getQueue(HOTEL_B)).toHaveLength(0);
    expect((await getQueueSummary(HOTEL_B)).pending).toBe(0);

    const asB = await syncNow(HOTEL_B);
    expect(asB.attempted).toBe(0);

    // A sync for A while B is signed in stops before sending anything.
    const wrongHotel = await syncNow(HOTEL_A);
    expect(wrongHotel.stopReason).toBe('hotel_changed');
    expect(server.createOrder).not.toHaveBeenCalled();
    expect((await getQueue(HOTEL_A))[0].syncStatus).toBe('queued');
  });

  it('a logged-out session syncs nothing', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    useServer(server, null);
    expect((await syncNow(HOTEL_A)).stopReason).toBe('hotel_changed');
    expect(server.createOrder).not.toHaveBeenCalled();
  });
});

// ── OFF-S2-04 ────────────────────────────────────────────────────────────────
describe('OFF-S2-04 queue survives reload', () => {
  it('a page reload keeps the queued bill', async () => {
    const record = await enqueueOrder(HOTEL_A, orderPayload());
    resetDbForTesting(); // the page is gone; IndexedDB is not
    const after = await getQueue(HOTEL_A);
    expect(after.map(r => r.offlineId)).toEqual([record.offlineId]);
  });
});

// ── OFF-S2-05 ────────────────────────────────────────────────────────────────
describe('OFF-S2-05 FIFO ordering', () => {
  it('sends the oldest bill first', async () => {
    const first = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'First' }), { now: clock });
    const second = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Second' }), { now: clock });
    const third = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Third' }), { now: clock + 5 });
    const server = new FakeServer();
    useServer(server);

    await syncNow(HOTEL_A);
    expect(server.calls.map(c => c.offlineId)).toEqual([first.offlineId, second.offlineId, third.offlineId]);
  });
});

// ── OFF-S2-06 ────────────────────────────────────────────────────────────────
describe('OFF-S2-06 single active sync lock', () => {
  it('sync(), sync() and Sync Now at once share ONE running loop', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slowCreate = server.createOrder.getMockImplementation()!;
    server.createOrder.mockImplementation(async payload => { await gate; return slowCreate(payload); });
    useServer(server);

    const first = syncNow(HOTEL_A);
    const second = syncNow(HOTEL_A);
    const manual = syncNow(HOTEL_A, { manual: true });
    expect(second).toBe(first);
    expect(manual).toBe(first);

    await vi.waitFor(() => expect(server.createOrder).toHaveBeenCalledTimes(1));
    release();
    await first;
    expect(server.createOrder).toHaveBeenCalledTimes(1);
  });
});

// ── OFF-S2-07 / 08 ───────────────────────────────────────────────────────────
describe('OFF-S2-07 successful sync marks synced', () => {
  it('marks the bill synced only after the server confirms, and closes a takeaway as online would', async () => {
    const record = await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    useServer(server);

    const result = await syncNow(HOTEL_A);
    expect(result).toMatchObject({ synced: 1, failed: 0, stopReason: 'done' });

    const [stored] = await getAllOrders(HOTEL_A);
    expect(stored.syncStatus).toBe('synced');
    expect(stored.syncedAt).toBe(new Date(clock).toISOString());
    expect(await getPendingCount(HOTEL_A)).toBe(0);
    expect(server.updateOrderStatus).toHaveBeenCalledWith('srv-1', 'served');
    expect(server.completeOrder).toHaveBeenCalledWith('srv-1');
    expect(server.orders.get(record.offlineId)?.status).toBe('completed');
  });

  it('leaves a dine-in order open for its table', async () => {
    await enqueueOrder(HOTEL_A, orderPayload({ orderSource: 'dine-in', tableNumber: '4' }));
    const server = new FakeServer();
    useServer(server);
    await syncNow(HOTEL_A);
    expect(server.completeOrder).not.toHaveBeenCalled();
    expect(server.updateOrderStatus).not.toHaveBeenCalled();
  });
});

describe('OFF-S2-08 serverId saved', () => {
  it('records the server order id and number', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    useServer(server);
    await syncNow(HOTEL_A);
    const [stored] = await getAllOrders(HOTEL_A);
    expect(stored.serverId).toBe('srv-1');
    expect(stored.serverOrderNumber).toBe('ORD-1');
  });
});

// ── OFF-S2-09 / 10 ───────────────────────────────────────────────────────────
describe('OFF-S2-09 network failure retries', () => {
  it('a network failure puts the bill back in the queue, never into sync_failed', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new TypeError('Failed to fetch'));
    useServer(server);

    const result = await syncNow(HOTEL_A);
    expect(result.stopReason).toBe('retry_later');
    const [stored] = await getQueue(HOTEL_A);
    expect(stored).toMatchObject({ syncStatus: 'queued', retryCount: 1, errorCode: 'network', nextAttemptAt: clock + 5_000 });
    expect(stored.errorReason).toMatch(/Will retry/);
  });

  it('timeouts and 5xx are retryable too', async () => {
    for (const failure of [Object.assign(new Error('aborted'), { name: 'AbortError' }), new ApiError(503, 'Service Unavailable')]) {
      (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
      resetDbForTesting();
      await enqueueOrder(HOTEL_A, orderPayload());
      const server = new FakeServer();
      server.failures.push(failure);
      useServer(server);
      await syncNow(HOTEL_A);
      expect((await getQueue(HOTEL_A))[0].syncStatus).toBe('queued');
    }
  });
});

describe('OFF-S2-10 exponential backoff', () => {
  it('5s → 15s → 45s → 2m → 5m, capped at 5 minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(backoffDelayMs)).toEqual([5_000, 15_000, 45_000, 120_000, 300_000, 300_000, 300_000]);
  });

  it('waits out the delay between automatic attempts', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    for (let i = 0; i < 6; i += 1) server.failures.push(new TypeError('Failed to fetch'));
    useServer(server);

    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await syncNow(HOTEL_A);
      const [stored] = await getQueue(HOTEL_A);
      delays.push(stored.nextAttemptAt! - clock);

      // An automatic run before the delay expires sends nothing.
      const calls = server.createOrder.mock.calls.length;
      clock += 1_000;
      expect((await syncNow(HOTEL_A)).stopReason).toBe('waiting_backoff');
      expect(server.createOrder.mock.calls.length).toBe(calls);
      clock = stored.nextAttemptAt!;
    }
    expect(delays).toEqual([5_000, 15_000, 45_000, 120_000, 300_000, 300_000]);
  });
});

// ── OFF-S2-11 / 12 ───────────────────────────────────────────────────────────
describe('OFF-S2-11 validation error becomes sync_failed', () => {
  it('a 400 is kept as sync_failed with the reason and is not resubmitted automatically', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new ApiError(400, 'Customer phone is required'));
    useServer(server);

    expect((await syncNow(HOTEL_A)).failed).toBe(1);
    const [stored] = await getAllOrders(HOTEL_A);
    expect(stored).toMatchObject({ syncStatus: 'sync_failed', errorReason: 'Customer phone is required' });

    clock += 3_600_000;
    await syncNow(HOTEL_A);
    expect(server.createOrder).toHaveBeenCalledTimes(1);
  });

  it('never shows a database detail to the cashier', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new ApiError(400, 'E11000 duplicate key error collection: orders index: x'));
    useServer(server);
    await syncNow(HOTEL_A);
    expect((await getAllOrders(HOTEL_A))[0].errorReason).toBe('The server refused this bill.');
  });
});

describe('OFF-S2-12 stock/business failure becomes sync_failed', () => {
  it('an out-of-stock refusal fails that bill and the next bill is still sent', async () => {
    const blocked = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Blocked' }), { now: clock });
    const next = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Next' }), { now: clock + 1 });
    const server = new FakeServer();
    server.failures.push(new ApiError(422, 'Masala Dosa is out of stock'));
    useServer(server);

    const result = await syncNow(HOTEL_A);
    expect(result).toMatchObject({ failed: 1, synced: 1 });
    const records = await getAllOrders(HOTEL_A);
    expect(records.find(r => r.offlineId === blocked.offlineId)).toMatchObject({
      syncStatus: 'sync_failed', errorReason: 'Masala Dosa is out of stock',
    });
    expect(records.find(r => r.offlineId === next.offlineId)?.syncStatus).toBe('synced');
  });
});

// ── OFF-S2-13 ────────────────────────────────────────────────────────────────
describe('OFF-S2-13 stale syncing record recovers', () => {
  it('an old syncing record is requeued; a fresh one is left for whoever is sending it', async () => {
    const stale = await enqueueOrder(HOTEL_A, orderPayload(), { now: clock });
    const fresh = await enqueueOrder(HOTEL_A, orderPayload(), { now: clock + 1 });
    await claimForSync(HOTEL_A, stale.offlineId, clock - 120_000);
    await claimForSync(HOTEL_A, fresh.offlineId, clock - 5_000);

    expect(await recoverStaleSyncing(HOTEL_A, clock, 60_000)).toBe(1);
    const records = await getAllOrders(HOTEL_A);
    expect(records.find(r => r.offlineId === stale.offlineId)?.syncStatus).toBe('queued');
    expect(records.find(r => r.offlineId === fresh.offlineId)?.syncStatus).toBe('syncing');
  });

  it('holding the cross-tab lock recovers every syncing record at once', async () => {
    const record = await enqueueOrder(HOTEL_A, orderPayload());
    await claimForSync(HOTEL_A, record.offlineId, clock);
    const server = new FakeServer();
    const locks = { request: async <T,>(_n: string, _o: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<T>) => cb({}) };
    useServer(server, HOTEL_A, locks);

    expect((await syncNow(HOTEL_A)).synced).toBe(1);
  });
});

// ── OFF-S2-14 / 15 ───────────────────────────────────────────────────────────
describe('OFF-S2-14 same offlineId used during retry', () => {
  it('every attempt carries the record\'s own offlineId', async () => {
    const record = await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new TypeError('Failed to fetch'), new ApiError(503, 'down'));
    useServer(server);

    await syncNow(HOTEL_A);
    clock += 5_000;
    await syncNow(HOTEL_A);
    clock += 15_000;
    await syncNow(HOTEL_A);

    expect(server.calls).toHaveLength(3);
    expect(new Set(server.calls.map(c => c.offlineId))).toEqual(new Set([record.offlineId]));
  });
});

describe('OFF-S2-15 duplicate server response is handled idempotently', () => {
  it('the server returning an already-completed order marks the bill synced and closes nothing twice', async () => {
    const record = await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.orders.set(record.offlineId, {
      _id: 'srv-existing', orderNumber: 'ORD-77', tableNumber: '', grandTotal: 168, subtotal: 160,
      taxTotal: 8, status: 'completed', orderSource: 'takeaway', isParcel: true, items: [],
      createdAt: new Date(clock).toISOString(),
    });
    useServer(server);

    await syncNow(HOTEL_A);
    const [stored] = await getAllOrders(HOTEL_A);
    expect(stored).toMatchObject({ syncStatus: 'synced', serverId: 'srv-existing', serverOrderNumber: 'ORD-77' });
    expect(server.updateOrderStatus).not.toHaveBeenCalled();
    expect(server.completeOrder).not.toHaveBeenCalled();
    expect(server.orders.size).toBe(1);
  });
});

// ── OFF-S2-16 / 17 ───────────────────────────────────────────────────────────
describe('OFF-S2-16 concurrent sync calls do not duplicate submission', () => {
  it('five simultaneous triggers submit each of three bills exactly once', async () => {
    for (let i = 0; i < 3; i += 1) await enqueueOrder(HOTEL_A, orderPayload({ customerName: `C${i}` }), { now: clock + i });
    const server = new FakeServer();
    useServer(server);

    await Promise.all(Array.from({ length: 5 }, (_, i) => syncNow(HOTEL_A, { manual: i % 2 === 0 })));
    await Promise.all(Array.from({ length: 5 }, () => syncNow(HOTEL_A)));

    const perId = new Map<string, number>();
    for (const call of server.calls) perId.set(call.offlineId!, (perId.get(call.offlineId!) ?? 0) + 1);
    expect([...perId.values()]).toEqual([1, 1, 1]);
    expect(server.orders.size).toBe(3);
  });
});

describe('OFF-S2-17 browser restart recovery', () => {
  it('a crash mid-sync leaves nothing stuck: after restart the bill is sent once', async () => {
    const record = await enqueueOrder(HOTEL_A, orderPayload());
    await claimForSync(HOTEL_A, record.offlineId, clock); // the crash happens here

    resetDbForTesting();
    resetSyncEngineForTesting();
    clock += 61_000;
    const server = new FakeServer();
    useServer(server);

    expect((await syncNow(HOTEL_A)).synced).toBe(1);
    expect(server.createOrder).toHaveBeenCalledTimes(1);
    expect((await getAllOrders(HOTEL_A))[0].syncStatus).toBe('synced');
  });
});

// ── OFF-S2-18 ────────────────────────────────────────────────────────────────
describe('OFF-S2-18 old localStorage queue migration', () => {
  it('moves every old entry into IndexedDB oldest-first with its original id, then removes the key', async () => {
    const storage = new MemoryStorage();
    // The old queue stored newest first.
    storage.setItem(`${LEGACY_QUEUE_KEY_PREFIX}${HOTEL_A}`, JSON.stringify([
      { id: '1750000002000-newest', payload: orderPayload({ customerName: 'Newer' }), queuedAt: '2025-06-15T10:05:00.000Z', retries: 2 },
      { id: '1750000001000-oldest', payload: orderPayload({ customerName: 'Older' }), queuedAt: '2025-06-15T10:00:00.000Z', retries: 0 },
      { id: '1750000003000-broken', payload: { nope: true }, queuedAt: '2025-06-15T10:10:00.000Z', retries: 0 },
    ]));
    storage.setItem('pos_token', 'unrelated');

    const result = await migrateLegacyQueue(storage, clock);
    expect(result).toMatchObject({ migrated: 3, unreadable: 1 });
    expect(storage.getItem(`${LEGACY_QUEUE_KEY_PREFIX}${HOTEL_A}`)).toBeNull();
    expect(storage.getItem('pos_token')).toBe('unrelated');

    const records = await getAllOrders(HOTEL_A);
    expect(records.map(r => r.offlineId)).toEqual(['1750000001000-oldest', '1750000002000-newest', '1750000003000-broken']);
    expect(records[1]).toMatchObject({ syncStatus: 'queued', retryCount: 2 });
    // An unreadable entry is preserved for a person, never dropped.
    expect(records[2]).toMatchObject({ syncStatus: 'sync_failed', errorCode: 'legacy_unreadable' });
  });

  it('keeps the old queue when it cannot be read or written', async () => {
    const storage = new MemoryStorage();
    storage.setItem(`${LEGACY_QUEUE_KEY_PREFIX}${HOTEL_A}`, '{not json');
    const unreadable = await migrateLegacyQueue(storage, clock);
    expect(unreadable.keysKept).toEqual([`${LEGACY_QUEUE_KEY_PREFIX}${HOTEL_A}`]);
    expect(storage.getItem(`${LEGACY_QUEUE_KEY_PREFIX}${HOTEL_A}`)).toBe('{not json');

    storage.setItem(`${LEGACY_QUEUE_KEY_PREFIX}${HOTEL_B}`, JSON.stringify([{ id: 'x-1234567890', payload: orderPayload(), queuedAt: '2025-06-15T10:00:00.000Z', retries: 0 }]));
    (await getDb()).close(); // IndexedDB write fails
    const failedWrite = await migrateLegacyQueue(storage, clock);
    expect(failedWrite.keysKept).toContain(`${LEGACY_QUEUE_KEY_PREFIX}${HOTEL_B}`);
    expect(storage.getItem(`${LEGACY_QUEUE_KEY_PREFIX}${HOTEL_B}`)).not.toBeNull();
  });
});

// ── OFF-S2-19 / 20 ───────────────────────────────────────────────────────────
describe('OFF-S2-19 pending count', () => {
  it('counts queued and syncing bills for this hotel only', async () => {
    await enqueueOrder(HOTEL_A, orderPayload(), { now: clock });
    const claimed = await enqueueOrder(HOTEL_A, orderPayload(), { now: clock + 1 });
    await enqueueOrder(HOTEL_B, orderPayload());
    await claimForSync(HOTEL_A, claimed.offlineId, clock);

    expect(await getPendingCount(HOTEL_A)).toBe(2);
    const summary = await getQueueSummary(HOTEL_A);
    expect(summary).toMatchObject({ pending: 2, syncing: 1, failed: 0 });
    expect(summary.oldestQueuedAt).toBe(new Date(clock).toISOString());
  });
});

describe('OFF-S2-20 failed count', () => {
  it('counts failed bills and shows each reason with the latest sync time', async () => {
    await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Anita' }), { now: clock });
    await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Ok' }), { now: clock + 1 });
    const server = new FakeServer();
    server.failures.push(new ApiError(409, 'Coupon usage limit reached'));
    useServer(server);
    await syncNow(HOTEL_A);

    expect(await getFailedCount(HOTEL_A)).toBe(1);
    const summary = await getQueueSummary(HOTEL_A);
    expect(summary.failedOrders).toEqual([
      expect.objectContaining({ label: 'Anita', reason: 'Coupon usage limit reached', itemCount: 2 }),
    ]);
    expect(summary.lastSyncedAt).toBe(new Date(clock).toISOString());
  });
});

// ── OFF-S2-21 ────────────────────────────────────────────────────────────────
describe('OFF-S2-21 manual Sync Now', () => {
  it('Sync Now sends a bill that is waiting out its backoff', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new TypeError('Failed to fetch'));
    useServer(server);

    await syncNow(HOTEL_A);
    expect((await syncNow(HOTEL_A)).stopReason).toBe('waiting_backoff');
    expect((await syncNow(HOTEL_A, { manual: true })).synced).toBe(1);
    expect(server.createOrder).toHaveBeenCalledTimes(2);
  });
});

// ── OFF-S2-22 / 23 / 24 — payments ───────────────────────────────────────────
describe('OFF-S2-22 Razorpay remains blocked offline', () => {
  it('refuses a Razorpay or online-payment bill and queues nothing', async () => {
    await expect(enqueueOrder(HOTEL_A, orderPayload({ paymentMethod: 'razorpay' as never }))).rejects.toThrow(/Online payments/);
    await expect(enqueueOrder(HOTEL_A, orderPayload({ razorpayPaymentId: 'pay_123' }))).rejects.toThrow(/Online payments/);
    await expect(enqueueOrder(HOTEL_A, orderPayload({ transactionId: 'upi-txn-1' }))).rejects.toThrow(/Online payments/);
    expect(await getQueue(HOTEL_A)).toHaveLength(0);
  });

  it('the POS order form offers only staff-recorded payment methods', () => {
    const panel = repoFile('web/src/components/cashier/NewOrderPanel.tsx');
    expect(panel).toMatch(/type PayMethod = 'cash' \| 'upi' \| 'card' \| 'split';/);
    expect(panel).not.toMatch(/razorpay/i);
  });
});

describe('OFF-S2-23 QR ordering remains online-only', () => {
  it('refuses a QR order, and the QR app has no offline queue', async () => {
    await expect(enqueueOrder(HOTEL_A, orderPayload({ orderSource: 'qr' }))).rejects.toThrow(/need an internet connection/);
    const qrMenu = repoFile('qr/src/pages/MenuPage.tsx');
    expect(qrMenu).toMatch(/Razorpay/);
    expect(qrMenu).not.toMatch(/offlineQueue|indexedDB|enqueueOrder/);
  });
});

describe('OFF-S2-24 Kiosk Razorpay remains blocked', () => {
  it('refuses a kiosk order', async () => {
    await expect(enqueueOrder(HOTEL_A, orderPayload({ orderSource: 'kiosk' }))).rejects.toThrow(/need an internet connection/);
    expect(await getQueue(HOTEL_A)).toHaveLength(0);
  });
});

// ── OFF-S2-25 / 26 — printing ────────────────────────────────────────────────
const printUtils = repoFile('backend/src/utils/printUtils.ts');
const kotSection = printUtils.slice(
  printUtils.indexOf('export async function scheduleKOTPrint'),
  printUtils.indexOf('export async function scheduleOrderReceiptPrint'),
);
const receiptSection = printUtils.slice(printUtils.indexOf('export async function scheduleOrderReceiptPrint'));

describe('OFF-S2-25 single-printer rule remains unchanged', () => {
  it('single mode (the default) returns before any KOT is dispatched', () => {
    expect(kotSection).toMatch(/const mode\s+= s\?\.printerMode\s+\?\? 'single';/);
    const singleReturn = kotSection.search(/if \(mode === 'single'\) \{[\s\S]*?return;/);
    expect(singleReturn).toBeGreaterThan(-1);
    expect(singleReturn).toBeLessThan(kotSection.indexOf('dispatchPrintJob('));
  });

  it('the sync engine and queue never print, emit or send a KOT themselves', () => {
    for (const file of ['web/src/sync/syncEngine.ts', 'web/src/utils/offlineQueue.ts']) {
      const code = repoFile(file).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
      expect(code, file).not.toMatch(/print|kot\b|socket|\.emit\(|new_order/i);
    }
  });
});

describe('OFF-S2-26 dual-printer rule remains unchanged', () => {
  it('dual mode sends the KOT to the kitchen printer and the receipt to the cashier printer', () => {
    expect(kotSection).toMatch(/const printerTarget = 'kitchen' as const;/);
    expect(kotSection).toMatch(/const kotAddress\s+= kitchenAddr;/);
    expect(receiptSection).toMatch(/const printerTarget = 'cashier' as const;/);
    expect(receiptSection).toMatch(/mode === 'dual' \? cashierAddr : \(cashierAddr \|\| kitchenAddr\)/);
  });
});

// ── OFF-S2-27 / 28 ───────────────────────────────────────────────────────────
describe('OFF-S2-27 server authoritative pricing remains intact', () => {
  it('never sends client totals or stock; the server calculates them', async () => {
    await enqueueOrder(HOTEL_A, orderPayload({ grandTotal: 1, subtotal: 1, taxTotal: 0, stock: 99 }));
    const server = new FakeServer();
    useServer(server);
    await syncNow(HOTEL_A);

    const sent = server.calls[0] as unknown as Record<string, unknown>;
    for (const field of ['grandTotal', 'subtotal', 'taxTotal', 'stock']) expect(sent).not.toHaveProperty(field);

    const createRoute = repoFile('backend/src/routes/orderRoutes.ts');
    const post = createRoute.slice(createRoute.indexOf("router.post('/', requireWaiterOrCashierOrAdmin"), createRoute.indexOf("router.patch('/:id/status'"));
    expect(post.length).toBeGreaterThan(1000);
    expect(post).not.toMatch(/req\.body\.(grandTotal|subtotal|taxTotal)/);
  });
});

describe('OFF-S2-28 no duplicate order on lost HTTP response', () => {
  it('the server saved ABC, the response was lost, the retry returns the same order: exactly one', async () => {
    const record = await enqueueOrder(HOTEL_A, orderPayload(), { offlineId: 'ABC-offline-0001' });
    const server = new FakeServer();
    server.loseNextResponse = true;
    useServer(server);

    expect((await syncNow(HOTEL_A)).stopReason).toBe('retry_later');
    expect(server.orders.size).toBe(1);
    expect((await getQueue(HOTEL_A))[0].syncStatus).toBe('queued');

    clock += 5_000;
    await syncNow(HOTEL_A);

    expect(server.orders.size).toBe(1);
    expect(server.calls.map(c => c.offlineId)).toEqual([record.offlineId, record.offlineId]);
    expect((await getAllOrders(HOTEL_A))[0]).toMatchObject({ syncStatus: 'synced', serverId: 'srv-1' });
    expect(server.completeOrder).toHaveBeenCalledTimes(1);
  });
});

// ── Authentication ───────────────────────────────────────────────────────────
describe('OFF-S2 authentication', () => {
  it('a session that cannot be refreshed stops the run and asks for login, without failing the bill', async () => {
    await enqueueOrder(HOTEL_A, orderPayload(), { now: clock });
    await enqueueOrder(HOTEL_A, orderPayload(), { now: clock + 1 });
    const server = new FakeServer();
    server.failures.push(new ApiError(401, 'Session expired'));
    useServer(server);

    expect((await syncNow(HOTEL_A)).stopReason).toBe('login_required');
    expect(server.createOrder).toHaveBeenCalledTimes(1);
    const summary = await getQueueSummary(HOTEL_A);
    expect(summary).toMatchObject({ pending: 2, failed: 0, loginRequired: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPRINT 3 — Production Hardening
// ═══════════════════════════════════════════════════════════════════════════════

// ── OFF-S3-01 ────────────────────────────────────────────────────────────────
describe('OFF-S3-01 checkBackendHealth returns true on 200 OK', () => {
  it('resolves true when the health endpoint responds with 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true }));
    expect(await checkBackendHealth()).toBe(true);
    vi.unstubAllGlobals();
  });
});

// ── OFF-S3-02 ────────────────────────────────────────────────────────────────
describe('OFF-S3-02 checkBackendHealth returns false on network error', () => {
  it('resolves false when fetch throws (network down)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')));
    expect(await checkBackendHealth()).toBe(false);
    vi.unstubAllGlobals();
  });
});

// ── OFF-S3-03 ────────────────────────────────────────────────────────────────
describe('OFF-S3-03 checkBackendHealth returns false on non-2xx response', () => {
  it('resolves false when the health endpoint returns 500 or 503', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 503 }));
    expect(await checkBackendHealth()).toBe(false);
    expect(await checkBackendHealth()).toBe(false);
    vi.unstubAllGlobals();
  });
});

// ── OFF-S3-04 ────────────────────────────────────────────────────────────────
describe('OFF-S3-04 checkBackendHealth aborts after HEALTH_CHECK_TIMEOUT_MS', () => {
  it('uses a 5-second timeout and resolves false when fetch is aborted', async () => {
    expect(HEALTH_CHECK_TIMEOUT_MS).toBe(5_000);
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise<never>((_res, rej) => {
          (init.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    ));
    // Fast-forward abort via fake timer is tricky; instead just verify false on abort.
    vi.useFakeTimers();
    const promise = checkBackendHealth();
    vi.advanceTimersByTime(HEALTH_CHECK_TIMEOUT_MS + 100);
    expect(await promise).toBe(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

// ── OFF-S3-05 ────────────────────────────────────────────────────────────────
describe('OFF-S3-05 deriveConnectivityStatus four states', () => {
  it('online+healthy→ONLINE, online+null→CHECKING, online+false→DEGRADED, offline→OFFLINE', () => {
    expect(deriveConnectivityStatus(true,  true)).toBe('ONLINE');
    expect(deriveConnectivityStatus(true,  null)).toBe('CHECKING');
    expect(deriveConnectivityStatus(true,  false)).toBe('DEGRADED');
    expect(deriveConnectivityStatus(false, true)).toBe('OFFLINE');
    expect(deriveConnectivityStatus(false, null)).toBe('OFFLINE');
    expect(deriveConnectivityStatus(false, false)).toBe('OFFLINE');
  });
});

// ── OFF-S3-06 ────────────────────────────────────────────────────────────────
describe('OFF-S3-06 OfflineBanner source handles DEGRADED state', () => {
  it('exports ConnectivityStatus with degraded and renders a Server Unreachable banner', () => {
    const banner = repoFile('web/src/components/cashier/OfflineBanner.tsx');
    expect(banner).toMatch(/degraded/);
    expect(banner).toMatch(/Server Unreachable/);
    expect(banner).toMatch(/useConnectivity/);
    expect(banner).toMatch(/'online' \| 'socket_only' \| 'offline' \| 'degraded'/);
  });
});

// ── OFF-S3-07 ────────────────────────────────────────────────────────────────
describe('OFF-S3-07 offlineQueue source wraps QuotaExceededError as OfflineQueueError', () => {
  it('the source contains QuotaExceededError handling with a user-readable message', () => {
    const source = repoFile('web/src/utils/offlineQueue.ts');
    expect(source).toMatch(/QuotaExceededError/);
    expect(source).toMatch(/storage is full/i);
    expect(source).toMatch(/OfflineQueueError/);
  });
});

// ── OFF-S3-08 ────────────────────────────────────────────────────────────────
describe('OFF-S3-08 offlineQueue source wraps other IDB write failures as OfflineQueueError', () => {
  it('the source wraps non-quota IDB errors with a generic OfflineQueueError', () => {
    const source = repoFile('web/src/utils/offlineQueue.ts');
    expect(source).toMatch(/Could not save the bill offline/);
    // The try/catch wraps both add and done.
    expect(source).toMatch(/tx\.store\.add\(record\)/);
    expect(source).toMatch(/catch \(err\)/);
  });
});

// ── OFF-S3-09 ────────────────────────────────────────────────────────────────
describe('OFF-S3-09 enqueueOrder throws OfflineQueueError (not generic Error) for missing hotelId', () => {
  it('an OfflineQueueError is thrown so callers can distinguish queue errors from crashes', async () => {
    const err = await enqueueOrder('', orderPayload()).catch(e => e);
    expect(err).toBeInstanceOf(OfflineQueueError);
    expect(err.name).toBe('OfflineQueueError');
    expect(err.message).toMatch(/Sign in/i);
  });
});

// ── OFF-S3-10 ────────────────────────────────────────────────────────────────
describe('OFF-S3-10 cacheProducts with 0 items does NOT wipe existing cache', () => {
  it('an empty products array leaves the cached products untouched', async () => {
    await cacheProducts(HOTEL_A, [{ _id: 'p1', name: 'Idli' } as never]);
    expect(await getLocalProducts(HOTEL_A)).toHaveLength(1);

    // server returned nothing (failed/empty response)
    await cacheProducts(HOTEL_A, []);
    expect(await getLocalProducts(HOTEL_A)).toHaveLength(1);
  });
});

// ── OFF-S3-11 ────────────────────────────────────────────────────────────────
describe('OFF-S3-11 cacheProducts replaces the cache when products are provided', () => {
  it('a non-empty list replaces previous products for this hotel', async () => {
    await cacheProducts(HOTEL_A, [{ _id: 'old', name: 'Old' } as never]);
    await cacheProducts(HOTEL_A, [{ _id: 'new1', name: 'New1' } as never, { _id: 'new2', name: 'New2' } as never]);
    const products = await getLocalProducts(HOTEL_A);
    expect(products.map((p: { _id: string }) => p._id).sort()).toEqual(['new1', 'new2']);
  });
});

// ── OFF-S3-12 ────────────────────────────────────────────────────────────────
describe('OFF-S3-12 cacheCategories with 0 items does NOT wipe existing cache', () => {
  it('an empty categories array leaves the cached categories untouched', async () => {
    const { getDb: getDbFn } = await import('../../db/offlineDb');
    const db = await getDbFn();
    await db.put('categories', { _id: 'c1', name: 'Main', hotelId: HOTEL_A } as never);
    await cacheCategories(HOTEL_A, []);
    const still = await db.getAllFromIndex('categories', 'by-hotel', HOTEL_A);
    expect(still).toHaveLength(1);
  });
});

// ── OFF-S3-13 ────────────────────────────────────────────────────────────────
describe('OFF-S3-13 productCache is hotel-isolated', () => {
  it('Hotel A products are invisible from Hotel B and vice-versa', async () => {
    await cacheProducts(HOTEL_A, [{ _id: 'a1', name: 'A-item' } as never]);
    await cacheProducts(HOTEL_B, [{ _id: 'b1', name: 'B-item' } as never]);

    const forA = await getLocalProducts(HOTEL_A);
    const forB = await getLocalProducts(HOTEL_B);
    expect(forA.map((p: { _id: string }) => p._id)).toEqual(['a1']);
    expect(forB.map((p: { _id: string }) => p._id)).toEqual(['b1']);
  });
});

// ── OFF-S3-14 ────────────────────────────────────────────────────────────────
describe('OFF-S3-14 recoverStaleSyncing sets errorCode interrupted', () => {
  it('a recovered record gets errorCode "interrupted" so the cashier sees an explanation', async () => {
    const r = await enqueueOrder(HOTEL_A, orderPayload(), { now: clock });
    await claimForSync(HOTEL_A, r.offlineId, clock - 120_000);
    await recoverStaleSyncing(HOTEL_A, clock, 60_000);
    const [recovered] = await getAllOrders(HOTEL_A);
    expect(recovered).toMatchObject({ syncStatus: 'queued', errorCode: 'interrupted' });
    expect(recovered.errorReason).toMatch(/interrupted/i);
  });
});

// ── OFF-S3-15 ────────────────────────────────────────────────────────────────
describe('OFF-S3-15 recoverStaleSyncing returns the count of recovered records', () => {
  it('returns N for N stale records, 0 for fresh records', async () => {
    const a = await enqueueOrder(HOTEL_A, orderPayload(), { now: clock });
    const b = await enqueueOrder(HOTEL_A, orderPayload(), { now: clock + 1 });
    await claimForSync(HOTEL_A, a.offlineId, clock - 90_000); // stale
    await claimForSync(HOTEL_A, b.offlineId, clock - 30_000); // fresh

    const count = await recoverStaleSyncing(HOTEL_A, clock, 60_000);
    expect(count).toBe(1);
  });
});

// ── OFF-S3-16 ────────────────────────────────────────────────────────────────
describe('OFF-S3-16 fresh syncing records are not recovered', () => {
  it('a syncing record within the stale threshold remains in syncing state', async () => {
    const r = await enqueueOrder(HOTEL_A, orderPayload());
    await claimForSync(HOTEL_A, r.offlineId, clock - 5_000); // 5s old, well under 60s threshold
    await recoverStaleSyncing(HOTEL_A, clock, 60_000);
    const [record] = await getAllOrders(HOTEL_A);
    expect(record.syncStatus).toBe('syncing');
  });
});

// ── OFF-S3-17 ────────────────────────────────────────────────────────────────
describe('OFF-S3-17 recovered records keep their original offlineId', () => {
  it('recovery never changes the offlineId, so a re-attempt is idempotent on the server', async () => {
    const r = await enqueueOrder(HOTEL_A, orderPayload(), { offlineId: 'stable-offline-id-12345' });
    await claimForSync(HOTEL_A, r.offlineId, clock - 120_000);
    await recoverStaleSyncing(HOTEL_A, clock, 60_000);
    const [recovered] = await getAllOrders(HOTEL_A);
    expect(recovered.offlineId).toBe('stable-offline-id-12345');
  });
});

// ── OFF-S3-18 ────────────────────────────────────────────────────────────────
describe('OFF-S3-18 staleAfterMs=0 recovers all syncing records including fresh ones', () => {
  it('holding the cross-tab lock (staleAfterMs=0) recovers everything, even a record just claimed', async () => {
    const r = await enqueueOrder(HOTEL_A, orderPayload());
    await claimForSync(HOTEL_A, r.offlineId, clock); // just now
    const count = await recoverStaleSyncing(HOTEL_A, clock, 0);
    expect(count).toBe(1);
    expect((await getAllOrders(HOTEL_A))[0].syncStatus).toBe('queued');
  });
});

// ── OFF-S3-19 ────────────────────────────────────────────────────────────────
describe('OFF-S3-19 401 during sync → bill stays queued, not sync_failed', () => {
  it('an auth failure puts the bill back in queued with errorCode auth_required', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new ApiError(401, 'Session expired'));
    useServer(server);

    const result = await syncNow(HOTEL_A);
    expect(result.stopReason).toBe('login_required');
    const [record] = await getQueue(HOTEL_A);
    expect(record.syncStatus).toBe('queued');
    expect(record.errorCode).toBe('auth_required');
  });
});

// ── OFF-S3-20 ────────────────────────────────────────────────────────────────
describe('OFF-S3-20 errorCode=auth_required is set after 401', () => {
  it('the errorCode on the queued bill distinguishes auth failure from transient network errors', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new ApiError(401, 'Expired'));
    useServer(server);
    await syncNow(HOTEL_A);

    const [record] = await getAllOrders(HOTEL_A);
    expect(record.errorCode).toBe('auth_required');
    expect(record.syncStatus).not.toBe('sync_failed');
  });
});

// ── OFF-S3-21 ────────────────────────────────────────────────────────────────
describe('OFF-S3-21 loginRequired=true in summary when auth_required bills exist', () => {
  it('any bill with errorCode auth_required causes the summary to flag loginRequired=true', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new ApiError(401, 'Expired'));
    useServer(server);
    await syncNow(HOTEL_A);

    const summary = await getQueueSummary(HOTEL_A);
    expect(summary.loginRequired).toBe(true);
    expect(summary.failed).toBe(0); // bill was NOT marked sync_failed
  });
});

// ── OFF-S3-22 ────────────────────────────────────────────────────────────────
describe('OFF-S3-22 requeueFailed resets retryCount to 0', () => {
  it('a person-triggered retry starts fresh without the backoff count the auto-retry accumulated', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new ApiError(400, 'Refused'));
    useServer(server);
    await syncNow(HOTEL_A);

    const [failed] = await getAllOrders(HOTEL_A);
    expect(failed.syncStatus).toBe('sync_failed');

    await requeueFailed(HOTEL_A, failed.offlineId);
    const [requeued] = await getAllOrders(HOTEL_A);
    expect(requeued.syncStatus).toBe('queued');
    expect(requeued.retryCount).toBe(0);
    expect(requeued.errorCode).toBeNull();
    expect(requeued.nextAttemptAt).toBeNull();
  });
});

// ── OFF-S3-23 ────────────────────────────────────────────────────────────────
describe('OFF-S3-23 requeueFailed preserves the original offlineId', () => {
  it('the offlineId never changes, so the retry carries the same idempotency key the server knows', async () => {
    const enqueued = await enqueueOrder(HOTEL_A, orderPayload(), { offlineId: 'retry-id-original-xyz' });
    const server = new FakeServer();
    server.failures.push(new ApiError(422, 'Out of stock'));
    useServer(server);
    await syncNow(HOTEL_A);

    await requeueFailed(HOTEL_A, enqueued.offlineId);
    const [requeued] = await getAllOrders(HOTEL_A);
    expect(requeued.offlineId).toBe('retry-id-original-xyz');
  });
});

// ── OFF-S3-24 ────────────────────────────────────────────────────────────────
describe('OFF-S3-24 403 PLAN_EXPIRED stops run with login_required', () => {
  it('a subscription-expired 403 is treated like an auth failure, not a permanent bill rejection', async () => {
    await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    server.failures.push(new ApiError(403, 'Subscription expired', 'PLAN_EXPIRED'));
    useServer(server);

    const result = await syncNow(HOTEL_A);
    expect(result.stopReason).toBe('login_required');
    const [record] = await getAllOrders(HOTEL_A);
    expect(record.syncStatus).toBe('queued'); // NOT sync_failed
    expect(record.errorCode).toBe('subscription_expired');
  });
});

// ── OFF-S3-25 ────────────────────────────────────────────────────────────────
describe('OFF-S3-25 nextWakeAt returns null when no bills are queued', () => {
  it('returns null for an empty queue and null for a hotel with only synced bills', async () => {
    expect(await nextWakeAt(HOTEL_A, clock)).toBeNull();
    const r = await enqueueOrder(HOTEL_A, orderPayload());
    const server = new FakeServer();
    useServer(server);
    await syncNow(HOTEL_A);
    expect((await getAllOrders(HOTEL_A))[0].syncStatus).toBe('synced');
    expect(await nextWakeAt(HOTEL_A, clock)).toBeNull();
  });
});

// ── OFF-S3-26 ────────────────────────────────────────────────────────────────
describe('OFF-S3-26 nextWakeAt returns the earliest scheduled nextAttemptAt', () => {
  it('returns the nextAttemptAt of the single queued bill after two failures', async () => {
    const server = new FakeServer();
    for (let i = 0; i < 2; i += 1) server.failures.push(new TypeError('Failed to fetch'));
    useServer(server);

    await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'B1' }), { now: clock });

    await syncNow(HOTEL_A);   // fails → nextAttemptAt = clock + 5_000
    clock += 5_000;
    await syncNow(HOTEL_A);   // fails again → nextAttemptAt = clock + 15_000 = original + 20_000

    const wakeAt = await nextWakeAt(HOTEL_A, clock);
    expect(wakeAt).not.toBeNull();
    expect(wakeAt!).toBeGreaterThan(clock);   // definitely in the future
    expect(wakeAt!).toBe(clock + 15_000);     // second failure → 15 s backoff from current clock
  });
});

// ── OFF-S3-27 ────────────────────────────────────────────────────────────────
describe('OFF-S3-27 startAutoSync wires up to the online event', () => {
  it('the sync engine source subscribes to the online event inside startAutoSync', () => {
    const source = repoFile('web/src/sync/syncEngine.ts');
    expect(source).toMatch(/window\.addEventListener\('online'/);
    expect(source).toMatch(/startAutoSync/);
  });
});

// ── OFF-S3-28 ────────────────────────────────────────────────────────────────
describe('OFF-S3-28 startAutoSync wires up to the queue subscription', () => {
  it('the sync engine source subscribes to queue changes inside startAutoSync', () => {
    const source = repoFile('web/src/sync/syncEngine.ts');
    expect(source).toMatch(/subscribeQueue/);
  });

  it('adding a bill while the engine is running schedules a new pass', async () => {
    const server = new FakeServer();
    useServer(server);

    let synced = 0;
    const stop = startAutoSync(HOTEL_A);
    await vi.waitFor(async () => {
      // queue something and confirm the engine picks it up
      if (synced === 0) {
        await enqueueOrder(HOTEL_A, orderPayload());
      }
      synced = (await getAllOrders(HOTEL_A)).filter(r => r.syncStatus === 'synced').length;
      expect(synced).toBe(1);
    }, { timeout: 2_000 });
    stop();
  });
});

// ── OFF-S3-29 ────────────────────────────────────────────────────────────────
describe('OFF-S3-29 serverId preserved through markRetry', () => {
  it('when afterCreate fails on a real server order, the serverId is kept so the retry knows the order exists', async () => {
    const r = await enqueueOrder(HOTEL_A, orderPayload());
    await claimForSync(HOTEL_A, r.offlineId, clock);
    await markRetry(
      HOTEL_A, r.offlineId,
      { code: 'completion_failed', reason: 'Could not close the bill' },
      clock + 5_000,
      'srv-already-created',
    );
    const [record] = await getAllOrders(HOTEL_A);
    expect(record.serverId).toBe('srv-already-created');
    expect(record.syncStatus).toBe('queued');
  });
});

// ── OFF-S3-30 ────────────────────────────────────────────────────────────────
describe('OFF-S3-30 savedOnServer=true in QueueOrderView when serverId is set', () => {
  it('a bill whose order was created but whose afterCreate step failed shows savedOnServer=true', async () => {
    const r = await enqueueOrder(HOTEL_A, orderPayload());
    await claimForSync(HOTEL_A, r.offlineId, clock);
    await markRetry(
      HOTEL_A, r.offlineId,
      { code: 'completion_failed', reason: 'Could not close' },
      clock + 5_000,
      'srv-orphan-001',
    );
    const summary = await getQueueSummary(HOTEL_A);
    expect(summary.waitingOrders[0].savedOnServer).toBe(true);
  });
});

// ── OFF-S3-31 ────────────────────────────────────────────────────────────────
describe('OFF-S3-31 classifySyncError categories: auth / permanent / retryable', () => {
  it('401 → auth/auth_required; 403 PLAN_EXPIRED → auth/subscription_expired; 400 → permanent', () => {
    const auth401 = classifySyncError(new ApiError(401, 'Session expired'));
    expect(auth401).toMatchObject({ kind: 'auth', code: 'auth_required' });

    const authPlan = classifySyncError(new ApiError(403, 'Plan expired', 'PLAN_EXPIRED'));
    expect(authPlan).toMatchObject({ kind: 'auth', code: 'subscription_expired' });

    const perm = classifySyncError(new ApiError(400, 'Customer phone is required'));
    expect(perm).toMatchObject({ kind: 'permanent', reason: 'Customer phone is required' });
  });
});

// ── OFF-S3-32 ────────────────────────────────────────────────────────────────
describe('OFF-S3-32 classifySyncError retryable errors', () => {
  it('503, TypeError (network), and AbortError are all classified retryable', () => {
    expect(classifySyncError(new ApiError(503, 'Service Unavailable')).kind).toBe('retryable');
    expect(classifySyncError(new TypeError('Failed to fetch')).kind).toBe('retryable');
    expect(classifySyncError(Object.assign(new Error('aborted'), { name: 'AbortError' })).kind).toBe('retryable');
  });
});

// ── OFF-S3-33 ────────────────────────────────────────────────────────────────
describe('OFF-S3-33 classifySyncError never leaks database/stack detail to the cashier', () => {
  it('E11000, ObjectId, stack traces are replaced with a generic cashier-facing reason', () => {
    for (const internal of [
      'E11000 duplicate key error collection: orders index: x',
      'CastError: Cast to ObjectId failed for value "foo"',
      'Error: at Object.save (/app/server/order.js:42)',
    ]) {
      const { reason } = classifySyncError(new ApiError(400, internal));
      expect(reason).toBe('The server refused this bill.');
      expect(reason).not.toMatch(/E11000|ObjectId|\.js:\d+/);
    }
  });
});

// ── OFF-S3-34 ────────────────────────────────────────────────────────────────
describe('OFF-S3-34 sync engine source never calls print/KOT/socket APIs', () => {
  it('syncEngine.ts has no print, KOT, socket.emit, or new_order references', () => {
    const source = repoFile('web/src/sync/syncEngine.ts').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    expect(source).not.toMatch(/print|kot\b|socket|\.emit\(|new_order/i);
  });
});

// ── OFF-S3-35 ────────────────────────────────────────────────────────────────
describe('OFF-S3-35 offline queue source never calls print/KOT/socket APIs', () => {
  it('offlineQueue.ts has no print, KOT, socket.emit, or new_order references', () => {
    const source = repoFile('web/src/utils/offlineQueue.ts').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    expect(source).not.toMatch(/print|kot\b|socket|\.emit\(|new_order/i);
  });
});

// ── OFF-S3-36 ────────────────────────────────────────────────────────────────
describe('OFF-S3-36 newOfflineId generates valid v4 UUIDs', () => {
  it('generates unique v4 UUIDs even on repeated calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newOfflineId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});

// ── OFF-S3-37 ────────────────────────────────────────────────────────────────
describe('OFF-S3-37 client total fields are stripped from the queued payload', () => {
  it('grandTotal, subtotal, taxTotal, total, stock, stockUpdates are never stored in the queue', async () => {
    await enqueueOrder(HOTEL_A, orderPayload({
      grandTotal: 999, subtotal: 999, taxTotal: 99,
    } as never));
    const [record] = await getAllOrders(HOTEL_A);
    const payload = record.payload as unknown as Record<string, unknown>;
    for (const field of ['grandTotal', 'subtotal', 'taxTotal', 'total', 'stock', 'stockUpdates']) {
      expect(payload).not.toHaveProperty(field);
    }
  });
});

// ── OFF-S3-38 ────────────────────────────────────────────────────────────────
describe('OFF-S3-38 online payment fields present in payload → OfflineQueueError', () => {
  it('any gateway-payment field blocks offline queueing', async () => {
    const fields = ['razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature', 'paymentLinkId', 'transactionId'];
    for (const field of fields) {
      await expect(enqueueOrder(HOTEL_A, orderPayload({ [field]: 'x' } as never)))
        .rejects.toBeInstanceOf(OfflineQueueError);
    }
    expect(await getQueue(HOTEL_A)).toHaveLength(0);
  });
});

// ── OFF-S3-39 ────────────────────────────────────────────────────────────────
describe('OFF-S3-39 pruneSynced never removes unsynced bills', () => {
  it('queued, syncing and sync_failed records are never pruned regardless of age', async () => {
    const queued = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Q' }), { now: clock - 30 * 86_400_000 });
    const claimed = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'S' }), { now: clock - 30 * 86_400_000 });
    await claimForSync(HOTEL_A, claimed.offlineId, clock - 30 * 86_400_000);
    const failed = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'F' }), { now: clock - 30 * 86_400_000 });
    await claimForSync(HOTEL_A, failed.offlineId, clock - 30 * 86_400_000);
    await markFailed(HOTEL_A, failed.offlineId, { code: 'bad', reason: 'bad' });

    const removed = await pruneSynced(HOTEL_A, clock);
    expect(removed).toBe(0);

    const remaining = await getAllOrders(HOTEL_A);
    expect(remaining.map(r => r.offlineId).sort())
      .toEqual([queued.offlineId, claimed.offlineId, failed.offlineId].sort());
  });
});

// ── OFF-S3-40 ────────────────────────────────────────────────────────────────
describe('OFF-S3-40 pruneSynced removes old synced records but keeps recent ones', () => {
  it('only synced records older than olderThanMs are pruned; newer synced records remain', async () => {
    const server = new FakeServer();
    useServer(server);

    const old1 = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Old1' }), { now: clock - 10 * 86_400_000 });
    const old2 = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Old2' }), { now: clock - 10 * 86_400_000 });
    const fresh = await enqueueOrder(HOTEL_A, orderPayload({ customerName: 'Fresh' }), { now: clock });

    await syncNow(HOTEL_A);

    // Manually back-date syncedAt for the old ones.
    const db = await getDb();
    const tx = db.transaction('pendingOrders', 'readwrite');
    for (const offlineId of [old1.offlineId, old2.offlineId]) {
      const r = await tx.store.get(offlineId);
      if (r) await tx.store.put({ ...r, syncedAt: new Date(clock - 8 * 86_400_000).toISOString() });
    }
    await tx.done;

    const removed = await pruneSynced(HOTEL_A, clock, 7 * 86_400_000);
    expect(removed).toBe(2);

    const remaining = await getAllOrders(HOTEL_A);
    expect(remaining.map(r => r.offlineId)).toEqual([fresh.offlineId]);
  });
});
