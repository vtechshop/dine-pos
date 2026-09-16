import React, {
  createContext, useContext, useState, useEffect, useCallback, ReactNode,
} from 'react';
import {
  addSyncListener, syncNow, startSyncEngine, stopSyncEngine,
  SyncStatus, refreshCache,
} from '../sync/syncEngine';
import { getPendingCount, getFailedCount, resetFailedOrders } from '../database/orderQueueDao';
import {
  getPendingCount as getCashierPendingCount,
  getFailedCount as getCashierFailedCount,
  resetFailedOrders as resetCashierFailedOrders,
} from '../database/cashierOrderQueueDao';
import { getAuthCache } from '../database/authDao';

interface SyncContextType {
  status: SyncStatus;
  pendingCount: number;
  failedCount: number;
  lastSyncAt: Date | null;
  syncError: string | undefined;
  triggerSync: () => Promise<void>;
  resetFailed: () => void;
  refreshLocalCache: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType>({
  status: 'offline',
  pendingCount: 0,
  failedCount: 0,
  lastSyncAt: null,
  syncError: undefined,
  triggerSync: async () => {},
  resetFailed: () => {},
  refreshLocalCache: async () => {},
});

export const SyncProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus]             = useState<SyncStatus>('offline');
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount]   = useState(0);
  const [lastSyncAt, setLastSyncAt]     = useState<Date | null>(null);
  const [syncError, setSyncError]       = useState<string | undefined>();

  const refreshCounts = useCallback(() => {
    const hotelId = getAuthCache()?.hotelId ?? '';
    // Total pending = general queue + cashier queue
    const pending = getPendingCount() + (hotelId ? getCashierPendingCount(hotelId) : 0);
    const failed  = getFailedCount()  + (hotelId ? getCashierFailedCount(hotelId)  : 0);
    setPendingCount(pending);
    setFailedCount(failed);
  }, []);

  useEffect(() => {
    startSyncEngine();

    const unsub = addSyncListener((s, _pending, last, err) => {
      setStatus(s);
      setLastSyncAt(last);
      setSyncError(err);
      refreshCounts();
    });

    return () => {
      unsub();
      stopSyncEngine();
    };
  }, [refreshCounts]);

  const triggerSync = useCallback(async () => {
    await syncNow();
    refreshCounts();
  }, [refreshCounts]);

  const resetFailed = useCallback(() => {
    const hotelId = getAuthCache()?.hotelId ?? '';
    resetFailedOrders();
    if (hotelId) resetCashierFailedOrders(hotelId);
    refreshCounts();
    triggerSync();
  }, [triggerSync, refreshCounts]);

  const refreshLocalCache = useCallback(async () => {
    await refreshCache();
    setLastSyncAt(new Date());
  }, []);

  return (
    <SyncContext.Provider value={{
      status, pendingCount, failedCount, lastSyncAt,
      syncError, triggerSync, resetFailed, refreshLocalCache,
    }}>
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = (): SyncContextType => useContext(SyncContext);
