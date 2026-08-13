import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Search, ChevronLeft, ChevronRight, Calendar, X, Banknote, CreditCard, Smartphone } from 'lucide-react';
import type { OrderListItem } from '../types';
import { fetchOrders, updateOrderStatus } from '../api/orders';
import { Spinner } from '../components/ui/Spinner';
import { useSettings } from '../context/SettingsContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

type RangeMode = 'today' | 'week' | 'month' | 'all';

const RANGE_OPTIONS: { key: RangeMode; label: string }[] = [
  { key: 'today', label: 'Today'      },
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All Time'   },
];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `${hrs}h ago`;
  return fmtDate(iso);
}

// ── Status config ─────────────────────────────────────────────────────────────
// Backend allowed statuses: pending | preparing | ready | served | completed | cancelled
// 'completed' = payment collected + order closed (what other UIs show as "Paid")

const STATUS_CFG: Record<string, { pill: string; bar: string; dot: string; label: string }> = {
  pending:   { pill: 'bg-amber-50 text-amber-700 border-amber-200',       bar: 'bg-amber-400',   dot: 'bg-amber-400',   label: 'Pending'   },
  preparing: { pill: 'bg-sky-50 text-sky-700 border-sky-200',             bar: 'bg-sky-400',     dot: 'bg-sky-400',     label: 'Preparing' },
  ready:     { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', dot: 'bg-emerald-500', label: 'Ready'     },
  served:    { pill: 'bg-ink/[0.08] text-ink/60 border-ink/15',           bar: 'bg-ink/25',      dot: 'bg-ink/30',      label: 'Served'    },
  completed: { pill: 'bg-green-50 text-green-700 border-green-200',       bar: 'bg-green-500',   dot: 'bg-green-500',   label: 'Paid'      },
  cancelled: { pill: 'bg-rose-50 text-rose-600 border-rose-200',          bar: 'bg-rose-400',    dot: 'bg-rose-400',    label: 'Cancelled' },
};

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  'dine-in': { label: 'Dine-in',  cls: 'bg-ink/[0.06] text-ink/60'   },
  takeaway:  { label: 'Takeaway', cls: 'bg-amber-50 text-amber-700'   },
  qr:        { label: 'QR',       cls: 'bg-violet-50 text-violet-600' },
  swiggy:    { label: 'Swiggy',   cls: 'bg-orange-50 text-orange-600' },
  zomato:    { label: 'Zomato',   cls: 'bg-red-50 text-red-600'       },
};

// ── Status filter tabs ────────────────────────────────────────────────────────

const STATUSES = ['all', 'pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'] as const;
type StatusFilter = typeof STATUSES[number];

// Backend param to send per tab (tabs use 'completed', not 'paid')
const STATUS_API_PARAM: Record<StatusFilter, string | undefined> = {
  all:       undefined,
  pending:   'pending',
  preparing: 'preparing',
  ready:     'ready',
  served:    'served',
  completed: 'completed',
  cancelled: 'cancelled',
};

// ── Status lifecycle for timeline ─────────────────────────────────────────────

const STATUS_FLOW = [
  { key: 'pending',   label: 'Order placed'   },
  { key: 'preparing', label: 'Preparing'      },
  { key: 'ready',     label: 'Ready to serve' },
  { key: 'served',    label: 'Served'         },
  { key: 'completed', label: 'Paid'           },
];

// ── Payment methods for collect-payment panel ─────────────────────────────────

const PAY_METHODS: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'cash', label: 'Cash', icon: <Banknote  size={14} /> },
  { key: 'upi',  label: 'UPI',  icon: <Smartphone size={14} /> },
  { key: 'card', label: 'Card', icon: <CreditCard  size={14} /> },
];

// ── OrderDetailDrawer ─────────────────────────────────────────────────────────

interface DrawerProps {
  order: OrderListItem;
  sym: string;
  onClose: () => void;
  onUpdated: (patch: Partial<OrderListItem> & { _id: string }) => void;
}

