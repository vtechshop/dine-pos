import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, AlertCircle, ShieldCheck, AlertTriangle,
  CheckCircle2, Clock, CreditCard, Smartphone, ShoppingBag,
  TrendingUp, Zap, Info,
} from 'lucide-react';
import {
  getHotel, getTopHotels, getDeviceLicensing,
  type Hotel, type TopHotel, type DeviceLicensingData,
} from '../../api/superAdmin';
import { Spinner } from '../../components/ui/Spinner';

// ── HEALTH SCORE ALGORITHM ─────────────────────────────────────────────────────
// Total: 100 points across 6 dimensions.
//
// D1 — Account Status (30 pts): from hotel.status
//   active: 30 | trial: 22 | pending: 12 | expired: 5 | suspended: 0 | rejected: 0
//
// D2 — Subscription Days Remaining (25 pts): trialEndDate ?? subscriptionEndDate
//   >30d: 25 | 15–30d: 18 | 7–14d: 10 | 1–6d: 4 | 0d: 0
//   No end date on active plan: 5 (indeterminate — may be lifetime/manual)
//
// D3 — Plan Tier (15 pts): from subscriptionType
//   enterprise: 15 | professional: 12 | starter: 8 | trial: 5
//
// D4 — Activity / Last Seen (10 pts): getTopHotels('activity','today') top-10
//   in top-10, lastSeen < 1h:   10 pts
//   in top-10, lastSeen 1–6h:    7 pts
//   in top-10, lastSeen 6–24h:   4 pts
//   not in today's top-10:       0 pts (insufficient platform data)
//
// D5 — Revenue Contribution (10 pts): getTopHotels('revenue','today') top-10
//   in top-10 with value > 0:   10 pts | otherwise: 0 pts
//
// D6 — Order Activity (10 pts): getTopHotels('orders','today') top-10
//   in top-10 with value > 0:   10 pts | otherwise: 0 pts
//
// Health Badge thresholds:
//   75–100 → Healthy (green)
//   50–74  → Warning (amber)
//   0–49   → Critical (red)
// ──────────────────────────────────────────────────────────────────────────────

// ── module-level helpers (Date.now() safe outside hooks) ──────────────────────

