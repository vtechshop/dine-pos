import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, AlertCircle, Check, X, Printer,
  Clock, MapPin, Phone, User, ShoppingBag,
} from 'lucide-react';
import {
  fetchOnlineOrders,
  acceptDeliveryOrder,
  rejectDeliveryOrder,
  dispatchDeliveryOrder,
} from '../api/aggregator';
import type { OnlineOrder, AggregatorPlatform } from '../api/aggregator';
import { Spinner } from '../components/ui/Spinner';
import { useSocket } from '../context/SocketContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function fmtElapsed(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ${mins % 60}m ago` : `${Math.floor(hrs / 24)}d ago`;
}

function fmtINR(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

// ── Platform badge ────────────────────────────────────────────────────────────

function PlatformBadge({ source }: { source: OnlineOrder['orderSource'] }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
      source === 'swiggy' ? 'bg-brand' : 'bg-red-600'
    }`}>
      {source.toUpperCase()}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<OnlineOrder['status'], { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-amber-50 border-amber-200 text-amber-700' },
  preparing: { label: 'Preparing', cls: 'bg-blue-50 border-blue-200 text-blue-700' },
  ready:     { label: 'Ready',     cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  served:    { label: 'Served',    cls: 'bg-purple-50 border-purple-200 text-purple-700' },
  completed: { label: 'Completed', cls: 'bg-green-50 border-green-200 text-green-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-50 border-gray-200 text-gray-500' },
};

function StatusBadge({ status }: { status: OnlineOrder['status'] }) {
  const cfg = STATUS_CFG[status] ?? { label: status, cls: 'bg-gray-50 border-gray-200 text-gray-500' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────────

interface Toast { id: number; type: 'success' | 'error'; message: string }
let _tid = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast['type'], message: string) => {
    const id = ++_tid;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  return { toasts, add };
}

function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-md text-sm font-medium ${
          t.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {t.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Stats row ─────────────────────────────────────────────────────────────────

function StatsRow({ orders }: { orders: OnlineOrder[] }) {
  const today = todayStr();
  const todayOrders = orders.filter(o =>
    new Date(o.createdAt).toLocaleDateString('en-CA') === today,
  );
  const revenue = todayOrders.reduce((s, o) => s + o.grandTotal, 0);
  const pending = orders.filter(o => o.status === 'pending').length;
  const avg = todayOrders.length > 0 ? revenue / todayOrders.length : 0;

  const chips = [
    { label: "Today's Orders", value: String(todayOrders.length), color: 'border-brand/20 bg-brand/5 text-brand' },
    { label: 'Total Revenue',  value: fmtINR(revenue),            color: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    { label: 'Pending',        value: String(pending),             color: pending > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-border bg-canvas text-ink/50' },
    { label: 'Avg Order Value',value: fmtINR(avg),                 color: 'border-border bg-canvas text-ink/60' },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {chips.map(c => (
        <div key={c.label} className={`flex flex-col rounded-xl border px-4 py-2.5 ${c.color}`}>
          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{c.label}</span>
          <span className="text-lg font-bold leading-tight">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Reject inline form ────────────────────────────────────────────────────────

function RejectForm({
  onConfirm,
  onCancel,
  busy,
}: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="text-xs font-semibold text-red-800">Rejection reason</p>
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="e.g. Item unavailable, Kitchen closed..."
        className="w-full rounded border border-red-200 bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:border-red-400 focus:outline-none"
        autoFocus
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => onConfirm(reason)}
          className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? <Spinner size="sm" /> : <Check size={11} />}
          Confirm Reject
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1.5 text-xs font-semibold text-ink/60 hover:bg-mist"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Print helper ──────────────────────────────────────────────────────────────

function printOrder(order: OnlineOrder) {
  const win = window.open('', '_blank', 'width=400,height=600');
  if (!win) return;
  win.document.write(`
    <html><head><title>Order ${order.orderNumber}</title>
    <style>
      body { font-family: monospace; font-size: 13px; padding: 16px; }
      h2 { font-size: 16px; margin: 0 0 8px; }
      hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
      .row { display: flex; justify-content: space-between; }
      .bold { font-weight: bold; }
    </style></head><body>
    <h2>${order.orderSource.toUpperCase()} ORDER</h2>
    <p>${order.orderNumber} &bull; ${fmtTime(order.createdAt)}</p>
    <hr/>
    <p>${order.customerName} &bull; ${order.customerPhone}</p>
    <p>${order.deliveryAddress}</p>
    <hr/>
    ${order.items.map(i => `<div class="row"><span>${i.productName} x${i.quantity}</span><span>${fmtINR(i.total)}</span></div>`).join('')}
    <hr/>
    <div class="row bold"><span>Grand Total</span><span>${fmtINR(order.grandTotal)}</span></div>
    ${order.notes ? `<p>Note: ${order.notes}</p>` : ''}
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  onAccepted,
  onRejected,
  onDispatched,
  onToast,
}: {
  order: OnlineOrder;
  onAccepted: (id: string) => void;
  onRejected: (id: string) => void;
  onDispatched: (id: string) => void;
  onToast: (type: Toast['type'], msg: string) => void;
}) {
  const [busy,        setBusy]        = useState<string | null>(null);
  const [showReject,  setShowReject]  = useState(false);
  const [prepMin,     setPrepMin]     = useState(20);

  async function handleAccept() {
    setBusy('accept');
    try {
      await acceptDeliveryOrder(order._id, prepMin);
      onAccepted(order._id);
      onToast('success', `Order ${order.orderNumber} accepted.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to accept');
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(reason: string) {
    setBusy('reject');
    try {
      await rejectDeliveryOrder(order._id, reason);
      onRejected(order._id);
      onToast('success', `Order ${order.orderNumber} rejected.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setBusy(null);
      setShowReject(false);
    }
  }

  async function handleDispatch() {
    setBusy('dispatch');
    try {
      await dispatchDeliveryOrder(order._id);
      onDispatched(order._id);
      onToast('success', `Order ${order.orderNumber} dispatched.`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to dispatch');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-canvas shadow-sm">
      {/* Card header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <PlatformBadge source={order.orderSource} />
          <span className="font-mono text-sm font-bold text-ink">{order.orderNumber}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={order.status} />
          <span className="flex items-center gap-1 text-xs text-ink/50">
            <Clock size={11} />
            {fmtElapsed(order.createdAt)}
          </span>
        </div>
      </div>

      {/* Customer info */}
      <div className="border-b border-border px-4 py-3 space-y-1">
        <div className="flex items-center gap-2 text-sm text-ink">
          <User size={13} className="text-ink/40 shrink-0" />
          <span className="font-medium">{order.customerName}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink/60">
          <Phone size={11} className="shrink-0 text-ink/35" />
          {order.customerPhone}
        </div>
        <div className="flex items-start gap-2 text-xs text-ink/60">
          <MapPin size={11} className="mt-0.5 shrink-0 text-ink/35" />
          <span className="line-clamp-2">{order.deliveryAddress}</span>
        </div>
      </div>

      {/* Items */}
      <div className="border-b border-border px-4 py-3 space-y-1">
        {order.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span className="text-ink/80">{item.productName} <span className="text-ink/40">×{item.quantity}</span></span>
            <span className="font-medium text-ink">{fmtINR(item.total)}</span>
          </div>
        ))}
        {order.notes && (
          <p className="mt-1 text-xs italic text-ink/50">Note: {order.notes}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 space-y-2">
        {/* Total row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold text-ink">{fmtINR(order.grandTotal)}</p>
            {order.deliveryFee > 0 && (
              <p className="text-[11px] text-ink/40">+ {fmtINR(order.deliveryFee)} delivery</p>
            )}
          </div>
          <span className="font-mono text-[10px] text-ink/30">{order.platformOrderId}</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {/* Pending: accept + reject */}
          {order.status === 'pending' && (
            <>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={prepMin}
                  onChange={e => setPrepMin(Number(e.target.value))}
                  className="w-14 rounded border border-border bg-mist px-2 py-1 text-xs text-ink focus:border-brand focus:outline-none"
                  title="Prep time (min)"
                />
                <span className="text-[10px] text-ink/40">min</span>
              </div>
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={busy === 'accept'}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy === 'accept' ? <Spinner size="sm" /> : <Check size={12} />}
                Accept
              </button>
              <button
                type="button"
                onClick={() => setShowReject(r => !r)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                <X size={12} />
                Reject
              </button>
            </>
          )}

          {/* Preparing: mark ready (dispatch) */}
          {order.status === 'preparing' && (
            <button
              type="button"
              onClick={() => void handleDispatch()}
              disabled={busy === 'dispatch'}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === 'dispatch' ? <Spinner size="sm" /> : <Check size={12} />}
              Mark Ready
            </button>
          )}

          {/* Ready: dispatch */}
          {order.status === 'ready' && (
            <button
              type="button"
              onClick={() => void handleDispatch()}
              disabled={busy === 'dispatch'}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {busy === 'dispatch' ? <Spinner size="sm" /> : <ShoppingBag size={12} />}
              Mark Dispatched
            </button>
          )}

          {/* Print always */}
          <button
            type="button"
            onClick={() => printOrder(order)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink/60 hover:bg-mist hover:text-ink"
          >
            <Printer size={12} />
            Print
          </button>
        </div>

        {/* Reject inline form */}
        {showReject && (
          <RejectForm
            onConfirm={reason => void handleReject(reason)}
            onCancel={() => setShowReject(false)}
            busy={busy === 'reject'}
          />
        )}
      </div>
    </div>
  );
}

// ── Platform filter tabs ──────────────────────────────────────────────────────

type PlatformFilter = 'all' | AggregatorPlatform;
type StatusFilter   = 'all' | OnlineOrder['status'];

const PLATFORM_TABS: { key: PlatformFilter; label: string }[] = [
  { key: 'all',    label: 'All' },
  { key: 'swiggy', label: 'Swiggy' },
  { key: 'zomato', label: 'Zomato' },
];

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready',     label: 'Ready' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function FilterTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onSelect: (k: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-0.5">
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            active === t.key
              ? 'bg-brand text-white'
              : 'border border-border text-ink/60 hover:bg-mist hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function OnlineOrdersPage() {
  const [orders,      setOrders]      = useState<OnlineOrder[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [platFilter,  setPlatFilter]  = useState<PlatformFilter>('all');
  const [statFilter,  setStatFilter]  = useState<StatusFilter>('all');
  const { toasts, add: toast } = useToasts();
  const { socket } = useSocket();
  const ordersRef = useRef<OnlineOrder[]>([]);

  // Keep ref in sync for the socket handler closure
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOnlineOrders({ date: todayStr() });
      setOrders(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Real-time: new delivery order via socket
  useEffect(() => {
    if (!socket) return;
    const handler = (order: OnlineOrder) => {
      setOrders(prev => {
        if (prev.some(o => o._id === order._id)) return prev;
        return [order, ...prev];
      });
      toast('success', `New order from ${order.orderSource.toUpperCase()}: ${order.orderNumber}`);
    };
    socket.on('new_delivery_order', handler);
    return () => { socket.off('new_delivery_order', handler); };
  }, [socket, toast]);

  function updateOrderStatus(id: string, status: OnlineOrder['status']) {
    setOrders(prev => prev.map(o => o._id === id ? { ...o, status } : o));
  }

  // Filtered view
  const visible = orders.filter(o => {
    if (platFilter !== 'all' && o.orderSource !== platFilter) return false;
    if (statFilter !== 'all' && o.status !== statFilter) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Online Orders</h1>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-ink/60 hover:bg-mist hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <FilterTabs tabs={PLATFORM_TABS} active={platFilter} onSelect={setPlatFilter} />
        <FilterTabs tabs={STATUS_TABS}   active={statFilter} onSelect={setStatFilter} />
      </div>

      {/* Stats */}
      <StatsRow orders={orders} />

      {/* Content */}
      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-canvas py-16 text-center">
          <ShoppingBag size={32} className="mb-3 text-ink/20" />
          <p className="font-semibold text-ink/50">No orders</p>
          <p className="mt-1 text-xs text-ink/35">
            {statFilter !== 'all' || platFilter !== 'all'
              ? 'Try adjusting your filters'
              : "Today's delivery orders will appear here"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(order => (
            <OrderCard
              key={order._id}
              order={order}
              onAccepted={id   => updateOrderStatus(id, 'preparing')}
              onRejected={id   => updateOrderStatus(id, 'cancelled')}
              onDispatched={id => updateOrderStatus(id, order.status === 'preparing' ? 'ready' : 'completed')}
              onToast={toast}
            />
          ))}
        </div>
      )}

      <ToastList toasts={toasts} />
    </div>
  );
}
