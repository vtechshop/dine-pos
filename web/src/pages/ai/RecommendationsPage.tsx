import { useState, useEffect, useCallback } from 'react';
import { Sparkles, ArrowUpRight, RefreshCw } from 'lucide-react';
import {
  fetchRecommendations,
  fetchRecommendationsByDate,
  type RecommendationSet,
  type MenuItemScore,
} from '../../api/aiAlerts';
import { ApiError } from '../../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function fmtRupee(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function Skeleton({ h, w }: { h: string; w?: string }) {
  return <div className={`animate-pulse rounded bg-border ${h} ${w ?? 'w-full'}`} />;
}

// ── Quadrant config ───────────────────────────────────────────────────────────

interface QuadrantCfg {
  key: 'stars' | 'puzzles' | 'plowHorses' | 'dogs';
  label: string;
  subtitle: string;
  cls: string;
}

const QUADRANTS: QuadrantCfg[] = [
  { key: 'puzzles',    label: 'Puzzles ❓',     subtitle: 'Low volume + High profit — MARKET MORE',     cls: 'bg-amber-50 border-amber-200' },
  { key: 'stars',      label: 'Stars ⭐',        subtitle: 'High volume + High profit — PROMOTE',        cls: 'bg-green-50 border-green-200' },
  { key: 'dogs',       label: 'Dogs 🐕',         subtitle: 'Low volume + Low profit — REVIEW OR REMOVE', cls: 'bg-red-50   border-red-200'   },
  { key: 'plowHorses', label: 'Plow Horses 🐴', subtitle: 'High volume + Lower profit — OPTIMIZE COST', cls: 'bg-blue-50  border-blue-200'  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function QuadrantCard({ cfg, items }: { cfg: QuadrantCfg; items: MenuItemScore[] }) {
  return (
    <div className={`rounded-xl border p-4 ${cfg.cls}`}>
      <p className="text-sm font-semibold text-ink">{cfg.label}</p>
      <p className="mb-3 text-[11px] text-ink/50">{cfg.subtitle}</p>
      {items.length === 0 ? (
        <p className="text-xs text-ink/40 italic">No items</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(it => (
            <li key={it.productId} className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-ink">{it.productName}</span>
              <span className="shrink-0 text-[11px] text-ink/60">
                {fmtRupee(it.revenuePerUnit)}/order · {it.qty} sold
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-xl border border-border bg-canvas p-4 space-y-2">
            <Skeleton h="h-4" w="w-1/2" />
            <Skeleton h="h-3" w="w-3/4" />
            <Skeleton h="h-3" />
            <Skeleton h="h-3" />
            <Skeleton h="h-3" w="w-5/6" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-canvas p-4 space-y-2">
        <Skeleton h="h-4" w="w-1/3" />
        {[0, 1, 2].map(i => <Skeleton key={i} h="h-10" />)}
      </div>
      <div className="rounded-xl border border-border bg-canvas p-4 space-y-2">
        <Skeleton h="h-4" w="w-1/4" />
        {[0, 1].map(i => <Skeleton key={i} h="h-8" />)}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RecommendationsPage() {
  const [date, setDate] = useState<string>(yesterday());
  const [data, setData] = useState<RecommendationSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setNotFound(false);
    setError(null);
    setData(null);
    try {
      const result = d === todayStr()
        ? await fetchRecommendations()
        : await fetchRecommendationsByDate(d);
      setData(result);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load recommendations.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(date); }, [date, load]);

  const isYesterday = date === yesterday();

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-ink">AI Recommendations</h1>
            <p className="text-xs text-ink/50">Menu engineering + upsell intelligence</p>
          </div>
          <div className="flex items-center gap-2">
            {!isYesterday && (
              <button
                onClick={() => setDate(yesterday())}
                className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist transition-colors"
              >
                Yesterday
              </button>
            )}
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={e => setDate(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              onClick={() => void load(date)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Loading */}
        {loading && <LoadingSkeleton />}

        {/* Not found */}
        {!loading && notFound && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <p className="text-3xl">📭</p>
            <p className="text-sm font-medium text-ink">No data available for {date}.</p>
            <p className="text-xs text-ink/50 max-w-xs">
              Select a date when the restaurant was open.
            </p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Data */}
        {!loading && data && (
          <>
            {/* AI Insight */}
            {data.insightSource === 'unavailable' || !data.insight ? (
              <div className="rounded-xl border border-border bg-canvas p-4 flex items-center gap-3">
                <Sparkles size={16} className="text-ink/30 shrink-0" />
                <p className="text-xs text-ink/40 italic">AI insight unavailable for this date.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 flex gap-3">
                <Sparkles size={16} className="mt-0.5 shrink-0 text-brand" />
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand/70">
                    AI Insight · {data.insightSource === 'cache' ? 'Cached' : 'Gemini'}
                  </p>
                  <p className="text-sm text-ink leading-relaxed">{data.insight}</p>
                </div>
              </div>
            )}

            {/* Menu Engineering Matrix */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-ink">Menu Engineering Matrix</h2>
              <div className="grid grid-cols-2 gap-3">
                {QUADRANTS.map(cfg => (
                  <QuadrantCard key={cfg.key} cfg={cfg} items={data[cfg.key]} />
                ))}
              </div>
            </section>

            {/* Upsell Targets */}
            {data.upsellTargets.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-ink">Upsell Targets</h2>
                <div className="space-y-2">
                  {data.upsellTargets.map((t, i) => (
                    <div key={i} className="rounded-xl border border-border bg-canvas p-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <ArrowUpRight size={14} className="shrink-0 text-green-600" />
                          <span className="text-sm font-medium text-ink truncate">{t.productName}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink/55">{t.reason}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-ink">{fmtRupee(t.revenuePerUnit)}</p>
                        <p className="text-[11px] text-ink/50">{t.currentOrders} orders</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Cross-Sell Suggestions */}
            {data.crossSell.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-ink">Cross-Sell Suggestions</h2>
                <div className="rounded-xl border border-border bg-canvas divide-y divide-border">
                  {data.crossSell.map((cs, i) => (
                    <div key={i} className="px-4 py-3">
                      <p className="text-sm font-medium text-ink">
                        {cs.triggerItem}
                        <span className="mx-1.5 text-brand font-bold">→</span>
                        {cs.suggestItem}
                      </p>
                      <p className="mt-0.5 text-xs text-ink/50">{cs.reason}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Combos */}
            {data.combos.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-ink">Combo Suggestions</h2>
                <div className="rounded-xl border border-border bg-canvas divide-y divide-border">
                  {data.combos.map((c, i) => (
                    <div key={i} className="px-4 py-3">
                      <p className="text-sm font-medium text-ink">
                        {c.items.join(' + ')}
                      </p>
                      <p className="mt-0.5 text-xs text-ink/50">{c.reason}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Slow Movers */}
            {data.slowMovers.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-ink">Slow Movers</h2>
                <div className="rounded-xl border border-border bg-canvas overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-mist">
                        <th className="px-4 py-2 text-left font-medium text-ink/60">Product</th>
                        <th className="px-4 py-2 text-right font-medium text-ink/60">Qty</th>
                        <th className="px-4 py-2 text-right font-medium text-ink/60">Revenue</th>
                        <th className="px-4 py-2 text-left font-medium text-ink/60">Suggestion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.slowMovers.map((sm, i) => (
                        <tr key={i} className="bg-amber-50 border-b border-amber-100 last:border-0">
                          <td className="px-4 py-2 font-medium text-ink">{sm.productName}</td>
                          <td className="px-4 py-2 text-right text-ink/70">{sm.qty}</td>
                          <td className="px-4 py-2 text-right text-ink/70">{fmtRupee(sm.revenue)}</td>
                          <td className="px-4 py-2 text-ink/60">{sm.suggestion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Footer meta */}
            <p className="text-center text-[11px] text-ink/30 pb-2">
              Generated {new Date(data.generatedAt).toLocaleString('en-IN')} · Source: {data.insightSource}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
