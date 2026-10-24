import { createContext, useContext, useEffect, useReducer, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { LiveOrder, LiveOrderItem } from '../types';
import { useSocket } from './SocketContext';
import { apiFetch } from '../api/client';

function playNewOrderBeep() {
  try {
    const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx() as AudioContext;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    // audio not available — do not break order processing
  }
}

interface LiveOrdersContextType {
  orders: LiveOrder[];
  unreadCount: number;
  markRead(): void;
}

const LiveOrdersContext = createContext<LiveOrdersContextType | null>(null);

type Action =
  | { type: 'ADD'; order: LiveOrder }
  | { type: 'MARK_OLD'; id: string }
  | { type: 'MARK_READ' }
  | { type: 'SEED'; orders: LiveOrder[] }
  | { type: 'REMOVE'; id?: string; tableNumber?: string };

// Live Orders lists active orders only — paid / cancelled ones drop off.
const FINISHED_STATUSES = new Set(['completed', 'cancelled', 'rejected']);

function isFinished(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const o = ('order' in raw ? (raw as { order: unknown }).order : raw) as Record<string, unknown> | null;
  return !!o && FINISHED_STATUSES.has(String(o.status ?? ''));
}

interface State {
  orders: LiveOrder[];
  unreadCount: number;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD':
      return {
        orders:       [action.order, ...state.orders].slice(0, 50),
        unreadCount:  state.unreadCount + 1,
      };
    case 'MARK_OLD':
      return {
        ...state,
        orders: state.orders.map(o =>
          o.id === action.id ? { ...o, isNew: false } : o,
        ),
      };
    case 'MARK_READ':
      return { ...state, unreadCount: 0 };
    case 'SEED': {
      const existingIds = new Set(state.orders.map(o => o.id));
      const fresh = action.orders
        .filter(o => !existingIds.has(o.id))
        .map(o => ({ ...o, isNew: false }));
      if (fresh.length === 0) return state;
      return {
        ...state,
        orders: [...state.orders, ...fresh].slice(0, 50),
      };
    }
    case 'REMOVE': {
      const orders = state.orders.filter(o =>
        !(action.id && o.id === action.id) &&
        !(action.tableNumber && o.tableNumber === action.tableNumber),
      );
      if (orders.length === state.orders.length) return state;
      // Unread can't exceed what's still listed (bell badge follows the panel).
      return { orders, unreadCount: Math.min(state.unreadCount, orders.length) };
    }
  }
}

// Safely extracts an order from whatever shape the backend emits.
// Backend emits new_order as the raw order document (flat, not wrapped).
function parseOrderEvent(data: unknown): LiveOrder | null {
  const raw = (data && typeof data === 'object' && 'order' in data)
    ? (data as { order: unknown }).order
    : data;

  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const items: LiveOrderItem[] = Array.isArray(o.items)
    ? (o.items as Record<string, unknown>[]).map(i => ({
        productName: String(i.productName ?? ''),
        quantity:    Number(i.quantity ?? 1),
        price:       typeof i.price === 'number' ? i.price : undefined,
      }))
    : [];

  return {
    id:            String(o._id ?? Date.now()),
    orderNumber:   String(o.orderNumber ?? ''),
    tableNumber:   String(o.tableNumber ?? ''),
    guestLabel:    o.customerName ? String(o.customerName) : undefined,
    customerPhone: o.customerPhone ? String(o.customerPhone) : undefined,
    items,
    totalAmount:   typeof o.grandTotal === 'number'
      ? o.grandTotal
      : typeof o.totalAmount === 'number'
      ? o.totalAmount
      : undefined,
    orderSource: o.orderSource ? String(o.orderSource) : undefined,
    timestamp:   String(o.createdAt ?? new Date().toISOString()),
    isNew:       true,
  };
}

