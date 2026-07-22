import { useState, useEffect, useCallback } from 'react';
import {
  Users, Clock, LayoutGrid, RefreshCw, AlertCircle,
  UtensilsCrossed, CheckCircle, CreditCard, Plus,
  Search, X, ChevronRight,
} from 'lucide-react';
import { fetchTables, fetchOpenSessions } from '../../api/tables';
import { useCashier } from '../../context/CashierContext';
import { useSettings } from '../../context/SettingsContext';
import { Spinner } from '../ui/Spinner';
import type { Table, SessionSummary } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtElapsed(openedAt: string, nowMs: number): string {
  const ms = nowMs - new Date(openedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Table grid item with merged session ────────────────────────────────────────

interface TableWithSession extends Table {
  session?: SessionSummary;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; border: string; dot: string; text: string }> = {
  available: {
    label: 'Available',
    bg: 'bg-emerald-50/60',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
  },
  occupied: {
    label: 'Occupied',
    bg: 'bg-blue-50/60',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
    text: 'text-blue-700',
  },
  reserved: {
    label: 'Reserved',
    bg: 'bg-amber-50/60',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
    text: 'text-amber-700',
  },
  inactive: {
    label: 'Inactive',
    bg: 'bg-mist/60',
    border: 'border-border',
    dot: 'bg-ink/20',
    text: 'text-ink/40',
  },
};

// ── Table card ────────────────────────────────────────────────────────────────

function TableCard({
  table,
  nowMs,
  sym,
  selected,
  onClick,
}: {
  table: TableWithSession;
  nowMs: number;
  sym: string;
  selected: boolean;
  onClick: () => void;
}) {
  const cfg = STATUS_CONFIG[table.session ? 'occupied' : (table.status ?? 'available')] ?? STATUS_CONFIG['available']!;
  const isOccupied = !!table.session;
  const isDelayed = isOccupied && table.session?.openedAt &&
    nowMs - new Date(table.session.openedAt).getTime() > 90 * 60_000;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl border p-3 text-left transition hover:shadow-md active:scale-[0.98] ${cfg.bg} ${cfg.border} ${
        selected ? 'ring-2 ring-brand' : ''
      } ${isDelayed ? 'ring-1 ring-amber-400' : ''}`}
    >
      {/* Status dot */}
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} />
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</span>
        </div>
        {isDelayed && (
          <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
            Long
          </span>
        )}
      </div>

      {/* Table name */}
      <p className="text-sm font-bold text-ink leading-tight">
        {table.name || `T${table.number}`}
      </p>
      <div className="flex items-center gap-1 mt-0.5 text-[10px] text-ink/50">
        <Users size={9} />
        {table.capacity} seats
      </div>

      {/* Session info */}
      {table.session ? (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink/50">{table.session.activeGuestCount ?? table.session.guestCount} guests</span>
            <span className="text-[10px] font-medium text-ink">{fmtINR(sym, table.session.runningTotal)}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-ink/45">
            <Clock size={9} />
            {table.session.openedAt ? fmtElapsed(table.session.openedAt, nowMs) : '—'}
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-[10px] text-ink/35">Ready to seat</p>
        </div>
      )}
    </button>
  );
}

// ── Selected table detail panel ───────────────────────────────────────────────

function TableDetailPanel({
  table,
  nowMs,
  sym,
  onClose,
  onNewOrder,
  onGoPayment,
}: {
  table: TableWithSession;
  nowMs: number;
  sym: string;
  onClose: () => void;
  onNewOrder: () => void;
  onGoPayment: () => void;
}) {
  const isOccupied = !!table.session;
  const cfg = STATUS_CONFIG[isOccupied ? 'occupied' : (table.status ?? 'available')]!;

  return (
    <div className="rounded-xl border border-border bg-canvas p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UtensilsCrossed size={16} className="text-brand" />
          <div>
            <p className="text-sm font-bold text-ink">{table.name || `Table ${table.number}`}</p>
            <p className="text-[10px] text-ink/50">{table.capacity} seats</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-border p-1 text-ink/40 hover:bg-mist">
          <X size={13} />
        </button>
      </div>

      {/* Status badge */}
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.border} ${cfg.bg} ${cfg.text}`}>
        <div className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </div>

      {/* Session info */}
      {table.session ? (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Current Session</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-ink/50">Running Total</p>
              <p className="text-base font-bold text-brand">{fmtINR(sym, table.session.runningTotal)}</p>
            </div>
            <div>
              <p className="text-[10px] text-ink/50">Guests</p>
              <p className="text-base font-bold text-ink">{table.session.activeGuestCount ?? table.session.guestCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-ink/50">Open Since</p>
              <p className="text-xs font-medium text-ink">
                {table.session.openedAt
                  ? new Date(table.session.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-ink/50">Duration</p>
              <p className="text-xs font-medium text-ink">
                {table.session.openedAt ? fmtElapsed(table.session.openedAt, nowMs) : '—'}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div className="space-y-2">
        {!isOccupied ? (
          <button
            type="button"
            onClick={onNewOrder}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white hover:bg-brand/90"
          >
            <Plus size={16} />
            Open Table & New Order
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onGoPayment}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <CreditCard size={16} />
              Take Payment
              <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
                {fmtINR(sym, table.session?.runningTotal ?? 0)}
              </span>
            </button>
            <button
              type="button"
              onClick={onNewOrder}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold text-ink hover:bg-mist"
            >
              <Plus size={14} />
              Add More Items
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CashierTablePanel() {
  const { setActiveTab, setOrderPrefill } = useCashier();
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [tables, setTables] = useState<TableWithSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'available' | 'occupied'>('all');
  const [selected, setSelected] = useState<TableWithSession | null>(null);

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    const [tblRes, sessRes] = await Promise.allSettled([
      fetchTables(),
      fetchOpenSessions(),
    ]);
    if (!cancelled) {
      if (tblRes.status === 'fulfilled' && sessRes.status === 'fulfilled') {
        const sessions = sessRes.value;
        const merged: TableWithSession[] = tblRes.value.map(t => ({
          ...t,
          session: sessions.find(s => s._id === t.currentSessionId) ??
                   sessions.find(s => s.tableNumber === String(t.number)),
        }));
        setTables(merged);
        setError(null);
      } else if (tblRes.status === 'fulfilled') {
        setTables(tblRes.value);
        setError(null);
      } else {
        setError('Failed to load tables');
      }
      setNowMs(Date.now());
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, 30_000);
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [load]);

  const filtered = tables.filter(t => {
    const matchSearch = !search ||
      String(t.number).includes(search) ||
      (t.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      filterStatus === 'all' ||
      (filterStatus === 'occupied' && !!t.session) ||
      (filterStatus === 'available' && !t.session);
    return matchSearch && matchStatus;
  });

  const occupiedCount  = tables.filter(t => !!t.session).length;
  const availableCount = tables.filter(t => !t.session && t.status !== 'inactive').length;
  const totalSales     = tables
    .reduce((sum, t) => sum + (t.session?.runningTotal ?? 0), 0);

  function handleSelectTable(t: TableWithSession) {
    setSelected(prev => prev?._id === t._id ? null : t);
  }

  function handleNewOrder(t: TableWithSession) {
    setOrderPrefill({
      orderType: 'dine-in',
      tableId: t._id,
      tableNumber: String(t.number),
    });
    setActiveTab('new-order');
  }

  function handleGoPayment() {
    setActiveTab('pending');
  }

  return (
    <div className="space-y-4">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Table Floor</h2>
          {/* Status summary chips */}
          <div className="flex items-center gap-1.5">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              {availableCount} free
            </span>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {occupiedCount} occupied
            </span>
            {totalSales > 0 && (
              <span className="rounded-full border border-brand/20 bg-brand/5 px-2 py-0.5 text-[10px] font-semibold text-brand">
                {fmtINR(sym, totalSales)} live
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist disabled:opacity-50"
        >
          {loading ? <Spinner size="sm" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {/* ── Search + filter ───────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tables…"
            className="w-full rounded-lg border border-border py-2 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/35">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {(['all', 'available', 'occupied'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                filterStatus === s ? 'bg-brand text-white' : 'text-ink/60 hover:bg-mist'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertCircle size={13} className="text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* ── Content: table grid + detail panel ────────────────────────────── */}
      <div className={`grid gap-4 ${selected ? 'lg:grid-cols-[1fr_280px]' : ''}`}>
        {/* Table grid */}
        <div>
          {loading && tables.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-10 text-center">
              <LayoutGrid size={22} className="mx-auto mb-2 text-ink/20" />
              <p className="text-sm text-ink/40">
                {search ? 'No tables match your search' : 'No tables configured'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map(t => (
                <TableCard
                  key={t._id}
                  table={t}
                  nowMs={nowMs}
                  sym={sym}
                  selected={selected?._id === t._id}
                  onClick={() => handleSelectTable(t)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail side panel */}
        {selected && (
          <div className="shrink-0">
            <TableDetailPanel
              table={selected}
              nowMs={nowMs}
              sym={sym}
              onClose={() => setSelected(null)}
              onNewOrder={() => handleNewOrder(selected)}
              onGoPayment={handleGoPayment}
            />

            {/* Legend */}
            <div className="mt-3 space-y-1 rounded-xl border border-border bg-canvas p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink/40">Legend</p>
              {[
                { label: 'Available', cfg: STATUS_CONFIG['available']! },
                { label: 'Occupied', cfg: STATUS_CONFIG['occupied']! },
                { label: 'Reserved', cfg: STATUS_CONFIG['reserved']! },
              ].map(({ label, cfg }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                  <span className="text-xs text-ink/60">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <div className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-xs text-ink/60">Long sitting (&gt;90 min)</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Quick new order CTA (no table selected, bottom strip) ───────────── */}
      {!selected && (
        <button
          type="button"
          onClick={() => { setOrderPrefill({ orderType: 'dine-in' }); setActiveTab('new-order'); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand/20 bg-brand/5 py-3 text-sm font-semibold text-brand hover:bg-brand/10"
        >
          <Plus size={16} />
          New Dine-In Order (no table)
          <ChevronRight size={14} />
        </button>
      )}

      {/* ── Inline legend when no side panel ─────────────────────────────── */}
      {!selected && tables.length > 0 && (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-canvas px-4 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/35">Legend</p>
          {[
            { dot: 'bg-emerald-500', label: 'Available' },
            { dot: 'bg-blue-500', label: 'Occupied' },
            { dot: 'bg-amber-500', label: 'Reserved' },
            { dot: 'bg-ink/20', label: 'Inactive' },
          ].map(({ dot, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full ${dot}`} />
              <span className="text-[10px] text-ink/50">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
