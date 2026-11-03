// Delivery Analytics — cross-hotel Swiggy/Zomato performance (read-only).
// Settlement/payout figures are left out on purpose: Swiggy and Zomato settle
// with each hotel directly, so that money is the hotel's business, not ours.
// Data: GET /superadmin/aggregator/analytics

import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { SAStat, SAPageHeader, SASpin, SAError, fmtINR } from '../../components/ui/SAShared';
import { getAggAnalytics, type AggAnalytics } from '../../api/saAggregator';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
};

const EMPTY_PERIOD = 'No Swiggy/Zomato orders in this period.';

export function AggregatorAnalyticsPage() {
  const [from,      setFrom]      = useState(daysAgo(7));
  const [to,        setTo]        = useState(today());
  const [analytics, setAnalytics] = useState<AggAnalytics | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setAnalytics(await getAggAnalytics(from, to)); }
    catch { setAnalytics(null); setError("Couldn't load analytics. Please try again."); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const totalOrders = analytics?.orderGrowth.reduce((s, d) => s + d.count, 0) ?? 0;
  const swiggySales = analytics?.revenueByDay.reduce((s, d) => s + d.swiggy, 0) ?? 0;
  const zomatoSales = analytics?.revenueByDay.reduce((s, d) => s + d.zomato, 0) ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Delivery Analytics"
        sub="How Swiggy & Zomato orders are doing across all hotels"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={to || today()} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
            <input type="date" value={to} min={from} max={today()} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
            <button onClick={() => void load()} disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-brand text-canvas px-3 py-2 text-xs font-semibold disabled:opacity-50">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {loading && <SASpin />}

        {!loading && (
          error ? <SAError message={error} onRetry={() => void load()} /> :
          analytics ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SAStat label="Orders"        value={String(totalOrders)} accent />
                <SAStat label="Swiggy Sales"  value={fmtINR(swiggySales)} />
                <SAStat label="Zomato Sales"  value={fmtINR(zomatoSales)} />
                <SAStat label="Avg Prep Time" value={`${analytics.avgPrepMins} min`} />
                <SAStat label="Accepted"      value={`${analytics.acceptancePct}%`}   icon={<TrendingUp size={18} />} />
                <SAStat label="Cancelled"     value={`${analytics.cancellationPct}%`} warn={analytics.cancellationPct > 10} icon={<TrendingDown size={18} />} />
                <SAStat label="Refunded"      value={`${analytics.refundPct}%`}       warn={analytics.refundPct > 5} />
              </div>

              {/* Top Hotels */}
              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Top Hotels by Orders</p>
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
