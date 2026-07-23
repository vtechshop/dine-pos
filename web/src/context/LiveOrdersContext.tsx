import { createContext, useContext, useEffect, useReducer, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { LiveOrder, LiveOrderItem } from '../types';
import { useSocket } from './SocketContext';
import { apiFetch } from '../api/client';

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
  | { type: 'SEED'; orders: LiveOrder[] };

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
    id:          String(o._id ?? Date.now()),
    orderNumber: String(o.orderNumber ?? ''),
    tableNumber: String(o.tableNumber ?? ''),
    guestLabel:  o.customerName ? String(o.customerName) : undefined,
    items,
    totalAmount: typeof o.grandTotal === 'number'
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

  useEffect(() => {
    if (!socket) return;

    const handler = (data: unknown) => {
      const order = parseOrderEvent(data);
      if (!order) return;

      dispatch({ type: 'ADD', order });

      // Highlight fades after 6 seconds
      const t = setTimeout(() => {
        dispatch({ type: 'MARK_OLD', id: order.id });
        fadeTimers.current.delete(t);
      }, 6_000);
      fadeTimers.current.add(t);
    };

    socket.on('new_order', handler);
    return () => {
      socket.off('new_order', handler);
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
