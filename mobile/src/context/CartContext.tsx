import React, { createContext, useContext, useReducer, useEffect, useRef, useMemo, ReactNode } from 'react';
import { Product, CartItem, SelectedModifier } from '../types';
import { useSettings } from './SettingsContext';
import { saveCartSnapshot, getCartSnapshot, clearCartSnapshot } from '../database/cartDao';

export type DiscountType = 'percent' | 'flat';

interface CartState {
  items: CartItem[];
  subtotal: number;
  taxTotal: number;
  discountAmount: number;
  grandTotal: number;
  tableNumber: string;
  customerName: string;
  customerPhone: string;
  notes: string;
  isParcel: boolean;
  discount: { type: DiscountType; value: number };
}

type CartAction =
  | { type: 'ADD_ITEM';    payload: Product; defaultTax: number; effectivePrice: number; variantId?: string; variantName?: string; selectedModifiers?: SelectedModifier[] }
  | { type: 'INCREMENT';   payload: string;  defaultTax: number }  // payload = cartLineId
  | { type: 'DECREMENT';   payload: string;  defaultTax: number }  // payload = cartLineId
  | { type: 'REMOVE_ITEM'; payload: string }                       // payload = cartLineId
  | { type: 'SET_TABLE';   payload: string }
  | { type: 'SET_CUSTOMER';payload: string }
  | { type: 'SET_PHONE';   payload: string }
  | { type: 'SET_NOTES';   payload: string }
  | { type: 'SET_PARCEL';  payload: boolean }
  | { type: 'SET_DISCOUNT';payload: { type: DiscountType; value: number } }
  | { type: 'CLEAR_CART' }
  | { type: 'RESTORE_SNAPSHOT'; payload: CartState };

const initialState: CartState = {
  items: [],
  subtotal: 0,
  taxTotal: 0,
  discountAmount: 0,
  grandTotal: 0,
  tableNumber: '',
  customerName: '',
  customerPhone: '',
  notes: '',
  isParcel: false,
  discount: { type: 'percent', value: 0 },
};

const buildCartLineId = (productId: string, variantId?: string, mods?: SelectedModifier[]): string => {
  const base = `${productId}:${variantId || 'base'}`;
  if (!mods?.length) return base;
  const modKey = mods.map(m => m.modifierOptionId).sort().join('|');
  return `${base}:${modKey}`;
};

const calcItemTax = (price: number, quantity: number, taxPercent: number, defaultTax: number): number => {
  const rate = taxPercent > 0 ? taxPercent : defaultTax;
  return (price * quantity * rate) / 100;
};

// effectivePrice = base unit price (variant/channel); modifierTotal = sum of modifier prices per unit
const unitPrice = (ep: number, modifierTotal: number) => ep + modifierTotal;

const calculateTotals = (
  items: CartItem[],
  discount: { type: DiscountType; value: number }
): { subtotal: number; taxTotal: number; discountAmount: number; grandTotal: number } => {
  const subtotal = items.reduce((sum, item) => sum + unitPrice(item.effectivePrice, item.modifierTotal) * item.quantity, 0);
  const taxTotal = items.reduce((sum, item) => sum + item.taxAmount, 0);
  const preTax = subtotal + taxTotal;

  let discountAmount = 0;
  if (discount.value > 0) {
    if (discount.type === 'percent') {
      discountAmount = (preTax * discount.value) / 100;
    } else {
      discountAmount = Math.min(discount.value, preTax);
    }
  }

  return { subtotal, taxTotal, discountAmount, grandTotal: Math.max(0, preTax - discountAmount) };
};

const cartReducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case 'RESTORE_SNAPSHOT': return {
      ...action.payload,
      items: action.payload.items.map(item => ({
        ...item,
        effectivePrice: (item as any).effectivePrice ?? item.product.price,
        modifierTotal:  (item as any).modifierTotal  ?? 0,
        // backward compat: old snapshots had no cartLineId or variantId
        cartLineId: (item as any).cartLineId ?? `${item.product._id}:base`,
      })),
    };

    case 'ADD_ITEM': {
      const { payload: product, defaultTax, effectivePrice, variantId, variantName, selectedModifiers } = action;
      const modifierTotal = (selectedModifiers || []).reduce((s, m) => s + m.modifierPrice, 0);
      const cartLineId = buildCartLineId(product._id, variantId, selectedModifiers);
      const existingIndex = state.items.findIndex((i) => i.cartLineId === cartLineId);
      let newItems: CartItem[];
      if (existingIndex >= 0) {
        newItems = state.items.map((item, idx) => {
          if (idx !== existingIndex) return item;
          const newQty = item.quantity + 1;
          const up = unitPrice(item.effectivePrice, item.modifierTotal);
          const taxAmount = calcItemTax(up, newQty, product.taxPercent, defaultTax);
          return { ...item, quantity: newQty, taxAmount, total: up * newQty + taxAmount };
        });
      } else {
        const up = unitPrice(effectivePrice, modifierTotal);
        const taxAmount = calcItemTax(up, 1, product.taxPercent, defaultTax);
        const newItem: CartItem = {
          product,
          quantity: 1,
          taxAmount,
          total: up + taxAmount,
          effectivePrice,
          modifierTotal,
          cartLineId,
          variantId,
          variantName,
          selectedModifiers,
        };
        newItems = [...state.items, newItem];
      }
      return { ...state, items: newItems, ...calculateTotals(newItems, state.discount) };
    }

    case 'REMOVE_ITEM': {
      const newItems = state.items.filter((i) => i.cartLineId !== action.payload);
      return { ...state, items: newItems, ...calculateTotals(newItems, state.discount) };
    }

    case 'INCREMENT': {
      const newItems = state.items.map((item) => {
        if (item.cartLineId !== action.payload) return item;
        const newQty = item.quantity + 1;
        const up = unitPrice(item.effectivePrice, item.modifierTotal);
        const taxAmount = calcItemTax(up, newQty, item.product.taxPercent, action.defaultTax);
        return { ...item, quantity: newQty, taxAmount, total: up * newQty + taxAmount };
      });
      return { ...state, items: newItems, ...calculateTotals(newItems, state.discount) };
    }

    case 'DECREMENT': {
      const newItems = state.items
        .map((item) => {
          if (item.cartLineId !== action.payload) return item;
          const newQty = item.quantity - 1;
          if (newQty <= 0) return null;
          const up = unitPrice(item.effectivePrice, item.modifierTotal);
          const taxAmount = calcItemTax(up, newQty, item.product.taxPercent, action.defaultTax);
          return { ...item, quantity: newQty, taxAmount, total: up * newQty + taxAmount };
        })
        .filter(Boolean) as CartItem[];
      return { ...state, items: newItems, ...calculateTotals(newItems, state.discount) };
    }

    case 'SET_DISCOUNT': {
      const totals = calculateTotals(state.items, action.payload);
      return { ...state, discount: action.payload, ...totals };
    }

    case 'SET_TABLE':    return { ...state, tableNumber: action.payload };
    case 'SET_CUSTOMER': return { ...state, customerName: action.payload };
    case 'SET_PHONE':    return { ...state, customerPhone: action.payload };
    case 'SET_NOTES':    return { ...state, notes: action.payload };
    case 'SET_PARCEL':   return { ...state, isParcel: action.payload };
    case 'CLEAR_CART':   return initialState;
    default:             return state;
  }
};

interface CartContextType {
  cart: CartState;
  addItem: (product: Product, effectivePrice?: number, variantId?: string, variantName?: string, selectedModifiers?: SelectedModifier[]) => void;
  removeItem: (cartLineId: string) => void;
  increment: (cartLineId: string) => void;
  decrement: (cartLineId: string) => void;
  setTable: (table: string) => void;
  setCustomer: (name: string) => void;
  setPhone: (phone: string) => void;
  setNotes: (notes: string) => void;
  setParcel: (val: boolean) => void;
  setDiscount: (d: { type: DiscountType; value: number }) => void;
  clearCart: () => void;
  itemCount: number;
}

const CartContext = createContext<CartContextType | null>(null);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [cart, dispatch] = useReducer(cartReducer, initialState);
  const { settings } = useSettings();
  const defaultTax = settings.defaultTaxPercent || 0;
  const isRestored = useRef(false);

  // On mount: restore cart from SQLite crash snapshot
  useEffect(() => {
    const snapshot = getCartSnapshot();
    if (snapshot && (snapshot as CartState).items?.length > 0 && !isRestored.current) {
      isRestored.current = true;
      dispatch({ type: 'RESTORE_SNAPSHOT', payload: snapshot as CartState });
    }
  }, []);

  // Persist cart to SQLite on every state change (crash protection)
  useEffect(() => {
    if (cart.items.length === 0) {
      clearCartSnapshot();
    } else {
      saveCartSnapshot(cart);
    }
  }, [cart]);

  const itemCount = useMemo(() => cart.items.reduce((sum, item) => sum + item.quantity, 0), [cart.items]);

  const value: CartContextType = useMemo(() => ({
    cart,
    addItem: (product, ep, variantId, variantName, selectedModifiers) =>
      dispatch({ type: 'ADD_ITEM', payload: product, defaultTax, effectivePrice: ep ?? product.price, variantId, variantName, selectedModifiers }),
    removeItem: (cartLineId) => dispatch({ type: 'REMOVE_ITEM', payload: cartLineId }),
    increment:  (cartLineId) => dispatch({ type: 'INCREMENT',   payload: cartLineId, defaultTax }),
    decrement:  (cartLineId) => dispatch({ type: 'DECREMENT',   payload: cartLineId, defaultTax }),
    setTable:    (table)  => dispatch({ type: 'SET_TABLE',    payload: table }),
    setCustomer: (name)   => dispatch({ type: 'SET_CUSTOMER', payload: name }),
    setPhone:    (phone)  => dispatch({ type: 'SET_PHONE',    payload: phone }),
    setNotes:    (notes)  => dispatch({ type: 'SET_NOTES',    payload: notes }),
    setParcel:   (val)    => dispatch({ type: 'SET_PARCEL',   payload: val }),
    setDiscount: (d)      => dispatch({ type: 'SET_DISCOUNT', payload: d }),
    clearCart:   ()       => dispatch({ type: 'CLEAR_CART' }),
    itemCount,
  }), [cart, defaultTax, itemCount]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = (): CartContextType => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
};
