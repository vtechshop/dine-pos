// Platform Monitor — connection health + menu sync status (read-only)
// Data: GET /superadmin/aggregator/dashboard (platformHealth) and /aggregator/sync-status

import { useEffect, useState, useCallback } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  SAPageHeader, SABadge, SASpin, SAError, fmtAgo,
} from '../../components/ui/SAShared';
import {
  getGlobalSyncStatus, getAggDashboard,
  type SyncStatus, type AggDashboard,
} from '../../api/saAggregator';

type SyncStatusFilter = 'all' | 'syncing' | 'failed' | 'success' | 'idle';
type Health = 'up' | 'down' | 'degraded';

const HEALTH_LABEL: Record<Health, string> = {
  up:       'Working',
  degraded: 'Some problems',
  down:     'Not connected',  // no hotel connected to this platform yet
};

const FILTER_LABEL: Record<SyncStatusFilter, string> = {
  all: 'All', failed: 'Failed', syncing: 'Syncing', success: 'Done', idle: 'Idle',
};

export function AggregatorMonitorPage() {
  const [syncs,     setSyncs]     = useState<SyncStatus[]>([]);
  const [health,    setHealth]    = useState<AggDashboard['platformHealth'] | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [healthErr, setHealthErr] = useState(false);
  const [filter,    setFilter]    = useState<SyncStatusFilter>('all');

  const load = useCallback(async () => {
    setLoading(true); setError(''); setHealthErr(false);
    const [syncRes, dashRes] = await Promise.allSettled([
      getGlobalSyncStatus(),
      getAggDashboard(),
    ]);
    if (syncRes.status === 'fulfilled') setSyncs(syncRes.value.syncs);
    else setError("Couldn't load menu sync status. Please try again.");
    if (dashRes.status === 'fulfilled') setHealth(dashRes.value.platformHealth);
    else setHealthErr(true);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = syncs.filter(s => filter === 'all' || s.status === filter);

  function syncBadge(status: SyncStatus['status']) {
    const map: Record<SyncStatus['status'], { label: string; variant: Parameters<typeof SABadge>[0]['variant'] }> = {
      success: { label: 'Done',    variant: 'green' },
      failed:  { label: 'Failed',  variant: 'red'   },
      syncing: { label: 'Syncing', variant: 'blue'  },
      idle:    { label: 'Idle',    variant: 'gray'  },
    };
    const { label, variant } = map[status] ?? { label: status, variant: 'gray' as const };
    return <SABadge label={label} variant={variant} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Platform Monitor"
        sub="Connection health and menu sync status across all hotels"
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Connection health */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Connection Health</p>
          {loading ? <SASpin /> : health ? (
            <div className="grid grid-cols-3 gap-4">
              {([
                { label: 'Swiggy',         status: health.swiggyApi },
                { label: 'Zomato',         status: health.zomatoApi },
                { label: 'Order Receiver', status: health.webhookServer },
              ] as { label: string; status: Health }[]).map(p => (
                <div key={p.label} className={`rounded-xl border p-4 flex items-center gap-3 ${
                  p.status === 'up'   ? 'border-green-200 bg-green-50' :
                  p.status === 'down' ? 'border-border bg-mist' :
                                        'border-amber-200 bg-amber-50'
                }`}>
                  {p.status === 'up'
                    ? <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                    : <AlertCircle  size={18} className={`${p.status === 'down' ? 'text-ink/35' : 'text-amber-600'} shrink-0`} />}
                  <div>
                    <p className="text-sm font-bold text-ink">{p.label}</p>
                    <SABadge
                      label={HEALTH_LABEL[p.status] ?? p.status}
                      variant={p.status === 'up' ? 'green' : p.status === 'down' ? 'gray' : 'amber'}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : healthErr ? (
            <p className="text-sm text-ink/40">Couldn't check connection health right now. Use Refresh to try again.</p>
          ) : null}
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
                  {FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          </div>

          {loading ? <SASpin /> : error ? <SAError message={error} onRetry={() => void load()} /> : (
            <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-mist">
                    {['Hotel', 'Platform', 'Status', 'Synced', 'Failed', 'Waiting', 'Last Sync'].map(c => (
                      <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink/40">
                        {syncs.length === 0
                          ? 'No menu syncs yet — they appear once a hotel connects Swiggy or Zomato.'
                          : 'No menu syncs match this filter.'}
                      </td>
                    </tr>
                  ) : visible.map((s, i) => (
                    <tr key={`${s.hotelId}-${s.platform}-${i}`} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                      <td className="px-4 py-3 font-semibold text-ink">{s.hotelName}</td>
                      <td className="px-4 py-3 capitalize text-ink/70">{s.platform}</td>
                      <td className="px-4 py-3">{syncBadge(s.status)}</td>
                      <td className="px-4 py-3 text-green-700 text-xs">
                        {s.syncedProducts} items · {s.syncedCategories} categories
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
