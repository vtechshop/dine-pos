import { useEffect, useState, useCallback } from 'react';
import { useSettings } from '../../context/SettingsContext';
import {
  LayoutDashboard, Wifi, WifiOff, ShoppingBag, TrendingUp,
  AlertCircle, CheckCircle2, Clock, Truck, Building2,
} from 'lucide-react';
import {
  SAStat, SAPageHeader, SABadge, SASpin, SAError, fmtINR,
} from '../../components/ui/SAShared';
import { getAggDashboard, type AggDashboard } from '../../api/saAggregator';

type Health = 'up' | 'down' | 'degraded';

const HEALTH_LABEL: Record<Health, string> = {
  up:       'Working',
  degraded: 'Some problems',
  down:     'Not connected',  // no hotel connected to this platform yet
};

export function AggregatorDashboardPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const [dashboard, setDashboard] = useState<AggDashboard | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [refreshing,setRefreshing]= useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      setDashboard(await getAggDashboard());
    } catch {
      setError("Couldn't load the delivery summary. Please try again.");
    } finally {
      if (refresh) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const header = (
    <SAPageHeader
      title="Delivery Dashboard"
      sub="Swiggy & Zomato overview across all hotels"
      onRefresh={() => void load(true)}
      refreshing={refreshing || loading}
      action={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
          <LayoutDashboard size={12} /> Overview
        </span>
      }
    />
  );

  if (loading) return (
    <div className="h-full flex flex-col">
      {header}
      <SASpin />
    </div>
  );

  if (error || !dashboard) return (
    <div className="h-full flex flex-col">
      {header}
      <SAError message={error || "Couldn't load the delivery summary. Please try again."} onRetry={() => void load()} />
    </div>
  );

  const d = dashboard;
  const coverage = d.totalHotels
    ? Math.round(((d.swiggyConnected + d.zomatoConnected - d.bothConnected) / d.totalHotels) * 100)
    : 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {header}
      <div className="flex-1 overflow-y-auto space-y-6 px-8 py-6">
        {/* Hotels */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Hotels</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SAStat label="Total Hotels"     value={d.totalHotels} icon={<Building2 size={18} />} />
            <SAStat label="On Swiggy"        value={d.swiggyConnected} sub={`of ${d.totalHotels} hotels`} icon={<Wifi size={18} />} />
            <SAStat label="On Zomato"        value={d.zomatoConnected} sub={`of ${d.totalHotels} hotels`} icon={<Wifi size={18} />} />
            <SAStat label="On Both"          value={d.bothConnected} accent icon={<CheckCircle2 size={18} />} />
            <SAStat label="Not Connected"    value={d.disconnected} icon={<WifiOff size={18} />} />
            <SAStat label="Waiting for Check" value={d.pendingVerification} warn={d.pendingVerification > 0} />
            <SAStat label="Connection Errors" value={d.failedIntegrations} warn={d.failedIntegrations > 0} icon={<AlertCircle size={18} />} />
            <SAStat label="Coverage"         value={`${coverage}%`} sub="Hotels on Swiggy or Zomato" />
          </div>
        </section>

        {/* Today */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Today</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SAStat label="Orders"         value={d.todayOrders} icon={<ShoppingBag size={18} />} />
            <SAStat label="Sales"          value={fmtINR(d.todayRevenue, sym)} accent icon={<TrendingUp size={18} />} />
            <SAStat label="Commission"     value={fmtINR(d.todayCommission, sym)} />
            <SAStat label="Refunds"        value={fmtINR(d.todayRefunds, sym)} warn={d.todayRefunds > 0} />
            <SAStat label="Cancelled"      value={d.todayCancelled} warn={d.todayCancelled > 5} icon={<AlertCircle size={18} />} />
            <SAStat label="Accepted"       value={`${d.avgAcceptancePct}%`} sub="Average across hotels" accent />
            <SAStat label="Avg Prep Time"  value={`${d.avgPrepMins} min`} icon={<Clock size={18} />} />
          </div>
          {d.todayOrders === 0 && (
            <p className="mt-3 text-xs text-ink/40">No Swiggy or Zomato orders yet today.</p>
          )}
        </section>

        {/* Platform health */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Connection Health</p>
          <div className="grid grid-cols-3 gap-4">
            {([
              { label: 'Swiggy',         status: d.platformHealth.swiggyApi },
              { label: 'Zomato',         status: d.platformHealth.zomatoApi },
              { label: 'Order Receiver', status: d.platformHealth.webhookServer },
            ] as { label: string; status: Health }[]).map(p => (
              <div key={p.label} className={`rounded-xl border p-4 flex items-center gap-3 ${
                p.status === 'up'       ? 'border-green-200 bg-green-50' :
                p.status === 'down'     ? 'border-border bg-mist' :
                                          'border-amber-200 bg-amber-50'
              }`}>
                {p.status === 'up'
                  ? <CheckCircle2 size={20} className="text-green-600 shrink-0" />
                  : <AlertCircle  size={20} className={`${p.status === 'down' ? 'text-ink/35' : 'text-amber-600'} shrink-0`} />}
                <div>
                  <p className="text-sm font-bold text-ink">{p.label}</p>
                  <SABadge
                    label={HEALTH_LABEL[p.status] ?? p.status}
                    variant={p.status === 'up' ? 'green' : p.status === 'down' ? 'gray' : 'amber'}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick links */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Quick Links</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { to: '/super-admin/aggregator/hotels',     label: 'Hotels',     icon: <Wifi size={18} /> },
              { to: '/super-admin/aggregator/orders',     label: 'Orders',     icon: <ShoppingBag size={18} /> },
              { to: '/super-admin/aggregator/webhooks',   label: 'Webhooks',   icon: <Truck size={18} /> },
              { to: '/super-admin/aggregator/settlement', label: 'Settlement', icon: <TrendingUp size={18} /> },
            ].map(l => (
              <a key={l.to} href={l.to} className="flex items-center gap-2 rounded-xl border border-border bg-canvas p-4 hover:bg-mist transition-colors">
                <span className="text-brand/60">{l.icon}</span>
                <span className="text-sm font-semibold text-ink">{l.label}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
