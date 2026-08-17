import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, ChevronDown, ChevronUp, AlertCircle,
  CheckCircle, Clock, Info, Zap, List, History,
  Calendar, ToggleLeft, ToggleRight, Minus, X, Download,
} from 'lucide-react';
import {
  fetchIntegrations,
  syncMenu,
  fetchSyncStatus,
  fetchMenuItems,
  updateItemAvailability,
  bulkUpdateAvailability,
  fetchSyncHistory,
  fetchSyncHistoryRecord,
  saveAutoSyncConfig,
} from '../api/aggregator';
import type {
  AggregatorIntegration,
  AggregatorPlatform,
  ProductChannelAvailability,
  MenuSyncHistoryRecord,
} from '../api/aggregator';
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

function fmtDuration(ms: number | null) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const PLATFORM_LABEL: Record<AggregatorPlatform, string> = {
  swiggy: 'Swiggy',
  zomato: 'Zomato',
};

const INTERVAL_LABELS: Record<number, string> = {
  15:   'Every 15 minutes',
  30:   'Every 30 minutes',
  60:   'Every hour',
  1440: 'Daily',
};

// ── Sync status badge ─────────────────────────────────────────────────────────

type SyncStatus = AggregatorIntegration['menuSyncStatus'];

function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const cfg: Record<SyncStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    idle: {
      cls:   'bg-ink/5 border-ink/10 text-ink/40',
      icon:  <Clock size={12} />,
      label: 'Idle',
    },
    syncing: {
      cls:   'bg-blue-50 border-blue-200 text-blue-700',
      icon:  <RefreshCw size={12} className="animate-spin" />,
      label: 'Syncing…',
    },
    success: {
      cls:   'bg-emerald-50 border-emerald-200 text-emerald-700',
      icon:  <CheckCircle size={12} />,
      label: 'Success',
    },
    partial: {
      cls:   'bg-amber-50 border-amber-200 text-amber-700',
      icon:  <AlertCircle size={12} />,
      label: 'Partial',
    },
    failed: {
      cls:   'bg-red-50 border-red-200 text-red-700',
      icon:  <AlertCircle size={12} />,
      label: 'Failed',
    },
  };

  const c = cfg[status] ?? cfg.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${c.cls}`}>
      {c.icon}
      {c.label}
    </span>
  );
}

function HistoryStatusBadge({ status }: { status: MenuSyncHistoryRecord['status'] }) {
  const cfg = {
    running: { cls: 'bg-blue-50 border-blue-200 text-blue-700',     label: 'Running' },
    success: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', label: 'Success' },
    partial: { cls: 'bg-amber-50 border-amber-200 text-amber-700',  label: 'Partial' },
    failed:  { cls: 'bg-red-50 border-red-200 text-red-700',        label: 'Failed' },
  }[status] ?? { cls: 'bg-ink/5 border-ink/10 text-ink/40', label: status };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
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

// ── Platform sync section (overview tab) ──────────────────────────────────────

type SyncStatusPick = Pick<
  AggregatorIntegration,
  'menuSyncStatus' | 'lastSyncAt' | 'lastSyncError' | 'syncedItemCount' | 'failedItemCount'
>;

interface PlatformSyncSectionProps {
  platform:    AggregatorPlatform;
  integration: AggregatorIntegration | null;
  onToast:     (type: 'success' | 'error', msg: string) => void;
}

function PlatformSyncSection({ platform, integration, onToast }: PlatformSyncSectionProps) {
  const [syncing,     setSyncing]     = useState(false);
  const [status,      setStatus]      = useState<SyncStatusPick | null>(
    integration
      ? {
          menuSyncStatus:  integration.menuSyncStatus,
          lastSyncAt:      integration.lastSyncAt,
          lastSyncError:   integration.lastSyncError,
          syncedItemCount: integration.syncedItemCount,
          failedItemCount: integration.failedItemCount,
        }
      : null,
  );
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const isSyncing  = syncing || status?.menuSyncStatus === 'syncing';

  const platformCfg = {
    swiggy: { letter: 'S', bg: 'bg-brand', border: 'border-brand/20' },
    zomato: { letter: 'Z', bg: 'bg-red-600', border: 'border-red-200' },
  }[platform];

  return (
    <div className={`rounded-2xl border bg-canvas shadow-sm ${platformCfg.border}`}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${platformCfg.bg} text-lg font-bold text-white`}>
            {platformCfg.letter}
          </div>
          <div>
            <p className="font-semibold text-ink">{PLATFORM_LABEL[platform]} Menu Sync</p>
            {notEnabled && <p className="text-[11px] text-ink/40">Integration not enabled</p>}
          </div>
        </div>
        {status && <SyncStatusBadge status={status.menuSyncStatus} />}
      </div>

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
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Synced</p>
            <p className="text-sm font-medium text-emerald-700">{status?.syncedItemCount ?? 0}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Failed</p>
            <p className={`text-sm font-medium ${(status?.failedItemCount ?? 0) > 0 ? 'text-red-600' : 'text-ink/50'}`}>
              {status?.failedItemCount ?? 0}
            </p>
          </div>
          {integration?.nextAutoSyncAt && integration.autoSyncEnabled && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Next Auto-Sync</p>
              <p className="text-sm font-medium text-ink">{fmtDate(integration.nextAutoSyncAt)}</p>
            </div>
          )}
        </div>

        {status?.lastSyncError && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {status.lastSyncError}
          </div>
        )}
      </div>

      {failedItems.length > 0 && (
        <div className="border-b border-border px-5 py-3">
          <FailedItemsList items={failedItems} />
        </div>
      )}

      <div className="px-5 py-4">
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={isSyncing || notEnabled}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {isSyncing ? <Spinner size="sm" /> : <RefreshCw size={14} />}
          {isSyncing ? 'Syncing…' : 'Sync Full Menu'}
        </button>
        {notEnabled && (
          <p className="mt-1.5 text-xs text-ink/40">Enable this platform in Delivery Integrations first.</p>
        )}
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  integrations,
  loading,
  onToast,
}: {
  integrations: AggregatorIntegration[];
  loading: boolean;
  onToast: (type: 'success' | 'error', msg: string) => void;
}) {
  function getIntegration(platform: AggregatorPlatform) {
    return integrations.find(i => i.platform === platform) ?? null;
  }

  if (loading && integrations.length === 0) {
    return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex gap-3 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3">
          <Zap size={16} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-sm text-ink/80">
            <span className="font-semibold text-ink">Channel Pricing: </span>
            Set platform-specific prices in Products before syncing.
          </p>
        </div>
        <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <Info size={16} className="mt-0.5 shrink-0 text-blue-600" />
          <p className="text-sm text-blue-800">
            <span className="font-semibold">Backend requirement: </span>
            External API calls require{' '}
            <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-[11px]">AGGREGATOR_EXTERNAL_ENABLED=true</code>{' '}
            and valid API credentials in Delivery Integrations.
          </p>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {(['swiggy', 'zomato'] as AggregatorPlatform[]).map(platform => (
          <PlatformSyncSection
            key={platform}
            platform={platform}
            integration={getIntegration(platform)}
            onToast={onToast}
          />
        ))}
      </div>
    </div>
  );
}

