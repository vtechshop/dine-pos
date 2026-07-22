import { useState, type FormEvent } from 'react';
import { PlusCircle, MinusCircle, Wallet, ArrowDown, ArrowUp, Lock } from 'lucide-react';
import { useCashier } from '../../context/CashierContext';
import { useSettings } from '../../context/SettingsContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const CASH_IN_REASONS = [
  'Change received',
  'Petty cash addition',
  'Float top-up',
  'Correction',
  'Other',
];

const CASH_OUT_REASONS = [
  'Petty cash withdrawal',
  'Expense payment',
  'Safe drop',
  'Refund to customer',
  'Correction',
  'Other',
];

// ── Component ─────────────────────────────────────────────────────────────────

export function CashDrawerPanel() {
  const { shift, drawerMovements, addDrawerMovement, drawerBalance } = useCashier();
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [mode, setMode] = useState<'in' | 'out' | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const noShift = !shift || shift.status !== 'open';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setError('Enter a valid amount'); return; }
    const effectiveReason = reason === 'Other' ? customReason.trim() : reason;
    if (!effectiveReason) { setError('Select or enter a reason'); return; }
    if (mode === 'out' && amt > drawerBalance) { setError('Amount exceeds drawer balance'); return; }

    let cashierName = shift?.cashierName ?? 'Cashier';
    setError(null);

    addDrawerMovement({
      type: mode === 'in' ? 'cash_in' : 'cash_out',
      amount: amt,
      reason: effectiveReason,
      cashierName,
    });

    setAmount('');
    setReason('');
    setCustomReason('');
    setMode(null);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Cash Drawer</h2>

      {/* No shift guard */}
      {noShift && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-center">
          <Lock size={18} className="mx-auto mb-2 text-amber-500" />
          <p className="text-sm font-medium text-amber-800">Open a shift first</p>
          <p className="mt-0.5 text-xs text-amber-600">Cash drawer operations require an active shift.</p>
        </div>
      )}

      {/* Balance card */}
      {!noShift && (
        <>
          <div className="rounded-xl border border-border bg-canvas p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Current Balance</p>
            <p className="mt-1 text-3xl font-bold text-ink">{fmtINR(sym, drawerBalance)}</p>
            <div className="mt-3 flex items-center gap-3 text-xs text-ink/50">
              <span>Opening: {fmtINR(sym, shift?.openingCash ?? 0)}</span>
              <span className="text-ink/20">·</span>
              <span>Movements: {drawerMovements.length - 1}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode(m => m === 'in' ? null : 'in')}
              className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition ${
                mode === 'in'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-border bg-canvas text-ink hover:bg-mist'
              }`}
            >
              <PlusCircle size={16} />
              Cash In
            </button>
            <button
              type="button"
              onClick={() => setMode(m => m === 'out' ? null : 'out')}
              className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition ${
                mode === 'out'
                  ? 'border-red-200 bg-red-50 text-red-600'
                  : 'border-border bg-canvas text-ink hover:bg-mist'
              }`}
            >
              <MinusCircle size={16} />
              Cash Out
            </button>
          </div>

          {/* Form */}
          {mode !== null && (
            <form onSubmit={handleSubmit} className={`rounded-xl border p-4 space-y-3 ${
              mode === 'in' ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-100 bg-red-50/30'
            }`}>
              <p className={`text-sm font-semibold ${mode === 'in' ? 'text-emerald-700' : 'text-red-600'}`}>
                {mode === 'in' ? 'Add Cash to Drawer' : 'Remove Cash from Drawer'}
              </p>

              <div>
                <label className="block text-xs font-medium text-ink/70">Amount <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className="mt-1 block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink/70">Reason <span className="text-red-500">*</span></label>
                <select
                  value={reason}
                  onChange={e => { setReason(e.target.value); setCustomReason(''); }}
                  className="mt-1 block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">Select reason…</option>
                  {(mode === 'in' ? CASH_IN_REASONS : CASH_OUT_REASONS).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {reason === 'Other' && (
                  <input
                    type="text"
                    value={customReason}
                    onChange={e => setCustomReason(e.target.value)}
                    placeholder="Describe reason…"
                    className="mt-1.5 block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
                  />
                )}
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => { setMode(null); setAmount(''); setReason(''); setError(null); }}
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink/70 hover:bg-mist"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white transition ${
                    mode === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'
                  }`}
                >
                  Confirm
                </button>
              </div>
            </form>
          )}

          {/* Movement history */}
          {drawerMovements.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Movement History</p>
              {drawerMovements.map(m => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border bg-canvas px-3 py-2.5">
                  <span className={`rounded-lg p-1.5 ${
                    m.type === 'cash_in' ? 'bg-emerald-50 text-emerald-600' :
                    m.type === 'cash_out' ? 'bg-red-50 text-red-500' :
                    'bg-brand/10 text-brand'
                  }`}>
                    {m.type === 'cash_in' ? <ArrowDown size={12} /> :
                     m.type === 'cash_out' ? <ArrowUp size={12} /> :
                     <Wallet size={12} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink truncate">{m.reason}</p>
                    <p className="text-[10px] text-ink/45">{m.cashierName} · {fmtTime(m.timestamp)}</p>
                  </div>
                  <span className={`text-sm font-semibold ${
                    m.type === 'cash_in' ? 'text-emerald-600' :
                    m.type === 'cash_out' ? 'text-red-500' :
                    'text-brand'
                  }`}>
                    {m.type === 'cash_out' ? '−' : '+'}{fmtINR(sym, m.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
