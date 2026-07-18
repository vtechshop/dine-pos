import { useState, useEffect, useCallback, useMemo, useReducer } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { Table, SessionSummary, TableGridItem } from '../types';
import { fetchTables, fetchOpenSessions, openSession } from '../api/tables';
import { TableCard } from '../components/ui/TableCard';
import { Spinner } from '../components/ui/Spinner';
import { BillingDrawer } from '../components/billing/BillingDrawer';
import { useSettings } from '../context/SettingsContext';
import { useSocket } from '../context/SocketContext';
import { useShortcut } from '../hooks/useShortcut';

// ── New-order badge state ─────────────────────────────────────────────────────
// Tracked separately so socket events do NOT re-render the full table grid.
// Only the single affected TableCard re-renders (React.memo equality check).

type BadgeAction =
  | { type: 'ADD';    tableNumber: string }
  | { type: 'REMOVE'; tableNumber: string };

function badgeReducer(state: Set<string>, action: BadgeAction): Set<string> {
  const next = new Set(state);
  if (action.type === 'ADD')    next.add(action.tableNumber);
  if (action.type === 'REMOVE') next.delete(action.tableNumber);
  return next;
}

// ── Filter types ──────────────────────────────────────────────────────────────

type Filter = 'all' | 'occupied' | 'available';

// ── Dashboard page ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { settings }                   = useSettings();
  const { socket, reconnectCount }     = useSocket();
  const currencySymbol                 = settings?.currencySymbol ?? '₹';

  const [tables,   setTables]   = useState<Table[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<Filter>('all');
  const [search,   setSearch]   = useState('');
  const [billingSessionId, setBillingSessionId] = useState<string | null>(null);
  const [openingTableId,   setOpeningTableId]   = useState<string | null>(null);

  // Badge state — updated by socket without touching table/session arrays
  const [newOrderTables, dispatchBadge] = useReducer(badgeReducer, new Set<string>());

  // ── Data loading ────────────────────────────────────────────────────────────

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

  // Initial load + refresh after socket reconnect
  useEffect(() => { void load(); }, [load, reconnectCount]);

  // Periodic refresh every 2 minutes (elapsed times stay fresh)
  useEffect(() => {
    const id = setInterval(() => void load(), 120_000);
    return () => clearInterval(id);
  }, [load]);

  // ── Socket: targeted badge update — does NOT rebuild table list ─────────────
  // Only the affected TableCard re-renders (React.memo guards the rest).

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

  // ── Keyboard shortcuts (architecture layer — handlers wired here) ───────────

  useShortcut('F1', () => {
    (document.getElementById('table-search') as HTMLInputElement | null)?.focus();
  });

  useShortcut('Escape', () => {
    setSearch('');
    (document.getElementById('table-search') as HTMLInputElement | null)?.blur();
  }, !billingSessionId);

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
      if (err instanceof Error && !err.message.includes('409')) {
        setError(err.message || 'Failed to open table');
      }
    } finally {
      setOpeningTableId(null);
    }
  }, [load]);

  // ── Build joined table grid items ───────────────────────────────────────────

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

  // ── Filter + search ─────────────────────────────────────────────────────────

  const visibleItems = useMemo(() => {
    let items = gridItems;

    if (filter === 'occupied')  items = items.filter(t => t.status === 'occupied');
    if (filter === 'available') items = items.filter(t => t.status === 'available');

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(t =>
        t.name.toLowerCase().includes(q) ||
        String(t.number).includes(q),
      );
    }

    return items;
  }, [gridItems, filter, search]);

  const occupiedCount  = gridItems.filter(t => t.status === 'occupied').length;
  const availableCount = gridItems.filter(t => t.status === 'available').length;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#E8D5C0] bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-[#1C0800]">Table Grid</h1>
          <div className="flex items-center gap-1 text-xs text-[#1C0800]/40">
            <span className="text-green-600 font-medium">{occupiedCount} occupied</span>
            <span>·</span>
            <span>{availableCount} available</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search — F1 focuses this */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#1C0800]/30" />
            <input
              id="table-search"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search table… (F1)"
              className="h-8 w-48 rounded-lg border border-[#E8D5C0] bg-[#FFF6EE] pl-8 pr-3 text-xs text-[#1C0800] placeholder-[#1C0800]/30 outline-none focus:border-[#E8380D]/50 focus:ring-1 focus:ring-[#E8380D]/20"
            />
          </div>

          {/* Filter chips */}
          {(['all', 'occupied', 'available'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-[#E8380D] text-white'
                  : 'bg-[#1C0800]/5 text-[#1C0800]/50 hover:bg-[#1C0800]/10 hover:text-[#1C0800]'
              }`}
            >
              {f}
            </button>
          ))}

          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[#1C0800]/40 transition-colors hover:bg-[#1C0800]/5 hover:text-[#1C0800]/70 disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <div className="mb-4 rounded-lg border border-[#E8380D]/20 bg-[#E8380D]/10 px-4 py-3 text-sm text-[#E8380D]">
            {error}
          </div>
        )}

        {loading && tables.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-[#1C0800]/30">
            <p className="text-sm">No tables found</p>
            {search && (
              <button onClick={() => setSearch('')} className="mt-2 text-xs text-[#E8380D] hover:underline">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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

      {/* Billing drawer — rendered when an occupied table is clicked */}
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
