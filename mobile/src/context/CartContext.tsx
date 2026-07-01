import React, { createContext, useContext, useReducer, useEffect, useRef, useMemo, ReactNode } from 'react';
import { Product, CartItem } from '../types';
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
  | { type: 'ADD_ITEM';    payload: Product; defaultTax: number }
  | { type: 'INCREMENT';   payload: string;  defaultTax: number }
  | { type: 'DECREMENT';   payload: string;  defaultTax: number }
  | { type: 'REMOVE_ITEM'; payload: string }
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

const calcItemTax = (product: Product, quantity: number, defaultTax: number): number => {
  const rate = product.taxPercent > 0 ? product.taxPercent : defaultTax;
  return (product.price * quantity * rate) / 100;
};

const calculateTotals = (
  items: CartItem[],
  discount: { type: DiscountType; value: number }
): { subtotal: number; taxTotal: number; discountAmount: number; grandTotal: number } => {
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
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
    case 'RESTORE_SNAPSHOT': return action.payload;

    case 'ADD_ITEM': {
      const product = action.payload;
      const existingIndex = state.items.findIndex((i) => i.product._id === product._id);
      let newItems: CartItem[];
      if (existingIndex >= 0) {
        newItems = state.items.map((item, idx) => {
          if (idx !== existingIndex) return item;
          const newQty = item.quantity + 1;
          const taxAmount = calcItemTax(product, newQty, action.defaultTax);
          return { ...item, quantity: newQty, taxAmount, total: product.price * newQty + taxAmount };
        });
      } else {
        const taxAmount = calcItemTax(product, 1, action.defaultTax);
        newItems = [...state.items, { product, quantity: 1, taxAmount, total: product.price + taxAmount }];
      }
      return { ...state, items: newItems, ...calculateTotals(newItems, state.discount) };
    }

    case 'REMOVE_ITEM': {
      const newItems = state.items.filter((i) => i.product._id !== action.payload);
      return { ...state, items: newItems, ...calculateTotals(newItems, state.discount) };
    }

    case 'INCREMENT': {
      const newItems = state.items.map((item) => {
        if (item.product._id !== action.payload) return item;
        const newQty = item.quantity + 1;
        const taxAmount = calcItemTax(item.product, newQty, action.defaultTax);
        return { ...item, quantity: newQty, taxAmount, total: item.product.price * newQty + taxAmount };
      });
      return { ...state, items: newItems, ...calculateTotals(newItems, state.discount) };
    }

    case 'DECREMENT': {
      const newItems = state.items
        .map((item) => {
          if (item.product._id !== action.payload) return item;
          const newQty = item.quantity - 1;
          if (newQty <= 0) return null;
          const taxAmount = calcItemTax(item.product, newQty, action.defaultTax);
          return { ...item, quantity: newQty, taxAmount, total: item.product.price * newQty + taxAmount };
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
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
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
    addItem:     (product) => dispatch({ type: 'ADD_ITEM',    payload: product, defaultTax }),
    removeItem:  (id)      => dispatch({ type: 'REMOVE_ITEM', payload: id }),
    increment:   (id)      => dispatch({ type: 'INCREMENT',   payload: id, defaultTax }),
    decrement:   (id)      => dispatch({ type: 'DECREMENT',   payload: id, defaultTax }),
    setTable:    (table)   => dispatch({ type: 'SET_TABLE',    payload: table }),
    setCustomer: (name)    => dispatch({ type: 'SET_CUSTOMER', payload: name }),
    setPhone:    (phone)   => dispatch({ type: 'SET_PHONE',    payload: phone }),
    setNotes:    (notes)   => dispatch({ type: 'SET_NOTES',    payload: notes }),
    setParcel:   (val)     => dispatch({ type: 'SET_PARCEL',   payload: val }),
    setDiscount: (d)       => dispatch({ type: 'SET_DISCOUNT', payload: d }),
    clearCart:   ()        => dispatch({ type: 'CLEAR_CART' }),
    itemCount,
  }), [cart, defaultTax, itemCount]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = (): CartContextType => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
};
