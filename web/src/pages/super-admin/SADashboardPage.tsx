import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle, TrendingUp, CreditCard, Smartphone, Trophy } from 'lucide-react';
import {
  getDashboard,
  getSubscriptionRevenue,
  getFailedPayments,
  getDeviceLicensing,
  getHotelGrowth,
  getTopHotels,
  type DashboardData,
  type SubscriptionRevenueData,
  type FailedPaymentsData,
  type DeviceLicensingData,
  type HotelGrowthData,
  type HotelGrowthPoint,
} from '../../api/superAdmin';
import { Spinner } from '../../components/ui/Spinner';

// ── helpers ────────────────────────────────────────────────────────────────────

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysLeft(endDate: string | null): { label: string; urgent: boolean } {
  if (!endDate) return { label: '', urgent: false };
  const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
  if (diff < 0)   return { label: 'Expired', urgent: true };
  if (diff === 0) return { label: 'Today',   urgent: true };
  return { label: `${diff}d left`, urgent: diff <= 3 };
}

function getExpiringTrials(renewals: DashboardData['pendingRenewals']) {
  return renewals.filter(h => {
    if (h.status !== 'trial' || !h.trialEndDate) return false;
    const diff = Math.ceil((new Date(h.trialEndDate).getTime() - Date.now()) / 86_400_000);
    return diff >= 0 && diff <= 7;
  });
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function growthLabel(pt: HotelGrowthPoint, period: '7d' | '30d' | '12m'): string {
  const m = MONTHS_SHORT[(pt._id.month ?? 1) - 1];
  if (period === '12m') return `${m} '${String(pt._id.year).slice(2)}`;
  return `${m} ${pt._id.day ?? ''}`;
}

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

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  trial:     'bg-blue-50 text-blue-700 border-blue-200',
  active:    'bg-green-50 text-green-700 border-green-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  rejected:  'bg-gray-100 text-gray-600 border-gray-200',
  expired:   'bg-gray-100 text-gray-500 border-gray-200',
};

const PLAN_BADGE: Record<string, string> = {
  trial:        'bg-blue-50 text-blue-600',
  starter:      'bg-green-50 text-green-700',
  professional: 'bg-brand/10 text-brand',
  enterprise:   'bg-orange-50 text-orange-700',
};

// ── GrowthChart ────────────────────────────────────────────────────────────────

const GROWTH_PERIODS: { label: string; value: '7d' | '30d' | '12m' }[] = [
  { label: '7D',  value: '7d'  },
  { label: '30D', value: '30d' },
  { label: '12M', value: '12m' },
];

