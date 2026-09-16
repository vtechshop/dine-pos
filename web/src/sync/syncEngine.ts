// Web order sync engine (Offline Sprint 2).
//
// Sends bills saved in the IndexedDB queue to the EXISTING order API, one at a time, oldest
// first. The server stays authoritative for price, tax and stock; this file sends the saved
// payload and records what the server answered.
//
//   - ONE active sync: every trigger (reconnect, online event, timer, Sync Now) shares a
//     module-level promise, and across tabs the Web Locks API serialises them.
//   - IDEMPOTENT: every attempt carries the record's offlineId. The backend returns the order
//     it already saved for that id, so a lost response can never create a second order.
//   - BOUNDED RETRY: network and 5xx failures back off 5s → 15s → 45s → 2m → 5m (max).
//     A business refusal (validation, stock, permissions) becomes `sync_failed` with the reason
//     and is not resubmitted until a person asks.
//   - RECOVERY: a record left `syncing` by a crash or a closed tab is put back in the queue.
//
// It prints nothing and emits no realtime events: the backend's normal order-created flow
// (new_order, KDS, KOT, PrintJob) runs once, when the order is created on the server.

import { ApiError } from '../api/client';
import {
  completeOrder,
  createOrder,
  updateOrderStatus,
  type CashierOrderItem,
  type CreateOrderPayload,
} from '../api/orders';
import {
  STALE_SYNCING_MS,
  claimForSync,
  markFailed,
  markRetry,
  markSynced,
  migrateLegacyQueue,
  nextQueued,
  nextWakeAt,
  pruneSynced,
  recoverStaleSyncing,
  subscribeQueue,
  type PendingOrderRecord,
  type SyncErrorInfo,
} from '../utils/offlineQueue';

// ── Backoff ──────────────────────────────────────────────────────────────────

export const BACKOFF_SCHEDULE_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

/** Delay before retry attempt `attempt` (1-based). Capped at 5 minutes. */
export function backoffDelayMs(attempt: number): number {
  const index = Math.min(Math.max(Math.trunc(attempt), 1), BACKOFF_SCHEDULE_MS.length) - 1;
  return BACKOFF_SCHEDULE_MS[index];
}

// ── Error classification ─────────────────────────────────────────────────────

export type SyncErrorKind = 'retryable' | 'auth' | 'permanent';

export interface ClassifiedSyncError extends SyncErrorInfo {
  kind: SyncErrorKind;
}

const INTERNAL_DETAIL = /E11000|mongo|ObjectId|Cast to|stack|\bat \S+ \(|ECONN|ValidationError:/i;

/** A reason a cashier can read: the server's own sentence, never a stack or database detail. */
function readableReason(message: string | undefined, fallback: string): string {
  const firstLine = String(message ?? '').split('\n')[0].trim();
  if (!firstLine || INTERNAL_DETAIL.test(firstLine) || /^HTTP \d{3}$/.test(firstLine)) return fallback;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}

export function classifySyncError(error: unknown): ClassifiedSyncError {
  if (error instanceof ApiError) {
    const status = error.status;
    if (status === 401) {
      return { kind: 'auth', code: 'auth_required', reason: 'Login required to send saved bills.' };
    }
    if (status === 403 && (error.code === 'TRIAL_EXPIRED' || error.code === 'PLAN_EXPIRED')) {
      return { kind: 'auth', code: 'subscription_expired', reason: 'Subscription has expired. Renew it to send saved bills.' };
    }
    if (status === 408 || status === 425 || status === 429 || status >= 500) {
      return { kind: 'retryable', code: `http_${status}`, reason: 'Server is temporarily unavailable. Will retry.' };
    }
    if (status === 403) {
      return { kind: 'permanent', code: 'forbidden', reason: readableReason(error.message, 'This login is not allowed to place this bill.') };
    }
    return {
      kind: 'permanent',
      code: error.code ? String(error.code).toLowerCase() : `http_${status}`,
      reason: readableReason(error.message, 'The server refused this bill.'),
    };
  }

  const name = (error as { name?: string } | null)?.name;
  const message = String((error as { message?: string } | null)?.message ?? error ?? '');
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { kind: 'retryable', code: 'timeout', reason: 'The server took too long to answer. Will retry.' };
  }
  if (error instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed|network|offline/i.test(message)) {
    return { kind: 'retryable', code: 'network', reason: 'No connection to the server. Will retry.' };
  }
  // Not a refusal from the server, so it is not evidence the bill is invalid. Retried, with backoff.
  return { kind: 'retryable', code: 'unknown', reason: 'Could not send this bill. Will retry.' };
}

