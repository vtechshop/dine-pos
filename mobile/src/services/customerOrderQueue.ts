// Kiosk / customer offline order queue — pure logic (no React Native imports).
// api.ts wires it to AsyncStorage and createPublicOrder.
//
// Guarantees:
//   • Every queued order gets a stable offlineId BEFORE its first send, reused on
//     every retry → the server (/api/public/orders offlineId idempotency) returns
//     the existing order instead of creating a duplicate (and a second KOT).
//   • All read-modify-writes of the stored queue are serialised, and only one
//     flush runs at a time → no concurrent double-send, no lost enqueues.
//   • An entry is removed only after the server accepted it (2xx).
//   • Permanent refusals (4xx except 408/425/429) become 'failed' and stop
//     retrying; transient errors back off and keep the entry.
//   • State is persisted, so a restart resumes with the same offlineIds.

import { classifyError } from '../sync/offlineRules';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type CustomerQueueStatus = 'pending' | 'failed';

export interface CustomerQueueEntry {
  id:            string;
  hotelId:       string;
  localToken:    string;
  orderData:     Record<string, unknown> & { offlineId?: string };
  queuedAt:      number;
  status:        CustomerQueueStatus;
  attempts:      number;
  nextAttemptAt: number | null;
  lastError:     string | null;
}

export interface FlushResult { sent: number; failed: number; pending: number }

const defaultBackoff = (attempt: number) => Math.min(5 * 60_000, 5_000 * 3 ** Math.max(0, attempt - 1));

export function newKioskOfflineId(now = Date.now()): string {
  // ≤ 64 chars, no whitespace (server trims/slices offlineId to 64)
  return `kq_${now}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createCustomerOrderQueue(opts: {
  storage:   KeyValueStorage;
  key:       string;
  send:      (orderData: Record<string, unknown>) => Promise<unknown>;
  now?:      () => number;
  backoffMs?: (attempt: number) => number;
}) {
  const now = opts.now ?? (() => Date.now());
  const backoffMs = opts.backoffMs ?? defaultBackoff;

  // Serialise every storage read-modify-write.
  let lock: Promise<unknown> = Promise.resolve();
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = lock.then(fn, fn);
    lock = p.catch(() => undefined);
    return p;
  };

  const read = async (): Promise<CustomerQueueEntry[]> => {
    const raw = await opts.storage.getItem(opts.key);
    const list = raw ? (JSON.parse(raw) as Partial<CustomerQueueEntry>[]) : [];
    // Normalise legacy entries (pre-fix shape had no status/attempts/offlineId).
    return list.map(e => ({
      id:            String(e.id),
      hotelId:       String(e.hotelId ?? ''),
      localToken:    String(e.localToken ?? ''),
      orderData:     (e.orderData ?? {}) as CustomerQueueEntry['orderData'],
      queuedAt:      Number(e.queuedAt ?? now()),
      status:        e.status === 'failed' ? 'failed' : 'pending',
      attempts:      Number(e.attempts ?? 0),
      nextAttemptAt: e.nextAttemptAt ?? null,
      lastError:     e.lastError ?? null,
    }));
  };
  const write = (list: CustomerQueueEntry[]) => opts.storage.setItem(opts.key, JSON.stringify(list));

  const patch = (id: string, change: Partial<CustomerQueueEntry> | null) => withLock(async () => {
    const list = await read();
    const next = change === null ? list.filter(e => e.id !== id) : list.map(e => (e.id === id ? { ...e, ...change } : e));
    await write(next);
  });

  async function enqueue(hotelId: string, localToken: string, orderData: Record<string, unknown>): Promise<string> {
    return withLock(async () => {
      const id = newKioskOfflineId(now());
      const list = await read();
      list.push({
        id, hotelId, localToken,
        orderData: { ...orderData, offlineId: id },
        queuedAt: now(), status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null,
      });
      await write(list);
      return id;
    });
  }

  let inFlight: Promise<FlushResult> | null = null;

  function flush(): Promise<FlushResult> {
    if (inFlight) return inFlight; // a second caller shares the running flush
    inFlight = (async () => {
      const result: FlushResult = { sent: 0, failed: 0, pending: 0 };
      try {
        const snapshot = await withLock(read);
        for (const entry of snapshot) {
          if (entry.status === 'failed') continue;
          if (entry.nextAttemptAt !== null && entry.nextAttemptAt > now()) { result.pending++; continue; }

          // Legacy entries: persist an offlineId BEFORE the first send so any
          // retry after a lost response reuses it.
          let offlineId = entry.orderData.offlineId;
          if (!offlineId) {
            offlineId = entry.id;
            await patch(entry.id, { orderData: { ...entry.orderData, offlineId } });
          }

          try {
            await opts.send({ ...entry.orderData, offlineId });
            await patch(entry.id, null);          // removed only after server acceptance
            result.sent++;
          } catch (err) {
            const c = classifyError(err);
            if (c.kind === 'permanent') {
              await patch(entry.id, { status: 'failed', lastError: c.reason });
              result.failed++;
              continue;                            // a refused order must not block the rest
            }
            const attempts = entry.attempts + 1;
            await patch(entry.id, { attempts, nextAttemptAt: now() + backoffMs(attempts), lastError: c.reason });
            result.pending++;
            break;                                 // transient: stop, retry later
          }
        }
        return result;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    enqueue,
    flush,
    list: () => withLock(read),
    /** Staff action: make failed entries eligible again (same offlineId). */
    retryFailed: () => withLock(async () => {
      const list = await read();
      await write(list.map(e => (e.status === 'failed' ? { ...e, status: 'pending' as const, nextAttemptAt: null } : e)));
    }),
  };
}
