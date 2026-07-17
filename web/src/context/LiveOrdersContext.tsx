import { createContext, useContext, useEffect, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { LiveOrder, LiveOrderItem } from '../types';
import { useSocket } from './SocketContext';

interface LiveOrdersContextType {
  orders: LiveOrder[];
  unreadCount: number;
  markRead(): void;
}

const LiveOrdersContext = createContext<LiveOrdersContextType | null>(null);

type Action =
  | { type: 'ADD'; order: LiveOrder }
  | { type: 'MARK_OLD'; id: string }
  | { type: 'MARK_READ' };

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
  const { socket } = useSocket();
  const [state, dispatch] = useReducer(reducer, { orders: [], unreadCount: 0 });

  useEffect(() => {
    if (!socket) return;

    const handler = (data: unknown) => {
      const order = parseOrderEvent(data);
      if (!order) return;

      dispatch({ type: 'ADD', order });

      // Highlight fades after 6 seconds
      const t = setTimeout(() => dispatch({ type: 'MARK_OLD', id: order.id }), 6_000);
      return () => clearTimeout(t);
    };

    socket.on('new_order', handler);
    return () => { socket.off('new_order', handler); };
  }, [socket]);

  const markRead = () => dispatch({ type: 'MARK_READ' });

  return (
    <LiveOrdersContext.Provider value={{ orders: state.orders, unreadCount: state.unreadCount, markRead }}>
      {children}
    </LiveOrdersContext.Provider>
  );
}

export function useLiveOrders(): LiveOrdersContextType {
  const ctx = useContext(LiveOrdersContext);
  if (!ctx) throw new Error('useLiveOrders must be inside LiveOrdersProvider');
  return ctx;
}
