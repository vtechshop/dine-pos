import { useState, useEffect, useCallback, useMemo, useReducer, useRef } from 'react';
import {
  RefreshCw, Search, TrendingUp, ShoppingCart, LayoutGrid, Zap,
  Bell, X, Wifi, WifiOff, Plus, Users, Clock, Activity,
  ChevronRight, AlertCircle, Coffee,
} from 'lucide-react';
import type { Table, SessionSummary, TableGridItem, DailyReport } from '../types';
import { fetchTables, fetchOpenSessions, openSession } from '../api/tables';
import { ApiError } from '../api/client';
import { fetchDailyReport } from '../api/dashboard';
import { TableCard } from '../components/ui/TableCard';
import { BillingDrawer } from '../components/billing/BillingDrawer';
import { useSettings } from '../context/SettingsContext';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useLiveOrders } from '../context/LiveOrdersContext';
import { useShortcut } from '../hooks/useShortcut';
import { useNavigate } from 'react-router-dom';

// ── Badge reducer ─────────────────────────────────────────────────────────────

type BadgeAction =
  | { type: 'ADD';    tableNumber: string }
  | { type: 'REMOVE'; tableNumber: string };

function badgeReducer(state: Set<string>, action: BadgeAction): Set<string> {
  const next = new Set(state);
  if (action.type === 'ADD')    next.add(action.tableNumber);
  if (action.type === 'REMOVE') next.delete(action.tableNumber);
  return next;
}

type Filter = 'all' | 'occupied' | 'available';

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon:     React.ReactNode;
  label:    string;
  value:    string;
  sub?:     string;
  accent?:  boolean;
  bar?:     number; // 0–100 fill %
  barColor?:string;
}

function KpiCard({ icon, label, value, sub, accent, bar, barColor = 'bg-brand' }: KpiCardProps) {
  return (
    <div className={`rounded-xl border p-3.5 transition-all duration-150 hover:shadow-1 ${
      accent ? 'border-brand/25 bg-brand-light' : 'border-border bg-surface'
    }`}>
      <div className="mb-2 flex items-center gap-1.5">
        <span className={accent ? 'text-brand' : 'text-ink/35'}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-[.07em] text-ink/40">{label}</span>
      </div>
      <p className="text-xl font-bold tabular-nums leading-none text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink/40">{sub}</p>}
      {bar !== undefined && (
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-border/50">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${bar}%` }}
          />
        </div>
      )}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border bg-surface p-3.5">
      <div className="mb-2 h-2.5 w-20 rounded bg-border" />
      <div className="mb-1 h-6 w-24 rounded bg-border" />
      <div className="h-2 w-14 rounded bg-border" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 flex justify-between">
        <div className="h-4 w-10 rounded bg-border" />
        <div className="h-3.5 w-8 rounded-full bg-border" />
      </div>
      <div className="space-y-1.5">
        <div className="h-2.5 w-full rounded bg-border" />
        <div className="h-2.5 w-3/4 rounded bg-border" />
      </div>
    </div>
  );
}

// ── Activity Feed ─────────────────────────────────────────────────────────────

import type { LiveOrder } from '../types';

function activityTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function ActivityFeed({ orders }: { orders: LiveOrder[] }) {
  const recent = orders.slice(0, 20);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Activity size={13} className="text-brand" />
        <span className="text-xs font-bold uppercase tracking-[.07em] text-ink/50">Activity</span>
      </div>
      {recent.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center py-8">
          <Coffee size={24} className="text-ink/15" />
          <p className="text-xs text-ink/30">No orders yet today</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {recent.map(order => (
            <div key={order.id} className="group flex items-start gap-3 border-b border-border/50 px-4 py-2.5 hover:bg-mist transition-colors">
              <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                order.isNew ? 'bg-brand animate-pulse' : 'bg-border'
              }`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-xs font-semibold text-ink truncate">
                    {order.tableNumber ? `Table ${order.tableNumber}` : order.orderSource || 'Order'}
                  </span>
                  <span className="text-[10px] text-ink/35 shrink-0 tabular-nums">
                    {activityTime(order.timestamp)}
                  </span>
                </div>
                <p className="text-[11px] text-ink/50 truncate">
                  {order.items?.length ?? 0} item{(order.items?.length ?? 0) !== 1 ? 's' : ''} · #{order.orderNumber}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { settings }               = useSettings();
  const { socket, reconnectCount } = useSocket();
  const { role }                   = useAuth();
  const { orders: liveOrders, unreadCount, markRead } = useLiveOrders();
  const navigate                   = useNavigate();
  const currencySymbol             = settings?.currencySymbol ?? '₹';
  const showRevenue                = role === 'admin' || role === 'cashier';

  // ── State ────────────────────────────────────────────────────────────────────

  const [tables,           setTables]           = useState<Table[]>([]);
  const [sessions,         setSessions]         = useState<SessionSummary[]>([]);
  const [report,           setReport]           = useState<DailyReport | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [reportLoading,    setReportLoading]    = useState(true);
  const [error,            setError]            = useState<string | null>(null);
  const [filter,           setFilter]           = useState<Filter>('all');
  const [search,           setSearch]           = useState('');
  const [billingSessionId, setBillingSessionId] = useState<string | null>(null);
  const [openingTableId,   setOpeningTableId]   = useState<string | null>(null);
  const [connected,        setConnected]        = useState(true);
  const [showActivity,     setShowActivity]     = useState(true);
  const lastReportAt = useRef(0);

  const [newOrderTables, dispatchBadge] = useReducer(badgeReducer, new Set<string>());

  // ── Data loading ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, s] = await Promise.all([fetchTables(), fetchOpenSessions()]);
      setTables(t);
      setSessions(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReport = useCallback(async () => {
    const now = Date.now();
    if (now - lastReportAt.current < 60_000) return; // debounce: max once per minute
    lastReportAt.current = now;
    setReportLoading(true);
    try { setReport(await fetchDailyReport()); } catch { /* non-critical */ }
    finally { setReportLoading(false); }
  }, []);

  useEffect(() => { void load(); void loadReport(); }, [load, loadReport, reconnectCount]);

  useEffect(() => {
    const id = setInterval(() => { void load(); void loadReport(); }, 120_000);
    return () => clearInterval(id);
  }, [load, loadReport]);

  // ── Socket ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;
    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onNewOrder   = (data: unknown) => {
      const raw = (data && typeof data === 'object' && 'order' in data)
        ? (data as { order: Record<string, unknown> }).order
        : data as Record<string, unknown>;
      const tableNumber = typeof raw?.tableNumber === 'string' ? raw.tableNumber : null;
      if (!tableNumber) return;
      dispatchBadge({ type: 'ADD', tableNumber });
      setTimeout(() => dispatchBadge({ type: 'REMOVE', tableNumber }), 10_000);
    };
    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('new_order',  onNewOrder);
    setConnected(socket.connected);
    return () => {
      socket.off('connect',    onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('new_order',  onNewOrder);
    };
  }, [socket]);

  // ── Shortcuts ────────────────────────────────────────────────────────────────

  useShortcut('F1', () =>
    (document.getElementById('table-search') as HTMLInputElement | null)?.focus(),
  );
  useShortcut('Escape', () => {
    setSearch('');
    (document.getElementById('table-search') as HTMLInputElement | null)?.blur();
  }, !billingSessionId);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleTableSelect = useCallback((sessionId: string) => setBillingSessionId(sessionId), []);

  const handleAvailableTableClick = useCallback(async (tableId: string) => {
    setOpeningTableId(tableId);
    try {
      const { session } = await openSession(tableId);
      void load();
      setBillingSessionId(session._id);
    } catch (err) {
      void load();
      if (!(err instanceof ApiError && err.status === 409))
        setError(err instanceof Error ? err.message : 'Failed to open table');
    } finally {
      setOpeningTableId(null);
    }
  }, [load]);

  // ── Derived data ──────────────────────────────────────────────────────────────

  const sessionByTableNumber = useMemo(
    () => new Map(sessions.map(s => [s.tableNumber, s])),
    [sessions],
  );

  const gridItems = useMemo((): TableGridItem[] =>
    tables.map(table => ({
      ...table,
      session: table.currentSessionId
        ? sessionByTableNumber.get(String(table.number))
        : undefined,
    })),
  [tables, sessionByTableNumber]);

  const visibleItems = useMemo(() => {
    let items = gridItems;
    if (filter === 'occupied')  items = items.filter(t => t.status === 'occupied');
    if (filter === 'available') items = items.filter(t => t.status === 'available');
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(t =>
        t.name.toLowerCase().includes(q) || String(t.number).includes(q),
      );
    }
    return items;
  }, [gridItems, filter, search]);

  const { occupiedCount, availableCount, totalNonInactive, isRushHour, avgTicket, occupancyPct } = useMemo(() => {
    const occ    = gridItems.filter(t => t.status === 'occupied').length;
    const avail  = gridItems.filter(t => t.status === 'available').length;
    const nonIn  = gridItems.filter(t => t.status !== 'inactive').length;
    const rush   = nonIn > 0 && (occ / nonIn) >= 0.6;
    const avg    = report && report.totalOrders > 0 ? report.totalSales / report.totalOrders : 0;
    const pct    = nonIn > 0 ? Math.round((occ / nonIn) * 100) : 0;
    return { occupiedCount: occ, availableCount: avail, totalNonInactive: nonIn, isRushHour: rush, avgTicket: avg, occupancyPct: pct };
  }, [gridItems, report]);

  const pendingOrders = useMemo(
    () => liveOrders.filter(o => o.isNew).length,
    [liveOrders],
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Status Strip ─────────────────────────────────────────────────────── */}
      <div className={`flex shrink-0 items-center justify-between border-b px-5 py-1.5 text-[11px] ${
        isRushHour ? 'border-brand/20 bg-brand/5' : 'border-border bg-canvas'
      }`}>
        <div className="flex items-center gap-4">
          {/* Socket status */}
          <span className={`flex items-center gap-1 font-medium ${connected ? 'text-green-600' : 'text-[#DC2626]'}`}>
            {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
          <span className="text-ink/40">
            {occupiedCount} occupied · {availableCount} available
          </span>
          {isRushHour && (
            <span className="flex items-center gap-1 font-semibold text-brand">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
              </span>
              Rush Hour
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {pendingOrders > 0 && (
            <button
              onClick={() => navigate('/orders')}
              className="flex items-center gap-1 font-semibold text-amber-600 hover:underline"
            >
              <AlertCircle size={11} />
              {pendingOrders} pending
            </button>
          )}
          {settings?.hotelName && (
            <span className="text-ink/30">{settings.hotelName}</span>
          )}
        </div>
      </div>

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-5 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-ink">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick actions */}
          <button
            onClick={() => navigate('/cashier')}
            className="btn btn-sm btn-primary gap-1.5"
          >
            <Plus size={12} /> New Order
          </button>
          <button
            onClick={() => navigate('/customers')}
            className="btn btn-sm btn-secondary"
          >
            <Users size={12} /> Find Guest
          </button>
          {showRevenue && (
            <button
              onClick={() => navigate('/reports')}
              className="btn btn-sm btn-secondary"
            >
              <TrendingUp size={12} /> Report
            </button>
          )}

          {/* Divider */}
          <div className="h-5 w-px bg-border mx-0.5" />

          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              id="table-search"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search… (F1)"
              className="h-8 w-40 rounded-lg border border-border bg-mist pl-8 pr-3 text-xs text-ink placeholder:text-ink/30 outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 transition-colors"
            />
          </div>

          {/* Filter chips */}
          {(['all', 'occupied', 'available'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`chip ${filter === f ? 'active' : ''}`}
            >
              {f === 'all' ? 'All' : f === 'occupied' ? 'Occupied' : 'Available'}
            </button>
          ))}

          {/* Activity toggle */}
          <button
            onClick={() => setShowActivity(a => !a)}
            className={`btn btn-sm ${showActivity ? 'btn-secondary' : 'btn-ghost'}`}
            title="Toggle activity feed"
          >
            <Activity size={13} />
          </button>

          <button
            onClick={() => void load()}
            disabled={loading}
            className="btn btn-sm btn-ghost"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── New order notification strip ─────────────────────────────────────── */}
      {unreadCount > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-brand/20 bg-brand/5 px-5 py-2">
          <div className="flex items-center gap-2">
            <Bell size={13} className="text-brand" />
            <span className="text-xs font-semibold text-brand">
              {unreadCount} new order{unreadCount > 1 ? 's' : ''} received
            </span>
          </div>
          <button
            onClick={markRead}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-brand/60 hover:bg-brand/10 transition-colors"
          >
            <X size={11} /> Dismiss
          </button>
        </div>
      )}

      {/* ── Body: KPI + Grid + Activity ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: KPI + Table Grid */}
        <div className="flex flex-1 flex-col overflow-y-auto">

          {/* KPI Strip */}
          <div className="shrink-0 border-b border-border bg-mist px-5 py-3">
            <div className={`grid gap-3 ${showRevenue ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-1 sm:grid-cols-2'}`}>

              {loading ? <KpiSkeleton /> : (
                <KpiCard
                  icon={<LayoutGrid size={13} />}
                  label="Tables Active"
                  value={`${occupiedCount} / ${totalNonInactive}`}
                  sub={`${occupancyPct}% capacity`}
                  accent={isRushHour}
                  bar={occupancyPct}
                  barColor={occupancyPct >= 80 ? 'bg-[#DC2626]' : occupancyPct >= 60 ? 'bg-amber-400' : 'bg-green-500'}
                />
              )}

              {showRevenue && (
                reportLoading ? <KpiSkeleton /> : (
                  <KpiCard
                    icon={<TrendingUp size={13} />}
                    label="Today's Revenue"
                    value={report ? `${currencySymbol}${Math.round(report.totalSales).toLocaleString('en-IN')}` : '—'}
                    sub={report ? `incl. ${currencySymbol}${Math.round(report.totalTax).toLocaleString('en-IN')} tax` : undefined}
                  />
                )
              )}

              {showRevenue && (
                reportLoading ? <KpiSkeleton /> : (
                  <KpiCard
                    icon={<ShoppingCart size={13} />}
                    label="Orders Today"
                    value={report ? String(report.totalOrders) : '—'}
                    sub={report && report.parcelOrders > 0 ? `${report.parcelOrders} parcel` : undefined}
                  />
                )
              )}

              {showRevenue && (
                <KpiCard
                  icon={<AlertCircle size={13} />}
                  label="Pending"
                  value={String(pendingOrders)}
                  sub="orders in kitchen"
                  accent={pendingOrders > 5}
                  bar={Math.min(pendingOrders * 10, 100)}
                  barColor={pendingOrders > 5 ? 'bg-[#DC2626]' : 'bg-amber-400'}
                />
              )}

              {showRevenue && (
                reportLoading ? <KpiSkeleton /> : (
                  <KpiCard
                    icon={<Zap size={13} />}
                    label="Avg. Ticket"
                    value={report && report.totalOrders > 0
                      ? `${currencySymbol}${Math.round(avgTicket).toLocaleString('en-IN')}`
                      : '—'}
                    sub="per order"
                  />
                )
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg border border-error/25 bg-error/5 px-4 py-2.5 text-sm text-error">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Table grid */}
          <div className="flex-1 p-4">
            {loading && tables.length === 0 ? (
              <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {Array.from({ length: 12 }, (_, i) => <TableSkeleton key={i} />)}
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                <LayoutGrid size={24} className="text-ink/15" />
                <p className="text-sm text-ink/30">No tables found</p>
                {search && (
                  <button onClick={() => setSearch('')} className="text-xs text-brand hover:underline">
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {visibleItems.map(table => (
                  <TableCard
                    key={table._id}
                    table={table}
                    hasNewOrder={newOrderTables.has(String(table.number))}
                    currencySymbol={currencySymbol}
                    onSelect={table.status === 'occupied' ? handleTableSelect : undefined}
                    onOpenAvailable={table.status === 'available' ? () => void handleAvailableTableClick(table._id) : undefined}
                    isOpening={openingTableId === table._id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Activity Feed (desktop only) */}
        {showActivity && (
          <div className="hidden lg:flex w-64 shrink-0 flex-col border-l border-border bg-surface animate-slide-left">
            <ActivityFeed orders={liveOrders} />
            <div className="border-t border-border p-3">
              <button
                onClick={() => navigate('/orders')}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-ink/50 hover:bg-mist hover:text-ink transition-colors"
              >
                View all orders <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Billing drawer ────────────────────────────────────────────────────── */}
      {billingSessionId && (
        <BillingDrawer
          sessionId={billingSessionId}
          openSessions={sessions}
          currencySymbol={currencySymbol}
          onClose={() => { setBillingSessionId(null); void load(); }}
        />
      )}
    </div>
  );
}
