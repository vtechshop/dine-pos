import { useState, useEffect, useCallback, useRef } from 'react';
import { X, RefreshCw, Loader2, Users, Unlock } from 'lucide-react';
import type { SessionBill, GuestBill, PaymentMethod, SessionSummary, BillingOrder } from '../../types';
import { fetchSessionBill, billGuest, bulkBillAndClose, markGuestLeft, closeSession } from '../../api/billing';
import type { SplitDetails } from '../../api/billing';
import { cancelOrder } from '../../api/orders';
import { useAuth } from '../../context/AuthContext';
import { sumDue, sumPaidOnline } from '../../utils/counterBilling';
import { GuestPanel } from './GuestPanel';
import { PaymentPanel } from './PaymentPanel';
import { ReceiptView } from './ReceiptView';
import { useSocket } from '../../context/SocketContext';
import { useShortcut } from '../../hooks/useShortcut';

interface Props {
  sessionId: string;
  openSessions: SessionSummary[];
  currencySymbol: string;
  onClose: () => void;
  /** Session was just opened by tapping a free table: if it's still empty when
   *  the drawer is dismissed, close it so a mis-tap doesn't leave it occupied. */
  autoReleaseIfEmpty?: boolean;
}

// Orders that block billing/closing because they're still with the kitchen
const KITCHEN_STATUSES = new Set(['pending', 'preparing', 'ready', 'payment_pending']);

// Socket events that signal stale billing data for this session
const BILLING_EVENTS = [
  'guest_billed', 'guest_updated', 'guests_merged',
  'guest_split', 'guest_transferred', 'guest_reopened', 'guest_added',
];

