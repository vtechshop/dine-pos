import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Activity, Database, Server, Cpu, Clock, Wifi, Smartphone } from 'lucide-react';
import {
  getDashboard,
  getHealth,
  type DashboardData,
  type HealthData,
} from '../../api/superAdmin';
import { Spinner } from '../../components/ui/Spinner';

// ── constants ──────────────────────────────────────────────────────────────────

const REFRESH_SEC = 15;

// ── helpers ────────────────────────────────────────────────────────────────────

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function serviceColor(status: string): 'green' | 'amber' | 'red' {
  const s = status.toLowerCase();
  if (s === 'ok' || s === 'connected') return 'green';
  if (s === 'error' || s === 'disconnected' || s === 'failed') return 'red';
  return 'amber';
}

function formatLoadAvg(avg: number): { label: string; color: 'green' | 'amber' | 'red' } {
  if (avg < 1)  return { label: avg.toFixed(2), color: 'green' };
  if (avg < 2)  return { label: avg.toFixed(2), color: 'amber' };
  return           { label: avg.toFixed(2), color: 'red' };
}

// ── sub-components ─────────────────────────────────────────────────────────────

interface MetricCardProps {
  label:     string;
  value:     string | number;
  sub?:      string;
  available: boolean;
}

function MetricCard({ label, value, sub, available }: MetricCardProps) {
  if (!available) {
    return (
      <div className="rounded-xl border border-border bg-mist/50 p-4">
        <p className="text-xs font-medium text-ink/30">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-ink/20">—</p>
        {sub && <p className="mt-0.5 text-[10px] text-ink/25">{sub}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      <p className="text-xs font-medium text-ink/50">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink/40">{sub}</p>}
    </div>
  );
}

interface StatusCardProps {
  icon:   React.ElementType;
  label:  string;
  status: string;
}

function StatusCard({ icon: Icon, label, status }: StatusCardProps) {
  const color  = serviceColor(status);
  const colors = {
    green: { dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50',  border: 'border-green-200' },
    amber: { dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50',  border: 'border-amber-200' },
    red:   { dot: 'bg-red-500',   text: 'text-red-700',   bg: 'bg-red-50',    border: 'border-red-200'   },
  }[color];

  const displayStatus = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} p-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} className={colors.text} />
          <p className="text-sm font-medium text-ink">{label}</p>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${colors.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
          {displayStatus}
        </span>
      </div>
    </div>
  );
}

// ── LiveMonitoringPage ─────────────────────────────────────────────────────────

export function LiveMonitoringPage() {
  const [dash,        setDash]        = useState<DashboardData | null>(null);
  const [health,      setHealth]      = useState<HealthData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown,   setCountdown]   = useState(REFRESH_SEC);

  const refreshRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFirst      = useRef(true);

  const loadData = useCallback(async () => {
    const [dashRes, healthRes] = await Promise.allSettled([getDashboard(), getHealth()]);

    const dashOk   = dashRes.status   === 'fulfilled';
    const healthOk = healthRes.status === 'fulfilled';

    if (dashOk)   setDash(dashRes.value);
    if (healthOk) setHealth(healthRes.value);

    if (!dashOk && !healthOk) {
      setFetchError('Connection failed — retrying in 15s');
    } else if (!dashOk || !healthOk) {
      setFetchError('Partial data — one endpoint unavailable');
    } else {
      setFetchError(null);
    }

    setLastUpdated(new Date());
    setCountdown(REFRESH_SEC);
    if (isFirst.current) { setLoading(false); isFirst.current = false; }
  }, []);

  useEffect(() => {
    loadData();

    refreshRef.current   = setInterval(loadData, REFRESH_SEC * 1_000);
    countdownRef.current = setInterval(
      () => setCountdown(c => Math.max(0, c - 1)),
      1_000,
    );

    return () => {
      if (refreshRef.current)   clearInterval(refreshRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  // ── derive display values ──────────────────────────────────────────────────

  const hotelStats   = dash?.hotelStats;
  const sysHealth    = dash?.systemHealth;

  const activeHotels = hotelStats
    ? hotelStats.active + hotelStats.trial
    : null;
  const devicesOnline = dash?.devices.online ?? null;

  // System status — prefer dashboard (has Redis), fall back to health
  const mongoStatus  = sysHealth?.mongo  ?? health?.mongo ?? '—';
  const redisStatus  = sysHealth?.redis  ?? '—';
  const apiStatus    = sysHealth?.api    ?? health?.api   ?? '—';

  // Resource usage
  const memory       = sysHealth?.memory       ?? null;
  const uptimeSec    = sysHealth?.uptimeSeconds ?? null;
  const loadAvg      = sysHealth?.loadAvg       ?? null;
  const loadInfo     = loadAvg !== null ? formatLoadAvg(loadAvg) : null;

  const loadColors = {
    green: 'text-green-700',
    amber: 'text-amber-700',
    red:   'text-red-600',
  } as const;

  const memBarColor = memory
    ? memory.percentage > 80 ? 'bg-red-500'
    : memory.percentage > 60 ? 'bg-amber-500'
    : 'bg-green-500'
    : 'bg-mist';

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Activity size={18} className="text-brand" />
          <h1 className="text-xl font-bold text-ink">Live Monitoring</h1>
          {/* Pulsing live indicator */}
          <span className="relative ml-1 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-ink/50">
          {lastUpdated && (
            <span>
              Updated{' '}
              {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <span className="tabular-nums">
            ↻ in <strong className="text-ink/70">{countdown}s</strong>
          </span>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-ink/60 transition hover:bg-mist"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {/* Partial-fetch error banner */}
      {fetchError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          {fetchError}
        </div>
      )}

      {/* ── Platform Activity ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Platform Activity
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="Hotels Active"
            value={activeHotels ?? '—'}
            sub="on active or trial plan"
            available={activeHotels !== null}
          />
          <MetricCard
            label="Devices Online"
            value={devicesOnline ?? '—'}
            sub="last heartbeat ≤ 5 min"
            available={devicesOnline !== null}
          />
          <MetricCard
            label="Active Cashiers"
            value="—"
            sub="Real-time data pending"
            available={false}
          />
          <MetricCard
            label="Kitchen Screens"
            value="—"
            sub="Real-time data pending"
            available={false}
          />
          <MetricCard
            label="QR Users"
            value="—"
            sub="Real-time data pending"
            available={false}
          />
          <MetricCard
            label="Current Orders"
            value="—"
            sub="Real-time data pending"
            available={false}
          />
          <MetricCard
            label="Active Tables"
            value="—"
            sub="Real-time data pending"
            available={false}
          />
        </div>
      </section>

      {/* ── System Status ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          System Status
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatusCard icon={Database} label="MongoDB"  status={mongoStatus} />
          <StatusCard icon={Wifi}     label="Redis"    status={redisStatus} />
          <StatusCard icon={Server}   label="API"      status={apiStatus}   />
        </div>
      </section>

      {/* ── Resource Usage ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Resource Usage
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

          {/* Memory */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-2 flex items-center gap-2">
              <Cpu size={14} className="text-ink/40" />
              <p className="text-xs font-medium text-ink/50">Memory</p>
            </div>
            {memory ? (
              <>
                <p className="text-2xl font-bold tabular-nums text-ink">
                  {memory.percentage}%
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-mist">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${memBarColor}`}
                    style={{ width: `${Math.min(100, memory.percentage)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-ink/40 tabular-nums">
                  {memory.usedMB} MB used / {memory.totalMB} MB heap
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-ink/20">—</p>
            )}
          </div>

          {/* Uptime */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-2 flex items-center gap-2">
              <Clock size={14} className="text-ink/40" />
              <p className="text-xs font-medium text-ink/50">Uptime</p>
            </div>
            {uptimeSec !== null ? (
              <>
                <p className="text-2xl font-bold tabular-nums text-ink">
                  {formatUptime(uptimeSec)}
                </p>
                <p className="mt-0.5 text-[11px] text-ink/40 tabular-nums">
                  {uptimeSec.toLocaleString('en-IN')} seconds
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-ink/20">—</p>
            )}
          </div>

          {/* Load Average */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-2 flex items-center gap-2">
              <Smartphone size={14} className="text-ink/40" />
              <p className="text-xs font-medium text-ink/50">Load Average</p>
            </div>
            {loadInfo ? (
              <>
                <p className={`text-2xl font-bold tabular-nums ${loadColors[loadInfo.color]}`}>
                  {loadInfo.label}
                </p>
                <p className="mt-0.5 text-[11px] text-ink/40">
                  {loadInfo.color === 'green' ? 'Low — healthy'
                    : loadInfo.color === 'amber' ? 'Moderate'
                    : 'High — investigate'}
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-ink/20">—</p>
            )}
          </div>

        </div>
      </section>

      {/* Footer note */}
      <p className="text-center text-[11px] text-ink/30">
        Data refreshes every {REFRESH_SEC} seconds · Unavailable metrics require additional backend endpoints
      </p>

    </div>
  );
}
