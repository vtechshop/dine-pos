import { AppState } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import {
  getPendingOrders, markSyncing, markSynced, markFailed,
  getPendingCount, resetSyncingOrders, pruneOldSyncedOrders,
  QueuedOrder,
} from '../database/orderQueueDao';
import {
  saveProducts, saveCategories, saveTables, saveLocalSettings,
  saveCustomers, setSyncMeta, getSyncMeta, updateLocalProductStock,
} from '../database/localCacheDao';
import * as api from '../services/api';
import { flushCustomerOrderQueue } from '../services/api';
import {
  nextQueued,
  claimForSync,
  markSynced as cashierMarkSynced,
  markRetry,
  markFailed as cashierMarkFailed,
  markAuthBlocked,
  nextDueAt,
  resetStaleSyncing,
  pruneSynced,
  backoffDelayMs,
  MAX_RETRIES,
} from '../database/cashierOrderQueueDao';
import { getAuthCache } from '../database/authDao';
import { registerAuthReadyHandler } from '../utils/authEvents';
import { classifyError, submitCashierBill } from './offlineRules';

export type SyncStatus = 'offline' | 'online' | 'syncing' | 'synced' | 'error';
export type SyncListener = (status: SyncStatus, pendingCount: number, lastSyncAt: Date | null, error?: string) => void;

// ── Internal state ─────────────────────────────────────────────────────────────

let _isConnected  = false;
let _isSyncing    = false;
let _lastSyncAt:  Date | null = null;
let _lastError:   string | null = null;
let _syncedTimer: ReturnType<typeof setTimeout> | null = null;
const _listeners  = new Set<SyncListener>();

// ── Listener management ────────────────────────────────────────────────────────

export const addSyncListener = (listener: SyncListener): (() => void) => {
  _listeners.add(listener);
  notifyListeners(deriveStatus()); // emit current state immediately
  return () => _listeners.delete(listener);
};

const notifyListeners = (status: SyncStatus): void => {
  const count = getPendingCount();
  _listeners.forEach(l => l(status, count, _lastSyncAt, _lastError ?? undefined));
};

const deriveStatus = (): SyncStatus => {
  if (_isSyncing)                          return 'syncing';
  if (!_isConnected)                       return 'offline';
  if (_lastError && getPendingCount() > 0) return 'error';
  return 'online';
};

// ── Error classification ──────────────────────────────────────────────────────

// Error classification lives in ./offlineRules.ts (pure, unit-tested).

// ── Per-order sync — idempotent via offlineId ─────────────────────────────────

const SYNC_CONCURRENCY = 3; // parallel API calls per batch

const syncOneOrder = async (item: QueuedOrder): Promise<{ synced: boolean; error?: string }> => {
  markSyncing(item.id);
  try {
    const payload = { ...(item.payload as object), offlineId: item.id };
    const result  = await api.createOrder(payload as any) as any;
    markSynced(item.id);

    if (Array.isArray(result.stockUpdates)) {
      for (const { productId, newStock } of result.stockUpdates as { productId: string; newStock: number }[]) {
        updateLocalProductStock(productId, newStock);
      }
    }
    return { synced: true };
  } catch (err: any) {
    const errMsg = err?.message || 'Network error';
    markFailed(item.id, errMsg, item.retries);
    return { synced: false, error: errMsg };
  }
};

// ── Core sync ──────────────────────────────────────────────────────────────────

export const syncNow = async (): Promise<{ synced: number; failed: number }> => {
  if (_isSyncing) return { synced: 0, failed: 0 };

  _isSyncing = true;
  _lastError = null;
  notifyListeners('syncing');

  let synced = 0;
  let failed = 0;

  try {
    // 1. Flush offline order queue → server (batched, 3 concurrent per batch)
    const pending = getPendingOrders();
    for (let i = 0; i < pending.length; i += SYNC_CONCURRENCY) {
      const batch   = pending.slice(i, i + SYNC_CONCURRENCY);
      const results = await Promise.all(batch.map(syncOneOrder));
      for (const r of results) {
        if (r.synced) { synced++; } else { failed++; _lastError = r.error ?? null; }
      }
    }

    // 2. Flush cashier offline queue (FIFO, with backoff + afterCreate)
    await _flushCashierQueue();
    await flushCustomerOrderQueue().catch(() => {});

    // 3. Pull fresh data → local SQLite cache
    await _refreshCache();

    _lastSyncAt = new Date();
    setSyncMeta('last_sync', _lastSyncAt.toISOString());

    _isSyncing = false;
    notifyListeners('synced');

    if (_syncedTimer) clearTimeout(_syncedTimer);
    _syncedTimer = setTimeout(() => notifyListeners(deriveStatus()), 3000);
  } catch (err: any) {
    _lastError = err?.message || 'Sync failed';
    _isSyncing = false;
    notifyListeners('error');
    // Auto-retry after 60 s — recovers from transient 401s (token refresh races)
    // without requiring manual tap or network reconnect.
    if (_syncedTimer) clearTimeout(_syncedTimer);
    _syncedTimer = setTimeout(() => {
      if (_isConnected && !_isSyncing) syncNow();
    }, 60_000);
  }

  return { synced, failed };
};

