import React, {
  createContext, useContext, useState, useEffect, useCallback, ReactNode,
} from 'react';
import {
  addSyncListener, syncNow, startSyncEngine, stopSyncEngine,
  SyncStatus, refreshCache,
} from '../sync/syncEngine';
import { getPendingCount, getFailedCount, resetFailedOrders } from '../database/orderQueueDao';

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
  const [status, setStatus]           = useState<SyncStatus>('offline');
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount]  = useState(0);
  const [lastSyncAt, setLastSyncAt]   = useState<Date | null>(null);
  const [syncError, setSyncError]     = useState<string | undefined>();

  useEffect(() => {
    startSyncEngine();

    const unsub = addSyncListener((s, pending, last, err) => {
      setStatus(s);
      setPendingCount(pending);
      setLastSyncAt(last);
      setSyncError(err);
      setFailedCount(getFailedCount());
    });

    return () => {
      unsub();
      stopSyncEngine();
    };
  }, []);

  const triggerSync = useCallback(async () => {
    await syncNow();
    setFailedCount(getFailedCount());
  }, []);

  const resetFailed = useCallback(() => {
    resetFailedOrders();
    setFailedCount(0);
    setPendingCount(getPendingCount());
    triggerSync();
  }, [triggerSync]);

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
