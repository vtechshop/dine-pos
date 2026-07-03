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

// ── Per-order sync — idempotent via offlineId ─────────────────────────────────

const SYNC_CONCURRENCY = 3; // parallel API calls per batch

const syncOneOrder = async (item: QueuedOrder): Promise<{ synced: boolean; error?: string }> => {
  // Write 'syncing' to SQLite BEFORE the API call.
  // On crash, resetSyncingOrders() (called in startSyncEngine) resets it to
  // 'pending'. The server's offlineId unique index prevents duplicate orders.
  markSyncing(item.id);

  try {
    // Attach offlineId to payload — server uses it as idempotency key.
    const payload = { ...(item.payload as object), offlineId: item.id };
    const result  = await api.createOrder(payload as any) as any;
    markSynced(item.id);

    // Apply per-order stock updates returned by server so local cache stays
    // accurate without waiting for the next full cache refresh cycle.
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
    // 1. Flush offline order queue → MongoDB (batched, 3 concurrent per batch)
    const pending = getPendingOrders();

    for (let i = 0; i < pending.length; i += SYNC_CONCURRENCY) {
      const batch   = pending.slice(i, i + SYNC_CONCURRENCY);
      const results = await Promise.all(batch.map(syncOneOrder));
      for (const r of results) {
        if (r.synced) { synced++; } else { failed++; _lastError = r.error ?? null; }
      }
    }

    // 2. Pull fresh data from MongoDB → local SQLite cache
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
  const results = await Promise.allSettled([
    api.getProducts().then(saveProducts),
    api.getCategories().then(saveCategories),
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

// ── Daily maintenance ─────────────────────────────────────────────────────────

// Prune synced rows older than 7 days once per 24 h. Prevents unbounded table
// growth at 1000+ orders/day. Uses sync_meta to track when last pruned.
const _maybePrune = (): void => {
  const lastPrune = getSyncMeta('last_prune');
  if (lastPrune) {
    const age = Date.now() - new Date(lastPrune).getTime();
    if (age < 86_400_000) return; // pruned within last 24 h
  }
  pruneOldSyncedOrders(7);
  setSyncMeta('last_prune', new Date().toISOString());
};

// ── NetInfo listener ───────────────────────────────────────────────────────────

let _netUnsubscribe: (() => void) | null = null;

export const startSyncEngine = (): void => {
  // Guard against double-start (e.g. SyncProvider remounting in dev)
  if (_netUnsubscribe) {
    _netUnsubscribe();
    _netUnsubscribe = null;
  }

  // Restore last sync timestamp from SQLite
  const stored = getSyncMeta('last_sync');
  if (stored) _lastSyncAt = new Date(stored);

  // Crash recovery: any row left in 'syncing' from a previous session means
  // the app died mid-sync. Reset to 'pending' — server offlineId index handles dedup.
  resetSyncingOrders();

  // Daily pruning of old synced rows
  _maybePrune();

  _netUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasConnected = _isConnected;
    _isConnected = !!(state.isConnected && state.isInternetReachable !== false);

    if (!wasConnected && _isConnected) {
      // Random jitter 0–30 s before syncing on reconnect.
      // Prevents all ~1 000 devices across 500 hotels from hammering the server
      // simultaneously after a shared network outage (thundering herd).
      // Orders remain safely queued in SQLite — max 30 s delay is acceptable.
      const jitterMs = Math.floor(Math.random() * 30_000);
      setTimeout(() => syncNow(), jitterMs);
    } else if (!_isConnected) {
      _lastError = null;
      notifyListeners('offline');
    } else {
      notifyListeners(deriveStatus());
    }
  });

  // Probe current state (event listener misses the initial state on some devices)
  NetInfo.fetch().then((state: NetInfoState) => {
    _isConnected = !!(state.isConnected && state.isInternetReachable !== false);
    notifyListeners(deriveStatus());
    if (_isConnected && getPendingCount() > 0) syncNow();
  });
};

export const stopSyncEngine = (): void => {
  _netUnsubscribe?.();
  _netUnsubscribe = null;
  if (_syncedTimer) clearTimeout(_syncedTimer);
};

export const isConnected = (): boolean => _isConnected;
