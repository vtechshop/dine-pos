import { useState, useEffect } from 'react';
import {
  Check, X, Loader2, CreditCard, Banknote, Smartphone,
  Star, ChevronDown, ChevronUp, AlertCircle, Search,
} from 'lucide-react';
import { fetchLoyaltyConfig, searchCustomers, fetchCustomer } from '../../api/loyalty';
import { useAuth } from '../../context/AuthContext';
import { Spinner } from '../ui/Spinner';
import { logAuditEntry } from '../../utils/auditLog';
import { getCashierName, getCashierId } from '../../utils/cashierIdentity';
import { getTier, isBirthdayToday, nextTierInfo } from '../../utils/loyaltyUtils';
import type { LoyaltyConfig, CustomerSummary, CustomerProfile } from '../../types/customers';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PayMethod = 'cash' | 'upi' | 'card' | 'split';

export interface PaymentResult {
  method: PayMethod;
  splitDetails?: { cash: number; upi: number; card: number };
  cashGiven: number;
  tipAmount: number;
  roundOff: number;
  additionalDiscount: number;
  loyaltyPointsRedeemed: number;
  loyaltyDiscountAmount: number;
  paymentRef: string;
  finalTotal: number;
}

export interface PaymentModalProps {
  sym: string;
  orderNumber?: string;
  tableNumber?: string;
  customerName?: string;
  items: { productName: string; quantity: number; price: number }[];
  subtotal: number;
  taxTotal: number;
  appliedDiscount: number;
  onConfirm: (result: PaymentResult) => Promise<void>;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  const rounded = Math.abs(Math.round(n));
  return `${sym}${rounded.toLocaleString('en-IN')}`;
}

function fmtSign(n: number, sym: string) {
  const sign = n < 0 ? '-' : n > 0 ? '+' : '';
  return `${sign}${sym}${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

// ── Row in the bill summary ───────────────────────────────────────────────────

function SumRow({
  label, value, sub, accent, bold, negative,
}: {
  label: string; value: string; sub?: string;
  accent?: boolean; bold?: boolean; negative?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between ${bold ? 'pt-2 mt-1 border-t border-border' : ''}`}>
      <div>
        <span className={`text-xs ${bold ? 'font-semibold text-ink' : 'text-ink/55'}`}>{label}</span>
        {sub && <span className="ml-1 text-[10px] text-ink/35">{sub}</span>}
      </div>
      <span className={`tabular-nums text-xs ${
        bold    ? 'text-base font-bold text-brand' :
        accent  ? 'font-semibold text-brand' :
        negative ? 'font-medium text-emerald-600' :
                  'font-medium text-ink'
      }`}>
        {value}
      </span>
    </div>
  );
}

// ── Method tab button ─────────────────────────────────────────────────────────

