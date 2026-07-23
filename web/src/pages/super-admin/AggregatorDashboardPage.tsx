import { useEffect, useState, useCallback } from 'react';
import {
  LayoutDashboard, Wifi, WifiOff, ShoppingBag, TrendingUp,
  AlertCircle, CheckCircle2, Clock, Truck,
} from 'lucide-react';
import {
  ApiRequired, SAStat, SAPageHeader, SABadge, SASpin, SAError,
} from '../../components/ui/SAShared';
import { getHotels, type Hotel } from '../../api/superAdmin';
import {
  getAggDashboard, type AggDashboard, SA_AGG_REQUIRED_ENDPOINTS,
} from '../../api/saAggregator';

const DASHBOARD_ENDPOINTS = SA_AGG_REQUIRED_ENDPOINTS.slice(0, 1);

export function AggregatorDashboardPage() {
  const [hotels,    setHotels]    = useState<Hotel[]>([]);
  const [dashboard, setDashboard] = useState<AggDashboard | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [refreshing,setRefreshing]= useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    const [hotelsResult, dashResult] = await Promise.allSettled([
      getHotels({ page: 1 }),
      getAggDashboard(),
    ]);
    if (hotelsResult.status === 'fulfilled') setHotels(hotelsResult.value.hotels);
    if (dashResult.status   === 'fulfilled') setDashboard(dashResult.value);
    if (refresh) setRefreshing(false); else setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Derived from live hotel list
  const totalHotels       = hotels.length;
  const aggregatorEnabled = hotels.filter(h => h.features.aggregator).length;
  const aggregatorDisabled= hotels.filter(h => !h.features.aggregator).length;

  if (loading) return (
    <div className="h-full flex flex-col">
      <SAPageHeader title="Delivery Dashboard" sub="Swiggy & Zomato overview across all hotels" />
      <SASpin />
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Delivery Dashboard"
        sub="Swiggy & Zomato aggregator overview across all hotels"
        onRefresh={() => void load(true)}
        refreshing={refreshing}
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            <LayoutDashboard size={12} /> M1 — Global Overview
          </span>
        }
      />
      <div className="flex-1 overflow-y-auto space-y-6 px-8 py-6">
        {error && <SAError message={error} onRetry={() => void load()} />}

        {/* Live stats from hotel list */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Live — Hotel Feature Status</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SAStat label="Total Hotels" value={totalHotels} icon={<ShoppingBag size={18} />} />
            <SAStat label="Aggregator Enabled" value={aggregatorEnabled} accent icon={<CheckCircle2 size={18} />} />
            <SAStat label="Aggregator Disabled" value={aggregatorDisabled} icon={<WifiOff size={18} />} />
            <SAStat label="Coverage" value={`${totalHotels ? Math.round(aggregatorEnabled / totalHotels * 100) : 0}%`}
              sub="Hotels with aggregator on" icon={<Wifi size={18} />} />
          </div>
        </section>

        {/* Cross-hotel KPIs — requires SA backend */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">
            Cross-hotel KPIs — requires backend
          </p>
          <ApiRequired endpoints={DASHBOARD_ENDPOINTS} />

          {dashboard ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <SAStat label="Today Orders"    value={dashboard.todayOrders}    icon={<Clock size={18} />} />
              <SAStat label="Today Revenue"   value={`₹${dashboard.todayRevenue.toLocaleString('en-IN')}`} accent icon={<TrendingUp size={18} />} />
              <SAStat label="Commission"      value={`₹${dashboard.todayCommission.toLocaleString('en-IN')}`} />
              <SAStat label="Cancellations"   value={dashboard.todayCancelled} warn={dashboard.todayCancelled > 5} icon={<AlertCircle size={18} />} />
              <SAStat label="Swiggy Connected" value={dashboard.swiggyConnected} sub={`of ${totalHotels} hotels`} />
              <SAStat label="Zomato Connected" value={dashboard.zomatoConnected} sub={`of ${totalHotels} hotels`} />
              <SAStat label="Both Platforms"   value={dashboard.bothConnected} accent />
              <SAStat label="Failed Integrations" value={dashboard.failedIntegrations} warn={dashboard.failedIntegrations > 0} />
              <SAStat label="Avg Acceptance" value={`${dashboard.avgAcceptancePct}%`} accent />
              <SAStat label="Avg Prep Time"  value={`${dashboard.avgPrepMins}m`} sub="minutes" icon={<Clock size={18} />} />
              <SAStat label="Refunds Today"  value={`₹${dashboard.todayRefunds.toLocaleString('en-IN')}`} warn={dashboard.todayRefunds > 0} />
              <SAStat label="Pending Verify" value={dashboard.pendingVerification} warn={dashboard.pendingVerification > 0} />
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              {['Today Orders', 'Today Revenue', 'Commission', 'Cancellations',
                'Swiggy Connected', 'Zomato Connected', 'Both Platforms', 'Failed Integrations',
                'Avg Acceptance', 'Avg Prep Time', 'Refunds Today', 'Pending Verify'].map(l => (
                <div key={l} className="rounded-xl border border-border bg-canvas p-4">
                  <div className="h-6 w-12 rounded bg-ink/5 mb-2" />
                  <p className="text-xs font-semibold text-ink/40">{l}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Platform health */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Platform Health</p>
          {dashboard ? (
            <div className="grid grid-cols-3 gap-4">
              {([
                { label: 'Swiggy API',     status: dashboard.platformHealth.swiggyApi },
                { label: 'Zomato API',     status: dashboard.platformHealth.zomatoApi },
                { label: 'Webhook Server', status: dashboard.platformHealth.webhookServer },
              ] as { label: string; status: 'up' | 'down' | 'degraded' }[]).map(p => (
                <div key={p.label} className={`rounded-xl border p-4 flex items-center gap-3 ${
                  p.status === 'up'       ? 'border-green-200 bg-green-50' :
                  p.status === 'down'     ? 'border-red-200 bg-red-50' :
                                            'border-amber-200 bg-amber-50'
                }`}>
                  {p.status === 'up'     && <CheckCircle2 size={20} className="text-green-600 shrink-0" />}
                  {p.status === 'down'   && <AlertCircle  size={20} className="text-red-600 shrink-0" />}
                  {p.status === 'degraded'&&<AlertCircle  size={20} className="text-amber-600 shrink-0" />}
                  <div>
                    <p className="text-sm font-bold text-ink">{p.label}</p>
                    <SABadge
                      label={p.status}
                      variant={p.status === 'up' ? 'green' : p.status === 'down' ? 'red' : 'amber'}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {['Swiggy API', 'Zomato API', 'Webhook Server'].map(l => (
                <div key={l} className="rounded-xl border border-border bg-canvas p-4 flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full bg-ink/5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-ink/60">{l}</p>
                    <p className="text-xs text-ink/30">Requires API</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Quick links */}
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40 mb-3">Quick Links</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { to: '/super-admin/aggregator/hotels',     label: 'Hotel Integrations', icon: <Wifi size={18} /> },
              { to: '/super-admin/aggregator/orders',     label: 'Order Monitor',      icon: <ShoppingBag size={18} /> },
              { to: '/super-admin/aggregator/webhooks',   label: 'Webhooks',           icon: <Truck size={18} /> },
              { to: '/super-admin/aggregator/settlement', label: 'Settlement',         icon: <TrendingUp size={18} /> },
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
