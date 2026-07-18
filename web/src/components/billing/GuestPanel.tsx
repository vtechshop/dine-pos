import type { GuestBill, Guest, SessionSummary } from '../../types';
import { GuestCard } from './GuestCard';
import { mergeGuests, transferGuest, markGuestLeft } from '../../api/billing';
import { useState } from 'react';
import { MergeGuestModal } from './MergeGuestModal';
import { TransferGuestModal } from './TransferGuestModal';

interface Props {
  sessionId: string;
  guestBills: GuestBill[];
  openSessions: SessionSummary[];
  currencySymbol: string;
  selectedGuestId: string | null;
  onSelectGuest: (id: string) => void;
  onBillGuest: (guestId: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
}

function fmt(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function GuestPanel({
  sessionId,
  guestBills,
  openSessions,
  currencySymbol,
  selectedGuestId,
  onSelectGuest,
  onBillGuest,
  onRefresh,
  disabled,
}: Props) {
  const [mergeSource, setMergeSource]     = useState<Guest | null>(null);
  const [transferGuest_, setTransferGuest] = useState<Guest | null>(null);
  const [actionError, setActionError]     = useState<string | null>(null);

  const activeGuests = guestBills.map(gb => gb.guest).filter(g => g.status === 'active');
  const activeTotal  = activeGuests.reduce((s, g) => s + g.totalAmount, 0);
  const billedTotal  = guestBills.map(gb => gb.guest).filter(g => g.status === 'billed').reduce((s, g) => s + g.totalAmount, 0);
  const grandTotal   = guestBills.reduce((s, gb) => s + gb.orders.reduce((os, o) => os + o.grandTotal, 0), 0);

  async function handleMerge(targetId: string) {
    if (!mergeSource) return;
    setActionError(null);
    try {
      await mergeGuests(sessionId, mergeSource._id, targetId);
      setMergeSource(null);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Merge failed');
    }
  }

  async function handleTransfer(targetSessionId: string) {
    if (!transferGuest_) return;
    setActionError(null);
    try {
      await transferGuest(sessionId, transferGuest_._id, targetSessionId);
      setTransferGuest(null);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Transfer failed');
    }
  }

  async function handleLeft(guestId: string) {
    setActionError(null);
    try {
      await markGuestLeft(sessionId, guestId);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Guest list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
          Guests · {guestBills.length}
        </p>

        {actionError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 mb-2">{actionError}</div>
        )}

        {guestBills.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No guests on this table</p>
        ) : (
          guestBills.map(({ guest, orders }) => (
            <GuestCard
              key={guest._id}
              guest={guest}
              orders={orders}
              currencySymbol={currencySymbol}
              selected={selectedGuestId === guest._id}
              onSelect={() => onSelectGuest(guest._id)}
              onBill={() => onBillGuest(guest._id)}
              onMarkLeft={() => handleLeft(guest._id)}
              onMerge={() => setMergeSource(guest)}
              onTransfer={() => setTransferGuest(guest)}
              disabled={disabled}
            />
          ))
        )}
      </div>

      {/* Summary footer */}
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Active</span>
          <span className="tabular-nums">{fmt(activeTotal, currencySymbol)}</span>
        </div>
        {billedTotal > 0 && (
          <div className="flex justify-between text-xs text-gray-500">
            <span>Billed</span>
            <span className="tabular-nums">{fmt(billedTotal, currencySymbol)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t border-gray-200">
          <span>Grand Total</span>
          <span className="tabular-nums">{fmt(grandTotal, currencySymbol)}</span>
        </div>
      </div>

      {/* Merge modal */}
      {mergeSource && (
        <MergeGuestModal
          sourceGuest={mergeSource}
          activeGuests={guestBills.map(gb => gb.guest)}
          onConfirm={handleMerge}
          onClose={() => setMergeSource(null)}
        />
      )}

      {/* Transfer modal */}
      {transferGuest_ && (
        <TransferGuestModal
          guest={transferGuest_}
          currentSessionId={sessionId}
          openSessions={openSessions}
          onConfirm={handleTransfer}
          onClose={() => setTransferGuest(null)}
        />
      )}
    </div>
  );
}
