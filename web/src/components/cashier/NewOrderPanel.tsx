import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Search, ShoppingCart, X, Plus, Minus, Trash2,
  UtensilsCrossed, ShoppingBag, Truck, ChevronRight, ChevronLeft,
  AlertCircle, Check, Loader2, Star, ScanBarcode,
} from 'lucide-react';
import { useCashier, calcCartTotals, type CartItem, type HeldBill } from '../../context/CashierContext';
import { ModifierDialog, type ModifierResult } from './ModifierDialog';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { fetchProducts, fetchCategories } from '../../api/products';
import { fetchTables } from '../../api/tables';
import { createOrder, completeOrder } from '../../api/orders';
import { validateCoupon, type CouponValidateResult } from '../../api/coupons';
import { checkGiftVoucher } from '../../api/giftVouchers';
import { lookupCustomer } from '../../api/loyalty';
import type { LoyaltyLookupResult } from '../../api/loyalty';
import { enqueueOrder, newOfflineId, afterCreateFor } from '../../utils/offlineQueue';
import { printBill } from '../../utils/printBill';
import { useIsOnline } from './OfflineBanner';
import { classifySyncError } from '../../sync/syncEngine';
import {
  cacheProducts, cacheCategories,
  getLocalProducts, getLocalCategories,
  getSyncMeta, setSyncMeta,
} from '../../db/productCache';
import { fetchProductSalesReport } from '../../api/reports';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { useCashierPermissions } from '../../hooks/useCashierPermissions';
import type { Product, Category, Table } from '../../types';
import type { ProductSalesRow } from '../../types/reports';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

type OrderType = 'dine-in' | 'takeaway' | 'delivery';
type PayMethod = 'cash' | 'upi' | 'card' | 'split';

interface DineInMeta { tableId: string; tableNumber: string; guestCount: string; notes: string; customerName: string; phone: string }
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

/** Up to two initials for a dish, used when it has no photo ("Masala Dosa" → "MD"). */
function dishInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({
  product, onAdd, onToggleFav, isFav, sym, showPhoto = true,
}: {
  showPhoto?: boolean;
  product: Product;
  onAdd: (p: Product) => void;
  onToggleFav: (id: string) => void;
  isFav: boolean;
  sym: string;
}) {
  const isVeg = product.isVeg !== false;
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!product.image && !imgFailed;
  const variantCount = (product.variants ?? []).length;
  const options = variantCount > 0 || (product.modifierGroups ?? []).length > 0;
  return (
    <div className={`group relative flex flex-col overflow-hidden rounded-xl border bg-canvas shadow-sm transition ${
      product.isAvailable
        ? 'border-border hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md'
        : 'border-border opacity-60'
    }`}>
      <button
        type="button"
        onClick={() => onAdd(product)}
        disabled={!product.isAvailable}
        aria-label={`Add ${product.name}`}
        className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed"
      >
        {/* Photo — fixed 16:10 frame so cards don't jump while images load.
            Skipped entirely when the menu has no photos, so cards stay compact. */}
        {showPhoto ? (
        <div className="relative aspect-[16/10] w-full bg-paper 2xl:aspect-[2/1]">
          {showImg ? (
            <img
              src={product.image}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            // No photo saved (or it failed to load): the dish's initials on a soft ivory tone
            <div aria-hidden className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-paper via-ivory to-beige/80">
              <span className="select-none text-3xl font-semibold tracking-wide text-mocha/60">{dishInitials(product.name)}</span>
            </div>
          )}
          <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            product.isAvailable ? 'bg-white/95 text-green-700 ring-1 ring-green-200' : 'bg-white/95 text-red-600 ring-1 ring-red-200'
          }`}>
            {product.isAvailable ? 'Available' : 'Unavailable'}
          </span>
        </div>
        ) : (
          <div className="px-2.5 pt-2.5">
            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              product.isAvailable ? 'bg-white/95 text-green-700 ring-1 ring-green-200' : 'bg-white/95 text-red-600 ring-1 ring-red-200'
            }`}>
              {product.isAvailable ? 'Available' : 'Unavailable'}
            </span>
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1 p-2.5">
          <div className="flex items-start gap-1.5">
            <span title={isVeg ? 'Veg' : 'Non-veg'} className={`mt-0.5 h-3 w-3 shrink-0 rounded-sm border ${isVeg ? 'border-green-600' : 'border-red-600'}`}>
              <span className={`m-[2px] block h-1.5 w-1.5 rounded-full ${isVeg ? 'bg-green-600' : 'bg-red-600'}`} />
            </span>
            <p className="line-clamp-2 text-[13px] font-medium leading-tight text-ink">{product.name}</p>
          </div>
          {variantCount > 0 && (
            <p className="text-[11px] text-ink/50">{variantCount} size{variantCount === 1 ? '' : 's'}</p>
          )}
          {product.stock !== undefined && product.stock >= 0 && product.stock <= 5 && (
            <p className="text-[11px] text-amber-600">Only {product.stock} left</p>
          )}
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <span className="text-sm font-bold text-ink">
              {variantCount > 0 && <span className="text-[11px] font-normal text-ink/50">from </span>}
              {fmtINR(sym, product.price)}
            </span>
            {product.isAvailable && (
              <span className="rounded-md bg-action px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition duration-150 group-hover:bg-coffee group-hover:shadow-md group-active:bg-action-press group-active:shadow-none">
                {options ? 'Choose' : 'Add'}
              </span>
            )}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onToggleFav(product._id)}
        className="absolute right-2 top-2 rounded-full bg-white/85 p-1 text-ink/35 shadow-sm transition hover:text-amber-500"
        aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star size={12} className={isFav ? 'fill-amber-400 text-amber-400' : ''} />
      </button>
    </div>
  );
}

// ── Category rail button ──────────────────────────────────────────────────────

function CatButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-semibold leading-tight transition ${
        active ? 'bg-brand text-white shadow-sm' : 'text-umber transition-colors duration-150 hover:bg-mist hover:text-coffee'
      }`}
    >
      {children}
    </button>
  );
}

// ── Cart item row ─────────────────────────────────────────────────────────────

function CartRow({ item, onQty, onRemove, onNotes, sym, image }: {
  item: CartItem;
  onQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onNotes: (id: string, notes: string) => void;
  sym: string;
  image?: string;
}) {
  const [editNotes, setEditNotes] = useState(false);
  const [draft, setDraft] = useState(item.notes);
  const [imgFailed, setImgFailed] = useState(false);
  const unitPrice = item.price + (item.modifierTotal ?? 0);
  const total = unitPrice * item.quantity;

  return (
    <div className="border-b border-border/60 pb-2.5 pt-2.5 last:border-0 last:pb-0">
      <div className="flex items-start gap-2">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-mist">
          {image && !imgFailed ? (
            <img src={image} alt="" loading="lazy" onError={() => setImgFailed(true)} className="h-full w-full object-contain p-0.5" />
          ) : (
            <div className="flex h-full w-full items-center justify-center"><UtensilsCrossed size={13} className="text-ink/20" /></div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium leading-tight text-ink truncate">{item.productName}</p>
          {item.variantName && (
            <p className="text-[10px] text-ink/50">{item.variantName}</p>
          )}
          {(item.selectedModifiers ?? []).map(m => (
            <p key={m.modifierOptionId} className="text-[10px] text-ink/45">
              + {m.modifierOptionName}{m.modifierPrice > 0 ? ` (+${sym}${m.modifierPrice})` : ''}
            </p>
          ))}
          <p className="text-[10px] text-ink/45">{fmtINR(sym, unitPrice)} each</p>
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
          <span className="text-xs font-semibold text-ink w-16 text-right">{fmtINR(sym, total)}</span>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="rounded-md p-1 text-ink/35 hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

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
  grandTotal, sym, method, setMethod,
  splitCash, setSplitCash, splitUpi, setSplitUpi, splitCard, setSplitCard,
  cashGiven, setCashGiven, showMethods = true,
}: {
  grandTotal: number; sym: string;
  method: PayMethod; setMethod: (m: PayMethod) => void;
  splitCash: string; setSplitCash: (v: string) => void;
  splitUpi: string; setSplitUpi: (v: string) => void;
  splitCard: string; setSplitCard: (v: string) => void;
  cashGiven: string; setCashGiven: (v: string) => void;
  /** false when the caller already shows the Cash / UPI / Card / Split choice */
  showMethods?: boolean;
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
      <div className={`flex gap-1 rounded-lg border border-border p-1 ${showMethods ? '' : 'hidden'}`}>
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
            placeholder="Cash received (optional — for change)"
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

      {(method === 'upi' || method === 'card') && (
        <div className="rounded-lg border border-border bg-mist px-3 py-3 text-center">
          <p className="text-xs text-ink/60">
            {method === 'upi' ? 'Customer scans UPI QR code.' : 'Swipe or tap card on POS terminal.'}
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">Collect {fmtINR(sym, grandTotal)}</p>
        </div>
      )}

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

const FAVS_CAT = '__favs__';

export function NewOrderPanel() {
  const {
    cart, addToCart, removeFromCart, updateQty, updateItemNotes,
    clearCart, holdBill, shift, setActiveTab,
    orderPrefill, setOrderPrefill,
  } = useCashier();
  const { settings } = useSettings();
  const { hotelId, role } = useAuth();
  const isOnline = useIsOnline();
  const sym = settings?.currencySymbol ?? '₹';
  // Pay before kitchen: orders are paid while placing them and only then reach the kitchen
  const payFirst = settings?.payBeforeKitchen === true;
  const perms = useCashierPermissions();

  // Hotel-scoped localStorage keys
  const favsKey   = hotelId ? `pos_favs_${hotelId}`   : '';
  const recentKey = hotelId ? `pos_recent_${hotelId}` : '';

  // ── Order meta ─────────────────────────────────────────────────────────────
  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [dineIn, setDineIn]   = useState<DineInMeta>({ tableId: '', tableNumber: '', guestCount: '1', notes: '', customerName: '', phone: '' });
  const [takeAway, setTakeAway] = useState<TakeAwayMeta>({ customerName: '', phone: '', notes: '' });
  const [delivery, setDelivery] = useState<DeliveryMeta>({ customerName: '', phone: '', address: '', deliveryPartner: '', deliveryCharge: '0', notes: '' });

  // ── Product data ───────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts]     = useState<Product[]>([]);
  const [tables, setTables]         = useState<Table[]>([]);
  const [prodLoading, setProdLoading] = useState(true);
  const [activeCat, setActiveCat]   = useState<string>('');
  const pillsRef = useRef<HTMLDivElement>(null);
  const billRef  = useRef<HTMLDivElement>(null);
  // Category list open/closed, remembered on this device
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('pos_cat_rail') === 'open'; } catch { return false; }
  });
  const toggleRail = (open: boolean) => {
    setRailOpen(open);
    try { localStorage.setItem('pos_cat_rail', open ? 'open' : 'closed'); } catch { /* private mode */ }
  };
  const [search, setSearch]         = useState('');

  // ── Favorites (hotel-scoped localStorage) ──────────────────────────────────
  const [favorites, setFavorites] = useState<string[]>(() => {
    if (!favsKey) return [];
    try { return JSON.parse(localStorage.getItem(favsKey) ?? '[]') as string[]; }
    catch { return []; }
  });

  // ── Recent products (hotel-scoped localStorage) ────────────────────────────
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    if (!recentKey) return [];
    try { return JSON.parse(localStorage.getItem(recentKey) ?? '[]') as string[]; }
    catch { return []; }
  });

  // ── Top today (from product sales report) ─────────────────────────────────
  const [topToday, setTopToday] = useState<ProductSalesRow[]>([]);

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
  const [savedOffline, setSavedOffline] = useState(false);
  const [waReceiptPhone, setWaReceiptPhone] = useState<string | null>(null);
  // One offlineId per bill attempt: a resubmit of the SAME cart reuses it, so a response lost
  // after the server saved the order can never produce a second order. Any cart change resets it.
  const attemptIdRef = useRef<string | null>(null);
  useEffect(() => { attemptIdRef.current = null; }, [cart]);
  const [prodError, setProdError]     = useState<string | null>(null);
  const [servedFromCache, setServedFromCache] = useState(false);
  const [lastSynced, setLastSynced]   = useState<string | null>(null);

  // ── Coupon state ───────────────────────────────────────────────────────────
  const [couponInput, setCouponInput]       = useState('');
  const [appliedCoupon, setAppliedCoupon]   = useState<CouponValidateResult | null>(null);
  const [couponLoading, setCouponLoading]   = useState(false);
  const [couponError, setCouponError]       = useState<string | null>(null);

  // ── Gift voucher state ─────────────────────────────────────────────────────
  const [voucherInput, setVoucherInput]     = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState<{ code: string; balance: number } | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError]     = useState<string | null>(null);

  // ── Loyalty lookup ─────────────────────────────────────────────────────────
  const [loyaltyInfo, setLoyaltyInfo]         = useState<LoyaltyLookupResult | null>(null);
  const [loyaltyLoading, setLoyaltyLoading]   = useState(false);
  const [loyaltyRedemption, setLoyaltyRedemption] = useState(0);

  // ── Modifier dialog ────────────────────────────────────────────────────────
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);

  // ── Barcode scanner ────────────────────────────────────────────────────────
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);

  useBarcodeScanner({
    enabled: !modifierProduct && !unknownBarcode,
    onProductFound: (product) => {
      handleAddProduct(product);
    },
    onUnknownCode: (code) => {
      setUnknownBarcode(code);
    },
  });

  // ── Apply orderPrefill on mount / change (hold-resume + table → new-order flow) ──
  useEffect(() => {
    if (!orderPrefill) return;
    setOrderType(orderPrefill.orderType);
    if (orderPrefill.orderType === 'dine-in') {
      setDineIn(d => ({
        ...d,
        tableId:      orderPrefill.tableId      ?? d.tableId,
        tableNumber:  orderPrefill.tableNumber  ?? d.tableNumber,
        customerName: orderPrefill.customerName ?? d.customerName,
        phone:        orderPrefill.customerPhone ?? d.phone,
      }));
    } else if (orderPrefill.orderType === 'takeaway') {
      setTakeAway(d => ({
        ...d,
        customerName: orderPrefill.customerName ?? d.customerName,
        phone:        orderPrefill.customerPhone ?? d.phone,
      }));
    } else if (orderPrefill.orderType === 'delivery') {
      setDelivery(d => ({
        ...d,
        customerName:    orderPrefill.customerName   ?? d.customerName,
        phone:           orderPrefill.customerPhone  ?? d.phone,
        address:         orderPrefill.deliveryAddress ?? d.address,
        deliveryCharge:  orderPrefill.deliveryCharge != null
          ? String(orderPrefill.deliveryCharge)
          : d.deliveryCharge,
      }));
    }
    // Restore discount, coupon, voucher, loyalty from held bill
    if (orderPrefill.discountAmount) setDiscount(String(orderPrefill.discountAmount));
    if (orderPrefill.couponCode)     setCouponInput(orderPrefill.couponCode);
    if (orderPrefill.voucherCode)    setVoucherInput(orderPrefill.voucherCode);
    if (orderPrefill.loyaltyPoints)  setLoyaltyRedemption(orderPrefill.loyaltyPoints);
    setOrderPrefill(null);
  }, [orderPrefill, setOrderPrefill]);

  // ── Load products + categories + top today ─────────────────────────────────
  const loadProducts = useCallback(async () => {
    let cancelled = false;
    setProdLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const [catRes, prodRes, tableRes, topRes] = await Promise.allSettled([
      fetchCategories(),
      fetchProducts({ available: true } as Parameters<typeof fetchProducts>[0]),
      fetchTables(),
      // "Top Today" uses the admin-only product report; cashiers would get 403
      role === 'admin' ? fetchProductSalesReport(today) : Promise.reject(new Error('admin only')),
    ]);
    if (!cancelled) {
      if (catRes.status === 'fulfilled') {
        setCategories(catRes.value);
        if (hotelId) void cacheCategories(hotelId, catRes.value);
      } else if (hotelId) {
        const cached = await getLocalCategories(hotelId);
        if (cached.length > 0) setCategories(cached);
      }

      if (prodRes.status === 'fulfilled') {
        setProducts(prodRes.value);
        setProdError(null);
        setServedFromCache(false);
        setLastSynced(null);
        if (hotelId) {
          void cacheProducts(hotelId, prodRes.value);
          void setSyncMeta(hotelId, 'products');
        }
      } else if (hotelId) {
        const [cached, syncedAt] = await Promise.all([
          getLocalProducts(hotelId),
          getSyncMeta(hotelId, 'products'),
        ]);
        if (cached.length > 0) {
          setProducts(cached);
          const timeStr = syncedAt
            ? new Date(syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null;
          setServedFromCache(true);
          setLastSynced(timeStr);
          setProdError(null);
        } else {
          setProdError('Failed to load products. Tap the search bar or refresh to retry.');
          setServedFromCache(false);
        }
      } else {
        setProdError('Failed to load products. Tap the search bar or refresh to retry.');
        setServedFromCache(false);
      }

      if (tableRes.status === 'fulfilled') setTables(tableRes.value.filter((t: Table) => t.status === 'available'));
      if (topRes.status === 'fulfilled') {
        setTopToday(
          [...topRes.value.products]
            .sort((a, b) => b.totalQuantity - a.totalQuantity)
            .slice(0, 5),
        );
      }
      setProdLoading(false);
    }
    return () => { cancelled = true; };
  }, [hotelId, role]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // ── Favorite toggle ────────────────────────────────────────────────────────
  function toggleFav(productId: string) {
    setFavorites(prev => {
      const next = prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [productId, ...prev];
      if (favsKey) localStorage.setItem(favsKey, JSON.stringify(next));
      return next;
    });
  }

  // ── Recent product tracking ────────────────────────────────────────────────
  function addToRecent(productId: string) {
    setRecentIds(prev => {
      const next = [productId, ...prev.filter(id => id !== productId)].slice(0, 8);
      if (recentKey) localStorage.setItem(recentKey, JSON.stringify(next));
      return next;
    });
  }

  // ── Filtered product list ──────────────────────────────────────────────────
  // A product's category may arrive as an id or as { _id, name }
  const categoryIdOf = (p: Product): string =>
    p.category && typeof p.category === 'object' ? String(p.category._id) : String(p.category ?? '');
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(categoryIdOf(p), (m.get(categoryIdOf(p)) ?? 0) + 1);
    return m;
  }, [products]); // eslint-disable-line react-hooks/exhaustive-deps
  const menuHasPhotos = useMemo(() => products.some(p => !!p.image), [products]);
  const productImages = useMemo(() => new Map(products.map(p => [p._id, p.image])), [products]);

  const visibleProducts = products.filter(p => {
    if (activeCat === FAVS_CAT) return favorites.includes(p._id);
    const inCat = !activeCat || categoryIdOf(p) === activeCat;
    const inSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.shortCode ?? '').toLowerCase().includes(search.toLowerCase());
    return inCat && inSearch;
  });

  // ── Derived: top today product objects ─────────────────────────────────────

  const topProducts = topToday
    .map(row => ({ row, product: products.find(p => p.name === row.productName) }))
    .filter((x): x is { row: ProductSalesRow; product: Product } => !!x.product && x.product.isAvailable);

  // ── Cart totals ────────────────────────────────────────────────────────────
  const discountAmt = parseFloat(discount) || 0;
  const deliveryChargeAmt = orderType === 'delivery' ? (parseFloat(delivery.deliveryCharge) || 0) : 0;
  const couponDiscountPreview = appliedCoupon?.discountAmount ?? 0;
  const { subtotal, taxTotal, grandTotal: baseGrandTotal } = calcCartTotals(cart, discountAmt);
  // voucherDiscountPreview: client-side display only; server computes authoritatively from giftVoucherCode
  const postCouponTotal = Math.max(0, baseGrandTotal - couponDiscountPreview);
  const voucherDiscountPreview = appliedVoucher
    ? Math.round(Math.min(appliedVoucher.balance, postCouponTotal) * 100) / 100
    : 0;
  // grandTotal is client-side preview only; server recalculates authoritatively from couponCode/giftVoucherCode
  const grandTotal = Math.max(0, postCouponTotal - voucherDiscountPreview) + deliveryChargeAmt;

  // ── Loyalty lookup — runs when phone / grand total changes ─────────────────
  useEffect(() => {
    if (orderType === 'dine-in') { setLoyaltyInfo(null); setLoyaltyRedemption(0); return; }
    const rawPhone = orderType === 'takeaway' ? takeAway.phone : delivery.phone;
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length < 10) { setLoyaltyInfo(null); setLoyaltyRedemption(0); return; }
    let cancelled = false;
    setLoyaltyLoading(true);
    const t = setTimeout(() => {
      void (async () => {
        const result = await lookupCustomer(rawPhone, grandTotal);
        if (cancelled) return;
        setLoyaltyInfo(result.found ? result.data : null);
        setLoyaltyRedemption(0);
        setLoyaltyLoading(false);
      })();
    }, 500);
    return () => { cancelled = true; clearTimeout(t); setLoyaltyLoading(false); };
  }, [orderType, takeAway.phone, delivery.phone, grandTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add to cart (via modifier dialog or direct) ────────────────────────────
  function handleAddProduct(p: Product) {
    const hasVariants = (p.variants ?? []).length > 0;
    const hasModifiers = (p.modifierGroups ?? []).length > 0;
    if (!hasVariants && !hasModifiers) {
      addToCart({
        productId: p._id,
        productName: p.name,
        price: p.price,
        modifierTotal: 0,
        quantity: 1,
        taxPercent: p.taxPercent ?? 0,
        notes: '',
      });
      addToRecent(p._id);
    } else {
      setModifierProduct(p);
    }
  }

  function handleModifierConfirm(result: ModifierResult) {
    if (!modifierProduct) return;
    const modifierTotal = result.selectedModifiers.reduce((s, m) => s + m.modifierPrice, 0);
    addToCart({
      productId: modifierProduct._id,
      productName: modifierProduct.name,
      price: result.effectivePrice,
      modifierTotal,
      quantity: result.quantity,
      taxPercent: modifierProduct.taxPercent ?? 0,
      notes: result.notes,
      selectedModifiers: result.selectedModifiers,
      variantId: result.variantId,
      variantName: result.variantName,
    });
    addToRecent(modifierProduct._id);
    setModifierProduct(null);
  }

  // ── Coupon apply ───────────────────────────────────────────────────────────
  async function handleApplyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponLoading(true);
    setCouponError(null);
    try {
      const result = await validateCoupon(code, subtotal + taxTotal);
      setAppliedCoupon(result);
      setCouponInput('');
    } catch (err: any) {
      setCouponError(err?.message ?? 'Invalid coupon code');
    } finally {
      setCouponLoading(false);
    }
  }

  // ── Gift voucher check + apply (server validates; amount is NOT trusted from client) ──
  async function handleApplyVoucher() {
    const code = voucherInput.trim().toUpperCase();
    if (!code) return;
    setVoucherLoading(true);
    setVoucherError(null);
    try {
      const result = await checkGiftVoucher(code);
      if (!result.valid || !result.voucher.isActive) {
        setVoucherError('Voucher is inactive or not found');
        return;
      }
      if (result.voucher.expiresAt && new Date(result.voucher.expiresAt) < new Date()) {
        setVoucherError('Voucher has expired');
        return;
      }
      if (result.voucher.balance <= 0) {
        setVoucherError('Voucher has no remaining balance');
        return;
      }
      setAppliedVoucher({ code: result.voucher.voucherCode, balance: result.voucher.balance });
      setVoucherInput('');
    } catch (err: any) {
      setVoucherError(err?.message ?? 'Invalid voucher code');
    } finally {
      setVoucherLoading(false);
    }
  }

  // ── Hold bill ──────────────────────────────────────────────────────────────
  function handleHold() {
    if (cart.length === 0) return;

    const cashierName = shift?.cashierName ?? 'Cashier';
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
        customerName: dineIn.customerName,
        customerPhone: dineIn.phone,
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
    setAppliedCoupon(null); setCouponInput(''); setCouponError(null);
    setAppliedVoucher(null); setVoucherInput(''); setVoucherError(null);
    setShowPayment(false);
    setActiveTab('hold');
  }

  // ── Submit order ───────────────────────────────────────────────────────────
  // pay=false is a KOT: the order goes to the kitchen and is paid later from Pending Bills.
  async function handleConfirmOrder(opts: { pay: boolean; print: boolean } = { pay: true, print: false }) {
    if (cart.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    let pendingPayload: Parameters<typeof createOrder>[0] | undefined;
    if (!attemptIdRef.current) attemptIdRef.current = newOfflineId();
    const offlineId = attemptIdRef.current;

    const resetCheckout = () => {
      clearCart();
      setDiscount('');
      setAppliedCoupon(null); setCouponInput(''); setCouponError(null);
      setAppliedVoucher(null); setVoucherInput(''); setVoucherError(null);
      setShowPayment(false);
      setCashGiven('');
      setSplitCash(''); setSplitUpi(''); setSplitCard('');
      setLoyaltyInfo(null); setLoyaltyRedemption(0);
    };

    try {
      const items = cart.map(i => ({
        product: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        price: i.price + (i.modifierTotal ?? 0),
        taxPercent: i.taxPercent,
        selectedModifiers: (i.selectedModifiers ?? []).map(m => ({
          ...m,
          modifierTotal: m.modifierPrice * i.quantity,
        })),
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
        couponCode: appliedCoupon?.code || undefined,
        giftVoucherCode: appliedVoucher?.code || undefined,
        paymentMethod: payMethod,
        ...(opts.pay && payFirst ? { payNow: true } : {}),
        ...(splitDetails ? { splitDetails } : {}),
        offlineId,
      };

      if (orderType === 'dine-in') {
        orderSource = 'dine-in';
        payload = {
          ...payload,
          orderSource,
          tableId: dineIn.tableId || undefined,
          tableNumber: dineIn.tableNumber || undefined,
          customerName: dineIn.customerName || undefined,
          customerPhone: dineIn.phone || undefined,
          notes: dineIn.notes || undefined,
          isParcel: false,
        };
      } else if (orderType === 'takeaway') {
        orderSource = 'takeaway';
        const loyaltyDisc = loyaltyRedemption > 0 && loyaltyInfo?.config
          ? Math.round(loyaltyRedemption * (loyaltyInfo.config.pointValueInPaisa / 100))
          : 0;
        payload = {
          ...payload,
          orderSource,
          customerName: takeAway.customerName || undefined,
          customerPhone: takeAway.phone || undefined,
          notes: takeAway.notes || undefined,
          isParcel: true,
          ...(loyaltyRedemption > 0 ? { redeemedPoints: loyaltyRedemption, loyaltyDiscount: loyaltyDisc } : {}),
        };
      } else {
        orderSource = 'admin';
        const deliveryNote = [
          delivery.address,
          delivery.deliveryPartner && `Via: ${delivery.deliveryPartner}`,
          delivery.notes,
        ].filter(Boolean).join(' | ');
        const loyaltyDiscDel = loyaltyRedemption > 0 && loyaltyInfo?.config
          ? Math.round(loyaltyRedemption * (loyaltyInfo.config.pointValueInPaisa / 100))
          : 0;
        payload = {
          ...payload,
          orderSource,
          customerName: delivery.customerName || undefined,
          customerPhone: delivery.phone || undefined,
          notes: deliveryNote || undefined,
          isParcel: true,
          discountAmount: discountAmt || undefined,
          deliveryCharge: parseFloat(delivery.deliveryCharge) || 0,
          ...(loyaltyRedemption > 0 ? { redeemedPoints: loyaltyRedemption, loyaltyDiscount: loyaltyDiscDel } : {}),
        };
      }

      pendingPayload = payload;
      const created = await createOrder(payload);

      // Pay before kitchen: the server records the payment (payNow) and the order goes to the
      // kitchen paid; it is closed later when handed over / served. Otherwise takeaway and
      // delivery paid now are closed straight away.
      const completeNow = opts.pay && !payFirst && orderType !== 'dine-in';
      if (completeNow) {
        // Takeaway and counter delivery go straight from pending to completed on the server.
        // Don't send a 'served' step: cashiers may not set it (403 "Access denied").
        await completeOrder(created._id);
      }

      if (opts.print) {
        printBill(
          { ...created, status: completeNow ? 'completed' : created.status,
            paymentMethod: completeNow || created.paymentTime ? payMethod : null },
          { hotelName: settings?.hotelName, address: settings?.address, phone: settings?.phone,
            gstNumber: settings?.gstNumber, footerText: settings?.footerText, currencySymbol: sym },
        );
      }

      setSavedOffline(false);
      setWaReceiptPhone(
        orderType === 'dine-in'  ? (dineIn.phone   || null) :
        orderType === 'takeaway' ? (takeAway.phone  || null) :
                                   (delivery.phone  || null),
      );
      setSuccessOrder(created.orderNumber);
      resetCheckout();

      setTimeout(() => { setSuccessOrder(null); setWaReceiptPhone(null); }, 3000);

      if (orderType === 'dine-in') {
        setActiveTab('pending');
      }
    } catch (err) {
      // Only a connection failure is saved for later. A refusal from the server (validation,
      // stock, permissions) is shown as it is — queueing it would resubmit an invalid bill.
      const failure = classifySyncError(err);
      if (failure.kind === 'retryable' && hotelId && pendingPayload) {
        try {
          await enqueueOrder(hotelId, pendingPayload, {
            offlineId,
            afterCreate: opts.pay && !payFirst ? afterCreateFor(pendingPayload.orderSource) : { markServed: false, complete: false },
          });
          setSavedOffline(true);
          setWaReceiptPhone(
            orderType === 'dine-in'  ? (dineIn.phone   || null) :
            orderType === 'takeaway' ? (takeAway.phone  || null) :
                                       (delivery.phone  || null),
          );
          setSuccessOrder(offlineId);
          resetCheckout();
          setTimeout(() => { setSuccessOrder(null); setSavedOffline(false); setWaReceiptPhone(null); }, 3000);
        } catch (queueErr) {
          setSubmitError(queueErr instanceof Error ? queueErr.message : 'Could not save the bill offline');
        }
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Failed to place order');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Split / cash validation ────────────────────────────────────────────────
  const splitTotal = (parseFloat(splitCash) || 0) + (parseFloat(splitUpi) || 0) + (parseFloat(splitCard) || 0);
  const splitOk = payMethod !== 'split' || Math.abs(splitTotal - grandTotal) < 0.5;
  // Blank "cash received" means exact cash; a typed amount must cover the bill
  const cashOk  = payMethod !== 'cash'  || cashGiven.trim() === '' || (parseFloat(cashGiven) || 0) >= grandTotal;
  const customerOk =
    orderType === 'dine-in'  ? (dineIn.customerName.trim() !== '' && dineIn.phone.trim() !== '') :
    orderType === 'takeaway' ? (takeAway.customerName.trim() !== '' && takeAway.phone.trim() !== '') :
    (delivery.customerName.trim() !== '' && delivery.phone.trim() !== '');
  const canConfirm = cart.length > 0 && splitOk && cashOk && customerOk;
  const canKot     = cart.length > 0 && customerOk;

  // ── Success overlay ────────────────────────────────────────────────────────
  if (successOrder) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="rounded-full bg-emerald-100 p-4">
          <Check size={32} className="text-emerald-600" />
        </div>
        <p className="text-lg font-bold text-ink">{savedOffline ? 'Saved Offline' : 'Order Placed!'}</p>
        <p className="text-sm text-ink/60">
          {savedOffline ? 'This bill will be sent automatically when the connection returns.' : `Order #${successOrder}`}
        </p>
        <p className="text-xs text-ink/40">Redirecting…</p>
        {waReceiptPhone && (
          <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
            <span>📲</span>
            {savedOffline
              ? 'WhatsApp receipt will send after sync'
              : `WhatsApp receipt queued`}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:h-full lg:flex-row">
      {/* ── Category rail (wide screens; phones use the pill row) ─────────────── */}
      <nav aria-label="Categories" className={`hidden w-36 shrink-0 flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-canvas p-1.5 xl:w-44 ${railOpen ? 'lg:flex' : ''}`}>
        <button
          type="button"
          onClick={() => toggleRail(false)}
          title="Hide categories"
          className="mb-0.5 flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/45 hover:bg-mist hover:text-ink/70"
        >
          Categories <ChevronLeft size={14} />
        </button>
        <CatButton active={!activeCat} onClick={() => { setSearch(''); setActiveCat(''); }}>
          <span className="flex-1">All</span>
          <span className="text-[10px] opacity-60">{products.length}</span>
        </CatButton>
        <CatButton active={activeCat === FAVS_CAT} onClick={() => { setSearch(''); setActiveCat(activeCat === FAVS_CAT ? '' : FAVS_CAT); }}>
          <Star size={11} className={activeCat === FAVS_CAT ? 'fill-white' : 'fill-amber-400 text-amber-400'} />
          <span className="flex-1">Favorites</span>
          {favorites.length > 0 && <span className="text-[10px] opacity-70">{favorites.length}</span>}
        </CatButton>
        {categories.map(cat => (
          <CatButton key={cat._id} active={activeCat === cat._id} onClick={() => { setSearch(''); setActiveCat(activeCat === cat._id ? '' : cat._id); }}>
            <span className="flex-1">{cat.name}</span>
            <span className="text-[10px] opacity-60">{categoryCounts.get(String(cat._id)) ?? 0}</span>
          </CatButton>
        ))}
      </nav>

      {/* ── MIDDLE: menu (search + items) ─────────────────────────────────────── */}
      {/* Wide screens: this column scrolls on its own (search + categories pinned). Narrow: the page scrolls, cart below */}
      <div className="min-w-0 space-y-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
        <div className="sticky top-0 z-10 space-y-2 bg-mist pb-1">
        {/* Search */}
        <div className="flex items-center gap-2">
        {!railOpen && (
          <button
            type="button"
            onClick={() => toggleRail(true)}
            title="Show categories"
            className="hidden shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs font-semibold text-ink/65 hover:bg-mist lg:flex"
          >
            <ChevronRight size={14} /> Categories
          </button>
        )}
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            id="cashier-bill-search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="search-input w-full py-2 pl-8 pr-3 text-sm"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/35 hover:text-ink/60">
              <X size={14} />
            </button>
          )}
        </div>
        </div>

        {/* Category tabs (with Favorites) */}
        {!search && (
          <div ref={pillsRef} className={`flex gap-1.5 overflow-x-auto px-0.5 pb-1 scroll-smooth scrollbar-hide ${railOpen ? 'lg:hidden' : ''}`}>
            <button
              type="button"
              onClick={() => { pillsRef.current?.scrollTo({ left: 0 }); setActiveCat(''); }}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                !activeCat ? 'border border-brand bg-brand text-white shadow-sm' : 'border border-border bg-canvas text-umber transition-colors duration-150 hover:bg-mist hover:text-coffee'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => { pillsRef.current?.scrollTo({ left: 0 }); setActiveCat(activeCat === FAVS_CAT ? '' : FAVS_CAT); }}
              className={`shrink-0 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeCat === FAVS_CAT
                  ? 'bg-amber-400 text-white'
                  : 'border border-border bg-canvas text-umber transition-colors duration-150 hover:bg-mist hover:text-coffee'
              }`}
            >
              <Star size={10} className={activeCat === FAVS_CAT ? 'fill-white' : 'fill-amber-400'} />
              Favorites
              {favorites.length > 0 && (
                <span className={`rounded-full px-1 text-[9px] font-bold ${activeCat === FAVS_CAT ? 'bg-white/30 text-white' : 'bg-amber-200 text-amber-800'}`}>
                  {favorites.length}
                </span>
              )}
            </button>
            {categories.map(cat => (
              <button
                key={cat._id}
                type="button"
                onClick={() => setActiveCat(activeCat === cat._id ? '' : cat._id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeCat === cat._id ? 'border border-brand bg-brand text-white shadow-sm' : 'border border-border bg-canvas text-umber transition-colors duration-150 hover:bg-mist hover:text-coffee'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
        </div>


        {/* Top today strip */}
        {!search && activeCat !== FAVS_CAT && topProducts.length > 0 && (
          <div className="flex items-center gap-2">
            <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink/35">Top Today</p>
            <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {topProducts.map(({ row, product }) => (
                <button
                  key={product._id}
                  type="button"
                  onClick={() => handleAddProduct(product)}
                  className="shrink-0 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
                >
                  {product.name}
                  <span className="text-[10px] font-bold text-amber-600">{row.totalQuantity}×</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Product grid */}
        {servedFromCache && !prodLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
            <AlertCircle size={13} className="text-amber-500" />
            <p className="text-xs text-amber-700">
              Offline — showing cached products
              {lastSynced ? ` (Last synced: ${lastSynced})` : ''}
            </p>
          </div>
        )}
        {prodError && !prodLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
            <AlertCircle size={13} className="text-red-500" />
            <p className="text-xs text-red-600">{prodError}</p>
          </div>
        )}
        {prodLoading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-ink/30" />
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-10 text-center">
            {activeCat === FAVS_CAT ? (
              <>
                <Star size={20} className="mx-auto mb-2 text-ink/20" />
                <p className="text-sm text-ink/40">No favorites yet</p>
                <p className="text-xs text-ink/30 mt-0.5">Tap the ★ on any product to add it here</p>
              </>
            ) : (
              <p className="text-sm text-ink/40">No products found</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 pb-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleProducts.map(p => (
              <ProductCard
                key={p._id}
                product={p}
                onAdd={handleAddProduct}
                onToggleFav={toggleFav}
                isFav={favorites.includes(p._id)}
                showPhoto={menuHasPhotos}
                sym={sym}
              />
            ))}
          </div>
        )}

        {/* Narrow screens: the bill sits below the menu — keep a shortcut to it in view */}
        {cart.length > 0 && (
          <div className="sticky bottom-0 z-10 pb-1 pt-2 lg:hidden">
            <button
              type="button"
              onClick={() => billRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="flex w-full items-center justify-between rounded-xl bg-coffee px-4 py-3 text-sm font-semibold text-white shadow-lg"
            >
              <span>View order · {cart.reduce((s, i) => s + i.quantity, 0)} item{cart.reduce((s, i) => s + i.quantity, 0) === 1 ? '' : 's'}</span>
              <span>{fmtINR(sym, grandTotal)}</span>
            </button>
          </div>
        )}
      </div>

      {/* ── RIGHT: cart + payment ────────────────────────────────────────────── */}
      {/* Scrolls on its own on wide screens so the page itself never scrolls */}
      <div ref={billRef} className="w-full shrink-0 scroll-mt-4 space-y-3 lg:min-h-0 lg:w-96 lg:overflow-y-auto lg:rounded-xl lg:border lg:border-border lg:bg-canvas lg:p-3 lg:shadow-sm xl:w-[26rem] 2xl:w-[30rem]">
        {/* Order type */}
        <div className="flex gap-1 rounded-xl border border-border bg-canvas p-1">
          <TypeTab active={orderType === 'dine-in'}  icon={<UtensilsCrossed size={13} />} label="Dine In"   onClick={() => setOrderType('dine-in')} />
          <TypeTab active={orderType === 'takeaway'} icon={<ShoppingBag size={13} />}     label="Takeaway"  onClick={() => setOrderType('takeaway')} />
          <TypeTab active={orderType === 'delivery'} icon={<Truck size={13} />}            label="Delivery"  onClick={() => setOrderType('delivery')} />
        </div>

        {/* Order meta form — Dine In */}
        {orderType === 'dine-in' && (
          // Table · guests / name · phone, notes below
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-canvas p-2">
            <select
              aria-label="Table"
              value={dineIn.tableId}
              onChange={e => {
                const t = tables.find(x => x._id === e.target.value);
                setDineIn(d => ({ ...d, tableId: e.target.value, tableNumber: t ? String(t.number) : '' }));
              }}
              className="min-w-0 rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            >
              <option value="">Walk-in / No table</option>
              {tables.map(t => (
                <option key={t._id} value={t._id}>T{t.number} ({t.capacity} pax)</option>
              ))}
            </select>
            <div className="relative min-w-0">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-ink/45">Guests</span>
              <input
                type="number"
                min="1"
                aria-label="Guests"
                value={dineIn.guestCount}
                onChange={e => setDineIn(d => ({ ...d, guestCount: e.target.value }))}
                className="block w-full rounded-lg border border-border py-1.5 pl-14 pr-2 text-xs text-ink outline-none focus:border-brand/50"
              />
            </div>
            <input
              type="text"
              aria-label="Customer name"
              value={dineIn.customerName}
              onChange={e => setDineIn(d => ({ ...d, customerName: e.target.value }))}
              placeholder="Customer name *"
              className="min-w-0 rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
            <input
              type="tel"
              aria-label="Phone"
              value={dineIn.phone}
              onChange={e => setDineIn(d => ({ ...d, phone: e.target.value }))}
              placeholder="Phone *"
              className="min-w-0 rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
            <input
              type="text"
              aria-label="Order notes"
              value={dineIn.notes}
              onChange={e => setDineIn(d => ({ ...d, notes: e.target.value }))}
              placeholder="Order notes…"
              className="col-span-2 min-w-0 rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
          </div>
        )}

        {/* Order meta form — Takeaway */}
        {orderType === 'takeaway' && (
          // Name · phone, notes below
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-canvas p-2">
            <input
              type="text"
              aria-label="Customer name"
              value={takeAway.customerName}
              onChange={e => setTakeAway(d => ({ ...d, customerName: e.target.value }))}
              placeholder="Customer name *"
              className="min-w-0 rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
            <input
              type="tel"
              aria-label="Phone"
              value={takeAway.phone}
              onChange={e => setTakeAway(d => ({ ...d, phone: e.target.value }))}
              placeholder="Phone *"
              className="min-w-0 rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
            <input
              type="text"
              aria-label="Order notes"
              value={takeAway.notes}
              onChange={e => setTakeAway(d => ({ ...d, notes: e.target.value }))}
              placeholder="Order notes…"
              className="col-span-2 min-w-0 rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
          </div>
        )}

        {/* Order meta form — Delivery */}
        {orderType === 'delivery' && (
          <div className="rounded-xl border border-border bg-canvas p-2 space-y-2">
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

        {/* ── Loyalty lookup widget (takeaway / delivery) ──────────────────── */}
        {orderType !== 'dine-in' && (
          loyaltyLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-canvas px-3 py-2 text-[11px] text-ink/40">
              <Loader2 size={12} className="animate-spin" />
              Looking up loyalty…
            </div>
          ) : loyaltyInfo ? (
            <div className="rounded-xl border border-border bg-canvas p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star size={12} className="text-brand" />
                  <span className="text-[11px] font-semibold text-ink">{loyaltyInfo.customer.name}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${
                    loyaltyInfo.customer.tier === 'Platinum' ? 'bg-slate-100 text-slate-700 border-slate-300' :
                    loyaltyInfo.customer.tier === 'Gold'     ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    loyaltyInfo.customer.tier === 'Silver'   ? 'bg-gray-100 text-gray-600 border-gray-200' :
                                                               'bg-orange-50 text-orange-700 border-orange-200'
                  }`}>{loyaltyInfo.customer.tier}</span>
                </div>
                <span className="text-[11px] font-bold tabular-nums text-brand">
                  {(loyaltyInfo.customer as any).orgLoyaltyBalance !== undefined
                    ? <>{((loyaltyInfo.customer as any).orgLoyaltyBalance as number).toLocaleString()} org pts</>
                    : <>{loyaltyInfo.customer.loyaltyBalance.toLocaleString()} pts</>}
                </span>
              </div>
              {loyaltyInfo.customer.loyaltyOptOut ? (
                <p className="text-[10px] text-ink/40">Customer opted out of loyalty</p>
              ) : !isOnline && loyaltyInfo.redeemablePoints > 0 ? (
                <p className="text-[10px] text-amber-600">Loyalty redemption requires an internet connection</p>
              ) : loyaltyInfo.redeemablePoints > 0 && loyaltyInfo.config ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-ink/50">
                    <span>Redeem {loyaltyRedemption} pts → {sym}{Math.round(loyaltyRedemption * (loyaltyInfo.config.pointValueInPaisa / 100))} off</span>
                    <span>Max: {loyaltyInfo.redeemablePoints} pts</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={loyaltyInfo.redeemablePoints}
                    step={loyaltyInfo.config.minimumRedeemPoints || 1}
                    value={loyaltyRedemption}
                    onChange={e => setLoyaltyRedemption(Number(e.target.value))}
                    className="w-full accent-brand"
                    disabled={!isOnline}
                  />
                  {loyaltyRedemption > 0 && (
                    <div className="flex items-center justify-between rounded-lg bg-brand/10 px-2 py-1">
                      <span className="text-[10px] font-medium text-brand">Loyalty discount applied</span>
                      <span className="text-[11px] font-bold text-brand">
                        -{sym}{Math.round(loyaltyRedemption * (loyaltyInfo.config.pointValueInPaisa / 100))}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-ink/40">
                  {loyaltyInfo.redeemablePoints === 0
                    ? (() => {
                        const orgBal = (loyaltyInfo.customer as any).orgLoyaltyBalance;
                        const bal = orgBal !== undefined ? orgBal : loyaltyInfo.customer.loyaltyBalance;
                        return `Balance: ${bal} pts (below minimum redeem threshold)`;
                      })()
                    : 'Loyalty not enabled'}
                </p>
              )}
            </div>
          ) : null
        )}

        {/* Cart header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-ink/40" />
            <span className="text-sm font-semibold text-ink">Order Summary</span>
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
            <p className="text-xs text-ink/40">No items yet. Pick from the menu to start the order.</p>
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
                image={productImages.get(item.productId)}
              />
            ))}
          </div>
        )}

        {/* Discounts & offers (the bill breakdown and total sit in the footer) */}
        {cart.length > 0 && (
          <div className="rounded-xl border border-border bg-canvas p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">Discounts &amp; offers</p>

            <div className="flex items-center gap-2">
              <span className="text-xs text-ink/55 shrink-0">Discount</span>
              {perms.canApplyDiscount ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  placeholder="0"
                  className="flex-1 rounded border border-border bg-mist px-2 py-0.5 text-right text-xs text-ink outline-none focus:border-brand/40"
                />
              ) : (
                <span
                  className="flex-1 rounded border border-border/50 bg-mist/60 px-2 py-0.5 text-right text-xs text-ink/30 cursor-not-allowed"
                  title="You do not have permission to apply discounts"
                >
                  Not permitted
                </span>
              )}
            </div>

            {/* Coupon row */}
            {appliedCoupon ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-emerald-600">{appliedCoupon.code}</span>
                  <button
                    type="button"
                    onClick={() => { setAppliedCoupon(null); setCouponInput(''); setCouponError(null); }}
                    className="text-ink/30 hover:text-red-400"
                    title="Remove coupon"
                  >
                    <X size={11} />
                  </button>
                </div>
                <span className="text-xs font-medium text-emerald-600">-{fmtINR(sym, appliedCoupon.discountAmount)}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink/55 shrink-0">Coupon</span>
                  <input
                    type="text"
                    value={couponInput}
                    onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') void handleApplyCoupon(); }}
                    placeholder="Enter code"
                    className="flex-1 rounded border border-border bg-mist px-2 py-0.5 text-right text-xs font-mono text-ink outline-none focus:border-brand/40 uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => void handleApplyCoupon()}
                    disabled={couponLoading || !couponInput.trim()}
                    className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                  >
                    {couponLoading ? '…' : 'Apply'}
                  </button>
                </div>
                {couponError && <p className="text-[10px] text-red-500 text-right">{couponError}</p>}
              </div>
            )}

            {/* Gift voucher row */}
            {appliedVoucher ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-violet-600">{appliedVoucher.code}</span>
                  <span className="text-[10px] text-ink/40">bal {fmtINR(sym, appliedVoucher.balance)}</span>
                  <button
                    type="button"
                    onClick={() => { setAppliedVoucher(null); setVoucherInput(''); setVoucherError(null); }}
                    className="text-ink/30 hover:text-red-400"
                    title="Remove voucher"
                  >
                    <X size={11} />
                  </button>
                </div>
                <span className="text-xs font-medium text-violet-600">-{fmtINR(sym, voucherDiscountPreview)}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink/55 shrink-0">Voucher</span>
                  <input
                    type="text"
                    value={voucherInput}
                    onChange={e => { setVoucherInput(e.target.value.toUpperCase()); setVoucherError(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') void handleApplyVoucher(); }}
                    placeholder="GV-XXXXXXXX"
                    className="flex-1 rounded border border-border bg-mist px-2 py-0.5 text-right text-xs font-mono text-ink outline-none focus:border-brand/40 uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => void handleApplyVoucher()}
                    disabled={voucherLoading || !voucherInput.trim()}
                    className="shrink-0 rounded border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-40"
                  >
                    {voucherLoading ? '…' : 'Apply'}
                  </button>
                </div>
                {voucherError && <p className="text-[10px] text-red-500 text-right">{voucherError}</p>}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {submitError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
            <AlertCircle size={13} className="text-red-500" />
            <p className="text-xs text-red-600">{submitError}</p>
          </div>
        )}

        {/* Bill footer: payment choice + actions, always visible at the bottom */}
        {cart.length > 0 && (
          <div className="sticky bottom-0 space-y-2 rounded-t-xl border border-b-0 border-border bg-canvas px-2.5 pb-1 pt-2 shadow-[0_-4px_12px_-6px_rgb(100_30_50/0.12)]">
            {/* Bill breakdown + total payable — always in view. Same preview figures as before;
                the server recalculates authoritatively. */}
            <div className="rounded-xl border border-border bg-paper px-3 py-2">
              <div className="space-y-0.5 text-xs text-muted">
                {/* Short screens: subtotal and tax share one line so the ordered items stay visible */}
                <div className="flex justify-between [@media(max-height:820px)]:hidden"><span>Subtotal</span><span className="font-medium text-umber">{fmtINR(sym, subtotal)}</span></div>
                <div className="flex justify-between [@media(max-height:820px)]:hidden"><span>Tax</span><span className="font-medium text-umber">{fmtINR(sym, taxTotal)}</span></div>
                <div className="hidden justify-between [@media(max-height:820px)]:flex">
                  <span>Subtotal <span className="font-medium text-umber">{fmtINR(sym, subtotal)}</span></span>
                  <span>Tax <span className="font-medium text-umber">{fmtINR(sym, taxTotal)}</span></span>
                </div>
                {deliveryChargeAmt > 0 && (
                  <div className="flex justify-between"><span>Delivery charge</span><span className="font-medium text-umber">{fmtINR(sym, deliveryChargeAmt)}</span></div>
                )}
                {subtotal + taxTotal + deliveryChargeAmt - grandTotal > 0.005 && (
                  <div className="flex justify-between text-green-700">
                    <span>Discounts</span>
                    <span className="font-semibold">−{fmtINR(sym, subtotal + taxTotal + deliveryChargeAmt - grandTotal)}</span>
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-border pt-1.5">
                <span className="text-sm font-semibold text-umber">Total payable</span>
                <span className="text-[1.95rem] font-extrabold leading-none tracking-tight text-coffee">{fmtINR(sym, grandTotal)}</span>
              </div>
            </div>
            {/* Payment choice — not for dine-in, which is paid later from Pending Bills */}
            {(orderType !== 'dine-in' || payFirst) && (<>
            <div className="grid grid-cols-4 gap-1.5">
              {(['cash', 'upi', 'card', 'split'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setPayMethod(m); if (m === 'split') setShowPayment(true); }}
                  className={`rounded-lg border py-2 text-xs font-semibold transition ${
                    payMethod === m ? 'border-brand bg-ivory text-brand shadow-sm' : 'border-border bg-canvas text-ink/65 hover:border-mocha/50 hover:bg-ivory'
                  }`}
                >
                  {m === 'upi' ? 'UPI' : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            {payMethod === 'cash' && !showPayment && (
              <button type="button" onClick={() => setShowPayment(true)} className="text-[11px] font-medium text-brand hover:underline">
                Cash received / change
              </button>
            )}
            {showPayment && (
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
                  showMethods={false}
                />
                <button type="button" onClick={() => setShowPayment(false)} className="mt-2 w-full text-center text-[11px] text-ink/40 hover:text-ink/60">
                  Hide
                </button>
              </div>
            )}
            </>)}

            {/* Hold · KOT · KOT & Print  (KOT = Kitchen Order Ticket: sends the order to the kitchen) */}
            {!payFirst && (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                title="Save this cart for later without sending it anywhere"
                onClick={handleHold}
                className="flex flex-col items-center justify-center rounded-xl border border-border bg-ivory py-1.5 text-xs font-semibold text-ink transition hover:bg-beige"
              >
                Hold
                <span className="text-[10px] font-normal opacity-75 [@media(max-height:820px)]:hidden">save for later</span>
              </button>
              <button
                type="button"
                title="Kitchen Order Ticket — sends the order to the kitchen; pay later from Pending Bills"
                onClick={() => void handleConfirmOrder({ pay: false, print: false })}
                disabled={submitting || !canKot}
                aria-busy={submitting}
                className="flex flex-col items-center justify-center rounded-xl border border-border bg-beige py-1.5 text-xs font-semibold text-coffee transition hover:bg-beige/60 disabled:opacity-50"
              >
                KOT
                <span className="text-[10px] font-normal opacity-75 [@media(max-height:820px)]:hidden">send to kitchen</span>
              </button>
              <button
                type="button"
                title="Send to the kitchen and print the customer's bill"
                onClick={() => void handleConfirmOrder({ pay: false, print: true })}
                disabled={submitting || !canKot}
                aria-busy={submitting}
                className="flex flex-col items-center justify-center rounded-xl border border-border bg-beige py-1.5 text-xs font-semibold text-coffee transition hover:bg-beige/60 disabled:opacity-50"
              >
                KOT &amp; Print
                <span className="text-[10px] font-normal opacity-75 [@media(max-height:820px)]:hidden">+ print bill</span>
              </button>
            </div>
            )}

            {/* Pay · Pay & Print */}
            {orderType === 'dine-in' && !payFirst ? (
              <p className="text-center text-[11px] text-ink/50">
                Dine-in: send the KOT now and take payment from Pending Bills.
              </p>
            ) : (
              <div className={`grid gap-2 ${payFirst ? 'grid-cols-[0.8fr_1.2fr_1fr]' : 'grid-cols-2'}`}>
                {payFirst && (
                  <button
                    type="button"
                    title="Save this cart for later without sending it anywhere"
                    onClick={handleHold}
                    className="flex flex-col items-center justify-center rounded-xl border border-border bg-ivory py-1.5 text-xs font-semibold text-ink transition hover:bg-beige"
                  >
                    Hold
                    <span className="text-[10px] font-normal opacity-75 [@media(max-height:820px)]:hidden">save for later</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleConfirmOrder({ pay: true, print: false })}
                  disabled={submitting || !canConfirm}
                  aria-busy={submitting}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-action py-3 text-base font-bold text-white shadow-md transition duration-150 hover:bg-coffee hover:shadow-lg active:bg-action-press active:shadow-sm disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Pay {fmtINR(sym, grandTotal)}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmOrder({ pay: true, print: true })}
                  disabled={submitting || !canConfirm}
                  aria-busy={submitting}
                  className="rounded-xl bg-action py-2.5 text-sm font-semibold text-white shadow-sm transition duration-150 hover:bg-coffee hover:shadow-md active:bg-action-press active:shadow-none disabled:opacity-50"
                >
                  Pay &amp; Print
                </button>
              </div>
            )}
            {payFirst && (
              <p className="text-center text-[11px] text-ink/50">Orders go to the kitchen after payment.</p>
            )}
            {!customerOk && (
              <p className="text-center text-[11px] text-amber-700">Enter the customer name and phone above to continue.</p>
            )}
          </div>
        )}
      </div>

      {/* Modifier dialog — opens on product click */}
      {modifierProduct && (
        <ModifierDialog
          product={modifierProduct}
          sym={sym}
          onConfirm={handleModifierConfirm}
          onClose={() => setModifierProduct(null)}
        />
      )}

      {/* Unknown barcode dialog */}
      {unknownBarcode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas p-5 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <ScanBarcode size={18} className="text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">Unknown Barcode</p>
                <p className="text-xs text-ink/55">No product matched this code</p>
              </div>
            </div>

            <div className="mb-4 rounded-lg border border-border bg-mist px-3 py-2 text-center">
              <span className="font-mono text-sm font-bold tracking-wider text-ink">
                {unknownBarcode}
              </span>
            </div>

            <p className="mb-4 text-xs text-ink/55">
              No product has the short code <span className="font-semibold text-ink">{unknownBarcode}</span>.
              You can search manually or add the product via Menu Management.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearch(unknownBarcode);
                  setUnknownBarcode(null);
                }}
                className="flex-1 rounded-xl border border-brand/30 bg-brand/5 py-2 text-sm font-semibold text-brand transition hover:bg-brand/10"
              >
                Search manually
              </button>
              <button
                type="button"
                onClick={() => setUnknownBarcode(null)}
                className="flex-1 rounded-xl border border-border bg-mist py-2 text-sm font-semibold text-ink/70 transition hover:bg-canvas"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
