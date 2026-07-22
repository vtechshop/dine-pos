import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShortcut } from '../hooks/useShortcut';
import {
  Clock, TrendingUp, ShoppingCart, Users, Zap, Wallet,
  AlertCircle, RefreshCw, Search, Printer, X, Star,
  Wifi, WifiOff,
} from 'lucide-react';
import { fetchDailyReport, fetchPrinterDevices } from '../api/dashboard';
import { fetchCashierOrders, fetchOrders } from '../api/orders';
import { fetchReceiptJobs, reprintJob } from '../api/billing';
import { searchCustomers } from '../api/loyalty';
import type { DailyReport, OrderListItem, PrintJob, PrinterDeviceStatus } from '../types';
import type { CashierOrderItem } from '../api/orders';
import type { CustomerSummary } from '../types/customers';
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

// ── Favourite Products ────────────────────────────────────────────────────────
// Shows the most-ordered items from today's completed orders.
// User-pinned favourites require backend storage (Coming Soon).

import { fetchOrders as _fetchOrdersForFav } from '../api/orders';

interface RecentItem { name: string; qty: number }

function FavouriteProducts({ sym: _sym }: { sym: string }) {
  const [items,   setItems]   = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    _fetchOrdersForFav({ limit: 30, status: 'completed' })
      .then(res => {
        if (cancelled) return;
        const tally = new Map<string, number>();
        for (const o of res.orders) {
          for (const item of o.items) {
            tally.set(item.productName, (tally.get(item.productName) ?? 0) + item.quantity);
          }
        }
        const sorted = [...tally.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([name, qty]) => ({ name, qty }));
        setItems(sorted);
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Frequently Sold Today</h2>
        <span className="text-[11px] text-ink/35">Pinned favourites — Coming Soon</span>
      </div>
      {loading ? (
        <div className="flex h-16 items-center justify-center"><Spinner size="sm" /></div>
      ) : items.length === 0 ? (
        <div className="flex h-16 items-center justify-center rounded-xl border border-dashed border-border">
          <p className="text-sm text-ink/30">No completed orders yet today</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map(item => (
            <div
              key={item.name}
              className="flex items-center gap-2 rounded-full border border-border bg-canvas px-3 py-1.5 text-xs"
            >
              <span className="font-medium text-ink">{item.name}</span>
              <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                ×{item.qty}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function CashierPage() {
  const { settings }    = useSettings();
  const { hotelId }     = useAuth();
  const sym             = settings?.currencySymbol ?? '₹';

  // ── State: dashboard ────────────────────────────────────────────────────────
  const [report,          setReport]         = useState<DailyReport | null>(null);
  const [pendingOrders,   setPendingOrders]  = useState<CashierOrderItem[]>([]);
  const [reportLoading,   setReportLoading]  = useState(true);
  const [pendingLoading,  setPendingLoading] = useState(true);
  const [error,           setError]          = useState<string | null>(null);
  // Captured once per minute to avoid Date.now() calls inside component renders
  const [nowMs,           setNowMs]          = useState(() => Date.now());

  // ── State: bill search ───────────────────────────────────────────────────────
  const [searchTerm,    setSearchTerm]    = useState('');
  const [searchDate,    setSearchDate]    = useState(() => new Date().toISOString().split('T')[0]);
  const [searchStatus,  setSearchStatus]  = useState<'all' | 'served' | 'completed'>('all');
  const [searchResults, setSearchResults] = useState<OrderListItem[]>([]);
  const [printJobs,     setPrintJobs]     = useState<PrintJob[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError,   setSearchError]   = useState<string | null>(null);
  const [searched,      setSearched]      = useState(false);
  const [reprintingId,  setReprintingId]  = useState<string | null>(null);

  // ── State: customer search ───────────────────────────────────────────────────
  const [custQuery,     setCustQuery]     = useState('');
  const [custResults,   setCustResults]   = useState<CustomerSummary[]>([]);
  const [custLoading,   setCustLoading]   = useState(false);
  const [custError,     setCustError]     = useState<string | null>(null);
  const [custSearched,  setCustSearched]  = useState(false);

  // ── State: printer operations ────────────────────────────────────────────────
  const [printers,      setPrinters]      = useState<PrinterDeviceStatus[]>([]);
  const [printerLoading,setPrinterLoading]= useState(true);
  const [lastReceipt,   setLastReceipt]   = useState<PrintJob | null>(null);
  const [reprintLast,   setReprintLast]   = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');

  // ── Bill Search ─────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    setSearchLoading(true);
    setSearchError(null);
    setSearched(true);

    const [ordersRes, jobsRes] = await Promise.allSettled([
      fetchOrders({
        date:   searchDate,
        status: searchStatus === 'all' ? undefined : searchStatus,
        limit:  50,
      }),
      fetchReceiptJobs(),
    ]);

    setSearchLoading(false);

    if (ordersRes.status === 'fulfilled') {
      const term = searchTerm.toLowerCase().trim();
      const all  = ordersRes.value.orders;
      setSearchResults(
        term
          ? all.filter(o =>
              o.orderNumber.toLowerCase().includes(term) ||
              o.tableNumber.toLowerCase().includes(term) ||
              (o.customerName ?? '').toLowerCase().includes(term),
            )
          : all,
      );
    } else {
      setSearchError('Search failed — try again');
    }

    if (jobsRes.status === 'fulfilled') setPrintJobs(jobsRes.value);
  }, [searchDate, searchStatus, searchTerm]);

  const handleReprint = useCallback(async (orderId: string) => {
    const job = printJobs.find(j => j.orderId === orderId && j.jobType === 'receipt');
    if (!job) { setSearchError('No receipt print job found for this bill'); return; }
    setReprintingId(orderId);
    try {
      await reprintJob(job._id);
    } catch {
      setSearchError('Reprint failed — check printer connection');
    } finally {
      setReprintingId(null);
    }
  }, [printJobs]);

  // ── Reprint Last Bill ────────────────────────────────────────────────────────
  const handleReprintLast = useCallback(async () => {
    if (!lastReceipt) return;
    setReprintLast('loading');
    try {
      await reprintJob(lastReceipt._id);
      setReprintLast('ok');
      setTimeout(() => setReprintLast('idle'), 3_000);
    } catch {
      setReprintLast('err');
      setTimeout(() => setReprintLast('idle'), 4_000);
    }
  }, [lastReceipt]);

  // ── Customer Search ──────────────────────────────────────────────────────────
  const handleCustSearch = useCallback(async () => {
    const q = custQuery.trim();
    if (!q) return;
    setCustLoading(true);
    setCustError(null);
    setCustSearched(true);
    try {
      const isPhone = /^\d+$/.test(q);
      const res = await searchCustomers(isPhone ? { phone: q, limit: 10 } : { name: q, limit: 10 });
      setCustResults(res.customers);
    } catch {
      setCustError('Customer lookup failed — loyalty may not be enabled');
      setCustResults([]);
    } finally {
      setCustLoading(false);
    }
  }, [custQuery]);

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    let cancelled = false;
    setError(null);

    const [rpt, pen, dev, jobs] = await Promise.allSettled([
      fetchDailyReport(),
      fetchCashierOrders(),
      fetchPrinterDevices(),
      fetchReceiptJobs(),
    ]);

    if (cancelled) return;

    setReportLoading(false);
    setPendingLoading(false);
    setPrinterLoading(false);

    if (rpt.status === 'fulfilled')  setReport(rpt.value);
    else                              setError('Could not load daily stats');

    if (pen.status === 'fulfilled')  setPendingOrders(pen.value);
    if (dev.status === 'fulfilled')  setPrinters(dev.value);
    if (jobs.status === 'fulfilled') {
      const last = jobs.value.find(j => j.jobType === 'receipt') ?? null;
      setLastReceipt(last);
    }

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

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  const navigate = useNavigate();

  // F2 → Cashier Ops (this page — used from other pages in the app)
  // F3 → Tables (already registered in DashboardPage when that's active)
  // Ctrl+F → focus bill search
  // Ctrl+P → reprint last bill
  // Ctrl+B → go to Dashboard (billing/table view)
  // Esc → clear active search

  // F2 shortcut via KeyboardContext
  useShortcut('F2', useCallback(() => { navigate('/cashier'); }, [navigate]));

  // Esc: clear bill search or customer search if either is active
  useShortcut('Escape', useCallback(() => {
    if (searched) {
      setSearched(false); setSearchResults([]); setSearchTerm(''); setSearchError(null);
    } else if (custSearched) {
      setCustSearched(false); setCustResults([]); setCustQuery(''); setCustError(null);
    }
  }, [searched, custSearched]));

  // Ctrl combos need a direct keydown listener (KeyboardContext only covers F-keys + Esc)
  const reprintLastRef = useRef(handleReprintLast);
  useEffect(() => { reprintLastRef.current = handleReprintLast; }, [handleReprintLast]);

  // Ctrl+F / Ctrl+B / Ctrl+P — registered once, never re-creates
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case 'f': {
          e.preventDefault();
          const el = document.getElementById('cashier-bill-search');
          if (el) (el as HTMLInputElement).focus();
          break;
        }
        case 'b': {
          e.preventDefault();
          navigate('/dashboard');
          break;
        }
        case 'p': {
          e.preventDefault();
          void reprintLastRef.current();
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

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

        {/* ── Bill Search ────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">Bill Search</h2>

          {/* Controls */}
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-40 flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35" />
              <input
                id="cashier-bill-search"
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void handleSearch()}
                placeholder="Bill No · Table · Customer"
                className="h-8 w-full rounded-lg border border-border bg-canvas pl-8 pr-3 text-xs text-ink placeholder:text-ink/30 outline-none transition focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <input
              type="date"
              value={searchDate}
              onChange={e => setSearchDate(e.target.value)}
              className="h-8 rounded-lg border border-border bg-canvas px-2 text-xs text-ink outline-none transition focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
            />
            <select
              value={searchStatus}
              onChange={e => setSearchStatus(e.target.value as 'all' | 'served' | 'completed')}
              className="h-8 rounded-lg border border-border bg-canvas px-2 text-xs text-ink outline-none transition focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
            >
              <option value="all">All status</option>
              <option value="served">Served (pending)</option>
              <option value="completed">Completed</option>
            </select>
            <button
              onClick={() => void handleSearch()}
              disabled={searchLoading}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-xs font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
            >
              {searchLoading ? <Spinner size="sm" /> : <Search size={13} />}
              Search
            </button>
            {searched && (
              <button
                onClick={() => { setSearched(false); setSearchResults([]); setSearchTerm(''); setSearchError(null); }}
                className="flex h-8 items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 text-xs text-ink/50 transition hover:bg-mist"
              >
                <X size={12} />
                Clear
              </button>
            )}
          </div>

          {/* Error */}
          {searchError && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {searchError}
            </div>
          )}

          {/* Results */}
          {searched && !searchLoading && (
            <div className="mt-3">
              {searchResults.length === 0 ? (
                <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-border">
                  <p className="text-sm text-ink/30">No bills found</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[1fr_5rem_5rem_5rem_5rem] items-center gap-3 px-3.5 text-[10px] font-semibold uppercase tracking-wider text-ink/35">
                    <span>Bill / Table</span>
                    <span className="text-right">Amount</span>
                    <span>Method</span>
                    <span>Time</span>
                    <span className="text-right">Action</span>
                  </div>
                  {searchResults.map(o => {
                    const hasJob    = printJobs.some(j => j.orderId === o._id && j.jobType === 'receipt');
                    const isReprint = reprintingId === o._id;
                    return (
                      <div
                        key={o._id}
                        className="grid grid-cols-[1fr_5rem_5rem_5rem_5rem] items-center gap-3 rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-xs"
                      >
                        <div>
                          <p className="font-semibold text-ink">{o.orderNumber}</p>
                          <p className="text-ink/40">
                            {o.isParcel ? 'Parcel' : `Table ${o.tableNumber}`}
                            {o.customerName ? ` · ${o.customerName}` : ''}
                          </p>
                        </div>
                        <span className="text-right font-semibold tabular-nums text-ink">
                          {fmtINR(sym, o.grandTotal)}
                        </span>
                        <span className="capitalize text-ink/50">{o.paymentMethod ?? '—'}</span>
                        <span className="text-ink/40">
                          {new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <div className="flex justify-end">
                          {hasJob ? (
                            <button
                              onClick={() => void handleReprint(o._id)}
                              disabled={isReprint}
                              className="flex items-center gap-1 rounded-md border border-border bg-mist px-2 py-1 text-[11px] font-medium text-ink/60 transition hover:bg-border disabled:opacity-60"
                            >
                              {isReprint ? <Spinner size="sm" /> : <Printer size={11} />}
                              Reprint
                            </button>
                          ) : (
                            <span className="text-[11px] text-ink/25">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Printer Operations ─────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Printer Operations</h2>
            <button
              onClick={() => { setPrinterLoading(true); void load(); }}
              className="text-xs text-brand hover:underline"
            >
              Refresh
            </button>
          </div>

          {printerLoading ? (
            <div className="flex h-20 items-center justify-center"><Spinner size="sm" /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Printer status cards */}
              {printers.length === 0 ? (
                <div className="col-span-2 flex h-16 items-center justify-center rounded-xl border border-dashed border-border">
                  <p className="text-sm text-ink/30">No printers registered</p>
                </div>
              ) : (
                printers.map(p => {
                  const ageMs = p.lastHeartbeat ? nowMs - new Date(p.lastHeartbeat).getTime() : Infinity;
                  const online = p.online && ageMs < 3 * 60_000;
                  return (
                    <div
                      key={p._id}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                        online ? 'border-emerald-200 bg-emerald-50' : 'border-red-100 bg-red-50'
                      }`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        online ? 'bg-emerald-100' : 'bg-red-100'
                      }`}>
                        <Printer size={16} className={online ? 'text-emerald-600' : 'text-red-400'} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold capitalize text-ink">
                          {p.printerName ?? p.printerRole} printer
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {online
                            ? <><Wifi size={11} className="text-emerald-500" /><span className="text-[11px] text-emerald-600">Online</span></>
                            : <><WifiOff size={11} className="text-red-400" /><span className="text-[11px] text-red-500">Offline</span></>
                          }
                        </div>
                      </div>
                      <span className="text-[10px] capitalize text-ink/40">{p.printerRole}</span>
                    </div>
                  );
                })
              )}

              {/* Reprint Last Bill */}
              <div className="flex items-center justify-between rounded-xl border border-border bg-canvas px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Reprint Last Bill</p>
                  <p className="text-[11px] text-ink/40">
                    {lastReceipt
                      ? `Job ${lastReceipt._id.slice(-6)} · ${lastReceipt.status}`
                      : 'No receipt jobs found'}
                  </p>
                </div>
                <button
                  onClick={() => void handleReprintLast()}
                  disabled={!lastReceipt || reprintLast === 'loading'}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    reprintLast === 'ok'
                      ? 'bg-emerald-100 text-emerald-700'
                      : reprintLast === 'err'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-brand text-white hover:bg-brand/90 disabled:opacity-50'
                  }`}
                >
                  {reprintLast === 'loading' ? <Spinner size="sm" /> : <Printer size={12} />}
                  {reprintLast === 'ok' ? 'Sent!' : reprintLast === 'err' ? 'Failed' : 'Reprint'}
                </button>
              </div>

              {/* Test Print — Coming Soon */}
              <div className="flex items-center justify-between rounded-xl border border-dashed border-border bg-canvas px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink/60">Test Print</p>
                  <p className="text-[11px] text-ink/35">Print a test page to verify printer</p>
                </div>
                <span className="rounded-full bg-ink/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/35">
                  Coming Soon
                </span>
              </div>
            </div>
          )}
        </section>

        {/* ── Customer Quick Actions ──────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">Customer Quick Lookup</h2>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Users size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35" />
              <input
                id="cashier-cust-search"
                type="text"
                value={custQuery}
                onChange={e => setCustQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void handleCustSearch()}
                placeholder="Name or mobile number"
                className="h-8 w-full rounded-lg border border-border bg-canvas pl-8 pr-3 text-xs text-ink placeholder:text-ink/30 outline-none transition focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <button
              onClick={() => void handleCustSearch()}
              disabled={custLoading || !custQuery.trim()}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-xs font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
            >
              {custLoading ? <Spinner size="sm" /> : <Search size={13} />}
              Find
            </button>
            {custSearched && (
              <button
                onClick={() => { setCustSearched(false); setCustResults([]); setCustQuery(''); setCustError(null); }}
                className="flex h-8 items-center px-2.5 rounded-lg border border-border bg-canvas text-xs text-ink/50 transition hover:bg-mist"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {custError && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {custError}
            </div>
          )}

          {custSearched && !custLoading && (
            <div className="mt-3">
              {custResults.length === 0 ? (
                <div className="flex h-16 items-center justify-center rounded-xl border border-dashed border-border">
                  <p className="text-sm text-ink/30">No customer found</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {custResults.map(c => (
                    <div
                      key={c._id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-canvas px-3.5 py-2.5"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10">
                        <Users size={13} className="text-brand" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink truncate">{c.name}</p>
                        <p className="text-[11px] text-ink/40">
                          {c.phone ?? 'No phone'} · {c.visitCount} visit{c.visitCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="flex items-center justify-end gap-1 text-xs font-semibold text-brand">
                          <Star size={11} strokeWidth={2.5} />
                          {c.loyaltyBalance.toLocaleString('en-IN')} pts
                        </div>
                        <p className="text-[11px] text-ink/40">
                          {fmtINR(sym, c.lifetimeSpend)} lifetime
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Favourite Products ──────────────────────────────────────── */}
        <FavouriteProducts sym={sym} />

        {/* ── Coming Soon: Hold Bills · Manager Approval · Cash Drawer ─── */}
        <div className="grid gap-3 sm:grid-cols-3">

          <div className="rounded-xl border border-dashed border-border bg-canvas p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink/5">
                <Clock size={14} className="text-ink/30" />
              </div>
              <p className="text-sm font-semibold text-ink">Hold / Park Bills</p>
            </div>
            <ul className="mb-3 space-y-1 text-[11px] text-ink/50">
              <li>· Hold current bill</li>
              <li>· Resume held bill</li>
              <li>· Held bill counter</li>
            </ul>
            <span className="inline-block rounded-full bg-ink/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/35">
              Coming Soon
            </span>
            <p className="mt-2 text-[10px] text-ink/30">Requires backend session parking</p>
          </div>

          <div className="rounded-xl border border-dashed border-border bg-canvas p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink/5">
                <AlertCircle size={14} className="text-ink/30" />
              </div>
              <p className="text-sm font-semibold text-ink">Manager Approval</p>
            </div>
            <ul className="mb-3 space-y-1 text-[11px] text-ink/50">
              <li>· Discount / void / cancel</li>
              <li>· Price override · refund</li>
              <li>· PIN-based auth</li>
            </ul>
            <span className="inline-block rounded-full bg-ink/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/35">
              Coming Soon
            </span>
            <p className="mt-2 text-[10px] text-ink/30">Requires manager PIN endpoint</p>
          </div>

          <div className="rounded-xl border border-dashed border-border bg-canvas p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink/5">
                <Wallet size={14} className="text-ink/30" />
              </div>
              <p className="text-sm font-semibold text-ink">Cash Drawer</p>
            </div>
            <ul className="mb-3 space-y-1 text-[11px] text-ink/50">
              <li>· Open / manual open</li>
              <li>· Cash In · Cash Out</li>
              <li>· Reason entry</li>
            </ul>
            <span className="inline-block rounded-full bg-ink/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/35">
              Coming Soon
            </span>
            <p className="mt-2 text-[10px] text-ink/30">Requires hardware drawer API</p>
          </div>

        </div>

      </div>
    </div>
  );
}
