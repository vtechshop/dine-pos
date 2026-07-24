import { useState, useEffect, useCallback, memo } from 'react';
import { RefreshCw, ChefHat, Clock, Check, X, Truck, MapPin, Flame, Moon, Sun, AlertTriangle } from 'lucide-react';
import type { KDSOrder } from '../types';
import { fetchKitchenOrders, updateOrderStatus } from '../api/orders';
import { acceptDeliveryOrder, rejectDeliveryOrder, dispatchDeliveryOrder } from '../api/aggregator';
import { Spinner } from '../components/ui/Spinner';
import { useSocket } from '../context/SocketContext';

const AGGREGATOR_SOURCES = new Set(['swiggy', 'zomato']);

// ── Elapsed ───────────────────────────────────────────────────────────────────

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

function elapsedSeconds(createdAt: string, now: number): number {
  return Math.floor((now - new Date(createdAt).getTime()) / 1_000);
}

// ── Allergen detection ────────────────────────────────────────────────────────

const ALLERGEN_KEYWORDS = /allerg|gluten|nut|dairy|vegan|no\s+\w|without|less\s+spice|extra\s+spice|no\s+onion|no\s+garlic/i;

function isAllergenNote(note: string): boolean {
  return ALLERGEN_KEYWORDS.test(note);
}

// ── Platform badge ────────────────────────────────────────────────────────────

function PlatformBadge({ source }: { source: string }) {
  if (source === 'swiggy')
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black tracking-wide text-white">S SWIGGY</span>;
  if (source === 'zomato')
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black tracking-wide text-white">Z ZOMATO</span>;
  return null;
}

// ── Reject form ───────────────────────────────────────────────────────────────

