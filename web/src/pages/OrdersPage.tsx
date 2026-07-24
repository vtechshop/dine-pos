import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Search, ChevronLeft, ChevronRight, X, Clock, User, Package, Utensils } from 'lucide-react';
import type { OrderListItem } from '../types';
import { fetchOrders } from '../api/orders';
import { Spinner } from '../components/ui/Spinner';
import { useSettings } from '../context/SettingsContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toLocaleDateString('en-CA'); }
function daysAgoStr(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); }
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); }
function fmtDateLong(iso: string) { return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); }

type RangeMode = 'today' | 'week' | 'month' | 'all';

const RANGE_OPTIONS: { key: RangeMode; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all',   label: 'All' },
];

const STATUSES = ['all', 'pending', 'preparing', 'ready', 'served', 'paid', 'cancelled'] as const;
type StatusFilter = typeof STATUSES[number];

const STATUS_BADGE: Record<string, string> = {
  pending:   'badge badge-warning',
  preparing: 'badge badge-info',
  ready:     'badge badge-success',
  served:    'badge bg-purple-100 text-purple-700',
  paid:      'badge badge-success',
  cancelled: 'badge badge-neutral',
};

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  'dine-in': { label: 'Dine-in',  cls: 'badge badge-brand' },
  takeaway:  { label: 'Takeaway', cls: 'badge badge-neutral' },
  qr:        { label: 'QR',       cls: 'badge badge-info' },
  swiggy:    { label: 'Swiggy',   cls: 'badge bg-orange-100 text-orange-700' },
  zomato:    { label: 'Zomato',   cls: 'badge bg-red-100 text-red-700' },
};

const PIPELINE_STEPS: OrderListItem['status'][] = ['pending', 'preparing', 'ready', 'served', 'paid'];

function pipelineIndex(status: OrderListItem['status']): number {
  if (status === 'cancelled') return -1;
  return PIPELINE_STEPS.indexOf(status);
}

// ── Status Pipeline ───────────────────────────────────────────────────────────

