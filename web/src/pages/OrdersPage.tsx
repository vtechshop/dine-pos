import { useState, useEffect, useCallback, Fragment } from 'react';
import { RefreshCw, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import type { OrderListItem } from '../types';
import { fetchOrders } from '../api/orders';
import { Spinner } from '../components/ui/Spinner';
import { useSettings } from '../context/SettingsContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

type RangeMode = 'today' | 'week' | 'month' | 'all';

const RANGE_OPTIONS: { key: RangeMode; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All Time' },
];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-amber-50 text-amber-700 border-amber-200',
  preparing:  'bg-blue-50 text-blue-700 border-blue-200',
  ready:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  served:     'bg-purple-50 text-purple-700 border-purple-200',
  paid:       'bg-green-50 text-green-700 border-green-200',
  cancelled:  'bg-gray-50 text-gray-500 border-gray-200',
};

const SOURCE_LABELS: Record<string, string> = {
  'dine-in': 'Dine-in',
  takeaway:  'Takeaway',
  qr:        'QR',
  swiggy:    'Swiggy',
  zomato:    'Zomato',
};

const STATUSES = ['all', 'pending', 'preparing', 'ready', 'served', 'paid', 'cancelled'] as const;
type StatusFilter = typeof STATUSES[number];

// ── Page ──────────────────────────────────────────────────────────────────────

