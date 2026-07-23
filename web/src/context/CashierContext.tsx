import {
  createContext, useContext, useState, useCallback, useEffect, useRef,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';

// ── Public types ──────────────────────────────────────────────────────────────

export type CashierTab =
  | 'dashboard'
  | 'new-order'
  | 'pending'
  | 'hold'
  | 'tables'
  | 'kitchen'
  | 'online-orders'
  | 'shift'
  | 'drawer'
  | 'search'
  | 'customers'
  | 'printers'
  | 'profile'
  | 'permissions';

export interface OrderPrefill {
  orderType: 'dine-in' | 'takeaway' | 'delivery';
  tableId?: string;
  tableNumber?: string;
}

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  taxPercent: number;
  notes: string;
}

export interface ShiftState {
  id: string;
  cashierName: string;
  cashierId: string;
  openedAt: string;         // ISO
  openingCash: number;
  openingNote: string;
  status: 'open' | 'closed';
  closedAt?: string;
  actualCash?: number;
  difference?: number;
  closingNote?: string;
}

export interface HeldBill {
  id: string;
  label: string;
  heldAt: string;           // ISO
  cashierName: string;
  orderType: 'dine-in' | 'takeaway' | 'delivery';
  tableNumber?: string;
  tableId?: string;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  deliveryCharge?: number;
  deliveryPartner?: string;
  notes?: string;
  items: CartItem[];
  subtotal: number;
  taxTotal: number;
  discountAmount: number;
  grandTotal: number;
}

export interface DrawerMovement {
  id: string;
  type: 'opening' | 'cash_in' | 'cash_out';
  amount: number;
  reason: string;
  cashierName: string;
  timestamp: string;        // ISO
}

// ── Cart math ─────────────────────────────────────────────────────────────────

export function calcCartTotals(items: CartItem[], discount = 0) {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const taxTotal = items.reduce(
    (s, i) => s + (i.price * i.quantity * i.taxPercent) / 100,
    0,
  );
  const grandTotal = Math.max(0, subtotal + taxTotal - discount);
  return { subtotal, taxTotal, grandTotal };
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface CashierContextValue {
  // Navigation
  activeTab: CashierTab;
  setActiveTab: (tab: CashierTab) => void;

  // Order prefill (table → new-order flow)
  orderPrefill: OrderPrefill | null;
  setOrderPrefill: (p: OrderPrefill | null) => void;

  // Cart
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, 'id'>) => void;
  removeFromCart: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  updateItemNotes: (id: string, notes: string) => void;
  clearCart: () => void;

  // Shift
  shift: ShiftState | null;
  openShift: (data: Omit<ShiftState, 'id' | 'status'>) => void;
  closeShift: (actualCash: number, note: string) => void;

  // Held bills
  heldBills: HeldBill[];
  holdBill: (bill: Omit<HeldBill, 'id' | 'heldAt'>) => void;
  resumeBill: (id: string) => HeldBill | null;
  deleteHeldBill: (id: string) => void;

  // Cash drawer
  drawerMovements: DrawerMovement[];
  addDrawerMovement: (m: Omit<DrawerMovement, 'id' | 'timestamp'>) => void;
  clearDrawerMovements: () => void;
  drawerBalance: number;
}

// ── Context ───────────────────────────────────────────────────────────────────

