import { useState } from 'react';
import { ChevronDown, ChevronUp, GitMerge, ArrowRightLeft, UserMinus } from 'lucide-react';
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
  billed:    'bg-blue-100 text-blue-700',
  left:      'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-500',
};

function fmt(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function GuestCard({ guest, orders, currencySymbol, selected, onSelect, onBill, onMarkLeft, onMerge, onTransfer, disabled }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [leftBusy, setLeftBusy] = useState(false);

  const isActive    = guest.status === 'active';
  const isBilled    = guest.status === 'billed';
  const allItems    = orders.flatMap(o => o.items);
  const subtotal    = orders.reduce((s, o) => s + (o.subtotal ?? 0), 0);
  const taxTotal    = orders.reduce((s, o) => s + (o.taxTotal ?? 0), 0);
  const grandTotal  = orders.reduce((s, o) => s + (o.grandTotal ?? 0), 0);

  async function handleLeft() {
    setLeftBusy(true);
    try { await onMarkLeft(); } finally { setLeftBusy(false); }
  }

  return (
    <div
      className={`rounded-xl border transition-all ${
        selected
          ? 'border-blue-400 bg-blue-50 shadow-sm'
          : 'border-gray-200 bg-white hover:border-gray-300'
      } ${isActive ? 'cursor-pointer' : ''}`}
      onClick={() => isActive && onSelect()}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_COLORS[guest.status]}`}>
          {guest.status === 'active' ? 'Active' : guest.status === 'billed' ? 'Billed' : guest.status}
        </div>
        <span className="flex-1 text-sm font-medium text-gray-800 truncate">{guest.displayLabel}</span>
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmt(grandTotal, currencySymbol)}</span>
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          className="ml-1 rounded-md p-1 text-gray-400 hover:bg-gray-100"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded: items + totals */}
      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-1" onClick={e => e.stopPropagation()}>
          {allItems.length === 0 ? (
            <p className="text-xs text-gray-400">No orders yet</p>
          ) : (
            allItems.map((item, i) => (
              <div key={i} className="flex justify-between text-xs text-gray-600">
                <span>{item.productName} ×{item.quantity}</span>
                <span className="tabular-nums">{fmt(item.total ?? item.price * item.quantity, currencySymbol)}</span>
              </div>
            ))
          )}
          {taxTotal > 0 && (
            <div className="flex justify-between text-xs text-gray-400 pt-1 border-t border-dashed border-gray-200">
              <span>Sub / Tax</span>
              <span className="tabular-nums">{fmt(subtotal, currencySymbol)} / {fmt(taxTotal, currencySymbol)}</span>
            </div>
          )}
        </div>
      )}

      {/* Billed notice */}
      {isBilled && (
        <div className="border-t border-blue-100 bg-blue-50 px-3 py-1.5 rounded-b-xl text-xs text-blue-600">
          Paid via {guest.paymentMethod ?? '—'}
          {guest.billedAt && ` · ${new Date(guest.billedAt).toLocaleTimeString('en-IN', { timeStyle: 'short' })}`}
        </div>
      )}

      {/* Action buttons — active guests only */}
      {isActive && (
        <div
          className="flex gap-1.5 border-t border-gray-100 px-3 py-2"
          onClick={e => e.stopPropagation()}
        >
          <button
            disabled={disabled}
            onClick={onBill}
            className="flex-1 rounded-lg bg-[#E8380D] py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#E8380D]/90 disabled:opacity-40"
          >
            Bill
          </button>
          <button
            disabled={disabled || leftBusy}
            onClick={handleLeft}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            <UserMinus size={11} />
            {leftBusy ? '…' : 'Left'}
          </button>
          <button
            disabled={disabled}
            onClick={onMerge}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            <GitMerge size={11} />
            Merge
          </button>
          <button
            disabled={disabled}
            onClick={onTransfer}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            <ArrowRightLeft size={11} />
            Move
          </button>
        </div>
      )}
    </div>
  );
}
