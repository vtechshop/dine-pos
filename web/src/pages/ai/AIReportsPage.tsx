import { useState, useEffect, useCallback } from 'react';
import { BarChart2, TrendingUp, TrendingDown, RefreshCw, Calendar, AlertTriangle, Info } from 'lucide-react';
import { fetchAIReport } from '../../api/aiReport';
import type { DailyReportPayload } from '../../api/aiReport';
import { ApiError } from '../../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toYMD(d: Date): string { return d.toISOString().slice(0, 10); }
function yesterday(): string { const d = new Date(); d.setDate(d.getDate() - 1); return toYMD(d); }
function fmtNum(n: number): string { return n.toLocaleString('en-IN'); }
function fmtRev(n: number): string { return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }

const GRADE_BG: Record<string, string> = { A: 'bg-green-500', B: 'bg-blue-500', C: 'bg-yellow-400', D: 'bg-orange-500', F: 'bg-red-500' };
const GRADE_FG: Record<string, string> = { A: 'text-green-600', B: 'text-blue-600', C: 'text-yellow-600', D: 'text-orange-600', F: 'text-red-600' };

// ── Atoms ─────────────────────────────────────────────────────────────────────

function Skel({ cls }: { cls: string }) {
  return <div className={`animate-pulse rounded bg-border ${cls}`} />;
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-brand/20 bg-brand/5' : 'border-border bg-canvas'}`}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className="text-xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs tabular-nums text-ink/40">{sub}</p>}
    </div>
  );
}

function BarRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-ink/70">{label}</span>
        <span className="tabular-nums text-ink/50">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-border/40">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TrendPill({ value, label }: { value: number | null; label: string }) {
  if (value === null) {
    return <span className="rounded-full border border-border bg-canvas px-2.5 py-0.5 text-xs text-ink/40">{label} —</span>;
  }
  const pos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${pos ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
      {pos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {pos ? '+' : ''}{value.toFixed(1)}% {label}
    </span>
  );
}

// ── Report body ───────────────────────────────────────────────────────────────

