import { useEffect, useState, useCallback } from 'react';
import { Wallet, Download, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import {
  SectionHeader, PageLoader, StatCard, Btn, ApiRequired,
} from '../components/ui';
import { fetchOnlineOrders } from '../api/aggregator';
import type { OnlineOrder } from '../api/aggregator';

// Settlement Page
// Daily settlement figures for Swiggy/Zomato are computed client-side from
// the existing /aggregator/orders endpoint.
// A dedicated settlement API is NOT yet implemented.

const SETTLEMENT_ENDPOINTS = [
  'GET /aggregator/reports/settlement?from=&to=&platform=  — official settlement figures with GST breakdown',
  'GET /aggregator/reports/pending-settlement              — pending payout amounts',
  'GET /aggregator/reports/settlement/:id/download-pdf     — PDF settlement report',
];

const today = () => new Date().toISOString().slice(0, 10);

function fmtINR(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

interface PlatformSummary {
  platform:          string;
  orders:            number;
  grossRevenue:      number;
  commission:        number;
  deliveryCharges:   number;
  packingCharges:    number;
  refunds:           number;
  netSettlement:     number;
  gst:               number;
}

function summarise(orders: OnlineOrder[], platform: string): PlatformSummary {
  const filtered = orders.filter(
    o => (platform === 'all' || o.orderSource === platform) && o.status !== 'cancelled',
  );
  const gross      = filtered.reduce((s, o) => s + o.grandTotal, 0);
  const commission = filtered.reduce((s, o) => s + (o.platformCommission ?? 0), 0);
  const delivery   = filtered.reduce((s, o) => s + o.deliveryFee, 0);
  const refunds    = orders.filter(o => (platform === 'all' || o.orderSource === platform) && o.status === 'cancelled')
    .reduce((s, o) => s + o.grandTotal, 0);
  const net = gross - commission - refunds;
  return {
    platform,
    orders:          filtered.length,
    grossRevenue:    gross,
    commission,
    deliveryCharges: delivery,
    packingCharges:  0,
    refunds,
    netSettlement:   net,
    gst:             gross * 0.05,
  };
}

export default function SettlementPage() {
  const [orders,  setOrders]  = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [from,    setFrom]    = useState(today());
  const [to,      setTo]      = useState(today());

  const load = useCallback(() => {
    setLoading(true);
    fetchOnlineOrders({ date: from, limit: 500 })
      .then(res => { setOrders(res.orders ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [from]);

  useEffect(() => { load(); }, [load]);

  const swiggy = summarise(orders, 'swiggy');
  const zomato = summarise(orders, 'zomato');
  const total  = summarise(orders, 'all');

  const downloadCSV = () => {
    const rows = [swiggy, zomato].map(s => [
      s.platform, s.orders, s.grossRevenue, s.commission, s.deliveryCharges,
      s.packingCharges, s.refunds, s.gst.toFixed(2), s.netSettlement,
    ]);
    const csv  = [
      ['Platform', 'Orders', 'Gross Revenue', 'Commission', 'Delivery Charges', 'Packing Charges', 'Refunds', 'GST (5%)', 'Net Settlement'],
      ...rows,
    ].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `settlement_${from}.csv`;
    a.click();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Settlement"
        sub="Daily aggregator payouts — Swiggy and Zomato"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={today()} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-[#E8D5C0] px-3 py-1.5 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
            <input type="date" value={to}   max={today()} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-[#E8D5C0] px-3 py-1.5 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
            <Btn size="sm" onClick={load}><RefreshCw size={14} /></Btn>
            <Btn size="sm" onClick={downloadCSV}><Download size={14} /> CSV</Btn>
            <Btn size="sm" disabled title={SETTLEMENT_ENDPOINTS[1]}><Download size={14} /> PDF</Btn>
          </div>
        }
      />

      <ApiRequired endpoints={SETTLEMENT_ENDPOINTS} />

      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
        Figures below are computed from live order data (<span className="font-mono">GET /aggregator/orders</span>).
        Official settlement figures (including GST adjustments, pending payouts, and charge breakdowns)
        require the dedicated settlement API endpoints listed above.
      </p>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Gross Revenue" value={fmtINR(total.grossRevenue)} accent icon={<TrendingUp size={16} />} />
        <StatCard label="Commission" value={fmtINR(total.commission)} sub="Aggregator fees" icon={<TrendingDown size={16} />} />
        <StatCard label="Refunds" value={fmtINR(total.refunds)} />
        <StatCard label="Net Settlement" value={fmtINR(total.netSettlement)} sub="Est. gross − commission − refunds" />
      </div>

      {/* Per-platform breakdown */}
      {[swiggy, zomato].map(s => {
        const color = s.platform === 'swiggy' ? '#FC8019' : '#E23744';
        const emoji = s.platform === 'swiggy' ? '🛵' : '🍕';
        return (
          <div key={s.platform} className="bg-white rounded-xl border border-[#E8D5C0] p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: color + '18' }}>
                {emoji}
              </div>
              <div>
                <p className="font-black text-lg text-[#1C0800]">{s.platform.toUpperCase()}</p>
                <p className="text-xs text-[#92745E]">{s.orders} completed orders</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[#F5E8DB]">
                  <tr className="hover:bg-[#FFF6EE]">
                    <td className="py-2 text-[#92745E]">Gross Revenue</td>
                    <td className="py-2 text-right font-bold text-[#1C0800]">{fmtINR(s.grossRevenue)}</td>
                  </tr>
                  <tr className="hover:bg-[#FFF6EE]">
                    <td className="py-2 text-[#92745E]">Commission ({s.platform})</td>
                    <td className="py-2 text-right font-bold text-red-600">−{fmtINR(s.commission)}</td>
                  </tr>
                  <tr className="hover:bg-[#FFF6EE]">
                    <td className="py-2 text-[#92745E]">Delivery Charges</td>
                    <td className="py-2 text-right text-[#92745E]">{fmtINR(s.deliveryCharges)}</td>
                  </tr>
                  <tr className="hover:bg-[#FFF6EE]">
                    <td className="py-2 text-[#92745E]">Packing Charges</td>
                    <td className="py-2 text-right text-amber-600 text-xs">Requires API</td>
                  </tr>
                  <tr className="hover:bg-[#FFF6EE]">
                    <td className="py-2 text-[#92745E]">Refunds</td>
                    <td className="py-2 text-right font-bold text-red-600">−{fmtINR(s.refunds)}</td>
                  </tr>
                  <tr className="hover:bg-[#FFF6EE]">
                    <td className="py-2 text-[#92745E]">GST (est. 5%)</td>
                    <td className="py-2 text-right text-[#92745E]">{fmtINR(s.gst)}</td>
                  </tr>
                  <tr className="bg-[#FFF6EE] font-black">
                    <td className="py-3 text-[#1C0800] font-black">Est. Net to Restaurant</td>
                    <td className="py-3 text-right text-green-700 font-black text-lg">{fmtINR(s.netSettlement)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex gap-2">
              <Btn size="sm" onClick={downloadCSV}><Download size={12} /> CSV</Btn>
              <Btn size="sm" disabled title="Requires /aggregator/reports/settlement/:id/download-pdf">
                <Download size={12} /> PDF
              </Btn>
            </div>
          </div>
        );
      })}

      {/* Pending settlement — backend required */}
      <div className="bg-white rounded-xl border border-[#E8D5C0] p-5">
        <div className="flex items-center gap-2 mb-3">
          <Wallet size={18} className="text-[#E8380D]" />
          <p className="font-black text-[#1C0800]">Pending Settlement</p>
        </div>
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Pending settlement amounts require <span className="font-mono">GET /aggregator/reports/pending-settlement</span>.
        </p>
      </div>
    </div>
  );
}
