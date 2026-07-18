import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  type ReactNode,
} from 'react';
import type { CartEntry } from '../types/qr.ts';

interface CartState {
  items:      CartEntry[];
  totalItems: number;
  totalPrice: number;
}

type CartAction =
  | { type: 'ADD';    entry: Omit<CartEntry, 'quantity' | 'notes'>; quantity?: number; notes?: string }
  | { type: 'REMOVE'; productId: string }
  | { type: 'SET_QTY'; productId: string; quantity: number }
  | { type: 'CLEAR' };

function calcTotals(items: CartEntry[]) {
  return {
    totalItems: items.reduce((s, i) => s + i.quantity, 0),
    totalPrice: items.reduce((s, i) => s + i.price * i.quantity, 0),
  };
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD': {
      const existing = state.items.find((i) => i.productId === action.entry.productId);
      let next: CartEntry[];
      if (existing) {
        next = state.items.map((i) =>
          i.productId === action.entry.productId
            ? { ...i, quantity: i.quantity + (action.quantity ?? 1) }
            : i,
        );
      } else {
        next = [
          ...state.items,
          {
            ...action.entry,
            quantity: action.quantity ?? 1,
            notes:    action.notes ?? '',
          },
        ];
      }
      return { items: next, ...calcTotals(next) };
    }
    case 'REMOVE': {
      const next = state.items.filter((i) => i.productId !== action.productId);
      return { items: next, ...calcTotals(next) };
    }
    case 'SET_QTY': {
      let next: CartEntry[];
      if (action.quantity <= 0) {
        next = state.items.filter((i) => i.productId !== action.productId);
      } else {
        next = state.items.map((i) =>
          i.productId === action.productId ? { ...i, quantity: action.quantity } : i,
        );
      }
      return { items: next, ...calcTotals(next) };
    }
    case 'CLEAR':
      return { items: [], totalItems: 0, totalPrice: 0 };
    default:
      return state;
  }
}

interface CartContextValue extends CartState {
  addItem:    (entry: Omit<CartEntry, 'quantity' | 'notes'>, quantity?: number, notes?: string) => void;
  removeItem: (productId: string) => void;
  setQty:     (productId: string, quantity: number) => void;
  clearCart:  () => void;
  getQty:     (productId: string) => number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items:      [],
    totalItems: 0,
    totalPrice: 0,
  });

  const addItem = useCallback(
    (entry: Omit<CartEntry, 'quantity' | 'notes'>, quantity?: number, notes?: string) =>
      dispatch({ type: 'ADD', entry, quantity, notes }),
    [],
  );
  const removeItem = useCallback(
    (productId: string) => dispatch({ type: 'REMOVE', productId }),
    [],
  );
  const setQty = useCallback(
    (productId: string, quantity: number) => dispatch({ type: 'SET_QTY', productId, quantity }),
    [],
  );
  const clearCart = useCallback(() => dispatch({ type: 'CLEAR' }), []);
  const getQty = useCallback(
    (productId: string) =>
      state.items.find((i) => i.productId === productId)?.quantity ?? 0,
    [state.items],
  );

  return (
    <CartContext.Provider value={{ ...state, addItem, removeItem, setQty, clearCart, getQty }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