// ── Cache refresh ──────────────────────────────────────────────────────────────

const _refreshCache = async (): Promise<void> => {
  // Guard: never save products under hotelId='' — that corrupts the cache and causes
  // the Offline Alert in BillingScreen (subsequent lookups use the real hotelId).
  const hotelId = getAuthCache()?.hotelId;
  if (!hotelId) return;
  // Use 55s timeout — same as /auth/refresh — so a Render cold start (~50s) doesn't
  // abort the sync and leave the cache stale until the next 60s retry.
  const T = 55_000;
  const results = await Promise.allSettled([
    api.getProducts(undefined, undefined, T).then(prods => saveProducts(hotelId, prods)),   // [0] critical
    api.getCategories(T).then(cats => saveCategories(hotelId, cats)),                       // [1] critical
    api.getTables(T).then(saveTables),                                                       // [2] best-effort
    api.getSettings(T).then(saveLocalSettings),                                             // [3] best-effort
    api.getCustomers(undefined, T).then(cs => saveCustomers(cs.customers ?? cs)),           // [4] best-effort
  ]);

  // Only abort sync if the core menu data (products or categories) failed.
  // Settings / customers / tables failures are non-fatal — menu still works.
  const productsFailed  = results[0].status === 'rejected';
  const categoriesFailed = results[1].status === 'rejected';
  if (productsFailed || categoriesFailed) {
    const err = (results[0].status === 'rejected' ? results[0] : results[1]) as PromiseRejectedResult;
    throw new Error(err.reason?.message || 'Menu data unavailable');
  }
};

export const refreshCache = _refreshCache;

// ── Cashier offline-queue flush (FIFO + backoff + afterCreate) ─────────────────
// Orders queued via BillingScreen while offline are stored in cashier_order_queue.
// Strict FIFO: the oldest pending order is attempted first; a backoff hold stops
// the entire queue behind it. The server's offlineId unique index prevents
// duplicates if a request completed before a crash.

let _cashierFlushing = false;

const _flushCashierQueue = async (): Promise<void> => {
  if (_cashierFlushing) return;
  _cashierFlushing = true;

  const hotelId = getAuthCache()?.hotelId;
  if (!hotelId) { _cashierFlushing = false; return; }

  try {
    resetStaleSyncing(hotelId);

    for (let guard = 0; guard < 10_000; guard++) {
      const now  = Date.now();
      const next = nextQueued(hotelId, now);
      if (!next) break;

      // FIFO: if the oldest order is in backoff, the whole queue waits.
      if (next.nextAttemptAt !== null && next.nextAttemptAt > now) break;

      const claimed = claimForSync(hotelId, next.offlineId);
      if (!claimed) continue;

      // Synced ONLY when the order exists on the server AND every follow-up step
      // (served, completed) succeeded. Same offlineId on every attempt → no
      // duplicate order; steps already done on the server are skipped.
      // Completion uses the admin JWT (same token as createOrder) — the old
      // cashier-token call failed with 401 and was swallowed.
      const outcome = await submitCashierBill(
        {
          offlineId:   next.offlineId,
          payload:     next.payload as Record<string, unknown>,
          afterCreate: next.afterCreate,
          serverId:    next.serverId,
        },
        {
          createOrder: (p) => api.createOrder(p as any, { background: true }) as any,
          markServed:  (id) => api.updateOrderStatus(id, 'served', { background: true }),
          complete:    (id, pm) => api.completeOrderWithDetails(id, pm, undefined, { background: true }),
        },
      );

      if (outcome.kind === 'synced') {
        cashierMarkSynced(hotelId, next.offlineId, outcome.serverId, outcome.orderNumber);
        continue;
      }
      if (outcome.kind === 'permanent') {
        // Refused by the server — keep it visible as failed (with serverId if the
        // order exists) and move on; one bad bill must not block the others.
        cashierMarkFailed(hotelId, next.offlineId, outcome.reason, outcome.code, outcome.serverId);
        continue;
      }
      if (outcome.kind === 'auth') {
        // Login needed: keep pending, do not burn a retry, stop until re-login.
        markAuthBlocked(hotelId, next.offlineId, outcome.reason, outcome.code, outcome.serverId);
        break;
      }
      const newRetryCount = next.retryCount + 1;
      if (newRetryCount >= MAX_RETRIES) {
        cashierMarkFailed(hotelId, next.offlineId, outcome.reason, outcome.code, outcome.serverId);
      } else {
        markRetry(hotelId, next.offlineId, outcome.reason, outcome.code,
          Date.now() + backoffDelayMs(newRetryCount), outcome.serverId);
      }
      break; // transient: stop and retry later
    }

    pruneSynced(hotelId);
    _scheduleCashierRetry(hotelId);
  } finally {
    _cashierFlushing = false;
  }
};

