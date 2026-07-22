import { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw, Heart, Database, Server, Wifi, Radio,
  Cpu, Clock, HardDrive, Building2, Smartphone, AlertCircle,
} from 'lucide-react';
import {
  getDashboard,
  getHealth,
  type DashboardData,
  type HealthData,
} from '../../api/superAdmin';

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

function serviceColor(s: string): 'green' | 'amber' | 'red' {
  const v = s.toLowerCase();
  if (v === 'ok' || v === 'connected' || v === 'healthy') return 'green';
  if (v === 'error' || v === 'disconnected' || v === 'failed' || v === 'offline') return 'red';
  return 'amber';
}

function fmtTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });
  } catch {
    return iso;
  }
}

// ── status color map ───────────────────────────────────────────────────────────

const STATUS_CLASSES = {
  green: { icon: 'text-green-600', bg: 'bg-green-50',  border: 'border-green-200', badge: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  amber: { icon: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  red:   { icon: 'text-red-600',   bg: 'bg-red-50',    border: 'border-red-200',   badge: 'bg-red-100 text-red-700',    dot: 'bg-red-500'   },
} as const;

// ── InfraCard ──────────────────────────────────────────────────────────────────

function InfraCard({ icon: Icon, label, status, available }: {
  icon: React.ElementType; label: string; status: string | null; available: boolean;
}) {
  if (!available) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-border bg-mist/40 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mist">
            <Icon size={16} className="text-ink/25" />
          </div>
          <p className="text-sm font-medium text-ink/40">{label}</p>
        </div>
        <span className="rounded-full bg-mist px-2.5 py-0.5 text-[11px] font-medium text-ink/30">Pending</span>
      </div>
    );
  }
  const c = STATUS_CLASSES[serviceColor(status ?? '')];
  const display = status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
  return (
    <div className={`flex items-center justify-between rounded-xl border ${c.border} ${c.bg} p-4`}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-canvas">
          <Icon size={16} className={c.icon} />
        </div>
        <p className="text-sm font-medium text-ink">{label}</p>
      </div>
      <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${c.badge}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
        {display}
      </span>
    </div>
  );
}

// ── MetricTile ─────────────────────────────────────────────────────────────────

function MetricTile({ icon: Icon, label, value, sub, available, comingSoon }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; available: boolean; comingSoon?: boolean;
}) {
  if (!available) {
    return (
      <div className="rounded-xl border border-border bg-mist/40 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Icon size={14} className="text-ink/25" />
          <p className="text-xs font-medium text-ink/30">{label}</p>
        </div>
        <p className="text-xl font-bold text-ink/20">—</p>
        <p className="mt-0.5 text-[10px] text-ink/25">
          {comingSoon ? 'Coming Soon' : 'Real-time data pending'}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={14} className="text-ink/40" />
        <p className="text-xs font-medium text-ink/50">{label}</p>
      </div>
      <p className="text-xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink/40">{sub}</p>}
    </div>
  );
}

// ── InfoRow ────────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-ink/50">{label}</span>
      <span className="text-sm font-medium tabular-nums text-ink">{value}</span>
    </div>
  );
}

// ── SystemHealthPage ───────────────────────────────────────────────────────────

