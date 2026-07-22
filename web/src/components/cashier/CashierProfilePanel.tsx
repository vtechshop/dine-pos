import { useState, useEffect, useCallback } from 'react';
import {
  User, Clock, Wallet, TrendingUp, ShoppingBag,
  LogOut, RefreshCw, Shield, AlertTriangle,
} from 'lucide-react';
import { useCashier } from '../../context/CashierContext';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { fetchDailyReport } from '../../api/dashboard';
import type { DailyReport } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtDuration(openedAt: string, nowMs: number) {
  const ms = nowMs - new Date(openedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function parseJwt(key: string): Record<string, unknown> {
  try {
    const token = localStorage.getItem(key) ?? '';
    if (!token) return {};
    return JSON.parse(atob(token.split('.')[1])) as Record<string, unknown>;
  } catch { return {}; }
}

function getCashierFromJwt() {
  const payload = parseJwt('pos_cashier_token');
  const fallback = parseJwt('pos_token');
  const p = Object.keys(payload).length > 0 ? payload : fallback;
  return {
    name: (p.name as string | undefined) ?? 'Cashier',
    code: (p.employeeCode as string | undefined) ?? '',
    mobile: (p.mobile as string | undefined) ?? '',
    role: (p.role as string | undefined) ?? 'cashier',
  };
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-ink/35">{icon}</span>
      <div className="flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink/40">{label}</p>
        <p className="text-xs font-semibold text-ink">{value || '—'}</p>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function CashierProfilePanel() {
  const { shift, drawerBalance, drawerMovements } = useCashier();
  const { logout } = useAuth();
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const identity = getCashierFromJwt();

  const [report, setReport]   = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs]     = useState(() => Date.now());
  const [confirmLogout, setConfirmLogout] = useState(false);

  const load = useCallback(async () => {
    let cancelled = false;
    try {
      const r = await fetchDailyReport();
      if (!cancelled) { setReport(r); setLoading(false); }
    } catch {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 60_000);
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [load]);

  const cashMovements = drawerMovements.filter(m => m.type !== 'opening');
  const cashInTotal   = drawerMovements.filter(m => m.type === 'cash_in').reduce((s, m) => s + m.amount, 0);
  const cashOutTotal  = drawerMovements.filter(m => m.type === 'cash_out').reduce((s, m) => s + m.amount, 0);

  const avgBill = report && report.totalOrders > 0
    ? report.totalSales / report.totalOrders
    : 0;

  return (
    <div className="space-y-4">
      {/* ── Profile card ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-canvas p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-2xl font-bold text-brand">
            {identity.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-base font-bold text-ink">{identity.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                <Shield size={9} />
                {identity.role}
              </span>
              {identity.code && (
                <span className="text-xs text-ink/50">#{identity.code}</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 divide-y divide-border/60">
          {identity.code && <InfoRow icon={<User size={13} />} label="Employee ID" value={identity.code} />}
          {identity.mobile && <InfoRow icon={<User size={13} />} label="Mobile" value={identity.mobile} />}
        </div>
      </div>

      {/* ── Shift status ─────────────────────────────────────────────────── */}
      <div className={`rounded-xl border p-4 ${
        shift?.status === 'open' ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
      }`}>
        <div className="flex items-center gap-2 mb-2">
          <Clock size={14} className={shift?.status === 'open' ? 'text-emerald-600' : 'text-amber-600'} />
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Current Shift</p>
        </div>
        {shift?.status === 'open' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[10px] text-ink/50">Status</p>
              <p className="text-sm font-bold text-emerald-700">Open</p>
            </div>
            <div>
              <p className="text-[10px] text-ink/50">Duration</p>
              <p className="text-sm font-bold text-ink">{fmtDuration(shift.openedAt, nowMs)}</p>
            </div>
            <div>
              <p className="text-[10px] text-ink/50">Opening Cash</p>
              <p className="text-sm font-bold text-ink">{fmtINR(sym, shift.openingCash)}</p>
            </div>
            <div>
              <p className="text-[10px] text-ink/50">Started</p>
              <p className="text-sm font-bold text-ink">
                {new Date(shift.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-amber-700">No shift is currently open.</p>
        )}
      </div>

      {/* ── Today's performance ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-canvas p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Today's Performance</p>
          <button
            type="button"
            onClick={() => { setLoading(true); void load(); }}
            className="rounded-lg border border-border p-1 text-ink/40 hover:bg-mist"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-mist/40 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp size={12} className="text-brand" />
              <p className="text-[10px] font-medium text-ink/50">Total Sales</p>
            </div>
            <p className="text-lg font-bold text-ink">{fmtINR(sym, report?.totalSales ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-border bg-mist/40 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <ShoppingBag size={12} className="text-blue-500" />
              <p className="text-[10px] font-medium text-ink/50">Bills</p>
            </div>
            <p className="text-lg font-bold text-ink">{report?.totalOrders ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-mist/40 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp size={12} className="text-emerald-500" />
              <p className="text-[10px] font-medium text-ink/50">Avg Bill</p>
            </div>
            <p className="text-lg font-bold text-ink">{fmtINR(sym, avgBill)}</p>
          </div>
        </div>
      </div>

      {/* ── Cash drawer summary ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-canvas p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wallet size={14} className="text-ink/40" />
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Cash Drawer</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-ink/50">Balance</p>
            <p className={`text-base font-bold ${drawerBalance < 0 ? 'text-red-600' : 'text-ink'}`}>
              {fmtINR(sym, drawerBalance)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-ink/50">Cash In</p>
            <p className="text-base font-bold text-emerald-600">{fmtINR(sym, cashInTotal)}</p>
          </div>
          <div>
            <p className="text-[10px] text-ink/50">Cash Out</p>
            <p className="text-base font-bold text-red-500">{fmtINR(sym, cashOutTotal)}</p>
          </div>
        </div>
        {cashMovements.length > 0 && (
          <p className="mt-2 text-[10px] text-ink/40">{cashMovements.length} movement{cashMovements.length !== 1 ? 's' : ''} recorded this shift</p>
        )}
      </div>

      {/* ── Logout ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-red-100 bg-red-50/40 p-4">
        {!confirmLogout ? (
          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white py-3 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
          >
            <LogOut size={16} />
            End Session & Logout
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-800">
                {shift?.status === 'open'
                  ? 'Your shift is still open. Close the shift before logging out for accurate cash reconciliation.'
                  : 'Are you sure you want to log out?'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-ink hover:bg-mist"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                Confirm Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
