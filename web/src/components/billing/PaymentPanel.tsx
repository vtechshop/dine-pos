import { memo } from 'react';
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
  paidAmount: number;
  onPaidAmountChange: (v: number) => void;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
  confirmFlash?: boolean;
}

const CASH_PRESETS = [100, 200, 500, 1000, 2000];

function fmt(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PaymentPanel = memo(function PaymentPanel({
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
  paidAmount,
  onPaidAmountChange,
  canConfirm,
  confirming,
  onConfirm,
  confirmFlash = false,
}: Props) {
  const guestTotal = selectedGuestBill
    ? selectedGuestBill.orders.reduce((s, o) => s + o.grandTotal, 0)
    : 0;

  const billingAmount = mode === 'table' ? grandTotal : guestTotal;
  const noActiveGuests = activeGuestCount === 0;
  const change = paidAmount > 0 && paidAmount >= billingAmount ? paidAmount - billingAmount : null;
  const short  = paidAmount > 0 && paidAmount < billingAmount  ? billingAmount - paidAmount  : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink/40">Payment</p>

        {/* Mode toggle */}
        <div>
          <p className="text-xs font-medium text-ink/50 mb-2">Billing scope</p>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['table', 'guest'] as const).map(m => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`flex-1 py-2 text-sm font-medium transition-colors capitalize ${
                  mode === m
                    ? 'bg-ink text-white'
                    : 'bg-canvas text-ink/60 hover:bg-mist'
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
            <p className="mt-1.5 text-[11px] text-brand">
              Click a guest's Pay button to select them.
            </p>
          )}
        </div>

        {/* Amount display */}
        <div className="rounded-xl bg-ink px-4 py-4 text-white text-center">
          {mode === 'guest' && selectedGuestBill ? (
            <>
              <p className="text-xs text-white/40 mb-1">{selectedGuestBill.guest.displayLabel}</p>
              <p className="text-2xl font-bold tabular-nums">{fmt(billingAmount, currencySymbol)}</p>
            </>
          ) : mode === 'table' ? (
            <>
              <p className="text-xs text-white/40 mb-1">Table total (active guests)</p>
              <p className="text-2xl font-bold tabular-nums">{fmt(billingAmount, currencySymbol)}</p>
            </>
          ) : (
            <p className="text-sm text-white/40">No guest selected</p>
          )}
        </div>

        {/* Payment method */}
        <div>
          <p className="text-xs font-medium text-ink/50 mb-2">Payment method</p>
          <PaymentSelector
            value={paymentMethod}
            onChange={onPaymentMethodChange}
            disabled={confirming}
          />
        </div>

        {/* Cash: quick amounts + change calculator */}
        {paymentMethod === 'cash' && billingAmount > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-ink/50">Amount received</p>
            <div className="flex flex-wrap gap-1.5">
              {CASH_PRESETS.map(preset => (
                <button
                  key={preset}
                  onClick={() => onPaidAmountChange(preset)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    paidAmount === preset
                      ? 'border-brand bg-brand text-white'
                      : 'border-border bg-canvas text-ink/60 hover:border-brand/30 hover:bg-brand/5'
                  }`}
                >
                  {currencySymbol}{preset}
                </button>
              ))}
              <button
                onClick={() => onPaidAmountChange(Math.ceil(billingAmount))}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  paidAmount === Math.ceil(billingAmount)
                    ? 'border-brand bg-brand text-white'
                    : 'border-border bg-canvas text-ink/60 hover:border-brand/30 hover:bg-brand/5'
                }`}
              >
                Exact
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink/40">
                {currencySymbol}
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={confirming}
                value={paidAmount || ''}
                onChange={e => onPaidAmountChange(parseFloat(e.target.value) || 0)}
                placeholder="Enter amount"
                className="w-full rounded-lg border border-border bg-canvas pl-6 pr-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 disabled:opacity-50"
              />
            </div>
            {change !== null && (
              <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                <span className="text-xs font-medium text-green-700">Change</span>
                <span className="text-sm font-bold tabular-nums text-green-700">
                  {fmt(change, currencySymbol)}
                </span>
              </div>
            )}
            {short !== null && (
              <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <span className="text-xs font-medium text-red-600">Short by</span>
                <span className="text-sm font-bold tabular-nums text-red-600">
                  {fmt(short, currencySymbol)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* UPI: informational section */}
        {paymentMethod === 'upi' && (
          <div className="rounded-xl border border-border bg-mist px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-1">UPI Payment</p>
            <p className="text-sm text-ink/60">Scan QR or enter UPI ID on the guest's device.</p>
          </div>
        )}

        {/* Card: informational section */}
        {paymentMethod === 'card' && (
          <div className="rounded-xl border border-border bg-mist px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-1">Card Payment</p>
            <p className="text-sm text-ink/60">Swipe or tap card on the terminal.</p>
          </div>
        )}

        {/* Split input */}
        {paymentMethod === 'split' && billingAmount > 0 && (
          <div>
            <p className="text-xs font-medium text-ink/50 mb-2">Split amounts</p>
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
      <div className="border-t border-border bg-mist px-4 py-3">
        {noActiveGuests ? (
          <div className="rounded-lg bg-green-50 px-3 py-3 text-center text-sm text-green-700 font-medium">
            All guests billed
          </div>
        ) : (
          <button
            onClick={onConfirm}
            disabled={!canConfirm || confirming}
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-700 disabled:opacity-40 ${confirmFlash ? 'ring-2 ring-green-400 ring-offset-1 animate-pulse' : ''}`}
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
});
