import { useState, useEffect, useCallback } from 'react';
import {
  Search, ShoppingCart, X, Plus, Minus, Trash2,
  UtensilsCrossed, ShoppingBag, Truck, ChevronRight,
  AlertCircle, Check, Loader2,
} from 'lucide-react';
import { useCashier, calcCartTotals, type CartItem, type HeldBill } from '../../context/CashierContext';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { fetchProducts, fetchCategories } from '../../api/products';
import { fetchTables } from '../../api/tables';
import { createOrder, completeOrder } from '../../api/orders';
import type { Product, Category, Table } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

type OrderType = 'dine-in' | 'takeaway' | 'delivery';
type PayMethod = 'cash' | 'upi' | 'card' | 'split';

interface DineInMeta { tableId: string; tableNumber: string; guestCount: string; notes: string }
interface TakeAwayMeta { customerName: string; phone: string; notes: string }
interface DeliveryMeta { customerName: string; phone: string; address: string; deliveryPartner: string; deliveryCharge: string; notes: string }

// ── Order type selector ───────────────────────────────────────────────────────

function TypeTab({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
        active ? 'bg-brand text-white shadow-sm' : 'text-ink/60 hover:bg-mist'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({ product, onAdd, sym }: { product: Product; onAdd: (p: Product) => void; sym: string }) {
  const isVeg = product.isVeg !== false;
  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      disabled={!product.isAvailable}
      className={`flex flex-col rounded-xl border p-3 text-left transition ${
        product.isAvailable
          ? 'border-border bg-canvas hover:border-brand/30 hover:shadow-sm active:scale-[0.98]'
          : 'border-border/50 bg-mist/60 opacity-60 cursor-not-allowed'
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className={`h-3 w-3 shrink-0 rounded-sm border ${isVeg ? 'border-emerald-500' : 'border-red-500'}`}>
          <span className={`block h-1.5 w-1.5 m-[2px] rounded-full ${isVeg ? 'bg-emerald-500' : 'bg-red-500'}`} />
        </span>
        <span className="text-xs font-bold text-ink">{fmtINR(sym, product.price)}</span>
      </div>
      <p className="text-xs font-medium leading-tight text-ink line-clamp-2">{product.name}</p>
      {product.stock !== undefined && product.stock >= 0 && product.stock <= 5 && (
        <p className="mt-1 text-[10px] text-amber-500">Only {product.stock} left</p>
      )}
      {!product.isAvailable && (
        <p className="mt-1 text-[10px] text-ink/40">Unavailable</p>
      )}
    </button>
  );
}

// ── Cart item row ─────────────────────────────────────────────────────────────

function CartRow({ item, onQty, onRemove, onNotes, sym }: {
  item: CartItem;
  onQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onNotes: (id: string, notes: string) => void;
  sym: string;
}) {
  const [editNotes, setEditNotes] = useState(false);
  const [draft, setDraft] = useState(item.notes);
  const total = item.price * item.quantity;

  return (
    <div className="border-b border-border/60 pb-2.5 pt-2.5 last:border-0 last:pb-0">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium leading-tight text-ink truncate">{item.productName}</p>
          <p className="text-[10px] text-ink/45">{fmtINR(sym, item.price)} each</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onQty(item.id, item.quantity - 1)}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-ink/60 hover:bg-mist"
          >
            <Minus size={11} />
          </button>
          <span className="w-5 text-center text-xs font-semibold text-ink">{item.quantity}</span>
          <button
            type="button"
            onClick={() => onQty(item.id, item.quantity + 1)}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-ink/60 hover:bg-mist"
          >
            <Plus size={11} />
          </button>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-semibold text-ink w-14 text-right">{fmtINR(sym, total)}</span>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="rounded-md p-1 text-ink/35 hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Notes inline */}
      {editNotes ? (
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Item note (e.g. no onion)…"
            className="flex-1 rounded border border-border bg-mist px-2 py-1 text-[11px] text-ink outline-none focus:border-brand/40"
            autoFocus
          />
          <button
            type="button"
            onClick={() => { onNotes(item.id, draft); setEditNotes(false); }}
            className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700"
          >
            Save
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(item.notes); setEditNotes(true); }}
          className="mt-0.5 text-[10px] text-brand hover:underline"
        >
          {item.notes ? item.notes : '+ Add note'}
        </button>
      )}
    </div>
  );
}

// ── Payment sub-panel ─────────────────────────────────────────────────────────

function PaymentPanel({
  grandTotal,
  sym,
  method,
  setMethod,
  splitCash, setSplitCash,
  splitUpi, setSplitUpi,
  splitCard, setSplitCard,
  cashGiven, setCashGiven,
}: {
  grandTotal: number; sym: string;
  method: PayMethod; setMethod: (m: PayMethod) => void;
  splitCash: string; setSplitCash: (v: string) => void;
  splitUpi: string; setSplitUpi: (v: string) => void;
  splitCard: string; setSplitCard: (v: string) => void;
  cashGiven: string; setCashGiven: (v: string) => void;
}) {
  const METHODS: { key: PayMethod; label: string }[] = [
    { key: 'cash', label: 'Cash' },
    { key: 'upi', label: 'UPI' },
    { key: 'card', label: 'Card' },
    { key: 'split', label: 'Split' },
  ];

  const cashGivenNum = parseFloat(cashGiven) || 0;
  const change = cashGivenNum - grandTotal;

  const PRESETS = [100, 200, 500, 1000, 2000];

  const splitTotal = (parseFloat(splitCash) || 0) + (parseFloat(splitUpi) || 0) + (parseFloat(splitCard) || 0);
  const splitDiff = splitTotal - grandTotal;

  return (
    <div className="space-y-3">
      {/* Method selector */}
      <div className="flex gap-1 rounded-lg border border-border p-1">
        {METHODS.map(m => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMethod(m.key)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
              method === m.key ? 'bg-brand text-white' : 'text-ink/60 hover:bg-mist'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Cash */}
      {method === 'cash' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setCashGiven(String(p))}
                className="rounded border border-border bg-mist px-2 py-1 text-[11px] font-medium text-ink hover:bg-canvas"
              >
                {sym}{p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCashGiven(String(Math.ceil(grandTotal)))}
              className="rounded border border-brand/30 bg-brand/5 px-2 py-1 text-[11px] font-medium text-brand"
            >
              Exact
            </button>
          </div>
          <input
            type="number"
            value={cashGiven}
            onChange={e => setCashGiven(e.target.value)}
            placeholder={`Amount given (min ${fmtINR(sym, grandTotal)})`}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
          {cashGivenNum > 0 && (
            <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${
              change >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-100'
            }`}>
              <span className="text-xs font-medium">{change >= 0 ? 'Change' : 'Short by'}</span>
              <span className={`text-sm font-bold ${change >= 0 ? 'text-emerald-700' : 'text-red-500'}`}>
                {fmtINR(sym, Math.abs(change))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* UPI / Card */}
      {(method === 'upi' || method === 'card') && (
        <div className="rounded-lg border border-border bg-mist px-3 py-3 text-center">
          <p className="text-xs text-ink/60">
            {method === 'upi' ? 'Customer scans UPI QR code.' : 'Swipe or tap card on POS terminal.'}
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">Collect {fmtINR(sym, grandTotal)}</p>
        </div>
      )}

      {/* Split */}
      {method === 'split' && (
        <div className="space-y-2">
          {(['cash', 'upi', 'card'] as const).map(k => (
            <div key={k} className="flex items-center gap-2">
              <label className="w-10 text-xs font-medium capitalize text-ink/60">{k}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={k === 'cash' ? splitCash : k === 'upi' ? splitUpi : splitCard}
                onChange={e => {
                  if (k === 'cash') setSplitCash(e.target.value);
                  else if (k === 'upi') setSplitUpi(e.target.value);
                  else setSplitCard(e.target.value);
                }}
                placeholder="0.00"
                className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
              />
            </div>
          ))}
          <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${
            Math.abs(splitDiff) < 0.5 ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'
          }`}>
            <span className="text-xs font-medium">
              {Math.abs(splitDiff) < 0.5 ? 'Balanced' : splitDiff > 0 ? 'Over by' : 'Short by'}
            </span>
            <span className={`text-sm font-bold ${Math.abs(splitDiff) < 0.5 ? 'text-emerald-700' : 'text-amber-700'}`}>
              {Math.abs(splitDiff) < 0.5 ? '✓' : fmtINR(sym, Math.abs(splitDiff))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NewOrderPanel() {
  const {
    cart, addToCart, removeFromCart, updateQty, updateItemNotes,
    clearCart, holdBill, shift, setActiveTab,
  } = useCashier();
  const { settings } = useSettings();
  useAuth(); // auth token used via apiFetch interceptor
  const sym = settings?.currencySymbol ?? '₹';

  // ── Order meta ─────────────────────────────────────────────────────────────
  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [dineIn, setDineIn]   = useState<DineInMeta>({ tableId: '', tableNumber: '', guestCount: '1', notes: '' });
  const [takeAway, setTakeAway] = useState<TakeAwayMeta>({ customerName: '', phone: '', notes: '' });
  const [delivery, setDelivery] = useState<DeliveryMeta>({ customerName: '', phone: '', address: '', deliveryPartner: '', deliveryCharge: '0', notes: '' });

  // ── Product data ───────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts]     = useState<Product[]>([]);
  const [tables, setTables]         = useState<Table[]>([]);
  const [prodLoading, setProdLoading] = useState(true);
  const [activeCat, setActiveCat]   = useState<string>('');
  const [search, setSearch]         = useState('');

  // ── Payment state ──────────────────────────────────────────────────────────
  const [showPayment, setShowPayment] = useState(false);
  const [discount, setDiscount]       = useState('');
  const [payMethod, setPayMethod]     = useState<PayMethod>('cash');
  const [splitCash, setSplitCash]     = useState('');
  const [splitUpi, setSplitUpi]       = useState('');
  const [splitCard, setSplitCard]     = useState('');
  const [cashGiven, setCashGiven]     = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successOrder, setSuccessOrder] = useState<string | null>(null);

  // ── Load products + categories ─────────────────────────────────────────────
  const loadProducts = useCallback(async () => {
    let cancelled = false;
    setProdLoading(true);
    const [catRes, prodRes, tableRes] = await Promise.allSettled([
      fetchCategories(),
      fetchProducts({ available: true } as Parameters<typeof fetchProducts>[0]),
      fetchTables(),
    ]);
    if (!cancelled) {
      if (catRes.status === 'fulfilled') setCategories(catRes.value);
      if (prodRes.status === 'fulfilled') setProducts(prodRes.value);
      if (tableRes.status === 'fulfilled') setTables(tableRes.value.filter((t: Table) => t.status === 'available'));
      setProdLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // ── Filtered product list ──────────────────────────────────────────────────
  const visibleProducts = products.filter(p => {
    const inCat = !activeCat || String(p.category) === activeCat;
    const inSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.shortCode ?? '').toLowerCase().includes(search.toLowerCase());
    return inCat && inSearch;
  });

  // ── Cart totals ────────────────────────────────────────────────────────────
  const discountAmt = parseFloat(discount) || 0;
  const { subtotal, taxTotal, grandTotal } = calcCartTotals(cart, discountAmt);

  // ── Add to cart ────────────────────────────────────────────────────────────
  function handleAddProduct(p: Product) {
    addToCart({
      productId: p._id,
      productName: p.name,
      price: p.price,
      quantity: 1,
      taxPercent: p.taxPercent ?? 0,
      notes: '',
    });
  }

  // ── Hold bill ──────────────────────────────────────────────────────────────
  function handleHold() {
    if (cart.length === 0) return;

    let cashierName = shift?.cashierName ?? 'Cashier';
    const label = (() => {
      if (orderType === 'dine-in' && dineIn.tableNumber) return `Table ${dineIn.tableNumber}`;
      if (orderType === 'takeaway' && takeAway.customerName) return takeAway.customerName;
      if (orderType === 'delivery' && delivery.customerName) return delivery.customerName;
      return `${orderType} order`;
    })();

    const bill: Omit<HeldBill, 'id' | 'heldAt'> = {
      label,
      cashierName,
      orderType,
      items: [...cart],
      subtotal,
      taxTotal,
      discountAmount: discountAmt,
      grandTotal,
      ...(orderType === 'dine-in' ? {
        tableId: dineIn.tableId,
        tableNumber: dineIn.tableNumber,
        notes: dineIn.notes,
      } : orderType === 'takeaway' ? {
        customerName: takeAway.customerName,
        customerPhone: takeAway.phone,
        notes: takeAway.notes,
      } : {
        customerName: delivery.customerName,
        customerPhone: delivery.phone,
        address: delivery.address,
        deliveryPartner: delivery.deliveryPartner,
        deliveryCharge: parseFloat(delivery.deliveryCharge) || 0,
        notes: delivery.notes,
      }),
    };

    holdBill(bill);
    clearCart();
    setDiscount('');
    setShowPayment(false);
    setActiveTab('hold');
  }

  // ── Submit order ──────────────────────────────────────────────────────────
  async function handleConfirmOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const items = cart.map(i => ({
        product: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        price: i.price,
        taxPercent: i.taxPercent,
        ...(i.notes ? { notes: i.notes } : {}),
      }));

      const splitDetails =
        payMethod === 'split'
          ? {
              cash: parseFloat(splitCash) || 0,
              upi: parseFloat(splitUpi) || 0,
              card: parseFloat(splitCard) || 0,
            }
          : undefined;

      let orderSource: 'dine-in' | 'takeaway' | 'admin' = 'takeaway';
      let payload: Parameters<typeof createOrder>[0] = {
        items,
        orderSource,
        discountAmount: discountAmt || undefined,
        paymentMethod: payMethod,
        ...(splitDetails ? { splitDetails } : {}),
      };

      if (orderType === 'dine-in') {
        orderSource = 'dine-in';
        payload = {
          ...payload,
          orderSource,
          tableId: dineIn.tableId || undefined,
          tableNumber: dineIn.tableNumber || undefined,
          notes: dineIn.notes || undefined,
          isParcel: false,
        };
      } else if (orderType === 'takeaway') {
        orderSource = 'takeaway';
        payload = {
          ...payload,
          orderSource,
          customerName: takeAway.customerName || undefined,
          customerPhone: takeAway.phone || undefined,
          notes: takeAway.notes || undefined,
          isParcel: true,
        };
      } else {
        orderSource = 'admin';
        const deliveryNote = [
          delivery.address,
          delivery.deliveryPartner && `Via: ${delivery.deliveryPartner}`,
          delivery.notes,
        ].filter(Boolean).join(' | ');
        payload = {
          ...payload,
          orderSource,
          customerName: delivery.customerName || undefined,
          customerPhone: delivery.phone || undefined,
          notes: deliveryNote || undefined,
          isParcel: true,
          discountAmount: discountAmt || undefined,
        };
      }

      const created = await createOrder(payload);

      // For takeaway and delivery, complete the order immediately after payment collection
      if (orderType !== 'dine-in') {
        await completeOrder(created._id);
      }

      setSuccessOrder(created.orderNumber);
      clearCart();
      setDiscount('');
      setShowPayment(false);
      setCashGiven('');
      setSplitCash(''); setSplitUpi(''); setSplitCard('');

      // Auto-dismiss success after 3s
      setTimeout(() => setSuccessOrder(null), 3000);

      // Refresh pending bills if dine-in
      if (orderType === 'dine-in') {
        setActiveTab('pending');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Split validation ───────────────────────────────────────────────────────
  const splitTotal = (parseFloat(splitCash) || 0) + (parseFloat(splitUpi) || 0) + (parseFloat(splitCard) || 0);
  const splitOk = payMethod !== 'split' || Math.abs(splitTotal - grandTotal) < 0.5;
  const cashOk = payMethod !== 'cash' || (parseFloat(cashGiven) || 0) >= grandTotal;
  const canConfirm = cart.length > 0 && splitOk && cashOk;

  // ── Success overlay ────────────────────────────────────────────────────────
  if (successOrder) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="rounded-full bg-emerald-100 p-4">
          <Check size={32} className="text-emerald-600" />
        </div>
        <p className="text-lg font-bold text-ink">Order Placed!</p>
        <p className="text-sm text-ink/60">Order #{successOrder}</p>
        <p className="text-xs text-ink/40">Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      {/* ── LEFT: product selection ──────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col min-h-0 space-y-3">
        {/* Order type */}
        <div className="flex gap-1 rounded-xl border border-border bg-canvas p-1">
          <TypeTab active={orderType === 'dine-in'} icon={<UtensilsCrossed size={13} />} label="Dine In" onClick={() => setOrderType('dine-in')} />
          <TypeTab active={orderType === 'takeaway'} icon={<ShoppingBag size={13} />} label="Takeaway" onClick={() => setOrderType('takeaway')} />
          <TypeTab active={orderType === 'delivery'} icon={<Truck size={13} />} label="Delivery" onClick={() => setOrderType('delivery')} />
        </div>

        {/* Order meta form */}
        {orderType === 'dine-in' && (
          <div className="rounded-xl border border-border bg-canvas p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Dine In Details</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-ink/60">Table</label>
                <select
                  value={dineIn.tableId}
                  onChange={e => {
                    const t = tables.find(x => x._id === e.target.value);
                    setDineIn(d => ({ ...d, tableId: e.target.value, tableNumber: t ? String(t.number) : '' }));
                  }}
                  className="mt-0.5 block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
                >
                  <option value="">Walk-in / No table</option>
                  {tables.map(t => (
                    <option key={t._id} value={t._id}>T{t.number} ({t.capacity} pax)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-ink/60">Guests</label>
                <input
                  type="number"
                  min="1"
                  value={dineIn.guestCount}
                  onChange={e => setDineIn(d => ({ ...d, guestCount: e.target.value }))}
                  className="mt-0.5 block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
                />
              </div>
            </div>
            <input
              type="text"
              value={dineIn.notes}
              onChange={e => setDineIn(d => ({ ...d, notes: e.target.value }))}
              placeholder="Order notes…"
              className="block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
          </div>
        )}

        {orderType === 'takeaway' && (
          <div className="rounded-xl border border-border bg-canvas p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Takeaway Details</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={takeAway.customerName}
                onChange={e => setTakeAway(d => ({ ...d, customerName: e.target.value }))}
                placeholder="Customer name (optional)"
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
              />
              <input
                type="tel"
                value={takeAway.phone}
                onChange={e => setTakeAway(d => ({ ...d, phone: e.target.value }))}
                placeholder="Mobile (optional)"
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
              />
            </div>
            <input
              type="text"
              value={takeAway.notes}
              onChange={e => setTakeAway(d => ({ ...d, notes: e.target.value }))}
              placeholder="Order notes…"
              className="block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
          </div>
        )}

        {orderType === 'delivery' && (
          <div className="rounded-xl border border-border bg-canvas p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Delivery Details</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={delivery.customerName}
                onChange={e => setDelivery(d => ({ ...d, customerName: e.target.value }))}
                placeholder="Customer name *"
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
              />
              <input
                type="tel"
                value={delivery.phone}
                onChange={e => setDelivery(d => ({ ...d, phone: e.target.value }))}
                placeholder="Phone *"
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
              />
            </div>
            <input
              type="text"
              value={delivery.address}
              onChange={e => setDelivery(d => ({ ...d, address: e.target.value }))}
              placeholder="Delivery address *"
              className="block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={delivery.deliveryPartner}
                onChange={e => setDelivery(d => ({ ...d, deliveryPartner: e.target.value }))}
                placeholder="Delivery partner"
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
              />
              <input
                type="number"
                min="0"
                value={delivery.deliveryCharge}
                onChange={e => setDelivery(d => ({ ...d, deliveryCharge: e.target.value }))}
                placeholder="Delivery charge"
                className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
              />
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            id="cashier-bill-search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-lg border border-border py-2 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/35 hover:text-ink/60">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Category tabs */}
        {!search && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            <button
              type="button"
              onClick={() => setActiveCat('')}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${!activeCat ? 'bg-brand text-white' : 'border border-border bg-canvas text-ink/60 hover:bg-mist'}`}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat._id}
                type="button"
                onClick={() => setActiveCat(activeCat === cat._id ? '' : cat._id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeCat === cat._id ? 'bg-brand text-white' : 'border border-border bg-canvas text-ink/60 hover:bg-mist'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* Product grid */}
        {prodLoading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-ink/30" />
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-ink/40">No products found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleProducts.map(p => (
              <ProductCard key={p._id} product={p} onAdd={handleAddProduct} sym={sym} />
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT: cart + payment ────────────────────────────────────────────── */}
      <div className="w-full shrink-0 space-y-3 lg:w-80 xl:w-96">
        {/* Cart header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-ink/40" />
            <span className="text-sm font-semibold text-ink">Cart</span>
            {cart.length > 0 && (
              <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="text-[11px] font-medium text-red-400 hover:text-red-600"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Empty cart */}
        {cart.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-8 text-center">
            <ShoppingCart size={20} className="mx-auto mb-2 text-ink/20" />
            <p className="text-xs text-ink/40">Add products to cart</p>
          </div>
        )}

        {/* Cart items */}
        {cart.length > 0 && (
          <div className="rounded-xl border border-border bg-canvas px-3 py-2 max-h-64 overflow-y-auto">
            {cart.map(item => (
              <CartRow
                key={item.id}
                item={item}
                onQty={updateQty}
                onRemove={removeFromCart}
                onNotes={updateItemNotes}
                sym={sym}
              />
            ))}
          </div>
        )}

        {/* Totals + discount */}
        {cart.length > 0 && (
          <div className="rounded-xl border border-border bg-canvas p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink/55">Subtotal</span>
              <span className="text-xs font-medium text-ink">{fmtINR(sym, subtotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink/55">Tax</span>
              <span className="text-xs font-medium text-ink">{fmtINR(sym, taxTotal)}</span>
            </div>

            {/* Discount */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink/55 shrink-0">Discount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={e => setDiscount(e.target.value)}
                placeholder="0"
                className="flex-1 rounded border border-border bg-mist px-2 py-0.5 text-right text-xs text-ink outline-none focus:border-brand/40"
              />
            </div>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-sm font-semibold text-ink">Total</span>
              <span className="text-base font-bold text-brand">{fmtINR(sym, grandTotal)}</span>
            </div>
          </div>
        )}

        {/* Payment section */}
        {cart.length > 0 && showPayment && (
          <div className="rounded-xl border border-border bg-canvas p-3">
            <PaymentPanel
              grandTotal={grandTotal}
              sym={sym}
              method={payMethod}
              setMethod={setPayMethod}
              splitCash={splitCash} setSplitCash={setSplitCash}
              splitUpi={splitUpi}   setSplitUpi={setSplitUpi}
              splitCard={splitCard} setSplitCard={setSplitCard}
              cashGiven={cashGiven} setCashGiven={setCashGiven}
            />
          </div>
        )}

        {/* Error */}
        {submitError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
            <AlertCircle size={13} className="text-red-500" />
            <p className="text-xs text-red-600">{submitError}</p>
          </div>
        )}

        {/* Action buttons */}
        {cart.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleHold}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
            >
              Hold Bill
            </button>

            {!showPayment ? (
              <button
                type="button"
                onClick={() => setShowPayment(true)}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
              >
                Take Payment
                <ChevronRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleConfirmOrder()}
                disabled={submitting || !canConfirm}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {submitting ? 'Placing…' : orderType === 'dine-in' ? 'Send to Kitchen' : 'Confirm & Pay'}
              </button>
            )}
          </div>
        )}

        {showPayment && cart.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPayment(false)}
            className="w-full text-center text-xs text-ink/40 hover:text-ink/60"
          >
            ← Back to cart
          </button>
        )}
      </div>
    </div>
  );
}
