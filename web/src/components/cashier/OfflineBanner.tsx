import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CloudOff, Zap } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectivityStatus = 'online' | 'socket_only' | 'offline';

interface OfflineBannerProps {
  socketConnected: boolean;
  queueLength: number;
  onRetrySync?: () => void;
  syncing?: boolean;
}

// ── Hook: browser-level online/offline tracking ───────────────────────────────

export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    function handleOnline()  { setOnline(true);  }
    function handleOffline() { setOnline(false); }

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}

// ── Derived connectivity status ────────────────────────────────────────────────

export function useConnectivityStatus(socketConnected: boolean): ConnectivityStatus {
  const browserOnline = useIsOnline();
  if (!browserOnline) return 'offline';
  if (!socketConnected) return 'socket_only';
  return 'online';
}

// ── Banner ─────────────────────────────────────────────────────────────────────

export function OfflineBanner({
  socketConnected,
  queueLength,
  onRetrySync,
  syncing,
}: OfflineBannerProps) {
  const status = useConnectivityStatus(socketConnected);

  if (status === 'online' && queueLength === 0) return null;

  if (status === 'offline') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <WifiOff size={16} className="shrink-0 text-red-500" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-red-700">No Internet Connection</p>
          <p className="text-[10px] text-red-600/80 mt-0.5">
            Orders will be queued and sent automatically when connection is restored.
            {queueLength > 0 && ` ${queueLength} order${queueLength !== 1 ? 's' : ''} in queue.`}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'socket_only') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <CloudOff size={16} className="shrink-0 text-amber-500" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-700">Realtime Disconnected</p>
          <p className="text-[10px] text-amber-600/80 mt-0.5">
            Internet available but live updates are paused. Refresh to reconnect.
          </p>
        </div>
      </div>
    );
  }

  // online but has queued orders waiting to sync
  if (queueLength > 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <Zap size={16} className="shrink-0 text-blue-500" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-blue-700">
            {queueLength} order{queueLength !== 1 ? 's' : ''} queued offline
          </p>
          <p className="text-[10px] text-blue-600/80 mt-0.5">
            Connection restored. Sending now…
          </p>
        </div>
        {onRetrySync && (
          <button
            type="button"
            onClick={onRetrySync}
            disabled={syncing}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-100 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-200 disabled:opacity-60"
          >
            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
            Sync now
          </button>
        )}
      </div>
    );
  }

  return null;
}
