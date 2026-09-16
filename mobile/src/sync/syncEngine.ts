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
  resetStaleSyncing,
  pruneSynced,
  backoffDelayMs,
  MAX_RETRIES,
} from '../database/cashierOrderQueueDao';
import { getAuthCache } from '../database/authDao';

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

type SyncErrorKind = 'retryable' | 'auth' | 'permanent';

interface ClassifiedError {
  kind: SyncErrorKind;
  code: string;
  reason: string;
}

const INTERNAL_DETAIL = /E11000|mongo|ObjectId|Cast to|stack|\bat \S+ \(|ECONN|ValidationError:/i;

function readableReason(message: string | undefined, fallback: string): string {
  const firstLine = String(message ?? '').split('\n')[0].trim();
  if (!firstLine || INTERNAL_DETAIL.test(firstLine) || /^HTTP \d{3}$/.test(firstLine)) return fallback;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}

function classifyError(error: unknown): ClassifiedError {
  const status = (error as { status?: number })?.status;
  const name   = (error as { name?: string })?.name;
  const message = String((error as { message?: string })?.message ?? error ?? '');

  if (status === 401) {
    return { kind: 'auth', code: 'auth_required', reason: 'Login required to send saved bills.' };
  }
  if (status === 403 && /TRIAL_EXPIRED|PLAN_EXPIRED/.test(String((error as { code?: string })?.code ?? ''))) {
    return { kind: 'auth', code: 'subscription_expired', reason: 'Subscription expired. Renew to send saved bills.' };
  }
  if (status && (status === 408 || status === 425 || status === 429 || status >= 500)) {
    return { kind: 'retryable', code: `http_${status}`, reason: 'Server temporarily unavailable. Will retry.' };
  }
  if (status && status >= 400 && status < 500) {
    return {
      kind: 'permanent',
      code: `http_${status}`,
      reason: readableReason(message, 'The server refused this bill.'),
    };
  }
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { kind: 'retryable', code: 'timeout', reason: 'Server took too long to answer. Will retry.' };
  }
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|network request failed|load failed|offline/i.test(message)
  ) {
    return { kind: 'retryable', code: 'network', reason: 'No connection to server. Will retry.' };
  }
  return { kind: 'retryable', code: 'unknown', reason: 'Could not send this bill. Will retry.' };
}

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
  }

  return { synced, failed };
};

// ── Cache refresh ──────────────────────────────────────────────────────────────

const _refreshCache = async (): Promise<void> => {
  const hotelId = getAuthCache()?.hotelId ?? '';
  const results = await Promise.allSettled([
    api.getProducts().then(prods => saveProducts(hotelId, prods)),
    api.getCategories().then(cats => saveCategories(hotelId, cats)),
    api.getTables().then(saveTables),
    api.getSettings().then(saveLocalSettings),
    api.getCustomers().then(cs => saveCustomers(cs.customers ?? cs)),
  ]);

  const firstError = results.find(r => r.status === 'rejected');
  if (firstError?.status === 'rejected') {
    throw new Error(firstError.reason?.message || 'Cache refresh failed');
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

      try {
        const order = await api.createOrder({
          ...(next.payload as object),
          offlineId: next.offlineId,
        } as any) as any;

        const serverId = String(order._id);

        // afterCreate: replay the steps that would have run in the online path.
        if (next.afterCreate.markServed) {
          try { await api.updateOrderStatus(serverId, 'served'); } catch { /* best-effort */ }
        }
        if (next.afterCreate.complete) {
          try { await (api as any).markOrderCompleteCashier(serverId); } catch { /* best-effort */ }
        }

        cashierMarkSynced(hotelId, next.offlineId, serverId, order.orderNumber ?? null);
      } catch (err: unknown) {
        const { kind, code, reason } = classifyError(err);
        const newRetryCount = next.retryCount + 1;

        if (kind === 'permanent' || newRetryCount >= MAX_RETRIES) {
          cashierMarkFailed(hotelId, next.offlineId, reason, code);
        } else {
          markRetry(
            hotelId, next.offlineId, reason, code,
            Date.now() + backoffDelayMs(newRetryCount),
          );
        }

        // Auth errors stop the run entirely — no point retrying other orders.
        if (kind !== 'retryable') break;
        // For retryable errors, first order is in backoff: stop to avoid hammering.
        break;
      }
    }

    pruneSynced(hotelId);
  } finally {
    _cashierFlushing = false;
  }
};

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

// ── NetInfo listener ───────────────────────────────────────────────────────────

let _netUnsubscribe: (() => void) | null = null;

export const startSyncEngine = (): void => {
  if (_netUnsubscribe) {
    _netUnsubscribe();
    _netUnsubscribe = null;
  }

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
  if (_syncedTimer) clearTimeout(_syncedTimer);
};

export const isConnected = (): boolean => _isConnected;