// Wake up again when the earliest backoff expires (previously nothing re-ran the
// flush until a network change or manual sync).
let _cashierRetryTimer: ReturnType<typeof setTimeout> | null = null;
function _scheduleCashierRetry(hotelId: string): void {
  const due = nextDueAt(hotelId);
  if (due === null) return;
  if (_cashierRetryTimer) clearTimeout(_cashierRetryTimer);
  _cashierRetryTimer = setTimeout(() => {
    _cashierRetryTimer = null;
    if (_isConnected) _flushCashierQueue().catch(() => {});
  }, Math.max(1_000, due - Date.now()));
}

export const flushCashierOrderQueue = _flushCashierQueue;

// ── Daily maintenance ─────────────────────────────────────────────────────────

const _maybePrune = (): void => {
  const lastPrune = getSyncMeta('last_prune');
  if (lastPrune) {
    const age = Date.now() - new Date(lastPrune).getTime();
    if (age < 86_400_000) return;
  }
  pruneOldSyncedOrders(7);
  setSyncMeta('last_prune', new Date().toISOString());
};

// ── NetInfo + AppState listeners ───────────────────────────────────────────────

let _netUnsubscribe: (() => void) | null = null;
let _appStateUnsub: { remove: () => void } | null = null;

export const startSyncEngine = (): void => {
  if (_netUnsubscribe) {
    _netUnsubscribe();
    _netUnsubscribe = null;
  }
  _appStateUnsub?.remove();

  // After auth is confirmed (login or session refresh), run a fresh sync so the
  // cache is always up-to-date and any pre-auth sync attempt (which skips saving
  // to SQLite when hotelId is empty) is completed properly.
  registerAuthReadyHandler(() => {
    if (_isConnected && !_isSyncing) {
      _lastError = null;
      syncNow();
    }
  });
  // Retry on foreground: Android can kill setTimeout in the background, so a
  // stale error after a 60s retry that never fired is cleared when user returns.
  _appStateUnsub = AppState.addEventListener('change', (next) => {
    if (next === 'active' && _isConnected && _lastError && !_isSyncing) {
      syncNow();
    }
  });

  const stored = getSyncMeta('last_sync');
  if (stored) _lastSyncAt = new Date(stored);

  // Crash recovery: order_queue rows left in 'syncing' from a previous session.
  resetSyncingOrders();

  _maybePrune();

  _netUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasConnected = _isConnected;
    _isConnected = !!(state.isConnected && state.isInternetReachable !== false);

    if (!wasConnected && _isConnected) {
      // Random jitter 0–30 s prevents all devices hammering the server at once.
      const jitterMs = Math.floor(Math.random() * 30_000);
      setTimeout(() => syncNow(), jitterMs);
      flushCustomerOrderQueue().catch(() => {});
      _flushCashierQueue().catch(() => {});
    } else if (!_isConnected) {
      _lastError = null;
      notifyListeners('offline');
    } else {
      notifyListeners(deriveStatus());
    }
  });

  NetInfo.fetch().then((state: NetInfoState) => {
    _isConnected = !!(state.isConnected && state.isInternetReachable !== false);
    notifyListeners(deriveStatus());
    if (_isConnected && getPendingCount() > 0) syncNow();
    if (_isConnected) flushCustomerOrderQueue().catch(() => {});
    if (_isConnected) _flushCashierQueue().catch(() => {});
  });
};

export const stopSyncEngine = (): void => {
  _netUnsubscribe?.();
  _netUnsubscribe = null;
  _appStateUnsub?.remove();
  _appStateUnsub = null;
  if (_syncedTimer) clearTimeout(_syncedTimer);
};

export const isConnected = (): boolean => _isConnected;