function StatusPipeline({ status }: { status: OrderListItem['status'] }) {
  const active = pipelineIndex(status);
  if (status === 'cancelled') {
    return (
      <div className="flex items-center justify-center py-3">
        <span className={STATUS_BADGE.cancelled}>Cancelled</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0">
      {PIPELINE_STEPS.map((step, i) => {
        const done    = i <= active;
        const current = i === active;
        return (
          <div key={step} className="flex flex-1 flex-col items-center gap-1">
            {/* Connector line */}
            <div className="flex w-full items-center">
              {i > 0 && <div className={`h-0.5 flex-1 transition-colors ${done ? 'bg-brand' : 'bg-border'}`} />}
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
                current  ? 'bg-brand text-white ring-2 ring-brand/30'
                : done   ? 'bg-brand/20 text-brand'
                : 'bg-border/60 text-ink/30'
              }`}>
                {i + 1}
              </div>
              {i < PIPELINE_STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < active ? 'bg-brand' : 'bg-border'}`} />}
            </div>
            <span className={`text-[9px] font-semibold uppercase tracking-[.06em] ${current ? 'text-brand' : done ? 'text-ink/50' : 'text-ink/25'}`}>
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ order, sym, onClose }: { order: OrderListItem; sym: string; onClose(): void }) {
  const src = SOURCE_META[order.orderSource] ?? { label: order.orderSource, cls: 'badge badge-neutral' };
  return (
    <div className="flex h-full flex-col animate-slide-left">
      {/* Panel header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-bold text-ink">#{order.orderNumber}</span>
          <span className={STATUS_BADGE[order.status] ?? 'badge badge-neutral'}>{order.status}</span>
          <span className={src.cls}>{src.label}</span>
          {order.isParcel && <span className="badge badge-warning"><Package size={9} />Parcel</span>}
        </div>
        <button onClick={onClose} className="btn btn-sm btn-ghost p-1"><X size={14} /></button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Status pipeline */}
        <div className="ds-card p-3">
          <StatusPipeline status={order.status} />
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="ds-card px-3 py-2.5 space-y-0.5">
            <p className="field-label">Table</p>
            <p className="font-semibold text-ink flex items-center gap-1">
              <Utensils size={11} className="text-ink/40" />
              {order.tableNumber}
            </p>
          </div>
          <div className="ds-card px-3 py-2.5 space-y-0.5">
            <p className="field-label">Time</p>
            <p className="font-semibold text-ink flex items-center gap-1">
              <Clock size={11} className="text-ink/40" />
              {fmtTime(order.createdAt)}
            </p>
            <p className="text-[10px] text-ink/40">{fmtDateLong(order.createdAt)}</p>
          </div>
          {order.customerName && (
            <div className="col-span-2 ds-card px-3 py-2.5">
              <p className="field-label">Customer</p>
              <p className="text-sm font-semibold text-ink flex items-center gap-1">
                <User size={11} className="text-ink/40" />{order.customerName}
              </p>
            </div>
          )}
          {order.paymentMethod && (
            <div className="ds-card px-3 py-2.5">
              <p className="field-label">Payment</p>
              <p className="font-semibold text-ink capitalize">{order.paymentMethod}</p>
            </div>
          )}
          {order.completedAt && (
            <div className="ds-card px-3 py-2.5">
              <p className="field-label">Completed</p>
              <p className="font-semibold text-ink">{fmtTime(order.completedAt)}</p>
            </div>
          )}
        </div>

        {/* Items */}
        <div>
          <p className="field-label mb-2">Items ({order.items.length})</p>
          <div className="ds-card divide-y divide-border/50">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                    {item.quantity}
                  </span>
                  <span className="text-xs font-medium text-ink">{item.productName}</span>
                </div>
                <span className="text-xs font-semibold tabular-nums text-ink">
                  {sym}{item.total.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="ds-card divide-y divide-border/50">
          <div className="flex items-center justify-between px-3 py-2.5 text-xs text-ink/60">
            <span>Subtotal</span><span className="tabular-nums">{sym}{order.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2.5 text-xs text-ink/60">
            <span>Tax</span><span className="tabular-nums">{sym}{order.taxTotal.toFixed(2)}</span>
          </div>
          {(order.discountAmount ?? 0) > 0 && (
            <div className="flex items-center justify-between px-3 py-2.5 text-xs text-brand">
              <span>Discount</span><span className="tabular-nums">-{sym}{(order.discountAmount ?? 0).toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-3 font-bold text-ink">
            <span className="text-sm">Total</span>
            <span className="text-base tabular-nums">{sym}{order.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OrdersPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [rangeMode, setRangeMode] = useState<RangeMode>('today');
  const [date,     setDate]     = useState(todayStr());
  const [status,   setStatus]   = useState<StatusFilter>('all');
  const [search,   setSearch]   = useState('');
  const [orders,   setOrders]   = useState<OrderListItem[]>([]);
  const [total,    setTotal]    = useState(0);
  const [pages,    setPages]    = useState(1);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async (pg = 1) => {
    setLoading(true); setError(null);
    try {
      const params: Parameters<typeof fetchOrders>[0] = { page: pg, limit: 50 };
      if (rangeMode === 'today')      params.date = date;
      else if (rangeMode === 'week')  { params.from = daysAgoStr(7);  params.to = todayStr(); }
      else if (rangeMode === 'month') { params.from = daysAgoStr(30); params.to = todayStr(); }
      if (status !== 'all') params.status = status;
      const res = await fetchOrders(params);
      setOrders(res.orders); setTotal(res.total); setPages(res.pages); setPage(pg);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load orders'); }
    finally { setLoading(false); }
  }, [rangeMode, date, status]);

  useEffect(() => { void load(1); setSelected(null); }, [rangeMode, date, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter(o =>
      o.orderNumber.toLowerCase().includes(q) ||
      o.tableNumber.toLowerCase().includes(q) ||
      (o.customerName ?? '').toLowerCase().includes(q),
    );
  }, [orders, search]);

  const selectedOrder = useMemo(() => filtered.find(o => o._id === selected) ?? null, [filtered, selected]);

  const filteredRevenue = useMemo(
    () => filtered.filter(o => o.status === 'paid').reduce((s, o) => s + o.grandTotal, 0),
    [filtered],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-5 py-2.5">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-ink">Orders</h1>
          {!loading && <span className="badge badge-neutral">{total}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Range selector */}
          <div className="flex items-center overflow-hidden rounded-lg border border-border">
            {RANGE_OPTIONS.map(r => (
              <button
                key={r.key}
                onClick={() => setRangeMode(r.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  rangeMode === r.key ? 'bg-brand text-white' : 'text-ink/50 hover:bg-mist'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {rangeMode === 'today' && (
            <input
              type="date" value={date} max={todayStr()}
              onChange={e => setDate(e.target.value)}
              className="h-8 rounded-lg border border-border bg-mist px-3 text-xs text-ink outline-none focus:border-brand/50"
            />
          )}

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Order # / table / name"
              className="h-8 w-44 rounded-lg border border-border bg-mist pl-7 pr-3 text-xs text-ink placeholder:text-ink/30 outline-none focus:border-brand/50"
            />
          </div>

          <button onClick={() => void load(1)} disabled={loading} className="btn btn-sm btn-ghost">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Status chips + summary ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-5 py-2 gap-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`chip ${status === s ? 'active' : ''} whitespace-nowrap capitalize`}
            >
              {s === 'all' ? 'All orders' : s}
            </button>
          ))}
        </div>
        {!loading && filtered.length > 0 && filteredRevenue > 0 && (
          <span className="shrink-0 text-xs text-ink/40 tabular-nums">
            {sym}{filteredRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })} paid
          </span>
        )}
      </div>

      {/* ── Body: list + detail panel ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: order list */}
        <div className={`flex flex-col overflow-hidden ${selectedOrder ? 'hidden md:flex md:flex-1' : 'flex-1'}`}>

          {error && (
            <div className="mx-4 mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-error/25 bg-error/5 px-4 py-2.5 text-sm text-error">
              {error}
              <button onClick={() => setError(null)} className="ml-auto"><X size={13} /></button>
            </div>
          )}

          {loading && orders.length === 0 ? (
            <div className="flex flex-1 items-center justify-center"><Spinner size="lg" /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink/30">
              <p className="text-sm">No orders found</p>
              {search && <button onClick={() => setSearch('')} className="text-xs text-brand hover:underline">Clear search</button>}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Table</th>
                      <th>Source</th>
                      <th>Time</th>
                      <th>Status</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(order => {
                      const src = SOURCE_META[order.orderSource];
                      return (
                        <tr
                          key={order._id}
                          onClick={() => setSelected(s => s === order._id ? null : order._id)}
                          className={`cursor-pointer ${selected === order._id ? 'selected' : ''}`}
                        >
                          <td>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-xs font-bold text-ink">#{order.orderNumber}</span>
                              {order.isParcel && <span className="badge badge-warning text-[9px]"><Package size={9} />Parcel</span>}
                            </div>
                          </td>
                          <td className="font-medium">{order.tableNumber}</td>
                          <td>
                            <span className={`${src?.cls ?? 'badge badge-neutral'} text-[10px]`}>
                              {src?.label ?? order.orderSource}
                            </span>
                          </td>
                          <td>
                            <div className="text-xs text-ink/70">{fmtTime(order.createdAt)}</div>
                            <div className="text-[10px] text-ink/35">{fmtDate(order.createdAt)}</div>
                          </td>
                          <td>
                            <span className={`${STATUS_BADGE[order.status] ?? 'badge badge-neutral'} text-[10px]`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="td-r font-semibold">
                            {sym}{order.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-2.5">
              <span className="text-xs text-ink/40">Page {page} of {pages} · {total} orders</span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page <= 1 || loading} onClick={() => void load(page - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-ink/40 hover:bg-mist disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  disabled={page >= pages || loading} onClick={() => void load(page + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-ink/40 hover:bg-mist disabled:opacity-30"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        {selectedOrder && (
          <div className="w-full md:w-96 shrink-0 border-l border-border bg-surface">
            <DetailPanel order={selectedOrder} sym={sym} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
