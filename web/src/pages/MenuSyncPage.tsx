import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, ChevronDown, ChevronUp, AlertCircle,
  CheckCircle, Clock, Info, Zap,
} from 'lucide-react';
import {
  fetchIntegrations,
  syncMenu,
  fetchSyncStatus,
} from '../api/aggregator';
import type { AggregatorIntegration, AggregatorPlatform } from '../api/aggregator';
import { Spinner } from '../components/ui/Spinner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function fmtElapsed(iso: string | null) {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

const PLATFORM_LABEL: Record<AggregatorPlatform, string> = {
  swiggy: 'Swiggy',
  zomato: 'Zomato',
};

// ── Sync status badge ─────────────────────────────────────────────────────────

function SyncStatusBadge({ status }: { status: AggregatorIntegration['menuSyncStatus'] }) {
  const cfg = {
    idle: {
      cls:  'bg-gray-50 border-gray-200 text-gray-500',
      icon: <Clock size={12} />,
      label: 'Idle',
    },
    syncing: {
      cls:  'bg-blue-50 border-blue-200 text-blue-700',
      icon: <RefreshCw size={12} className="animate-spin" />,
      label: 'Syncing…',
    },
    success: {
      cls:  'bg-emerald-50 border-emerald-200 text-emerald-700',
      icon: <CheckCircle size={12} />,
      label: 'Success',
    },
    failed: {
      cls:  'bg-red-50 border-red-200 text-red-700',
      icon: <AlertCircle size={12} />,
      label: 'Failed',
    },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Failed items list ─────────────────────────────────────────────────────────

interface FailedItem { name: string; error: string }

function FailedItemsList({ items }: { items: FailedItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-red-700"
      >
        <span className="flex items-center gap-1.5">
          <AlertCircle size={12} />
          {items.length} failed item{items.length !== 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="border-t border-red-200 divide-y divide-red-100">
          {items.map((item, i) => (
            <div key={i} className="px-3 py-1.5">
              <p className="text-xs font-medium text-red-800">{item.name}</p>
              <p className="text-[11px] text-red-600">{item.error}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Platform sync section ─────────────────────────────────────────────────────

type SyncStatus = Pick<
  AggregatorIntegration,
  'menuSyncStatus' | 'lastSyncAt' | 'lastSyncError' | 'syncedItemCount' | 'failedItemCount'
>;

interface PlatformSyncSectionProps {
  platform: AggregatorPlatform;
  integration: AggregatorIntegration | null;
  onToast: (type: 'success' | 'error', msg: string) => void;
}

function PlatformSyncSection({ platform, integration, onToast }: PlatformSyncSectionProps) {
  const [syncing, setSyncing] = useState(false);
  const [status,  setStatus]  = useState<SyncStatus | null>(
    integration
      ? {
          menuSyncStatus: integration.menuSyncStatus,
          lastSyncAt:     integration.lastSyncAt,
          lastSyncError:  integration.lastSyncError,
          syncedItemCount: integration.syncedItemCount,
          failedItemCount: integration.failedItemCount,
        }
      : null,
  );
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep local status in sync with incoming integration prop
  useEffect(() => {
    if (!integration) return;
    setStatus({
      menuSyncStatus:  integration.menuSyncStatus,
      lastSyncAt:      integration.lastSyncAt,
      lastSyncError:   integration.lastSyncError,
      syncedItemCount: integration.syncedItemCount,
      failedItemCount: integration.failedItemCount,
    });
  }, [integration]);

  // Poll every 10 s while status is 'syncing'
  useEffect(() => {
    const isSyncing = status?.menuSyncStatus === 'syncing';
    if (isSyncing && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await fetchSyncStatus(platform);
          setStatus(s);
          if (s.menuSyncStatus !== 'syncing' && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch { /* ignore poll errors */ }
      }, 10_000);
    } else if (!isSyncing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [status?.menuSyncStatus, platform]);

  async function handleSync() {
    setSyncing(true);
    setFailedItems([]);
    try {
      const res = await syncMenu(platform);
      setFailedItems(res.failedItems ?? []);
      // Refresh status after triggering
      const s = await fetchSyncStatus(platform);
      setStatus(s);
      onToast(
        res.failedCount === 0 ? 'success' : 'error',
        `${PLATFORM_LABEL[platform]}: ${res.syncedCount} synced, ${res.failedCount} failed.`,
      );
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const notEnabled = !integration?.enabled;

  const platformCfg = {
    swiggy: { letter: 'S', bg: 'bg-brand', border: 'border-brand/20', ring: 'ring-brand/10' },
    zomato: { letter: 'Z', bg: 'bg-red-600', border: 'border-red-200', ring: 'ring-red-50' },
  }[platform];

  return (
    <div className={`rounded-2xl border bg-canvas shadow-sm ${platformCfg.border}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${platformCfg.bg} text-lg font-bold text-white`}>
            {platformCfg.letter}
          </div>
          <div>
            <p className="font-semibold text-ink">{PLATFORM_LABEL[platform]} Menu Sync</p>
            {notEnabled && (
              <p className="text-[11px] text-ink/40">Integration not enabled</p>
            )}
          </div>
        </div>
        {status && <SyncStatusBadge status={status.menuSyncStatus} />}
      </div>

      {/* Stats */}
      <div className="border-b border-border px-5 py-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Last Sync</p>
            <p className="text-sm font-medium text-ink">
              {status?.lastSyncAt ? fmtElapsed(status.lastSyncAt) : '—'}
            </p>
            {status?.lastSyncAt && (
              <p className="text-[10px] text-ink/40">{fmtDate(status.lastSyncAt)}</p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Synced Items</p>
            <p className="text-sm font-medium text-emerald-700">{status?.syncedItemCount ?? 0}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Failed Items</p>
            <p className={`text-sm font-medium ${(status?.failedItemCount ?? 0) > 0 ? 'text-red-600' : 'text-ink/50'}`}>
              {status?.failedItemCount ?? 0}
            </p>
          </div>
        </div>

        {status?.lastSyncError && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {status.lastSyncError}
          </div>
        )}
      </div>

      {/* Failed items */}
      {failedItems.length > 0 && (
        <div className="border-b border-border px-5 py-3">
          <FailedItemsList items={failedItems} />
        </div>
      )}

      {/* Sync button */}
      <div className="px-5 py-4">
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing || notEnabled || status?.menuSyncStatus === 'syncing'}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {syncing || status?.menuSyncStatus === 'syncing'
            ? <Spinner size="sm" />
            : <RefreshCw size={14} />}
          {syncing ? 'Starting sync…' :
            status?.menuSyncStatus === 'syncing' ? 'Syncing…' :
            'Sync Full Menu'}
        </button>
        {notEnabled && (
          <p className="mt-1.5 text-xs text-ink/40">
            Enable this platform in Delivery Integrations first.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface Toast { id: number; type: 'success' | 'error'; message: string }
let _tid = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast['type'], message: string) => {
    const id = ++_tid;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  }, []);
  return { toasts, add };
}

function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-md text-sm font-medium ${
          t.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {t.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PLATFORMS: AggregatorPlatform[] = ['swiggy', 'zomato'];

export function MenuSyncPage() {
  const [integrations, setIntegrations] = useState<AggregatorIntegration[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const { toasts, add: toast } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIntegrations();
      setIntegrations(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function getIntegration(platform: AggregatorPlatform) {
    return integrations.find(i => i.platform === platform) ?? null;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw size={20} className="text-brand" />
          <h1 className="text-xl font-bold text-ink">Menu Sync</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-ink/60 hover:bg-mist hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Info boxes */}
      <div className="space-y-3">
        {/* Channel pricing note */}
        <div className="flex gap-3 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3">
          <Zap size={16} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-sm text-ink/80">
            <span className="font-semibold text-ink">Channel Pricing: </span>
            Products use channel-specific prices when configured in the Products page.
            Set platform override prices there before syncing.
          </p>
        </div>

        {/* External API note */}
        <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <Info size={16} className="mt-0.5 shrink-0 text-blue-600" />
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Backend requirement: </span>
            External API calls require{' '}
            <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-[11px]">
              AGGREGATOR_EXTERNAL_ENABLED=true
            </code>{' '}
            in the backend <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-[11px]">.env</code>{' '}
            file and valid platform API credentials configured in Delivery Integrations.
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && integrations.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {PLATFORMS.map(platform => (
            <PlatformSyncSection
              key={platform}
              platform={platform}
              integration={getIntegration(platform)}
              onToast={toast}
            />
          ))}
        </div>
      )}

      <ToastList toasts={toasts} />
    </div>
  );
}