function MethodTab({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
        active ? 'bg-brand text-white shadow-sm' : 'text-ink/60 hover:bg-mist'
      }`}
    >
      {icon}{label}
    </button>
  );
}

// ── Loyalty section ───────────────────────────────────────────────────────────

function LoyaltySection({
  config, sym, finalBeforeLoyalty,
  customer, setCustomer,
  phone, setPhone,
  points, setPoints,
  searching, setSearching,
}: {
  config: LoyaltyConfig; sym: string; finalBeforeLoyalty: number;
  customer: CustomerSummary | null; setCustomer: (c: CustomerSummary | null) => void;
  phone: string; setPhone: (v: string) => void;
  points: string; setPoints: (v: string) => void;
  searching: boolean; setSearching: (v: boolean) => void;
}) {
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);

  async function doSearch() {
    if (!phone.trim()) return;
    setSearching(true);
    setNotFound(false);
    setProfile(null);
    try {
      const res = await searchCustomers({ phone: phone.trim(), limit: 1 });
      if (res.customers.length > 0) {
        const found = res.customers[0];
        setCustomer(found);
        setNotFound(false);
        // Fetch full profile for birthday + visitCount
        fetchCustomer(found._id)
          .then(r => setProfile(r.customer))
          .catch(() => {});
      } else {
        setCustomer(null);
        setNotFound(true);
      }
    } catch { setCustomer(null); }
    finally { setSearching(false); }
  }

  function handleClear() {
    setCustomer(null);
    setPoints('');
    setProfile(null);
  }

  const maxPts = customer
    ? Math.min(
        customer.loyaltyBalance,
        Math.floor((finalBeforeLoyalty * config.maximumRedeemPercent / 100) / (config.pointValueInPaisa / 100)),
      )
    : 0;

  const discount = (Math.min(parseInt(points) || 0, maxPts) * config.pointValueInPaisa) / 100;

  const tierCfg     = customer ? getTier(customer.lifetimeSpend) : null;
  const isBirthday  = profile ? isBirthdayToday(profile.birthday) : false;
  const nextTier    = customer ? nextTierInfo(customer.lifetimeSpend) : null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Star size={12} className="fill-amber-400 text-amber-400" />
        <p className="text-xs font-semibold text-amber-800">Loyalty Points</p>
      </div>

      {!customer ? (
        <div className="flex gap-1.5">
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void doSearch(); }}
            placeholder="Customer phone…"
            className="flex-1 rounded-lg border border-border px-3 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
          />
          <button
            type="button"
            onClick={() => void doSearch()}
            disabled={searching || !phone.trim()}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {searching ? <Spinner size="sm" /> : <Search size={12} />}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Customer header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                tierCfg ? `${tierCfg.bg} ${tierCfg.text}` : 'bg-brand/10 text-brand'
              }`}>
                {tierCfg?.icon ?? customer.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs font-semibold text-ink truncate">{customer.name}</p>
                  {isBirthday && (
                    <span className="rounded-full bg-pink-100 px-1.5 py-0.5 text-[9px] font-bold text-pink-600">
                      🎂 Birthday!
                    </span>
                  )}
                  {tierCfg && (
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${tierCfg.border} ${tierCfg.text}`}>
                      {tierCfg.tier}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <p className="text-[10px] text-ink/50">{customer.loyaltyBalance} {config.rewardName}</p>
                  {customer.visitCount > 0 && (
                    <p className="text-[10px] text-ink/40">{customer.visitCount} visits</p>
                  )}
                  {customer.lifetimeSpend > 0 && (
                    <p className="text-[10px] text-ink/40">{fmtINR(sym, customer.lifetimeSpend)} spend</p>
                  )}
                </div>
              </div>
            </div>
            <button type="button" onClick={handleClear}
              className="text-ink/30 hover:text-ink/60 shrink-0"><X size={13} /></button>
          </div>

          {/* Birthday offer note */}
          {isBirthday && (
            <div className="rounded-lg border border-pink-200 bg-pink-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-pink-700">🎂 Birthday offer available!</p>
              <p className="text-[10px] text-pink-600/80 mt-0.5">
                Discount % requires backend: GET /loyalty/config → birthdayDiscountPercent
              </p>
            </div>
          )}

          {/* Next tier progress */}
          {nextTier && (
            <p className="text-[10px] text-ink/45">
              {fmtINR(sym, nextTier.remaining)} more to reach {nextTier.nextTier}
            </p>
          )}

          {/* Points redemption */}
          {maxPts >= config.minimumRedeemPoints ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={maxPts}
                  value={points}
                  onChange={e => setPoints(e.target.value)}
                  placeholder={`0–${maxPts} pts`}
                  className="flex-1 rounded-lg border border-border px-2 py-1 text-xs text-ink outline-none focus:border-brand/50"
                />
                <button type="button" onClick={() => setPoints(String(maxPts))}
                  className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                  Use Max
                </button>
              </div>
              {discount > 0 && (
                <p className="text-[11px] font-semibold text-emerald-600">
                  = -{fmtINR(sym, discount)} discount
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-ink/50">
              Min {config.minimumRedeemPoints} {config.rewardName} required to redeem
            </p>
          )}
        </div>
      )}

      {notFound && !customer && (
        <p className="text-[11px] text-amber-700">No customer found with this number</p>
      )}
    </div>
  );
}

// ── Success screen ────────────────────────────────────────────────────────────

function SuccessScreen({
  sym, finalTotal, method, cashGiven, onDone,
}: {
  sym: string; finalTotal: number; method: PayMethod; cashGiven: number; onDone: () => void;
}) {
  const change = cashGiven - finalTotal;

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 px-6 text-center">
      <div className="rounded-full bg-emerald-100 p-5">
        <Check size={36} className="text-emerald-600" />
      </div>
      <div>
        <p className="text-xl font-bold text-ink">Payment Received</p>
        <p className="text-sm text-ink/50 mt-0.5">{fmtINR(sym, finalTotal)} via {method.toUpperCase()}</p>
      </div>
      {method === 'cash' && change > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-3 w-full max-w-xs">
          <p className="text-xs text-emerald-700">Return change to customer</p>
          <p className="text-2xl font-bold text-emerald-700">{fmtINR(sym, change)}</p>
        </div>
      )}
      <button
        type="button"
        onClick={onDone}
        className="mt-2 w-full max-w-xs rounded-xl bg-brand py-3 text-sm font-semibold text-white hover:bg-brand/90"
      >
        Done
      </button>
    </div>
  );
}

// ── Main PaymentModal ─────────────────────────────────────────────────────────

export function PaymentModal({
  sym, orderNumber, tableNumber, customerName,
  items, subtotal, taxTotal, appliedDiscount,
  onConfirm, onClose,
}: PaymentModalProps) {
  const { hotelId } = useAuth();

  // Payment method
  const [method, setMethod] = useState<PayMethod>('cash');
  const [cashGiven, setCashGiven] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [splitUpi, setSplitUpi] = useState('');
  const [splitCard, setSplitCard] = useState('');
  const [payRef, setPayRef] = useState('');

  // Adjustments
  const [tip, setTip] = useState('');
  const [addDiscount, setAddDiscount] = useState('');
  const [showAdj, setShowAdj] = useState(false);

  // Loyalty
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig | null>(null);
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<CustomerSummary | null>(null);
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyPoints, setLoyaltyPoints] = useState('');
  const [loyaltySearching, setLoyaltySearching] = useState(false);
  const [showLoyalty, setShowLoyalty] = useState(false);

  // State
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchLoyaltyConfig()
      .then(res => setLoyaltyConfig(res.config))
      .catch(() => {});
  }, []);

  // ── Calculations ────────────────────────────────────────────────────────────
  const tipAmt         = Math.max(0, parseFloat(tip) || 0);
  const addDiscAmt     = Math.max(0, parseFloat(addDiscount) || 0);
  const ptsClamped     = Math.max(0, parseInt(loyaltyPoints) || 0);

  const maxPts = loyaltyConfig && loyaltyCustomer
    ? Math.min(
        loyaltyCustomer.loyaltyBalance,
        Math.floor(
          ((subtotal + taxTotal - appliedDiscount - addDiscAmt + tipAmt) * loyaltyConfig.maximumRedeemPercent / 100)
          / (loyaltyConfig.pointValueInPaisa / 100),
        ),
      )
    : 0;

  const pointsToRedeem   = Math.min(ptsClamped, maxPts);
  const loyaltyDiscAmt   = loyaltyConfig
    ? (pointsToRedeem * loyaltyConfig.pointValueInPaisa) / 100
    : 0;

  const preRound  = subtotal + taxTotal - appliedDiscount - addDiscAmt - loyaltyDiscAmt + tipAmt;
  const roundOff  = Math.round(preRound) - preRound;
  const finalTotal = Math.max(0, preRound + roundOff);

  // Validation
  const cashGivenAmt = parseFloat(cashGiven) || 0;
  const cashChange   = cashGivenAmt - finalTotal;
  const splitSum     = (parseFloat(splitCash) || 0) + (parseFloat(splitUpi) || 0) + (parseFloat(splitCard) || 0);
  const splitDiff    = splitSum - finalTotal;

  const loyaltyOk = !loyaltyConfig || pointsToRedeem === 0 ||
    (loyaltyConfig && pointsToRedeem >= loyaltyConfig.minimumRedeemPoints && pointsToRedeem <= maxPts);

  const canConfirm = (
    (method === 'cash'  ? cashGivenAmt >= finalTotal : true) &&
    (method === 'split' ? Math.abs(splitDiff) < 0.5  : true) &&
    loyaltyOk
  );

  // ── Confirm ─────────────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!canConfirm) return;
    setConfirming(true);
    setError(null);
    const result: PaymentResult = {
      method,
      splitDetails: method === 'split' ? {
        cash: parseFloat(splitCash) || 0,
        upi:  parseFloat(splitUpi)  || 0,
        card: parseFloat(splitCard) || 0,
      } : undefined,
      cashGiven: cashGivenAmt,
      tipAmount: tipAmt,
      roundOff,
      additionalDiscount: addDiscAmt,
      loyaltyPointsRedeemed: pointsToRedeem,
      loyaltyDiscountAmount: loyaltyDiscAmt,
      paymentRef: payRef.trim(),
      finalTotal,
    };
    try {
      await onConfirm(result);
      if (hotelId) {
        logAuditEntry(hotelId, {
          action: 'payment_completed',
          detail: `Order ${orderNumber ?? '?'} · ${method.toUpperCase()} · ${fmtINR(sym, finalTotal)}`,
          cashierName: getCashierName(),
          cashierId: getCashierId(),
          timestamp: new Date().toISOString(),
        });
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setConfirming(false);
    }
  }

  // ── Cash presets ─────────────────────────────────────────────────────────────
  const PRESETS = [50, 100, 200, 500, 1000, 2000].filter(p => p <= finalTotal * 2 || p <= 500);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3 backdrop-blur-sm">
      <div className="relative flex w-full max-w-3xl flex-col rounded-2xl border border-border bg-canvas shadow-2xl max-h-[95vh]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
          <div>
            <p className="text-sm font-bold text-ink">
              {done ? 'Payment Complete' : 'Take Payment'}
            </p>
            {!done && (
              <p className="text-xs text-ink/50">
                {[orderNumber && `#${orderNumber}`, tableNumber && `Table ${tableNumber}`, customerName].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        {done ? (
          <SuccessScreen
            sym={sym}
            finalTotal={finalTotal}
            method={method}
            cashGiven={cashGivenAmt}
            onDone={onClose}
          />
        ) : (
          <div className="flex min-h-0 flex-col overflow-hidden md:flex-row">

            {/* ── Left: Bill summary ─────────────────────────────────────── */}
            <div className="shrink-0 overflow-y-auto border-b border-border bg-mist/30 p-4 md:w-56 md:border-b-0 md:border-r">
              {/* Items */}
              <div className="space-y-0.5 max-h-28 overflow-y-auto mb-3">
                {items.map((it, i) => (
                  <div key={i} className="flex items-start justify-between gap-2">
                    <p className="text-[11px] text-ink/65 leading-tight flex-1">{it.productName} × {it.quantity}</p>
                    <p className="text-[11px] font-medium text-ink shrink-0">{fmtINR(sym, it.price * it.quantity)}</p>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-1.5">
                <SumRow label="Subtotal"        value={fmtINR(sym, subtotal)} />
                <SumRow label="Tax"             value={fmtINR(sym, taxTotal)} />
                {appliedDiscount > 0 && (
                  <SumRow label="Discount"      value={`-${fmtINR(sym, appliedDiscount)}`} negative />
                )}
                {addDiscAmt > 0 && (
                  <SumRow label="Extra Discount" value={`-${fmtINR(sym, addDiscAmt)}`} negative />
                )}
                {loyaltyDiscAmt > 0 && (
                  <SumRow label="Loyalty"        value={`-${fmtINR(sym, loyaltyDiscAmt)}`} negative sub={`(${pointsToRedeem} pts)`} />
                )}
                {tipAmt > 0 && (
                  <SumRow label="Tip"           value={`+${fmtINR(sym, tipAmt)}`} />
                )}
                {Math.abs(roundOff) >= 0.01 && (
                  <SumRow label="Round Off"     value={fmtSign(roundOff, sym)} sub="auto" />
                )}
                <SumRow label="Grand Total"     value={fmtINR(sym, finalTotal)} bold accent />
              </div>
            </div>

            {/* ── Right: Payment ─────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Method tabs */}
              <div className="flex gap-1 rounded-xl border border-border bg-mist p-1">
                <MethodTab active={method === 'cash'}  icon={<Banknote size={12} />}    label="Cash"  onClick={() => setMethod('cash')} />
                <MethodTab active={method === 'upi'}   icon={<Smartphone size={12} />}  label="UPI"   onClick={() => setMethod('upi')} />
                <MethodTab active={method === 'card'}  icon={<CreditCard size={12} />}  label="Card"  onClick={() => setMethod('card')} />
                <MethodTab active={method === 'split'} icon={<span className="text-[10px] font-bold">÷</span>} label="Split" onClick={() => setMethod('split')} />
              </div>

              {/* Cash inputs */}
              {method === 'cash' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map(p => (
                      <button key={p} type="button" onClick={() => setCashGiven(String(p))}
                        className="rounded border border-border bg-mist px-2.5 py-1 text-xs font-medium text-ink hover:bg-canvas">
                        {sym}{p}
                      </button>
                    ))}
                    <button type="button" onClick={() => setCashGiven(String(Math.ceil(finalTotal)))}
                      className="rounded border border-brand/30 bg-brand/5 px-2.5 py-1 text-xs font-semibold text-brand">
                      Exact
                    </button>
                  </div>
                  <input
                    type="number"
                    value={cashGiven}
                    onChange={e => setCashGiven(e.target.value)}
                    placeholder={`Amount given (min ${fmtINR(sym, finalTotal)})`}
                    className="w-full rounded-xl border border-border px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                    autoFocus
                  />
                  {cashGiven && cashGivenAmt > 0 && (
                    <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${
                      cashChange >= 0
                        ? 'bg-emerald-50 border border-emerald-200'
                        : 'bg-red-50 border border-red-100'
                    }`}>
                      <span className="text-sm font-medium">{cashChange >= 0 ? 'Return Change' : 'Short by'}</span>
                      <span className={`text-xl font-bold ${cashChange >= 0 ? 'text-emerald-700' : 'text-red-500'}`}>
                        {fmtINR(sym, Math.abs(cashChange))}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* UPI inputs */}
              {method === 'upi' && (
                <div className="space-y-2">
                  <div className="rounded-xl border border-border bg-mist px-4 py-3 text-center">
                    <p className="text-xs text-ink/60">Customer scans UPI QR or transfers</p>
                    <p className="text-xl font-bold text-ink mt-0.5">{fmtINR(sym, finalTotal)}</p>
                  </div>
                  <input
                    type="text"
                    value={payRef}
                    onChange={e => setPayRef(e.target.value)}
                    placeholder="UPI Transaction Reference (optional)"
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
                  />
                </div>
              )}

              {/* Card inputs */}
              {method === 'card' && (
                <div className="space-y-2">
                  <div className="rounded-xl border border-border bg-mist px-4 py-3 text-center">
                    <p className="text-xs text-ink/60">Swipe / tap card on terminal</p>
                    <p className="text-xl font-bold text-ink mt-0.5">{fmtINR(sym, finalTotal)}</p>
                  </div>
                  <input
                    type="text"
                    value={payRef}
                    onChange={e => setPayRef(e.target.value)}
                    placeholder="Card Approval / Transaction ID (optional)"
                    className="w-full rounded-xl border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
                  />
                </div>
              )}

              {/* Split inputs */}
              {method === 'split' && (
                <div className="space-y-2">
                  {(['cash', 'upi', 'card'] as const).map(k => (
                    <div key={k} className="flex items-center gap-2">
                      <label className="w-10 text-xs font-semibold capitalize text-ink/60">{k}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={k === 'cash' ? splitCash : k === 'upi' ? splitUpi : splitCard}
                        onChange={e => {
                          if (k === 'cash') setSplitCash(e.target.value);
                          else if (k === 'upi') setSplitUpi(e.target.value);
                          else setSplitCard(e.target.value);
                        }}
                        className="flex-1 rounded-xl border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
                      />
                    </div>
                  ))}
                  <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${
                    Math.abs(splitDiff) < 0.5
                      ? 'bg-emerald-50 border border-emerald-200'
                      : 'bg-amber-50 border border-amber-200'
                  }`}>
                    <span className="text-xs font-medium">
                      {Math.abs(splitDiff) < 0.5 ? '✓ Balanced'
                        : splitDiff > 0 ? 'Over by'
                        : 'Short by'}
                    </span>
                    <span className={`text-sm font-bold ${Math.abs(splitDiff) < 0.5 ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {Math.abs(splitDiff) < 0.5 ? '' : fmtINR(sym, Math.abs(splitDiff))}
                    </span>
                  </div>
                </div>
              )}

              {/* ── Adjustments section ────────────────────────────────────── */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdj(v => !v)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-mist/60 px-3 py-2 text-xs font-semibold text-ink/60 hover:bg-mist"
                >
                  <span>Tip &amp; Discount</span>
                  {showAdj ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {showAdj && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block mb-0.5 text-[10px] font-medium text-ink/50">Extra Discount ({sym})</label>
                      <input
                        type="number"
                        min="0"
                        value={addDiscount}
                        onChange={e => setAddDiscount(e.target.value)}
                        placeholder="0"
                        className="w-full rounded-lg border border-border px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand/50"
                      />
                    </div>
                    <div>
                      <label className="block mb-0.5 text-[10px] font-medium text-ink/50">
                        Tip ({sym})
                        <span className="ml-1 text-ink/35">• local only</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={tip}
                        onChange={e => setTip(e.target.value)}
                        placeholder="0"
                        className="w-full rounded-lg border border-border px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand/50"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Loyalty section ────────────────────────────────────────── */}
              {loyaltyConfig && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowLoyalty(v => !v)}
                    className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                  >
                    <div className="flex items-center gap-1.5">
                      <Star size={11} className="fill-amber-400 text-amber-400" />
                      Redeem {loyaltyConfig.rewardName}
                    </div>
                    {showLoyalty ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {showLoyalty && (
                    <div className="mt-2">
                      <LoyaltySection
                        config={loyaltyConfig}
                        sym={sym}
                        finalBeforeLoyalty={subtotal + taxTotal - appliedDiscount - addDiscAmt + tipAmt}
                        customer={loyaltyCustomer}
                        setCustomer={setLoyaltyCustomer}
                        phone={loyaltyPhone}
                        setPhone={setLoyaltyPhone}
                        points={loyaltyPoints}
                        setPoints={setLoyaltyPoints}
                        searching={loyaltySearching}
                        setSearching={setLoyaltySearching}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Backend-gated: Wallet / Credit */}
              <div className="rounded-lg border border-dashed border-border px-3 py-2">
                <p className="text-[10px] text-ink/35">
                  Wallet &amp; Credit payment — requires backend: add
                  <code className="mx-1 rounded bg-mist px-1 text-[9px]">'wallet'|'credit'</code>
                  to PaymentMethod union in shared types.
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                  <AlertCircle size={13} className="text-red-500" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer (only shown before done) */}
        {!done && (
          <div className="flex items-center gap-2 border-t border-border px-5 py-3 shrink-0">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-ink/70 hover:bg-mist">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirming || !canConfirm}
              className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {confirming
                ? <><Loader2 size={14} className="animate-spin" /> Processing…</>
                : <><Check size={14} /> Confirm {fmtINR(sym, finalTotal)}</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
