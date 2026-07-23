// M10 — Webhook Monitoring
// Requires: GET /superadmin/aggregator/webhooks, POST /superadmin/aggregator/webhooks/:id/retry

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import {
  ApiRequired, SABadge, SAPageHeader, SASpin, SAError, fmtDateTime,
} from '../../components/ui/SAShared';
import {
  getGlobalWebhooks, retryGlobalWebhook,
  type SAWebhookLog, type AggPlatform,
} from '../../api/saAggregator';

const WEBHOOK_ENDPOINTS = [
  'GET  /superadmin/aggregator/webhooks              — global webhook log (hotel, platform, event, status, latency)',
  'POST /superadmin/aggregator/webhooks/:id/retry    — retry individual failed webhook',
];

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

export function AggregatorWebhooksPage() {
  const [logs,      setLogs]      = useState<SAWebhookLog[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [from,      setFrom]      = useState(daysAgo(1));
  const [to,        setTo]        = useState(today());
  const [platform,  setPlatform]  = useState<AggPlatform | 'all'>('all');
  const [status,    setStatus]    = useState<string>('all');
  const [retrying,  setRetrying]  = useState<string | null>(null);
  const [retryMsg,  setRetryMsg]  = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getGlobalWebhooks({
        from, to,
        platform: platform !== 'all' ? platform : undefined,
        status:   status   !== 'all' ? status   : undefined,
      });
      setLogs(res.logs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, [from, to, platform, status]);

  useEffect(() => { void load(); }, [load]);

  const handleRetry = async (log: SAWebhookLog) => {
    setRetrying(log._id);
    try {
      const res = await retryGlobalWebhook(log._id);
      setRetryMsg(prev => ({ ...prev, [log._id]: res.message }));
      void load();
    } catch (e) {
      setRetryMsg(prev => ({ ...prev, [log._id]: e instanceof Error ? e.message : 'Failed' }));
    } finally {
      setRetrying(null);
    }
  };

  const failedCount   = logs.filter(l => l.status === 'failed').length;
  const successCount  = logs.filter(l => l.status === 'success').length;
  const avgLatency    = logs.length ? Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / logs.length) : 0;

  const exportCSV = () => {
    const rows = logs.map(l => [l.hotelName, l.platform, l.event, l.status, l.latencyMs, l.retryCount, fmtDateTime(l.createdAt)]);
    const csv = [['Hotel', 'Platform', 'Event', 'Status', 'Latency(ms)', 'Retries', 'Created'], ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `webhooks_${from}.csv` }).click();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Webhook Monitor"
        sub="Global webhook delivery log across all hotels and platforms"
        onRefresh={() => void load()}
        refreshing={loading}
        action={
          <button onClick={exportCSV} className="px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-canvas text-ink/70 hover:bg-mist">
            Export CSV
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        <ApiRequired endpoints={WEBHOOK_ENDPOINTS} />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <input type="date" value={from} max={today()} onChange={e => setFrom(e.target.value)}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
          <input type="date" value={to}   max={today()} onChange={e => setTo(e.target.value)}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
          <select value={platform} onChange={e => setPlatform(e.target.value as AggPlatform | 'all')}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none">
            <option value="all">All Platforms</option>
            <option value="swiggy">Swiggy</option>
            <option value="zomato">Zomato</option>
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none">
            <option value="all">All Status</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="retrying">Retrying</option>
          </select>
        </div>

        {/* Summary chips */}
        {!loading && !error && (
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="rounded-full border border-border bg-canvas px-3 py-1 font-semibold text-ink/70">{logs.length} total</span>
            <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 font-semibold text-green-700">{successCount} success</span>
            {failedCount > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 font-semibold text-red-700">{failedCount} failed</span>}
            <span className="rounded-full border border-border bg-canvas px-3 py-1 font-semibold text-ink/60">Avg {avgLatency}ms</span>
          </div>
        )}

        {loading ? <SASpin /> : error ? <SAError message={error} onRetry={() => void load()} /> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-mist">
                  {['Hotel', 'Platform', 'Event', 'Status', 'Latency', 'Retries', 'Payload', 'Created', ''].map(c => (
                    <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink/40">
                      No webhooks — requires <code className="font-mono text-xs bg-mist px-1 rounded">GET /superadmin/aggregator/webhooks</code>
                    </td>
                  </tr>
                ) : logs.map(l => (
                  <tr key={l._id} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                    <td className="px-4 py-3 font-semibold text-ink max-w-[120px] truncate">{l.hotelName}</td>
                    <td className="px-4 py-3">
                      <SABadge label={l.platform} variant={l.platform === 'swiggy' ? 'amber' : 'red'} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink/70">{l.event}</td>
                    <td className="px-4 py-3">
                      <SABadge label={l.status} variant={l.status === 'success' ? 'green' : l.status === 'failed' ? 'red' : 'amber'} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink/60">{l.latencyMs}ms</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink/60">{l.retryCount}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink/60">
                      {l.payloadBytes >= 1024 ? `${(l.payloadBytes / 1024).toFixed(1)}KB` : `${l.payloadBytes}B`}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/50 whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                    <td className="px-4 py-3">
                      {l.status === 'failed' && (
                        <button
                          onClick={() => void handleRetry(l)} disabled={retrying === l._id}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-brand/20 bg-brand/5 text-brand hover:bg-brand/10 disabled:opacity-50"
                        >
                          {retrying === l._id ? <RefreshCw size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                          Retry
                        </button>
                      )}
                      {retryMsg[l._id] && (
                        <p className="text-[10px] text-ink/50 mt-0.5">{retryMsg[l._id]}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
