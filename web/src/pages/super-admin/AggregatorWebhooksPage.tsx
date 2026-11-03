// Webhook Monitor — messages received from Swiggy/Zomato across all hotels (read-only)
// Data: GET /superadmin/aggregator/webhooks

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  SABadge, SAPageHeader, SASpin, SAError, fmtDateTime,
} from '../../components/ui/SAShared';
import {
  getGlobalWebhooks,
  type SAWebhookLog, type AggPlatform,
} from '../../api/saAggregator';

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

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
  const [total,     setTotal]     = useState(0);
  const [page,      setPage]      = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError,   setMoreError]   = useState('');

  const query = useCallback((p: number) => getGlobalWebhooks({
    from, to,
    platform: platform !== 'all' ? platform : undefined,
    status:   status   !== 'all' ? status   : undefined,
    page:     p,
  }), [from, to, platform, status]);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMoreError('');
    try {
      const res = await query(1);
      setLogs(res.logs);
      setTotal(res.total);
      setPage(1);
    } catch {
      setError("Couldn't load webhooks. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true); setMoreError('');
    try {
      const next = page + 1;
      const res  = await query(next);
      setLogs(prev => {
        const seen = new Set(prev.map(l => l._id));
        return [...prev, ...res.logs.filter(l => !seen.has(l._id))];
      });
      setTotal(res.total);
      setPage(next);
    } catch {
      setMoreError("Couldn't load more webhooks. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const failedCount  = logs.filter(l => l.status === 'failed').length;
  const successCount  = logs.filter(l => l.status === 'success').length;
  const avgLatency    = logs.length ? Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / logs.length) : 0;

  const exportCSV = () => {
    const rows = logs.map(l => [l.hotelName, l.platform, l.event, l.status, l.latencyMs, l.retryCount, fmtDateTime(l.createdAt)]);
    const csv = [['Hotel', 'Platform', 'Event', 'Status', 'Latency(ms)', 'Retries', 'Created'], ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `aggregator-webhooks-${from}-to-${to}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Webhook Monitor"
        sub="Order messages received from Swiggy & Zomato across all hotels"
        onRefresh={() => void load()}
        refreshing={loading}
        action={
          <button onClick={exportCSV} disabled={loading || logs.length === 0}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-canvas text-ink/70 hover:bg-mist disabled:opacity-50">
            Export CSV
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
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
                  {['Hotel', 'Platform', 'Event', 'Status', 'Latency', 'Retries', 'Payload', 'Created', 'Problem'].map(c => (
                    <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink/40">
                      {platform === 'all' && status === 'all'
                        ? 'No webhooks received in this period — they appear once a hotel connects Swiggy or Zomato.'
                        : 'No webhooks match these filters.'}
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
                    <td className="px-4 py-3 text-[11px] text-red-600 max-w-[220px] truncate" title={l.errorMessage ?? ''}>
                      {l.errorMessage ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && logs.length < total && (
          <div className="flex flex-col items-center gap-2">
            {moreError && <p className="text-xs text-red-600">{moreError}</p>}
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-4 py-2 text-sm font-medium text-ink/70 hover:bg-mist disabled:opacity-50"
            >
              {loadingMore && <RefreshCw size={14} className="animate-spin" />}
              Show more ({logs.length} of {total})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
