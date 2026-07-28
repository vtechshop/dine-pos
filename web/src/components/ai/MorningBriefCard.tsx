import { useState } from 'react';
import {
  Sunrise, ChevronDown, ChevronUp, ChevronRight, TrendingUp, TrendingDown,
  Package, Zap, AlertTriangle, Star, Clock,
} from 'lucide-react';
import type { MorningBrief } from '../../api/morningBrief';

// ── Grade color helpers ────────────────────────────────────────────────────────

function gradeColor(grade: string): string {
  const map: Record<string, string> = {
    A: 'text-green-600',
    B: 'text-blue-600',
    C: 'text-yellow-600',
    D: 'text-orange-500',
    F: 'text-red-600',
  };
  return map[grade] ?? 'text-ink/60';
}

function gradeBg(grade: string): string {
  const map: Record<string, string> = {
    A: 'bg-green-50 border-green-200',
    B: 'bg-blue-50 border-blue-200',
    C: 'bg-yellow-50 border-yellow-200',
    D: 'bg-orange-50 border-orange-200',
    F: 'bg-red-50 border-red-200',
  };
  return map[grade] ?? 'bg-mist border-border';
}

// ── Trend arrow ───────────────────────────────────────────────────────────────

function TrendBadge({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return null;
  const pos = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${pos ? 'text-green-600' : 'text-red-500'}`}>
      {pos ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {pos ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

// ── Sub-section heading ───────────────────────────────────────────────────────

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/40">
      {children}
    </h4>
  );
}

// ── Pill list ─────────────────────────────────────────────────────────────────

function PillList({ items, color }: { items: string[]; color: string }) {
  if (!items.length) return <span className="text-xs text-ink/35">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((name) => (
        <span
          key={name}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${color}`}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

// ── UTC hour → browser local time ────────────────────────────────────────────
// peakHour and topBusyHours are stored as UTC integers (0-23).
// Construct a Date at that UTC hour and format in the device's local timezone.
function utcHourToLocal(h: number): string {
  const d = new Date();
  d.setUTCHours(h % 24, 0, 0, 0);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Main component ────────────────────────────────────────────────────────────

interface MorningBriefCardProps {
  brief:   MorningBrief;
  loading?: boolean;
}

export function MorningBriefCard({ brief, loading = false }: MorningBriefCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (loading || !brief) {
    return (
      <div className="animate-pulse border-b border-border bg-canvas px-5 py-4">
        <div className="mb-3 h-4 w-48 rounded bg-border" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-border" />
          ))}
        </div>
      </div>
    );
  }

  const { business: b, inventory: inv, forecast: fc, menu: m } = brief;
  const currency = '₹';

  return (
    <div className="border-b border-border bg-canvas">
      {/* ── Collapsed header (always visible) ────────────────────────────────── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-mist"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5">
          <Sunrise size={15} className="text-brand shrink-0" />
          <div>
            <span className="text-sm font-semibold text-ink">Morning Brief</span>
            <span className="ml-2 text-xs text-ink/40">
              {new Date(brief.date + 'T00:00:00Z').toLocaleDateString('en-IN', {
                weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
              })}
            </span>
          </div>

          {/* Health score pill */}
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${gradeBg(b.healthGrade)} ${gradeColor(b.healthGrade)}`}>
            {b.healthGrade} · {b.healthScore}
          </span>

          {/* Warning badge */}
          {brief.warning && (
            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              <AlertTriangle size={9} />
              Alert
            </span>
          )}
        </div>

        {/* Collapsed KPI strip — revenue always visible, orders/avg hidden on mobile */}
        {!expanded && (
          <div className="flex items-center gap-3 sm:gap-5">
            <span className="text-xs">
              <span className="font-semibold text-ink">{currency}{Math.round(b.revenue).toLocaleString('en-IN')}</span>
              <span className="ml-1 hidden text-ink/40 sm:inline">rev</span>
              <TrendBadge pct={b.revenueVs7DayAvgPct} />
            </span>
            <span className="hidden text-xs sm:inline">
              <span className="font-semibold text-ink">{b.orders}</span>
              <span className="ml-1 text-ink/40">orders</span>
            </span>
            <span className="hidden text-xs sm:inline">
              <span className="font-semibold text-ink">{currency}{Math.round(b.avgBill)}</span>
              <span className="ml-1 text-ink/40">avg</span>
            </span>
          </div>
        )}

        {expanded
          ? <ChevronUp size={14} className="shrink-0 text-ink/40" />
          : <ChevronDown size={14} className="shrink-0 text-ink/40" />
        }
      </button>

      {/* ── Expanded body ─────────────────────────────────────────────────────── */}
      {expanded && (
        <div className="px-5 pb-5 pt-1 space-y-5">

          {/* Executive summary */}
          {brief.executiveSummary && (
            <p className="rounded-lg border border-brand/15 bg-brand/5 px-4 py-3 text-sm leading-relaxed text-ink">
              {brief.executiveSummary}
            </p>
          )}

          {/* KPI grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-mist p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Revenue</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-ink">{currency}{Math.round(b.revenue).toLocaleString('en-IN')}</p>
              <TrendBadge pct={b.revenueVs7DayAvgPct} />
            </div>
            <div className="rounded-xl border border-border bg-mist p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Orders</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-ink">{b.orders}</p>
              <div className="flex items-center gap-2">
                <TrendBadge pct={b.ordersVs7DayAvgPct} />
                {b.cancelledOrders > 0 && (
                  <span className="text-[10px] text-ink/35">{b.cancelledOrders} cancelled</span>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-mist p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Est. Profit</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-ink">{currency}{Math.round(b.estimatedProfit).toLocaleString('en-IN')}</p>
              <p className="text-[10px] text-ink/35">{b.estimatedProfitMarginPct.toFixed(0)}% margin est.</p>
            </div>
            <div className="rounded-xl border border-border bg-mist p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Avg Bill</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-ink">{currency}{Math.round(b.avgBill)}</p>
              <p className="text-[10px] text-ink/35">{b.topPaymentMethod} top method</p>
            </div>
          </div>

          {/* Top seller + peak hour */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {b.topSellingItem && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-mist px-4 py-3">
                <Star size={14} className="shrink-0 text-amber-500" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Top Seller</p>
                  <p className="text-sm font-semibold text-ink">{b.topSellingItem}</p>
                  <p className="text-[10px] text-ink/40">{currency}{Math.round(b.topSellingItemRevenue).toLocaleString('en-IN')} · {b.topSellingItemQty} sold</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 rounded-lg border border-border bg-mist px-4 py-3">
              <Clock size={14} className="shrink-0 text-blue-500" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Peak Hour</p>
                <p className="text-sm font-semibold text-ink">{utcHourToLocal(b.peakHour)} – {utcHourToLocal(b.peakHour + 1)}</p>
                <p className="text-[10px] text-ink/40">highest revenue window</p>
              </div>
            </div>
          </div>

          {/* Inventory alerts */}
          {(inv.criticalCount > 0 || inv.warningCount > 0) && (
            <div>
              <SectionHead><Package size={10} className="inline mr-1" />Inventory Alerts</SectionHead>
              <div className="space-y-2">
                {inv.criticalItems.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-medium text-red-600">Critical — reorder today ({inv.criticalItems.length})</p>
                    <PillList items={inv.criticalItems} color="border-red-200 bg-red-50 text-red-700" />
                  </div>
                )}
                {inv.warningItems.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-medium text-amber-600">Low stock ({inv.warningItems.length})</p>
                    <PillList items={inv.warningItems} color="border-amber-200 bg-amber-50 text-amber-700" />
                  </div>
                )}
                {inv.overstockItems.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-medium text-sky-600">Overstocked ({inv.overstockItems.length})</p>
                    <PillList items={inv.overstockItems} color="border-sky-200 bg-sky-50 text-sky-700" />
                  </div>
                )}
                {inv.totalReorderCost > 0 && (
                  <p className="text-xs text-ink/50">Est. reorder cost: <span className="font-semibold text-ink">₹{Math.round(inv.totalReorderCost).toLocaleString('en-IN')}</span></p>
                )}
              </div>
            </div>
          )}

          {/* Slow movers */}
          {m.slowMovers.length > 0 && (
            <div>
              <SectionHead>Slow Movers</SectionHead>
              <p className="mb-2 text-[10px] text-ink/40">Low-frequency items from yesterday — consider promotion or removal</p>
              <PillList items={m.slowMovers} color="border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400" />
            </div>
          )}

          {/* Forecast */}
          <div>
            <SectionHead><Zap size={10} className="inline mr-1" />Today's Forecast</SectionHead>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-mist p-3">
                <p className="text-[10px] text-ink/40">Expected Revenue</p>
                <p className="text-base font-bold tabular-nums text-ink">₹{Math.round(fc.expectedRevenue).toLocaleString('en-IN')}</p>
              </div>
              <div className="rounded-lg border border-border bg-mist p-3">
                <p className="text-[10px] text-ink/40">Expected Orders</p>
                <p className="text-base font-bold tabular-nums text-ink">{fc.expectedOrders}</p>
              </div>
              <div className="rounded-lg border border-border bg-mist p-3">
                <p className="text-[10px] text-ink/40">Expected AOV</p>
                <p className="text-base font-bold tabular-nums text-ink">₹{Math.round(fc.expectedAov)}</p>
              </div>
            </div>
            {fc.topBusyHours.length > 0 && (
              <p className="mt-2 text-xs text-ink/50">
                Busy hours: <span className="font-medium text-ink">{fc.topBusyHours.slice(0, 3).map(utcHourToLocal).join(', ')}</span>
                {fc.forecastConfidence > 0 && (
                  <span className="ml-2 text-ink/35">· {(fc.forecastConfidence * 100).toFixed(0)}% confidence ({fc.method})</span>
                )}
              </p>
            )}
          </div>

          {/* AI recommendations */}
          {brief.recommendations.length > 0 && (
            <div>
              <SectionHead>AI Recommendations</SectionHead>
              <ul className="space-y-2">
                {brief.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink">
                    <ChevronRight size={13} className="mt-0.5 shrink-0 text-brand" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Opportunity + warning */}
          {(brief.opportunity || brief.warning) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {brief.opportunity && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-600">Opportunity</p>
                  <p className="text-xs text-blue-900 leading-relaxed">{brief.opportunity}</p>
                </div>
              )}
              {brief.warning && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    <AlertTriangle size={9} />Warning
                  </p>
                  <p className="text-xs text-amber-900 leading-relaxed">{brief.warning}</p>
                </div>
              )}
            </div>
          )}

          <p className="text-right text-[10px] text-ink/30">
            Generated {new Date(brief.generatedAt).toLocaleString('en-IN')}
          </p>
        </div>
      )}
    </div>
  );
}