function elapsedLabel(openedAt: string): string {
  const ms = Date.now() - new Date(openedAt).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function BillingDrawer({ sessionId, openSessions, currencySymbol, onClose: onCloseProp, autoReleaseIfEmpty }: Props) {
  const { socket } = useSocket();
  const { role } = useAuth();

  const [bill, setBill]         = useState<SessionBill | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // Billing workflow
  const [mode, setMode]                 = useState<'guest' | 'table'>('table');
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod]     = useState<PaymentMethod>('cash');
  const [splitDetails, setSplitDetails]       = useState<SplitDetails>({ cash: 0, card: 0, upi: 0 });
  const [paidAmount, setPaidAmount]           = useState(0);
  const [transactionId, setTransactionId]     = useState('');
  const [upiApp, setUpiApp]                   = useState('');
  const [confirming, setConfirming]           = useState(false);
  const [actionError, setActionError]         = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closingTable, setClosingTable]         = useState(false);
  const [showRelease, setShowRelease]           = useState(false);
  const [releasing, setReleasing]               = useState(false);

  // Pulses the Confirm Payment button briefly after a guest is selected via Pay
  const [confirmFlash, setConfirmFlash] = useState(false);

  // Gift voucher applied to the current billing session
  const [appliedVoucher, setAppliedVoucher] = useState<{ code: string; amount: number } | null>(null);

  // Receipt overlay after successful billing
  const [receipt, setReceipt] = useState<{
    mode: 'guest' | 'table';
    guestBill: GuestBill | null;
    orders: BillingOrder[];
    tableLabel: string;
  } | null>(null);

  const loadRef = useRef(false);

  const load = useCallback(async () => {
    if (loadRef.current) return;
    loadRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSessionBill(sessionId);
      setBill(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bill');
    } finally {
      setLoading(false);
      loadRef.current = false;
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // Refresh on relevant socket events for this session
  useEffect(() => {
    if (!socket) return;

    const handler = (data: unknown) => {
      const sid = (data && typeof data === 'object' && 'sessionId' in data)
        ? (data as { sessionId: string }).sessionId
        : null;
      if (!sid || sid !== sessionId) return;
      void load();
    };

    BILLING_EVENTS.forEach(ev => socket.on(ev, handler));
    return () => { BILLING_EVENTS.forEach(ev => socket.off(ev, handler)); };
  }, [socket, sessionId, load]);

  // Reset method-specific fields whenever payment method changes
  useEffect(() => { setPaidAmount(0); setTransactionId(''); setUpiApp(''); }, [paymentMethod]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedGuestBill = bill?.guests.find(gb => gb.guest._id === selectedGuestId) ?? null;
  const activeGuestBills  = bill?.guests.filter(gb => gb.guest.status === 'active') ?? [];
  const activeGuestCount  = activeGuestBills.length;
  const grandTotal        = activeGuestBills.reduce(
    (s, gb) => s + sumDue(gb.orders), 0,
  );

  // Structural states — drive which view the drawer shows
  const isEmptyTable    = bill !== null && bill.guests.length === 0;

  // Every dismiss path (X, backdrop, Esc, after billing) goes through here.
  // The server refuses to close if a guest joined meanwhile (e.g. via QR), so
  // this can never drop a real order — the error is just ignored.
  const onClose = useCallback(() => {
    if (autoReleaseIfEmpty && isEmptyTable) {
      void closeSession(sessionId).catch(() => {}).finally(onCloseProp);
      return;
    }
    onCloseProp();
  }, [autoReleaseIfEmpty, isEmptyTable, sessionId, onCloseProp]);
  const allGuestsBilled = bill !== null && bill.guests.length > 0 && activeGuestCount === 0;

  const guestTotal = selectedGuestBill
    ? sumDue(selectedGuestBill.orders)
    : 0;

  const billingAmount    = mode === 'table' ? grandTotal : guestTotal;
  const netBillingAmount = Math.max(billingAmount - (appliedVoucher?.amount ?? 0), 0);
  const splitSum         = splitDetails.cash + splitDetails.card + splitDetails.upi;
  const splitValid       = Math.abs(splitSum - netBillingAmount) < 0.01;

  // Paid online already — a guest/table whose orders were all prepaid still
  // needs closing out at ₹0 due.
  const paidOnlineTotal = mode === 'table'
    ? activeGuestBills.reduce((s, gb) => s + sumPaidOnline(gb.orders), 0)
    : (selectedGuestBill ? sumPaidOnline(selectedGuestBill.orders) : 0);

  const canConfirm =
    (billingAmount > 0 || paidOnlineTotal > 0) &&
    !confirming &&
    (paymentMethod !== 'split' || splitValid) &&
    (mode === 'table' || !!selectedGuestId);

  const tableLabel = bill
    ? bill.session.tableNumber
    : '…';

  // Release (admin): for tables left open by mistake or with stale orders.
  // Kitchen orders get cancelled; served-but-unpaid orders of active guests
  // are written off as a walk-out (guest marked left), never deleted.
  const releaseKitchenOrders = activeGuestBills.flatMap(gb => gb.orders)
    .filter(o => KITCHEN_STATUSES.has(o.status ?? ''));
  const releaseKitchenTotal  = releaseKitchenOrders.reduce((s, o) => s + o.grandTotal, 0);
  const releaseUnpaidTotal   = activeGuestBills.flatMap(gb => gb.orders)
    .filter(o => !KITCHEN_STATUSES.has(o.status ?? '') && o.status !== 'cancelled')
    .reduce((s, o) => s + o.grandTotal, 0);
  const canRelease = role === 'admin' && bill !== null && !isEmptyTable;

  // Keyboard shortcuts — declared after canConfirm so the enabled flag resolves correctly
  useShortcut('Escape', () => {
    if (showRelease) setShowRelease(false);
    else if (showCloseConfirm) setShowCloseConfirm(false);
    else onClose();
  });
  useShortcut('Enter', () => { void handleConfirm(); }, canConfirm && !confirming && !showCloseConfirm && !showRelease);

  // Payment method key shortcuts (C/K/U/S/M) — not in KeyboardContext; drawer-scoped only
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).matches('input, textarea, select')) return;
      const map: Record<string, PaymentMethod> = {
        c: 'cash', k: 'card', u: 'upi', q: 'upi_qr', o: 'upi_collect', i: 'upi_intent', s: 'split', m: 'complimentary',
      };
      const method = map[e.key.toLowerCase()];
      if (method) { e.preventDefault(); setPaymentMethod(method); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Confirm payment ────────────────────────────────────────────────────────

  async function handleConfirm() {
    if (!canConfirm || confirming) return;

    // For table mode, show confirmation dialog first
    if (mode === 'table' && !showCloseConfirm) {
      setShowCloseConfirm(true);
      return;
    }

    setShowCloseConfirm(false);
    setConfirming(true);
    setActionError(null);

    try {
      if (mode === 'table') {
        await bulkBillAndClose(
          sessionId,
          paymentMethod,
          paymentMethod === 'split' ? splitDetails : undefined,
          transactionId || undefined,
          upiApp || undefined,
          appliedVoucher?.code || undefined,
        );
        setAppliedVoucher(null);
        setReceipt({
          mode: 'table',
          guestBill: null,
          orders: activeGuestBills.flatMap(gb => gb.orders),
          tableLabel,
        });
      } else {
        if (!selectedGuestId || !selectedGuestBill) return;
        const { guest: billedGuest } = await billGuest(sessionId, selectedGuestId, {
          action: 'bill',
          paymentMethod,
          splitDetails: paymentMethod === 'split' ? splitDetails : undefined,
          paidAmount: paymentMethod === 'cash' && paidAmount > 0 ? paidAmount : undefined,
          transactionId: transactionId || undefined,
          upiApp: upiApp || undefined,
          giftVoucherCode: appliedVoucher?.code || undefined,
        });
        setAppliedVoucher(null);
        setReceipt({
          mode: 'guest',
          guestBill: { guest: billedGuest, orders: selectedGuestBill.orders },
          orders: selectedGuestBill.orders,
          tableLabel,
        });
        await load();
        setSelectedGuestId(null);
        setSplitDetails({ cash: 0, card: 0, upi: 0 });
        setPaidAmount(0);
        setTransactionId('');
        setUpiApp('');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setConfirming(false);
    }
  }

  function handleReceiptDone() {
    setReceipt(null);
    if (receipt?.mode === 'table') {
      onClose();
    }
  }

  // ── Close table (empty table or all-guests-billed) ────────────────────────

  async function handleCloseTable() {
    setClosingTable(true);
    setActionError(null);
    try {
      await bulkBillAndClose(sessionId, 'cash');
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to close table');
      setClosingTable(false);
    }
  }

  // ── Release table (admin) ─────────────────────────────────────────────────
  // Uses the normal endpoints so stock, loyalty, coupons etc. are reversed
  // exactly as for a manual cancel. Safe to retry if a step fails midway.

  async function handleRelease() {
    setReleasing(true);
    setActionError(null);
    try {
      for (const o of releaseKitchenOrders) await cancelOrder(o._id);
      for (const gb of activeGuestBills) {
        try {
          await markGuestLeft(sessionId, gb.guest._id);
        } catch (err) {
          // 409 = already left/billed (e.g. a retry) — fine to continue
          if (!(err instanceof Error && /already/i.test(err.message))) throw err;
        }
      }
      await closeSession(sessionId);
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to release table');
      setShowRelease(false);
      setReleasing(false);
      void load();
    }
  }

  // ── Guest select from panel ────────────────────────────────────────────────

  function handleBillGuest(guestId: string) {
    setSelectedGuestId(guestId);
    setMode('guest');
    setSplitDetails({ cash: 0, card: 0, upi: 0 });
    setPaidAmount(0);
    setAppliedVoucher(null);
    setConfirmFlash(true);
    setTimeout(() => setConfirmFlash(false), 1200);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/60" onClick={onClose}>
      <div
        className="relative ml-auto flex h-full w-full max-w-4xl flex-col bg-canvas shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-ink px-5 py-3 text-white">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold">Table {tableLabel}</span>
              {bill && (
                <span className="text-xs text-white/40">
                  · Open {elapsedLabel(bill.session.openedAt)} · {bill.guests.length} guest{bill.guests.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {canRelease && (
            <button
              onClick={() => setShowRelease(true)}
              title="Free this table without billing — for tables left open by mistake"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            >
              <Unlock size={13} />
              Release table
            </button>
          )}

          <button
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh bill"
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={onClose}
            aria-label="Close billing drawer"
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {loading && !bill ? (
          /* Skeleton loaders */
          <div className="flex flex-1 flex-col overflow-hidden sm:flex-row animate-pulse">
            {/* Left skeleton */}
            <div className="flex flex-col gap-3 border-b border-border p-4 sm:w-[55%] sm:border-b-0 sm:border-r">
              <div className="h-2.5 w-20 rounded bg-border" />
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex justify-between">
                    <div className="h-2.5 w-16 rounded bg-border" />
                    <div className="h-2.5 w-14 rounded bg-border" />
                  </div>
                  <div className="h-2.5 w-28 rounded bg-border" />
                  <div className="h-7 w-full rounded-lg bg-border/60" />
                </div>
              ))}
            </div>
            {/* Right skeleton */}
            <div className="flex flex-col gap-4 p-4 sm:w-[45%]">
              <div className="h-2.5 w-16 rounded bg-border" />
              <div className="h-20 rounded-xl bg-border" />
              <div className="flex gap-2">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="flex-1 h-9 rounded-lg bg-border/60" />
                ))}
              </div>
              <div className="h-12 rounded-xl bg-border" />
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={() => void load()}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        ) : isEmptyTable ? (
          /* ── Empty table: no guests, no orders ── */
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink/5">
              <Users size={22} className="text-ink/30" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-ink">No guests on this table</p>
              <p className="text-xs text-ink/50">No orders have been placed yet.</p>
            </div>
            {actionError && (
              <p className="max-w-xs text-xs text-red-600">{actionError}</p>
            )}
            <button
              onClick={() => void handleCloseTable()}
              disabled={closingTable}
              className="mt-1 flex items-center gap-2 rounded-xl border border-border px-6 py-2.5 text-sm font-medium text-ink/60 transition-colors hover:bg-mist disabled:opacity-40"
            >
              {closingTable && <Loader2 size={14} className="animate-spin" />}
              {closingTable ? 'Closing…' : 'Close Table'}
            </button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
            {/* Left: Guest panel */}
            <div className="flex flex-col border-b border-border sm:w-[55%] sm:border-b-0 sm:border-r sm:overflow-hidden">
              {bill && (
                <GuestPanel
                  sessionId={sessionId}
                  guestBills={bill.guests}
                  openSessions={openSessions}
                  currencySymbol={currencySymbol}
                  selectedGuestId={selectedGuestId}
                  onSelectGuest={id => { setSelectedGuestId(id); setMode('guest'); }}
                  onBillGuest={handleBillGuest}
                  onRefresh={() => void load()}
                  disabled={confirming}
                />
              )}
            </div>

            {/* Right: Payment panel or receipt overlay */}
            <div className="flex flex-col sm:w-[45%] sm:overflow-hidden">
              {receipt ? (
                <ReceiptView
                  guest={receipt.guestBill?.guest ?? null}
                  sessionId={sessionId}
                  tableLabel={receipt.tableLabel}
                  orders={receipt.orders}
                  currencySymbol={currencySymbol}
                  isBulk={receipt.mode === 'table'}
                  onDone={handleReceiptDone}
                />
              ) : (
                <>
                  {actionError && (
                    <div className="shrink-0 bg-red-50 px-4 py-2 text-xs text-red-600 border-b border-red-100">
                      {actionError}
                    </div>
                  )}
                  {bill && (
                    <PaymentPanel
                      mode={mode}
                      onModeChange={m => {
                        setMode(m);
                        if (m === 'table') setSelectedGuestId(null);
                        setPaidAmount(0);
                        setTransactionId('');
                        setUpiApp('');
                        setSplitDetails({ cash: 0, card: 0, upi: 0 });
                        setAppliedVoucher(null);
                      }}
                      selectedGuestBill={selectedGuestBill}
                      grandTotal={grandTotal}
                      activeGuestCount={activeGuestCount}
                      currencySymbol={currencySymbol}
                      paymentMethod={paymentMethod}
                      onPaymentMethodChange={setPaymentMethod}
                      splitDetails={splitDetails}
                      onSplitChange={setSplitDetails}
                      paidAmount={paidAmount}
                      onPaidAmountChange={setPaidAmount}
                      transactionId={transactionId}
                      onTransactionIdChange={setTransactionId}
                      upiApp={upiApp}
                      onUpiAppChange={setUpiApp}
                      canConfirm={canConfirm}
                      confirming={confirming}
                      onConfirm={() => void handleConfirm()}
                      confirmFlash={confirmFlash}
                      allGuestsBilled={allGuestsBilled}
                      onCloseTable={() => void handleCloseTable()}
                      closingTable={closingTable}
                      appliedVoucher={appliedVoucher}
                      onVoucherApplied={(code, amount) => setAppliedVoucher({ code, amount })}
                      onVoucherCleared={() => setAppliedVoucher(null)}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Release confirmation dialog */}
      {showRelease && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40" onClick={e => e.stopPropagation()}>
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-2xl">
            <h2 className="mb-1 text-base font-bold text-ink">Release Table {tableLabel}?</h2>
            <p className="mb-4 text-xs text-ink/60">
              Frees the table without taking payment. Use it for tables left open by mistake or with old orders. This can't be undone.
            </p>
            <div className="mb-5 space-y-2 rounded-xl border border-border bg-mist px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-ink/50">Kitchen orders to cancel</span>
                <span className="font-semibold tabular-nums text-ink">
                  {releaseKitchenOrders.length}
                  {releaseKitchenOrders.length > 0 && ` · ${currencySymbol}${releaseKitchenTotal.toLocaleString('en-IN')}`}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink/50">Unpaid guests marked left</span>
                <span className="font-semibold tabular-nums text-ink">{activeGuestCount}</span>
              </div>
              {releaseUnpaidTotal > 0 && (
                <div className="flex justify-between gap-3 border-t border-border pt-2">
                  <span className="font-medium text-red-600">Served but unpaid (not collected)</span>
                  <span className="font-bold tabular-nums text-red-600">
                    {currencySymbol}{releaseUnpaidTotal.toLocaleString('en-IN')}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRelease(false)}
                disabled={releasing}
                className="flex-1 rounded-xl border border-border bg-canvas py-2.5 text-sm font-medium text-ink/70 transition-colors hover:bg-mist disabled:opacity-40"
              >
                Cancel (Esc)
              </button>
              <button
                onClick={() => void handleRelease()}
                disabled={releasing}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-40"
              >
                {releasing && <Loader2 size={14} className="animate-spin" />}
                {releasing ? 'Releasing…' : 'Release'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close confirmation dialog */}
      {showCloseConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40" onClick={e => e.stopPropagation()}>
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-2xl">
            <h2 className="text-base font-bold text-ink mb-1">Close Dining Session?</h2>
            <p className="text-xs text-red-600 mb-4 font-medium">
              This action closes the dining session and cannot be undone.
            </p>
            <div className="rounded-xl bg-mist border border-border px-4 py-3 mb-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink/50">Table</span>
                <span className="font-semibold text-ink">{tableLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/50">Active Guests</span>
                <span className="font-semibold text-ink">{activeGuestCount}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 mt-1">
                <span className="text-ink/70 font-medium">Running Total</span>
                <span className="font-bold text-ink tabular-nums">
                  {currencySymbol}{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink/40">Payment</span>
                <span className="text-ink/60 font-medium capitalize">{paymentMethod}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="flex-1 rounded-xl border border-border bg-canvas py-2.5 text-sm font-medium text-ink/70 hover:bg-mist transition-colors"
              >
                Cancel (Esc)
              </button>
              <button
                onClick={() => void handleConfirm()}
                disabled={confirming}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                {confirming ? 'Processing…' : 'Confirm & Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
