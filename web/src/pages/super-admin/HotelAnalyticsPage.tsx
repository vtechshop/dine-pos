import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart2, TrendingUp, CreditCard, Smartphone, Activity,
  AlertTriangle, ShoppingBag, RefreshCw, AlertCircle,
} from 'lucide-react';
import {
  getDashboard,
  getSubscriptionRevenue,
  getDeviceLicensing,
  getFailedPayments,
  getTopHotels,
  type DashboardData,
  type SubscriptionRevenueData,
  type DeviceLicensingData,
  type FailedPaymentsData,
  type TopHotel,
} from '../../api/superAdmin';
import { Spinner } from '../../components/ui/Spinner';

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtINR(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

function fmtAgo(iso: string | undefined): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diff < 1)    return 'just now';
  if (diff < 60)   return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

// ── constants ──────────────────────────────────────────────────────────────────

type ByOption     = 'activity' | 'revenue' | 'orders';
type PeriodOption = 'today' | 'week' | 'month';

const BY_TABS: { label: string; value: ByOption }[] = [
  { label: 'Activity', value: 'activity' },
  { label: 'Revenue',  value: 'revenue'  },
  { label: 'Orders',   value: 'orders'   },
];

const PERIOD_TABS: { label: string; value: PeriodOption }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Week',  value: 'week'  },
  { label: 'Month', value: 'month' },
];

const PLAN_BADGE: Record<string, string> = {
  trial:        'bg-blue-50 text-blue-600',
  starter:      'bg-green-50 text-green-700',
  professional: 'bg-brand/10 text-brand',
  enterprise:   'bg-orange-50 text-orange-700',
};

// ── sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, color, loading,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string; loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-medium text-ink/50">{label}</p>
        <Icon size={14} className={color} />
      </div>
      <p className={`text-2xl font-bold tabular-nums ${loading ? 'text-ink/20' : 'text-ink'}`}>
        {loading ? '—' : value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-ink/40">{sub}</p>}
    </div>
  );
}

function ComingSoonCard({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-border bg-mist/40 p-4">
      <p className="text-xs font-medium text-ink/30">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink/15">—</p>
      <p className="mt-0.5 text-[11px] text-ink/25">Coming Soon</p>
    </div>
  );
}

// ── HotelAnalyticsPage ─────────────────────────────────────────────────────────

