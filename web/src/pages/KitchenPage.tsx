import { useState, useEffect, useCallback, memo } from 'react';
import { RefreshCw, ChefHat, Clock } from 'lucide-react';
import type { KDSOrder } from '../types';
import { fetchKitchenOrders, updateOrderStatus } from '../api/orders';
import { Spinner } from '../components/ui/Spinner';
import { useSocket } from '../context/SocketContext';

// ── Elapsed time (pure computation — no per-card timer) ───────────────────────

function elapsed(createdAt: string, now: number): string {
  const secs = Math.floor((now - new Date(createdAt).getTime()) / 1000);
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

// ── Order card ────────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: KDSOrder;
  now: number;
  onAction(id: string, status: string): void;
  acting: boolean;
}

const OrderCard = memo(function OrderCard({ order, now, onAction, acting }: OrderCardProps) {
  const isPending    = order.status === 'pending';
  const isPreparing  = order.status === 'preparing';

  const borderColor = isPending
    ? 'border-amber-300 bg-amber-50/40'
    : 'border-blue-300 bg-blue-50/40';

  return (
    <div className={`flex flex-col rounded-xl border-2 ${borderColor} overflow-hidden`}>
      {/* Card header */}
      <div className={`flex items-center justify-between px-4 py-2.5 ${isPending ? 'bg-amber-400/20' : 'bg-blue-400/20'}`}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-ink">#{order.orderNumber}</span>
          {order.isParcel && (
            <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
              Parcel
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-ink/50">
          <Clock size={11} />
          {elapsed(order.createdAt, now)}
        </div>
      </div>

      {/* Table / customer */}
      <div className="border-b border-current/10 px-4 py-2">
        <p className="text-xs font-semibold text-ink">
          Table {order.tableNumber}
          {order.customerName && <span className="ml-1.5 font-normal text-ink/40">· {order.customerName}</span>}
        </p>
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

      {/* Notes */}
      {order.notes && (
        <div className="border-t border-current/10 px-4 py-2">
          <p className="text-xs italic text-ink/50">{order.notes}</p>
        </div>
      )}

      {/* Action */}
      <div className="border-t border-current/10 px-4 py-3">
        {isPending && (
          <button
            onClick={() => onAction(order._id, 'preparing')}
            disabled={acting}
            className="w-full rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            Start Preparing
          </button>
        )}
        {isPreparing && (
          <button
            onClick={() => onAction(order._id, 'ready')}
            disabled={acting}
            className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Mark Ready
          </button>
        )}
      </div>
    </div>
  );
});

// ── Page ──────────────────────────────────────────────────────────────────────

export function KitchenPage() {
  const { socket } = useSocket();
  const [orders,       setOrders]       = useState<KDSOrder[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [acting,       setActing]       = useState(false);
  const [now,          setNow]          = useState(() => Date.now());
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);

  // Single shared 30-second clock tick for all order cards — replaces N per-card intervals
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrders(await fetchKitchenOrders());
      setLastRefreshed(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load kitchen orders');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + 20s polling fallback
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  // Real-time: reload immediately when socket fires a relevant event
  useEffect(() => {
    if (!socket) return;
    const handler = () => { void load(); };
    socket.on('new_order', handler);
    socket.on('order_status_updated', handler);
    return () => {
      socket.off('new_order', handler);
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

  const pending   = orders.filter(o => o.status === 'pending');
  const preparing = orders.filter(o => o.status === 'preparing');

  const refreshedLabel = lastRefreshed
    ? `Updated ${Math.round((now - lastRefreshed) / 1000)}s ago`
    : 'Loading…';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center gap-3">
          <ChefHat size={18} className="text-brand" />
          <h1 className="text-base font-semibold text-ink">Kitchen Display</h1>
          <span className="flex items-center gap-1 text-xs text-ink/40">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            Live · {refreshedLabel}
          </span>
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
          <div className="grid gap-5 lg:grid-cols-2">
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
                    <OrderCard key={o._id} order={o} now={now} onAction={handleAction} acting={acting} />
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
                    <OrderCard key={o._id} order={o} now={now} onAction={handleAction} acting={acting} />
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
