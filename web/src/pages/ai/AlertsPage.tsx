import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, RefreshCw, Clock,
} from 'lucide-react';
import {
  fetchAlerts, fetchAlertsByDate, fetchAlertHistory, markAlertRead,
  type AlertItem, type AlertResult, type AlertRecord,
} from '../../api/aiAlerts';
import { ApiError } from '../../api/client';

// ── Constants & helpers ────────────────────────────────────────────────────────

type Tab = 'active' | 'history';

function getToday() { return new Date().toISOString().slice(0, 10); }

const SEVERITY_ORDER: Record<AlertItem['severity'], number> = {
  critical: 0,
  warning:  1,
  info:     2,
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
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

// ── Severity styles ────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<
  AlertItem['severity'],
  { wrapper: string; text: string; icon: React.ReactNode }
> = {
  critical: {
    wrapper: 'border-l-4 border-red-500 bg-red-50',
    text:    'text-red-700',
    icon:    <AlertTriangle size={18} className="shrink-0 text-red-500" />,
  },
  warning: {
    wrapper: 'border-l-4 border-amber-500 bg-amber-50',
    text:    'text-amber-700',
    icon:    <AlertCircle size={18} className="shrink-0 text-amber-500" />,
  },
  info: {
    wrapper: 'border-l-4 border-blue-500 bg-blue-50',
    text:    'text-blue-600',
    icon:    <Info size={18} className="shrink-0 text-blue-500" />,
  },
};

// ── Active alert card ──────────────────────────────────────────────────────────

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
            <span>Value: <strong className="text-ink tabular-nums">{value.toLocaleString()}</strong></span>
            <span>Baseline: <strong className="text-ink tabular-nums">{baseline.toLocaleString()}</strong></span>
            <span>Change: <strong className={`tabular-nums ${pctColor}`}>{fmtPct(changePct)}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── History alert card ─────────────────────────────────────────────────────────

function HistoryAlertCard({
  alert,
  onMarkRead,
  isMarking,
  markError,
}: {
  alert:      AlertRecord;
  onMarkRead: () => void;
  isMarking:  boolean;
  markError?: string;
}) {
  const s = SEVERITY_STYLES[alert.severity];
  const pctColor = alert.changePct >= 0 ? 'text-green-600' : 'text-red-600';

  return (
    <div className={`rounded-xl p-4 ${s.wrapper} transition-opacity ${alert.isRead ? 'opacity-55' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{s.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-sm font-bold ${s.text}`}>{alert.title}</p>
              <p className="text-[11px] text-ink/40 mt-0.5">
                {fmtDateTime(alert.createdAt)} · {alert.dedupDate}
              </p>
            </div>
            {!alert.isRead ? (
              <button
                onClick={onMarkRead}
                disabled={isMarking}
                className="shrink-0 rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] font-semibold text-ink/60 hover:bg-mist disabled:opacity-40 transition-colors"
              >
                {isMarking ? 'Saving…' : 'Mark read'}
              </button>
            ) : (
              <span className="shrink-0 flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
                <CheckCircle2 size={10} />
                Read
              </span>
            )}
          </div>
          <p className={`text-xs mt-1 leading-snug ${s.text} opacity-80`}>{alert.message}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-ink/60">
            <span>Value: <strong className="text-ink tabular-nums">{alert.value.toLocaleString()}</strong></span>
            <span>Baseline: <strong className="text-ink tabular-nums">{alert.baseline.toLocaleString()}</strong></span>
            <span>Change: <strong className={`tabular-nums ${pctColor}`}>{fmtPct(alert.changePct)}</strong></span>
          </div>
          {markError && (
            <p className="mt-1.5 text-[11px] text-red-600">{markError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── History tab ────────────────────────────────────────────────────────────────

function HistoryTab() {
  const [alerts, setAlerts]       = useState<AlertRecord[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markErrors, setMarkErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { alerts: data } = await fetchAlertHistory();
      setAlerts(data);
    } catch {
      setError('Failed to load alert history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleMarkRead(id: string) {
    // Optimistic update — mark read immediately in UI
    setAlerts(prev =>
      prev.map(a => a._id === id ? { ...a, isRead: true, readAt: new Date().toISOString() } : a),
    );
    setMarkingId(id);
    setMarkErrors(prev => { const n = { ...prev }; delete n[id]; return n; });

    try {
      await markAlertRead(id);
    } catch {
      // Revert on failure
      setAlerts(prev =>
        prev.map(a => a._id === id ? { ...a, isRead: false, readAt: undefined } : a),
      );
      setMarkErrors(prev => ({ ...prev, [id]: 'Failed to mark as read. Please try again.' }));
    } finally {
      setMarkingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-canvas p-6 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-ink/70 max-w-sm">{error}</p>
        <button
          onClick={load}
          className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
        >
          Retry
        </button>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-canvas p-8 flex flex-col items-center gap-3 text-center">
        <Clock size={40} className="text-ink/20" />
        <p className="text-base font-bold text-ink">No History</p>
        <p className="text-sm text-ink/60">No alerts recorded in the last 7 days.</p>
      </div>
    );
  }

  const unread = alerts.filter(a => !a.isRead).length;

  return (
    <div className="space-y-4">
      {unread > 0 && (
        <p className="text-xs text-ink/50">{unread} unread alert{unread !== 1 ? 's' : ''}</p>
      )}
      <div className="space-y-3">
        {alerts.map(alert => (
          <HistoryAlertCard
            key={alert._id}
            alert={alert}
            onMarkRead={() => handleMarkRead(alert._id)}
            isMarking={markingId === alert._id}
            markError={markErrors[alert._id]}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function AlertsPage() {
  const [tab, setTab]               = useState<Tab>('active');
  const [selectedDate, setSelectedDate] = useState<string>(getToday());
  const [isToday, setIsToday]       = useState(true);
  const [result, setResult]         = useState<AlertResult | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
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
    if (tab === 'active') load(selectedDate, isToday);
  }, [tab, load, selectedDate, isToday]);

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
    ? [...result.alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    : [];

  const criticalCount = sorted.filter(a => a.severity === 'critical').length;
  const warningCount  = sorted.filter(a => a.severity === 'warning').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Title + subtitle */}
          <div>
            <h1 className="text-sm font-bold text-ink">Alerts</h1>
            {tab === 'active' && !loading && result && (
              <p className="text-[11px] text-ink/50">
                {criticalCount} critical · {warningCount} warnings
              </p>
            )}
            {tab === 'active' && loading && (
              <div className="animate-pulse rounded bg-border h-3 w-32 mt-1" />
            )}
            {tab === 'history' && (
              <p className="text-[11px] text-ink/50">Last 7 days</p>
            )}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Tab switcher */}
            <div className="flex rounded-lg border border-border bg-mist p-0.5 text-xs font-semibold">
              <button
                onClick={() => setTab('active')}
                className={`rounded-md px-3 py-1 transition-colors ${
                  tab === 'active'
                    ? 'bg-canvas text-ink shadow-sm'
                    : 'text-ink/50 hover:text-ink/70'
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setTab('history')}
                className={`rounded-md px-3 py-1 transition-colors ${
                  tab === 'history'
                    ? 'bg-canvas text-ink shadow-sm'
                    : 'text-ink/50 hover:text-ink/70'
                }`}
              >
                History
              </button>
            </div>

            {/* Date controls — Active tab only */}
            {tab === 'active' && (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {tab === 'history' ? (
          <HistoryTab />
        ) : (
          <>
            {/* Loading skeleton */}
            {loading && (
              <div className="space-y-3">
                <SkeletonCard /><SkeletonCard /><SkeletonCard />
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
          </>
        )}
      </div>
    </div>
  );
}