export function HotelAnalyticsPage() {
  // ── main data (5 parallel endpoints) ────────────────────────────────────────
  const [mainLoading, setMainLoading] = useState(true);
  const [dashErr,     setDashErr]     = useState(false);
  const [dash,        setDash]        = useState<DashboardData | null>(null);
  const [subRev,      setSubRev]      = useState<SubscriptionRevenueData | null>(null);
  const [devices,     setDevices]     = useState<DeviceLicensingData | null>(null);
  const [payments,    setPayments]    = useState<FailedPaymentsData | null>(null);
  const [ordToday,    setOrdToday]    = useState<TopHotel[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ── activity leaderboard (independent — refetches on filter change) ──────────
  const [actBy,      setActBy]      = useState<ByOption>('activity');
  const [actPeriod,  setActPeriod]  = useState<PeriodOption>('today');
  const [actHotels,  setActHotels]  = useState<TopHotel[]>([]);
  const [actLoading, setActLoading] = useState(true);
  const [actError,   setActError]   = useState(false);

  // ── main load ────────────────────────────────────────────────────────────────

  const loadMain = useCallback(async () => {
    const [dashRes, subRes, devRes, pmtRes, ordRes] = await Promise.allSettled([
      getDashboard(),
      getSubscriptionRevenue(),
      getDeviceLicensing(),
      getFailedPayments(),
      getTopHotels('orders', 'today'),
    ]);

    if (dashRes.status === 'fulfilled') { setDash(dashRes.value);     setDashErr(false); }
    else                                {                              setDashErr(true);  }
    if (subRes.status === 'fulfilled')  setSubRev(subRes.value);
    if (devRes.status === 'fulfilled')  setDevices(devRes.value);
    if (pmtRes.status === 'fulfilled')  setPayments(pmtRes.value);
    if (ordRes.status === 'fulfilled')  setOrdToday(ordRes.value.hotels);

    setLastUpdated(new Date());
    setMainLoading(false);
  }, []);

  useEffect(() => { loadMain(); }, [loadMain]);

  // ── activity section ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setActLoading(true);
    setActError(false);
    getTopHotels(actBy, actPeriod)
      .then(d  => { if (!cancelled) { setActHotels(d.hotels); setActLoading(false); } })
      .catch(() => { if (!cancelled) { setActError(true);     setActLoading(false); } });
    return () => { cancelled = true; };
  }, [actBy, actPeriod]);

  // ── derived values ────────────────────────────────────────────────────────────

  const hotelsOnline = dash ? dash.hotelStats.active + dash.hotelStats.trial : null;
  const ordTodaySum  = ordToday
    ? ordToday.reduce((s, h) => s + (h.value ?? 0), 0)
    : null;
  const subCount = subRev
    ? subRev.breakdown.reduce((acc, b) => acc + b.count, 0)
    : null;

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <BarChart2 size={18} className="text-brand" />
            <h1 className="text-xl font-bold text-ink">Hotel Analytics</h1>
          </div>
          <p className="mt-1 text-sm text-ink/40">
            Platform-wide performance and activity metrics
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs text-ink/50">
          {lastUpdated && (
            <span>
              Loaded{' '}
              {lastUpdated.toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </span>
          )}
          <button
            onClick={loadMain}
            disabled={mainLoading}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-ink/60 transition hover:bg-mist disabled:opacity-50"
          >
            <RefreshCw size={13} className={mainLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Dashboard error banner */}
      {dashErr && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertCircle size={14} />
          /dashboard unavailable — KPI metrics may be incomplete
        </div>
      )}

      {/* ── 1. Platform KPIs ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Platform Overview
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="Revenue Today"
            value={dash ? fmtINR(dash.todayRevenue) : '—'}
            sub="across all active hotels"
            icon={TrendingUp}
            color="text-green-600"
            loading={mainLoading}
          />
          <KpiCard
            label="Monthly Revenue"
            value={dash ? fmtINR(dash.monthlyRevenue) : '—'}
            sub="orders placed this month"
            icon={TrendingUp}
            color="text-green-700"
            loading={mainLoading}
          />
          <KpiCard
            label="Hotels Online"
            value={hotelsOnline !== null ? String(hotelsOnline) : '—'}
            sub="active + trial plans"
            icon={Activity}
            color="text-brand"
            loading={mainLoading}
          />
          <KpiCard
            label="Devices Online"
            value={dash ? String(dash.devices.online) : '—'}
            sub={`of ${dash?.devices.total ?? '—'} total`}
            icon={Smartphone}
            color="text-violet-600"
            loading={mainLoading}
          />
        </div>
      </section>

      {/* ── 2. Revenue Analytics ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Revenue Analytics
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* MRR / ARR + Average Bill */}
          <div className="grid grid-cols-2 gap-3 content-start sm:grid-cols-3">
            <KpiCard
              label="MRR"
              value={subRev ? fmtINR(subRev.mrr) : '—'}
              sub={subCount !== null ? `${subCount} subscribers` : undefined}
              icon={CreditCard}
              color="text-brand"
              loading={mainLoading}
            />
            <KpiCard
              label="ARR"
              value={subRev ? fmtINR(subRev.arr) : '—'}
              sub={subRev ? `${subRev.renewingCount} renewing soon` : undefined}
              icon={CreditCard}
              color="text-brand"
              loading={mainLoading}
            />
            <ComingSoonCard label="Avg Order Bill" />
          </div>

          {/* Revenue by plan */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
              Revenue by Plan
            </p>
            {mainLoading ? (
              <div className="flex h-20 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : !subRev || subRev.breakdown.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink/40">No plan data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-ink/40">
                      <th className="pb-2 font-medium">Plan</th>
                      <th className="pb-2 text-right font-medium">Hotels</th>
                      <th className="pb-2 text-right font-medium">Monthly Price</th>
                      <th className="pb-2 text-right font-medium">Contribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {subRev.breakdown.map(row => (
                      <tr key={row.plan}>
                        <td className="py-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                            PLAN_BADGE[row.plan] ?? 'bg-mist text-ink/50'
                          }`}>
                            {row.plan}
                          </span>
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-ink/70">
                          {row.count}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-ink/70">
                          {fmtINR(row.monthlyPrice)}
                        </td>
                        <td className="py-1.5 text-right font-semibold tabular-nums text-ink">
                          {fmtINR(row.contribution)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Historical Revenue Trend — Coming Soon */}
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-mist/30">
          <div className="flex h-28 items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-medium text-ink/30">Historical Revenue Trend</p>
              <p className="mt-1 text-xs text-ink/20">
                Coming Soon · Requires time-series revenue endpoint
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Orders Today ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Orders Today
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

          {/* Partial orders count */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-ink/50">Orders Today</p>
              <ShoppingBag size={14} className="text-ink/30" />
            </div>
            <p className={`text-2xl font-bold tabular-nums ${mainLoading ? 'text-ink/20' : 'text-ink'}`}>
              {mainLoading ? '—' : ordTodaySum !== null ? `${ordTodaySum}+` : '—'}
            </p>
            <p className="mt-0.5 text-[11px] text-ink/40">
              {ordTodaySum !== null ? 'Sum from top 10 hotels' : 'Unavailable'}
            </p>
          </div>

          <ComingSoonCard label="Avg Orders per Hotel" />
          <ComingSoonCard label="Platform Order Total" />
        </div>

        {/* Top hotels by orders today */}
        {(ordToday ?? []).length > 0 && (
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-canvas">
            <div className="border-b border-border bg-mist/40 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                Top Hotels by Orders Today
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">Hotel</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">Plan</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {(ordToday ?? []).slice(0, 5).map((h, i) => (
                    <Link
                      key={h.hotelId}
                      to={`/super-admin/hotels/${h.hotelId}`}
                      className="table-row border-b border-border/50 hover:bg-mist/40 transition last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-bold tabular-nums ${
                          i === 0 ? 'text-amber-500' : 'text-ink/30'
                        }`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="truncate text-sm font-medium text-ink">{h.hotelName}</p>
                        <p className="truncate text-xs text-ink/40">{h.city}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                          PLAN_BADGE[h.plan] ?? 'bg-mist text-ink/50'
                        }`}>
                          {h.plan}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-bold tabular-nums text-ink">
                        {h.value ?? 0}
                      </td>
                    </Link>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── 4. Hotel Activity ── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/40">
              Hotel Activity
            </h2>
            {actBy === 'activity' && actHotels.length > 0 && actHotels[0].lastSeen && (
              <p className="mt-1 text-xs text-ink/50">
                Most recently active:{' '}
                <span className="font-medium text-ink">{actHotels[0].hotelName}</span>
                {' · '}
                <span className="text-brand">{fmtAgo(actHotels[0].lastSeen)}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Metric selector */}
            <div className="flex overflow-hidden rounded-lg border border-border">
              {BY_TABS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setActBy(t.value)}
                  className={`px-2.5 py-1 text-xs font-medium transition ${
                    actBy === t.value ? 'bg-ink text-canvas' : 'text-ink/50 hover:bg-mist'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* Period selector */}
            <div className="flex overflow-hidden rounded-lg border border-border">
              {PERIOD_TABS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setActPeriod(t.value)}
                  className={`px-2.5 py-1 text-xs font-medium transition ${
                    actPeriod === t.value ? 'bg-ink text-canvas' : 'text-ink/50 hover:bg-mist'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-canvas">
          {actLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : actError ? (
            <div className="flex h-40 items-center justify-center text-sm text-ink/40">
              <AlertCircle size={13} className="mr-1.5" />
              Failed to load activity data
            </div>
          ) : actHotels.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-ink/40">
              No data for this period
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-mist/40">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">Hotel</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">Plan</th>
                    {actBy === 'activity' && (
                      <>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Last Seen</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Devices</th>
                      </>
                    )}
                    {actBy === 'revenue' && (
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">
                        Revenue ({actPeriod})
                      </th>
                    )}
                    {actBy === 'orders' && (
                      <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">
                        Orders ({actPeriod})
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {actHotels.map((h, i) => (
                    <tr
                      key={h.hotelId}
                      className="border-b border-border/50 transition hover:bg-mist/40 last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-bold tabular-nums ${
                          i === 0 ? 'text-amber-500' : i === 1 ? 'text-ink/50' : 'text-ink/30'
                        }`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/super-admin/hotels/${h.hotelId}`}
                          className="font-medium text-ink hover:text-brand hover:underline"
                        >
                          {h.hotelName}
                        </Link>
                        <p className="text-xs text-ink/40">{h.city}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                          PLAN_BADGE[h.plan] ?? 'bg-mist text-ink/50'
                        }`}>
                          {h.plan}
                        </span>
                      </td>
                      {actBy === 'activity' && (
                        <>
                          <td className="px-4 py-2.5 text-right text-xs text-ink/60">
                            {fmtAgo(h.lastSeen)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-sm font-medium text-ink">
                            {h.deviceCount ?? '—'}
                          </td>
                        </>
                      )}
                      {actBy === 'revenue' && (
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">
                          {fmtINR(h.value ?? 0)}
                        </td>
                      )}
                      {actBy === 'orders' && (
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">
                          {h.value ?? 0}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── 5. Device Analytics ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Device Analytics
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total Devices', value: devices?.total,   color: 'text-ink'         },
              { label: 'Active',        value: devices?.active,  color: 'text-green-700'   },
              { label: 'Blocked',       value: devices?.blocked, color: 'text-red-600'     },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl border border-border bg-canvas p-4 text-center">
                <p className={`text-2xl font-bold tabular-nums ${mainLoading ? 'text-ink/20' : color}`}>
                  {mainLoading ? '—' : value ?? '—'}
                </p>
                <p className="mt-0.5 text-xs text-ink/40">{label}</p>
              </div>
            ))}
          </div>

          {/* By-plan breakdown */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
              Devices by Plan
            </p>
            {mainLoading ? (
              <div className="flex h-20 items-center justify-center">
                <Spinner size="sm" />
              </div>
            ) : !devices || devices.byPlan.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink/40">No plan data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-ink/40">
                      <th className="pb-2 font-medium">Plan</th>
                      <th className="pb-2 text-right font-medium">Hotels</th>
                      <th className="pb-2 text-right font-medium">Allowed</th>
                      <th className="pb-2 text-right font-medium">Active</th>
                      <th className="pb-2 text-right font-medium">Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {devices.byPlan.map(row => {
                      const pct = row.totalAllowed > 0
                        ? Math.round((row.activeDevices / row.totalAllowed) * 100)
                        : 0;
                      return (
                        <tr key={row.plan}>
                          <td className="py-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                              PLAN_BADGE[row.plan] ?? 'bg-mist text-ink/50'
                            }`}>
                              {row.plan}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-ink/70">{row.hotelCount}</td>
                          <td className="py-1.5 text-right tabular-nums text-ink/70">{row.totalAllowed}</td>
                          <td className={`py-1.5 text-right font-semibold tabular-nums ${
                            row.activeDevices > row.totalAllowed ? 'text-red-600' : 'text-ink'
                          }`}>
                            {row.activeDevices}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-ink/50">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 6. Payment Health ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Payment Health
        </h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
            <p className={`text-2xl font-bold tabular-nums ${mainLoading ? 'text-amber-200' : 'text-amber-600'}`}>
              {mainLoading ? '—' : payments?.pending ?? '—'}
            </p>
            <p className="mt-0.5 text-xs font-medium text-amber-700/70">Pending</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className={`text-2xl font-bold tabular-nums ${mainLoading ? 'text-red-200' : 'text-red-600'}`}>
              {mainLoading ? '—' : payments?.failed ?? '—'}
            </p>
            <p className="mt-0.5 text-xs font-medium text-red-700/70">Failed</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className={`text-2xl font-bold tabular-nums ${mainLoading ? 'text-red-200' : 'text-red-700'}`}>
              {mainLoading ? '—' : payments?.overdue ?? '—'}
            </p>
            <p className="mt-0.5 text-xs font-medium text-red-800/70">Overdue</p>
          </div>
          <div className="rounded-xl border border-border bg-canvas p-4 text-center">
            <p className={`text-2xl font-bold tabular-nums ${mainLoading ? 'text-ink/20' : 'text-ink'}`}>
              {mainLoading ? '—' : payments?.total ?? '—'}
            </p>
            <p className="mt-0.5 text-xs text-ink/40">Total Issues</p>
          </div>
        </div>

        {payments && payments.recent.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-canvas">
            <div className="border-b border-border bg-mist/40 px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                Recent Payment Issues
              </p>
            </div>
            <div className="divide-y divide-border">
              {payments.recent.slice(0, 5).map((rec, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={12} className={
                      rec.status === 'failed' ? 'text-red-500' : 'text-amber-500'
                    } />
                    <span className="text-sm capitalize text-ink">{rec.status}</span>
                  </div>
                  <span className="text-xs text-ink/40">
                    {new Date(rec.updatedAt).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Historical Charts (Coming Soon) ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Historical Analytics
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            'Revenue Trend (30 days)',
            'Order Volume Over Time',
            'Hotel Churn Rate',
          ].map(label => (
            <div
              key={label}
              className="flex h-28 items-center justify-center rounded-xl border border-border bg-mist/30"
            >
              <div className="text-center">
                <p className="text-sm font-medium text-ink/30">{label}</p>
                <p className="mt-1 text-xs text-ink/20">Coming Soon</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="text-center text-[11px] text-ink/30">
        Orders Today shows top-10 hotels only · Full aggregates require additional backend endpoints
      </p>
    </div>
  );
}
