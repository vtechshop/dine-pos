import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { fetchAlerts, fetchAlertsByDate, type AlertItem, type AlertResult } from '../../api/aiAlerts';
import { ApiError } from '../../api/client';

// ── Constants & helpers ────────────────────────────────────────────────────────

function getToday() { return new Date().toISOString().slice(0, 10); }

const SEVERITY_ORDER: Record<AlertItem['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

// ── Skeleton card ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-canvas p-4 space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="animate-pulse rounded bg-border h-5 w-5 shrink-0" />
        <div className="animate-pulse rounded bg-border h-4 w-40" />
      </div>
      <div className="animate-pulse rounded bg-border h-3 w-full" />
      <div className="animate-pulse rounded bg-border h-3 w-3/4" />
      <div className="flex gap-4 mt-1">
        <div className="animate-pulse rounded bg-border h-3 w-20" />
        <div className="animate-pulse rounded bg-border h-3 w-20" />
        <div className="animate-pulse rounded bg-border h-3 w-16" />
      </div>
    </div>
  );
}

// ── Alert card ─────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<
  AlertItem['severity'],
  { wrapper: string; text: string; icon: React.ReactNode }
> = {
  critical: {
    wrapper: 'border-l-4 border-red-500 bg-red-50',
    text: 'text-red-700',
    icon: <AlertTriangle size={18} className="shrink-0 text-red-500" />,
  },
  warning: {
    wrapper: 'border-l-4 border-amber-500 bg-amber-50',
    text: 'text-amber-700',
    icon: <AlertCircle size={18} className="shrink-0 text-amber-500" />,
  },
  info: {
    wrapper: 'border-l-4 border-blue-500 bg-blue-50',
    text: 'text-blue-600',
    icon: <Info size={18} className="shrink-0 text-blue-500" />,
  },
};

function AlertCard({ alert }: { alert: AlertItem }) {
  const { severity, title, message, value, baseline, changePct } = alert;
  const s = SEVERITY_STYLES[severity];
  const pctColor = changePct >= 0 ? 'text-green-600' : 'text-red-600';

  return (
    <div className={`rounded-xl p-4 ${s.wrapper}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{s.icon}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold ${s.text}`}>{title}</p>
          <p className={`text-xs mt-0.5 leading-snug ${s.text} opacity-80`}>{message}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-ink/60">
            <span>
              Value: <strong className="text-ink tabular-nums">{value.toLocaleString()}</strong>
            </span>
            <span>
              Baseline: <strong className="text-ink tabular-nums">{baseline.toLocaleString()}</strong>
            </span>
            <span>
              Change:{' '}
              <strong className={`tabular-nums ${pctColor}`}>{fmtPct(changePct)}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function AlertsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getToday());
  const [isToday, setIsToday] = useState(true);
  const [result, setResult] = useState<AlertResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorIs404, setErrorIs404] = useState(false);

  const load = useCallback(async (date: string, today: boolean) => {
    setLoading(true);
    setError(null);
    setErrorIs404(false);
    setResult(null);
    try {
      const data = today ? await fetchAlerts() : await fetchAlertsByDate(date);
      setResult(data);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        setErrorIs404(true);
        setError('No data for this date. Historical data requires a completed daily snapshot.');
      } else {
        setError('Failed to load alerts. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedDate, isToday);
  }, [load, selectedDate, isToday]);

  function handleTodayClick() {
    if (isToday) {
      load(getToday(), true);
    } else {
      setSelectedDate(getToday());
      setIsToday(true);
    }
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const d = e.target.value;
    if (!d) return;
    setSelectedDate(d);
    setIsToday(d === getToday());
  }

  const sorted = result
    ? [...result.alerts].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      )
    : [];

  const criticalCount = sorted.filter(a => a.severity === 'critical').length;
  const warningCount = sorted.filter(a => a.severity === 'warning').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <h1 className="text-sm font-bold text-ink">Alerts</h1>
              {!loading && result && (
                <p className="text-[11px] text-ink/50">
                  {criticalCount} critical · {warningCount} warnings
                </p>
              )}
              {loading && (
                <div className="animate-pulse rounded bg-border h-3 w-32 mt-1" />
              )}
            </div>

            {/* Source badge */}
            {result && !loading && (
              isToday ? (
                <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                  Live · as of {fmtTime(result.checkedAt)}
                </span>
              ) : (
                <span className="rounded-full border border-border bg-mist px-2.5 py-0.5 text-[11px] font-semibold text-ink/60">
                  Snapshot
                </span>
              )
            )}
          </div>

          {/* Date controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleTodayClick}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                isToday
                  ? 'bg-brand text-white'
                  : 'border border-border bg-mist text-ink/60 hover:bg-brand/10'
              }`}
            >
              Today
            </button>
            <input
              type="date"
              value={selectedDate}
              max={getToday()}
              onChange={handleDateChange}
              className="rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <button
              onClick={() => load(selectedDate, isToday)}
              disabled={loading}
              title="Refresh"
              className="rounded-lg p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink/70 disabled:opacity-30"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Loading skeleton — 3 cards */}
        {loading && (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="rounded-xl border border-border bg-canvas p-6 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-ink/70 max-w-sm">{error}</p>
            {!errorIs404 && (
              <button
                onClick={() => load(selectedDate, isToday)}
                className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* All-clear state */}
        {!loading && !error && result && sorted.length === 0 && (
          <div className="rounded-xl border border-border bg-canvas p-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 size={40} className="text-green-500" />
            <p className="text-base font-bold text-ink">All Clear</p>
            <p className="text-sm text-ink/60">No alerts detected for {result.date}</p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                result.dataSource === 'realtime'
                  ? 'bg-green-100 text-green-700'
                  : 'border border-border bg-mist text-ink/60'
              }`}
            >
              {result.dataSource === 'realtime' ? 'Realtime' : 'Snapshot'}
            </span>
          </div>
        )}

        {/* Alert cards */}
        {!loading && !error && sorted.length > 0 && (
          <div className="space-y-3">
            {sorted.map((alert, i) => (
              <AlertCard key={`${alert.type}-${i}`} alert={alert} />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