function RejectForm({ onConfirm, onCancel, loading }: { onConfirm(r: string): void; onCancel(): void; loading: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-2">
      <select value={reason} onChange={e => setReason(e.target.value)} className="ds-input text-xs">
        <option value="">Select reason…</option>
        <option value="Item unavailable">Item unavailable</option>
        <option value="Store closed">Store closed</option>
        <option value="Too busy">Too busy right now</option>
        <option value="Delivery area not serviceable">Delivery area not serviceable</option>
        <option value="Other">Other</option>
      </select>
      <div className="flex gap-2">
        <button onClick={() => reason && onConfirm(reason)} disabled={!reason || loading} className="btn btn-md btn-danger flex-1">
          {loading ? 'Rejecting…' : 'Confirm Reject'}
        </button>
        <button onClick={onCancel} className="btn btn-md btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

// ── Order card ────────────────────────────────────────────────────────────────

interface KDSOrderExtended extends KDSOrder {
  orderSource?: string;
  platformOrderId?: string;
  deliveryAddress?: string;
  acceptedAt?: string | null;
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

const OrderCard = memo(function OrderCard({ order, now, onAction, onAccept, onReject, onDispatch, acting }: OrderCardProps) {
  const [showReject, setShowReject] = useState(false);
  const [rejecting,  setRejecting]  = useState(false);

  const isAggregator    = AGGREGATOR_SOURCES.has(order.orderSource ?? '');
  const isPending       = order.status === 'pending';
  const isPreparing     = order.status === 'preparing';
  const isReady         = order.status === 'ready';
  const ageSecs         = elapsedSeconds(order.createdAt, now);
  const ageMinutes      = elapsedMinutes(order.createdAt, now);
  const isFire          = ageSecs < 90;  // brand new order — show FIRE
  const isDelayed       = ageMinutes >= 20;
  const isCritical      = ageMinutes >= 30;
  const needsAcceptance = isAggregator && isPending && !order.acceptedAt;
  const hasAllergen     = order.notes ? isAllergenNote(order.notes) : false;

  const cardBorder = isCritical    ? 'border-[#DC2626]'
    : isDelayed                    ? 'border-amber-400'
    : isAggregator && order.orderSource === 'swiggy' ? 'border-orange-400'
    : isAggregator && order.orderSource === 'zomato' ? 'border-red-400'
    : isPending     ? 'border-amber-300'
    : isPreparing   ? 'border-blue-400'
    : 'border-green-400';

  const cardBg = isCritical ? 'bg-[#DC2626]/5' : '';

  return (
    <div className={`flex flex-col rounded-xl border-2 ${cardBorder} ${cardBg} overflow-hidden ${isCritical ? 'animate-pulse' : ''}`}
         style={{ animationDuration: '2s' }}>

      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 ${
        isAggregator && order.orderSource === 'swiggy' ? 'bg-orange-500/15'
        : isAggregator && order.orderSource === 'zomato' ? 'bg-red-500/15'
        : isCritical ? 'bg-[#DC2626]/10'
        : isPending ? 'bg-amber-400/15'
        : 'bg-blue-400/15'
      }`}>
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-mono text-sm font-bold text-ink shrink-0">#{order.orderNumber}</span>
          {isAggregator ? <PlatformBadge source={order.orderSource!} /> : null}
          {!isAggregator && order.isParcel && (
            <span className="badge badge-brand text-[10px] shrink-0">Parcel</span>
          )}
          {isFire && isPending && (
            <span className="flex items-center gap-0.5 rounded-full bg-brand px-2 py-0.5 text-[10px] font-black text-white shrink-0 animate-ping-once">
              <Flame size={9} />FIRE
            </span>
          )}
          {isCritical && (
            <span className="flex items-center gap-0.5 rounded-full bg-[#DC2626] px-2 py-0.5 text-[10px] font-black text-white shrink-0">
              CRITICAL
            </span>
          )}
          {isDelayed && !isCritical && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 shrink-0">
              DELAYED
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1 text-xs shrink-0 font-semibold tabular-nums ${
          isCritical ? 'text-[#DC2626]' : isDelayed ? 'text-amber-600' : 'text-ink/50'
        }`}>
          <Clock size={11} />
          {elapsed(order.createdAt, now)}
        </div>
      </div>

      {/* Customer / address */}
      <div className="border-b border-ink/10 px-4 py-2">
        <p className="text-xs font-semibold text-ink">
          {isAggregator ? (
            <><Truck size={10} className="mr-1 inline text-ink/40" />{order.customerName || 'Online Customer'}</>
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
      <ul className="flex-1 space-y-2 px-4 py-3">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/20 text-xs font-black text-brand">
              {item.quantity}
            </span>
            <span className="text-sm font-medium text-ink">{item.productName}</span>
          </li>
        ))}
      </ul>

      {/* Allergen / notes strip */}
      {order.notes && (
        <div className={`border-t px-4 py-2 flex items-start gap-2 ${
          hasAllergen
            ? 'border-amber-300 bg-amber-50/70'
            : 'border-ink/10 bg-ink/[.03]'
        }`}>
          {hasAllergen && <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />}
          <p className={`text-xs leading-snug ${hasAllergen ? 'font-semibold text-amber-800' : 'italic text-ink/50'}`}>
            {order.notes}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-ink/10 px-4 py-3 space-y-2">
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
            {needsAcceptance && (
              <div className="flex gap-2">
                <button
                  onClick={() => onAccept(order._id, order.platformOrderId ?? '', order.orderSource ?? '')}
                  disabled={acting}
                  className="btn flex-1 h-[46px] rounded-xl bg-green-600 text-sm font-black text-white hover:bg-green-700 disabled:opacity-50 gap-1.5"
                >
                  <Check size={14} /> Accept
                </button>
                <button
                  onClick={() => setShowReject(true)}
                  disabled={acting}
                  className="btn h-[46px] rounded-xl bg-[#DC2626] px-4 text-sm font-black text-white hover:bg-[#B91C1C] disabled:opacity-50 gap-1.5"
                >
                  <X size={14} /> Reject
                </button>
              </div>
            )}

            {isPending && !needsAcceptance && (
              <button
                onClick={() => onAction(order._id, 'preparing')}
                disabled={acting}
                className="btn w-full h-[46px] rounded-xl bg-amber-500 text-sm font-black text-white hover:bg-amber-600 disabled:opacity-50"
              >
                🔥 Start Preparing
              </button>
            )}

            {isPreparing && (
              <button
                onClick={() => onAction(order._id, 'ready')}
                disabled={acting}
                className="btn w-full h-[46px] rounded-xl bg-blue-600 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
              >
                ✓ Mark Ready
              </button>
            )}

            {isReady && isAggregator && (
              <button
                onClick={() => onDispatch(order._id, order.platformOrderId ?? '', order.orderSource ?? '')}
                disabled={acting}
                className="btn w-full h-[46px] rounded-xl bg-purple-600 text-sm font-black text-white hover:bg-purple-700 disabled:opacity-50 gap-1.5"
              >
                <Truck size={14} /> Mark Dispatched
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// ── Dark mode CSS variable override ───────────────────────────────────────────

const DARK_VARS: React.CSSProperties = {
  '--ink':     '245 237 229',
  '--canvas':  '18 12 8',
  '--surface': '28 20 14',
  '--mist':    '36 26 18',
  '--border':  '55 38 28',
} as React.CSSProperties;

// ── Page ──────────────────────────────────────────────────────────────────────

export function KitchenPage() {
  const { socket } = useSocket();
  const [orders,        setOrders]        = useState<KDSOrderExtended[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [acting,        setActing]        = useState(false);
  const [now,           setNow]           = useState(() => Date.now());
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [darkMode,      setDarkMode]      = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrders(await fetchKitchenOrders() as KDSOrderExtended[]);
      setLastRefreshed(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load kitchen orders');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => { void load(); };
    socket.on('new_order',            handler);
    socket.on('new_delivery_order',   handler);
    socket.on('order_status_updated', handler);
    return () => {
      socket.off('new_order',            handler);
      socket.off('new_delivery_order',   handler);
      socket.off('order_status_updated', handler);
    };
  }, [socket, load]);

  const handleAction  = useCallback(async (orderId: string, newStatus: string) => {
    setActing(true);
    try { await updateOrderStatus(orderId, newStatus); void load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to update'); }
    finally { setActing(false); }
  }, [load]);

  const handleAccept  = useCallback(async (orderId: string) => {
    setActing(true);
    try { await acceptDeliveryOrder(orderId); await updateOrderStatus(orderId, 'preparing'); void load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to accept'); }
    finally { setActing(false); }
  }, [load]);

  const handleReject  = useCallback(async (orderId: string, _pid: string, _src: string, reason: string) => {
    setActing(true);
    try { await rejectDeliveryOrder(orderId, reason); void load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to reject'); }
    finally { setActing(false); }
  }, [load]);

  const handleDispatch = useCallback(async (orderId: string) => {
    setActing(true);
    try { await dispatchDeliveryOrder(orderId); await updateOrderStatus(orderId, 'served'); void load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to dispatch'); }
    finally { setActing(false); }
  }, [load]);

  const pending   = orders.filter(o => o.status === 'pending');
  const preparing = orders.filter(o => o.status === 'preparing');
  const ready     = orders.filter(o => o.status === 'ready');

  const swiggyCount = orders.filter(o => o.orderSource === 'swiggy' && o.status !== 'ready').length;
  const zomatoCount = orders.filter(o => o.orderSource === 'zomato' && o.status !== 'ready').length;

  const refreshedLabel = lastRefreshed
    ? `${Math.round((now - lastRefreshed) / 1_000)}s ago`
    : 'Loading…';

  const COLS = [
    { id: 'pending',   label: 'Pending',   dot: 'bg-amber-400', orders: pending },
    { id: 'preparing', label: 'Preparing', dot: 'bg-blue-500',  orders: preparing },
    { id: 'ready',     label: 'Ready',     dot: 'bg-green-500', orders: ready },
  ] as const;

  return (
    <div
      className="flex h-full flex-col bg-canvas text-ink transition-colors"
      style={darkMode ? DARK_VARS : {}}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-5 py-2.5">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <ChefHat size={18} className="text-brand shrink-0" />
          <h1 className="text-sm font-bold text-ink">Kitchen Display</h1>
          <span className="flex items-center gap-1 text-xs text-ink/40">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Live · {refreshedLabel}
          </span>
          {swiggyCount > 0 && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">{swiggyCount} Swiggy</span>}
          {zomatoCount > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">{zomatoCount} Zomato</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDarkMode(d => !d)}
            className="btn btn-sm btn-ghost"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={() => void load()} disabled={loading} className="btn btn-sm btn-ghost">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-error/25 bg-error/5 px-4 py-2.5 text-sm text-error">
          <AlertTriangle size={14} />{error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <ChefHat size={48} className="text-ink/15" />
          <p className="text-sm font-semibold text-ink/40">Kitchen is clear</p>
          <p className="text-xs text-ink/25">No pending or active orders</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-5 lg:grid-cols-3">
            {COLS.map(col => (
              <div key={col.id}>
                <div className="mb-3 flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                  <h2 className="text-xs font-bold uppercase tracking-[.07em] text-ink/50">
                    {col.label}
                  </h2>
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-bold text-ink/50">
                    {col.orders.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {col.orders.length === 0 ? (
                    <p className="text-xs text-ink/25">No {col.label.toLowerCase()} orders</p>
                  ) : (
                    col.orders.map(o => (
                      <OrderCard
                        key={o._id}
                        order={o}
                        now={now}
                        onAction={handleAction}
                        onAccept={(id, pid, src) => handleAccept(id)}
                        onReject={handleReject}
                        onDispatch={(id, pid, src) => handleDispatch(id)}
                        acting={acting}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
