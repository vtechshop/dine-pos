import { useState, useEffect, useCallback, memo } from 'react';
import { RefreshCw, ChefHat, Clock, Check, X, Truck, MapPin } from 'lucide-react';
import type { KDSOrder } from '../types';
import { fetchKitchenOrders, updateOrderStatus } from '../api/orders';
import { acceptDeliveryOrder, rejectDeliveryOrder, dispatchDeliveryOrder } from '../api/aggregator';
import { Spinner } from '../components/ui/Spinner';
import { useSocket } from '../context/SocketContext';

// Aggregator platforms we render differently
const AGGREGATOR_SOURCES = new Set(['swiggy', 'zomato']);

function elapsed(createdAt: string, now: number): string {
  const secs = Math.floor((now - new Date(createdAt).getTime()) / 1000);
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function elapsedMinutes(createdAt: string, now: number): number {
  return Math.floor((now - new Date(createdAt).getTime()) / 60_000);
}

// ── Platform badge ────────────────────────────────────────────────────────────

function PlatformBadge({ source }: { source: string }) {
  if (source === 'swiggy') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black tracking-wide text-white">
        S SWIGGY
      </span>
    );
  }
  if (source === 'zomato') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black tracking-wide text-white">
        Z ZOMATO
      </span>
    );
  }
  return null;
}

// ── Reject reason inline form ─────────────────────────────────────────────────

