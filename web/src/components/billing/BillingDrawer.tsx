import { useState, useEffect, useCallback, useRef } from 'react';
import { X, RefreshCw } from 'lucide-react';
import type { SessionBill, GuestBill, PaymentMethod, SessionSummary, BillingOrder } from '../../types';
import { fetchSessionBill, billGuest, bulkBillAndClose } from '../../api/billing';
import type { SplitDetails } from '../../api/billing';
import { GuestPanel } from './GuestPanel';
import { PaymentPanel } from './PaymentPanel';
import { ReceiptView } from './ReceiptView';
import { Spinner } from '../ui/Spinner';
import { useSocket } from '../../context/SocketContext';
import { useShortcut } from '../../hooks/useShortcut';

interface Props {
  sessionId: string;
  openSessions: SessionSummary[];
  currencySymbol: string;
  onClose: () => void;
}

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

export function BillingDrawer({ sessionId, openSessions, currencySymbol, onClose }: Props) {
  const { socket } = useSocket();

  const [bill, setBill]         = useState<SessionBill | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // Billing workflow
  const [mode, setMode]                 = useState<'guest' | 'table'>('table');
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod]     = useState<PaymentMethod>('cash');
  const [splitDetails, setSplitDetails]       = useState<SplitDetails>({ cash: 0, card: 0, upi: 0 });
  const [confirming, setConfirming]           = useState(false);
  const [actionError, setActionError]         = useState<string | null>(null);

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
    if (!socket || !bill) return;

    const handler = (data: unknown) => {
      const sid = (data && typeof data === 'object' && 'sessionId' in data)
        ? (data as { sessionId: string }).sessionId
        : null;
      if (!sid || sid !== sessionId) return;
      void load();
    };

    BILLING_EVENTS.forEach(ev => socket.on(ev, handler));
    return () => { BILLING_EVENTS.forEach(ev => socket.off(ev, handler)); };
  }, [socket, bill, sessionId, load]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedGuestBill = bill?.guests.find(gb => gb.guest._id === selectedGuestId) ?? null;
  const activeGuestBills  = bill?.guests.filter(gb => gb.guest.status === 'active') ?? [];
  const activeGuestCount  = activeGuestBills.length;
  const grandTotal        = activeGuestBills.reduce(
    (s, gb) => s + gb.orders.reduce((os, o) => os + o.grandTotal, 0), 0,
  );

  const guestTotal = selectedGuestBill
    ? selectedGuestBill.orders.reduce((s, o) => s + o.grandTotal, 0)
    : 0;

  const billingAmount = mode === 'table' ? grandTotal : guestTotal;
  const splitSum      = splitDetails.cash + splitDetails.card + splitDetails.upi;
  const splitValid    = Math.abs(splitSum - billingAmount) < 0.01;

  const canConfirm =
    billingAmount > 0 &&
    !confirming &&
    (paymentMethod !== 'split' || splitValid) &&
    (mode === 'table' || !!selectedGuestId);

  const tableLabel = bill
    ? bill.session.tableNumber
    : '…';

  // Keyboard shortcuts — declared after canConfirm so the enabled flag resolves correctly
  useShortcut('Escape', onClose);
  useShortcut('Enter', () => { void handleConfirm(); }, canConfirm && !confirming);

  // Payment method key shortcuts (C/K/U/S/M) — not in KeyboardContext; drawer-scoped only
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).matches('input, textarea, select')) return;
      const map: Record<string, PaymentMethod> = {
        c: 'cash', k: 'card', u: 'upi', s: 'split', m: 'complimentary',
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
    setConfirming(true);
    setActionError(null);

    try {
      if (mode === 'table') {
        await bulkBillAndClose(sessionId, paymentMethod);
        setReceipt({
          mode: 'table',
          guestBill: null,
          orders: activeGuestBills.flatMap(gb => gb.orders),
          tableLabel,
        });
      } else {
        if (!selectedGuestId || !selectedGuestBill) return;
        await billGuest(sessionId, selectedGuestId, {
          action: 'bill',
          paymentMethod,
          splitDetails: paymentMethod === 'split' ? splitDetails : undefined,
        });
        setReceipt({
          mode: 'guest',
          guestBill: selectedGuestBill,
          orders: selectedGuestBill.orders,
          tableLabel,
        });
        await load();
        setSelectedGuestId(null);
        setSplitDetails({ cash: 0, card: 0, upi: 0 });
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

  // ── Guest select from panel ────────────────────────────────────────────────

  function handleBillGuest(guestId: string) {
    setSelectedGuestId(guestId);
    setMode('guest');
    setSplitDetails({ cash: 0, card: 0, upi: 0 });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/60" onClick={onClose}>
      <div
        className="ml-auto flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-gray-900 px-5 py-3 text-white">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold">{tableLabel}</span>
              {bill && (
                <span className="text-xs text-gray-400">
                  · Open {elapsedLabel(bill.session.openedAt)}
                  · {bill.guests.length} guest{bill.guests.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-700 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-700"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {loading && !bill ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size="lg" />
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
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: Guest panel */}
            <div className="flex w-[55%] flex-col overflow-hidden border-r border-gray-200">
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
            <div className="flex w-[45%] flex-col overflow-hidden">
              {receipt ? (
                <ReceiptView
                  guest={receipt.guestBill?.guest ?? null}
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
                      onModeChange={m => { setMode(m); if (m === 'table') setSelectedGuestId(null); }}
                      selectedGuestBill={selectedGuestBill}
                      grandTotal={grandTotal}
                      activeGuestCount={activeGuestCount}
                      currencySymbol={currencySymbol}
                      paymentMethod={paymentMethod}
                      onPaymentMethodChange={setPaymentMethod}
                      splitDetails={splitDetails}
                      onSplitChange={setSplitDetails}
                      canConfirm={canConfirm}
                      confirming={confirming}
                      onConfirm={() => void handleConfirm()}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
