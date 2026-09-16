import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CloudOff, Zap, AlertTriangle, CheckCircle2, LogIn, AlertCircle } from 'lucide-react';
import type { QueueSummary } from '../../utils/offlineQueue';
import { useConnectivity } from '../../hooks/useConnectivity';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectivityStatus = 'online' | 'socket_only' | 'offline' | 'degraded';

interface OfflineBannerProps {
  socketConnected: boolean;
  summary: QueueSummary | null;
  syncing?: boolean;
  onSyncNow?: () => void;
  onRetryFailed?: (offlineId: string) => void;
}

// ── Hook: browser-level online/offline tracking (kept for backward compat) ────

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
  const connectivity = useConnectivity();
  if (connectivity === 'OFFLINE') return 'offline';
  if (connectivity === 'DEGRADED') return 'degraded';
  // ONLINE or CHECKING — treat CHECKING as online optimistically
  if (!socketConnected) return 'socket_only';
  return 'online';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RECENT_SYNC_MS = 10 * 60_000;

function bills(n: number): string {
  return `${n} bill${n === 1 ? '' : 's'}`;
}

function timeOf(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function SyncButton({ onClick, syncing, tone }: { onClick?: () => void; syncing?: boolean; tone: string }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={syncing}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60 ${tone}`}
    >
      <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
      {syncing ? 'Syncing…' : 'Sync now'}
    </button>
  );
}

// ── Banner ─────────────────────────────────────────────────────────────────────

export function OfflineBanner({
  socketConnected,
  summary,
  syncing,
  onSyncNow,
  onRetryFailed,
}: OfflineBannerProps) {
  const status = useConnectivityStatus(socketConnected);
  const [showDetails, setShowDetails] = useState(false);

  const pending = summary?.pending ?? 0;
  const failed = summary?.failed ?? 0;
  const lastSyncedAt = summary?.lastSyncedAt ?? null;
  const recentlySynced = !!lastSyncedAt && Date.now() - new Date(lastSyncedAt).getTime() < RECENT_SYNC_MS;

  if (status === 'online' && pending === 0 && failed === 0 && !recentlySynced) return null;

  const details = showDetails && summary && (summary.failedOrders.length > 0 || summary.waitingOrders.length > 0) && (
    <div className="mt-2 space-y-1.5 border-t border-black/5 pt-2">
      <p className="text-[10px] text-ink/50">
        Oldest waiting: {timeOf(summary.oldestQueuedAt)} · Last synced: {timeOf(lastSyncedAt)}
      </p>
      {summary.failedOrders.map(order => (
        <div key={order.offlineId} className="flex items-start gap-2 rounded-lg bg-white/70 px-2.5 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-ink">
              {order.label} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'} · saved {timeOf(order.queuedAt)}
            </p>
            <p className="text-[10px] text-red-600">{order.reason ?? 'Could not be sent.'}</p>
          </div>
          {onRetryFailed && (
            <button
              type="button"
              onClick={() => onRetryFailed(order.offlineId)}
              disabled={syncing}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-ink/70 hover:bg-mist disabled:opacity-60"
            >
              Retry
            </button>
          )}
        </div>
      ))}
      {summary.waitingOrders.map(order => (
        <p key={order.offlineId} className="px-2.5 text-[10px] text-ink/60">
          {order.label} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'} · saved {timeOf(order.queuedAt)}
          {order.reason ? ` · ${order.reason}` : ''}
        </p>
      ))}
    </div>
  );

  const detailsToggle = summary && (summary.failedOrders.length > 0 || summary.waitingOrders.length > 0) && (
    <button
      type="button"
      onClick={() => setShowDetails(v => !v)}
      className="shrink-0 text-[11px] font-semibold underline-offset-2 hover:underline"
    >
      {showDetails ? 'Hide' : 'Details'}
    </button>
  );

  // Offline — bills are being saved on this device.
  if (status === 'degraded') {
    return (
      <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <AlertCircle size={16} className="shrink-0 text-orange-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-orange-700">Server Unreachable</p>
            <p className="mt-0.5 text-[10px] text-orange-600/80">
              {pending > 0
                ? `${bills(pending)} saved on this device. Will sync when the server recovers.`
                : 'Backend is not responding. Cash bills will be saved and sent when it recovers.'}
              {failed > 0 && ` ${bills(failed)} need${failed === 1 ? 's' : ''} attention.`}
            </p>
          </div>
          {detailsToggle}
          <SyncButton onClick={onSyncNow} syncing={syncing} tone="border-orange-200 bg-orange-100 text-orange-700 hover:bg-orange-200" />
        </div>
        {details}
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <WifiOff size={16} className="shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-red-700">Offline</p>
            <p className="mt-0.5 text-[10px] text-red-600/80">
              {pending > 0
                ? `${bills(pending)} waiting to sync. They will be sent automatically when the connection returns.`
                : 'Cash bills will be saved on this device and sent when the connection returns.'}
              {failed > 0 && ` ${bills(failed)} need${failed === 1 ? 's' : ''} attention.`}
            </p>
          </div>
          {detailsToggle}
        </div>
        {details}
      </div>
    );
  }

  // Failed bills need a person.
  if (failed > 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <AlertTriangle size={16} className="shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-700">Sync failed</p>
            <p className="mt-0.5 text-[10px] text-amber-700/80">
              {bills(failed)} need{failed === 1 ? 's' : ''} attention
              {pending > 0 && ` · ${bills(pending)} waiting to sync`}
            </p>
          </div>
          {detailsToggle}
          <SyncButton onClick={onSyncNow} syncing={syncing} tone="border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-200" />
        </div>
        {details}
      </div>
    );
  }

  // Waiting bills cannot be sent until someone signs in again.
  if (pending > 0 && summary?.loginRequired && !syncing) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <LogIn size={16} className="shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-700">Login required</p>
            <p className="mt-0.5 text-[10px] text-amber-700/80">
              Sign in again to send {bills(pending)} saved on this device.
            </p>
          </div>
          <SyncButton onClick={onSyncNow} syncing={syncing} tone="border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-200" />
        </div>
      </div>
    );
  }

  // Online with bills waiting or being sent.
  if (pending > 0) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex items-center gap-3">
          {syncing
            ? <RefreshCw size={16} className="shrink-0 animate-spin text-blue-500" />
            : <Zap size={16} className="shrink-0 text-blue-500" />}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-blue-700">Online</p>
            <p className="mt-0.5 text-[10px] text-blue-600/80">
              {syncing ? `Syncing ${bills(pending)}…` : `${bills(pending)} waiting to sync · oldest saved ${timeOf(summary?.oldestQueuedAt ?? null)}`}
            </p>
          </div>
          {detailsToggle}
          <SyncButton onClick={onSyncNow} syncing={syncing} tone="border-blue-200 bg-blue-100 text-blue-700 hover:bg-blue-200" />
        </div>
        {details}
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

  // Everything confirmed by the server. Shown only after a server-confirmed sync.
  if (recentlySynced) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2">
        <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
        <p className="text-[11px] font-semibold text-emerald-700">
          Sync complete <span className="font-normal text-emerald-700/80">· Last synced {timeOf(lastSyncedAt)}</span>
        </p>
      </div>
    );
  }

  return null;
}
