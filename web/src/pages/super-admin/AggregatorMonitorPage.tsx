// M4 + M5 — Platform Monitoring + Menu Sync Monitor
// All data requires SA backend — /superadmin/aggregator/sync-status & platform health

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import {
  ApiRequired, SAPageHeader, SABadge, SASpin, SAError, fmtAgo,
} from '../../components/ui/SAShared';
import {
  getGlobalSyncStatus, retryAllSync,
  type SyncStatus,
} from '../../api/saAggregator';

const MONITOR_ENDPOINTS = [
  'GET  /superadmin/aggregator/dashboard         — platform health (swiggyApi, zomatoApi, webhookServer)',
  'GET  /superadmin/aggregator/sync-status       — global menu sync status per hotel per platform',
  'POST /superadmin/aggregator/retry-all-sync    — retry all failed menu syncs',
];

type SyncStatusFilter = 'all' | 'syncing' | 'failed' | 'success' | 'idle';

export function AggregatorMonitorPage() {
  const [syncs,     setSyncs]     = useState<SyncStatus[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [filter,    setFilter]    = useState<SyncStatusFilter>('all');
  const [retrying,  setRetrying]  = useState(false);
  const [retryMsg,  setRetryMsg]  = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getGlobalSyncStatus();
      setSyncs(res.syncs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sync status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRetryAll = async () => {
    setRetrying(true); setRetryMsg('');
    try {
      const res = await retryAllSync();
      setRetryMsg(`Queued ${res.queued} syncs for retry`);
      void load();
    } catch (e) {
      setRetryMsg(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const visible = syncs.filter(s => filter === 'all' || s.status === filter);
  const failed  = syncs.filter(s => s.status === 'failed').length;

  function syncBadge(status: SyncStatus['status']) {
    const map: Record<SyncStatus['status'], { label: string; variant: Parameters<typeof SABadge>[0]['variant'] }> = {
      success: { label: 'Success', variant: 'green' },
      failed:  { label: 'Failed',  variant: 'red'   },
      syncing: { label: 'Syncing', variant: 'blue'  },
      idle:    { label: 'Idle',    variant: 'gray'  },
    };
    const { label, variant } = map[status];
    return <SABadge label={label} variant={variant} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Platform Monitor"
        sub="Live API health · menu sync status across all hotels"
        onRefresh={() => void load()}
        refreshing={loading}
        action={
          failed > 0 ? (
            <button
              onClick={() => void handleRetryAll()} disabled={retrying}
              className="flex items-center gap-1.5 rounded-lg bg-brand text-canvas px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {retrying ? <RefreshCw size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              Retry All Failed ({failed})
            </button>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <ApiRequired endpoints={MONITOR_ENDPOINTS} />

        {retryMsg && (
          <p className="text-xs text-brand bg-brand/5 border border-brand/20 rounded-lg px-3 py-2">{retryMsg}</p>
        )}

        {/* Platform health — requires backend; show skeleton */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Platform API Health</p>
          <div className="grid grid-cols-3 gap-4">
            {['Swiggy API', 'Zomato API', 'Webhook Server'].map(label => (
              <div key={label} className="rounded-xl border border-border bg-canvas p-4 flex items-center gap-3">
                <AlertCircle size={18} className="text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-ink">{label}</p>
                  <p className="text-[10px] text-amber-600">Requires /superadmin/aggregator/dashboard</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Menu sync monitor */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Menu Sync Status</p>
            <div className="flex gap-2">
              {(['all', 'failed', 'syncing', 'success', 'idle'] as SyncStatusFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase border transition ${
                    filter === f ? 'bg-brand/10 text-brand border-brand/20' : 'border-border text-ink/50 bg-canvas hover:bg-mist'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {loading ? <SASpin /> : error ? <SAError message={error} onRetry={() => void load()} /> : (
            <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-mist">
                    {['Hotel', 'Platform', 'Status', 'Synced', 'Failed', 'Retry', 'Last Sync'].map(c => (
                      <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink/40">
                        No sync data — requires <code className="font-mono text-xs bg-mist px-1 rounded">GET /superadmin/aggregator/sync-status</code>
                      </td>
                    </tr>
                  ) : visible.map((s, i) => (
                    <tr key={`${s.hotelId}-${s.platform}-${i}`} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                      <td className="px-4 py-3 font-semibold text-ink">{s.hotelName}</td>
                      <td className="px-4 py-3 capitalize text-ink/70">{s.platform}</td>
                      <td className="px-4 py-3">{syncBadge(s.status)}</td>
                      <td className="px-4 py-3 text-green-700 font-mono">
                        {s.syncedProducts}p / {s.syncedCategories}c
                      </td>
                      <td className="px-4 py-3">
                        {s.failedProducts > 0
                          ? <span className="flex items-center gap-1 text-red-600"><AlertCircle size={12} />{s.failedProducts}</span>
                          : <span className="flex items-center gap-1 text-green-600"><CheckCircle2 size={12} />0</span>
                        }
                      </td>
                      <td className="px-4 py-3 font-mono text-ink/60">{s.retryPending}</td>
                      <td className="px-4 py-3 text-ink/50 text-xs">{fmtAgo(s.lastSync)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
