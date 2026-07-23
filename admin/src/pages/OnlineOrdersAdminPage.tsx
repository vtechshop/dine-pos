import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ShoppingBag, TrendingUp, Clock, XCircle, CheckCircle2 } from 'lucide-react';
import {
  SectionHeader, PageLoader, ErrorState, EmptyState, Badge, Btn, StatCard,
} from '../components/ui';
import { fetchOnlineOrders } from '../api/aggregator';
import type { OnlineOrder, AggregatorPlatform } from '../api/aggregator';

type PlatformFilter = 'all' | AggregatorPlatform;
type StatusFilter   = 'all' | OnlineOrder['status'];

const today = () => new Date().toISOString().slice(0, 10);

const PLATFORM_COLOR: Record<string, string> = { swiggy: '#FC8019', zomato: '#E23744' };
const PLATFORM_EMOJI: Record<string, string> = { swiggy: '🛵', zomato: '🍕' };

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: 'green' | 'amber' | 'blue' | 'red' | 'gray' }> = {
    pending:    { label: 'Pending',    variant: 'amber' },
    preparing:  { label: 'Preparing', variant: 'blue'  },
    ready:      { label: 'Ready',     variant: 'green' },
    served:     { label: 'Served',    variant: 'green' },
    completed:  { label: 'Done',      variant: 'green' },
    cancelled:  { label: 'Cancelled', variant: 'red'   },
  };
  const s = map[status] ?? { label: status, variant: 'gray' as const };
  return <Badge label={s.label} variant={s.variant} />;
}

