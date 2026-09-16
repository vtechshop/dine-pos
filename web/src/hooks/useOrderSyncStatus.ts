import { useCallback, useEffect, useState } from 'react';
import { getQueueSummary, requeueFailed, subscribeQueue, type QueueSummary } from '../utils/offlineQueue';
import { getLastSyncResult, isSyncing, startAutoSync, subscribeSync, syncNow, type SyncRunResult } from '../sync/syncEngine';

/**
 * The offline bill queue for the signed-in hotel: what is waiting, what failed and why, and a
 * Sync Now that goes through the engine's single global lock.
 */
export function useOrderSyncStatus(hotelId: string | null) {
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncRunResult | null>(null);

  const refresh = useCallback(async () => {
    setSyncing(isSyncing());
    setLastResult(getLastSyncResult());
    if (!hotelId) { setSummary(null); return; }
    try {
      setSummary(await getQueueSummary(hotelId));
    } catch {
      /* IndexedDB unavailable (private mode) — the banner simply shows no queue */
    }
  }, [hotelId]);

  useEffect(() => {
    void refresh();
    const offQueue = subscribeQueue(() => { void refresh(); });
    const offSync = subscribeSync(() => { void refresh(); });
    return () => { offQueue(); offSync(); };
  }, [refresh]);

  // One auto-sync per signed-in hotel; logging out or switching hotel stops it.
  useEffect(() => {
    if (!hotelId) return;
    return startAutoSync(hotelId);
  }, [hotelId]);

  // Sync when the user returns to the tab or window — catches bills queued while hidden.
  useEffect(() => {
    if (!hotelId) return;
    const onVisible = () => { if (!document.hidden) void syncNow(hotelId); };
    const onFocus   = () => void syncNow(hotelId);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [hotelId]);

  const syncNowManual = useCallback(() => {
    if (hotelId) void syncNow(hotelId, { manual: true });
  }, [hotelId]);

  const retryFailed = useCallback(async (offlineId: string) => {
    if (!hotelId) return;
    await requeueFailed(hotelId, offlineId);
    void syncNow(hotelId, { manual: true });
  }, [hotelId]);

  return { summary, syncing, lastResult, syncNow: syncNowManual, retryFailed };
}
