// Settlement & Analytics — cross-hotel Swiggy/Zomato money and KPIs (read-only)
// Data: GET /superadmin/aggregator/settlement, GET /superadmin/aggregator/analytics

import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Download } from 'lucide-react';
import {
  SAStat, SAPageHeader, SASpin, SAError, fmtINR,
} from '../../components/ui/SAShared';
import {
  getGlobalSettlement, getAggAnalytics,
  type AggSettlement, type AggAnalytics,
} from '../../api/saAggregator';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
};

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

type AnalyticsTab = 'settlement' | 'analytics';

const EMPTY_PERIOD = 'No Swiggy/Zomato orders in this period.';

export function AggregatorSettlementPage() {
  const [tab,        setTab]        = useState<AnalyticsTab>('settlement');
  const [from,       setFrom]       = useState(daysAgo(7));
  const [to,         setTo]         = useState(today());
  const [settlement, setSettlement] = useState<AggSettlement | null>(null);
  const [analytics,  setAnalytics]  = useState<AggAnalytics | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [settleErr,  setSettleErr]  = useState('');
  const [analyticsErr, setAnalyticsErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setSettleErr(''); setAnalyticsErr('');
    const [settleResult, analyticsResult] = await Promise.allSettled([
      getGlobalSettlement({ from, to }),
      getAggAnalytics(from, to),
    ]);
    if (settleResult.status === 'fulfilled') setSettlement(settleResult.value);
    else { setSettlement(null); setSettleErr("Couldn't load settlement figures. Please try again."); }
    if (analyticsResult.status === 'fulfilled') setAnalytics(analyticsResult.value);
    else { setAnalytics(null); setAnalyticsErr("Couldn't load analytics. Please try again."); }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const exportCSV = () => {
    if (!settlement) return;
    const rows = settlement.byPlatform.map(s => [
      s.platform, fmtINR(s.revenue), fmtINR(s.commission),
      fmtINR(s.refunds), fmtINR(s.netPayout),
    ]);
    const csv = [
      ['Platform', 'Revenue', 'Commission', 'Refunds', 'Net Payout'],
      ...rows,
    ].map(r => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), {
      href: url, download: `aggregator-settlement-${from}-to-${to}.csv`,
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const byHotel = settlement ? [...settlement.byHotel].sort((a, b) => b.revenue - a.revenue) : [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Settlement & Analytics"
        sub="Swiggy & Zomato sales, commission and payout across all hotels"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={to || today()} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
            <input type="date" value={to}   min={from} max={today()} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
            <button onClick={() => void load()} disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-brand text-canvas px-3 py-2 text-xs font-semibold disabled:opacity-50">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            {settlement && settlement.byPlatform.length > 0 && (
              <button onClick={exportCSV} className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-2 text-xs font-medium text-ink/70 hover:bg-mist">
                <Download size={12} /> CSV
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
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

        {loading && <SASpin />}

        {/* Settlement tab */}
        {!loading && tab === 'settlement' && (
          settleErr ? <SAError message={settleErr} onRetry={() => void load()} /> :
          settlement ? (
            <div className="space-y-6">
              {/* By platform */}
              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">By Platform</p>
                <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-mist">
                        {['Platform', 'Sales', 'Commission', 'Pending', 'Paid', 'Refunds', 'Net Payout'].map(c => (
                          <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {settlement.byPlatform.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink/40">{EMPTY_PERIOD}</td>
                        </tr>
                      ) : settlement.byPlatform.map((s, i) => (
                        <tr key={`${s.platform}-${i}`} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
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
              {byHotel.length > 0 && (
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">By Hotel</p>
                  <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-mist">
                          {['Hotel', 'Sales', 'Commission', 'Net'].map(c => (
                            <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {byHotel.map(h => (
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
          ) : null
        )}

        {/* Analytics tab */}
        {!loading && tab === 'analytics' && (
          analyticsErr ? <SAError message={analyticsErr} onRetry={() => void load()} /> :
          analytics ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SAStat label="Accepted"      value={`${analytics.acceptancePct}%`}   accent icon={<TrendingUp size={18} />} />
                <SAStat label="Cancelled"     value={`${analytics.cancellationPct}%`} warn={analytics.cancellationPct > 10} icon={<TrendingDown size={18} />} />
                <SAStat label="Refunded"      value={`${analytics.refundPct}%`}       warn={analytics.refundPct > 5} />
                <SAStat label="Avg Prep Time" value={`${analytics.avgPrepMins} min`} />
              </div>

              {/* Top Hotels */}
              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Top Hotels by Sales</p>
                <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-mist">
                        {['#', 'Hotel', 'Orders', 'Sales'].map(c => (
                          <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.topHotels.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-sm text-ink/40">{EMPTY_PERIOD}</td>
                        </tr>
                      ) : analytics.topHotels.map((h, i) => (
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
              {analytics.topCities.length > 0 && (
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Top Cities</p>
                  <div className="flex flex-wrap gap-3">
                    {analytics.topCities.map(c => (
                      <div key={c.city} className="rounded-xl border border-border bg-canvas px-4 py-3">
                        <p className="font-bold text-ink">{c.city || '—'}</p>
                        <p className="text-xs text-ink/50">{c.orders} orders · {fmtINR(c.revenue)}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Top Items */}
              {analytics.topProducts.length > 0 && (
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Top Items</p>
                  <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-mist">
                          {['Item', 'Qty', 'Sales'].map(c => (
                            <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.topProducts.map((p, i) => (
                          <tr key={`${p.name}-${i}`} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                            <td className="px-4 py-3 font-semibold text-ink">{p.name}</td>
                            <td className="px-4 py-3 font-mono text-ink/70">{p.quantity}</td>
                            <td className="px-4 py-3 font-mono text-ink">{fmtINR(p.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