function ReportBody({ report }: { report: DailyReportPayload }) {
  const s = report.snapshot;
  const grade = report.health.grade;

  const totalWithCancelled = s.totalOrders + s.cancelledOrders;
  const cancelRate = totalWithCancelled > 0
    ? ((s.cancelledOrders / totalWithCancelled) * 100).toFixed(1) : '0.0';
  const netRevenue = s.totalRevenue - s.cancelledRevenue;
  const payTotal = s.paymentBreakdown.cash + s.paymentBreakdown.upi + s.paymentBreakdown.card + s.paymentBreakdown.split;
  const srcTotal = Object.values(s.sourceBreakdown).reduce((a, b) => a + b, 0);
  const maxHourly = Math.max(...s.hourlyRevenue, 1);
  const displayHours = s.hourlyRevenue
    .map((v, h) => ({ h, v }))
    .filter(({ h, v }) => h >= 6 && h <= 23 && !(v === 0 && h < 9));

  return (
    <>
      {/* Health score + narrative */}
      <div className="rounded-xl border border-border bg-canvas p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="text-5xl font-black tabular-nums text-ink">{report.health.score}</span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Health Score</p>
              <span className={`text-3xl font-black ${GRADE_FG[grade] ?? 'text-ink'}`}>{grade}</span>
            </div>
          </div>
          <p className="shrink-0 text-xs tabular-nums text-ink/30">
            Generated {new Date(report.generatedAt).toLocaleTimeString()}
          </p>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-border/40">
          <div
            className={`h-full rounded-full transition-all ${GRADE_BG[grade] ?? 'bg-gray-400'}`}
            style={{ width: `${report.health.score}%` }}
          />
        </div>
        <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <Info size={14} className="mt-0.5 shrink-0 text-blue-500" />
          <p className="text-sm leading-relaxed text-blue-800">
            {report.narrative ?? 'AI narrative unavailable — Gemini may be temporarily offline.'}
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Revenue"        value={fmtRev(s.totalRevenue)}   sub={`Net ${fmtRev(netRevenue)}`} accent />
        <KpiCard label="Orders"         value={fmtNum(s.totalOrders)}    sub={`${s.uniqueTables} tables`} />
        <KpiCard label="Avg Order Value" value={fmtRev(s.avgOrderValue)} />
        <KpiCard label="Cancellations"  value={`${cancelRate}%`}         sub={`${s.cancelledOrders} orders`} />
      </div>

      {/* Trend badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink/40">Trends:</span>
        <TrendPill value={s.revenueVs7DayAvgPct}        label="Revenue vs 7-day avg" />
        <TrendPill value={s.ordersVs7DayAvgPct}         label="Orders vs 7-day avg"  />
        <TrendPill value={s.revenueVsSameWeekdayPct}    label="vs same weekday"       />
      </div>

      {/* Top Items | Payment breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-canvas overflow-hidden">
          <div className="border-b border-border bg-mist px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Top Items</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {(['#', 'Item', 'Qty', 'Revenue'] as const).map(h => (
                  <th
                    key={h}
                    className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink/40 ${h === 'Qty' || h === 'Revenue' ? 'text-right' : 'text-left'}`}
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.topItems.slice(0, 10).map((item, i) => (
                <tr key={item.productName} className="border-b border-border last:border-0 hover:bg-mist/50">
                  <td className="px-4 py-2 tabular-nums text-ink/30">{i + 1}</td>
                  <td className="px-4 py-2 text-ink">{item.productName}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink/60">{item.qty}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-ink">{fmtRev(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-border bg-canvas p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Payment Breakdown</p>
          <div className="space-y-3">
            <BarRow label="Cash"  value={s.paymentBreakdown.cash}  total={payTotal} color="bg-green-500"  />
            <BarRow label="UPI"   value={s.paymentBreakdown.upi}   total={payTotal} color="bg-blue-500"   />
            <BarRow label="Card"  value={s.paymentBreakdown.card}  total={payTotal} color="bg-purple-500" />
            <BarRow label="Split" value={s.paymentBreakdown.split} total={payTotal} color="bg-amber-400"  />
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-xs">
            <span className="text-ink/40">Total collected</span>
            <span className="tabular-nums font-semibold text-ink">{fmtRev(payTotal)}</span>
          </div>
        </div>
      </div>

      {/* Order sources | Peak hour + hourly sparkline */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-canvas p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Order Sources</p>
          <div className="space-y-3">
            <BarRow label="Dine-in"  value={s.sourceBreakdown.dineIn}   total={srcTotal} color="bg-brand"      />
            <BarRow label="Takeaway" value={s.sourceBreakdown.takeaway} total={srcTotal} color="bg-amber-500"  />
            <BarRow label="QR"       value={s.sourceBreakdown.qr}       total={srcTotal} color="bg-teal-500"   />
            <BarRow label="Swiggy"   value={s.sourceBreakdown.swiggy}   total={srcTotal} color="bg-orange-400" />
            <BarRow label="Zomato"   value={s.sourceBreakdown.zomato}   total={srcTotal} color="bg-red-500"    />
            {s.sourceBreakdown.other > 0 && (
              <BarRow label="Other"  value={s.sourceBreakdown.other}    total={srcTotal} color="bg-gray-400"   />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-canvas p-4 space-y-4">
          <div className="rounded-lg border border-brand/20 bg-brand/5 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/40">Peak Hour (UTC)</p>
            <p className="text-lg font-bold tabular-nums text-ink">
              {String(s.peakHour).padStart(2, '0')}:00 – {String(s.peakHour + 1).padStart(2, '0')}:00
            </p>
            <p className="text-xs tabular-nums text-ink/50">{fmtRev(s.peakHourRevenue)}</p>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/40">Hourly Revenue</p>
            <div className="flex h-16 items-end gap-px">
              {displayHours.map(({ h, v }) => (
                <div
                  key={h}
                  title={`${String(h).padStart(2,'0')}:00 — ${fmtRev(v)}`}
                  className="group relative flex flex-1 flex-col items-center"
                >
                  <div
                    className="w-full rounded-t bg-brand/50 transition-colors group-hover:bg-brand"
                    style={{ height: `${(v / maxHourly) * 100}%`, minHeight: v > 0 ? '2px' : '0' }}
                  />
                  {h % 4 === 0 && (
                    <span className="absolute -bottom-4 text-[9px] tabular-nums text-ink/30">{h}</span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-5 text-center text-[9px] text-ink/30">Hour (UTC)</p>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AIReportsPage() {
  const [date, setDate]       = useState<string>(yesterday);
  const [report, setReport]   = useState<DailyReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [is404, setIs404]     = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    setIs404(false);
    setReport(null);
    try {
      setReport(await fetchAIReport(d));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setIs404(true);
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(date); }, [date, load]);

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 size={18} className="text-brand" />
            <h1 className="text-base font-bold text-ink">AI Reports</h1>
          </div>
          <div className="flex items-center gap-2">
            <Calendar size={13} className="text-ink/40" />
            <input
              type="date"
              value={date}
              max={toYMD(new Date())}
              onChange={e => setDate(e.target.value)}
              className="rounded-lg border border-border bg-mist px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              onClick={() => void load(date)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Loading…' : 'Load'}
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {loading && (
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-canvas p-4 space-y-3">
              <Skel cls="h-10 w-32" /><Skel cls="h-4 w-full" /><Skel cls="h-4 w-3/4" />
            </div>
            <div className="grid grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Skel key={i} cls="h-20" />)}</div>
            <div className="grid grid-cols-2 gap-4"><Skel cls="h-56" /><Skel cls="h-56" /></div>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-canvas p-8 text-center">
            <AlertTriangle size={32} className="text-amber-500" />
            <p className="font-semibold text-ink">
              {is404 ? 'No data for this date' : 'Failed to load report'}
            </p>
            <p className="max-w-sm text-sm text-ink/50">
              {is404
                ? 'No report found. The nightly job runs at 0:00–3:59 UTC.'
                : error}
            </p>
            <button
              onClick={() => void load(date)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && report && <ReportBody report={report} />}
      </div>
    </div>
  );
}
