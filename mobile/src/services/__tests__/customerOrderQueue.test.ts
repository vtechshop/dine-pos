import { createCustomerOrderQueue, KeyValueStorage } from '../customerOrderQueue';

// In-memory AsyncStorage stand-in with optional async delay (to expose races).
function memoryStorage(delayMs = 0): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const wait = () => new Promise(r => setTimeout(r, delayMs));
  return {
    data,
    async getItem(k) { await wait(); return data.has(k) ? data.get(k)! : null; },
    async setItem(k, v) { await wait(); data.set(k, v); },
  };
}

const KEY = '@customer_order_queue';
const httpErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const order = (n: number) => ({ hotel: 'h1', orderSource: 'kiosk', paymentMethod: 'cash', items: [{ product: `p${n}` }] });

test('each queued order gets a stable offlineId that is sent on every retry', async () => {
  const storage = memoryStorage();
  const sent: string[] = [];
  let fail = true;
  const q = createCustomerOrderQueue({
    storage, key: KEY, backoffMs: () => 0,
    send: async (o: any) => { sent.push(o.offlineId); if (fail) throw new Error('Request timed out. Check your connection.'); },
  });
  const id = await q.enqueue('h1', '42', order(1));
  await q.flush();             // timeout — kept
  fail = false;
  await q.flush();             // retry succeeds
  expect(sent).toEqual([id, id]);
  expect(id).toMatch(/^kq_\d+_[a-z0-9]+$/);
  expect(await q.list()).toHaveLength(0);
});

test('concurrent flushes send each order only once', async () => {
  const storage = memoryStorage(5);
  let sends = 0;
  const q = createCustomerOrderQueue({ storage, key: KEY, send: async () => { sends++; await new Promise(r => setTimeout(r, 20)); } });
  await q.enqueue('h1', '1', order(1));
  await q.enqueue('h1', '2', order(2));
  await Promise.all([q.flush(), q.flush(), q.flush()]);
  expect(sends).toBe(2);
  expect(await q.list()).toHaveLength(0);
});

test('an order enqueued while a flush is running is not lost', async () => {
  const storage = memoryStorage(5);
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  let first = true;
  const q = createCustomerOrderQueue({
    storage, key: KEY,
    send: async () => { if (first) { first = false; await gate; } },
  });
  await q.enqueue('h1', '1', order(1));
  const flushing = q.flush();
  const lateId = q.enqueue('h1', '2', order(2));   // arrives mid-flush
  await new Promise(r => setTimeout(r, 30));
  release();
  await flushing;
  await lateId;
  const left = await q.list();
  expect(left.map(e => e.orderData.items)).toEqual([[{ product: 'p2' }]]); // still queued, not overwritten
});

test('permanent refusal (4xx) marks the order failed and does not block the rest', async () => {
  const storage = memoryStorage();
  const sent: string[] = [];
  const q = createCustomerOrderQueue({
    storage, key: KEY,
    send: async (o: any) => { sent.push(o.items[0].product); if (o.items[0].product === 'p1') throw httpErr(400); },
  });
  await q.enqueue('h1', '1', order(1));
  await q.enqueue('h1', '2', order(2));
  const r = await q.flush();
  expect(r).toEqual({ sent: 1, failed: 1, pending: 0 });
  const left = await q.list();
  expect(left).toHaveLength(1);
  expect(left[0].status).toBe('failed');
  await q.flush();                       // failed entries are not retried automatically
  expect(sent).toEqual(['p1', 'p2']);
});

test('transient errors keep the order with backoff and stop the flush', async () => {
  let t = 1_000;
  const storage = memoryStorage();
  const q = createCustomerOrderQueue({ storage, key: KEY, now: () => t, backoffMs: () => 10_000, send: async () => { throw httpErr(503); } });
  await q.enqueue('h1', '1', order(1));
  await q.flush();
  const [e] = await q.list();
  expect(e.status).toBe('pending');
  expect(e.attempts).toBe(1);
  expect(e.nextAttemptAt).toBe(11_000);
});

test('app restart: a new queue over the same storage resumes with the same offlineId', async () => {
  const storage = memoryStorage();
  const sent: string[] = [];
  const q1 = createCustomerOrderQueue({ storage, key: KEY, backoffMs: () => 0, send: async () => { throw new Error('Server unreachable. Check Wi-Fi and server.'); } });
  const id = await q1.enqueue('h1', '1', order(1));
  await q1.flush();
  const q2 = createCustomerOrderQueue({ storage, key: KEY, send: async (o: any) => { sent.push(o.offlineId); } });
  await q2.flush();
  expect(sent).toEqual([id]);
  expect(await q2.list()).toHaveLength(0);
});

test('legacy entries (old shape, no offlineId) get one persisted before the first send', async () => {
  const storage = memoryStorage();
  storage.data.set(KEY, JSON.stringify([{ id: 'local_1_abc', hotelId: 'h1', localToken: '7', orderData: order(9), queuedAt: 1 }]));
  const sent: string[] = [];
  const q = createCustomerOrderQueue({ storage, key: KEY, backoffMs: () => 0,
    send: async (o: any) => { sent.push(o.offlineId); if (sent.length === 1) throw new Error('Request timed out. Check your connection.'); } });
  await q.flush();
  await q.flush();
  expect(sent).toEqual(['local_1_abc', 'local_1_abc']);
});