function RejectForm({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-2">
      <select
        value={reason}
        onChange={e => setReason(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none"
      >
        <option value="">Select reason…</option>
        <option value="Item unavailable">Item unavailable</option>
        <option value="Store closed">Store closed</option>
        <option value="Too busy">Too busy right now</option>
        <option value="Delivery area not serviceable">Delivery area not serviceable</option>
        <option value="Other">Other</option>
      </select>
      <div className="flex gap-2">
        <button
          onClick={() => reason && onConfirm(reason)}
          disabled={!reason || loading}
          className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Rejecting…' : 'Confirm Reject'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-ink/60 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────

interface KDSOrderExtended extends KDSOrder {
  orderSource?: string;
  platformOrderId?: string;
  deliveryAddress?:  string;
  acceptedAt?:       string | null;
}

interface OrderCardProps {
  order: KDSOrderExtended;
  now: number;
  onAction(id: string, status: string): void;
  onAccept(id: string, platformOrderId: string, source: string): void;
  onReject(id: string, platformOrderId: string, source: string, reason: string): void;
  onDispatch(id: string, platformOrderId: string, source: string): void;
  acting: boolean;
}

const OrderCard = memo(function OrderCard({
  order,
  now,
  onAction,
  onAccept,
  onReject,
  onDispatch,
  acting,
}: OrderCardProps) {
  const [showReject, setShowReject] = useState(false);
  const [rejecting,  setRejecting]  = useState(false);

  const isAggregator = AGGREGATOR_SOURCES.has(order.orderSource ?? '');
  const isPending    = order.status === 'pending';
  const isPreparing  = order.status === 'preparing';
  const isReady      = order.status === 'ready';
  const ageMinutes   = elapsedMinutes(order.createdAt, now);
  const isDelayed    = ageMinutes >= 20;

  // Aggregator pending = not yet accepted by kitchen
  const needsAcceptance = isAggregator && isPending && !order.acceptedAt;

  const borderClass = isAggregator
    ? order.orderSource === 'swiggy'
      ? 'border-orange-400 bg-orange-50/30'
      : 'border-red-400 bg-red-50/30'
    : isPending
      ? 'border-amber-300 bg-amber-50/40'
      : 'border-blue-300 bg-blue-50/40';

  const headerClass = isAggregator
    ? order.orderSource === 'swiggy'
      ? 'bg-orange-100/60'
      : 'bg-red-100/60'
    : isPending
      ? 'bg-amber-400/20'
      : 'bg-blue-400/20';

  return (
    <div className={`flex flex-col rounded-xl border-2 ${borderClass} overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 ${headerClass}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm font-bold text-ink shrink-0">#{order.orderNumber}</span>
          {isAggregator && <PlatformBadge source={order.orderSource!} />}
          {!isAggregator && order.isParcel && (
            <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand shrink-0">
              Parcel
            </span>
          )}
          {isDelayed && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600 shrink-0">
              DELAYED
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-ink/50 shrink-0">
          <Clock size={11} />
          {elapsed(order.createdAt, now)}
        </div>
      </div>

      {/* Customer / delivery address */}
      <div className="border-b border-black/10 px-4 py-2">
        <p className="text-xs font-semibold text-ink">
          {isAggregator ? (
            <>
              <Truck size={10} className="mr-1 inline text-ink/40" />
              {order.customerName || 'Online Customer'}
            </>
          ) : (
            <>Table {order.tableNumber}{order.customerName && <span className="ml-1.5 font-normal text-ink/40">· {order.customerName}</span>}</>
          )}
        </p>
        {isAggregator && order.deliveryAddress && (
          <p className="mt-0.5 flex items-start gap-1 text-[11px] text-ink/40 leading-tight">
            <MapPin size={9} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{order.deliveryAddress}</span>
          </p>
        )}
      </div>

      {/* Items */}
      <ul className="flex-1 space-y-1.5 px-4 py-3">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-baseline gap-2 text-sm text-ink">
            <span className="w-5 shrink-0 text-right font-bold text-brand">{item.quantity}×</span>
            <span>{item.productName}</span>
          </li>
        ))}
      </ul>

      {order.notes && (
        <div className="border-t border-black/10 px-4 py-2">
          <p className="text-xs italic text-ink/50">{order.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-black/10 px-4 py-3 space-y-2">
        {showReject ? (
          <RejectForm
            loading={rejecting}
            onConfirm={async reason => {
              setRejecting(true);
              await onReject(order._id, order.platformOrderId ?? '', order.orderSource ?? '', reason);
              setRejecting(false);
              setShowReject(false);
            }}
            onCancel={() => setShowReject(false)}
          />
        ) : (
          <>
            {/* Aggregator: needs acceptance first */}
            {needsAcceptance && (
              <div className="flex gap-2">
                <button
                  onClick={() => onAccept(order._id, order.platformOrderId ?? '', order.orderSource ?? '')}
                  disabled={acting}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                >
                  <Check size={12} /> Accept
                </button>
                <button
                  onClick={() => setShowReject(true)}
                  disabled={acting}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  <X size={12} /> Reject
                </button>
              </div>
            )}

            {/* Regular pending OR aggregator already accepted */}
            {isPending && !needsAcceptance && (
              <button
                onClick={() => onAction(order._id, 'preparing')}
                disabled={acting}
                className="w-full rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
              >
                Start Preparing
              </button>
            )}

            {/* Preparing → Ready */}
            {isPreparing && (
              <button
                onClick={() => onAction(order._id, 'ready')}
                disabled={acting}
                className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                Mark Ready
              </button>
            )}

            {/* Ready → Dispatched (aggregator only) */}
            {isReady && isAggregator && (
              <button
                onClick={() => onDispatch(order._id, order.platformOrderId ?? '', order.orderSource ?? '')}
                disabled={acting}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
              >
                <Truck size={12} /> Mark Dispatched
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// ── Page ──────────────────────────────────────────────────────────────────────

export function KitchenPage() {
  const { socket } = useSocket();
  const [orders,        setOrders]        = useState<KDSOrderExtended[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [acting,        setActing]        = useState(false);
  const [now,           setNow]           = useState(() => Date.now());
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrders(await fetchKitchenOrders() as KDSOrderExtended[]);
      setLastRefreshed(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load kitchen orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => { void load(); };
    socket.on('new_order',           handler);
    socket.on('new_delivery_order',  handler);
    socket.on('order_status_updated', handler);
    return () => {
      socket.off('new_order',           handler);
      socket.off('new_delivery_order',  handler);
      socket.off('order_status_updated', handler);
    };
  }, [socket, load]);

  const handleAction = useCallback(async (orderId: string, newStatus: string) => {
    setActing(true);
    try {
      await updateOrderStatus(orderId, newStatus);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update order status');
    } finally {
      setActing(false);
    }
  }, [load]);

  const handleAccept = useCallback(async (orderId: string, platformOrderId: string, _source: string) => {
    setActing(true);
    try {
      await acceptDeliveryOrder(orderId);
      await updateOrderStatus(orderId, 'preparing');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept order');
    } finally {
      setActing(false);
    }
  }, [load]);

  const handleReject = useCallback(async (orderId: string, _platformOrderId: string, _source: string, reason: string) => {
    setActing(true);
    try {
      await rejectDeliveryOrder(orderId, reason);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject order');
    } finally {
      setActing(false);
    }
  }, [load]);

  const handleDispatch = useCallback(async (orderId: string, _platformOrderId: string, _source: string) => {
    setActing(true);
    try {
      await dispatchDeliveryOrder(orderId);
      await updateOrderStatus(orderId, 'served');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to dispatch order');
    } finally {
      setActing(false);
    }
  }, [load]);

  const pending   = orders.filter(o => o.status === 'pending');
  const preparing = orders.filter(o => o.status === 'preparing');
  const ready     = orders.filter(o => o.status === 'ready');

  const swiggyCount = orders.filter(o => o.orderSource === 'swiggy' && (o.status === 'pending' || o.status === 'preparing')).length;
  const zomatoCount = orders.filter(o => o.orderSource === 'zomato' && (o.status === 'pending' || o.status === 'preparing')).length;

  const refreshedLabel = lastRefreshed
    ? `Updated ${Math.round((now - lastRefreshed) / 1000)}s ago`
    : 'Loading…';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <ChefHat size={18} className="text-brand shrink-0" />
          <h1 className="text-base font-semibold text-ink">Kitchen Display</h1>
          <span className="flex items-center gap-1 text-xs text-ink/40">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            Live · {refreshedLabel}
          </span>
          {/* Aggregator counters */}
          {swiggyCount > 0 && (
            <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
              {swiggyCount} Swiggy
            </span>
          )}
          {zomatoCount > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
              {zomatoCount} Zomato
            </span>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh kitchen orders"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
          {error}
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center text-center text-ink/30">
          <ChefHat size={48} className="mb-3 opacity-15" />
          <p className="text-sm font-medium">Kitchen is clear</p>
          <p className="mt-1 text-xs">No pending or active orders</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Pending column */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-ink/50">
                  Pending ({pending.length})
                </h2>
              </div>
              <div className="space-y-3">
                {pending.length === 0 ? (
                  <p className="text-xs text-ink/25">No pending orders</p>
                ) : (
                  pending.map(o => (
                    <OrderCard
                      key={o._id}
                      order={o}
                      now={now}
                      onAction={handleAction}
                      onAccept={handleAccept}
                      onReject={handleReject}
                      onDispatch={handleDispatch}
                      acting={acting}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Preparing column */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-ink/50">
                  Preparing ({preparing.length})
                </h2>
              </div>
              <div className="space-y-3">
                {preparing.length === 0 ? (
                  <p className="text-xs text-ink/25">No orders in progress</p>
                ) : (
                  preparing.map(o => (
                    <OrderCard
                      key={o._id}
                      order={o}
                      now={now}
                      onAction={handleAction}
                      onAccept={handleAccept}
                      onReject={handleReject}
                      onDispatch={handleDispatch}
                      acting={acting}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Ready column */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-ink/50">
                  Ready ({ready.length})
                </h2>
              </div>
              <div className="space-y-3">
                {ready.length === 0 ? (
                  <p className="text-xs text-ink/25">No orders ready</p>
                ) : (
                  ready.map(o => (
                    <OrderCard
                      key={o._id}
                      order={o}
                      now={now}
                      onAction={handleAction}
                      onAccept={handleAccept}
                      onReject={handleReject}
                      onDispatch={handleDispatch}
                      acting={acting}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