function fmtINR(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function avgPrepMins(orders: OnlineOrder[]): number {
  const done = orders.filter(o => o.acceptedAt && (o.status === 'completed' || o.status === 'served' || o.status === 'ready'));
  if (!done.length) return 0;
  const total = done.reduce((s, o) => {
    const created  = new Date(o.createdAt).getTime();
    const accepted = new Date(o.acceptedAt!).getTime();
    return s + (accepted - created) / 60_000;
  }, 0);
  return Math.round(total / done.length);
}

export default function OnlineOrdersAdminPage() {
  const [orders,   setOrders]   = useState<OnlineOrder[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [status,   setStatus]   = useState<StatusFilter>('all');
  const [date,     setDate]     = useState(today());

  const load = useCallback(() => {
    setLoading(true);
    const params: Parameters<typeof fetchOnlineOrders>[0] = { date, limit: 500 };
    if (platform !== 'all') params.platform = platform;
    if (status   !== 'all') params.status   = status;
    fetchOnlineOrders(params)
      .then(res => { setOrders(res.orders ?? []); setLoading(false); })
      .catch(() => { setError('Failed to load online orders'); setLoading(false); });
  }, [date, platform, status]);

  useEffect(() => { load(); }, [load]);

  // Derived stats
  const total       = orders.length;
  const swiggy      = orders.filter(o => o.orderSource === 'swiggy').length;
  const zomato      = orders.filter(o => o.orderSource === 'zomato').length;
  const pending     = orders.filter(o => o.status === 'pending').length;
  const preparing   = orders.filter(o => o.status === 'preparing').length;
  const ready       = orders.filter(o => o.status === 'ready' || o.status === 'served').length;
  const completed   = orders.filter(o => o.status === 'completed').length;
  const cancelled   = orders.filter(o => o.status === 'cancelled').length;
  const revenue     = orders.filter(o => !['cancelled'].includes(o.status)).reduce((s, o) => s + o.grandTotal, 0);
  const commission  = orders.filter(o => !['cancelled'].includes(o.status)).reduce((s, o) => s + (o.platformCommission ?? 0), 0);
  const accepted    = orders.filter(o => o.acceptedAt);
  const acceptRate  = total ? Math.round((accepted.length / total) * 100) : 0;
  const cancelRate  = total ? Math.round((cancelled / total) * 100) : 0;
  const avgPrep     = avgPrepMins(orders);
  const delayed     = orders.filter(o => {
    if (o.status !== 'pending' && o.status !== 'preparing') return false;
    return (Date.now() - new Date(o.createdAt).getTime()) > 30 * 60_000;
  }).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Online Order Admin"
        sub="Aggregator order dashboard across Swiggy and Zomato"
        action={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              max={today()}
              onChange={e => setDate(e.target.value)}
              className="rounded-lg border border-[#E8D5C0] px-3 py-1.5 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]"
            />
            <Btn size="sm" onClick={load}><RefreshCw size={14} /></Btn>
          </div>
        }
      />

      {/* Platform + status filter */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1 p-1 bg-white rounded-lg border border-[#E8D5C0]">
          {(['all', 'swiggy', 'zomato'] as PlatformFilter[]).map(p => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${platform === p ? 'bg-[#E8380D] text-white' : 'text-[#92745E] hover:text-[#1C0800]'}`}
            >
              {p === 'all' ? 'All' : `${PLATFORM_EMOJI[p]} ${p.toUpperCase()}`}
            </button>
          ))}
        </div>
        <div className="flex gap-1 p-1 bg-white rounded-lg border border-[#E8D5C0]">
          {(['all', 'pending', 'preparing', 'ready', 'completed', 'cancelled'] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${status === s ? 'bg-[#E8380D] text-white' : 'text-[#92745E] hover:text-[#1C0800]'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard label="Total Orders"   value={total}                         icon={<ShoppingBag size={16} />} />
        <StatCard label="Swiggy"         value={swiggy}                        icon={<span>🛵</span>} />
        <StatCard label="Zomato"         value={zomato}                        icon={<span>🍕</span>} />
        <StatCard label="Revenue"        value={fmtINR(revenue)}               icon={<TrendingUp size={16} />} accent />
        <StatCard label="Commission"     value={fmtINR(commission)}            sub={`Net: ${fmtINR(revenue - commission)}`} />
        <StatCard label="Pending"        value={pending}                       sub={delayed > 0 ? `${delayed} delayed` : undefined} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Accepted"        value={accepted.length} sub={`${acceptRate}% acceptance`} icon={<CheckCircle2 size={16} />} />
        <StatCard label="Cancelled"       value={cancelled}       sub={`${cancelRate}% cancellation`} icon={<XCircle size={16} />} />
        <StatCard label="Avg Prep Time"   value={`${avgPrep}m`}                icon={<Clock size={16} />} />
        <StatCard label="Completed Today" value={completed} />
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: 'Pending',    count: pending,   color: '#F59E0B' },
          { label: 'Preparing',  count: preparing, color: '#3B82F6' },
          { label: 'Ready',      count: ready,     color: '#10B981' },
          { label: 'Completed',  count: completed, color: '#6B7280' },
          { label: 'Cancelled',  count: cancelled, color: '#EF4444' },
          { label: 'Delayed',    count: delayed,   color: '#DC2626' },
        ].map(({ label, count, color }) => (
          <div key={label} className="bg-white rounded-xl border border-[#E8D5C0] p-3 text-center">
            <p className="text-2xl font-black" style={{ color }}>{count}</p>
            <p className="text-xs text-[#92745E] font-semibold mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Order table */}
      {loading ? <PageLoader /> : error ? <ErrorState message={error} onRetry={load} /> : orders.length === 0 ? (
        <EmptyState icon={<ShoppingBag className="h-10 w-10" />} title="No orders" sub="No delivery orders match the selected filters." />
      ) : (
        <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
                {['#', 'Platform', 'Customer', 'Items', 'Total', 'Commission', 'Net', 'Status', 'Time'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const net = o.grandTotal - (o.platformCommission ?? 0);
                return (
                  <tr key={o._id} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                    <td className="px-4 py-3 font-mono text-xs text-[#92745E]">{o.orderNumber}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-xs" style={{ color: PLATFORM_COLOR[o.orderSource] }}>
                        {PLATFORM_EMOJI[o.orderSource]} {o.orderSource.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#1C0800]">{o.customerName}</p>
                      {o.customerPhone && <p className="text-xs text-[#92745E]">{o.customerPhone}</p>}
                    </td>
                    <td className="px-4 py-3 text-[#92745E]">{o.items.length}</td>
                    <td className="px-4 py-3 font-bold text-[#1C0800]">{fmtINR(o.grandTotal)}</td>
                    <td className="px-4 py-3 text-red-600 text-xs">{o.platformCommission ? fmtINR(o.platformCommission) : '—'}</td>
                    <td className="px-4 py-3 font-bold text-green-700">{fmtINR(net)}</td>
                    <td className="px-4 py-3">{statusBadge(o.status)}</td>
                    <td className="px-4 py-3 text-[#92745E] text-xs whitespace-nowrap">{fmtTime(o.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
