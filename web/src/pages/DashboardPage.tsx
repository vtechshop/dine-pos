import { useState, useEffect, useCallback, useMemo, useReducer } from 'react';
import {
  RefreshCw, Search, TrendingUp, ShoppingCart,
  LayoutGrid, Zap, Bell, X,
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

// ── New-order badge state ──────────────────────────────────────────────────────
// Tracked separately so socket events do NOT re-render the full table grid.

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
  icon:    React.ReactNode;
  label:   string;
  value:   string;
  sub?:    string;
  accent?: boolean;
}

function KpiCard({ icon, label, value, sub, accent }: KpiCardProps) {
  return (
    <div className={`rounded-xl border p-4 transition-shadow hover:shadow-sm ${
      accent
        ? 'border-brand/20 bg-brand/5'
        : 'border-border bg-canvas'
    }`}>
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className={accent ? 'text-brand' : 'text-ink/35'}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold tabular-nums leading-none text-ink">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

// ── Skeleton: KPI card ────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border bg-canvas p-4">
      <div className="mb-2.5 h-3 w-20 rounded bg-border" />
      <div className="mb-1.5 h-7 w-28 rounded bg-border" />
      <div className="h-3 w-16 rounded bg-border" />
    </div>
  );
}

// ── Skeleton: table card ──────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border bg-canvas p-3.5">
      <div className="mb-3 flex items-start justify-between">
        <div className="h-5 w-12 rounded bg-border" />
        <div className="h-4 w-16 rounded-full bg-border" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-border" />
        <div className="h-3 w-3/4 rounded bg-border" />
        <div className="h-3 w-1/2 rounded bg-border" />
      </div>
    </div>
  );
}