// ── Channel availability cell ─────────────────────────────────────────────────

type ChannelState = boolean | null;

function AvailabilityChip({
  value,
  posValue,
  onChange,
  disabled,
}: {
  value:    ChannelState;
  posValue: boolean;
  onChange: (next: ChannelState) => void;
  disabled?: boolean;
}) {
  function cycle() {
    if (disabled) return;
    // null → true → false → null
    onChange(value === null ? true : value === true ? false : null);
  }

  if (value === null) {
    return (
      <button
        type="button"
        onClick={cycle}
        disabled={disabled}
        title="Following POS availability — click to override"
        className={`inline-flex items-center gap-1 rounded-md border border-ink/15 bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink/50 hover:bg-ink/10 disabled:cursor-not-allowed ${posValue ? '' : 'line-through opacity-60'}`}
      >
        <Minus size={10} />
        Auto
      </button>
    );
  }
  if (value === true) {
    return (
      <button
        type="button"
        onClick={cycle}
        disabled={disabled}
        title="Explicitly enabled — click to change"
        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed"
      >
        <ToggleRight size={12} />
        On
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={cycle}
      disabled={disabled}
      title="Explicitly disabled — click to change"
      className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed"
    >
      <ToggleLeft size={12} />
      Off
    </button>
  );
}

// ── Item availability tab ─────────────────────────────────────────────────────

function ItemAvailabilityTab({ onToast }: { onToast: (type: 'success' | 'error', msg: string) => void }) {
  const [products,  setProducts]  = useState<ProductChannelAvailability[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState<Set<string>>(new Set());
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [search,    setSearch]    = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMenuItems();
      setProducts(res.products);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { void load(); }, [load]);

  async function handleAvailChange(productId: string, platform: AggregatorPlatform, available: ChannelState) {
    setSaving(s => new Set(s).add(productId));
    try {
      const res = await updateItemAvailability(productId, { platform, available });
      setProducts(ps => ps.map(p => p._id === productId ? { ...p, ...res.product } : p));
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(productId); return n; });
    }
  }

  async function handleBulk(platform: AggregatorPlatform, available: ChannelState) {
    if (selected.size === 0) { onToast('error', 'Select at least one product'); return; }
    setBulkSaving(true);
    try {
      const res = await bulkUpdateAvailability({ productIds: [...selected], platform, available });
      onToast('success', `Updated ${res.updated} product(s) on ${PLATFORM_LABEL[platform]}`);
      await load();
      setSelected(new Set());
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Bulk update failed');
    } finally {
      setBulkSaving(false);
    }
  }

  const filtered = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.categoryName.toLowerCase().includes(search.toLowerCase())
  );

  const allSelected = filtered.length > 0 && filtered.every(p => selected.has(p._id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p._id)));
  }

  function toggleOne(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products or categories…"
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-canvas px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink/60 hover:bg-mist disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3">
          <span className="text-sm font-medium text-ink">{selected.size} selected</span>
          <div className="flex flex-wrap gap-2 ml-2">
            {(['swiggy', 'zomato'] as AggregatorPlatform[]).map(p => (
              <div key={p} className="flex items-center gap-1">
                <span className="text-xs text-ink/60">{PLATFORM_LABEL[p]}:</span>
                <button
                  type="button"
                  onClick={() => void handleBulk(p, true)}
                  disabled={bulkSaving}
                  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  Enable
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulk(p, false)}
                  disabled={bulkSaving}
                  className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  Disable
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulk(p, null)}
                  disabled={bulkSaving}
                  className="rounded border border-ink/15 bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink/50 hover:bg-ink/10 disabled:opacity-50"
                >
                  Reset
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-ink/40 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-mist/50">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-border"
                />
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/40">Product</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/40">Category</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink/40">POS</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink/40">Swiggy</th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink/40">Zomato</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink/40">Swiggy ₹</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink/40">Zomato ₹</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-ink/40">
                  {search ? 'No products match your search.' : 'No products found.'}
                </td>
              </tr>
            ) : (
              filtered.map(p => {
                const isSaving = saving.has(p._id);
                return (
                  <tr key={p._id} className={`hover:bg-mist/30 ${selected.has(p._id) ? 'bg-brand/5' : ''}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p._id)}
                        onChange={() => toggleOne(p._id)}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${p.isVeg ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <span className="font-medium text-ink">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink/60">{p.categoryName}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block h-2 w-2 rounded-full ${p.isAvailable ? 'bg-emerald-500' : 'bg-ink/20'}`} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isSaving
                        ? <Spinner size="sm" />
                        : (
                          <AvailabilityChip
                            value={p.channelAvailability.swiggy}
                            posValue={p.isAvailable}
                            onChange={v => void handleAvailChange(p._id, 'swiggy', v)}
                          />
                        )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isSaving
                        ? <Spinner size="sm" />
                        : (
                          <AvailabilityChip
                            value={p.channelAvailability.zomato}
                            posValue={p.isAvailable}
                            onChange={v => void handleAvailChange(p._id, 'zomato', v)}
                          />
                        )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-ink/70">
                      {p.channelPrices.swiggy != null
                        ? `₹${p.channelPrices.swiggy}`
                        : <span className="text-ink/30">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-ink/70">
                      {p.channelPrices.zomato != null
                        ? `₹${p.channelPrices.zomato}`
                        : <span className="text-ink/30">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-ink/40">
        <strong>Auto</strong> = follow POS availability. <strong>On/Off</strong> = explicit override for this channel only.
        Changes sync to the platform if External API is enabled and the item has a platform ID.
      </p>
    </div>
  );
}

// ── Sync history tab ──────────────────────────────────────────────────────────

function SyncHistoryTab({ onToast }: { onToast: (type: 'success' | 'error', msg: string) => void }) {
  const [records,    setRecords]    = useState<MenuSyncHistoryRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [total,      setTotal]      = useState(0);
  const [pages,      setPages]      = useState(1);
  const [page,       setPage]       = useState(1);
  const [platFilter, setPlatFilter] = useState('');
  const [statFilter, setStatFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [detail,     setDetail]     = useState<MenuSyncHistoryRecord | null>(null);
  const [detailLoad, setDetailLoad] = useState(false);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const res = await fetchSyncHistory({
        platform: platFilter || undefined,
        status:   statFilter || undefined,
        syncType: typeFilter || undefined,
        page:     p,
        limit:    25,
      });
      setRecords(res.records);
      setTotal(res.total);
      setPages(res.pages);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [page, platFilter, statFilter, typeFilter, onToast]);

  useEffect(() => { setPage(1); }, [platFilter, statFilter, typeFilter]);
  useEffect(() => { void load(page); }, [load, page]);

  async function openDetail(id: string) {
    setDetailLoad(true);
    try {
      const res = await fetchSyncHistoryRecord(id);
      setDetail(res.record);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to load detail');
    } finally {
      setDetailLoad(false);
    }
  }

  function exportCSV() {
    const header = 'Date,Platform,Type,Status,Total,Synced,Failed,Duration,By,External';
    const rows = records.map(r => [
      fmtDate(r.startedAt),
      r.platform,
      r.syncType,
      r.status,
      r.totalItems,
      r.syncedItems,
      r.failedItems,
      fmtDuration(r.durationMs),
      r.triggeredBy,
      r.externalSynced ? 'Yes' : 'No',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `sync-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={platFilter}
          onChange={e => setPlatFilter(e.target.value)}
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">All platforms</option>
          <option value="swiggy">Swiggy</option>
          <option value="zomato">Zomato</option>
        </select>
        <select
          value={statFilter}
          onChange={e => setStatFilter(e.target.value)}
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="success">Success</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">All types</option>
          <option value="full">Full sync</option>
          <option value="scheduled">Scheduled</option>
          <option value="availability">Availability</option>
          <option value="item">Item</option>
        </select>
        <button
          type="button"
          onClick={() => void load(page)}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink/60 hover:bg-mist disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={exportCSV}
          disabled={records.length === 0}
          className="ml-auto flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink/60 hover:bg-mist disabled:opacity-50"
        >
          <Download size={13} />
          CSV
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-mist/50">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/40">Date</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/40">Platform</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/40">Type</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/40">Status</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink/40">Total</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink/40">✓</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink/40">✗</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink/40">Duration</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/40">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-ink/40">
                      No sync history found.
                    </td>
                  </tr>
                ) : (
                  records.map(r => (
                    <tr
                      key={r._id}
                      className="cursor-pointer hover:bg-mist/30"
                      onClick={() => void openDetail(r._id)}
                    >
                      <td className="px-4 py-3 text-ink/60 whitespace-nowrap">{fmtDate(r.startedAt)}</td>
                      <td className="px-4 py-3 font-medium capitalize">{r.platform}</td>
                      <td className="px-4 py-3 capitalize text-ink/60">{r.syncType}</td>
                      <td className="px-4 py-3"><HistoryStatusBadge status={r.status} /></td>
                      <td className="px-4 py-3 text-right font-mono">{r.totalItems}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-700">{r.syncedItems}</td>
                      <td className={`px-4 py-3 text-right font-mono ${r.failedItems > 0 ? 'text-red-600' : 'text-ink/30'}`}>{r.failedItems}</td>
                      <td className="px-4 py-3 text-right text-ink/60">{fmtDuration(r.durationMs)}</td>
                      <td className="px-4 py-3 capitalize text-ink/50">{r.triggeredBy}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink/50">{total} records</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-border px-3 py-1.5 text-ink/60 hover:bg-mist disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-ink/40">Page {page} of {pages}</span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  className="rounded-lg border border-border px-3 py-1.5 text-ink/60 hover:bg-mist disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail modal */}
      {(detail || detailLoad) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="relative max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-canvas p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="absolute right-4 top-4 text-ink/40 hover:text-ink"
            >
              <X size={18} />
            </button>

            {detailLoad ? (
              <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>
            ) : detail && (
              <>
                <h3 className="mb-4 text-base font-bold text-ink">
                  {PLATFORM_LABEL[detail.platform]} — {fmtDate(detail.startedAt)}
                </h3>
                <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Status', <HistoryStatusBadge key="s" status={detail.status} />],
                    ['Type', <span key="t" className="capitalize">{detail.syncType}</span>],
                    ['Triggered by', <span key="b" className="capitalize">{detail.triggeredBy}</span>],
                    ['Duration', fmtDuration(detail.durationMs)],
                    ['Total items', detail.totalItems],
                    ['Synced', detail.syncedItems],
                    ['Failed', detail.failedItems],
                    ['External API', detail.externalSynced ? 'Yes' : 'No (disabled)'],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">{label}</p>
                      <div className="mt-0.5 font-medium text-ink">{value}</div>
                    </div>
                  ))}
                </div>
                {detail.failureSummary && detail.failureSummary.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">Failed Items</p>
                    <div className="rounded-lg border border-red-200 bg-red-50 divide-y divide-red-100 max-h-48 overflow-y-auto">
                      {detail.failureSummary.map((fi, i) => (
                        <div key={i} className="px-3 py-2">
                          <p className="text-xs font-medium text-red-800">{fi.itemName}</p>
                          <p className="text-[11px] text-red-600">{fi.error}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Schedule tab ──────────────────────────────────────────────────────────────

function ScheduleTab({
  integrations,
  onIntegrationsChange,
  onToast,
}: {
  integrations: AggregatorIntegration[];
  onIntegrationsChange: (updated: AggregatorIntegration) => void;
  onToast: (type: 'success' | 'error', msg: string) => void;
}) {
  const [saving, setSaving] = useState<Set<AggregatorPlatform>>(new Set());

  async function handleToggle(platform: AggregatorPlatform, enabled: boolean, intervalMinutes: number) {
    setSaving(s => new Set(s).add(platform));
    try {
      const res = await saveAutoSyncConfig(platform, { enabled, intervalMinutes });
      onIntegrationsChange(res.integration);
      onToast(
        'success',
        enabled
          ? `Auto-sync enabled for ${PLATFORM_LABEL[platform]} (${INTERVAL_LABELS[intervalMinutes] ?? intervalMinutes + ' min'})`
          : `Auto-sync disabled for ${PLATFORM_LABEL[platform]}`,
      );
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(platform); return n; });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <Info size={16} className="mt-0.5 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-800">
          Auto-sync pushes your full menu to the platform on a schedule. Only runs if the integration is enabled and
          <code className="mx-1 rounded bg-amber-100 px-1 font-mono text-[11px]">AGGREGATOR_EXTERNAL_ENABLED=true</code>
          is set. At minimum 15-minute intervals to avoid rate limiting.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(['swiggy', 'zomato'] as AggregatorPlatform[]).map(platform => {
          const integration = integrations.find(i => i.platform === platform);
          const isSaving    = saving.has(platform);
          const notEnabled  = !integration?.enabled;
          const autoEnabled = integration?.autoSyncEnabled ?? false;
          const interval    = integration?.autoSyncIntervalMinutes ?? 60;
          const nextSync    = integration?.nextAutoSyncAt;

          const platformCfg = {
            swiggy: { letter: 'S', bg: 'bg-brand', border: 'border-brand/20' },
            zomato: { letter: 'Z', bg: 'bg-red-600', border: 'border-red-200' },
          }[platform];

          return (
            <div key={platform} className={`rounded-2xl border bg-canvas p-5 shadow-sm ${platformCfg.border}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${platformCfg.bg} text-base font-bold text-white`}>
                  {platformCfg.letter}
                </div>
                <div>
                  <p className="font-semibold text-ink">{PLATFORM_LABEL[platform]}</p>
                  {notEnabled && (
                    <p className="text-[11px] text-ink/40">Integration not enabled</p>
                  )}
                </div>
                {isSaving && <Spinner size="sm" className="ml-auto" />}
              </div>

              {/* Toggle */}
              <label className={`flex items-center justify-between rounded-xl border border-border px-4 py-3 mb-3 ${notEnabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-mist/30'}`}>
                <div>
                  <p className="text-sm font-medium text-ink">Automatic Sync</p>
                  <p className="text-[11px] text-ink/50">Push full menu on a schedule</p>
                </div>
                <input
                  type="checkbox"
                  checked={autoEnabled}
                  disabled={notEnabled || isSaving}
                  onChange={e => void handleToggle(platform, e.target.checked, interval)}
                  className="h-4 w-4 rounded border-border"
                />
              </label>

              {/* Interval selector */}
              {autoEnabled && !notEnabled && (
                <div className="mb-3">
                  <label className="mb-1.5 block text-xs font-semibold text-ink/50">Frequency</label>
                  <select
                    value={interval}
                    disabled={isSaving}
                    onChange={e => void handleToggle(platform, true, parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
                  >
                    {Object.entries(INTERVAL_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Next sync info */}
              {autoEnabled && nextSync && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <Clock size={13} className="text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-emerald-700">Next sync</p>
                    <p className="text-[11px] text-emerald-600">{fmtDate(nextSync)}</p>
                  </div>
                </div>
              )}

              {integration?.lastAutoSyncAt && (
                <p className="mt-2 text-[11px] text-ink/40">
                  Last auto-sync: {fmtDate(integration.lastAutoSyncAt)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab definition ────────────────────────────────────────────────────────────

type TabId = 'overview' | 'items' | 'history' | 'schedule';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',  label: 'Overview',          icon: <RefreshCw size={14} /> },
  { id: 'items',     label: 'Item Availability', icon: <List size={14} /> },
  { id: 'history',   label: 'Sync History',      icon: <History size={14} /> },
  { id: 'schedule',  label: 'Schedule',           icon: <Calendar size={14} /> },
];

// ── Page ──────────────────────────────────────────────────────────────────────

const PLATFORMS: AggregatorPlatform[] = ['swiggy', 'zomato'];

export function MenuSyncPage() {
  const [integrations, setIntegrations] = useState<AggregatorIntegration[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [activeTab,    setActiveTab]    = useState<TabId>('overview');
  const { toasts, add: toast } = useToasts();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIntegrations();
      setIntegrations(res.integrations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function patchIntegration(updated: AggregatorIntegration) {
    setIntegrations(list => list.map(i => i._id === updated._id ? updated : i));
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-5">

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

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-border bg-mist/50 p-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-canvas text-ink shadow-sm'
                  : 'text-ink/50 hover:text-ink'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'overview' && (
          <OverviewTab integrations={integrations} loading={loading} onToast={toast} />
        )}
        {activeTab === 'items' && (
          <ItemAvailabilityTab onToast={toast} />
        )}
        {activeTab === 'history' && (
          <SyncHistoryTab onToast={toast} />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab
            integrations={integrations}
            onIntegrationsChange={patchIntegration}
            onToast={toast}
          />
        )}

      </div>
      </div>

      <ToastList toasts={toasts} />
    </div>
  );
}
