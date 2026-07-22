import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clock, TrendingUp, ShoppingCart, Users, Zap, Wallet,
  AlertCircle, RefreshCw,
} from 'lucide-react';
import { fetchDailyReport } from '../api/dashboard';
import { fetchCashierOrders } from '../api/orders';
import type { DailyReport } from '../types';
import type { CashierOrderItem } from '../api/orders';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui/Spinner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtAge(nowMs: number, iso: string): string {
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  loading?: boolean;
}

function KpiCard({ icon, label, value, sub, accent, loading }: KpiCardProps) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-xl border border-border bg-canvas p-4">
        <div className="mb-2.5 h-3 w-20 rounded bg-border" />
        <div className="mb-1 h-7 w-24 rounded bg-border" />
        <div className="h-3 w-16 rounded bg-border" />
      </div>
    );
  }
  return (
    <div className={`rounded-xl border p-4 transition-shadow hover:shadow-sm ${
      accent ? 'border-brand/20 bg-brand/5' : 'border-border bg-canvas'
    }`}>
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className={accent ? 'text-brand' : 'text-ink/35'}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums leading-none text-ink">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

// ── Shift Banner (Coming Soon) ────────────────────────────────────────────────

function ShiftBanner() {
  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-border bg-canvas px-5 py-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink/5">
          <Clock size={15} className="text-ink/30" />
        </div>
        <div>
          <p className="text-xs font-semibold text-ink/60">Shift Management</p>
          <p className="text-[11px] text-ink/35">
            Opening cash · Shift timer · End-of-shift summary
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex gap-4 text-xs text-ink/40">
          <span>Opening Cash <span className="font-semibold text-ink/60">—</span></span>
          <span>Duration <span className="font-semibold text-ink/60">—</span></span>
        </div>
        <span className="rounded-full bg-ink/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/35">
          Coming Soon
        </span>
      </div>
    </div>
  );
}

// ── Pending Bills Quick View ──────────────────────────────────────────────────

function PendingBillRow({ order, sym, nowMs }: { order: CashierOrderItem; sym: string; nowMs: number }) {
  const age   = fmtAge(nowMs, order.createdAt);
  const isOld = (nowMs - new Date(order.createdAt).getTime()) > 15 * 60_000;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink truncate">
            {order.isParcel ? 'Parcel' : `Table ${order.tableNumber}`}
          </span>
          <span className="text-[11px] text-ink/40">{order.orderNumber}</span>
          {isOld && (
            <AlertCircle size={12} className="shrink-0 text-amber-500" />
          )}
        </div>
        <p className="text-[11px] text-ink/40">
          {order.items.slice(0, 2).map(i => i.productName).join(', ')}
          {order.items.length > 2 ? ` +${order.items.length - 2} more` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold text-ink tabular-nums">{fmtINR(sym, order.grandTotal)}</p>
        <p className={`text-[11px] ${isOld ? 'text-amber-500' : 'text-ink/40'}`}>{age}</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function CashierPage() {
  const { settings }    = useSettings();
  const { hotelId }     = useAuth();
  const sym             = settings?.currencySymbol ?? '₹';

  // ── State ──────────────────────────────────────────────────────────────────
  const [report,          setReport]         = useState<DailyReport | null>(null);
  const [pendingOrders,   setPendingOrders]  = useState<CashierOrderItem[]>([]);
  const [reportLoading,   setReportLoading]  = useState(true);
  const [pendingLoading,  setPendingLoading] = useState(true);
  const [error,           setError]          = useState<string | null>(null);
  // Captured once per minute to avoid Date.now() calls inside component renders
  const [nowMs,           setNowMs]          = useState(() => Date.now());

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    let cancelled = false;
    setError(null);

    const [rpt, pen] = await Promise.allSettled([
      fetchDailyReport(),
      fetchCashierOrders(),
    ]);

    if (cancelled) return;

    setReportLoading(false);
    setPendingLoading(false);

    if (rpt.status === 'fulfilled') setReport(rpt.value);
    else setError('Could not load daily stats');

    if (pen.status === 'fulfilled') setPendingOrders(pen.value);
    // pending orders failure is non-fatal — show empty state

    return () => { cancelled = true; };
  }, []);

  // Keep hotelId in a ref so the interval doesn't re-create on auth changes
  const hotelIdRef = useRef(hotelId);
  useEffect(() => { hotelIdRef.current = hotelId; }, [hotelId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); setNowMs(Date.now()); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // ── Derived KPIs ───────────────────────────────────────────────────────────
  const avgBill = report && report.totalOrders > 0
    ? report.totalSales / report.totalOrders
    : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-ink">Cashier Operations</h1>
          {pendingOrders.length > 0 && (
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold text-white">
              {pendingOrders.length} pending
            </span>
          )}
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Shift Management — Coming Soon */}
        <ShiftBanner />

        {/* ── KPI Strip ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            icon={<ShoppingCart size={14} />}
            label="Bills Today"
            value={report ? String(report.totalOrders) : '—'}
            sub={report && report.parcelOrders > 0 ? `${report.parcelOrders} parcel` : undefined}
            loading={reportLoading}
          />
          <KpiCard
            icon={<AlertCircle size={14} />}
            label="Pending Bills"
            value={pendingLoading ? '…' : String(pendingOrders.length)}
            sub="awaiting payment"
            accent={pendingOrders.length > 0}
            loading={pendingLoading}
          />
          <KpiCard
            icon={<Users size={14} />}
            label="Customers Served"
            value={report ? String(report.totalOrders) : '—'}
            sub="unique covers today"
            loading={reportLoading}
          />
          <KpiCard
            icon={<Zap size={14} />}
            label="Avg Bill"
            value={report && report.totalOrders > 0 ? fmtINR(sym, avgBill) : '—'}
            sub="per order"
            loading={reportLoading}
          />
          <KpiCard
            icon={<TrendingUp size={14} />}
            label="Shift Collection"
            value={report ? fmtINR(sym, report.totalSales) : '—'}
            sub={report ? `incl. ${fmtINR(sym, report.totalTax)} tax` : undefined}
            accent={false}
            loading={reportLoading}
          />
        </div>

        {/* ── Pending Bills Queue ─────────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Pending Bills</h2>
            <span className="text-xs text-ink/40">Served orders awaiting payment</span>
          </div>
          {pendingLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : pendingOrders.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center rounded-xl border border-dashed border-border text-center">
              <Wallet size={20} className="mb-1.5 text-ink/20" />
              <p className="text-sm text-ink/30">No pending bills</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingOrders.map(o => (
                <PendingBillRow key={o._id} order={o} sym={sym} nowMs={nowMs} />
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