// ── Dependencies (injectable for tests) ──────────────────────────────────────

type LockRequest = <T>(
  name: string,
  options: { ifAvailable: boolean },
  callback: (lock: unknown) => Promise<T>,
) => Promise<T>;

export interface SyncEngineDeps {
  createOrder: (payload: CreateOrderPayload) => Promise<CashierOrderItem>;
  updateOrderStatus: (orderId: string, status: string) => Promise<void>;
  completeOrder: (orderId: string) => Promise<void>;
  now: () => number;
  /** The hotel the CURRENT session belongs to. A run for any other hotel stops. */
  currentHotelId: () => string | null;
  /** Cross-tab lock (Web Locks API). Null where unavailable. */
  locks: { request: LockRequest } | null;
}

function browserLocks(): SyncEngineDeps['locks'] {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: { request: LockRequest } });
  return nav?.locks ? { request: nav.locks.request.bind(nav.locks) as LockRequest } : null;
}

function defaultDeps(): SyncEngineDeps {
  return {
    createOrder,
    updateOrderStatus: (orderId, status) => updateOrderStatus(orderId, status),
    completeOrder,
    now: () => Date.now(),
    currentHotelId: () => (typeof localStorage === 'undefined' ? null : localStorage.getItem('pos_hotel_id')),
    locks: browserLocks(),
  };
}

let deps: SyncEngineDeps = defaultDeps();

export function configureSyncEngine(overrides: Partial<SyncEngineDeps>): void {
  deps = { ...deps, ...overrides };
}

// ── Run state ────────────────────────────────────────────────────────────────

export type SyncStopReason =
  | 'done'
  | 'waiting_backoff'
  | 'retry_later'
  | 'login_required'
  | 'hotel_changed'
  | 'no_hotel'
  | 'locked_elsewhere'
  | 'error';

export interface SyncRunResult {
  hotelId: string | null;
  attempted: number;
  synced: number;
  failed: number;
  retried: number;
  stopReason: SyncStopReason;
  finishedAt: string;
}

let active: Promise<SyncRunResult> | null = null;
let lastResult: SyncRunResult | null = null;
const syncListeners = new Set<() => void>();

export function subscribeSync(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => { syncListeners.delete(listener); };
}

function notifySyncListeners(): void {
  syncListeners.forEach(listener => {
    try { listener(); } catch { /* ignore */ }
  });
}

export function isSyncing(): boolean {
  return active !== null;
}

export function getLastSyncResult(): SyncRunResult | null {
  return lastResult;
}

function emptyResult(hotelId: string | null, stopReason: SyncStopReason): SyncRunResult {
  return {
    hotelId, attempted: 0, synced: 0, failed: 0, retried: 0, stopReason,
    finishedAt: new Date(deps.now()).toISOString(),
  };
}

/**
 * Starts a sync for `hotelId`, or returns the sync already running. Calling it three times at
 * once produces ONE loop. `manual` (Sync Now) ignores the backoff wait; it never bypasses the lock.
 */
export function syncNow(hotelId: string | null | undefined, options: { manual?: boolean } = {}): Promise<SyncRunResult> {
  if (active) return active;
  if (!hotelId) return Promise.resolve(emptyResult(null, 'no_hotel'));

  const manual = options.manual === true;
  const run = Promise.resolve().then(async (): Promise<SyncRunResult> => {
    try {
      const outcome = deps.locks
        ? await deps.locks.request('dinepos-order-sync', { ifAvailable: true }, async lock =>
            lock ? runPass(hotelId, manual, true) : emptyResult(hotelId, 'locked_elsewhere'))
        : await runPass(hotelId, manual, false);
      lastResult = outcome;
      return outcome;
    } catch {
      lastResult = emptyResult(hotelId, 'error');
      return lastResult;
    } finally {
      active = null;
      notifySyncListeners();
    }
  });
  active = run;
  notifySyncListeners();
  return run;
}