function GrowthChart() {
  const [period, setPeriod] = useState<'7d' | '30d' | '12m'>('30d');
  const [data,   setData]   = useState<HotelGrowthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getHotelGrowth(period)
      .then(d  => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const points = data?.data ?? [];
  const maxVal = Math.max(1, ...points.map(p => p.total));

  // SVG layout — all in viewBox units
  const W = 500, H = 108;
  const PL = 24, PR = 8, PT = 8, PB = 28;
  const AW = W - PL - PR;  // 468
  const AH = H - PT - PB;  // 72

  const slotW = points.length > 0 ? AW / points.length : AW;
  const barW  = Math.max(3, slotW * 0.72);
  // Show ~5 labels for 30d regardless of actual count
  const labelStep = period === '12m' ? 1 : period === '7d' ? 1 : Math.max(1, Math.ceil(points.length / 5));

  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Hotel Growth</h2>
          {data && (
            <p className="mt-0.5 text-[11px] text-ink/40">
              {data.totalInPeriod} registrations in period
            </p>
          )}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {GROWTH_PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-2.5 py-1 text-xs font-medium transition ${
                period === p.value
                  ? 'bg-ink text-canvas'
                  : 'text-ink/50 hover:bg-mist'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-[108px] items-center justify-center">
          <Spinner size="sm" />
        </div>
      ) : error ? (
        <div className="flex h-[108px] items-center justify-center text-xs text-ink/40">
          Failed to load chart
        </div>
      ) : points.length === 0 ? (
        <div className="flex h-[108px] items-center justify-center text-xs text-ink/40">
          No registrations in this period
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map(frac => (
            <line
              key={frac}
              x1={PL}       y1={PT + AH * (1 - frac)}
              x2={W - PR}   y2={PT + AH * (1 - frac)}
              style={{ stroke: 'var(--border)' }}
              strokeWidth={0.5}
            />
          ))}

          {/* Max-value Y label */}
          <text
            x={PL - 3} y={PT + 6}
            textAnchor="end" fontSize={7}
            style={{ fill: 'var(--ink)', opacity: 0.35 }}
          >
            {maxVal}
          </text>

          {/* Bars */}
          {points.map((pt, i) => {
            const bh = Math.max(2, (pt.total / maxVal) * AH);
            const bx = PL + i * slotW + (slotW - barW) / 2;
            const by = PT + AH - bh;
            const label = growthLabel(pt, period);
            const showLabel = i === 0 || i === points.length - 1 || i % labelStep === 0;
            return (
              <g key={i}>
                <rect
                  x={bx} y={by}
                  width={barW} height={bh}
                  rx={2}
                  style={{ fill: 'var(--brand)', opacity: 0.78 }}
                >
                  <title>{label}: {pt.total} total ({pt.approved} approved)</title>
                </rect>
                {showLabel && (
                  <text
                    x={bx + barW / 2} y={H - 6}
                    textAnchor="middle" fontSize={7}
                    style={{ fill: 'var(--ink)', opacity: 0.4 }}
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Baseline */}
          <line
            x1={PL} y1={PT + AH}
            x2={W - PR} y2={PT + AH}
            style={{ stroke: 'var(--border)' }}
            strokeWidth={1}
          />
        </svg>
      )}
    </div>
  );
}

// ── TopHotelsLeaderboard ──────────────────────────────────────────────────────

const BY_TABS:     { label: string; value: 'revenue' | 'orders' | 'activity' }[] = [
  { label: 'Revenue',  value: 'revenue'  },
  { label: 'Orders',   value: 'orders'   },
  { label: 'Activity', value: 'activity' },
];
const PERIOD_TABS: { label: string; value: 'today' | 'week' | 'month' }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Week',  value: 'week'  },
  { label: 'Month', value: 'month' },
];

function TopHotelsLeaderboard() {
  const [by,      setBy]      = useState<'revenue' | 'orders' | 'activity'>('revenue');
  const [period,  setPeriod]  = useState<'today' | 'week' | 'month'>('today');
  const [hotels,  setHotels]  = useState<{ hotelId: string; hotelName: string; city: string; plan: string; value?: number; lastSeen?: string; deviceCount?: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getTopHotels(by, period)
      .then(d  => { if (!cancelled) setHotels(d.hotels); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [by, period]);

  function formatVal(h: { value?: number; lastSeen?: string }): string {
    if (by === 'revenue')  return fmtINR(h.value ?? 0);
    if (by === 'orders')   return `${h.value ?? 0} orders`;
    return fmtAgo(h.lastSeen);
  }

  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Trophy size={13} className="text-amber-500" />
          Top Hotels
        </h2>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {PERIOD_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setPeriod(t.value)}
              className={`px-2.5 py-1 text-xs font-medium transition ${
                period === t.value ? 'bg-ink text-canvas' : 'text-ink/50 hover:bg-mist'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex gap-1">
        {BY_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setBy(t.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              by === t.value
                ? 'bg-brand/10 text-brand'
                : 'text-ink/50 hover:bg-mist'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner size="sm" />
        </div>
      ) : error ? (
        <div className="py-8 text-center text-xs text-ink/40">Failed to load</div>
      ) : hotels.length === 0 ? (
        <div className="py-8 text-center text-xs text-ink/40">No data for this period</div>
      ) : (
        <div className="space-y-px">
          {hotels.map((hotel, i) => (
            <Link
              key={hotel.hotelId}
              to={`/super-admin/hotels/${hotel.hotelId}`}
              className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-mist"
            >
              <span className={`w-5 text-center text-xs font-bold tabular-nums ${
                i === 0 ? 'text-amber-500' : i === 1 ? 'text-ink/50' : 'text-ink/30'
              }`}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {hotel.hotelName}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                PLAN_BADGE[hotel.plan] ?? 'bg-mist text-ink/50'
              }`}>
                {hotel.plan}
              </span>
              <span className="w-24 text-right text-xs font-semibold tabular-nums text-ink">
                {formatVal(hotel)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SADashboardPage ────────────────────────────────────────────────────────────

export function SADashboardPage() {
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [subRev,  setSubRev]  = useState<SubscriptionRevenueData | null>(null);
  const [fp,      setFp]      = useState<FailedPaymentsData | null>(null);
  const [dl,      setDl]      = useState<DeviceLicensingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [dashRes, subRes, fpRes, dlRes] = await Promise.allSettled([
      getDashboard(),
      getSubscriptionRevenue(),
      getFailedPayments(),
      getDeviceLicensing(),
    ]);

    if (dashRes.status === 'rejected') {
      setError(dashRes.reason instanceof Error ? dashRes.reason.message : 'Failed to load dashboard');
    } else {
      setData(dashRes.value);
    }
    setSubRev(subRes.status === 'fulfilled' ? subRes.value : null);
    setFp(fpRes.status   === 'fulfilled' ? fpRes.value   : null);
    setDl(dlRes.status   === 'fulfilled' ? dlRes.value   : null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  const s = data!.hotelStats;
  const expiringTrials = getExpiringTrials(data!.pendingRenewals);

  const statusCards = [
    { label: 'Total',     value: s.total,     border: 'border-brand/25',  bg: 'bg-brand/5',   text: 'text-brand',     to: '/super-admin/hotels' },
    { label: 'Pending',   value: s.pending,   border: 'border-amber-200', bg: 'bg-amber-50',  text: 'text-amber-700', to: '/super-admin/hotels?status=pending' },
    { label: 'Trial',     value: s.trial,     border: 'border-blue-200',  bg: 'bg-blue-50',   text: 'text-blue-700',  to: '/super-admin/hotels?status=trial' },
    { label: 'Active',    value: s.active,    border: 'border-green-200', bg: 'bg-green-50',  text: 'text-green-700', to: '/super-admin/hotels?status=active' },
    { label: 'Suspended', value: s.suspended, border: 'border-red-200',   bg: 'bg-red-50',    text: 'text-red-700',   to: '/super-admin/hotels?status=suspended' },
  ];

  const subCount = subRev
    ? subRev.breakdown.reduce((acc, b) => acc + b.count, 0)
    : null;

  const revenueCards = [
    {
      label: "Today's Revenue",
      value: fmtINR(data!.todayRevenue),
      sub:   'across all active hotels',
      Icon:  TrendingUp,
      color: 'text-green-600',
    },
    {
      label: 'Monthly Revenue',
      value: fmtINR(data!.monthlyRevenue),
      sub:   'orders placed this month',
      Icon:  TrendingUp,
      color: 'text-green-700',
    },
    {
      label: 'MRR',
      value: subRev ? fmtINR(subRev.mrr) : '—',
      sub:   subCount !== null ? `${subCount} active hotels` : 'loading…',
      Icon:  CreditCard,
      color: 'text-brand',
    },
    {
      label: 'ARR',
      value: subRev ? fmtINR(subRev.arr) : '—',
      sub:   subRev ? `${subRev.renewingCount} renewing in 30 days` : 'loading…',
      Icon:  CreditCard,
      color: 'text-brand',
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Dashboard</h1>
          {data?.generatedAt && (
            <p className="mt-0.5 text-sm text-ink/40">
              Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink/60 transition hover:bg-mist disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Row 1: Hotel status KPIs ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {statusCards.map(({ label, value, border, bg, text, to }) => (
          <Link
            key={label}
            to={to}
            className={`rounded-xl border ${border} ${bg} p-4 transition hover:opacity-80`}
          >
            <p className="text-xs font-medium text-ink/50">{label}</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${text}`}>{value}</p>
          </Link>
        ))}
      </div>

      {/* ── Row 2: Revenue + subscription KPIs ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {revenueCards.map(({ label, value, sub, Icon, color }) => (
          <div key={label} className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-ink/50">{label}</p>
              <Icon size={14} className={color} />
            </div>
            <p className="text-2xl font-bold tabular-nums text-ink">{value}</p>
            <p className="mt-0.5 text-[11px] text-ink/40">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Row 3: Secondary alerts ── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink/50">
        <span>Expired: <strong className="text-ink">{s.expired}</strong></span>
        <span>Rejected: <strong className="text-ink">{s.rejected}</strong></span>
        {data!.churnRisk > 0 && (
          <span className="flex items-center gap-1 font-medium text-amber-600">
            <AlertTriangle size={13} />
            {data!.churnRisk} trial{data!.churnRisk !== 1 ? 's' : ''} expiring this week
          </span>
        )}
        {data!.openTickets > 0 && (
          <span className="flex items-center gap-1 font-medium text-red-600">
            <AlertTriangle size={13} />
            {data!.openTickets} open support ticket{data!.openTickets !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {s.suspended > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle size={15} />
            <strong>{s.suspended}</strong> hotel{s.suspended !== 1 ? 's' : ''} currently suspended
          </div>
          <Link to="/super-admin/hotels?status=suspended" className="text-xs font-medium text-red-600 hover:underline">
            View →
          </Link>
        </div>
      )}

      {/* ── Row 4: Growth Chart + Top Hotels ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <GrowthChart />
        <TopHotelsLeaderboard />
      </div>

      {/* ── Row 5: Failed Payments + Device Licensing ── */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Failed Payments */}
        <div className="rounded-xl border border-border bg-canvas p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <AlertTriangle size={13} className="text-red-500" />
            Payment Issues
          </h2>
          {!fp ? (
            <div className="flex h-20 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-amber-50 px-3 py-2.5">
                  <p className="text-xl font-bold tabular-nums text-amber-600">{fp.pending}</p>
                  <p className="mt-0.5 text-[10px] font-medium text-amber-700/70">Pending</p>
                </div>
                <div className="rounded-lg bg-red-50 px-3 py-2.5">
                  <p className="text-xl font-bold tabular-nums text-red-600">{fp.failed}</p>
                  <p className="mt-0.5 text-[10px] font-medium text-red-700/70">Failed</p>
                </div>
                <div className="rounded-lg bg-red-50 px-3 py-2.5">
                  <p className="text-xl font-bold tabular-nums text-red-700">{fp.overdue}</p>
                  <p className="mt-0.5 text-[10px] font-medium text-red-800/70">Overdue</p>
                </div>
              </div>
              {fp.recent.length === 0 ? (
                <p className="py-2 text-center text-xs text-ink/40">No recent payment issues</p>
              ) : (
                <div className="divide-y divide-border">
                  {fp.recent.slice(0, 5).map((rec, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <span className="text-xs capitalize text-ink">{rec.status}</span>
                      <span className="text-[10px] text-ink/40">
                        {new Date(rec.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Device Licensing */}
        <div className="rounded-xl border border-border bg-canvas p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Smartphone size={13} className="text-ink/50" />
            Device Licensing
          </h2>
          {!dl ? (
            <div className="flex h-20 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-mist px-3 py-2.5">
                  <p className="text-xl font-bold tabular-nums text-ink">{dl.total}</p>
                  <p className="mt-0.5 text-[10px] font-medium text-ink/50">Total</p>
                </div>
                <div className="rounded-lg bg-green-50 px-3 py-2.5">
                  <p className="text-xl font-bold tabular-nums text-green-700">{dl.active}</p>
                  <p className="mt-0.5 text-[10px] font-medium text-green-700/70">Active</p>
                </div>
                <div className="rounded-lg bg-red-50 px-3 py-2.5">
                  <p className="text-xl font-bold tabular-nums text-red-600">{dl.blocked}</p>
                  <p className="mt-0.5 text-[10px] font-medium text-red-700/70">Blocked</p>
                </div>
              </div>
              {dl.byPlan.length === 0 ? (
                <p className="text-center text-xs text-ink/40">No plan data available</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-ink/40">
                        <th className="pb-2 font-medium">Plan</th>
                        <th className="pb-2 text-right font-medium">Hotels</th>
                        <th className="pb-2 text-right font-medium">Allowed</th>
                        <th className="pb-2 text-right font-medium">Active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {dl.byPlan.map(row => (
                        <tr key={row.plan}>
                          <td className="py-1.5 font-medium capitalize text-ink">{row.plan}</td>
                          <td className="py-1.5 text-right tabular-nums text-ink/70">{row.hotelCount}</td>
                          <td className="py-1.5 text-right tabular-nums text-ink/70">{row.totalAllowed}</td>
                          <td className={`py-1.5 text-right tabular-nums font-semibold ${
                            row.activeDevices > row.totalAllowed ? 'text-red-600' : 'text-ink'
                          }`}>
                            {row.activeDevices}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Row 6: Latest Registrations + Pending Renewals ── */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Latest Registrations */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Latest Registrations</h2>
            <Link to="/super-admin/hotels" className="text-xs text-brand hover:underline">
              View all →
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-canvas">
            {data!.latestRegistrations.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink/40">No registrations yet</p>
            ) : (
              data!.latestRegistrations.map((h, i) => (
                <Link
                  key={h._id}
                  to={`/super-admin/hotels/${h._id}`}
                  className={`flex items-center gap-3 px-4 py-3 transition hover:bg-mist ${
                    i < data!.latestRegistrations.length - 1 ? 'border-b border-border' : ''
                  }`}
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold uppercase text-brand">
                    {h.hotelName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{h.hotelName}</p>
                    <p className="truncate text-xs text-ink/50">{h.ownerName} · {h.city || h.state}</p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_BADGE[h.status] ?? ''}`}>
                      {h.status}
                    </span>
                    <span className="text-[10px] text-ink/40">{fmt(h.createdAt)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Pending Renewals */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">
              Pending Renewals{' '}
              <span className="font-normal text-ink/40">(next 14 days)</span>
            </h2>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-canvas">
            {data!.pendingRenewals.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink/40">No renewals due</p>
            ) : (
              data!.pendingRenewals.map((h, i) => {
                const endDate = h.trialEndDate || h.subscriptionEndDate;
                const { label, urgent } = daysLeft(endDate);
                return (
                  <Link
                    key={h._id}
                    to={`/super-admin/hotels/${h._id}`}
                    className={`flex items-center gap-3 px-4 py-3 transition hover:bg-mist ${
                      i < data!.pendingRenewals.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{h.hotelName}</p>
                      <p className="truncate text-xs text-ink/50">{h.ownerName} · {h.phone}</p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_BADGE[h.status] ?? ''}`}>
                        {h.status}
                      </span>
                      {label && (
                        <span className={`text-[10px] font-medium ${urgent ? 'text-red-500' : 'text-amber-600'}`}>
                          {label}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* ── Row 7: Expiring Trials (conditional) ── */}
      {expiringTrials.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">
              Expiring Trials{' '}
              <span className="font-normal text-ink/40">(next 7 days)</span>
            </h2>
            <Link to="/super-admin/hotels?status=trial" className="text-xs text-brand hover:underline">
              View all →
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
            {expiringTrials.map((h, i) => {
              const { label, urgent } = daysLeft(h.trialEndDate);
              return (
                <Link
                  key={h._id}
                  to={`/super-admin/hotels/${h._id}`}
                  className={`flex items-center gap-3 px-4 py-3 transition hover:bg-amber-100 ${
                    i < expiringTrials.length - 1 ? 'border-b border-amber-200' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{h.hotelName}</p>
                    <p className="truncate text-xs text-ink/50">{h.ownerName} · {h.phone}</p>
                  </div>
                  {label && (
                    <span className={`text-xs font-semibold ${urgent ? 'text-red-600' : 'text-amber-700'}`}>
                      {label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
