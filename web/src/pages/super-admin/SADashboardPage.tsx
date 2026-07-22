import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { getDashboard, type DashboardData } from '../../api/superAdmin';
import { Spinner } from '../../components/ui/Spinner';

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysLeft(endDate: string | null): { label: string; urgent: boolean } {
  if (!endDate) return { label: '', urgent: false };
  const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
  if (diff < 0)  return { label: 'Expired', urgent: true };
  if (diff === 0) return { label: 'Today',  urgent: true };
  return { label: `${diff}d left`, urgent: diff <= 3 };
}

function getExpiringTrials(renewals: DashboardData['pendingRenewals']): DashboardData['pendingRenewals'] {
  return renewals.filter(h => {
    if (h.status !== 'trial' || !h.trialEndDate) return false;
    const diff = Math.ceil((new Date(h.trialEndDate).getTime() - Date.now()) / 86_400_000);
    return diff >= 0 && diff <= 7;
  });
}

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  trial:     'bg-blue-50 text-blue-700 border-blue-200',
  active:    'bg-green-50 text-green-700 border-green-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  rejected:  'bg-gray-100 text-gray-600 border-gray-200',
  expired:   'bg-gray-100 text-gray-500 border-gray-200',
};

export function SADashboardPage() {
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      </div>
    );
  }

  const s = data!.hotelStats;

  const expiringTrials = getExpiringTrials(data!.pendingRenewals);

  const statCards = [
    { label: 'Total Hotels', value: s.total,     border: 'border-brand/25',   bg: 'bg-brand/5',   text: 'text-brand',     to: '/super-admin/hotels' },
    { label: 'Pending',      value: s.pending,   border: 'border-amber-200',  bg: 'bg-amber-50',  text: 'text-amber-700', to: '/super-admin/hotels?status=pending' },
    { label: 'On Trial',     value: s.trial,     border: 'border-blue-200',   bg: 'bg-blue-50',   text: 'text-blue-700',  to: '/super-admin/hotels?status=trial' },
    { label: 'Active',       value: s.active,    border: 'border-green-200',  bg: 'bg-green-50',  text: 'text-green-700', to: '/super-admin/hotels?status=active' },
    { label: 'Suspended',    value: s.suspended, border: 'border-red-200',    bg: 'bg-red-50',    text: 'text-red-700',   to: '/super-admin/hotels?status=suspended' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {statCards.map(({ label, value, border, bg, text, to }) => (
          <Link key={label} to={to} className={`rounded-xl border ${border} ${bg} p-4 transition hover:opacity-80`}>
            <p className="text-xs font-medium text-ink/50">{label}</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${text}`}>{value}</p>
          </Link>
        ))}
      </div>

      {/* Revenue summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-canvas p-4">
          <p className="text-xs font-medium text-ink/50">Today's Revenue</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            ₹{data!.todayRevenue.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-canvas p-4">
          <p className="text-xs font-medium text-ink/50">Monthly Revenue</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
            ₹{data!.monthlyRevenue.toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* Secondary counts + churn alert */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink/50">
        <span>Expired: <strong className="text-ink">{s.expired}</strong></span>
        <span>Rejected: <strong className="text-ink">{s.rejected}</strong></span>
        {data!.churnRisk > 0 && (
          <span className="flex items-center gap-1 font-medium text-amber-600">
            <AlertTriangle size={13} />
            {data!.churnRisk} trial{data!.churnRisk !== 1 ? 's' : ''} expiring this week
          </span>
        )}
      </div>

      {/* Suspended hotels alert */}
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

      {/* Two-column section */}
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

      {/* Expiring Trials */}
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
