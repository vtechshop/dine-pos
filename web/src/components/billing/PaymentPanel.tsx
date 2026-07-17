import type { GuestBill, PaymentMethod } from '../../types';
import type { SplitDetails } from '../../api/billing';
import { PaymentSelector } from './PaymentSelector';
import { SplitInput } from './SplitInput';
import { Loader2 } from 'lucide-react';

interface Props {
  mode: 'guest' | 'table';
  onModeChange: (m: 'guest' | 'table') => void;
  selectedGuestBill: GuestBill | null;
  grandTotal: number;
  activeGuestCount: number;
  currencySymbol: string;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (m: PaymentMethod) => void;
  splitDetails: SplitDetails;
  onSplitChange: (v: SplitDetails) => void;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
}

function fmt(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PaymentPanel({
  mode,
  onModeChange,
  selectedGuestBill,
  grandTotal,
  activeGuestCount,
  currencySymbol,
  paymentMethod,
  onPaymentMethodChange,
  splitDetails,
  onSplitChange,
  canConfirm,
  confirming,
  onConfirm,
}: Props) {
  const guestTotal = selectedGuestBill
    ? selectedGuestBill.orders.reduce((s, o) => s + o.grandTotal, 0)
    : 0;

  const billingAmount = mode === 'table' ? grandTotal : guestTotal;
  const noActiveGuests = activeGuestCount === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Payment</p>

        {/* Mode toggle */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Billing scope</p>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['table', 'guest'] as const).map(m => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`flex-1 py-2 text-sm font-medium transition-colors capitalize ${
                  mode === m
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {m === 'table' ? 'Entire Table' : 'Single Guest'}
              </button>
            ))}
          </div>
          {mode === 'table' && (
            <p className="mt-1.5 text-[11px] text-amber-600">
              Bills all {activeGuestCount} active guest{activeGuestCount !== 1 ? 's' : ''} and closes the table.
            </p>
          )}
          {mode === 'guest' && !selectedGuestBill && (
            <p className="mt-1.5 text-[11px] text-[#E8380D]">
              Click a guest's Bill button to select them.
            </p>
          )}
        </div>

        {/* Amount display */}
        <div className="rounded-xl bg-gray-900 px-4 py-4 text-white text-center">
          {mode === 'guest' && selectedGuestBill ? (
            <>
              <p className="text-xs text-gray-400 mb-1">{selectedGuestBill.guest.displayLabel}</p>
              <p className="text-2xl font-bold tabular-nums">{fmt(billingAmount, currencySymbol)}</p>
            </>
          ) : mode === 'table' ? (
            <>
              <p className="text-xs text-gray-400 mb-1">Table total (active guests)</p>
              <p className="text-2xl font-bold tabular-nums">{fmt(billingAmount, currencySymbol)}</p>
            </>
          ) : (
            <p className="text-sm text-gray-400">No guest selected</p>
          )}
        </div>

        {/* Payment method */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Payment method</p>
          <PaymentSelector
            value={paymentMethod}
            onChange={onPaymentMethodChange}
            disabled={confirming}
          />
        </div>

        {/* Split input */}
        {paymentMethod === 'split' && billingAmount > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Split amounts</p>
            <SplitInput
              total={billingAmount}
              value={splitDetails}
              onChange={onSplitChange}
              currencySymbol={currencySymbol}
              disabled={confirming}
            />
          </div>
        )}

        {/* Complimentary note */}
        {paymentMethod === 'complimentary' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Complimentary — no charge will be recorded.
          </div>
        )}
      </div>

      {/* Confirm button */}
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
        {noActiveGuests ? (
          <div className="rounded-lg bg-green-50 px-3 py-3 text-center text-sm text-green-700 font-medium">
            All guests billed
          </div>
        ) : (
          <button
            onClick={onConfirm}
            disabled={!canConfirm || confirming}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-700 disabled:opacity-40"
          >
            {confirming ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Processing…
              </>
            ) : (
              <>
                Confirm Payment
                <span className="text-green-300 text-xs font-mono">Enter</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
