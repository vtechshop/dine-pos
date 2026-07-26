import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  type ReactNode,
} from 'react';
import type { CartEntry, SelectedModifier } from '../types/qr.ts';

// ── CartLineId dedup key ──────────────────────────────────────────────────────

function buildCartLineId(productId: string, variantId?: string, mods?: SelectedModifier[]): string {
  const base = `${productId}:${variantId || 'base'}`;
  if (!mods?.length) return base;
  const modKey = mods.map(m => m.modifierOptionId).sort().join('|');
  return `${base}:${modKey}`;
}

// ── State ─────────────────────────────────────────────────────────────────────

interface CartState {
  items:      CartEntry[];
  totalItems: number;
  totalPrice: number;
}

// Input for addItem — caller does not supply cartLineId (generated internally)
export type CartEntryInput = Omit<CartEntry, 'quantity' | 'notes' | 'cartLineId'>;

type CartAction =
  | { type: 'ADD';     entry: CartEntryInput; quantity?: number; notes?: string }
  | { type: 'REMOVE';  cartLineId: string }
  | { type: 'SET_QTY'; cartLineId: string; quantity: number }
  | { type: 'CLEAR' };

function calcTotals(items: CartEntry[]) {
  return {
    totalItems: items.reduce((s, i) => s + i.quantity, 0),
    totalPrice: items.reduce((s, i) => s + (i.price + i.modifierTotal) * i.quantity, 0),
  };
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD': {
      const cartLineId = buildCartLineId(
        action.entry.productId,
        action.entry.variantId,
        action.entry.selectedModifiers,
      );
      const existingIdx = state.items.findIndex(i => i.cartLineId === cartLineId);
      let next: CartEntry[];
      if (existingIdx >= 0) {
        next = state.items.map((i, idx) =>
          idx === existingIdx
            ? { ...i, quantity: i.quantity + (action.quantity ?? 1) }
            : i,
        );
      } else {
        next = [
          ...state.items,
          {
            ...action.entry,
            cartLineId,
            quantity: action.quantity ?? 1,
            notes:    action.notes ?? '',
          },
        ];
      }
      return { items: next, ...calcTotals(next) };
    }
    case 'REMOVE': {
      const next = state.items.filter(i => i.cartLineId !== action.cartLineId);
      return { items: next, ...calcTotals(next) };
    }
    case 'SET_QTY': {
      let next: CartEntry[];
      if (action.quantity <= 0) {
        next = state.items.filter(i => i.cartLineId !== action.cartLineId);
      } else {
        next = state.items.map(i =>
          i.cartLineId === action.cartLineId ? { ...i, quantity: action.quantity } : i,
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

// ── Context ───────────────────────────────────────────────────────────────────

interface CartContextValue extends CartState {
  addItem:    (entry: CartEntryInput, quantity?: number, notes?: string) => void;
  removeItem: (cartLineId: string) => void;
  setQty:     (cartLineId: string, quantity: number) => void;
  clearCart:  () => void;
  // Sum of all quantities for a given productId (across all modifier configs)
  getQty:     (productId: string) => number;
  // cartLineId for a simple product (no modifiers/variants) — shorthand
  simpleLineId: (productId: string) => string;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items:      [],
    totalItems: 0,
    totalPrice: 0,
  });

  const addItem = useCallback(
    (entry: CartEntryInput, quantity?: number, notes?: string) =>
      dispatch({ type: 'ADD', entry, quantity, notes }),
    [],
  );
  const removeItem = useCallback(
    (cartLineId: string) => dispatch({ type: 'REMOVE', cartLineId }),
    [],
  );
  const setQty = useCallback(
    (cartLineId: string, quantity: number) => dispatch({ type: 'SET_QTY', cartLineId, quantity }),
    [],
  );
  const clearCart = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  const getQty = useCallback(
    (productId: string) =>
      state.items
        .filter(i => i.productId === productId)
        .reduce((s, i) => s + i.quantity, 0),
    [state.items],
  );

  const simpleLineId = useCallback(
    (productId: string) => `${productId}:base`,
    [],
  );

  return (
    <CartContext.Provider value={{ ...state, addItem, removeItem, setQty, clearCart, getQty, simpleLineId }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
