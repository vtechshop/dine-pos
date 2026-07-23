// M6 — Global Order Monitoring
// Requires: GET /superadmin/aggregator/orders

import { useEffect, useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import {
  ApiRequired, SABadge, SAPageHeader, SASpin, SAError, fmtINR, fmtDateTime,
} from '../../components/ui/SAShared';
import { getGlobalOrders, type SAGlobalOrder, type AggPlatform } from '../../api/saAggregator';

const ORDERS_ENDPOINTS = [
  'GET /superadmin/aggregator/orders?date=&status=&platform=&hotelId=&page= — global order feed',
];

const today = () => new Date().toISOString().slice(0, 10);

type StatusFilter = 'all' | 'pending' | 'accepted' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

const STATUS_BADGE: Record<string, Parameters<typeof SABadge>[0]['variant']> = {
  pending:   'amber',
  accepted:  'blue',
  preparing: 'blue',
  ready:     'green',
  delivered: 'green',
  cancelled: 'red',
};

export function AggregatorOrdersPage() {
  const [orders,   setOrders]   = useState<SAGlobalOrder[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [date,     setDate]     = useState(today());
  const [platform, setPlatform] = useState<AggPlatform | 'all'>('all');
  const [status,   setStatus]   = useState<StatusFilter>('all');
  const [search,   setSearch]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getGlobalOrders({ date, platform: platform !== 'all' ? platform : undefined });
      setOrders(res.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [date, platform]);

  useEffect(() => { void load(); }, [load]);

  const visible = orders.filter(o => {
    const matchStatus   = status === 'all' || o.status === status;
    const matchSearch   = !search ||
      o.hotelName.toLowerCase().includes(search.toLowerCase()) ||
      o.orderNumber.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const totalRevenue   = visible.reduce((s, o) => s + o.grandTotal, 0);
  const totalCommission= visible.reduce((s, o) => s + (o.commission ?? 0), 0);
  const cancelledCount = visible.filter(o => o.status === 'cancelled').length;

  const exportCSV = () => {
    const rows = visible.map(o => [
      o.orderNumber, o.hotelName, o.platform, o.status,
      fmtINR(o.grandTotal), fmtINR(o.commission ?? 0), fmtDateTime(o.createdAt), o.city,
    ]);
    const csv = [
      ['Order#', 'Hotel', 'Platform', 'Status', 'Revenue', 'Commission', 'Created', 'City'],
      ...rows,
    ].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sa_orders_${date}.csv` });
    a.click();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Order Monitor"
        sub="Global order feed across all hotels and platforms"
        onRefresh={() => void load()}
        refreshing={loading}
        action={
          <button
            onClick={exportCSV}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-canvas text-ink/70 hover:bg-mist"
          >
            Export CSV
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        <ApiRequired endpoints={ORDERS_ENDPOINTS} />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date" value={date} max={today()}
            onChange={e => setDate(e.target.value)}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand/50"
          />
          <select
            value={platform} onChange={e => setPlatform(e.target.value as AggPlatform | 'all')}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none"
          >
            <option value="all">All Platforms</option>
            <option value="swiggy">Swiggy</option>
            <option value="zomato">Zomato</option>
          </select>
          <select
            value={status} onChange={e => setStatus(e.target.value as StatusFilter)}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none"
          >
            <option value="all">All Status</option>
            {['pending', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Hotel or order#…"
              className="rounded-lg border border-border bg-canvas pl-8 pr-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:border-brand/50"
            />
          </div>
        </div>

        {/* Summary chips */}
        {!loading && !error && (
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="rounded-full border border-border bg-canvas px-3 py-1 font-semibold text-ink/70">
              {visible.length} orders
            </span>
            <span className="rounded-full border border-brand/20 bg-brand/5 px-3 py-1 font-semibold text-brand">
              Revenue: {fmtINR(totalRevenue)}
            </span>
            <span className="rounded-full border border-border bg-canvas px-3 py-1 font-semibold text-ink/60">
              Commission: {fmtINR(totalCommission)}
            </span>
            {cancelledCount > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 font-semibold text-red-700">
                {cancelledCount} cancelled
              </span>
            )}
          </div>
        )}

        {loading ? <SASpin /> : error ? <SAError message={error} onRetry={() => void load()} /> : (
          <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-mist">
                  {['Order#', 'Hotel', 'City', 'Platform', 'Status', 'Total', 'Commission', 'Created'].map(c => (
                    <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink/40">
                      No orders — requires <code className="font-mono text-xs bg-mist px-1 rounded">GET /superadmin/aggregator/orders</code>
                    </td>
                  </tr>
                ) : visible.map(o => (
                  <tr key={o._id} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-ink/70">{o.orderNumber}</td>
                    <td className="px-4 py-3 font-semibold text-ink max-w-[150px] truncate">{o.hotelName}</td>
                    <td className="px-4 py-3 text-ink/60 text-xs">{o.city}</td>
                    <td className="px-4 py-3">
                      <SABadge label={o.platform} variant={o.platform === 'swiggy' ? 'amber' : 'red'} />
                    </td>
                    <td className="px-4 py-3">
                      <SABadge label={o.status} variant={STATUS_BADGE[o.status] ?? 'gray'} />
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-ink">{fmtINR(o.grandTotal)}</td>
                    <td className="px-4 py-3 font-mono text-ink/60">{fmtINR(o.commission ?? 0)}</td>
                    <td className="px-4 py-3 text-xs text-ink/50 whitespace-nowrap">{fmtDateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
