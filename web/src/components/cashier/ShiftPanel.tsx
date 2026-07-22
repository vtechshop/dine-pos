import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Clock, TrendingUp, Wallet, DollarSign, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { useCashier } from '../../context/CashierContext';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { fetchDailyReport } from '../../api/dashboard';
import { Spinner } from '../ui/Spinner';
import type { DailyReport } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

function fmtDuration(startIso: string, nowMs: number): string {
  const diffMs = nowMs - new Date(startIso).getTime();
  const totalMins = Math.floor(diffMs / 60_000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

// ── Sub-component: running shift view ─────────────────────────────────────────

function RunningShift({ nowMs }: { nowMs: number }) {
  const { shift, closeShift, drawerBalance } = useCashier();
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [report, setReport] = useState<DailyReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [showClose, setShowClose] = useState(false);
  const [actualCash, setActualCash] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let cancelled = false;
    setReportLoading(true);
    try {
      const r = await fetchDailyReport();
      if (!cancelled) setReport(r);
    } catch { /* non-fatal */ } finally {
      if (!cancelled) setReportLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!shift) return null;

  const expectedCash = (report?.paymentBreakdown?.cash ?? 0) + shift.openingCash;
  const actual = parseFloat(actualCash) || 0;
  const difference = actual - expectedCash;

  function handleClose(e: FormEvent) {
    e.preventDefault();
    if (!actualCash) { setCloseError('Enter actual cash in drawer'); return; }
    setClosing(true);
    setCloseError(null);
    try {
      closeShift(actual, closingNote);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Shift header */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-canvas p-4">
        <div className="rounded-lg bg-brand/10 p-2.5 text-brand">
          <Clock size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-ink">{shift.cashierName}</p>
          <p className="text-xs text-ink/50">
            Shift opened · {new Date(shift.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-mono font-semibold text-brand">
            {fmtDuration(shift.openedAt, nowMs)}
          </p>
          <p className="text-[10px] text-ink/40 uppercase tracking-wide">Duration</p>
        </div>
      </div>

      {/* Revenue stats */}
      {reportLoading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : report ? (
        <div className="grid grid-cols-2 gap-3">
          <StatBox label="Cash Sales" value={fmtINR(sym, report.paymentBreakdown?.cash ?? 0)} icon={<Wallet size={14} />} />
          <StatBox label="Online Sales" value={fmtINR(sym, (report.paymentBreakdown?.upi ?? 0) + (report.paymentBreakdown?.card ?? 0))} icon={<TrendingUp size={14} />} />
          <StatBox label="Total Bills" value={String(report.totalOrders)} icon={<FileText size={14} />} />
          <StatBox label="Total Sales" value={fmtINR(sym, report.totalSales)} icon={<DollarSign size={14} />} accent />
        </div>
      ) : null}

      {/* Drawer balance */}
      <div className="rounded-xl border border-border bg-mist p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ink/60">Current Drawer Balance</span>
          <span className="text-base font-bold text-ink">{fmtINR(sym, drawerBalance)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-ink/50">Opening balance</span>
          <span className="text-xs font-medium text-ink">{fmtINR(sym, shift.openingCash)}</span>
        </div>
      </div>

      {/* Close shift */}
      <div className="rounded-xl border border-border bg-canvas">
        <button
          type="button"
          onClick={() => setShowClose(v => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink"
        >
          <span>Close Shift</span>
          {showClose ? <ChevronUp size={15} className="text-ink/40" /> : <ChevronDown size={15} className="text-ink/40" />}
        </button>

        {showClose && (
          <form onSubmit={handleClose} className="border-t border-border px-4 pb-4 pt-3 space-y-3">
            <div className="rounded-lg border border-border bg-mist px-3 py-2.5 space-y-1.5">
              <Row label="Expected Cash" value={fmtINR(sym, expectedCash)} />
              {actualCash && (
                <>
                  <Row label="Actual Cash" value={fmtINR(sym, actual)} />
                  <Row
                    label="Difference"
                    value={`${difference >= 0 ? '+' : '−'}${fmtINR(sym, Math.abs(difference))}`}
                    valueClass={difference < 0 ? 'text-red-500 font-semibold' : difference > 0 ? 'text-emerald-600 font-semibold' : ''}
                  />
                </>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-ink/70">Actual Cash in Drawer <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={actualCash}
                onChange={e => setActualCash(e.target.value)}
                placeholder="0.00"
                className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink/70">Closing Note</label>
              <input
                type="text"
                value={closingNote}
                onChange={e => setClosingNote(e.target.value)}
                placeholder="Optional note…"
                className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
              />
            </div>

            {closeError && (
              <p className="text-xs text-red-500">{closeError}</p>
            )}

            <button
              type="submit"
              disabled={closing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-60"
            >
              {closing && <Spinner size="sm" />}
              Close Shift &amp; Generate Summary
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Sub-component: shift summary (after close) ────────────────────────────────

function ShiftSummary() {
  const { shift, clearDrawerMovements } = useCashier();
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  if (!shift || shift.status !== 'closed') return null;

  function startNewShift() {
    clearDrawerMovements();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <p className="text-sm font-semibold text-emerald-700">Shift Closed</p>
        <p className="mt-0.5 text-xs text-emerald-600">
          {new Date(shift.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          {' → '}
          {shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-canvas p-4 space-y-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Shift Summary</p>
        <Row label="Cashier" value={shift.cashierName} />
        <Row label="Opening Cash" value={fmtINR(sym, shift.openingCash)} />
        {shift.actualCash !== undefined && (
          <Row label="Closing Cash" value={fmtINR(sym, shift.actualCash)} />
        )}
        {shift.difference !== undefined && (
          <Row
            label="Difference"
            value={`${shift.difference >= 0 ? '+' : '−'}${fmtINR(sym, Math.abs(shift.difference))}`}
            valueClass={shift.difference < 0 ? 'text-red-500 font-semibold' : 'text-emerald-600 font-semibold'}
          />
        )}
        {shift.closingNote && <Row label="Note" value={shift.closingNote} />}
      </div>

      <button
        type="button"
        onClick={startNewShift}
        className="w-full rounded-lg border border-brand px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/5"
      >
        Open New Shift
      </button>

      <OpenShiftForm />
    </div>
  );
}

// ── Sub-component: open shift form ────────────────────────────────────────────

function OpenShiftForm() {
  const { openShift, shift } = useCashier();
  useAuth(); // establishes auth context; cashier name read from JWT token below
  const [openingCash, setOpeningCash] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (shift?.status === 'open') return null;

  function handleOpen(e: FormEvent) {
    e.preventDefault();
    const cash = parseFloat(openingCash);
    if (isNaN(cash) || cash < 0) { setError('Enter a valid opening cash amount'); return; }
    setError(null);

    // Read cashier name/id from JWT token stored in auth
    // role is 'cashier' — the name is available via localStorage token decode
    let cashierName = 'Cashier';
    let cashierId = '';
    try {
      const token = localStorage.getItem('pos_token') ?? localStorage.getItem('pos_cashier_token') ?? '';
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        cashierName = (payload.name as string | undefined) ?? 'Cashier';
        cashierId   = (payload.employeeCode as string | undefined) ?? (payload.sub as string | undefined) ?? '';
      }
    } catch { /* use defaults */ }

    openShift({
      cashierName,
      cashierId,
      openedAt: new Date().toISOString(),
      openingCash: cash,
      openingNote: note.trim(),
    });
  }

  return (
    <form onSubmit={handleOpen} className="rounded-xl border border-border bg-canvas p-4 space-y-3">
      <p className="text-sm font-semibold text-ink">Open New Shift</p>

      <div>
        <label className="block text-xs font-medium text-ink/70">Opening Cash <span className="text-red-500">*</span></label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={openingCash}
          onChange={e => setOpeningCash(e.target.value)}
          placeholder="0.00"
          className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-ink/70">Opening Note</label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional note…"
          className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="submit"
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
      >
        Open Shift
      </button>
    </form>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export function ShiftPanel() {
  const { shift } = useCashier();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Shift Management</h2>

      {!shift || shift.status === 'closed' ? (
        shift?.status === 'closed' ? (
          <ShiftSummary />
        ) : (
          <OpenShiftForm />
        )
      ) : (
        <RunningShift nowMs={nowMs} />
      )}
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function StatBox({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-brand/20 bg-brand/5' : 'border-border bg-canvas'}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={accent ? 'text-brand' : 'text-ink/35'}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">{label}</span>
      </div>
      <p className={`text-base font-bold ${accent ? 'text-brand' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function Row({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-ink/55">{label}</span>
      <span className={`text-xs font-medium text-ink ${valueClass}`}>{value}</span>
    </div>
  );
}
