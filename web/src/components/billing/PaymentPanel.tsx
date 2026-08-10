import { memo, useState, useEffect } from 'react';
import type { GuestBill, PaymentMethod } from '../../types';
import type { SplitDetails } from '../../api/billing';
import { PaymentSelector } from './PaymentSelector';
import { SplitInput } from './SplitInput';
import { Loader2, X } from 'lucide-react';
import { checkGiftVoucher } from '../../api/giftVouchers';

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
  transactionId: string;
  onTransactionIdChange: (v: string) => void;
  upiApp: string;
  onUpiAppChange: (v: string) => void;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
  confirmFlash?: boolean;
  allGuestsBilled: boolean;
  onCloseTable: () => void;
  closingTable: boolean;
  appliedVoucher: { code: string; amount: number } | null;
  onVoucherApplied: (code: string, amount: number) => void;
  onVoucherCleared: () => void;
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
  transactionId,
  onTransactionIdChange,
  upiApp,
  onUpiAppChange,
  canConfirm,
  confirming,
  onConfirm,
  confirmFlash = false,
  allGuestsBilled,
  onCloseTable,
  closingTable,
  appliedVoucher,
  onVoucherApplied,
  onVoucherCleared,
}: Props) {
  // ── Voucher state ───────────────────────────────────────────────────────────
  const [voucherCode,     setVoucherCode]     = useState('');
  const [voucherData,     setVoucherData]     = useState<{ balance: number; isActive: boolean } | null>(null);
  const [voucherChecking, setVoucherChecking] = useState(false);
  const [voucherError,    setVoucherError]    = useState<string | null>(null);
  const [voucherRedeemAmt, setVoucherRedeemAmt] = useState('');

  // Reset internal voucher state when parent clears the applied voucher
  useEffect(() => {
    if (!appliedVoucher) {
      setVoucherCode('');
      setVoucherData(null);
      setVoucherError(null);
      setVoucherRedeemAmt('');
    }
  }, [appliedVoucher]);

  const guestTotal = selectedGuestBill
    ? selectedGuestBill.orders.reduce((s, o) => s + o.grandTotal, 0)
    : 0;

  const rawBillingAmount = mode === 'table' ? grandTotal : guestTotal;
  const billingAmount    = Math.max(rawBillingAmount - (appliedVoucher?.amount ?? 0), 0);
  const change = paidAmount > 0 && paidAmount >= billingAmount ? paidAmount - billingAmount : null;
  const short  = paidAmount > 0 && paidAmount < billingAmount  ? billingAmount - paidAmount  : null;

  async function handleCheckVoucher() {
    const code = voucherCode.trim().toUpperCase();
    if (!code) return;
    setVoucherChecking(true);
    setVoucherError(null);
    setVoucherData(null);
    setVoucherRedeemAmt('');
    try {
      const result = await checkGiftVoucher(code);
      if (!result.isActive) {
        setVoucherError('This voucher is inactive or has expired.');
        return;
      }
      if (result.balance <= 0) {
        setVoucherError('This voucher has no remaining balance.');
        return;
      }
      setVoucherData(result);
      const maxRedeem = Math.min(result.balance, rawBillingAmount);
      setVoucherRedeemAmt(maxRedeem.toFixed(2));
    } catch (err) {
      setVoucherError(err instanceof Error ? err.message : 'Voucher not found');
    } finally {
      setVoucherChecking(false);
    }
  }

  function handleApplyVoucher() {
    const amt = parseFloat(voucherRedeemAmt);
    if (!voucherData || isNaN(amt) || amt <= 0) return;
    const maxRedeem = Math.min(voucherData.balance, rawBillingAmount);
    onVoucherApplied(voucherCode.trim().toUpperCase(), Math.min(amt, maxRedeem));
  }

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
              {appliedVoucher && (
                <p className="text-[11px] text-green-400 mb-0.5">
                  -{fmt(appliedVoucher.amount, currencySymbol)} voucher
                </p>
              )}
              <p className="text-2xl font-bold tabular-nums">{fmt(billingAmount, currencySymbol)}</p>
            </>
          ) : mode === 'table' ? (
            <>
              <p className="text-xs text-white/40 mb-1">Table total (active guests)</p>
              {appliedVoucher && (
                <p className="text-[11px] text-green-400 mb-0.5">
                  -{fmt(appliedVoucher.amount, currencySymbol)} voucher
                </p>
              )}
              <p className="text-2xl font-bold tabular-nums">{fmt(billingAmount, currencySymbol)}</p>
            </>
          ) : (
            <p className="text-sm text-white/40">No guest selected</p>
          )}
        </div>

        {/* Gift Voucher */}
        {rawBillingAmount > 0 && (
          <div>
            <p className="text-xs font-medium text-ink/50 mb-2">Gift Voucher</p>
            {appliedVoucher ? (
              <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-green-700">Voucher Applied</p>
                  <p className="text-[10px] text-green-600 font-mono">{appliedVoucher.code}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tabular-nums text-green-700">
                    -{fmt(appliedVoucher.amount, currencySymbol)}
                  </span>
                  <button
                    onClick={onVoucherCleared}
                    className="rounded p-0.5 text-green-600 hover:text-green-800 hover:bg-green-100"
                    aria-label="Remove voucher"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={voucherCode}
                    onChange={e => setVoucherCode(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter') void handleCheckVoucher(); }}
                    placeholder="Enter voucher code"
                    disabled={confirming || voucherChecking}
                    className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink font-mono uppercase outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 disabled:opacity-50 placeholder:normal-case placeholder:font-sans"
                  />
                  <button
                    onClick={() => void handleCheckVoucher()}
                    disabled={!voucherCode.trim() || voucherChecking || confirming}
                    className="rounded-lg border border-border bg-canvas px-3 py-2 text-xs font-medium text-ink/60 transition-colors hover:bg-mist disabled:opacity-40"
                  >
                    {voucherChecking ? <Loader2 size={13} className="animate-spin" /> : 'Check'}
                  </button>
                </div>
                {voucherError && (
                  <p className="mt-1 text-xs text-red-500">{voucherError}</p>
                )}
                {voucherData && (
                  <div className="mt-2 rounded-lg border border-border bg-mist px-3 py-2 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-ink/60">Available balance</span>
                      <span className="text-sm font-bold tabular-nums text-ink">
                        {fmt(voucherData.balance, currencySymbol)}
                      </span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink/40">
                          {currencySymbol}
                        </span>
                        <input
                          type="number"
                          min={0.01}
                          max={Math.min(voucherData.balance, rawBillingAmount)}
                          step="0.01"
                          value={voucherRedeemAmt}
                          onChange={e => setVoucherRedeemAmt(e.target.value)}
                          placeholder="Amount"
                          className="w-full rounded-lg border border-border bg-canvas pl-6 pr-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                        />
                      </div>
                      <button
                        onClick={handleApplyVoucher}
                        disabled={!voucherRedeemAmt || parseFloat(voucherRedeemAmt) <= 0}
                        className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-40"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

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

        {/* UPI (generic) */}
        {paymentMethod === 'upi' && (
          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-mist px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-1">UPI Payment</p>
              <p className="text-sm text-ink/60">Scan QR or enter UPI ID on the guest's device.</p>
            </div>
            <input
              type="text"
              disabled={confirming}
              value={transactionId}
              onChange={e => onTransactionIdChange(e.target.value)}
              placeholder="UPI Transaction ID (optional)"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 disabled:opacity-50"
            />
          </div>
        )}

        {/* UPI QR */}
        {paymentMethod === 'upi_qr' && (
          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-mist px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-1">UPI QR Code</p>
              <p className="text-sm text-ink/60">Show QR code to guest. Verify payment in your UPI app before confirming.</p>
            </div>
            <input
              type="text"
              disabled={confirming}
              value={transactionId}
              onChange={e => onTransactionIdChange(e.target.value)}
              placeholder="UPI Transaction ID (optional)"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 disabled:opacity-50"
            />
          </div>
        )}

        {/* UPI Collect */}
        {paymentMethod === 'upi_collect' && (
          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-mist px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-1">UPI Collect</p>
              <p className="text-sm text-ink/60">Enter customer's UPI ID and send a collect request via your UPI app.</p>
            </div>
            <input
              type="text"
              disabled={confirming}
              value={upiApp}
              onChange={e => onUpiAppChange(e.target.value)}
              placeholder="Customer UPI ID (e.g. customer@bank)"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 disabled:opacity-50"
            />
            <input
              type="text"
              disabled={confirming}
              value={transactionId}
              onChange={e => onTransactionIdChange(e.target.value)}
              placeholder="UPI Transaction ID (optional)"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 disabled:opacity-50"
            />
          </div>
        )}

        {/* UPI Intent */}
        {paymentMethod === 'upi_intent' && (
          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-mist px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-1">UPI Intent</p>
              <p className="text-sm text-ink/60">Open a UPI app on the guest's phone for payment.</p>
            </div>
            <input
              type="text"
              disabled={confirming}
              value={transactionId}
              onChange={e => onTransactionIdChange(e.target.value)}
              placeholder="UPI Transaction ID (optional)"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 disabled:opacity-50"
            />
          </div>
        )}

        {/* Card: informational section */}
        {paymentMethod === 'card' && (
          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-mist px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 mb-1">Card Payment</p>
              <p className="text-sm text-ink/60">Swipe or tap card on the terminal.</p>
            </div>
            <input
              type="text"
              disabled={confirming}
              value={transactionId}
              onChange={e => onTransactionIdChange(e.target.value)}
              placeholder="Card Approval / Transaction ID (optional)"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 disabled:opacity-50"
            />
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

      {/* Action button */}
      <div className="border-t border-border bg-mist px-4 py-3">
        {allGuestsBilled ? (
          <button
            onClick={onCloseTable}
            disabled={closingTable}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-ink/90 disabled:opacity-40"
          >
            {closingTable ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Closing…
              </>
            ) : (
              'Close Table'
            )}
          </button>
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