const CashierContext = createContext<CashierContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function CashierProvider({ children }: { children: ReactNode }) {
  const { hotelId } = useAuth();

  // Hotel-scoped storage keys
  const shiftKey  = hotelId ? `pos_shift_${hotelId}`  : '';
  const heldKey   = hotelId ? `pos_held_${hotelId}`   : '';
  const drawerKey = hotelId ? `pos_drawer_${hotelId}` : '';

  // ── Shift ─────────────────────────────────────────────────────────────────
  const [shift, setShift] = useState<ShiftState | null>(() => {
    if (!hotelId) return null;
    try {
      const raw = localStorage.getItem(`pos_shift_${hotelId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ShiftState;
      return parsed.status === 'open' ? parsed : null;
    } catch { return null; }
  });

  // ── Held bills ────────────────────────────────────────────────────────────
  const [heldBills, setHeldBills] = useState<HeldBill[]>(() => {
    if (!hotelId) return [];
    try {
      const raw = localStorage.getItem(`pos_held_${hotelId}`);
      return raw ? (JSON.parse(raw) as HeldBill[]) : [];
    } catch { return []; }
  });

  // ── Drawer ────────────────────────────────────────────────────────────────
  const [drawerMovements, setDrawerMovements] = useState<DrawerMovement[]>(() => {
    if (!hotelId) return [];
    try {
      const raw = localStorage.getItem(`pos_drawer_${hotelId}`);
      return raw ? (JSON.parse(raw) as DrawerMovement[]) : [];
    } catch { return []; }
  });

  // ── Persist to localStorage ───────────────────────────────────────────────
  useEffect(() => {
    if (!shiftKey) return;
    if (shift) localStorage.setItem(shiftKey, JSON.stringify(shift));
    else localStorage.removeItem(shiftKey);
  }, [shift, shiftKey]);

  useEffect(() => {
    if (heldKey) localStorage.setItem(heldKey, JSON.stringify(heldBills));
  }, [heldBills, heldKey]);

  useEffect(() => {
    if (drawerKey) localStorage.setItem(drawerKey, JSON.stringify(drawerMovements));
  }, [drawerMovements, drawerKey]);

  // ── Cart (in-memory only) ─────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeTab, setActiveTab] = useState<CashierTab>('dashboard');
  const [orderPrefill, setOrderPrefill] = useState<OrderPrefill | null>(null);

  const addToCart = useCallback((item: Omit<CartItem, 'id'>) => {
    const newId = `${item.productId}_${Date.now()}`;
    setCart(prev => {
      const existIdx = prev.findIndex(
        i => i.productId === item.productId && i.notes === item.notes,
      );
      if (existIdx >= 0) {
        return prev.map((i, idx) =>
          idx === existIdx ? { ...i, quantity: i.quantity + item.quantity } : i,
        );
      }
      return [...prev, { ...item, id: newId }];
    });
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
  }, []);

  const updateQty = useCallback((id: string, qty: number) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(i => i.id !== id));
    } else {
      setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: qty } : i));
    }
  }, []);

  const updateItemNotes = useCallback((id: string, notes: string) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, notes } : i));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  // ── Shift actions ─────────────────────────────────────────────────────────
  const openShift = useCallback((data: Omit<ShiftState, 'id' | 'status'>) => {
    const id = `shift_${Date.now()}`;
    const newShift: ShiftState = { ...data, id, status: 'open' };
    setShift(newShift);
    const movId = `mov_${Date.now()}`;
    setDrawerMovements([{
      id: movId,
      type: 'opening',
      amount: data.openingCash,
      reason: 'Shift opening balance',
      cashierName: data.cashierName,
      timestamp: data.openedAt,
    }]);
  }, []);

  const closeShift = useCallback((actualCash: number, note: string) => {
    setShift(prev => {
      if (!prev) return null;
      const openingCash = prev.openingCash;
      return {
        ...prev,
        status: 'closed',
        closedAt: new Date().toISOString(),
        actualCash,
        difference: actualCash - openingCash,
        closingNote: note,
      };
    });
  }, []);

  // ── Held bill actions ─────────────────────────────────────────────────────
  // Use a ref so resumeBill always reads the latest list without re-creating the callback
  const heldBillsRef = useRef(heldBills);
  useEffect(() => { heldBillsRef.current = heldBills; }, [heldBills]);

  const holdBill = useCallback((bill: Omit<HeldBill, 'id' | 'heldAt'>) => {
    const id = `held_${Date.now()}`;
    const newBill: HeldBill = { ...bill, id, heldAt: new Date().toISOString() };
    setHeldBills(prev => [newBill, ...prev]);
  }, []);

  const resumeBill = useCallback((id: string): HeldBill | null => {
    const bill = heldBillsRef.current.find(b => b.id === id) ?? null;
    if (bill) setHeldBills(prev => prev.filter(b => b.id !== id));
    return bill;
  }, []);

  const deleteHeldBill = useCallback((id: string) => {
    setHeldBills(prev => prev.filter(b => b.id !== id));
  }, []);

  // ── Drawer actions ────────────────────────────────────────────────────────
  const addDrawerMovement = useCallback((m: Omit<DrawerMovement, 'id' | 'timestamp'>) => {
    const id = `mov_${Date.now()}`;
    const movement: DrawerMovement = { ...m, id, timestamp: new Date().toISOString() };
    setDrawerMovements(prev => [movement, ...prev]);
  }, []);

  const clearDrawerMovements = useCallback(() => setDrawerMovements([]), []);

  const drawerBalance = drawerMovements.reduce((acc, m) => {
    if (m.type === 'opening' || m.type === 'cash_in') return acc + m.amount;
    return acc - m.amount;
  }, 0);

  return (
    <CashierContext.Provider value={{
      activeTab, setActiveTab,
      orderPrefill, setOrderPrefill,
      cart, addToCart, removeFromCart, updateQty, updateItemNotes, clearCart,
      shift, openShift, closeShift,
      heldBills, holdBill, resumeBill, deleteHeldBill,
      drawerMovements, addDrawerMovement, clearDrawerMovements, drawerBalance,
    }}>
      {children}
    </CashierContext.Provider>
  );
}

export function useCashier() {
  const ctx = useContext(CashierContext);
  if (!ctx) throw new Error('useCashier must be used inside CashierProvider');
  return ctx;
}
