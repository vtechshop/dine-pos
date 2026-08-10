import { useState } from 'react';
import { ChevronDown, ChevronUp, GitMerge, ArrowRightLeft, UserMinus, MoreHorizontal } from 'lucide-react';
import type { Guest, BillingOrder } from '../../types';

interface Props {
  guest: Guest;
  orders: BillingOrder[];
  currencySymbol: string;
  selected: boolean;
  onSelect: () => void;
  onBill: () => void;
  onMarkLeft: () => Promise<void>;
  onMerge: () => void;
  onTransfer: () => void;
  disabled?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  billed:    'bg-ink/10 text-ink/55',
  left:      'bg-ink/10 text-ink/45',
  cancelled: 'bg-red-100 text-red-500',
};

function fmt(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function GuestCard({ guest, orders, currencySymbol, selected, onSelect, onBill, onMarkLeft, onMerge, onTransfer, disabled }: Props) {
  const allItems   = orders.flatMap(o => o.items);
  // Expand by default when the guest already has items so staff can review the order
  const [expanded,       setExpanded]       = useState(() => allItems.length > 0);
  const [leftBusy,       setLeftBusy]       = useState(false);
  const [confirmingLeft, setConfirmingLeft] = useState(false);
  const [showOverflow,   setShowOverflow]   = useState(false);

  const isActive   = guest.status === 'active';
  const isBilled   = guest.status === 'billed';
  const subtotal   = orders.reduce((s, o) => s + (o.subtotal  ?? 0), 0);
  const taxTotal   = orders.reduce((s, o) => s + (o.taxTotal  ?? 0), 0);
  const grandTotal = orders.reduce((s, o) => s + (o.grandTotal ?? 0), 0);

  async function handleLeft() {
    setLeftBusy(true);
    try { await onMarkLeft(); } finally {
      setLeftBusy(false);
      setConfirmingLeft(false);
    }
  }

  return (
    <div
      className={`rounded-xl border transition-all ${
        selected
          ? 'border-brand bg-brand/5 shadow-sm'
          : 'border-border bg-canvas hover:border-border/70'
      } ${isActive ? 'cursor-pointer' : ''}`}
      onClick={() => isActive && onSelect()}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_COLORS[guest.status]}`}>
          {guest.status === 'active' ? 'Active' : guest.status === 'billed' ? 'Billed' : guest.status}
        </div>
        <span className="flex-1 truncate text-sm font-medium text-ink">{guest.displayLabel}</span>
        <span className="text-sm font-semibold tabular-nums text-ink">{fmt(grandTotal, currencySymbol)}</span>
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          className="ml-1 rounded-md p-1 text-ink/40 hover:bg-mist"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded: items + totals */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1" onClick={e => e.stopPropagation()}>
          {allItems.length === 0 ? (
            <p className="text-xs text-ink/40">No orders yet</p>
          ) : (
            allItems.map((item, i) => (
              <div key={i} className="flex justify-between text-xs text-ink/65">
                <span>{item.productName} ×{item.quantity}</span>
                <span className="tabular-nums">{fmt(item.total ?? item.price * item.quantity, currencySymbol)}</span>
              </div>
            ))
          )}
          {taxTotal > 0 && (
            <div className="flex justify-between text-xs text-ink/40 pt-1 border-t border-dashed border-border/60">
              <span>Sub / Tax</span>
              <span className="tabular-nums">{fmt(subtotal, currencySymbol)} / {fmt(taxTotal, currencySymbol)}</span>
            </div>
          )}
        </div>
      )}

      {/* Billed notice */}
      {isBilled && (
        <div className="border-t border-border bg-mist px-3 py-1.5 rounded-b-xl text-xs text-ink/60">
          Paid via {guest.paymentMethod ?? '—'}
          {guest.billedAt && ` · ${new Date(guest.billedAt).toLocaleTimeString('en-IN', { timeStyle: 'short' })}`}
        </div>
      )}

      {/* Action buttons — active guests only */}
      {isActive && (
        <div
          className="border-t border-border px-3 py-2 space-y-1.5"
          onClick={e => e.stopPropagation()}
        >
          {confirmingLeft ? (
            <>
              <p className="text-xs font-medium text-amber-700">Mark as left? They won't be billed.</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setConfirmingLeft(false)}
                  className="flex-1 rounded-lg border border-border py-1.5 text-xs font-medium text-ink/60 transition-colors hover:bg-mist"
                >
                  Cancel
                </button>
                <button
                  disabled={disabled || leftBusy}
                  onClick={handleLeft}
                  className="flex-1 rounded-lg bg-amber-600 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-40"
                >
                  {leftBusy ? '…' : 'Yes, Mark Left'}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                disabled={disabled}
                onClick={onBill}
                className="w-full rounded-lg bg-brand py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-40"
              >
                Pay
              </button>
              <div className="flex gap-1.5">
                <button
                  disabled={disabled}
                  onClick={() => setConfirmingLeft(true)}
                  className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-ink/60 transition-colors hover:bg-mist disabled:opacity-40"
                >
                  <UserMinus size={11} /> Left
                </button>
                <div className="relative ml-auto">
                  <button
                    disabled={disabled}
                    onClick={() => setShowOverflow(v => !v)}
                    className="flex items-center rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-ink/50 transition-colors hover:bg-mist disabled:opacity-40"
                  >
                    <MoreHorizontal size={13} />
                  </button>
                  {showOverflow && (
                    <div className="absolute right-0 bottom-full z-10 mb-1 w-28 rounded-lg border border-border bg-canvas py-1 shadow-lg">
                      <button
                        onClick={() => { setShowOverflow(false); onMerge(); }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink/70 hover:bg-mist"
                      >
                        <GitMerge size={11} /> Merge
                      </button>
                      <button
                        onClick={() => { setShowOverflow(false); onTransfer(); }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink/70 hover:bg-mist"
                      >
                        <ArrowRightLeft size={11} /> Move
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