export function OrdersPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [rangeMode, setRangeMode] = useState<RangeMode>('today');
  const [date,   setDate]   = useState(todayStr());
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [total,  setTotal]  = useState(0);
  const [pages,  setPages]  = useState(1);
  const [page,   setPage]   = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof fetchOrders>[0] = { page: pg, limit: 50 };
      if (rangeMode === 'today') params.date = date;
      else if (rangeMode === 'week')  { params.from = daysAgoStr(7);  params.to = todayStr(); }
      else if (rangeMode === 'month') { params.from = daysAgoStr(30); params.to = todayStr(); }
      // rangeMode === 'all': no date params → backend returns all orders
      if (status !== 'all') params.status = status;
      const res = await fetchOrders(params);
      setOrders(res.orders);
      setTotal(res.total);
      setPages(res.pages);
      setPage(pg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [rangeMode, date, status, page]);

  useEffect(() => { void load(1); }, [rangeMode, date, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = search.trim()
    ? orders.filter(o =>
        o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
        o.tableNumber.toLowerCase().includes(search.toLowerCase()) ||
        (o.customerName ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : orders;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#E8D5C0] bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-[#1C0800]">Orders</h1>
          {!loading && (
            <span className="rounded-full bg-[#1C0800]/8 px-2.5 py-0.5 text-xs font-medium text-[#1C0800]/50">
              {total}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Range quick-select */}
          <div className="flex items-center rounded-lg border border-[#E8D5C0] overflow-hidden">
            {RANGE_OPTIONS.map(r => (
              <button
                key={r.key}
                onClick={() => { setRangeMode(r.key); setExpanded(null); }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  rangeMode === r.key
                    ? 'bg-[#E8380D] text-white'
                    : 'bg-white text-[#1C0800]/50 hover:bg-[#1C0800]/5'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Specific-date picker — only shown in Today mode */}
          {rangeMode === 'today' && (
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={e => setDate(e.target.value)}
              className="h-8 rounded-lg border border-[#E8D5C0] bg-[#FFF6EE] px-3 text-xs text-[#1C0800] outline-none focus:border-[#E8380D]/50"
            />
          )}

          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#1C0800]/30" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Order # / table / name"
              className="h-8 w-44 rounded-lg border border-[#E8D5C0] bg-[#FFF6EE] pl-7 pr-3 text-xs text-[#1C0800] placeholder-[#1C0800]/30 outline-none focus:border-[#E8380D]/50"
            />
          </div>

          <button
            onClick={() => void load(1)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[#1C0800]/40 transition-colors hover:bg-[#1C0800]/5 hover:text-[#1C0800]/70 disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Status chips */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[#E8D5C0] bg-white px-5 pb-2 pt-2">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              status === s
                ? 'bg-[#E8380D] text-white'
                : 'bg-[#1C0800]/5 text-[#1C0800]/50 hover:bg-[#1C0800]/10 hover:text-[#1C0800]'
            }`}
          >
            {s === 'all' ? 'All orders' : s}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-4 rounded-lg border border-[#E8380D]/20 bg-[#E8380D]/10 px-4 py-3 text-sm text-[#E8380D]">
            {error}
          </div>
        )}

        {loading && orders.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-[#1C0800]/30">
            <p className="text-sm">No orders found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#E8D5C0] text-left">
                <th className="px-5 py-2.5 text-xs font-semibold text-[#1C0800]/40">Order</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-[#1C0800]/40">Table</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-[#1C0800]/40">Source</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-[#1C0800]/40">Time</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-[#1C0800]/40">Status</th>
                <th className="px-5 py-2.5 text-right text-xs font-semibold text-[#1C0800]/40">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(order => (
                <Fragment key={order._id}>
                  <tr
                    onClick={() => setExpanded(expanded === order._id ? null : order._id)}
                    className="cursor-pointer border-b border-[#E8D5C0]/60 transition-colors hover:bg-[#FFF6EE]"
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs font-semibold text-[#1C0800]">
                        #{order.orderNumber}
                      </span>
                      {order.isParcel && (
                        <span className="ml-2 rounded bg-[#E8380D]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#E8380D]">
                          Parcel
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-medium text-[#1C0800]">{order.tableNumber}</td>
                    <td className="px-3 py-3 text-xs text-[#1C0800]/50">
                      {SOURCE_LABELS[order.orderSource] ?? order.orderSource}
                    </td>
                    <td className="px-3 py-3 text-xs text-[#1C0800]/50">
                      <div>{fmtTime(order.createdAt)}</div>
                      <div className="text-[10px] text-[#1C0800]/30">{fmtDate(order.createdAt)}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_COLORS[order.status] ?? ''}`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-[#1C0800]">
                      {sym}{order.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                  </tr>

                  {expanded === order._id && (
                    <tr key={`${order._id}-detail`} className="bg-[#FFF6EE]/60">
                      <td colSpan={6} className="px-5 py-3">
                        <div className="flex flex-wrap gap-6">
                          <div className="min-w-48">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#1C0800]/30">Items</p>
                            <ul className="space-y-1">
                              {order.items.map((item, i) => (
                                <li key={i} className="flex justify-between gap-4 text-xs text-[#1C0800]/70">
                                  <span>{item.quantity}× {item.productName}</span>
                                  <span className="tabular-nums">{sym}{item.total.toFixed(2)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#1C0800]/30">Summary</p>
                            <div className="space-y-0.5 text-xs text-[#1C0800]/60">
                              <div className="flex justify-between gap-8">
                                <span>Subtotal</span>
                                <span className="tabular-nums">{sym}{order.subtotal.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between gap-8">
                                <span>Tax</span>
                                <span className="tabular-nums">{sym}{order.taxTotal.toFixed(2)}</span>
                              </div>
                              {(order.discountAmount ?? 0) > 0 && (
                                <div className="flex justify-between gap-8">
                                  <span>Discount</span>
                                  <span className="tabular-nums text-[#E8380D]">-{sym}{(order.discountAmount ?? 0).toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          {order.customerName && (
                            <div>
                              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#1C0800]/30">Customer</p>
                              <p className="text-xs text-[#1C0800]/70">{order.customerName}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t border-[#E8D5C0] bg-white px-5 py-2.5">
          <span className="text-xs text-[#1C0800]/40">
            Page {page} of {pages} · {total} orders
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1 || loading}
              onClick={() => void load(page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8D5C0] text-[#1C0800]/40 transition-colors hover:bg-[#1C0800]/5 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              disabled={page >= pages || loading}
              onClick={() => void load(page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E8D5C0] text-[#1C0800]/40 transition-colors hover:bg-[#1C0800]/5 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
