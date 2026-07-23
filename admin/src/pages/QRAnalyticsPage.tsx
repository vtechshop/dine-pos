import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, QrCode, TrendingUp, Activity, Users, ShoppingBag } from 'lucide-react';
import {
  SectionHeader, StatCard, ApiRequired, Btn, PageLoader,
} from '../components/ui';
import { fetchOnlineOrders } from '../api/aggregator';
import type { OnlineOrder } from '../api/aggregator';

// QR Analytics
// True QR analytics (scan count, conversion rate, repeat customers by QR)
// require the /qr/analytics backend which is NOT yet implemented.
// We surface the online order data from /aggregator/orders as a proxy
// for delivery-side analytics.

const QR_ANALYTICS_ENDPOINTS = [
  'GET /qr/analytics/summary        — today totals: scans, unique visitors, orders, revenue',
  'GET /qr/analytics/tables         — per-table scan count, order count, revenue',
  'GET /qr/analytics/conversion     — scan → order conversion rate',
  'GET /qr/analytics/repeat         — repeat customer rate via QR',
  'GET /qr/analytics/hourly?date=   — hourly scan distribution',
];

const today = () => new Date().toISOString().slice(0, 10);

function fmtINR(n: number) { return `₹${Math.round(n).toLocaleString('en-IN')}`; }

export default function QRAnalyticsPage() {
  const [orders,  setOrders]  = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [date,    setDate]    = useState(today());

  const load = useCallback(() => {
    setLoading(true);
    fetchOnlineOrders({ date, limit: 500 })
      .then(res => { setOrders(res.orders ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const totalRevenue = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.grandTotal, 0);
  const avgOrderValue = orders.length ? totalRevenue / orders.length : 0;

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="QR Analytics"
        sub="Scan metrics, conversion and QR order performance"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)}
              className="rounded-lg border border-[#E8D5C0] px-3 py-1.5 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
            <Btn size="sm" onClick={load}><RefreshCw size={14} /></Btn>
          </div>
        }
      />

      <ApiRequired endpoints={QR_ANALYTICS_ENDPOINTS} />

      {/* Live proxy stats from aggregator orders */}
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
        Metrics below are derived from <span className="font-mono">GET /aggregator/orders</span> as a proxy.
        True QR scan analytics require the <span className="font-mono">/qr/analytics</span> backend.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Today's QR Orders*" value="—" sub="Requires /qr/analytics" icon={<QrCode size={16} />} />
        <StatCard label="Revenue (online)" value={fmtINR(totalRevenue)} accent icon={<TrendingUp size={16} />} />
        <StatCard label="Avg Order Value"  value={fmtINR(avgOrderValue)} icon={<ShoppingBag size={16} />} />
        <StatCard label="Repeat Customers*" value="—" sub="Requires /qr/analytics" icon={<Users size={16} />} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Scan Count*"       value="—" sub="Requires /qr/analytics/summary" />
        <StatCard label="Conversion Rate*"  value="—" sub="Scans → Orders" />
        <StatCard label="Popular Table*"    value="—" sub="Requires /qr/analytics/tables" />
        <StatCard label="Active QR Codes*"  value="—" sub="Requires GET /qr" />
      </div>

      {/* Analytics charts — placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-[#E8D5C0] p-4">
          <p className="font-bold text-[#1C0800] mb-3 flex items-center gap-2">
            <Activity size={16} className="text-[#E8380D]" /> Hourly Scan Distribution
          </p>
          <div className="h-32 bg-[#FFF6EE] rounded-lg flex items-center justify-center">
            <p className="text-xs text-amber-600 font-mono text-center">
              Requires<br/>GET /qr/analytics/hourly?date=
            </p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#E8D5C0] p-4">
          <p className="font-bold text-[#1C0800] mb-3 flex items-center gap-2">
            <QrCode size={16} className="text-[#E8380D]" /> Top QR Tables by Revenue
          </p>
          <div className="h-32 bg-[#FFF6EE] rounded-lg flex items-center justify-center">
            <p className="text-xs text-amber-600 font-mono text-center">
              Requires<br/>GET /qr/analytics/tables
            </p>
          </div>
        </div>
      </div>

      {/* Online orders as proxy */}
      {orders.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8D5C0] bg-[#FFF6EE]">
            <p className="font-bold text-sm text-[#1C0800]">Aggregator Orders — {date}</p>
            <p className="text-xs text-[#92745E]">{orders.length} orders · proxy for delivery analytics</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8D5C0]">
                {['Order #', 'Platform', 'Customer', 'Total', 'Status'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 20).map(o => (
                <tr key={o._id} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                  <td className="px-4 py-3 font-mono text-xs text-[#92745E]">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: o.orderSource === 'swiggy' ? '#FC8019' : '#E23744' }}>
                    {o.orderSource.toUpperCase()}
                  </td>
                  <td className="px-4 py-3 text-[#1C0800]">{o.customerName}</td>
                  <td className="px-4 py-3 font-bold text-[#1C0800]">{fmtINR(o.grandTotal)}</td>
                  <td className="px-4 py-3 text-xs capitalize text-[#92745E]">{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length > 20 && (
            <p className="text-xs text-[#92745E] px-4 py-2 border-t border-[#E8D5C0]">Showing 20 of {orders.length}</p>
          )}
        </div>
      )}
    </div>
  );
}
