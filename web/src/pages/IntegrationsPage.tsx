import { useState, useEffect, useCallback } from 'react';
import {
  Link, Link2Off, RefreshCw, Copy, Check,
  AlertCircle, Zap, Clock, MessageSquare, FlaskConical, Eye, EyeOff,
  Send, ToggleLeft, ToggleRight, Info, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  fetchIntegrations,
  saveIntegration,
  disconnectIntegration,
  testIntegration,
  syncMenu,
  fetchWebhookLogs,
  retryWebhook,
} from '../api/aggregator';
import type { AggregatorIntegration, SaveIntegrationBody, WebhookLog, AggregatorPlatform } from '../api/aggregator';
import {
  fetchMessagingProvider,
  saveMessagingProvider,
  testMessagingProvider,
  deleteMessagingProvider,
} from '../api/messagingProviders';
import type { MessagingProviderConfig, MessagingChannel } from '../api/messagingProviders';
import {
  fetchWhatsAppReceiptSettings,
  saveWhatsAppReceiptSettings,
  testWhatsAppReceipt,
  fetchAvailableVars,
  fetchWhatsAppReceiptStats,
} from '../api/whatsappReceipts';
import type { WhatsAppReceiptConfig, WhatsAppProviderStatus, AvailableVar } from '../api/whatsappReceipts';
import {
  fetchTallyConfig,
  saveTallyConfig,
  generateConnectorToken,
  fetchTallyStats,
} from '../api/tallySync';
import type { TallyConfig, TallyLedgerMap } from '../api/tallySync';
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
    disconnected: 'bg-ink/5 border-ink/10 text-ink/40',
    error:        'bg-red-50 border-red-200 text-red-700',
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cfg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${
        status === 'connected' ? 'bg-emerald-500' :
        status === 'error'     ? 'bg-red-500' : 'bg-ink/30'
      }`} />
      {status}
    </span>
  );
}

// ── Sync status badge ─────────────────────────────────────────────────────────

function SyncBadge({ status }: { status: AggregatorIntegration['menuSyncStatus'] }) {
  const cfg = ({
    idle:    'bg-ink/5 border-ink/10 text-ink/40',
    syncing: 'bg-blue-50 border-blue-200 text-blue-700',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    partial: 'bg-amber-50 border-amber-200 text-amber-700',
    failed:  'bg-red-50 border-red-200 text-red-700',
  } as Record<string, string>)[status] ?? 'bg-ink/5 border-ink/10 text-ink/40';
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
  // Write-only secret fields always start empty — never pre-fill from API
  const [form, setForm] = useState({
    storeId:       data?.storeId    ?? '',
    apiKey:        '',
    apiSecret:     '',
    webhookSecret: '',
    enabled:       data?.enabled    ?? false,
    autoAccept:    data?.autoAccept ?? false,
  });
  const [saving,        setSaving]        = useState(false);
  const [syncing,       setSyncing]       = useState(false);
  const [testing,       setTesting]       = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; onOk: () => void } | null>(null);

  // Sync non-secret fields when parent data changes
  useEffect(() => {
    if (!data) return;
    setForm(f => ({
      ...f,
      storeId:    data.storeId,
      enabled:    data.enabled,
      autoAccept: data.autoAccept,
      // Keep secret fields empty — write-only pattern
    }));
  }, [data]);

  function set(field: keyof typeof form, value: string | boolean) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: SaveIntegrationBody = {
        storeId:    form.storeId,
        enabled:    form.enabled,
        autoAccept: form.autoAccept,
      };
      // Only include secret fields if the user typed a value
      if (form.apiKey.trim())        body.apiKey        = form.apiKey.trim();
      if (form.apiSecret.trim())     body.apiSecret     = form.apiSecret.trim();
      if (form.webhookSecret.trim()) body.webhookSecret = form.webhookSecret.trim();

      const { integration: updated } = await saveIntegration(platform, body);
      // Clear write-only fields after successful save
      setForm(f => ({ ...f, apiKey: '', apiSecret: '', webhookSecret: '' }));
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

  async function handleTest() {
    setTesting(true);
    try {
      const res = await testIntegration(platform);
      onSaved(res.integration);
      if (res.success === true)  onToast('success', res.message);
      else if (res.success === false) onToast('error', res.message);
      else onToast('info', res.message);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Test failed.');
    } finally {
      setTesting(false);
    }
  }

  function handleDisconnect() {
    setPendingConfirm({
      msg: `Disconnect ${PLATFORM_LABEL[platform]} integration?`,
      onOk: async () => {
        setDisconnecting(true);
        try {
          const { integration: updated } = await disconnectIntegration(platform);
          onSaved(updated);
          onToast('info', `${PLATFORM_LABEL[platform]} disconnected.`);
        } catch (err) {
          onToast('error', err instanceof Error ? err.message : 'Disconnect failed.');
        } finally {
          setDisconnecting(false);
        }
      },
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-canvas shadow-sm">
      {pendingConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <p className="mb-4 text-sm">{pendingConfirm.msg}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setPendingConfirm(null)} className="px-4 py-2 text-sm border border-border rounded">Cancel</button>
              <button onClick={() => { pendingConfirm.onOk(); setPendingConfirm(null); }} className="px-4 py-2 text-sm bg-red-600 text-white rounded">Confirm</button>
            </div>
          </div>
        </div>
      )}
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

      {/* Meta row */}
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
            Today: <span className="font-semibold text-ink/70">{data.todayOrderCount ?? 0}</span> orders
          </span>
          <span className="text-xs text-ink/50">
            Synced: {data.syncedItemCount ?? 0} items
          </span>
          {(data.failedItemCount ?? 0) > 0 && (
            <span className="text-xs text-red-600">Failed: {data.failedItemCount} items</span>
          )}
        </div>
      )}

      {/* Last test result */}
      {data?.lastTestAt && (
        <div className={`flex items-center gap-2 border-b border-border px-5 py-2 text-xs ${
          data.lastTestSuccess === true  ? 'bg-emerald-50 text-emerald-700' :
          data.lastTestSuccess === false ? 'bg-red-50 text-red-700' :
                                           'bg-amber-50 text-amber-700'
        }`}>
          {data.lastTestSuccess === true  && <Check size={11} />}
          {data.lastTestSuccess === false && <AlertCircle size={11} />}
          {data.lastTestSuccess === null  && <FlaskConical size={11} />}
          Test: {data.lastTestMessage}
          <span className="ml-auto text-ink/40">{fmtElapsed(data.lastTestAt)}</span>
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

        {/* API Key — write-only */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            API Key {data?.hasApiKey && <span className="ml-1 normal-case text-emerald-600">(saved — enter to replace)</span>}
          </label>
          <MaskedInput
            id={`${platform}-apikey`}
            value={form.apiKey}
            onChange={v => set('apiKey', v)}
            placeholder={data?.hasApiKey ? '••••••••••••••• (stored)' : 'API key'}
          />
        </div>

        {/* API Secret — write-only */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            API Secret {data?.hasApiSecret && <span className="ml-1 normal-case text-emerald-600">(saved — enter to replace)</span>}
          </label>
          <MaskedInput
            id={`${platform}-apisecret`}
            value={form.apiSecret}
            onChange={v => set('apiSecret', v)}
            placeholder={data?.hasApiSecret ? '••••••••••••••• (stored)' : 'API secret'}
          />
        </div>

        {/* Webhook Secret — write-only */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            Webhook Secret {data?.hasWebhookSecret && <span className="ml-1 normal-case text-emerald-600">(saved — enter to replace)</span>}
          </label>
          <MaskedInput
            id={`${platform}-webhooksecret`}
            value={form.webhookSecret}
            onChange={v => set('webhookSecret', v)}
            placeholder={data?.hasWebhookSecret ? '••••••••••••••• (stored)' : 'Webhook signing secret'}
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
            Sync Menu
          </button>

          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing || !data?.hasApiKey}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-mist disabled:opacity-40"
            title={!data?.hasApiKey ? 'Save an API key first' : ''}
          >
            {testing ? <Spinner size="sm" /> : <FlaskConical size={14} />}
            Test Connection
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

function WebhookLogsTable() {
  const [logs,       setLogs]       = useState<WebhookLog[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [total,      setTotal]      = useState(0);
  const [pages,      setPages]      = useState(1);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [platFilter, setPlatFilter] = useState('');
  const [statFilter, setStatFilter] = useState('');

  const load = useCallback(async (p = page, q = search, plat = platFilter, stat = statFilter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWebhookLogs({ platform: plat || undefined, status: stat || undefined, search: q || undefined, page: p, limit: 25 });
      setLogs(res.logs);
      setTotal(res.total);
      setPages(res.pages);
      setPage(res.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  }, [page, search, platFilter, statFilter]);

  useEffect(() => { void load(1, search, platFilter, statFilter); }, [search, platFilter, statFilter]);

  function exportCSV() {
    const rows = [
      ['Time', 'Platform', 'Event', 'Status', 'Platform Order ID', 'Retries', 'Processing (ms)', 'Error'],
      ...logs.map(l => [
        l.createdAt, l.platform, l.event, l.status, l.platformOrderId,
        String(l.retryCount), String(l.processingTimeMs ?? ''), l.errorMessage ?? '',
      ]),
    ];
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `webhook-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRetry(id: string) {
    try {
      await retryWebhook(id);
      void load(page, search, platFilter, statFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

  const PLATS  = ['', 'swiggy', 'zomato'];
  const STATS  = ['', 'success', 'failed', 'retrying'];
  const PLAT_L: Record<string, string> = { '': 'All platforms', swiggy: 'Swiggy', zomato: 'Zomato' };
  const STAT_L: Record<string, string> = { '': 'All statuses', success: 'Success', failed: 'Failed', retrying: 'Retrying' };

  return (
    <div className="rounded-2xl border border-border bg-canvas shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <p className="font-semibold text-ink">Webhook Logs</p>
        {loading && <Spinner size="sm" />}
        <span className="text-xs text-ink/40">{total} total</span>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search order ID or event…"
          className="ml-auto h-8 w-52 rounded-lg border border-border bg-mist px-3 text-xs text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
        />

        {/* Platform filter */}
        <select
          value={platFilter}
          onChange={e => setPlatFilter(e.target.value)}
          className="h-8 rounded-lg border border-border bg-canvas px-2 text-xs text-ink focus:border-brand focus:outline-none"
        >
          {PLATS.map(p => <option key={p} value={p}>{PLAT_L[p]}</option>)}
        </select>

        {/* Status filter */}
        <select
          value={statFilter}
          onChange={e => setStatFilter(e.target.value)}
          className="h-8 rounded-lg border border-border bg-canvas px-2 text-xs text-ink focus:border-brand focus:outline-none"
        >
          {STATS.map(s => <option key={s} value={s}>{STAT_L[s]}</option>)}
        </select>

        {/* CSV export */}
        {logs.length > 0 && (
          <button
            type="button"
            onClick={exportCSV}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-ink/60 hover:bg-mist hover:text-ink"
          >
            Export CSV
          </button>
        )}
      </div>

      {error && (
        <div className="mx-5 mb-3 rounded-lg border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600">{error}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Time', 'Platform', 'Event', 'Status', 'Order ID', 'Retries', 'ms', 'Error', ''].map(h => (
                <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-ink/40">
                  {search || platFilter || statFilter ? 'No matching logs' : 'No webhook logs yet'}
                </td>
              </tr>
            )}
            {logs.map(log => (
              <tr key={log._id} className="border-b border-border/60 hover:bg-mist/30 last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink/60">{fmtDate(log.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                    log.platform === 'swiggy' ? 'bg-brand' : 'bg-red-600'
                  }`}>
                    {log.platform.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-ink/70">{log.event}</td>
                <td className="px-4 py-2.5"><WebhookStatusBadge status={log.status} /></td>
                <td className="px-4 py-2.5 font-mono text-xs text-ink/50">{log.platformOrderId || '—'}</td>
                <td className="px-4 py-2.5 text-center text-xs text-ink/50">{log.retryCount > 0 ? log.retryCount : '—'}</td>
                <td className="px-4 py-2.5 text-right text-xs text-ink/40 font-variant-numeric tabular-nums">
                  {log.processingTimeMs != null ? log.processingTimeMs : '—'}
                </td>
                <td className="max-w-[180px] px-4 py-2.5 text-xs text-red-600">
                  {log.errorMessage
                    ? <span className="block truncate" title={log.errorMessage}>{log.errorMessage}</span>
                    : '—'}
                </td>
                <td className="px-4 py-2.5">
                  {log.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => void handleRetry(log._id)}
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

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-xs text-ink/40">Page {page} of {pages}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => { const p = page - 1; setPage(p); void load(p, search, platFilter, statFilter); }}
              className="rounded border border-border px-3 py-1 text-xs font-semibold text-ink/60 hover:bg-mist disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => { const p = page + 1; setPage(p); void load(p, search, platFilter, statFilter); }}
              className="rounded border border-border px-3 py-1 text-xs font-semibold text-ink/60 hover:bg-mist disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Messaging Provider Card ───────────────────────────────────────────────────

function MaskedInput({
  value, onChange, placeholder, id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  id: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
        className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="shrink-0 rounded p-1.5 text-ink/40 hover:text-ink"
        title={show ? 'Hide' : 'Show'}
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

function MessagingWebhookUrlField({ hotelId }: { hotelId: string }) {
  const [copied, setCopied] = useState(false);
  const apiBase    = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5000/api';
  // Strip trailing /api, /api/, or / to derive the server base regardless of VITE_API_URL format
  const serverBase = apiBase.replace(/\/api\/?$/, '').replace(/\/$/, '');
  const url        = `${serverBase}/api/messaging-webhooks/msg91/${hotelId}`;

  function handleCopy() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
        MSG91 Webhook URL (paste in MSG91 dashboard → Webhooks)
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
      <p className="mt-1 text-[11px] text-ink/40">
        Also set a custom header <code className="font-mono">x-dinepos-secret</code> with the Webhook Secret value below.
      </p>
    </div>
  );
}

interface MessagingProviderCardProps {
  config:   MessagingProviderConfig | null;
  loading:  boolean;
  onSaved:  (cfg: MessagingProviderConfig) => void;
  onRemoved: () => void;
  onToast:  (type: Toast['type'], msg: string) => void;
}

function MessagingProviderCard({ config, loading, onSaved, onRemoved, onToast }: MessagingProviderCardProps) {
  const [form, setForm] = useState({
    channel:          (config?.channel ?? 'both') as MessagingChannel,
    apiKey:           '',
    integratedNumber: config?.integratedNumber ?? '',
    senderId:         config?.senderId         ?? '',
    waNamespace:      config?.waNamespace      ?? '',
    webhookSecret:    '',
  });
  const [saving,       setSaving]       = useState(false);
  const [testing,      setTesting]      = useState(false);
  const [disconnecting,setDisconnecting]= useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ msg: string; onOk: () => void } | null>(null);

  useEffect(() => {
    if (!config) return;
    setForm(f => ({
      ...f,
      channel:          config.channel,
      integratedNumber: config.integratedNumber,
      senderId:         config.senderId,
      waNamespace:      config.waNamespace,
    }));
  }, [config]);

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Parameters<typeof saveMessagingProvider>[0] = {
        providerType:     'msg91',
        channel:          form.channel,
        integratedNumber: form.integratedNumber,
        senderId:         form.senderId,
        waNamespace:      form.waNamespace,
      };
      if (form.apiKey.trim())        body.apiKey        = form.apiKey.trim();
      if (form.webhookSecret.trim()) body.webhookSecret = form.webhookSecret.trim();

      const res = await saveMessagingProvider(body);
      // Clear write-only fields after save
      setForm(f => ({ ...f, apiKey: '', webhookSecret: '' }));
      onSaved(res.config);
      onToast('success', 'MSG91 credentials saved.');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!config) return;
    setTesting(true);
    try {
      const res = await testMessagingProvider(config._id);
      onToast(res.success ? 'success' : 'error', res.message);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Test failed.');
    } finally {
      setTesting(false);
    }
  }

  function handleDisconnect() {
    if (!config) return;
    setPendingConfirm({
      msg: 'Disconnect MSG91? Campaigns will not be sent until you reconnect.',
      onOk: async () => {
        setDisconnecting(true);
        try {
          await deleteMessagingProvider(config._id);
          onRemoved();
          onToast('info', 'MSG91 disconnected.');
        } catch (err) {
          onToast('error', err instanceof Error ? err.message : 'Disconnect failed.');
        } finally {
          setDisconnecting(false);
        }
      },
    });
  }

  const isConnected = !!config?.isActive;

  return (
    <div className="rounded-2xl border border-border bg-canvas shadow-sm">
      {pendingConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-neutral-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <p className="mb-4 text-sm">{pendingConfirm.msg}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setPendingConfirm(null)} className="px-4 py-2 text-sm border border-border rounded">Cancel</button>
              <button onClick={() => { pendingConfirm.onOk(); setPendingConfirm(null); }} className="px-4 py-2 text-sm bg-red-600 text-white rounded">Confirm</button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
            <MessageSquare size={18} />
          </div>
          <div>
            <p className="font-semibold text-ink">MSG91 — WhatsApp & SMS</p>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              isConnected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-ink/5 border-ink/10 text-ink/40'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-ink/30'}`} />
              {isConnected ? 'Connected' : 'Not configured'}
            </span>
          </div>
        </div>
        {loading && <Spinner size="sm" />}
      </div>

      {/* Test result banner */}
      {config?.testResult && (
        <div className={`flex items-center gap-2 border-b border-border px-5 py-2.5 text-xs ${
          config.testResult.success ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
        }`}>
          {config.testResult.success
            ? <Check size={12} />
            : <AlertCircle size={12} />
          }
          Last test: {config.testResult.message}
          <span className="ml-auto text-ink/40">
            {new Date(config.testResult.lastTestedAt).toLocaleString('en-IN', {
              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
            })}
          </span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={e => void handleSave(e)} className="space-y-4 px-5 py-4">

        {/* Channel */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            Channel
          </label>
          <select
            value={form.channel}
            onChange={e => set('channel', e.target.value as MessagingChannel)}
            className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="both">WhatsApp + SMS</option>
            <option value="whatsapp">WhatsApp only</option>
            <option value="sms">SMS only</option>
          </select>
        </div>

        {/* API Key (write-only) */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            MSG91 Auth Key {config?.hasApiKey && <span className="ml-1 normal-case text-emerald-600">(saved — enter to replace)</span>}
          </label>
          <MaskedInput
            id="msg91-apikey"
            value={form.apiKey}
            onChange={v => set('apiKey', v)}
            placeholder={config?.hasApiKey ? '••••••••••••••• (stored)' : 'Your MSG91 authkey'}
          />
        </div>

        {/* WhatsApp fields */}
        {(form.channel === 'whatsapp' || form.channel === 'both') && (
          <>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                WhatsApp Business Phone (WABA integrated number)
              </label>
              <input
                type="text"
                value={form.integratedNumber}
                onChange={e => set('integratedNumber', e.target.value)}
                placeholder="e.g. 919876543210"
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                Template Namespace (optional — leave blank for Cloud API WABA)
              </label>
              <input
                type="text"
                value={form.waNamespace}
                onChange={e => set('waNamespace', e.target.value)}
                placeholder="Leave blank for Cloud API WABA accounts"
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
              />
            </div>
          </>
        )}

        {/* SMS fields */}
        {(form.channel === 'sms' || form.channel === 'both') && (
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
              DLT Sender ID
            </label>
            <input
              type="text"
              value={form.senderId}
              onChange={e => set('senderId', e.target.value)}
              placeholder="e.g. DNPHOS"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-amber-600">
              India DLT compliance: ensure your sender ID and message templates are registered with TRAI via MSG91.
            </p>
          </div>
        )}

        {/* Webhook Secret (write-only) */}
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
            Webhook Secret {config?.hasWebhookSecret && <span className="ml-1 normal-case text-emerald-600">(saved — enter to replace)</span>}
          </label>
          <MaskedInput
            id="msg91-webhook-secret"
            value={form.webhookSecret}
            onChange={v => set('webhookSecret', v)}
            placeholder={config?.hasWebhookSecret ? '••••••••••••••• (stored)' : 'Choose any secret string'}
          />
        </div>

        {/* Webhook secret missing warning */}
        {config?.hasApiKey && !config?.hasWebhookSecret && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-[11px] text-amber-800">
              <span className="font-semibold">Webhook secret not configured.</span>{' '}
              Without it, delivery status updates (sent, delivered, read) from MSG91 will be rejected.
              Add a webhook secret below, save, then paste the webhook URL into your MSG91 dashboard.
            </p>
          </div>
        )}

        {/* Webhook URL */}
        {config?.hotelId && (
          <MessagingWebhookUrlField hotelId={config.hotelId} />
        )}
        {!config && (
          <p className="rounded-lg border border-border bg-mist px-3 py-2 text-[11px] text-ink/50">
            Save credentials to generate your MSG91 webhook URL.
          </p>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60"
          >
            {saving ? <Spinner size="sm" /> : <Check size={14} />}
            Save
          </button>

          {config && (
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={testing || !config.hasApiKey}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-mist disabled:opacity-40"
              title={!config.hasApiKey ? 'Save an API key first' : ''}
            >
              {testing ? <Spinner size="sm" /> : <FlaskConical size={14} />}
              Test Connection
            </button>
          )}

          {config && (
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

// ── WhatsApp Receipts Settings Card ───────────────────────────────────────────

interface WhatsAppReceiptsCardProps {
  onToast: (type: Toast['type'], msg: string) => void;
}

function WhatsAppReceiptsCard({ onToast }: WhatsAppReceiptsCardProps) {
  const [config,   setConfig]   = useState<WhatsAppReceiptConfig | null>(null);
  const [provider, setProvider] = useState<WhatsAppProviderStatus | null>(null);
  const [stats,    setStats]    = useState<{ total: number; sent: number; delivered: number; read: number; failed: number; queued: number } | null>(null);
  const [vars,     setVars]     = useState<AvailableVar[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [testPhone,  setTestPhone]  = useState('');
  const [testing,    setTesting]    = useState(false);
  const [showVarsHelp, setShowVarsHelp] = useState(false);

  const [form, setForm] = useState<WhatsAppReceiptConfig>({
    autoSend:         false,
    templateName:     '',
    templateLanguage: 'en',
    templateVars:     [],
  });

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [settingsRes, statsRes, varsRes] = await Promise.allSettled([
          fetchWhatsAppReceiptSettings(),
          fetchWhatsAppReceiptStats(),
          fetchAvailableVars(),
        ]);
        if (settingsRes.status === 'fulfilled') {
          setConfig(settingsRes.value.config);
          setProvider(settingsRes.value.provider);
          setForm(settingsRes.value.config);
        }
        if (statsRes.status === 'fulfilled') setStats(statsRes.value);
        if (varsRes.status === 'fulfilled')  setVars(varsRes.value);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await saveWhatsAppReceiptSettings(form);
      setConfig(res.config);
      setForm(res.config);
      onToast('success', 'WhatsApp receipt settings saved.');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!testPhone.trim()) {
      onToast('error', 'Enter a phone number to test.');
      return;
    }
    setTesting(true);
    try {
      const res = await testWhatsAppReceipt(testPhone.trim());
      onToast(res.success ? 'success' : 'error', res.message);
    } finally {
      setTesting(false);
    }
  }

  function setVarAtIndex(idx: number, value: string) {
    setForm(prev => {
      const next = [...prev.templateVars];
      next[idx] = value;
      return { ...prev, templateVars: next };
    });
  }

  function addVar() {
    setForm(prev => ({ ...prev, templateVars: [...prev.templateVars, ''] }));
  }

  function removeVar(idx: number) {
    setForm(prev => ({
      ...prev,
      templateVars: prev.templateVars.filter((_, i) => i !== idx),
    }));
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 flex items-center gap-3 text-ink/50">
        <Spinner size="sm" />
        <span className="text-sm">Loading WhatsApp receipt settings…</span>
      </div>
    );
  }

  const isConfigured = provider?.configured ?? false;

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
            <Send size={16} className="text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">WhatsApp Auto-Receipts</p>
            <p className="text-xs text-ink/50">Send order receipts to customers via WhatsApp</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          isConfigured
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}>
          {isConfigured ? 'Provider connected' : 'No provider configured'}
        </span>
      </div>

      {/* Provider info */}
      {isConfigured && provider?.integratedNumber && (
        <div className="border-b border-border px-5 py-3 text-xs text-ink/60 flex items-center gap-2">
          <Info size={12} />
          Sending from <span className="font-mono font-semibold ml-1">{provider.integratedNumber}</span>
          {provider.providerType && <span className="ml-1">via {provider.providerType}</span>}
        </div>
      )}

      {!isConfigured && (
        <div className="border-b border-border bg-amber-50 dark:bg-amber-900/10 px-5 py-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertCircle size={12} />
          Configure MSG91 credentials in the Messaging Provider section above to enable WhatsApp receipts.
        </div>
      )}

      <form onSubmit={e => void handleSave(e)} className="divide-y divide-border">
        {/* Auto-send toggle */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink">Auto-send receipts</p>
            <p className="text-xs text-ink/50">Automatically send a WhatsApp receipt after every completed order</p>
          </div>
          <button
            type="button"
            onClick={() => setForm(prev => ({ ...prev, autoSend: !prev.autoSend }))}
            className="ml-4 shrink-0 text-ink/40 hover:text-ink/70"
          >
            {form.autoSend
              ? <ToggleRight size={28} className="text-green-500" />
              : <ToggleLeft size={28} />
            }
          </button>
        </div>

        {/* Template settings */}
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink/70">
                Template Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.templateName}
                onChange={e => setForm(prev => ({ ...prev, templateName: e.target.value }))}
                placeholder="e.g. order_receipt_v1"
                maxLength={200}
                className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink placeholder-ink/30 focus:border-brand focus:outline-none"
              />
              <p className="mt-1 text-xs text-ink/40">Must match a Meta-approved template in your MSG91 account</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink/70">
                Template Language
              </label>
              <input
                type="text"
                value={form.templateLanguage}
                onChange={e => setForm(prev => ({ ...prev, templateLanguage: e.target.value }))}
                placeholder="en"
                maxLength={10}
                className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink placeholder-ink/30 focus:border-brand focus:outline-none"
              />
              <p className="mt-1 text-xs text-ink/40">BCP-47 code, e.g. en, hi, en_US</p>
            </div>
          </div>

          {/* Template variables */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold text-ink/70">Template Variables (ordered)</label>
              <button
                type="button"
                onClick={() => setShowVarsHelp(v => !v)}
                className="flex items-center gap-1 text-xs text-brand hover:underline"
              >
                Available vars {showVarsHelp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>

            {showVarsHelp && vars.length > 0 && (
              <div className="mb-3 rounded-lg border border-border bg-mist/50 p-3 grid gap-1 sm:grid-cols-2">
                {vars.map(v => (
                  <div key={v.name} className="flex items-baseline gap-2 text-xs">
                    <code className="rounded bg-border/60 px-1 py-0.5 font-mono text-ink">{v.name}</code>
                    <span className="text-ink/50">{v.description}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="mb-2 text-xs text-ink/40">
              Each entry maps to a body variable: index 0 → body_1, index 1 → body_2, etc.
            </p>
            <div className="space-y-2">
              {form.templateVars.map((v, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-xs text-ink/40">{idx + 1}.</span>
                  <input
                    type="text"
                    value={v}
                    onChange={e => setVarAtIndex(idx, e.target.value)}
                    placeholder="variable name"
                    className="flex-1 rounded-lg border border-border bg-mist px-3 py-1.5 text-sm text-ink placeholder-ink/30 focus:border-brand focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeVar(idx)}
                    className="rounded px-2 py-1 text-xs text-ink/40 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addVar}
                className="mt-1 text-xs text-brand hover:underline"
              >
                + Add variable
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        {stats && stats.total > 0 && (
          <div className="px-5 py-3">
            <p className="mb-2 text-xs font-semibold text-ink/50">Last 30 days</p>
            <div className="flex flex-wrap gap-3 text-xs">
              {[
                { label: 'Sent',      value: stats.sent,      color: 'text-blue-600' },
                { label: 'Delivered', value: stats.delivered, color: 'text-green-600' },
                { label: 'Read',      value: stats.read,      color: 'text-violet-600' },
                { label: 'Failed',    value: stats.failed,    color: 'text-red-600' },
                { label: 'Queued',   value: stats.queued,    color: 'text-amber-600' },
              ].map(s => (
                <span key={s.label} className="flex items-center gap-1">
                  <span className={`font-bold tabular-nums ${s.color}`}>{s.value}</span>
                  <span className="text-ink/40">{s.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Test send */}
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1.5 block text-xs font-semibold text-ink/70">Test — send to phone</label>
            <input
              type="tel"
              value={testPhone}
              onChange={e => setTestPhone(e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink placeholder-ink/30 focus:border-brand focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={testing || !isConfigured || !form.templateName}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? <Spinner size="sm" /> : <FlaskConical size={14} />}
            Send test
          </button>
        </div>

        {/* Save */}
        <div className="flex justify-end px-5 py-4">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Spinner size="sm" /> : <Check size={14} />}
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Tally Direct Sync Card ────────────────────────────────────────────────────

interface TallyCardProps { onToast: (type: Toast['type'], msg: string) => void }

const DEFAULT_LEDGER_MAP: TallyLedgerMap = {
  salesLedger:       'Sales',
  cgstLedger:        'Output CGST',
  sgstLedger:        'Output SGST',
  cashLedger:        'Cash',
  bankLedger:        'Bank',
  discountLedger:    'Discount Allowed',
  roundOffLedger:    'Round Off',
  expenseLedger:     'Indirect Expenses',
  purchaseLedger:    'Purchases',
  stockInHandLedger: 'Stock-in-Hand',
  walletLedger:      'Customer Wallet',
};

function TallyCard({ onToast }: TallyCardProps) {
  const [cfg,     setCfg]     = useState<TallyConfig | null>(null);
  const [stats,   setStats]   = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [genning, setGenning] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [form, setForm] = useState({
    enabled:          false,
    companyName:      '',
    syncSales:        true,
    syncPurchases:    true,
    syncExpenses:     true,
    syncCancellations:true,
    ledgerMap:        DEFAULT_LEDGER_MAP,
  });

  useEffect(() => {
    void (async () => {
      try {
        const [c, s] = await Promise.allSettled([fetchTallyConfig(), fetchTallyStats()]);
        if (c.status === 'fulfilled') {
          const d = c.value;
          setCfg(d);
          setForm({
            enabled:           d.enabled,
            companyName:       d.companyName,
            syncSales:         d.syncSales,
            syncPurchases:     d.syncPurchases,
            syncExpenses:      d.syncExpenses,
            syncCancellations: d.syncCancellations,
            ledgerMap:         { ...DEFAULT_LEDGER_MAP, ...(d.ledgerMap ?? {}) },
          });
        }
        if (s.status === 'fulfilled') setStats(s.value as any);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await saveTallyConfig(form);
      setCfg(updated);
      onToast('success', 'Tally settings saved');
    } catch (err: any) {
      onToast('error', err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateToken() {
    if (!confirm('This will invalidate the current connector token. Continue?')) return;
    setGenning(true);
    setNewToken(null);
    try {
      const { token } = await generateConnectorToken();
      setNewToken(token);
      setCfg(prev => prev ? { ...prev, connectorTokenSet: true } : prev);
      onToast('success', 'New connector token generated — copy it now');
    } catch (err: any) {
      onToast('error', err.message ?? 'Token generation failed');
    } finally {
      setGenning(false);
    }
  }

  function setLedger(key: keyof TallyLedgerMap, value: string) {
    setForm(prev => ({ ...prev, ledgerMap: { ...prev.ledgerMap, [key]: value } }));
  }

  if (loading) return (
    <div className="rounded-xl border border-border bg-surface px-5 py-6 flex items-center gap-3 text-ink/50">
      <Spinner size="sm" />
      <span className="text-sm">Loading Tally settings…</span>
    </div>
  );

  const synced  = stats.synced  ?? 0;
  const pending = stats.pending ?? 0;
  const failed  = stats.failed  ?? 0;

  const LEDGER_LABELS: { key: keyof TallyLedgerMap; label: string }[] = [
    { key: 'salesLedger',       label: 'Sales ledger' },
    { key: 'cgstLedger',        label: 'Output CGST ledger' },
    { key: 'sgstLedger',        label: 'Output SGST ledger' },
    { key: 'cashLedger',        label: 'Cash ledger' },
    { key: 'bankLedger',        label: 'Bank / UPI ledger' },
    { key: 'discountLedger',    label: 'Discount ledger' },
    { key: 'expenseLedger',     label: 'Expense ledger' },
    { key: 'purchaseLedger',    label: 'Purchase ledger' },
    { key: 'walletLedger',      label: 'Customer wallet ledger' },
  ];

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <Zap size={16} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Tally Direct Sync</p>
            <p className="text-xs text-ink/50">Sync sales, purchases &amp; expenses to TallyPrime via Local Bridge</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          cfg?.connectorTokenSet
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
            : 'bg-ink/10 text-ink/50'
        }`}>
          {cfg?.connectorTokenSet ? 'Connector configured' : 'Not configured'}
        </span>
      </div>

      {/* Architecture notice */}
      <div className="border-b border-border bg-blue-50 dark:bg-blue-900/10 px-5 py-3 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          Requires the <strong>DinePOS Tally Bridge Connector</strong> installed on the same computer as TallyPrime.
          The connector polls this cloud API and pushes vouchers to TallyPrime localhost:9000.
          Your Tally port is never exposed to the internet.
        </span>
      </div>

      <form onSubmit={e => void handleSave(e)} className="divide-y divide-border">
        {/* Enable toggle */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink">Enable Tally sync</p>
            <p className="text-xs text-ink/50">Queue vouchers for all completed orders</p>
          </div>
          <button
            type="button"
            onClick={() => setForm(prev => ({ ...prev, enabled: !prev.enabled }))}
            className="ml-4 shrink-0 text-ink/40 hover:text-ink/70"
          >
            {form.enabled
              ? <ToggleRight size={28} className="text-blue-500" />
              : <ToggleLeft size={28} />}
          </button>
        </div>

        {/* Company + sync scopes */}
        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink/70">
              TallyPrime Company Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.companyName}
              onChange={e => setForm(prev => ({ ...prev, companyName: e.target.value }))}
              placeholder="e.g. Raj Restaurant Pvt Ltd"
              maxLength={200}
              className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink placeholder-ink/30 focus:border-brand focus:outline-none"
            />
            <p className="mt-1 text-xs text-ink/40">Must match the company name exactly as it appears in TallyPrime</p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              { key: 'syncSales',         label: 'Sales'        },
              { key: 'syncPurchases',     label: 'Purchases'    },
              { key: 'syncExpenses',      label: 'Expenses'     },
              { key: 'syncCancellations', label: 'Cancellations'},
            ] as const).map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => setForm(prev => ({ ...prev, [key]: e.target.checked }))}
                  className="h-4 w-4 rounded accent-brand"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Ledger mapping */}
        <div className="px-5 py-4">
          <p className="mb-3 text-xs font-semibold text-ink/70">Ledger Mapping</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {LEDGER_LABELS.map(({ key, label }) => (
              <div key={key}>
                <label className="mb-1 block text-xs text-ink/60">{label}</label>
                <input
                  type="text"
                  value={form.ledgerMap[key] ?? ''}
                  onChange={e => setLedger(key, e.target.value)}
                  placeholder={DEFAULT_LEDGER_MAP[key]}
                  className="w-full rounded-lg border border-border bg-mist px-3 py-1.5 text-sm text-ink placeholder-ink/30 focus:border-brand focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Connector token */}
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">Connector Token</p>
              <p className="text-xs text-ink/50">
                {cfg?.connectorTokenSet
                  ? `Token set · last seen: ${fmtElapsed(cfg.connectorLastSeenAt)}`
                  : 'No token generated yet'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateToken()}
              disabled={genning}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-mist disabled:opacity-50"
            >
              {genning ? <Spinner size="sm" /> : <RefreshCw size={12} />}
              {cfg?.connectorTokenSet ? 'Regenerate' : 'Generate token'}
            </button>
          </div>
          {newToken && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3">
              <p className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                Copy this token now — it will not be shown again
              </p>
              <code className="block break-all rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-1.5 text-xs font-mono text-amber-800 dark:text-amber-300">
                {newToken}
              </code>
            </div>
          )}
        </div>

        {/* Sync stats */}
        {(synced + pending + failed) > 0 && (
          <div className="px-5 py-3">
            <p className="mb-2 text-xs font-semibold text-ink/50">Sync queue</p>
            <div className="flex flex-wrap gap-3 text-xs">
              {[
                { label: 'Synced',  value: synced,  color: 'text-green-600' },
                { label: 'Pending', value: pending,  color: 'text-amber-600' },
                { label: 'Failed',  value: failed,   color: 'text-red-600' },
              ].map(s => (
                <span key={s.label} className="flex items-center gap-1">
                  <span className={`font-bold tabular-nums ${s.color}`}>{s.value}</span>
                  <span className="text-ink/40">{s.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Save */}
        <div className="flex justify-end px-5 py-4">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Spinner size="sm" /> : <Check size={14} />}
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const [integrations,    setIntegrations]    = useState<AggregatorIntegration[]>([]);
  const [messagingConfig, setMessagingConfig] = useState<MessagingProviderConfig | null>(null);
  const [loadingMain,     setLoadingMain]     = useState(true);
  const [loadingMsg,      setLoadingMsg]      = useState(true);
  const { toasts, add: toast } = useToasts();

  const PLATFORMS: AggregatorPlatform[] = ['swiggy', 'zomato'];

  const loadAll = useCallback(async () => {
    setLoadingMain(true);
    setLoadingMsg(true);
    try {
      const [intRes, msgRes] = await Promise.allSettled([
        fetchIntegrations(),
        fetchMessagingProvider(),
      ]);
      if (intRes.status === 'fulfilled') setIntegrations(intRes.value.integrations);
      if (msgRes.status === 'fulfilled') setMessagingConfig(msgRes.value.config);
    } finally {
      setLoadingMain(false);
      setLoadingMsg(false);
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

  return (
    <div className="h-full overflow-y-auto">
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

      {/* Delivery integration cards */}
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

      {/* Messaging Provider */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <MessageSquare size={16} className="text-violet-600" />
          <h2 className="text-base font-bold text-ink">Messaging Provider</h2>
        </div>
        <MessagingProviderCard
          config={messagingConfig}
          loading={loadingMsg}
          onSaved={cfg => setMessagingConfig(cfg)}
          onRemoved={() => setMessagingConfig(null)}
          onToast={toast}
        />
      </div>

      {/* WhatsApp Auto-Receipts */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Send size={16} className="text-green-600" />
          <h2 className="text-base font-bold text-ink">WhatsApp Auto-Receipts</h2>
        </div>
        <WhatsAppReceiptsCard onToast={toast} />
      </div>

      {/* Tally Direct Sync */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Zap size={16} className="text-blue-600" />
          <h2 className="text-base font-bold text-ink">Tally Direct Sync</h2>
        </div>
        <TallyCard onToast={toast} />
      </div>

      {/* Webhook logs — self-contained with search, filter, pagination, CSV */}
      <WebhookLogsTable />

      <ToastList toasts={toasts} />
    </div>
    </div>
  );
}
