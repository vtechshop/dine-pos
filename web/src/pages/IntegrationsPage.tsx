import { useState, useEffect, useCallback } from 'react';
import {
  Link, Link2Off, RefreshCw, Copy, Check,
  AlertCircle, Zap, Clock,
} from 'lucide-react';
import {
  fetchIntegrations,
  saveIntegration,
  disconnectIntegration,
  syncMenu,
  fetchWebhookLogs,
  retryWebhook,
} from '../api/aggregator';
import type { AggregatorIntegration, WebhookLog, AggregatorPlatform } from '../api/aggregator';
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
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const PLATFORM_LABEL: Record<AggregatorPlatform, string> = {
  swiggy: 'Swiggy',
  zomato: 'Zomato',
};

// ── Toast ──────────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

let _toastId = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((type: Toast['type'], message: string) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  return { toasts, add };
}

function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  const cls: Record<Toast['type'], string> = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error:   'bg-red-50 border-red-200 text-red-800',
    info:    'bg-blue-50 border-blue-200 text-blue-800',
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-md text-sm font-medium ${cls[t.type]}`}>
          {t.type === 'success' && <Check size={14} />}
          {t.type === 'error'   && <AlertCircle size={14} />}
          {t.type === 'info'    && <Zap size={14} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Connection status badge ────────────────────────────────────────────────────

function ConnectionBadge({ status }: { status: AggregatorIntegration['connectionStatus'] }) {
  const cfg = {
    connected:    'bg-emerald-50 border-emerald-200 text-emerald-700',
    disconnected: 'bg-gray-50 border-gray-200 text-gray-500',
    error:        'bg-red-50 border-red-200 text-red-700',
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cfg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${
        status === 'connected' ? 'bg-emerald-500' :
        status === 'error'     ? 'bg-red-500' : 'bg-gray-400'
      }`} />
      {status}
    </span>
  );
}

// ── Sync status badge ─────────────────────────────────────────────────────────

function SyncBadge({ status }: { status: AggregatorIntegration['menuSyncStatus'] }) {
  const cfg = {
    idle:    'bg-gray-50 border-gray-200 text-gray-500',
    syncing: 'bg-blue-50 border-blue-200 text-blue-700',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    failed:  'bg-red-50 border-red-200 text-red-700',
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cfg}`}>
      {status === 'syncing' && <RefreshCw size={10} className="animate-spin" />}
      {status}
    </span>
  );
}

// ── Platform logo ─────────────────────────────────────────────────────────────

function PlatformLogo({ platform }: { platform: AggregatorPlatform }) {
  const cfg = {
    swiggy: { bg: 'bg-brand',   letter: 'S' },
    zomato: { bg: 'bg-red-600', letter: 'Z' },
  }[platform];
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.bg} text-white text-lg font-bold shadow-sm`}>
      {cfg.letter}
    </div>
  );
}

// ── Webhook URL copy ──────────────────────────────────────────────────────────