// ── Dashboard page ─────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { settings }               = useSettings();
  const { socket, reconnectCount } = useSocket();
  const { role }                   = useAuth();
  const { unreadCount, markRead }  = useLiveOrders();
  const currencySymbol             = settings?.currencySymbol ?? '₹';

  // Revenue data is shown to admin and cashier only
  const showRevenue = role === 'admin' || role === 'cashier';

  // ── State ───────────────────────────────────────────────────────────────────

  const [tables,        setTables]        = useState<Table[]>([]);
  const [sessions,      setSessions]      = useState<SessionSummary[]>([]);
  const [report,        setReport]        = useState<DailyReport | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [reportLoading, setReportLoading] = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [filter,        setFilter]        = useState<Filter>('all');
  const [search,        setSearch]        = useState('');
  const [billingSessionId, setBillingSessionId] = useState<string | null>(null);
  const [openingTableId,   setOpeningTableId]   = useState<string | null>(null);

  const [newOrderTables, dispatchBadge] = useReducer(badgeReducer, new Set<string>());

  // ── Data loading — tables/sessions (critical path) ──────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, s] = await Promise.all([fetchTables(), fetchOpenSessions()]);
      setTables(t);
      setSessions(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load table data');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Data loading — daily report (non-critical: fails silently) ──────────────

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      setReport(await fetchDailyReport());
    } catch {
      // KPI cards will show '—' — table grid is unaffected
    } finally {
      setReportLoading(false);
    }
  }, []);

  // Initial load + refresh after socket reconnect
  useEffect(() => {
    void load();
    void loadReport();
  }, [load, loadReport, reconnectCount]);

  // Periodic refresh every 2 minutes
  useEffect(() => {
    const id = setInterval(() => { void load(); void loadReport(); }, 120_000);
    return () => clearInterval(id);
  }, [load, loadReport]);

  // ── Socket: targeted badge update — does NOT rebuild table list ─────────────

  useEffect(() => {
    if (!socket) return;

    const handler = (data: unknown) => {
      const raw = (data && typeof data === 'object' && 'order' in data)
        ? (data as { order: Record<string, unknown> }).order
        : data as Record<string, unknown>;

      const tableNumber = typeof raw?.tableNumber === 'string' ? raw.tableNumber : null;
      if (!tableNumber) return;

      dispatchBadge({ type: 'ADD', tableNumber });
      setTimeout(() => dispatchBadge({ type: 'REMOVE', tableNumber }), 10_000);
    };

    socket.on('new_order', handler);
    return () => { socket.off('new_order', handler); };
  }, [socket]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useShortcut('F1', () => {
    (document.getElementById('table-search') as HTMLInputElement | null)?.focus();
  });

  useShortcut('Escape', () => {
    setSearch('');
    (document.getElementById('table-search') as HTMLInputElement | null)?.blur();
  }, !billingSessionId);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleTableSelect = useCallback((sessionId: string) => {
    setBillingSessionId(sessionId);
  }, []);

  const handleAvailableTableClick = useCallback(async (tableId: string) => {
    setOpeningTableId(tableId);
    try {
      const { session } = await openSession(tableId);
      void load();
      setBillingSessionId(session._id);
    } catch (err) {
      // 409 = race (table just became occupied) — refresh so grid reflects reality
      void load();
      if (!(err instanceof ApiError && err.status === 409)) {
        setError(err instanceof Error ? err.message : 'Failed to open table');
      }
    } finally {
      setOpeningTableId(null);
    }
  }, [load]);

  // ── Build joined table grid items ────────────────────────────────────────────

  const sessionByTableNumber = useMemo(
    () => new Map(sessions.map(s => [s.tableNumber, s])),
    [sessions],
  );

  const gridItems = useMemo((): TableGridItem[] => {
    return tables.map(table => ({
      ...table,
      session: table.currentSessionId
        ? sessionByTableNumber.get(String(table.number))
        : undefined,
    }));
  }, [tables, sessionByTableNumber]);

  // ── Filter + search ──────────────────────────────────────────────────────────

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

  // ── Dashboard derived KPI values — memoised so they only recompute when gridItems/report change ──

  const { occupiedCount, availableCount, totalNonInactive, isRushHour, avgTicket } = useMemo(() => {
    const occupied       = gridItems.filter(t => t.status === 'occupied').length;
    const available      = gridItems.filter(t => t.status === 'available').length;
    const nonInactive    = gridItems.filter(t => t.status !== 'inactive').length;
    const rushHour       = nonInactive > 0 && (occupied / nonInactive) >= 0.6;
    const avg            = report && report.totalOrders > 0
      ? report.totalSales / report.totalOrders
      : 0;
    return { occupiedCount: occupied, availableCount: available, totalNonInactive: nonInactive, isRushHour: rushHour, avgTicket: avg };
  }, [gridItems, report]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-ink">Dashboard</h1>
          {!loading && (
            <div className="flex items-center gap-1 text-xs text-ink/40">
              <span className="font-medium text-green-600">{occupiedCount} occupied</span>
              <span>·</span>
              <span>{availableCount} available</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search — F1 focuses this */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              id="table-search"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search table… (F1)"
              className="h-8 w-48 rounded-lg border border-border bg-mist pl-8 pr-3 text-xs text-ink placeholder:text-ink/30 outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 transition-colors"
            />
          </div>

          {/* Filter chips */}
          {(['all', 'occupied', 'available'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-brand text-white'
                  : 'bg-ink/5 text-ink/50 hover:bg-ink/10 hover:text-ink'
              }`}
            >
              {f}
            </button>
          ))}

          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70 disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
        <div className="border-b border-border bg-mist px-5 py-4">
          <div className={`grid gap-3 ${
            showRevenue
              ? 'grid-cols-2 sm:grid-cols-4'
              : 'grid-cols-1 sm:grid-cols-2'
          }`}>

            {/* Tables occupied — visible to all roles */}
            {loading ? <KpiSkeleton /> : (
              <KpiCard
                icon={<LayoutGrid size={14} />}
                label="Tables Occupied"
                value={`${occupiedCount} / ${totalNonInactive}`}
                sub={
                  totalNonInactive > 0
                    ? `${Math.round((occupiedCount / totalNonInactive) * 100)}% capacity`
                    : 'No active tables'
                }
                accent={isRushHour}
              />
            )}

            {/* Revenue — admin / cashier only */}
            {showRevenue && (
              reportLoading ? <KpiSkeleton /> : (
                <KpiCard
                  icon={<TrendingUp size={14} />}
                  label="Today's Revenue"
                  value={
                    report
                      ? `${currencySymbol}${Math.round(report.totalSales).toLocaleString('en-IN')}`
                      : '—'
                  }
                  sub={
                    report
                      ? `incl. ${currencySymbol}${Math.round(report.totalTax).toLocaleString('en-IN')} tax`
                      : undefined
                  }
                />
              )
            )}

            {/* Orders — admin / cashier only */}
            {showRevenue && (
              reportLoading ? <KpiSkeleton /> : (
                <KpiCard
                  icon={<ShoppingCart size={14} />}
                  label="Orders Today"
                  value={report ? String(report.totalOrders) : '—'}
                  sub={
                    report && report.parcelOrders > 0
                      ? `${report.parcelOrders} parcel`
                      : undefined
                  }
                />
              )
            )}

            {/* Avg ticket — admin / cashier only */}
            {showRevenue && (
              reportLoading ? <KpiSkeleton /> : (
                <KpiCard
                  icon={<Zap size={14} />}
                  label="Avg. Ticket"
                  value={
                    report && report.totalOrders > 0
                      ? `${currencySymbol}${Math.round(avgTicket).toLocaleString('en-IN')}`
                      : '—'
                  }
                  sub={report && report.totalOrders > 0 ? 'per order' : undefined}
                />
              )
            )}
          </div>
        </div>

        {/* ── Rush Hour banner ───────────────────────────────────────────────── */}
        {isRushHour && (
          <div className="flex items-center gap-2.5 border-b border-brand/20 bg-brand/5 px-5 py-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            <span className="text-xs font-semibold text-brand">
              Rush hour — {occupiedCount} of {totalNonInactive} tables active
            </span>
          </div>
        )}

        {/* ── Notification strip ─────────────────────────────────────────────── */}
        {unreadCount > 0 && (
          <div className="flex items-center justify-between border-b border-border bg-canvas px-5 py-2">
            <div className="flex items-center gap-2">
              <Bell size={13} className="text-brand" />
              <span className="text-xs font-medium text-ink">
                {unreadCount} new order{unreadCount > 1 ? 's' : ''} received
              </span>
            </div>
            <button
              onClick={markRead}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <X size={11} />
              Dismiss
            </button>
          </div>
        )}

        {/* ── Table grid ─────────────────────────────────────────────────────── */}
        <div className="p-5">

          {/* Error state */}
          {error && (
            <div className="mb-4 rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-brand">
              {error}
            </div>
          )}

          {/* Initial load: skeleton grid */}
          {loading && tables.length === 0 ? (
            <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {Array.from({ length: 12 }, (_, i) => <TableSkeleton key={i} />)}
            </div>

          /* Empty state */
          ) : visibleItems.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center">
              <LayoutGrid size={28} className="mb-2 text-ink/20" />
              <p className="text-sm text-ink/30">No tables found</p>
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="mt-2 text-xs text-brand hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>

          /* Table grid */
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {visibleItems.map(table => (
                <TableCard
                  key={table._id}
                  table={table}
                  hasNewOrder={newOrderTables.has(String(table.number))}
                  currencySymbol={currencySymbol}
                  onSelect={table.status === 'occupied' ? handleTableSelect : undefined}
                  onOpenAvailable={
                    table.status === 'available'
                      ? () => void handleAvailableTableClick(table._id)
                      : undefined
                  }
                  isOpening={openingTableId === table._id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Billing drawer — unchanged ────────────────────────────────────────── */}
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