export function SystemHealthPage() {
  const [dash,        setDash]        = useState<DashboardData | null>(null);
  const [health,      setHealth]      = useState<HealthData | null>(null);
  const [dashError,   setDashError]   = useState(false);
  const [healthError, setHealthError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown,   setCountdown]   = useState(REFRESH_SEC);

  const refreshRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    const [dashRes, healthRes] = await Promise.allSettled([getDashboard(), getHealth()]);

    if (dashRes.status   === 'fulfilled') { setDash(dashRes.value);     setDashError(false);   }
    else                                  {                              setDashError(true);    }
    if (healthRes.status === 'fulfilled') { setHealth(healthRes.value); setHealthError(false); }
    else                                  {                              setHealthError(true);  }

    setLastUpdated(new Date());
    setCountdown(REFRESH_SEC);
  }, []);

  useEffect(() => {
    loadData();
    refreshRef.current   = setInterval(loadData, REFRESH_SEC * 1_000);
    countdownRef.current = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1_000);
    return () => {
      if (refreshRef.current)   clearInterval(refreshRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [loadData]);

  // ── derived values ─────────────────────────────────────────────────────────

  const sysHealth = dash?.systemHealth;

  const apiStatus   = sysHealth?.api    ?? health?.api   ?? null;
  const mongoStatus = sysHealth?.mongo  ?? health?.mongo ?? null;
  const redisStatus = sysHealth?.redis  ?? null;

  const memory    = sysHealth?.memory        ?? null;
  const uptimeSec = sysHealth?.uptimeSeconds ?? null;
  const loadAvg   = sysHealth?.loadAvg       ?? null;

  const memBarColor = !memory              ? 'bg-mist'
    : memory.percentage > 80              ? 'bg-red-500'
    : memory.percentage > 60             ? 'bg-amber-500'
    : 'bg-green-500';

  const loadColor = loadAvg === null ? 'text-ink/20'
    : loadAvg < 1 ? 'text-green-700'
    : loadAvg < 2 ? 'text-amber-700'
    : 'text-red-600';

  const hotelsOnline  = dash ? dash.hotelStats.active + dash.hotelStats.trial : null;
  const devicesOnline = dash?.devices.online ?? null;

  // Overall status badge
  const allDown = dashError && healthError;
  const allUp   = !dashError && !healthError
    && apiStatus   !== null && serviceColor(apiStatus)   === 'green'
    && mongoStatus !== null && serviceColor(mongoStatus) === 'green';

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Heart size={18} className="text-brand" />
            <h1 className="text-xl font-bold text-ink">System Health</h1>
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              allDown ? 'bg-red-100 text-red-700'
              : allUp ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                allDown ? 'bg-red-500' : allUp ? 'bg-green-500' : 'bg-amber-500'
              }`} />
              {allDown ? 'Degraded' : allUp ? 'All Systems Operational' : 'Partial'}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink/40">
            Infrastructure and resource monitoring · DinePOS platform
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 text-xs text-ink/50">
          {lastUpdated && (
            <span>
              Updated{' '}
              {lastUpdated.toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </span>
          )}
          <div className="flex items-center gap-2">
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
      </div>

      {/* Error banner */}
      {(dashError || healthError) && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertCircle size={14} />
          {allDown
            ? 'Both health endpoints unavailable — retrying in 15s'
            : dashError
            ? '/dashboard unavailable — some metrics may be stale'
            : '/health unavailable — some metrics may be stale'}
        </div>
      )}

      {/* ── 1. Infrastructure Status ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Infrastructure Status
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfraCard icon={Server}   label="API Server"    status={apiStatus}   available={apiStatus !== null}   />
          <InfraCard icon={Database} label="MongoDB"       status={mongoStatus} available={mongoStatus !== null} />
          <InfraCard icon={Wifi}     label="Redis"         status={redisStatus} available={redisStatus !== null} />
          <InfraCard icon={Radio}    label="Socket Server" status={null}        available={false}                />
        </div>
      </section>

      {/* ── 2. Resource Usage ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Resource Usage
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">

          {/* Memory — detailed */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-3 flex items-center gap-2">
              <Cpu size={14} className="text-ink/40" />
              <p className="text-xs font-medium text-ink/50">Memory Usage</p>
            </div>
            {memory ? (
              <>
                <p className="text-2xl font-bold tabular-nums text-ink">{memory.percentage}%</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-mist">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${memBarColor}`}
                    style={{ width: `${Math.min(100, memory.percentage)}%` }}
                  />
                </div>
                <div className="mt-2 space-y-0.5">
                  <p className="text-[11px] tabular-nums text-ink/40">
                    Heap Used:{'  '}<span className="font-medium text-ink/60">{memory.usedMB} MB</span>
                  </p>
                  <p className="text-[11px] tabular-nums text-ink/40">
                    Heap Total: <span className="font-medium text-ink/60">{memory.totalMB} MB</span>
                  </p>
                  <p className="text-[11px] tabular-nums text-ink/40">
                    RSS:{'        '}<span className="font-medium text-ink/60">{memory.rssMB} MB</span>
                  </p>
                </div>
              </>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-ink/20">—</p>
            )}
          </div>

          {/* Uptime */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock size={14} className="text-ink/40" />
              <p className="text-xs font-medium text-ink/50">Uptime</p>
            </div>
            {uptimeSec !== null ? (
              <>
                <p className="text-2xl font-bold tabular-nums text-ink">{formatUptime(uptimeSec)}</p>
                <p className="mt-1 text-[11px] tabular-nums text-ink/40">
                  {uptimeSec.toLocaleString('en-IN')} seconds
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-ink/20">—</p>
            )}
          </div>

          {/* Load Average */}
          <div className="rounded-xl border border-border bg-canvas p-4">
            <div className="mb-3 flex items-center gap-2">
              <Cpu size={14} className="text-ink/40" />
              <p className="text-xs font-medium text-ink/50">Load Average</p>
            </div>
            {loadAvg !== null ? (
              <>
                <p className={`text-2xl font-bold tabular-nums ${loadColor}`}>{loadAvg.toFixed(2)}</p>
                <p className="mt-1 text-[11px] text-ink/40">
                  {loadAvg < 1 ? 'Low — healthy' : loadAvg < 2 ? 'Moderate' : 'High — investigate'}
                </p>
              </>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-ink/20">—</p>
            )}
          </div>

          {/* CPU — Coming Soon */}
          <MetricTile icon={Cpu}       label="CPU Usage"  value="—" available={false} comingSoon />
          {/* Disk — Coming Soon */}
          <MetricTile icon={HardDrive} label="Disk Usage" value="—" available={false} comingSoon />
        </div>
      </section>

      {/* ── 3. Platform Status ── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Platform Status
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricTile
            icon={Building2} label="Hotels Online"
            value={hotelsOnline ?? '—'} sub="active + trial plans"
            available={hotelsOnline !== null}
          />
          <MetricTile
            icon={Smartphone} label="Devices Online"
            value={devicesOnline ?? '—'} sub="last heartbeat ≤ 5m"
            available={devicesOnline !== null}
          />
          <MetricTile icon={Wifi}   label="Connections"  value="—" available={false} />
          <MetricTile icon={Server} label="Live Orders"   value="—" available={false} />
          <MetricTile icon={Server} label="Sessions"      value="—" available={false} />
        </div>
      </section>

      {/* ── 4. Service Info + 5. Health Timeline ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Service Information */}
        <section className="rounded-xl border border-border bg-canvas p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/40">
            Service Information
          </h2>
          <p className="mb-3 text-[11px] text-ink/30">
            Not exposed by current backend endpoints
          </p>
          <div className="divide-y divide-border">
            <InfoRow label="Backend Version" value="—" />
            <InfoRow label="API Version"     value="—" />
            <InfoRow label="Environment"     value="—" />
            <InfoRow label="Node.js Version" value="—" />
            <InfoRow label="Build Time"      value="—" />
          </div>
        </section>

        {/* Health Timeline */}
        <section className="rounded-xl border border-border bg-canvas p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink/40">
            Health Timeline
          </h2>
          <div className="divide-y divide-border">
            <InfoRow
              label="Last Health Check"
              value={health?.checkedAt ? fmtTimestamp(health.checkedAt) : '—'}
            />
            <InfoRow
              label="Dashboard Generated"
              value={dash?.generatedAt ? fmtTimestamp(dash.generatedAt) : '—'}
            />
            <InfoRow
              label="Last Page Refresh"
              value={lastUpdated
                ? lastUpdated.toLocaleTimeString('en-IN', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })
                : '—'}
            />
            <InfoRow label="Next Refresh" value={`in ${countdown}s`} />
          </div>
        </section>

      </div>

      {/* Footer */}
      <p className="text-center text-[11px] text-ink/30">
        Data refreshes every {REFRESH_SEC} seconds · CPU, Disk, Socket metrics require additional backend endpoints
      </p>

    </div>
  );
}