function WebhookUrlField({ platform }: { platform: AggregatorPlatform }) {
  const [copied, setCopied] = useState(false);
  const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';
  const base = apiBase.replace(/\/api$/, '');
  const url = `${base}/api/aggregator/webhook/${platform}`;

  function handleCopy() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
        Webhook URL (configure in platform portal)
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-mist px-3 py-2">
        <span className="flex-1 truncate font-mono text-[11px] text-ink/60">{url}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 text-ink/40 hover:text-brand transition"
          title="Copy"
        >
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

// ── Integration card ──────────────────────────────────────────────────────────

interface IntegrationCardProps {
  platform: AggregatorPlatform;
  data: AggregatorIntegration | null;
  loading: boolean;
  onSaved: (updated: AggregatorIntegration) => void;
  onToast: (type: Toast['type'], msg: string) => void;
}

function IntegrationCard({ platform, data, loading, onSaved, onToast }: IntegrationCardProps) {
  const [form, setForm] = useState({
    storeId:       data?.storeId       ?? '',
    apiKey:        data?.apiKey        ?? '',
    apiSecret:     data?.apiSecret     ?? '',
    webhookSecret: data?.webhookSecret ?? '',
    enabled:       data?.enabled       ?? false,
    autoAccept:    data?.autoAccept    ?? false,
  });
  const [saving,       setSaving]       = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [disconnecting,setDisconnecting]= useState(false);

  // Sync form when parent data loads or refreshes
  useEffect(() => {
    if (!data) return;
    setForm({
      storeId:       data.storeId,
      apiKey:        data.apiKey,
      apiSecret:     data.apiSecret,
      webhookSecret: data.webhookSecret,
      enabled:       data.enabled,
      autoAccept:    data.autoAccept,
    });
  }, [data]);

  function set(field: keyof typeof form, value: string | boolean) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await saveIntegration(platform, form);
      onSaved(updated);
      onToast('success', `${PLATFORM_LABEL[platform]} settings saved.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncMenu(platform);
      onToast('success', `Sync complete: ${res.syncedCount} synced, ${res.failedCount} failed.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm(`Disconnect ${PLATFORM_LABEL[platform]} integration?`)) return;
    setDisconnecting(true);
    try {
      await disconnectIntegration(platform);
      onToast('info', `${PLATFORM_LABEL[platform]} disconnected.`);
      // Reload to reflect disconnected state
      const updated = await import('../api/aggregator').then(m => m.fetchIntegration(platform));
      onSaved(updated);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-canvas shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <PlatformLogo platform={platform} />
          <div>
            <p className="font-semibold text-ink">{PLATFORM_LABEL[platform]}</p>
            {data && <ConnectionBadge status={data.connectionStatus} />}
          </div>
        </div>
        {loading && <Spinner size="sm" />}
      </div>

      {/* Sync meta row */}
      {data && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border px-5 py-2.5">
          <span className="flex items-center gap-1.5 text-xs text-ink/50">
            <RefreshCw size={11} />
            Menu: <SyncBadge status={data.menuSyncStatus} />
          </span>
          <span className="flex items-center gap-1.5 text-xs text-ink/50">
            <Clock size={11} />
            Last sync: {fmtElapsed(data.lastSyncAt)}
          </span>
          {data.lastSyncError && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertCircle size={11} /> {data.lastSyncError}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs text-ink/50">
            <Zap size={11} />
            Last order: {fmtElapsed(data.lastOrderAt)}
          </span>
          <span className="text-xs text-ink/50">
            Synced: {data.syncedItemCount ?? 0} items
          </span>
          {(data.failedItemCount ?? 0) > 0 && (
            <span className="text-xs text-red-600">Failed: {data.failedItemCount} items</span>
          )}
        </div>
      )}

      {/* Form */}
      <form onSubmit={e => void handleSave(e)} className="space-y-4 px-5 py-4">
        {/* Enable toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only"
              checked={form.enabled}
              onChange={e => set('enabled', e.target.checked)}
            />
            <div className={`h-5 w-9 rounded-full transition ${form.enabled ? 'bg-brand' : 'bg-ink/20'}`} />
            <div className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.enabled ? 'translate-x-4' : ''}`} />
          </div>
          <span className="text-sm font-medium text-ink">
            {form.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>

        {/* Store ID */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            Store ID
          </label>
          <input
            type="text"
            value={form.storeId}
            onChange={e => set('storeId', e.target.value)}
            placeholder="Your store ID on platform"
            className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
          />
        </div>

        {/* API Key */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            API Key
          </label>
          <input
            type="text"
            value={form.apiKey}
            onChange={e => set('apiKey', e.target.value)}
            placeholder="API key"
            className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
          />
        </div>

        {/* API Secret */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            API Secret
          </label>
          <input
            type="password"
            value={form.apiSecret}
            onChange={e => set('apiSecret', e.target.value)}
            placeholder="API secret"
            className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
          />
        </div>

        {/* Webhook Secret */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            Webhook Secret
          </label>
          <input
            type="password"
            value={form.webhookSecret}
            onChange={e => set('webhookSecret', e.target.value)}
            placeholder="Webhook signing secret"
            className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
          />
        </div>

        {/* Webhook URL display */}
        <WebhookUrlField platform={platform} />

        {/* Auto-accept toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only"
              checked={form.autoAccept}
              onChange={e => set('autoAccept', e.target.checked)}
            />
            <div className={`h-5 w-9 rounded-full transition ${form.autoAccept ? 'bg-brand' : 'bg-ink/20'}`} />
            <div className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.autoAccept ? 'translate-x-4' : ''}`} />
          </div>
          <span className="text-sm font-medium text-ink">Auto-accept orders</span>
        </label>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60"
          >
            {saving ? <Spinner size="sm" /> : <Check size={14} />}
            Save Settings
          </button>

          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={!form.enabled || syncing}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-mist disabled:opacity-40"
          >
            {syncing ? <Spinner size="sm" /> : <RefreshCw size={14} />}
            Sync Menu Now
          </button>

          {data?.enabled && (
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              {disconnecting ? <Spinner size="sm" /> : <Link2Off size={14} />}
              Disconnect
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Webhook log status badge ───────────────────────────────────────────────────

function WebhookStatusBadge({ status }: { status: WebhookLog['status'] }) {
  const cfg = {
    success:  'bg-emerald-50 border-emerald-200 text-emerald-700',
    failed:   'bg-red-50 border-red-200 text-red-700',
    retrying: 'bg-amber-50 border-amber-200 text-amber-700',
  }[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg}`}>
      {status}
    </span>
  );
}

// ── Webhook logs table ────────────────────────────────────────────────────────

function WebhookLogsTable({
  logs,
  loading,
  onRetry,
}: {
  logs: WebhookLog[];
  loading: boolean;
  onRetry: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-canvas shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <p className="font-semibold text-ink">Webhook Logs</p>
        {loading && <Spinner size="sm" />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Time', 'Platform', 'Event', 'Status', 'Platform Order ID', 'Error', ''].map(h => (
                <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink/40">
                  No webhook logs
                </td>
              </tr>
            )}
            {logs.map(log => (
              <tr key={log._id} className="border-b border-border/60 hover:bg-mist/30 last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink/60">
                  {fmtDate(log.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                    log.platform === 'swiggy' ? 'bg-brand' : 'bg-red-600'
                  }`}>
                    {log.platform.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-ink/70">{log.event}</td>
                <td className="px-4 py-2.5">
                  <WebhookStatusBadge status={log.status} />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-ink/50">{log.platformOrderId || '—'}</td>
                <td className="max-w-xs px-4 py-2.5 text-xs text-red-600">
                  {log.errorMessage ? (
                    <span className="truncate block max-w-[200px]" title={log.errorMessage}>
                      {log.errorMessage}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-2.5">
                  {log.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => onRetry(log._id)}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-semibold text-ink/60 hover:bg-mist hover:text-ink"
                    >
                      <RefreshCw size={10} />
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<AggregatorIntegration[]>([]);
  const [logs,         setLogs]         = useState<WebhookLog[]>([]);
  const [loadingMain,  setLoadingMain]  = useState(true);
  const [loadingLogs,  setLoadingLogs]  = useState(true);
  const { toasts, add: toast } = useToasts();

  const PLATFORMS: AggregatorPlatform[] = ['swiggy', 'zomato'];

  const loadAll = useCallback(async () => {
    setLoadingMain(true);
    setLoadingLogs(true);
    try {
      const [intRes, logRes] = await Promise.allSettled([
        fetchIntegrations(),
        fetchWebhookLogs(),
      ]);
      if (intRes.status === 'fulfilled') setIntegrations(intRes.value);
      if (logRes.status === 'fulfilled') setLogs(logRes.value.slice(0, 20));
    } finally {
      setLoadingMain(false);
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  function getIntegration(platform: AggregatorPlatform) {
    return integrations.find(i => i.platform === platform) ?? null;
  }

  function handleSaved(updated: AggregatorIntegration) {
    setIntegrations(prev => {
      const idx = prev.findIndex(i => i.platform === updated.platform);
      if (idx === -1) return [...prev, updated];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  }

  async function handleRetry(logId: string) {
    try {
      await retryWebhook(logId);
      toast('success', 'Webhook retry queued.');
      const refreshed = await fetchWebhookLogs();
      setLogs(refreshed.slice(0, 20));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Retry failed.');
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link size={20} className="text-brand" />
          <h1 className="text-xl font-bold text-ink">Delivery Integrations</h1>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-ink/60 hover:bg-mist hover:text-ink"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Integration cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {PLATFORMS.map(platform => (
          <IntegrationCard
            key={platform}
            platform={platform}
            data={getIntegration(platform)}
            loading={loadingMain}
            onSaved={handleSaved}
            onToast={toast}
          />
        ))}
      </div>

      {/* Webhook logs */}
      <WebhookLogsTable
        logs={logs}
        loading={loadingLogs}
        onRetry={id => void handleRetry(id)}
      />

      <ToastList toasts={toasts} />
    </div>
  );
}