function daysRemaining(endDate: string | null | undefined): number | null {
  if (!endDate) return null;
  const diff = new Date(endDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

function minutesAgo(iso: string | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function fmtAgo(iso: string | undefined): string {
  if (!iso) return '—';
  const m = minutesAgo(iso) ?? 0;
  if (m < 1)    return 'just now';
  if (m < 60)   return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtINR(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}

// ── scoring ───────────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  d1Status:   number;   // 0–30
  d2Days:     number;   // 0–25
  d3Plan:     number;   // 0–15
  d4Activity: number;   // 0–10
  d5Revenue:  number;   // 0–10
  d6Orders:   number;   // 0–10
  total:      number;   // 0–100
  d4Known:    boolean;
  d5Known:    boolean;
  d6Known:    boolean;
}

function computeScore(
  hotel:      Hotel,
  actHotel:   TopHotel | null,
  revHotel:   TopHotel | null,
  ordHotel:   TopHotel | null,
): ScoreBreakdown {
  // D1 — Account Status
  const statusPts: Record<string, number> = {
    active: 30, trial: 22, pending: 12, expired: 5, suspended: 0, rejected: 0,
  };
  const d1Status = statusPts[hotel.status] ?? 0;

  // D2 — Subscription Days Remaining
  const effectiveEnd = hotel.trialEndDate ?? hotel.subscriptionEndDate;
  const d2Days = (() => {
    if (!effectiveEnd) return hotel.status === 'active' ? 5 : 0;
    const days = daysRemaining(effectiveEnd) ?? 0;
    if (days > 30)  return 25;
    if (days >= 15) return 18;
    if (days >= 7)  return 10;
    if (days >= 1)  return 4;
    return 0;
  })();

  // D3 — Plan Tier
  const planPts: Record<string, number> = {
    enterprise: 15, professional: 12, starter: 8, trial: 5,
  };
  const d3Plan = planPts[hotel.subscriptionType] ?? 0;

  // D4 — Activity / Last Seen (top-10 platform data)
  let d4Activity = 0;
  const d4Known = actHotel !== null;
  if (actHotel?.lastSeen) {
    const m = minutesAgo(actHotel.lastSeen) ?? Infinity;
    if      (m < 60)   d4Activity = 10;
    else if (m < 360)  d4Activity = 7;
    else               d4Activity = 4;
  }

  // D5 — Revenue Contribution
  const d5Known = revHotel !== null;
  const d5Revenue = (revHotel && (revHotel.value ?? 0) > 0) ? 10 : 0;

  // D6 — Order Activity
  const d6Known = ordHotel !== null;
  const d6Orders = (ordHotel && (ordHotel.value ?? 0) > 0) ? 10 : 0;

  const total = d1Status + d2Days + d3Plan + d4Activity + d5Revenue + d6Orders;

  return { d1Status, d2Days, d3Plan, d4Activity, d5Revenue, d6Orders, total, d4Known, d5Known, d6Known };
}

// ── action recommendations ────────────────────────────────────────────────────

type ActionLevel = 'critical' | 'warning' | 'info' | 'success';

interface Action {
  level:   ActionLevel;
  heading: string;
  detail:  string;
}

function computeActions(
  hotel:    Hotel,
  score:    ScoreBreakdown,
  actHotel: TopHotel | null,
  revHotel: TopHotel | null,
  ordHotel: TopHotel | null,
): Action[] {
  const actions: Action[] = [];
  const days = daysRemaining(hotel.trialEndDate ?? hotel.subscriptionEndDate);

  if (hotel.status === 'suspended')
    actions.push({ level: 'critical', heading: 'Hotel is suspended', detail: 'Access is revoked. Investigate the cause and use the hotel detail page to reactivate.' });

  if (hotel.status === 'rejected')
    actions.push({ level: 'critical', heading: 'Application was rejected', detail: `Rejection reason: ${hotel.rejectionReason || 'not provided'}.` });

  if (hotel.status === 'expired')
    actions.push({ level: 'critical', heading: 'Subscription has expired', detail: 'Restore access by applying a new plan on the hotel detail page.' });

  if (hotel.status === 'pending')
    actions.push({ level: 'warning', heading: 'Awaiting approval', detail: 'This hotel has not been approved yet. Review and approve or reject on the hotel detail page.' });

  if (days !== null && days <= 3 && hotel.status !== 'suspended' && hotel.status !== 'expired' && hotel.status !== 'rejected')
    actions.push({ level: 'critical', heading: `Subscription expires in ${days} day${days !== 1 ? 's' : ''}`, detail: 'Contact the hotel owner immediately and apply a renewal plan.' });
  else if (days !== null && days <= 7 && hotel.status !== 'suspended' && hotel.status !== 'expired')
    actions.push({ level: 'warning', heading: `Subscription expires in ${days} days`, detail: 'Send a renewal reminder and prepare to apply a new plan.' });
  else if (days !== null && days <= 14 && hotel.status !== 'suspended' && hotel.status !== 'expired')
    actions.push({ level: 'info', heading: `Subscription expiring in ${days} days`, detail: 'Consider reaching out to prompt early renewal.' });

  if (!actHotel && (hotel.status === 'active' || hotel.status === 'trial'))
    actions.push({ level: 'warning', heading: 'Not seen in today\'s top-10 activity', detail: 'The hotel may not have active devices or may not be generating orders. Confirm device connectivity.' });

  if (!revHotel && (hotel.status === 'active' || hotel.status === 'trial'))
    actions.push({ level: 'info', heading: 'No revenue in top-10 today', detail: 'Revenue data is unavailable or below platform top-10 — hotel may be operational but with lower volume.' });

  if (!ordHotel && (hotel.status === 'active' || hotel.status === 'trial'))
    actions.push({ level: 'info', heading: 'No orders in top-10 today', detail: 'Could indicate a slow day, an early morning check, or a device connectivity issue.' });

  if (score.total >= 75 && actions.filter(a => a.level === 'critical' || a.level === 'warning').length === 0)
    actions.push({ level: 'success', heading: 'Hotel is healthy', detail: 'No critical or warning issues detected. Continue monitoring normally.' });

  return actions;
}

// ── sub-components ─────────────────────────────────────────────────────────────

function HealthBadge({ score }: { score: number }) {
  if (score >= 75)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
        <CheckCircle2 size={14} /> Healthy
      </span>
    );
  if (score >= 50)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
        <AlertTriangle size={14} /> Warning
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">
      <AlertCircle size={14} /> Critical
    </span>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
  const stroke = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const textColor = score >= 75 ? 'text-green-600' : score >= 50 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="relative h-40 w-40 flex-shrink-0">
      <svg viewBox="0 0 100 100" className="-rotate-90 h-full w-full">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="9" className="stroke-mist" />
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-black tabular-nums leading-none ${textColor}`}>{score}</span>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink/30">/ 100</span>
      </div>
    </div>
  );
}

function DimRow({
  label, pts, max, known, detail,
}: { label: string; pts: number; max: number; known?: boolean; detail: string }) {
  const pct = max > 0 ? (pts / max) * 100 : 0;
  const barColor = pts >= max * 0.8 ? 'bg-green-500' : pts >= max * 0.4 ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium text-ink">{label}</p>
        <div className="flex items-center gap-2">
          {known === false && (
            <span className="text-[10px] text-ink/30">Insufficient data</span>
          )}
          <span className="tabular-nums text-sm font-bold text-ink">{pts}</span>
          <span className="text-xs text-ink/30">/ {max}</span>
        </div>
      </div>
      <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-mist">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-ink/40">{detail}</p>
    </div>
  );
}

function ActionCard({ action }: { action: Action }) {
  const styles: Record<ActionLevel, { border: string; icon: React.ElementType; iconColor: string }> = {
    critical: { border: 'border-red-200 bg-red-50',    icon: AlertCircle,  iconColor: 'text-red-500'   },
    warning:  { border: 'border-amber-200 bg-amber-50',icon: AlertTriangle, iconColor: 'text-amber-500' },
    info:     { border: 'border-border bg-canvas',     icon: Info,          iconColor: 'text-ink/40'    },
    success:  { border: 'border-green-200 bg-green-50',icon: CheckCircle2,  iconColor: 'text-green-500' },
  };
  const { border, icon: Icon, iconColor } = styles[action.level];

  return (
    <div className={`flex gap-3 rounded-xl border p-4 ${border}`}>
      <Icon size={16} className={`mt-0.5 flex-shrink-0 ${iconColor}`} />
      <div>
        <p className="text-sm font-semibold text-ink">{action.heading}</p>
        <p className="mt-0.5 text-xs text-ink/60">{action.detail}</p>
      </div>
    </div>
  );
}

// ── HotelHealthPage ────────────────────────────────────────────────────────────

export function HotelHealthPage() {
  const { id } = useParams<{ id: string }>();

  const [hotel,       setHotel]       = useState<Hotel | null>(null);
  const [actHotel,    setActHotel]    = useState<TopHotel | null>(null);
  const [revHotel,    setRevHotel]    = useState<TopHotel | null>(null);
  const [ordHotel,    setOrdHotel]    = useState<TopHotel | null>(null);
  const [devLicensing,setDevLicensing]= useState<DeviceLicensingData | null>(null);

  const [loading,     setLoading]     = useState(true);
  const [hotelError,  setHotelError]  = useState<string | null>(null);
  const [partialErr,  setPartialErr]  = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setHotelError(null);
    setPartialErr(false);

    const [hRes, actRes, revRes, ordRes, devRes] = await Promise.allSettled([
      getHotel(id),
      getTopHotels('activity', 'today'),
      getTopHotels('revenue',  'today'),
      getTopHotels('orders',   'today'),
      getDeviceLicensing(),
    ]);

    if (cancelled) return;

    if (hRes.status === 'fulfilled') {
      setHotel(hRes.value);
    } else {
      setHotelError(hRes.reason instanceof Error ? hRes.reason.message : 'Failed to load hotel');
      setLoading(false);
      return;
    }

    const hotelId = hRes.value._id;
    let anyPartial = false;

    if (actRes.status === 'fulfilled') {
      setActHotel(actRes.value.hotels.find(h => h.hotelId === hotelId) ?? null);
    } else { setActHotel(null); anyPartial = true; }

    if (revRes.status === 'fulfilled') {
      setRevHotel(revRes.value.hotels.find(h => h.hotelId === hotelId) ?? null);
    } else { setRevHotel(null); anyPartial = true; }

    if (ordRes.status === 'fulfilled') {
      setOrdHotel(ordRes.value.hotels.find(h => h.hotelId === hotelId) ?? null);
    } else { setOrdHotel(null); anyPartial = true; }

    if (devRes.status === 'fulfilled') setDevLicensing(devRes.value);
    else { setDevLicensing(null); anyPartial = true; }

    if (anyPartial) setPartialErr(true);
    setLastUpdated(new Date());
    setLoading(false);

    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ── derived ────────────────────────────────────────────────────────────────
  const scoreBreakdown = useMemo<ScoreBreakdown | null>(() => {
    if (!hotel) return null;
    return computeScore(hotel, actHotel, revHotel, ordHotel);
  }, [hotel, actHotel, revHotel, ordHotel]);

  const actions = useMemo<Action[]>(() => {
    if (!hotel || !scoreBreakdown) return [];
    return computeActions(hotel, scoreBreakdown, actHotel, revHotel, ordHotel);
  }, [hotel, scoreBreakdown, actHotel, revHotel, ordHotel]);

  const allowedDevices = useMemo(() => {
    if (!hotel || !devLicensing) return null;
    return devLicensing.byPlan.find(b => b.plan === hotel.subscriptionType)?.allowedPerHotel ?? null;
  }, [hotel, devLicensing]);

  const effectiveDays = hotel
    ? daysRemaining(hotel.trialEndDate ?? hotel.subscriptionEndDate)
    : null;

  // ── error state ────────────────────────────────────────────────────────────
  if (hotelError) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {hotelError}
        </div>
        <Link to={`/super-admin/hotels/${id}`} className="mt-4 inline-flex items-center gap-1 text-sm text-brand hover:underline">
          <ArrowLeft size={14} /> Back to Hotel Detail
        </Link>
      </div>
    );
  }

  // ── loading ────────────────────────────────────────────────────────────────
  if (loading || !hotel || !scoreBreakdown) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  const { total, d1Status, d2Days, d3Plan, d4Activity, d5Revenue, d6Orders, d4Known, d5Known, d6Known } = scoreBreakdown;

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to={`/super-admin/hotels/${hotel._id}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink/50 transition hover:text-ink"
          >
            <ArrowLeft size={14} /> {hotel.hotelName}
          </Link>
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={18} className="text-brand" />
            <h1 className="text-xl font-bold text-ink">Hotel Health Score</h1>
          </div>
          <p className="mt-1 text-sm text-ink/40">
            {hotel.city}, {hotel.state} · {hotel.subscriptionType} plan · {hotel.status}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs text-ink/50">
          {lastUpdated && (
            <span>
              Loaded {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-ink/60 transition hover:bg-mist disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Partial data banner */}
      {partialErr && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertCircle size={14} />
          Some platform endpoints failed — score may undercount activity, revenue, or order dimensions
        </div>
      )}

      {/* ── Hero: Gauge + Breakdown ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* LEFT — Gauge */}
        <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-border bg-canvas p-8">
          <ScoreGauge score={total} />
          <div className="text-center">
            <HealthBadge score={total} />
            <p className="mt-3 text-sm text-ink/50">
              {hotel.hotelName}
            </p>
            <p className="mt-1 text-xs text-ink/30">
              Computed from {d4Known || d5Known || d6Known ? 'hotel data + today\'s platform activity' : 'hotel data only (activity unavailable)'}
            </p>
          </div>
        </div>

        {/* RIGHT — Score breakdown */}
        <div className="rounded-xl border border-border bg-canvas p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink/40">
            Score Breakdown
          </p>
          <div className="divide-y divide-border">
            <DimRow
              label="Account Status"
              pts={d1Status}
              max={30}
              detail={`Status: ${hotel.status}${hotel.approvedAt ? ` · Approved ${fmtDate(hotel.approvedAt)}` : ''}`}
            />
            <DimRow
              label="Subscription Health"
              pts={d2Days}
              max={25}
              detail={
                effectiveDays !== null
                  ? `${effectiveDays} day${effectiveDays !== 1 ? 's' : ''} remaining · expires ${fmtDate(hotel.trialEndDate ?? hotel.subscriptionEndDate)}`
                  : 'No expiry date on record'
              }
            />
            <DimRow
              label="Plan Tier"
              pts={d3Plan}
              max={15}
              detail={`Plan: ${hotel.subscriptionType}`}
            />
            <DimRow
              label="Activity / Last Seen"
              pts={d4Activity}
              max={10}
              known={d4Known}
              detail={
                actHotel
                  ? `Last seen: ${fmtAgo(actHotel.lastSeen)} · ${actHotel.deviceCount ?? 0} device(s) active`
                  : 'Hotel not in today\'s top-10 activity — last seen unavailable'
              }
            />
            <DimRow
              label="Revenue Contribution"
              pts={d5Revenue}
              max={10}
              known={d5Known}
              detail={
                revHotel
                  ? `Revenue today (top-10): ${fmtINR(revHotel.value ?? 0)}`
                  : 'Not in today\'s top-10 revenue — may have lower volume'
              }
            />
            <DimRow
              label="Order Activity"
              pts={d6Orders}
              max={10}
              known={d6Known}
              detail={
                ordHotel
                  ? `Orders today (top-10): ${ordHotel.value ?? 0} order${(ordHotel.value ?? 0) !== 1 ? 's' : ''}`
                  : 'Not in today\'s top-10 orders — may have lower volume'
              }
            />
          </div>
        </div>
      </div>

      {/* ── Detail Metrics ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Impact Details
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

          {/* Last Seen */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-ink/50">Last Seen</p>
              <Clock size={13} className="text-ink/30" />
            </div>
            <p className="text-lg font-bold text-ink">
              {actHotel?.lastSeen ? fmtAgo(actHotel.lastSeen) : '—'}
            </p>
            <p className="mt-0.5 text-[11px] text-ink/40">
              {actHotel?.lastSeen ? fmtDate(actHotel.lastSeen) : 'Not in today\'s top-10'}
            </p>
          </div>

          {/* Device Connectivity */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-ink/50">Devices</p>
              <Smartphone size={13} className="text-ink/30" />
            </div>
            <p className="text-lg font-bold text-ink">
              {actHotel?.deviceCount !== undefined ? actHotel.deviceCount : '—'}
            </p>
            <p className="mt-0.5 text-[11px] text-ink/40">
              {allowedDevices !== null
                ? `of ${allowedDevices} allowed (${hotel.subscriptionType})`
                : 'allowed limit unavailable'}
            </p>
          </div>

          {/* Revenue Today */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-ink/50">Revenue Today</p>
              <TrendingUp size={13} className="text-ink/30" />
            </div>
            <p className="text-lg font-bold text-ink">
              {revHotel ? fmtINR(revHotel.value ?? 0) : '—'}
            </p>
            <p className="mt-0.5 text-[11px] text-ink/40">
              {revHotel ? 'In today\'s top-10' : 'Not in today\'s top-10'}
            </p>
          </div>

          {/* Orders Today */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium text-ink/50">Orders Today</p>
              <ShoppingBag size={13} className="text-ink/30" />
            </div>
            <p className="text-lg font-bold text-ink">
              {ordHotel ? (ordHotel.value ?? 0) : '—'}
            </p>
            <p className="mt-0.5 text-[11px] text-ink/40">
              {ordHotel ? 'In today\'s top-10' : 'Not in today\'s top-10'}
            </p>
          </div>
        </div>
      </section>

      {/* ── Subscription Impact ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Subscription Impact
        </h2>
        <div className="rounded-xl border border-border bg-canvas p-5">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">

            <div>
              <div className="mb-1 flex items-center gap-1.5 text-ink/50">
                <CreditCard size={13} />
                <p className="text-xs font-medium">Current Plan</p>
              </div>
              <p className="text-sm font-bold capitalize text-ink">{hotel.subscriptionType}</p>
              <p className="text-[11px] text-ink/40">
                {hotel.subscriptionType === 'enterprise' ? 'Top tier — max features'
                  : hotel.subscriptionType === 'professional' ? 'Mid tier'
                  : hotel.subscriptionType === 'starter' ? 'Entry tier'
                  : 'Trial access'}
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5 text-ink/50">
                <Clock size={13} />
                <p className="text-xs font-medium">Days Remaining</p>
              </div>
              <p className={`text-sm font-bold ${
                effectiveDays === null ? 'text-ink'
                  : effectiveDays <= 7 ? 'text-red-600'
                  : effectiveDays <= 14 ? 'text-amber-600'
                  : 'text-green-700'
              }`}>
                {effectiveDays !== null ? `${effectiveDays}d` : '—'}
              </p>
              <p className="text-[11px] text-ink/40">
                {effectiveDays === null ? 'No expiry on record'
                  : effectiveDays <= 0 ? 'Expired'
                  : `Until ${fmtDate(hotel.trialEndDate ?? hotel.subscriptionEndDate)}`}
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5 text-ink/50">
                <Zap size={13} />
                <p className="text-xs font-medium">Features Enabled</p>
              </div>
              <p className="text-sm font-bold text-ink">
                {Object.values(hotel.features).filter(Boolean).length}
                <span className="text-ink/30"> / {Object.keys(hotel.features).length}</span>
              </p>
              <p className="text-[11px] text-ink/40">feature modules active</p>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5 text-ink/50">
                <Smartphone size={13} />
                <p className="text-xs font-medium">Device Allowance</p>
              </div>
              <p className="text-sm font-bold text-ink">
                {allowedDevices !== null ? allowedDevices : '—'}
                {actHotel?.deviceCount !== undefined && allowedDevices !== null && (
                  <span className="text-ink/40 font-normal"> ({actHotel.deviceCount} used)</span>
                )}
              </p>
              <p className="text-[11px] text-ink/40">
                {allowedDevices !== null ? `Limit for ${hotel.subscriptionType} plan` : 'License data unavailable'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recommended Action Panel ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Recommended Actions
        </h2>
        {actions.length === 0 ? (
          <div className="rounded-xl border border-border bg-canvas px-5 py-8 text-center text-sm text-ink/40">
            No recommendations available
          </div>
        ) : (
          <div className="space-y-2.5">
            {actions.map((a, i) => <ActionCard key={i} action={a} />)}
          </div>
        )}

        <div className="mt-4 flex gap-3">
          <Link
            to={`/super-admin/hotels/${hotel._id}`}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-canvas transition hover:opacity-90"
          >
            Manage This Hotel
          </Link>
          <Link
            to="/super-admin/hotels"
            className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-ink/60 transition hover:bg-mist"
          >
            All Hotels
          </Link>
        </div>
      </section>

      <p className="text-center text-[11px] text-ink/30">
        Activity, revenue, and order dimensions reflect top-10 platform data only ·
        Scores reset to 0 for dimensions where this hotel is outside the top-10 today
      </p>
    </div>
  );
}