async function runPass(hotelId: string, manual: boolean, exclusive: boolean): Promise<SyncRunResult> {
  const result = emptyResult(hotelId, 'done');
  if (deps.currentHotelId() !== hotelId) return { ...result, stopReason: 'hotel_changed' };

  // Holding the cross-tab lock proves no other tab is sending, so every `syncing` record is
  // stale. Without the lock, only a record older than the request timeout is treated as stale.
  await recoverStaleSyncing(hotelId, deps.now(), exclusive ? 0 : STALE_SYNCING_MS);

  for (let guard = 0; guard < 10_000; guard += 1) {
    const next = await nextQueued(hotelId);
    if (!next) break;

    const now = deps.now();
    // Strict FIFO: a bill waiting out its backoff holds back the bills behind it.
    if (!manual && next.nextAttemptAt !== null && next.nextAttemptAt > now) {
      result.stopReason = 'waiting_backoff';
      break;
    }
    // A logout or another hotel's login between two bills stops the run before anything is sent.
    if (deps.currentHotelId() !== hotelId) {
      result.stopReason = 'hotel_changed';
      break;
    }

    const claimed = await claimForSync(hotelId, next.offlineId, now);
    if (!claimed) continue;
    result.attempted += 1;

    const outcome = await submit(claimed);
    const at = deps.now();

    if (outcome.kind === 'synced') {
      await markSynced(hotelId, claimed.offlineId, outcome.order, at);
      result.synced += 1;
      continue;
    }
    if (outcome.kind === 'permanent') {
      await markFailed(hotelId, claimed.offlineId, outcome.error, outcome.serverId);
      result.failed += 1;
      continue;
    }
    await markRetry(hotelId, claimed.offlineId, outcome.error, at + backoffDelayMs(claimed.retryCount + 1), outcome.serverId);
    result.retried += 1;
    result.stopReason = outcome.kind === 'auth' ? 'login_required' : 'retry_later';
    break;
  }

  await pruneSynced(hotelId, deps.now());
  return { ...result, finishedAt: new Date(deps.now()).toISOString() };
}

type SubmitOutcome =
  | { kind: 'synced'; order: { id: string; orderNumber: string | null } }
  | { kind: SyncErrorKind; error: SyncErrorInfo; serverId: string | null };

const CLOSED_OR_SERVED = ['served', 'ready', 'completed'];

async function submit(record: PendingOrderRecord): Promise<SubmitOutcome> {
  let order: CashierOrderItem;
  try {
    // The saved payload, with the SAME offlineId on every attempt. No totals, no stock.
    order = await deps.createOrder({ ...record.payload, offlineId: record.offlineId });
  } catch (error) {
    const failure = classifySyncError(error);
    return { kind: failure.kind, error: failure, serverId: record.serverId };
  }

  // From here the order exists on the server exactly once (new, or returned for this offlineId).
  const serverId = String(order._id);
  try {
    let status = order.status;
    if (record.afterCreate.markServed && !CLOSED_OR_SERVED.includes(status)) {
      try {
        await deps.updateOrderStatus(serverId, 'served');
        status = 'served';
      } catch (error) {
        // A cashier login may not mark an order served, but the backend lets a takeaway be
        // completed straight from pending — the step the online flow needs anyway.
        if (!(error instanceof ApiError && error.status === 403 && order.orderSource === 'takeaway')) throw error;
      }
    }
    // Completing an order that is already completed is skipped: a retry must not close it twice.
    if (record.afterCreate.complete && status !== 'completed') {
      await deps.completeOrder(serverId);
    }
  } catch (error) {
    const failure = classifySyncError(error);
    return {
      kind: failure.kind,
      serverId,
      error: {
        code: failure.code,
        reason: failure.kind === 'permanent'
          ? `Bill saved on the server but could not be closed: ${failure.reason}`
          : failure.reason,
      },
    };
  }

  return { kind: 'synced', order: { id: serverId, orderNumber: order.orderNumber ?? null } };
}

// ── Automatic sync ───────────────────────────────────────────────────────────

/**
 * Keeps one hotel's queue moving: migrates the old localStorage queue once, syncs now, syncs
 * on the browser `online` event and whenever a bill is queued, and wakes again when the
 * earliest backoff expires. Returns a stop function (call it on logout or hotel change).
 */
export function startAutoSync(hotelId: string): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = async () => {
    clearTimer();
    if (stopped) return;
    const due = await nextWakeAt(hotelId, deps.now()).catch(() => null);
    if (stopped || due === null) return;
    timer = setTimeout(() => { void wake(); }, Math.max(1_000, due - deps.now()));
  };

  const wake = async () => {
    if (stopped) return;
    const outcome = await syncNow(hotelId);
    if (outcome.stopReason === 'hotel_changed' || outcome.stopReason === 'no_hotel') return;
    await schedule();
  };

  const onOnline = () => { void wake(); };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  const unsubscribe = subscribeQueue(() => { if (!active) void schedule(); });

  void (async () => {
    await migrateLegacyQueue().catch(() => undefined);
    await wake();
  })();

  return () => {
    stopped = true;
    clearTimer();
    unsubscribe();
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  };
}

export function resetSyncEngineForTesting(): void {
  active = null;
  lastResult = null;
  syncListeners.clear();
  deps = defaultDeps();
}
