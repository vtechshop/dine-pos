import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, TrendingUp, ShoppingCart, AlertTriangle,
  FileText, MessageSquare, BarChart2, Bell, Star, ShoppingBag,
  CheckCircle, Calendar, Sparkles,
} from 'lucide-react';
import { fetchExecutiveDashboard, type ExecutiveDashboard } from '../../api/aiReport';
import { fetchAnomalies, type AnomalyReport } from '../../api/aiAnalytics';
import { ApiError } from '../../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRev(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtPct(n: number | null) {
  if (n === null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function gradeColor(grade: string) {
  if (grade === 'A') return 'text-green-600 bg-green-50 border-green-200';
  if (grade === 'B') return 'text-blue-600 bg-blue-50 border-blue-200';
  if (grade === 'C') return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  if (grade === 'D') return 'text-orange-500 bg-orange-50 border-orange-200';
  return 'text-red-600 bg-red-50 border-red-200';
}

function severityColor(s: 'low' | 'medium' | 'high') {
  if (s === 'high') return 'text-red-600 bg-red-50';
  if (s === 'medium') return 'text-amber-600 bg-amber-50';
  return 'text-blue-600 bg-blue-50';
}

function Skeleton({ h, w }: { h: string; w?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-border ${h} ${w ?? 'w-full'}`}
    />
  );
}

// ── 7-Day Bar Chart ───────────────────────────────────────────────────────────

function TrendBars({ data }: { data: ExecutiveDashboard['trend'] }) {
  const maxRev = Math.max(...data.map(d => d.totalRevenue), 1);
  return (
    <div className="flex h-28 items-end gap-1.5">
      {data.map((d, i) => {
        const pct = (d.totalRevenue / maxRev) * 100;
        const label = d.date.slice(5); // MM-DD
        return (
          <div key={i} className="group relative flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-brand/70 transition-all group-hover:bg-brand"
              style={{ height: `${Math.max(pct, 4)}%` }}
            />
            <span className="text-[9px] text-ink/40 tabular-nums">{label}</span>
            {/* Tooltip */}
            <div className="pointer-events-none absolute bottom-full mb-1 hidden rounded bg-ink px-2 py-1 text-[10px] text-white group-hover:block whitespace-nowrap z-10">
              {fmtRev(d.totalRevenue)} · {d.totalOrders} orders
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Quick-nav item ────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  desc: string;
}

function QuickNavCard({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.href}
      className="flex flex-col gap-1.5 rounded-xl border border-border bg-canvas p-3.5 transition-shadow hover:shadow-sm hover:border-brand/30 group"
    >
      <span className="text-ink/40 group-hover:text-brand transition-colors">{item.icon}</span>
      <span className="text-xs font-semibold text-ink">{item.label}</span>
      <span className="text-[11px] text-ink/50 leading-snug">{item.desc}</span>
    </Link>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AIDashboardPage() {
  const [dash, setDash] = useState<ExecutiveDashboard | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyReport | null>(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [anomLoading, setAnomaliesLoading] = useState(true);
  const [dashError, setDashError] = useState<string | null>(null);
  const [anomError, setAnomaliesError] = useState<string | null>(null);
  const [anomInsufficient, setAnomaliesInsufficient] = useState(false);
  const [featureDisabled, setFeatureDisabled] = useState(false);

  const loadDash = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      const data = await fetchExecutiveDashboard();
      setDash(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && err.code === 'FEATURE_DISABLED') {
        setFeatureDisabled(true);
      } else {
        setDashError('Failed to load dashboard data.');
      }
    } finally {
      setDashLoading(false);
    }
  }, []);

  const loadAnomalies = useCallback(async () => {
    setAnomaliesLoading(true);
    setAnomaliesError(null);
    setAnomaliesInsufficient(false);
    try {
      const data = await fetchAnomalies();
      if (!data || data.allClear === undefined || !Array.isArray(data.anomalies)) {
        setAnomaliesInsufficient(true);
      } else {
        setAnomalies(data);
      }
    } catch {
      setAnomaliesError('Failed to load anomaly data.');
    } finally {
      setAnomaliesLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    loadDash();
    loadAnomalies();
  }, [loadDash, loadAnomalies]);

  useEffect(() => {
    loadDash();
    loadAnomalies();
  }, [loadDash, loadAnomalies]);

  if (featureDisabled) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="h-16 w-16 rounded-2xl bg-brand/10 flex items-center justify-center">
          <Sparkles size={32} className="text-brand" />
        </div>
        <h2 className="text-xl font-bold text-ink">AI Features Not Enabled</h2>
        <p className="text-sm text-ink/50 max-w-sm text-center">
          The AI Platform is a premium feature. Contact support to enable it for your account.
        </p>
        <a href="mailto:support@dinepos.in" className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white">
          Contact Support
        </a>
      </div>
    );
  }

  const hs = dash?.latestHealthScore ?? null;
  const wc = dash?.weekComparison ?? null;
  const changePct = wc?.changePct ?? null;

  const navItems: NavItem[] = [
    { label: 'Morning Brief', href: '/ai/brief', icon: <Calendar size={18} />, desc: 'Daily AI-generated summary' },
    { label: 'Reports', href: '/ai/reports', icon: <FileText size={18} />, desc: 'Daily health reports' },
    { label: 'AI Chat', href: '/ai/chat', icon: <MessageSquare size={18} />, desc: 'Ask questions about your data' },
    { label: 'Forecast', href: '/ai/forecast', icon: <TrendingUp size={18} />, desc: 'Revenue & demand predictions' },
    { label: 'Alerts', href: '/ai/alerts', icon: <Bell size={18} />, desc: 'Anomaly & fraud alerts' },
    { label: 'Recommendations', href: '/ai/recommendations', icon: <Star size={18} />, desc: 'Menu & pricing suggestions' },
    { label: 'Purchase Assistant', href: '/ai/purchase', icon: <ShoppingBag size={18} />, desc: 'Smart procurement guidance' },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-sm font-bold text-ink">AI Dashboard</h1>
              <p className="text-[11px] text-ink/50">Business intelligence at a glance</p>
            </div>
            {/* Health grade pill */}
            {!dashLoading && hs && (
              <span
                className={`rounded-full border px-3 py-0.5 text-xs font-bold tabular-nums ${gradeColor(hs.grade)}`}
              >
                Grade {hs.grade} · {hs.score}
              </span>
            )}
            {dashLoading && <Skeleton h="h-6" w="w-24" />}
          </div>
          <button
            onClick={refresh}
            className="rounded-lg px-3 py-1.5 text-xs text-ink/40 hover:bg-ink/5 hover:text-ink/70 flex items-center gap-1.5"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {dashLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-canvas p-4 space-y-2">
                  <Skeleton h="h-3" w="w-20" /><Skeleton h="h-7" w="w-28" />
                </div>
              ))
            : dash && [
                { label: 'Today Revenue', value: fmtRev(dash.today.revenue), sub: `${dash.today.orders} orders`, accent: true },
                { label: 'Today Orders',  value: String(dash.today.orders),  sub: dash.today.source === 'cache' ? 'from cache' : 'live data' },
                { label: 'This Week',     value: wc ? fmtRev(wc.thisWeekRevenue) : '—', sub: '7-day total' },
                { label: 'vs Last Week',  value: fmtPct(changePct), sub: wc ? `${fmtRev(wc.lastWeekRevenue)} prior wk` : undefined,
                  valColor: changePct === null ? 'text-ink/40' : changePct >= 0 ? 'text-green-600' : 'text-red-500' },
              ].map(({ label, value, sub, accent, valColor }) => (
                <div key={label} className={`rounded-xl border p-4 ${accent ? 'border-brand/20 bg-brand/5' : 'border-border bg-canvas'}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40 mb-1">{label}</p>
                  <p className={`text-2xl font-bold tabular-nums ${valColor ?? 'text-ink'}`}>{value}</p>
                  {sub && <p className="text-[11px] text-ink/40 mt-0.5">{sub}</p>}
                </div>
              ))
          }
        </div>

        {dashError && (
          <div className="rounded-xl border border-border bg-canvas p-4 flex items-center justify-between">
            <span className="text-sm text-red-500">{dashError}</span>
            <button onClick={loadDash} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">Retry</button>
          </div>
        )}

        {/* 2-col: Trend + Top Sellers */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 7-Day Trend */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <BarChart2 size={14} className="text-ink/40" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">7-Day Revenue Trend</p>
            </div>
            {dashLoading ? (
              <div className="flex h-28 items-end gap-1.5">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full animate-pulse rounded-t bg-border" style={{ height: `${30 + i * 8}%` }} />
                  </div>
                ))}
              </div>
            ) : dash && dash.trend.length > 0 ? (
              <TrendBars data={dash.trend} />
            ) : (
              <div className="flex h-28 items-center justify-center text-sm text-ink/40">No trend data yet</div>
            )}
          </div>

          {/* Top Sellers */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <ShoppingCart size={14} className="text-ink/40" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Top Sellers Today</p>
            </div>
            {dashLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton h="h-4" w="w-5" /><Skeleton h="h-4" /><Skeleton h="h-4" w="w-16" />
                  </div>
                ))}
              </div>
            ) : dash && dash.today.topItems.length > 0 ? (
              <div className="space-y-2">
                {dash.today.topItems.slice(0, 6).map((item, i) => {
                  const maxRev = dash.today.topItems[0]?.revenue ?? 1;
                  return (
                    <div key={item.productId} className="flex items-center gap-2 text-sm">
                      <span className="text-[10px] font-bold text-ink/30 w-4 tabular-nums">{i + 1}</span>
                      <span className="flex-1 truncate text-xs text-ink/80">{item.productName}</span>
                      <div className="w-16 h-1.5 rounded-full bg-mist overflow-hidden">
                        <div
                          className="h-full bg-brand/60 rounded-full"
                          style={{ width: `${(item.revenue / maxRev) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-ink tabular-nums w-20 text-right">{fmtRev(item.revenue)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-20 items-center justify-center text-sm text-ink/40">No sales yet today</div>
            )}
          </div>
        </div>

        {/* Anomaly / Fraud Detection */}
        <div className="rounded-xl border border-border bg-canvas p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-ink/40" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Anomaly &amp; Fraud Detection</p>
            </div>
            {anomalies && (
              <span className="text-[10px] text-ink/30">
                {anomalies.dataWindowDays}d window
              </span>
            )}
          </div>

          {anomLoading ? (
            <div className="space-y-2">
              <Skeleton h="h-4" w="w-48" />
              <Skeleton h="h-4" />
              <Skeleton h="h-4" w="w-3/4" />
            </div>
          ) : anomError ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-red-500">{anomError}</span>
              <button onClick={loadAnomalies} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">Retry</button>
            </div>
          ) : anomInsufficient ? (
            <div className="flex items-center gap-2 text-sm text-ink/50">
              <Calendar size={15} />
              Need 7+ days of data for anomaly analysis
            </div>
          ) : anomalies?.allClear ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle size={15} />
              All clear — no anomalies detected
              {anomalies.summary && (
                <span className="text-ink/50 ml-1">&middot; {anomalies.summary}</span>
              )}
            </div>
          ) : anomalies && anomalies.anomalies.length > 0 ? (
            <div className="space-y-2.5">
              <p className="text-xs text-ink/60">{anomalies.summary}</p>
              {anomalies.anomalies.map((a, i) => (
                <div key={i} className="rounded-lg border border-border p-3 flex items-start gap-3">
                  <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${severityColor(a.severity)}`}>
                    {a.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-ink">{a.label}</p>
                    <p className="text-[11px] text-ink/60 mt-0.5 leading-snug">{a.evidence}</p>
                    <p className="text-[10px] text-ink/40 mt-0.5">
                      Confidence: {Math.round(a.confidence * 100)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Quick Navigation */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40 mb-3">AI Tools</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {navItems.map(item => (
              <QuickNavCard key={item.href} item={item} />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
