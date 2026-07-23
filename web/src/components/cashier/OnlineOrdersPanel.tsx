import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShoppingBag, Clock, MapPin, Phone, User,
  ChevronDown, ChevronUp, Printer, Check, X,
  AlertCircle, RefreshCw,
} from 'lucide-react';
import {
  fetchOnlineOrders,
  acceptDeliveryOrder,
  rejectDeliveryOrder,
  dispatchDeliveryOrder,
} from '../../api/aggregator';
import type { OnlineOrder } from '../../api/aggregator';
import { Spinner } from '../ui/Spinner';
import { useSocket } from '../../context/SocketContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function fmtINR(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function elapsedMins(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function fmtElapsed(iso: string) {
  const mins = elapsedMins(iso);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

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

// ── Toast ─────────────────────────────────────────────────────────────────────

interface Toast { id: number; type: 'success' | 'error'; message: string }
let _tid = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((type: Toast['type'], message: string) => {
    const id = ++_tid;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  return { toasts, add };
}

function ToastList({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 shadow-md text-xs font-medium ${
          t.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {t.type === 'success' ? <Check size={12} /> : <AlertCircle size={12} />}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Sub-tab types ─────────────────────────────────────────────────────────────

type SubTab = 'pending' | 'kitchen' | 'ready' | 'delayed' | 'all';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'pending', label: 'Pending Acceptance' },
  { key: 'kitchen', label: 'In Kitchen' },
  { key: 'ready',   label: 'Ready for Pickup' },
  { key: 'delayed', label: 'Delayed' },
  { key: 'all',     label: 'All' },
];

function filterByTab(orders: OnlineOrder[], tab: SubTab): OnlineOrder[] {
  switch (tab) {
    case 'pending': return orders.filter(o => o.status === 'pending');
    case 'kitchen': return orders.filter(o => o.status === 'preparing');
    case 'ready':   return orders.filter(o => o.status === 'ready');
    case 'delayed': return orders.filter(
      o => (o.status === 'pending' || o.status === 'preparing') && elapsedMins(o.createdAt) >= 30,
    );
    case 'all':
    default:        return orders;
  }
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
    <div className="mt-1.5 space-y-1.5 rounded-lg border border-red-200 bg-red-50 p-2.5">
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Rejection reason…"
        className="w-full rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-ink placeholder:text-ink/30 focus:border-red-400 focus:outline-none"
        autoFocus
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => onConfirm(reason)}
          className="flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? <Spinner size="sm" /> : <Check size={10} />}
          Confirm
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-2.5 py-1 text-[11px] font-semibold text-ink/60 hover:bg-mist"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Platform badge ────────────────────────────────────────────────────────────

function PlatformBadge({ source }: { source: OnlineOrder['orderSource'] }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold text-white ${
      source === 'swiggy' ? 'bg-brand' : 'bg-red-600'
    }`}>
      {source.toUpperCase()}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<OnlineOrder['status'], { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-amber-50 border-amber-200 text-amber-700' },
  preparing: { label: 'In Kitchen',cls: 'bg-blue-50 border-blue-200 text-blue-700' },
  ready:     { label: 'Ready',     cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  served:    { label: 'Served',    cls: 'bg-purple-50 border-purple-200 text-purple-700' },
  completed: { label: 'Completed', cls: 'bg-green-50 border-green-200 text-green-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-50 border-gray-200 text-gray-500' },
};

function StatusBadge({ status }: { status: OnlineOrder['status'] }) {
  const cfg = STATUS_CFG[status] ?? { label: status, cls: 'bg-gray-50 border-gray-200 text-gray-500' };
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ── Order compact card ────────────────────────────────────────────────────────

function OrderCompactCard({
  order,
  onStatusChange,
  onToast,
}: {
  order: OnlineOrder;
  onStatusChange: (id: string, status: OnlineOrder['status']) => void;
  onToast: (type: Toast['type'], msg: string) => void;
}) {
  const [expanded,     setExpanded]     = useState(false);
  const [showReject,   setShowReject]   = useState(false);
  const [busy,         setBusy]         = useState<string | null>(null);
  const isDelayed = (order.status === 'pending' || order.status === 'preparing') && elapsedMins(order.createdAt) >= 30;

  async function handleAccept() {
    setBusy('accept');
    try {
      await acceptDeliveryOrder(order._id, 20);
      onStatusChange(order._id, 'preparing');
      onToast('success', `Accepted: ${order.orderNumber}`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to accept');
    } finally { setBusy(null); }
  }

  async function handleReject(reason: string) {
    setBusy('reject');
    try {
      await rejectDeliveryOrder(order._id, reason);
      onStatusChange(order._id, 'cancelled');
      onToast('success', `Rejected: ${order.orderNumber}`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to reject');
    } finally { setBusy(null); setShowReject(false); }
  }

  async function handleDispatch() {
    setBusy('dispatch');
    try {
      await dispatchDeliveryOrder(order._id);
      onStatusChange(order._id, order.status === 'preparing' ? 'ready' : 'completed');
      onToast('success', `Dispatched: ${order.orderNumber}`);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to dispatch');
    } finally { setBusy(null); }
  }

  // First 2 items summary
  const itemsPreview = order.items.slice(0, 2);
  const extraCount   = order.items.length - 2;

  return (
    <div className={`rounded-xl border bg-canvas shadow-sm transition ${
      isDelayed ? 'border-amber-300 ring-1 ring-amber-200' : 'border-border'
    }`}>
      {/* Main row */}
      <div className="flex items-start gap-2.5 p-3">
        {/* Left: platform + basic info */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <PlatformBadge source={order.orderSource} />
            <span className="font-mono text-xs font-bold text-ink">{order.orderNumber}</span>
            <StatusBadge status={order.status} />
            {isDelayed && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                <Clock size={9} />
                DELAYED
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-ink/60">
            <User size={10} className="shrink-0" />
            <span className="truncate font-medium text-ink">{order.customerName}</span>
            <span className="text-ink/30">&bull;</span>
            <Phone size={10} className="shrink-0" />
            <span>{order.customerPhone}</span>
          </div>

          <div className="flex items-start gap-1.5 text-[11px] text-ink/50">
            <MapPin size={10} className="mt-0.5 shrink-0" />
            <span className="truncate">{order.deliveryAddress}</span>
          </div>

          {/* Items preview */}
          <div className="text-[11px] text-ink/60">
            {itemsPreview.map((item, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {item.productName} ×{item.quantity}
              </span>
            ))}
            {extraCount > 0 && <span className="text-ink/40"> +{extraCount} more</span>}
          </div>
        </div>

        {/* Right: amount + time */}
        <div className="shrink-0 text-right">
          <p className="font-bold text-ink">{fmtINR(order.grandTotal)}</p>
          <p className="text-[10px] text-ink/40">{fmtElapsed(order.createdAt)}</p>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-2">
        {/* Expand/collapse */}
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-semibold text-ink/50 hover:bg-mist hover:text-ink"
        >
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          View
        </button>

        {/* Print */}
        <button
          type="button"
          onClick={() => printOrder(order)}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-semibold text-ink/50 hover:bg-mist hover:text-ink"
        >
          <Printer size={10} />
          Print
        </button>

        {/* Accept (pending) */}
        {order.status === 'pending' && (
          <>
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={busy === 'accept'}
              className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'accept' ? <Spinner size="sm" /> : <Check size={10} />}
              Accept
            </button>
            <button
              type="button"
              onClick={() => setShowReject(r => !r)}
              className="flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
            >
              <X size={10} />
              Reject
            </button>
          </>
        )}

        {/* Mark ready (preparing) */}
        {order.status === 'preparing' && (
          <button
            type="button"
            onClick={() => void handleDispatch()}
            disabled={busy === 'dispatch'}
            className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === 'dispatch' ? <Spinner size="sm" /> : <Check size={10} />}
            Mark Ready
          </button>
        )}

        {/* Dispatch (ready) */}
        {order.status === 'ready' && (
          <button
            type="button"
            onClick={() => void handleDispatch()}
            disabled={busy === 'dispatch'}
            className="flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {busy === 'dispatch' ? <Spinner size="sm" /> : <ShoppingBag size={10} />}
            Dispatch
          </button>
        )}
      </div>

      {/* Reject form */}
      {showReject && (
        <div className="border-t border-border/60 px-3 pb-3">
          <RejectForm
            onConfirm={r => void handleReject(r)}
            onCancel={() => setShowReject(false)}
            busy={busy === 'reject'}
          />
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/60 px-3 py-3 space-y-3">
          {/* Customer */}
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Customer</p>
            <p className="text-xs font-medium text-ink">{order.customerName}</p>
            <p className="text-[11px] text-ink/60">{order.customerPhone}</p>
            <p className="text-[11px] text-ink/60">{order.deliveryAddress}</p>
          </div>

          {/* All items */}
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Items</p>
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-ink/80">{item.productName} <span className="text-ink/40">×{item.quantity}</span></span>
                <span className="font-medium text-ink">{fmtINR(item.total)}</span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="border-t border-border/60 pt-2 space-y-0.5">
            {order.deliveryFee > 0 && (
              <div className="flex items-center justify-between text-[11px] text-ink/50">
                <span>Delivery fee</span>
                <span>{fmtINR(order.deliveryFee)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs font-bold text-ink">
              <span>Grand Total</span>
              <span>{fmtINR(order.grandTotal)}</span>
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <p className="text-[11px] italic text-ink/50">Note: {order.notes}</p>
          )}

          {/* Platform order ID */}
          <p className="font-mono text-[10px] text-ink/30">ID: {order.platformOrderId}</p>
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: SubTab }) {
  const msgs: Record<SubTab, string> = {
    pending: 'No orders awaiting acceptance',
    kitchen: 'No orders currently in kitchen',
    ready:   'No orders ready for pickup',
    delayed: 'No delayed orders',
    all:     "Today's delivery orders will appear here",
  };
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <ShoppingBag size={28} className="mb-2 text-ink/20" />
      <p className="text-xs font-semibold text-ink/40">{msgs[tab]}</p>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function OnlineOrdersPanel() {
  const [orders,  setOrders]  = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [subTab,  setSubTab]  = useState<SubTab>('pending');
  const { toasts, add: toast } = useToasts();
  const { socket } = useSocket();

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

  // Live updates via socket
  useEffect(() => {
    if (!socket) return;
    const handler = (order: OnlineOrder) => {
      setOrders(prev => {
        if (prev.some(o => o._id === order._id)) return prev;
        return [order, ...prev];
      });
      toast('success', `New ${order.orderSource.toUpperCase()} order: ${order.orderNumber}`);
    };
    socket.on('new_delivery_order', handler);
    return () => { socket.off('new_delivery_order', handler); };
  }, [socket, toast]);

  function updateOrder(id: string, status: OnlineOrder['status']) {
    setOrders(prev => prev.map(o => o._id === id ? { ...o, status } : o));
  }

  const visible = filterByTab(orders, subTab);

  // Badge counts for tabs
  function tabCount(tab: SubTab) {
    const filtered = filterByTab(orders, tab);
    if (tab === 'all') return 0; // don't badge "all"
    return filtered.length;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tab bar */}
      <div className="shrink-0 overflow-x-auto border-b border-border pb-0">
        <div className="flex gap-0.5 px-1 pt-1 pb-1">
          {SUB_TABS.map(t => {
            const count = tabCount(t.key);
            const active = subTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSubTab(t.key)}
                className={`relative shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-brand text-white'
                    : 'text-ink/60 hover:bg-mist hover:text-ink'
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
                    active ? 'bg-white text-brand' : 'bg-amber-400 text-white'
                  }`}>
                    {count}
                  </span>
                )}
                {t.key === 'delayed' && count > 0 && (
                  <AlertCircle size={10} className={active ? 'text-white' : 'text-amber-500'} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-[11px] text-ink/40">
          {visible.length} order{visible.length !== 1 ? 's' : ''}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] font-semibold text-ink/50 hover:bg-mist hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            <AlertCircle size={13} />
            {error}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState tab={subTab} />
        ) : (
          <div className="space-y-2">
            {visible.map(order => (
              <OrderCompactCard
                key={order._id}
                order={order}
                onStatusChange={updateOrder}
                onToast={toast}
              />
            ))}
          </div>
        )}
      </div>

      <ToastList toasts={toasts} />
    </div>
  );
}