function OrderDetailDrawer({ order, sym, onClose, onUpdated }: DrawerProps) {
  const [acting,      setActing]     = useState(false);
  const [actionErr,   setActionErr]  = useState<string | null>(null);
  const [payMethod,   setPayMethod]  = useState<string>('cash');
  const [showPayPanel,setShowPay]    = useState(false);

  const cfg     = STATUS_CFG[order.status];
  const src     = SOURCE_BADGE[order.orderSource];
  const flowIdx = STATUS_FLOW.findIndex(s => s.key === order.status);

  async function doAction(toStatus: string, extras?: { paymentMethod?: string }) {
    setActing(true);
    setActionErr(null);
    try {
      await updateOrderStatus(order._id, toStatus, extras);
      onUpdated({ _id: order._id, status: toStatus as OrderListItem['status'] });
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setActing(false);
    }
  }

  // Collect payment: served → completed with payment method
  async function doCollectPayment() {
    await doAction('completed', { paymentMethod: payMethod });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-sm flex-col bg-canvas shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Drawer header */}
        <div className="flex shrink-0 items-start justify-between border-b border-white/10 bg-ink px-5 py-4 text-white">
          <div>
            <p className="mb-1 font-mono text-xs text-white/40">#{order.orderNumber}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize leading-none ${cfg?.pill ?? ''}`}>
                {cfg?.label ?? order.status}
              </span>
              {order.isParcel && (
                <span className="rounded bg-brand/25 px-1.5 py-0.5 text-[10px] font-semibold text-brand/90 leading-none">
                  Parcel
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Order meta */}
          <div className="border-b border-border px-5 py-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">Table</p>
                <p className="font-semibold text-ink">{order.tableNumber || '—'}</p>
              </div>
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">Type</p>
                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none ${src?.cls ?? 'bg-ink/5 text-ink/50'}`}>
                  {src?.label ?? order.orderSource}
                </span>
              </div>
              {order.customerName && (
                <div>
                  <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">Guest</p>
                  <p className="text-ink/70">{order.customerName}</p>
                </div>
              )}
              <div>
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">Placed</p>
                <p className="text-ink/70">{fmtTime(order.createdAt)}, {fmtDate(order.createdAt)}</p>
              </div>
              {order.paymentMethod && (
                <div>
                  <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">Payment</p>
                  <p className="capitalize text-ink/70">{order.paymentMethod}</p>
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          <div className="border-b border-border px-5 py-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-ink/40">Items</p>
            <ul className="space-y-2">
              {order.items.map((item, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink/80">{item.productName}</span>
                  <div className="flex items-baseline gap-2.5 shrink-0">
                    <span className="text-xs text-ink/40">{item.quantity}×</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">
                      {sym}{item.total.toFixed(2)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Bill */}
          <div className="border-b border-border px-5 py-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-ink/40">Bill</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-ink/60">
                <span>Subtotal</span>
                <span className="tabular-nums">{sym}{order.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-ink/60">
                <span>GST</span>
                <span className="tabular-nums">{sym}{order.taxTotal.toFixed(2)}</span>
              </div>
              {(order.discountAmount ?? 0) > 0 && (
                <div className="flex justify-between text-brand">
                  <span>Discount</span>
                  <span className="tabular-nums">-{sym}{(order.discountAmount ?? 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-ink">
                <span>Total</span>
                <span className="tabular-nums">
                  {sym}{order.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="px-5 py-4">
            <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-ink/40">Timeline</p>
            {order.status === 'cancelled' ? (
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 flex-shrink-0 rounded-full bg-rose-400" />
                <div>
                  <p className="text-xs font-semibold text-rose-500">Cancelled</p>
                  <p className="text-[10px] text-ink/40">{timeAgo(order.createdAt)}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-0">
                {STATUS_FLOW.map((step, idx) => {
                  const reached = flowIdx >= idx;
                  const current = order.status === step.key;
                  const isLast  = idx === STATUS_FLOW.length - 1;
                  return (
                    <div key={step.key} className="flex items-start gap-3">
                      <div className="flex flex-shrink-0 flex-col items-center">
                        <div className={`mt-0.5 h-3 w-3 rounded-full border-2 transition-colors ${
                          current  ? 'border-brand bg-brand'
                          : reached ? 'border-green-500 bg-green-500'
                          :           'border-border bg-canvas'
                        }`} />
                        {!isLast && (
                          <div className={`mt-0.5 h-6 w-px ${reached ? 'bg-green-200' : 'bg-border/40'}`} />
                        )}
                      </div>
                      <div className="pb-1.5">
                        <p className={`text-xs font-medium ${
                          current  ? 'text-brand'
                          : reached ? 'text-ink/70'
                          :           'text-ink/30'
                        }`}>
                          {step.label}
                        </p>
                        {current && step.key !== 'completed' && (
                          <p className="text-[10px] text-ink/40">{timeAgo(order.createdAt)}</p>
                        )}
                        {step.key === 'completed' && order.completedAt && (
                          <p className="text-[10px] text-ink/40">{fmtTime(order.completedAt)}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* ── Footer: contextual actions ── */}
        <div className="shrink-0 border-t border-border bg-canvas">

          {/* pending → preparing */}
          {order.status === 'pending' && (
            <div className="px-5 py-3">
              {actionErr && <p className="mb-2 text-xs text-rose-600">{actionErr}</p>}
              <button
                onClick={() => void doAction('preparing')}
                disabled={acting}
                className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
              >
                {acting ? 'Updating…' : 'Start Preparing'}
              </button>
            </div>
          )}

          {/* preparing → ready */}
          {order.status === 'preparing' && (
            <div className="px-5 py-3">
              {actionErr && <p className="mb-2 text-xs text-rose-600">{actionErr}</p>}
              <button
                onClick={() => void doAction('ready')}
                disabled={acting}
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {acting ? 'Updating…' : 'Mark Ready'}
              </button>
            </div>
          )}

          {/* ready → served */}
          {order.status === 'ready' && (
            <div className="px-5 py-3">
              {actionErr && <p className="mb-2 text-xs text-rose-600">{actionErr}</p>}
              <button
                onClick={() => void doAction('served')}
                disabled={acting}
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {acting ? 'Updating…' : 'Mark Served'}
              </button>
            </div>
          )}

          {/* served → completed (collect payment — admin only) */}
          {order.status === 'served' && (
            <div className="px-5 py-3 space-y-3">
              {actionErr && <p className="text-xs text-rose-600">{actionErr}</p>}

              {!showPayPanel ? (
                <button
                  onClick={() => setShowPay(true)}
                  className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand/90"
                >
                  Collect Payment
                </button>
              ) : (
                <>
                  {/* Amount */}
                  <div className="flex items-center justify-between rounded-lg bg-mist px-4 py-2.5">
                    <span className="text-xs font-medium text-ink/60">Amount to collect</span>
                    <span className="text-base font-bold tabular-nums text-ink">
                      {sym}{order.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Payment method selector */}
                  <div className="flex gap-2">
                    {PAY_METHODS.map(m => (
                      <button
                        key={m.key}
                        onClick={() => setPayMethod(m.key)}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition-colors ${
                          payMethod === m.key
                            ? 'border-brand bg-brand/10 text-brand'
                            : 'border-border bg-canvas text-ink/50 hover:border-brand/30 hover:text-ink'
                        }`}
                      >
                        {m.icon} {m.label}
                      </button>
                    ))}
                  </div>

                  {/* Confirm */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowPay(false)}
                      className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-ink/50 transition-colors hover:bg-mist"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void doCollectPayment()}
                      disabled={acting}
                      className="flex-1 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
                    >
                      {acting ? 'Processing…' : 'Confirm'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ status, rangeMode, search }: {
  status: StatusFilter; rangeMode: RangeMode; search: string;
}) {
  if (search.trim()) {
    return (
      <div className="flex h-52 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-semibold text-ink/40">No matching orders</p>
        <p className="text-xs text-ink/30">Try a different order number, table, or customer name.</p>
      </div>
    );
  }
  const copy: Record<StatusFilter, [string, string]> = {
    all:       rangeMode === 'today'
                 ? ['No orders today', 'Orders placed today will appear here.']
                 : ['No orders found', 'Try a different date range.'],
    pending:   ['No pending orders',       'New orders will appear here when placed.'],
    preparing: ['No orders in preparation','Orders move here when kitchen starts preparing.'],
    ready:     ['No orders ready',         'Orders marked ready by the kitchen appear here.'],
    served:    ['No served orders',        'Orders move here once served to the guest.'],
    completed: ['No paid orders',          'Completed and billed orders appear here.'],
    cancelled: ['No cancelled orders',     'Cancelled orders will appear here.'],
  };
  const [title, sub] = copy[status];
  return (
    <div className="flex h-52 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-semibold text-ink/40">{title}</p>
      <p className="text-xs text-ink/30">{sub}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OrdersPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [rangeMode, setRangeMode] = useState<RangeMode>('today');
  const [date,      setDate]      = useState(todayStr());
  const [status,    setStatus]    = useState<StatusFilter>('all');
  const [search,    setSearch]    = useState('');
  const [orders,    setOrders]    = useState<OrderListItem[]>([]);
  const [total,     setTotal]     = useState(0);
  const [pages,     setPages]     = useState(1);
  const [page,      setPage]      = useState(1);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [selected,  setSelected]  = useState<OrderListItem | null>(null);

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof fetchOrders>[0] = { page: pg, limit: 50 };
      if (rangeMode === 'today') params.date = date;
      else if (rangeMode === 'week')  { params.from = daysAgoStr(7);  params.to = todayStr(); }
      else if (rangeMode === 'month') { params.from = daysAgoStr(30); params.to = todayStr(); }
      const apiStatus = STATUS_API_PARAM[status];
      if (apiStatus) params.status = apiStatus;
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

  const filtered = useMemo(() =>
    search.trim()
      ? orders.filter(o =>
          o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
          o.tableNumber.toLowerCase().includes(search.toLowerCase()) ||
          (o.customerName ?? '').toLowerCase().includes(search.toLowerCase()),
        )
      : orders,
  [orders, search]);

  // Per-status counts from current page (approximate for inactive tabs)
  const pageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  function handleUpdated(patch: Partial<OrderListItem> & { _id: string }) {
    if (status !== 'all' && patch.status && patch.status !== status) {
      setOrders(prev => prev.filter(o => o._id !== patch._id));
      setSelected(null);
    } else {
      setOrders(prev => prev.map(o => o._id === patch._id ? { ...o, ...patch } : o));
      setSelected(prev => prev && prev._id === patch._id ? { ...prev, ...patch } : prev);
    }
  }

  return (
    <div className="flex h-full flex-col">

      {/* Topbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-ink">Orders</h1>
          {!loading && (
            <span className="rounded-full bg-ink/[0.08] px-2.5 py-0.5 text-xs font-medium text-ink/50">
              {total}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {RANGE_OPTIONS.map(r => (
              <button
                key={r.key}
                onClick={() => { setRangeMode(r.key); setSelected(null); }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  rangeMode === r.key ? 'bg-brand text-white' : 'bg-canvas text-ink/50 hover:bg-ink/5'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {rangeMode === 'today' && (
            <div className="relative flex items-center">
              <Calendar size={13} className="pointer-events-none absolute left-2.5 text-ink/40" />
              <input
                type="date"
                value={date}
                max={todayStr()}
                onChange={e => setDate(e.target.value)}
                className="h-8 rounded-lg border border-border bg-mist pl-7 pr-3 text-xs text-ink outline-none focus:border-brand/50"
              />
            </div>
          )}

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/30" />
            <label htmlFor="orders-search" className="sr-only">Search orders</label>
            <input
              id="orders-search"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Order # / table / customer"
              className="h-8 w-44 rounded-lg border border-border bg-mist pl-7 pr-3 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50"
            />
          </div>

          <button
            onClick={() => void load(1)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70 disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex shrink-0 items-center overflow-x-auto border-b border-border bg-canvas px-4">
        {STATUSES.map(s => {
          const isActive  = status === s;
          const cfg       = s !== 'all' ? STATUS_CFG[s] : null;
          const cnt       = isActive ? total : (pageCounts[s] ?? 0);
          const showBadge = isActive ? !loading : cnt > 0;
          const tabLabel  = s === 'all' ? 'All Orders' : (STATUS_CFG[s]?.label ?? s);

          return (
            <button
              key={s}
              onClick={() => { setStatus(s); setSelected(null); }}
              className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-medium transition-colors ${
                isActive ? 'text-brand' : 'text-ink/50 hover:text-ink'
              }`}
            >
              {cfg && <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${cfg.dot}`} />}
              {tabLabel}
              {showBadge && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                  isActive
                    ? 'bg-brand/15 text-brand'
                    : s === 'cancelled'
                    ? 'bg-rose-50 text-rose-500'
                    : 'bg-ink/[0.06] text-ink/40'
                }`}>
                  {cnt}
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t bg-brand" />
              )}
            </button>
          );
        })}
      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading && orders.length === 0 ? (
          <div className="flex h-48 items-center justify-center"><Spinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState status={status} rangeMode={rangeMode} search={search} />
        ) : (
          <>
            {/* Column headers — desktop */}
            <div className="sticky top-0 z-10 hidden md:grid md:grid-cols-[2fr_1fr_80px_80px_100px_88px] items-center gap-2 border-b border-border/50 bg-canvas px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-ink/30">
              <span className="pl-4">Order</span>
              <span>Table / Guest</span>
              <span>Type</span>
              <span>Time</span>
              <span>Status</span>
              <span className="text-right">Amount</span>
            </div>

            <div className="divide-y divide-border/40">
              {filtered.map(order => {
                const cfg   = STATUS_CFG[order.status];
                const src   = SOURCE_BADGE[order.orderSource];
                const isSel = selected?._id === order._id;

                return (
                  <div
                    key={order._id}
                    onClick={() => setSelected(isSel ? null : order)}
                    className={`relative cursor-pointer px-5 py-3 transition-colors ${isSel ? 'bg-brand/[0.04]' : 'hover:bg-mist'}`}
                  >
                    <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r ${cfg?.bar ?? 'bg-ink/10'}`} />

                    {/* Desktop row */}
                    <div className="hidden md:grid md:grid-cols-[2fr_1fr_80px_80px_100px_88px] items-center gap-2">

                      <div className="min-w-0 pl-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-ink">#{order.orderNumber}</span>
                          {order.isParcel && (
                            <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand leading-none">Parcel</span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-ink/40">
                          {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                          {order.items.length > 0 && (
                            <span className="ml-1 text-ink/30">
                              · {order.items.slice(0, 2).map(i => i.productName).join(', ')}
                              {order.items.length > 2 && ` +${order.items.length - 2}`}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{order.tableNumber || '—'}</p>
                        {order.customerName && (
                          <p className="truncate text-[11px] text-ink/45">{order.customerName}</p>
                        )}
                      </div>

                      <div>
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${src?.cls ?? 'bg-ink/5 text-ink/50'}`}>
                          {src?.label ?? order.orderSource}
                        </span>
                      </div>

                      <div className="text-xs text-ink/50">
                        <div>{fmtTime(order.createdAt)}</div>
                        <div className="text-[10px] text-ink/30">{fmtDate(order.createdAt)}</div>
                      </div>

                      <div>
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize leading-none ${cfg?.pill ?? 'bg-ink/5 text-ink/40 border-ink/10'}`}>
                          {cfg?.label ?? order.status}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-bold tabular-nums text-ink">
                          {sym}{order.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    {/* Mobile card */}
                    <div className="block md:hidden pl-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-ink">#{order.orderNumber}</span>
                            {order.isParcel && (
                              <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand leading-none">Parcel</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-ink/60">
                            {order.tableNumber || '—'}{order.customerName && ` · ${order.customerName}`}
                          </p>
                          <p className="text-[11px] text-ink/40">
                            {order.items.length} item{order.items.length !== 1 ? 's' : ''} · {fmtTime(order.createdAt)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums text-ink">
                            {sym}{order.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </p>
                          <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize leading-none ${cfg?.pill ?? 'bg-ink/5 text-ink/40 border-ink/10'}`}>
                            {cfg?.label ?? order.status}
                          </span>
                        </div>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-canvas px-5 py-2.5">
          <span className="text-xs text-ink/40">Page {page} of {pages} · {total} orders</span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1 || loading}
              onClick={() => void load(page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-ink/40 transition-colors hover:bg-ink/5 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              disabled={page >= pages || loading}
              onClick={() => void load(page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-ink/40 transition-colors hover:bg-ink/5 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Order detail drawer */}
      {selected && (
        <OrderDetailDrawer
          order={selected}
          sym={sym}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
        />
      )}

    </div>
  );
}
