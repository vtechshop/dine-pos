// M7 + M8 — Settlement Monitoring + Analytics
// Requires: GET /superadmin/aggregator/settlement, GET /superadmin/aggregator/analytics

import { useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Download } from 'lucide-react';
import {
  ApiRequired, SAStat, SAPageHeader, SASpin, SAError, fmtINR,
} from '../../components/ui/SAShared';
import {
  getGlobalSettlement, getAggAnalytics,
  type AggSettlementSummary,
} from '../../api/saAggregator';

const SETTLEMENT_ENDPOINTS = [
  'GET /superadmin/aggregator/settlement?from=&to= — cross-hotel settlement (revenue, commission, refunds, net)',
  'GET /superadmin/aggregator/analytics?from=&to= — aggregator analytics (charts, KPIs, top hotels/cities)',
];

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
};

type AnalyticsTab = 'settlement' | 'analytics';

export function AggregatorSettlementPage() {
  const [tab,        setTab]        = useState<AnalyticsTab>('settlement');
  const [from,       setFrom]       = useState(daysAgo(7));
  const [to,         setTo]         = useState(today());
  const [settlement, setSettlement] = useState<{ byPlatform: AggSettlementSummary[]; byHotel: { hotelId: string; hotelName: string; revenue: number; commission: number; net: number }[] } | null>(null);
  const [analytics,  setAnalytics]  = useState<{
    acceptancePct: number; cancellationPct: number; refundPct: number; avgPrepMins: number;
    topHotels: { hotelId: string; hotelName: string; orders: number; revenue: number }[];
    topCities:  { city: string; orders: number; revenue: number }[];
    topProducts:{ name: string; quantity: number; revenue: number }[];
  } | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const [settleResult, analyticsResult] = await Promise.allSettled([
      getGlobalSettlement({ from, to }),
      getAggAnalytics(from, to),
    ]);
    if (settleResult.status   === 'fulfilled') setSettlement(settleResult.value);
    if (analyticsResult.status === 'fulfilled') setAnalytics(analyticsResult.value);
    if (settleResult.status   === 'rejected')   setError(settleResult.reason instanceof Error ? settleResult.reason.message : 'Failed');
    setLoading(false);
  }, [from, to]);

  const exportCSV = () => {
    if (!settlement) return;
    const rows = settlement.byPlatform.map(s => [
      s.platform, fmtINR(s.revenue), fmtINR(s.commission),
      fmtINR(s.refunds), fmtINR(s.netPayout),
    ]);
    const csv = [
      ['Platform', 'Revenue', 'Commission', 'Refunds', 'Net Payout'],
      ...rows,
    ].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `sa_settlement_${from}_${to}.csv`,
    }).click();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Settlement & Analytics"
        sub="Cross-hotel revenue, commission, net payout and aggregator KPIs"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={today()} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
            <input type="date" value={to}   max={today()} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
            <button onClick={() => void load()} disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-brand text-canvas px-3 py-2 text-xs font-semibold disabled:opacity-50">
              {loading ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Load
            </button>
            {settlement && (
              <button onClick={exportCSV} className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-2 text-xs font-medium text-ink/70 hover:bg-mist">
                <Download size={12} /> CSV
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <ApiRequired endpoints={SETTLEMENT_ENDPOINTS} />

        {/* Tabs */}
        <div className="flex border-b border-border">
          {(['settlement', 'analytics'] as AnalyticsTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px capitalize transition ${
                tab === t ? 'border-brand text-brand' : 'border-transparent text-ink/50 hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {error && <SAError message={error} onRetry={() => void load()} />}
        {loading && <SASpin />}

        {/* Settlement tab */}
        {!loading && tab === 'settlement' && (
          settlement ? (
            <div className="space-y-6">
              {/* By platform */}
              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">By Platform</p>
                <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-mist">
                        {['Platform', 'Revenue', 'Commission', 'Pending', 'Completed', 'Refunds', 'Net Payout'].map(c => (
                          <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {settlement.byPlatform.map((s, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                          <td className="px-4 py-3 font-bold text-ink capitalize">{s.platform}</td>
                          <td className="px-4 py-3 font-mono text-ink">{fmtINR(s.revenue)}</td>
                          <td className="px-4 py-3 font-mono text-red-600">−{fmtINR(s.commission)}</td>
                          <td className="px-4 py-3 font-mono text-amber-700">{fmtINR(s.pending)}</td>
                          <td className="px-4 py-3 font-mono text-green-700">{fmtINR(s.complete)}</td>
                          <td className="px-4 py-3 font-mono text-red-600">−{fmtINR(s.refunds)}</td>
                          <td className="px-4 py-3 font-mono font-black text-green-700">{fmtINR(s.netPayout)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* By hotel */}
              {settlement.byHotel.length > 0 && (
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">By Hotel</p>
                  <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-mist">
                          {['Hotel', 'Revenue', 'Commission', 'Net'].map(c => (
                            <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {settlement.byHotel.sort((a, b) => b.revenue - a.revenue).map(h => (
                          <tr key={h.hotelId} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                            <td className="px-4 py-3 font-semibold text-ink">{h.hotelName}</td>
                            <td className="px-4 py-3 font-mono text-ink">{fmtINR(h.revenue)}</td>
                            <td className="px-4 py-3 font-mono text-red-600">−{fmtINR(h.commission)}</td>
                            <td className="px-4 py-3 font-mono font-bold text-green-700">{fmtINR(h.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-ink/40">
              Set a date range and click Load to fetch settlement data.
            </div>
          )
        )}

        {/* Analytics tab */}
        {!loading && tab === 'analytics' && (
          analytics ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SAStat label="Acceptance Rate"   value={`${analytics.acceptancePct}%`}   accent icon={<TrendingUp size={18} />} />
                <SAStat label="Cancellation Rate" value={`${analytics.cancellationPct}%`} warn={analytics.cancellationPct > 10} icon={<TrendingDown size={18} />} />
                <SAStat label="Refund Rate"       value={`${analytics.refundPct}%`}       warn={analytics.refundPct > 5} />
                <SAStat label="Avg Prep Time"     value={`${analytics.avgPrepMins}m`}     sub="minutes" />
              </div>

              {/* Top Hotels */}
              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Top Hotels by Revenue</p>
                <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-mist">
                        {['#', 'Hotel', 'Orders', 'Revenue'].map(c => (
                          <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.topHotels.map((h, i) => (
                        <tr key={h.hotelId} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                          <td className="px-4 py-3 font-mono text-ink/40">{i + 1}</td>
                          <td className="px-4 py-3 font-semibold text-ink">{h.hotelName}</td>
                          <td className="px-4 py-3 font-mono text-ink/70">{h.orders}</td>
                          <td className="px-4 py-3 font-mono font-bold text-brand">{fmtINR(h.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Top Cities */}
              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Top Cities</p>
                <div className="flex flex-wrap gap-3">
                  {analytics.topCities.map(c => (
                    <div key={c.city} className="rounded-xl border border-border bg-canvas px-4 py-3">
                      <p className="font-bold text-ink">{c.city}</p>
                      <p className="text-xs text-ink/50">{c.orders} orders · {fmtINR(c.revenue)}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-ink/40">
              Set a date range and click Load to fetch analytics.
            </div>
          )
        )}
      </div>
    </div>
  );
}
