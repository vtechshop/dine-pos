import {
  createContext, useContext, useState, useCallback, useEffect, useRef,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import type { SelectedModifier } from '../types';
import {
  apiOpenShift, apiGetActiveShift, apiCloseShift, apiAddMovement,
  type ShiftData,
} from '../api/shifts';
import {
  listHeldBills, createHeldBill, deleteHeldBill as apiDeleteHeldBill,
} from '../api/heldBills';

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
  | 'permissions'
  | 'shift-history'
  | 'z-report';

export interface OrderPrefill {
  orderType: 'dine-in' | 'takeaway' | 'delivery';
  tableId?: string;
  tableNumber?: string;
  // Order metadata fields restored when resuming a held bill
  tableName?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryCharge?: number;
  discountAmount?: number;
  discountType?: 'flat' | 'percent';
  couponCode?: string;
  voucherCode?: string;
  loyaltyPoints?: number;
  loyaltyDiscount?: number;
}

export interface CartItem {
  id: string;             // cart line dedup key: productId:variantId:optionIds
  productId: string;
  productName: string;
  price: number;          // effective unit price (variant/channel/base)
  modifierTotal: number;  // sum of selected modifier prices per unit
  quantity: number;
  taxPercent: number;
  notes: string;
  variantId?: string;
  variantName?: string;
  selectedModifiers?: SelectedModifier[];
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
  // Backend-populated fields (present after API close)
  expectedCash?: number;
  cashSales?: number;
  upiSales?: number;
  cardSales?: number;
  totalSales?: number;
  totalOrders?: number;
  cashIn?: number;
  cashOut?: number;
}

export interface HeldBill {
  id: string;
  /** MongoDB _id from server — present after successful server persist */
  serverId?: string;
  label: string;
  heldAt: string;           // ISO
  cashierName: string;
  orderType: 'dine-in' | 'takeaway' | 'delivery';
  tableNumber?: string;
  tableId?: string;
  tableName?: string;
  customerName?: string;
  customerPhone?: string;
  address?: string;         // delivery address
  deliveryCharge?: number;
  deliveryPartner?: string;
  notes?: string;
  items: CartItem[];
  subtotal: number;
  taxTotal: number;
  discountAmount: number;
  discountType?: 'flat' | 'percent';
  couponCode?: string;
  voucherCode?: string;
  loyaltyPoints?: number;
  loyaltyDiscount?: number;
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

function buildCartLineId(productId: string, variantId?: string, mods?: SelectedModifier[]): string {
  const base = `${productId}:${variantId || 'base'}`;
  if (!mods?.length) return base;
  const modKey = mods.map(m => m.modifierOptionId).sort().join('|');
  return `${base}:${modKey}`;
}

export function calcCartTotals(items: CartItem[], discount = 0) {
  const subtotal = items.reduce((s, i) => s + (i.price + (i.modifierTotal ?? 0)) * i.quantity, 0);
  const taxTotal = items.reduce(
    (s, i) => s + ((i.price + (i.modifierTotal ?? 0)) * i.quantity * i.taxPercent) / 100,
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
  selectedShiftId: string | null;
  setSelectedShiftId: (id: string | null) => void;

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

  // Tracks the MongoDB shift _id separately (for API calls)
  // shift.id is a local/display ID; shiftApiIdRef is the source-of-truth backend ID
  const shiftApiIdRef = useRef<string | null>(null);

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

  // Keep a ref so replayOfflineShift can read movements without a stale closure
  const drawerMovementsRef = useRef(drawerMovements);
  useEffect(() => { drawerMovementsRef.current = drawerMovements; }, [drawerMovements]);

  // ── Persist to localStorage ───────────────────────────────────────────────
  useEffect(() => {
    if (!shiftKey) return;
    if (shift) localStorage.setItem(shiftKey, JSON.stringify(shift));
    else localStorage.removeItem(shiftKey);
  }, [shift, shiftKey]);

  useEffect(() => {
    if (heldKey) localStorage.setItem(heldKey, JSON.stringify(heldBills));
  }, [heldBills, heldKey]);

  // ── Merge server held bills into local state on mount ─────────────────────
  // Fetches all held bills from the server and deduplicates against localStorage
  // bills (matched by serverId). Bills only on the server (held from another
  // terminal or after a page refresh) are added to the local list.
  useEffect(() => {
    if (!hotelId) return;
    listHeldBills()
      .then(serverBills => {
        setHeldBills(prev => {
          // Build a set of already-known server IDs so we don't add duplicates
          const knownServerIds = new Set(prev.map(b => b.serverId).filter(Boolean));
          const newFromServer: HeldBill[] = serverBills
            .filter(sb => !knownServerIds.has(sb._id))
            .map(sb => ({
              id:             `held_server_${sb._id}`,
              serverId:       sb._id,
              label:          sb.label ?? '',
              heldAt:         sb.heldAt,
              cashierName:    sb.cashierName ?? '',
              orderType:      (sb.metadata?.orderType as HeldBill['orderType']) ?? 'dine-in',
              tableId:        sb.metadata?.tableId,
              tableNumber:    sb.metadata?.tableNumber,
              tableName:      sb.metadata?.tableName,
              customerName:   sb.metadata?.customerName,
              customerPhone:  sb.metadata?.customerPhone,
              address:        sb.metadata?.deliveryAddress,
              deliveryCharge: sb.metadata?.deliveryCharge,
              discountAmount: sb.metadata?.discountAmount ?? 0,
              discountType:   sb.metadata?.discountType as HeldBill['discountType'],
              couponCode:     sb.metadata?.couponCode,
              voucherCode:    sb.metadata?.voucherCode,
              loyaltyPoints:  sb.metadata?.loyaltyPoints,
              loyaltyDiscount: sb.metadata?.loyaltyDiscount,
              notes:          sb.metadata?.notes,
              items:          sb.items as CartItem[],
              // Totals are not stored on server; default to 0 — the resume flow
              // recalculates them from items when the order is rebuilt.
              subtotal:    0,
              taxTotal:    0,
              grandTotal:  0,
            }));
          if (newFromServer.length === 0) return prev;
          return [...prev, ...newFromServer];
        });
      })
      .catch(() => { /* non-fatal — localStorage state is still valid */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  useEffect(() => {
    if (drawerKey) localStorage.setItem(drawerKey, JSON.stringify(drawerMovements));
  }, [drawerMovements, drawerKey]);

  // ── Replay an offline-opened shift once connectivity returns ─────────────
  // A shift opened while offline never reaches the DB (apiOpenShift fails and
  // the optimistic update leaves shift.id as a temp "shift_<ms>" string).
  // This callback detects that state, creates the shift in the DB, then
  // replays any drawer movements that are also stuck with temp IDs.
  const replayOfflineShift = useCallback(async () => {
    if (!hotelId || shiftApiIdRef.current) return;

    const raw = localStorage.getItem(`pos_shift_${hotelId}`);
    if (!raw) return;
    let local: ShiftState;
    try { local = JSON.parse(raw) as ShiftState; } catch { return; }
    // Only replay shifts that still hold a temp ID (never reached the DB)
    if (!local.id.startsWith('shift_')) return;

    if (local.status === 'open') {
      // ── Branch 1: opened offline, still open ──────────────────────────────
      try {
        let apiId: string;
        try {
          const { shift: s } = await apiOpenShift({
            cashierName: local.cashierName,
            cashierId:   local.cashierId,
            openedAt:    local.openedAt,
            openingCash: local.openingCash,
            openingNote: local.openingNote,
          });
          apiId = s._id;
        } catch {
          // Either still offline or got 409 (shift created on another device/tab).
          // Try to fetch the active shift — if that succeeds we have the real ID.
          const { shift: active } = await apiGetActiveShift();
          if (!active) return;
          apiId = active._id;
        }

        shiftApiIdRef.current = apiId;
        setShift(prev => prev ? { ...prev, id: apiId } : null);

        // Replay offline drawer movements (those still holding temp IDs)
        const offline = drawerMovementsRef.current.filter(
          m => (m.type === 'cash_in' || m.type === 'cash_out') && m.id.startsWith('mov_'),
        );
        for (const m of offline) {
          try {
            const { movement: saved } = await apiAddMovement(apiId, {
              type:        m.type as 'cash_in' | 'cash_out',
              amount:      m.amount,
              reason:      m.reason,
              cashierName: m.cashierName,
            });
            setDrawerMovements(prev =>
              prev.map(mv => mv.id === m.id ? { ...mv, id: saved._id } : mv),
            );
          } catch { /* keep temp ID — non-fatal */ }
        }
      } catch { /* still offline — will retry on next reconnect or mount */ }
      return;
    }

    if (local.status === 'closed') {
      // ── Branch 2: opened AND closed offline ───────────────────────────────
      // Close data was saved by closeShift() when apiId was null.
      const closeRaw = localStorage.getItem(`pos_offline_close_${hotelId}`);
      if (!closeRaw) return; // no close data — nothing to replay
      let closeData: { actualCash: number; closingNote: string; closedAt: string; movements?: DrawerMovement[] };
      try { closeData = JSON.parse(closeRaw); } catch { return; }

      try {
        // Step 1: Create the shift in DB
        let apiId: string;
        try {
          const { shift: s } = await apiOpenShift({
            cashierName: local.cashierName,
            cashierId:   local.cashierId,
            openedAt:    local.openedAt,
            openingCash: local.openingCash,
            openingNote: local.openingNote ?? '',
          });
          apiId = s._id;
        } catch {
          // Either offline or 409 (a prior partial retry already opened this shift).
          // Try fetching the active shift to recover the orphaned DB shift.
          try {
            const { shift: active } = await apiGetActiveShift();
            if (!active) return;
            apiId = active._id;
          } catch {
            return; // still offline — retain close data for next retry
          }
        }

        // Step 2: Replay movements captured at close time (before state was cleared)
        const movements = closeData.movements ?? [];
        for (const m of movements) {
          try {
            await apiAddMovement(apiId, {
              type:        m.type as 'cash_in' | 'cash_out',
              amount:      m.amount,
              reason:      m.reason,
              cashierName: m.cashierName,
            });
          } catch { /* non-fatal — movements are best-effort */ }
        }

        // Step 3: Close the shift in DB
        const { shift: closed } = await apiCloseShift(apiId, closeData.actualCash, closeData.closingNote);

        // All three steps succeeded — clear the pending close record
        localStorage.removeItem(`pos_offline_close_${hotelId}`);
        shiftApiIdRef.current = null;
        setShift({
          id:           closed._id,
          cashierName:  closed.cashierName,
          cashierId:    closed.cashierId,
          openedAt:     closed.openedAt,
          openingCash:  closed.openingCash,
          openingNote:  closed.openingNote,
          status:       'closed',
          closedAt:     closed.closedAt ?? undefined,
          actualCash:   closed.actualCash ?? undefined,
          difference:   closed.difference ?? undefined,
          closingNote:  closed.closingNote,
          expectedCash: closed.expectedCash ?? undefined,
          cashSales:    closed.cashSales,
          upiSales:     closed.upiSales,
          cardSales:    closed.cardSales,
          totalSales:   closed.totalSales,
          totalOrders:  closed.totalOrders,
          cashIn:       closed.cashIn,
          cashOut:      closed.cashOut,
        });
      } catch {
        // Partial failure (e.g. open succeeded but close failed) — retain the
        // pending close record so the next reconnect/mount retries from Step 1.
      }
    }
  }, [hotelId]);

  // ── Sync active shift from API on mount ───────────────────────────────────
  useEffect(() => {
    if (!hotelId) return;
    apiGetActiveShift()
      .then(({ shift: apiShift }) => {
        if (!apiShift) {
          // No active shift in DB — try to replay an offline-opened shift if one exists
          void replayOfflineShift();
          return;
        }
        shiftApiIdRef.current = apiShift._id;
        const synced: ShiftState = {
          id:          apiShift._id,
          cashierName: apiShift.cashierName,
          cashierId:   apiShift.cashierId,
          openedAt:    apiShift.openedAt,
          openingCash: apiShift.openingCash,
          openingNote: apiShift.openingNote,
          status:      'open',
        };
        setShift(synced);
        const movements: DrawerMovement[] = [
          {
            id: `opening_${apiShift._id}`,
            type: 'opening',
            amount: apiShift.openingCash,
            reason: 'Shift opening balance',
            cashierName: apiShift.cashierName,
            timestamp: apiShift.openedAt,
          },
          ...apiShift.movements.map((m): DrawerMovement => ({
            id:          m._id,
            type:        m.type,
            amount:      m.amount,
            reason:      m.reason,
            cashierName: m.cashierName,
            timestamp:   m.timestamp,
          })),
        ];
        setDrawerMovements(movements);
      })
      .catch(() => {
        // API unavailable — keep localStorage state as offline fallback
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  // ── Replay offline shift when browser reports connectivity restored ────────
  useEffect(() => {
    const handler = () => { void replayOfflineShift(); };
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, [replayOfflineShift]);

  // ── Cart (in-memory only) ─────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeTab, setActiveTab] = useState<CashierTab>('dashboard');
  const [orderPrefill, setOrderPrefill] = useState<OrderPrefill | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);

  const addToCart = useCallback((item: Omit<CartItem, 'id'>) => {
    const id = buildCartLineId(item.productId, item.variantId, item.selectedModifiers);
    setCart(prev => {
      const existIdx = prev.findIndex(ci => ci.id === id);
      if (existIdx >= 0) {
        return prev.map((ci, idx) =>
          idx === existIdx ? { ...ci, quantity: ci.quantity + item.quantity } : ci,
        );
      }
      return [...prev, { ...item, id }];
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
    // Optimistic UI update immediately
    const tempId = `shift_${Date.now()}`;
    const newShift: ShiftState = { ...data, id: tempId, status: 'open' };
    setShift(newShift);
    setDrawerMovements([{
      id: `mov_${Date.now()}`,
      type: 'opening',
      amount: data.openingCash,
      reason: 'Shift opening balance',
      cashierName: data.cashierName,
      timestamp: data.openedAt,
    }]);

    // Persist to backend in background; on success replace with real MongoDB _id
    apiOpenShift({
      cashierName: data.cashierName,
      cashierId:   data.cashierId,
      openedAt:    data.openedAt,
      openingCash: data.openingCash,
      openingNote: data.openingNote,
    }).then(({ shift: s }) => {
      shiftApiIdRef.current = s._id;
      setShift(prev => prev ? { ...prev, id: s._id } : null);
      setDrawerMovements([{
        id: `opening_${s._id}`,
        type: 'opening',
        amount: s.openingCash,
        reason: 'Shift opening balance',
        cashierName: s.cashierName,
        timestamp: s.openedAt,
      }]);
    }).catch(() => {
      // API offline — localStorage fallback already set via optimistic update
    });
  }, []);

  const closeShift = useCallback((actualCash: number, note: string) => {
    const apiId = shiftApiIdRef.current;

    // Optimistic local close (difference approximated until API responds)
    setShift(prev => {
      if (!prev) return null;
      const expectedCash = prev.openingCash; // backend will compute the real value
      return {
        ...prev,
        status: 'closed',
        closedAt: new Date().toISOString(),
        actualCash,
        difference: actualCash - expectedCash,
        closingNote: note,
      };
    });
    setDrawerMovements([]);

    if (apiId) {
      apiCloseShift(apiId, actualCash, note)
        .then(({ shift: s }) => {
          shiftApiIdRef.current = null;
          setShift({
            id:           s._id,
            cashierName:  s.cashierName,
            cashierId:    s.cashierId,
            openedAt:     s.openedAt,
            openingCash:  s.openingCash,
            openingNote:  s.openingNote,
            status:       'closed',
            closedAt:     s.closedAt ?? undefined,
            actualCash:   s.actualCash ?? undefined,
            difference:   s.difference ?? undefined,
            closingNote:  s.closingNote,
            expectedCash: s.expectedCash ?? undefined,
            cashSales:    s.cashSales,
            upiSales:     s.upiSales,
            cardSales:    s.cardSales,
            totalSales:   s.totalSales,
            totalOrders:  s.totalOrders,
            cashIn:       s.cashIn,
            cashOut:      s.cashOut,
          });
        })
        .catch(() => {
          // API offline — localStorage fallback already set
          shiftApiIdRef.current = null;
        });
    } else if (hotelId) {
      // No API ID — shift was opened offline and closed before replay could sync.
      // Capture movements now (before they are cleared from state) and persist
      // the entire pending close record so replayOfflineShift can complete the
      // full open→movements→close sequence once connectivity returns.
      const pendingMovements = drawerMovementsRef.current.filter(
        m => (m.type === 'cash_in' || m.type === 'cash_out') && m.id.startsWith('mov_'),
      );
      localStorage.setItem(
        `pos_offline_close_${hotelId}`,
        JSON.stringify({ actualCash, closingNote: note, closedAt: new Date().toISOString(), movements: pendingMovements }),
      );
    }
  }, [hotelId]);

  // ── Held bill actions ─────────────────────────────────────────────────────
  // Use a ref so resumeBill always reads the latest list without re-creating the callback
  const heldBillsRef = useRef(heldBills);
  useEffect(() => { heldBillsRef.current = heldBills; }, [heldBills]);

  const holdBill = useCallback((bill: Omit<HeldBill, 'id' | 'heldAt'>) => {
    const id = `held_${Date.now()}`;
    const heldAt = new Date().toISOString();
    const newBill: HeldBill = { ...bill, id, heldAt };
    setHeldBills(prev => [newBill, ...prev]);

    // Persist to server so other terminals and page refreshes can see it.
    // On success, patch the local bill with the server's MongoDB _id so resumeBill
    // can call deleteHeldBill with the correct server ID.
    createHeldBill({
      label:    bill.label,
      items:    bill.items,
      heldAt,
      metadata: {
        orderType:       bill.orderType,
        tableId:         bill.tableId,
        tableNumber:     bill.tableNumber,
        tableName:       bill.tableName,
        customerName:    bill.customerName,
        customerPhone:   bill.customerPhone,
        deliveryAddress: bill.address,
        deliveryCharge:  bill.deliveryCharge,
        discountAmount:  bill.discountAmount,
        discountType:    bill.discountType,
        couponCode:      bill.couponCode,
        voucherCode:     bill.voucherCode,
        loyaltyPoints:   bill.loyaltyPoints,
        loyaltyDiscount: bill.loyaltyDiscount,
        notes:           bill.notes,
      },
    }).then(saved => {
      setHeldBills(prev =>
        prev.map(b => b.id === id ? { ...b, serverId: saved._id } : b),
      );
    }).catch(() => { /* non-fatal — localStorage already updated */ });
  }, []);

  const resumeBill = useCallback((id: string): HeldBill | null => {
    const bill = heldBillsRef.current.find(b => b.id === id) ?? null;
    if (bill) {
      setHeldBills(prev => prev.filter(b => b.id !== id));
      // Restore all order metadata into context so the order form can pre-populate
      setOrderPrefill({
        orderType:       bill.orderType,
        tableId:         bill.tableId,
        tableNumber:     bill.tableNumber,
        tableName:       bill.tableName,
        customerName:    bill.customerName,
        customerPhone:   bill.customerPhone,
        deliveryAddress: bill.address,
        deliveryCharge:  bill.deliveryCharge,
        discountAmount:  bill.discountAmount,
        discountType:    bill.discountType,
        couponCode:      bill.couponCode,
        voucherCode:     bill.voucherCode,
        loyaltyPoints:   bill.loyaltyPoints,
        loyaltyDiscount: bill.loyaltyDiscount,
      });
      // Remove from server — fire-and-forget (non-fatal if it fails)
      if (bill.serverId) {
        apiDeleteHeldBill(bill.serverId).catch(() => { /* non-fatal */ });
      }
    }
    return bill;
  }, []);

  const deleteHeldBill = useCallback((id: string) => {
    const bill = heldBillsRef.current.find(b => b.id === id);
    setHeldBills(prev => prev.filter(b => b.id !== id));
    // Remove from server — fire-and-forget (non-fatal if it fails)
    if (bill?.serverId) {
      apiDeleteHeldBill(bill.serverId).catch(() => { /* non-fatal */ });
    }
  }, []);

  // ── Drawer actions ────────────────────────────────────────────────────────
  const addDrawerMovement = useCallback((m: Omit<DrawerMovement, 'id' | 'timestamp'>) => {
    // Optimistic local update
    const id = `mov_${Date.now()}`;
    const movement: DrawerMovement = { ...m, id, timestamp: new Date().toISOString() };
    setDrawerMovements(prev => [movement, ...prev]);

    const apiId = shiftApiIdRef.current;
    if (apiId && (m.type === 'cash_in' || m.type === 'cash_out')) {
      apiAddMovement(apiId, {
        type:        m.type,
        amount:      m.amount,
        reason:      m.reason,
        cashierName: m.cashierName,
      }).then(({ movement: saved }) => {
        // Replace temp movement with server-assigned ID
        setDrawerMovements(prev =>
          prev.map(mv => mv.id === id ? { ...mv, id: saved._id } : mv),
        );
      }).catch(() => {
        // API offline — keep temp movement in localStorage
      });
    }
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
      selectedShiftId, setSelectedShiftId,
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