export function LiveOrdersProvider({ children }: { children: ReactNode }) {
  const { socket, reconnectCount } = useSocket();
  const [state, dispatch] = useReducer(reducer, { orders: [], unreadCount: 0 });
  // M-7: Track all in-flight fade timers so they can be cleared on unmount.
  // The previous code returned clearTimeout from inside the socket event handler —
  // that return value is ignored by Socket.IO, so timers leaked on unmount.
  const fadeTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Tracks order IDs that have already triggered an audio beep so reconnect
  // back-fill (SEED) and any duplicate socket events don't double-beep.
  const beepedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!socket) return;

    const handler = (data: unknown) => {
      if (isFinished(data)) return; // e.g. kiosk order that arrives already paid
      const order = parseOrderEvent(data);
      if (!order) return;

      dispatch({ type: 'ADD', order });

      // Play beep once per unique order — not on SEED / reconnect back-fill
      if (!beepedIds.current.has(order.id)) {
        beepedIds.current.add(order.id);
        playNewOrderBeep();
      }

      // Highlight fades after 6 seconds
      const t = setTimeout(() => {
        dispatch({ type: 'MARK_OLD', id: order.id });
        fadeTimers.current.delete(t);
      }, 6_000);
      fadeTimers.current.add(t);
    };

    // Drop orders once they're paid, cancelled or their table's bill is closed.
    const idOf = (d: Record<string, unknown>) => String(d.orderId ?? d._id ?? '');
    const onCompleted = (d: Record<string, unknown>) => dispatch({ type: 'REMOVE', id: idOf(d) });
    const onStatus = (d: Record<string, unknown>) => {
      if (FINISHED_STATUSES.has(String(d.status ?? ''))) dispatch({ type: 'REMOVE', id: idOf(d) });
    };
    const onRejected = (d: Record<string, unknown>) => dispatch({ type: 'REMOVE', id: idOf(d) });
    const onSessionClosed = (d: Record<string, unknown>) => {
      if (d.tableNumber) dispatch({ type: 'REMOVE', tableNumber: String(d.tableNumber) });
    };

    socket.on('new_order', handler);
    socket.on('order_completed', onCompleted);
    socket.on('order_status_update', onStatus);
    socket.on('order_status_change', onStatus);
    socket.on('order_rejected', onRejected);
    socket.on('session_closed', onSessionClosed);
    return () => {
      socket.off('new_order', handler);
      socket.off('order_completed', onCompleted);
      socket.off('order_status_update', onStatus);
      socket.off('order_status_change', onStatus);
      socket.off('order_rejected', onRejected);
      socket.off('session_closed', onSessionClosed);
      fadeTimers.current.forEach(t => clearTimeout(t));
      fadeTimers.current.clear();
    };
  }, [socket]);

  // F-04: on socket reconnect, back-fill orders that arrived during the gap.
  useEffect(() => {
    if (reconnectCount === 0) return;
    const today = new Date().toISOString().split('T')[0];
    apiFetch<{ orders: unknown[] }>(`/orders?date=${today}&limit=50`)
      .then(res => {
        const seeded = (res.orders ?? [])
          .filter(o => !isFinished(o))
          .map(parseOrderEvent)
          .filter((o): o is LiveOrder => o !== null);
        if (seeded.length > 0) dispatch({ type: 'SEED', orders: seeded });
      })
      .catch(() => {}); // non-critical — socket will deliver subsequent events
  }, [reconnectCount]);

  const markRead = useCallback(() => dispatch({ type: 'MARK_READ' }), []);

  const value = useMemo(
    () => ({ orders: state.orders, unreadCount: state.unreadCount, markRead }),
    [state.orders, state.unreadCount, markRead],
  );

  return (
    <LiveOrdersContext.Provider value={value}>
      {children}
    </LiveOrdersContext.Provider>
  );
}

export function useLiveOrders(): LiveOrdersContextType {
  const ctx = useContext(LiveOrdersContext);
  if (!ctx) throw new Error('useLiveOrders must be inside LiveOrdersProvider');
  return ctx;
}
