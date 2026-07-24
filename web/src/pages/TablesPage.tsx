import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Pencil, Trash2, LayoutGrid, Circle, Users, RefreshCw,
  X, Check, Clock, ChevronRight, AlertCircle, Wifi, WifiOff,
} from 'lucide-react';
import type { Table, SessionSummary, TableGridItem } from '../types';
import { fetchTables, fetchOpenSessions, openSession, createTable, updateTable, deleteTable } from '../api/tables';
import { ApiError } from '../api/client';
import { TableCard } from '../components/ui/TableCard';
import { BillingDrawer } from '../components/billing/BillingDrawer';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useSettings } from '../context/SettingsContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsedMins(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function elapsedLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ── Table Form (config) ───────────────────────────────────────────────────────

interface FormState { number: string; name: string; capacity: string; shape: 'square' | 'round' }
const BLANK: FormState = { number: '', name: '', capacity: '4', shape: 'square' };

function TableForm({ initial = BLANK, onSave, onCancel, saving }: {
  initial?: FormState; onSave(v: FormState): void; onCancel(): void; saving: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);
  function set<K extends keyof FormState>(k: K, v: FormState[K]) { setForm(p => ({ ...p, [k]: v })); }
  const cls = 'ds-input';
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="field-label">Number *</label>
        <input type="number" min={1} value={form.number} onChange={e => set('number', e.target.value)} placeholder="1" className={cls} />
      </div>
      <div>
        <label className="field-label">Name *</label>
        <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="T1" className={cls} />
      </div>
      <div>
        <label className="field-label">Capacity *</label>
        <input type="number" min={1} max={50} value={form.capacity} onChange={e => set('capacity', e.target.value)} className={cls} />
      </div>
      <div>
        <label className="field-label">Shape</label>
        <select value={form.shape} onChange={e => set('shape', e.target.value as 'square' | 'round')} className={cls}>
          <option value="square">Square</option>
          <option value="round">Round</option>
        </select>
      </div>
      <div className="col-span-2 flex gap-2">
        <button onClick={() => onSave(form)} disabled={saving || !form.number || !form.name || !form.capacity} className="btn btn-md btn-primary">
          <Check size={13} />{saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="btn btn-md btn-secondary"><X size={13} />Cancel</button>
      </div>
    </div>
  );
}

// ── Context Panel ─────────────────────────────────────────────────────────────

function ContextPanel({
  item, currencySymbol, isAdmin,
  onOpenBilling, onOpenSession, onClose,
  onEditClick, isOpening,
}: {
  item: TableGridItem; currencySymbol: string; isAdmin: boolean;
  onOpenBilling(sessionId: string): void;
  onOpenSession(tableId: string): void;
  onClose(): void;
  onEditClick(table: Table): void;
  isOpening: boolean;
}) {
  const { session, status } = item;
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (status !== 'occupied' || !session) return;
    tickRef.current = setInterval(() => forceRender(n => n + 1), 30_000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [status, session]);

  const mins = session?.openedAt ? elapsedMins(session.openedAt) : 0;
  const timeColor = mins >= 60 ? 'text-[#DC2626]' : mins >= 30 ? 'text-amber-500' : 'text-green-600';

  return (
    <div className="flex h-full flex-col animate-slide-left">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {item.shape === 'round' ? <Circle size={14} className="text-ink/40" /> : <LayoutGrid size={14} className="text-ink/40" />}
          <span className="text-sm font-bold text-ink">{item.name}</span>
          <span className="text-xs text-ink/35">#{item.number}</span>
        </div>
        <button onClick={onClose} className="btn btn-sm btn-ghost p-1"><X size={14} /></button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Status */}
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${
            status === 'occupied'  ? 'bg-green-500'
            : status === 'reserved' ? 'bg-amber-400'
            : status === 'inactive' ? 'bg-border'
            : 'bg-ink/20'
          }`} />
          <span className="text-sm font-semibold text-ink capitalize">{status}</span>
          <span className="text-xs text-ink/40">{item.capacity} seats</span>
        </div>

        {/* Occupied: session info */}
        {status === 'occupied' && session ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-mist p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink/50">Guests</span>
                <span className="font-semibold text-ink flex items-center gap-1">
                  <Users size={11} className="text-ink/40" />
                  {session.activeGuestCount}/{session.guestCount}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink/50">Time</span>
                <span className={`font-semibold tabular-nums flex items-center gap-1 ${timeColor}`}>
                  <Clock size={11} />{elapsedLabel(mins)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink/50">Running Total</span>
                <span className="font-bold tabular-nums text-ink text-sm">
                  {currencySymbol}{session.runningTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              </div>
              {/* Time bar */}
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border/50">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    mins < 30 ? 'bg-green-400' : mins < 60 ? 'bg-amber-400' : 'bg-[#DC2626]'
                  } ${mins >= 90 ? 'animate-pulse' : ''}`}
                  style={{ width: `${Math.min((mins / 90) * 100, 100)}%` }}
                />
              </div>
            </div>
            <button
              onClick={() => onOpenBilling(session._id)}
              className="btn btn-lg btn-primary w-full"
            >
              Open Billing <ChevronRight size={14} />
            </button>
          </div>
        ) : status === 'available' ? (
          <button
            onClick={() => onOpenSession(item._id)}
            disabled={isOpening}
            className="btn btn-lg btn-primary w-full"
          >
            {isOpening ? <><Spinner size="sm" /> Opening…</> : 'Open Session'}
          </button>
        ) : status === 'reserved' ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Table is reserved
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-mist px-4 py-3 text-sm text-ink/40">
            Table is inactive
          </div>
        )}

        {/* Admin actions */}
        {isAdmin && (
          <div className="border-t border-border pt-3">
            <button
              onClick={() => onEditClick(item)}
              className="btn btn-md btn-secondary w-full"
            >
              <Pencil size={13} /> Edit Table
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Config Tab ────────────────────────────────────────────────────────────────

function ConfigTab({ tables, onReload }: { tables: Table[]; onReload(): void }) {
  const [addOpen,  setAddOpen]  = useState(false);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [formErr,  setFormErr]  = useState<string | null>(null);

  async function handleAdd(form: FormState) {
    setFormErr(null); setSaving(true);
    try {
      await createTable({ number: parseInt(form.number), name: form.name.trim(), capacity: parseInt(form.capacity), shape: form.shape });
      setAddOpen(false); onReload();
    } catch (e) { setFormErr(e instanceof Error ? e.message : 'Failed to create'); }
    finally { setSaving(false); }
  }

  async function handleEdit(id: string, form: FormState) {
    setFormErr(null); setSaving(true);
    try {
      await updateTable(id, { number: parseInt(form.number), name: form.name.trim(), capacity: parseInt(form.capacity), shape: form.shape });
      setEditId(null); onReload();
    } catch (e) { setFormErr(e instanceof Error ? e.message : 'Failed to update'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    try { await deleteTable(id); setDeleteId(null); onReload(); }
    catch (e) { setFormErr(e instanceof Error ? e.message : 'Failed to delete'); }
    finally { setSaving(false); }
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Add form */}
      {!addOpen ? (
        <button onClick={() => { setAddOpen(true); setFormErr(null); }} className="btn btn-md btn-primary mb-5">
          <Plus size={13} /> Add Table
        </button>
      ) : (
        <div className="mb-5 rounded-xl border border-border bg-mist p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-[.07em] text-ink/40">New Table</p>
          {formErr && <p className="mb-3 text-xs text-[#DC2626]">{formErr}</p>}
          <TableForm onSave={handleAdd} onCancel={() => { setAddOpen(false); setFormErr(null); }} saving={saving} />
        </div>
      )}

      {tables.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center text-center text-ink/30">
          <LayoutGrid size={36} className="mb-3 opacity-20" />
          <p className="text-sm">No tables configured</p>
          <button onClick={() => setAddOpen(true)} className="mt-3 text-xs font-semibold text-brand hover:underline">
            Add your first table
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tables.map(table => (
            <div key={table._id} className="ds-card p-4">
              {editId === table._id ? (
                <div>
                  <p className="mb-3 text-xs font-bold uppercase tracking-[.07em] text-ink/40">Edit Table</p>
                  {formErr && <p className="mb-2 text-xs text-[#DC2626]">{formErr}</p>}
                  <TableForm
                    initial={{ number: String(table.number), name: table.name || `T${table.number}`, capacity: String(table.capacity), shape: table.shape }}
                    onSave={form => void handleEdit(table._id, form)}
                    onCancel={() => { setEditId(null); setFormErr(null); }}
                    saving={saving && editId === table._id}
                  />
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {table.shape === 'round' ? <Circle size={16} className="text-brand" /> : <LayoutGrid size={16} className="text-brand" />}
                      <div>
                        <p className="text-sm font-bold text-ink">{table.name}</p>
                        <p className="text-[10px] text-ink/40">#{table.number}</p>
                      </div>
                    </div>
                    <span className={`badge ${
                      table.status === 'available' ? 'badge-success'
                      : table.status === 'occupied' ? 'badge-brand'
                      : table.status === 'reserved' ? 'badge-warning'
                      : 'badge-neutral'
                    }`}>{table.status}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-ink/50">
                    <Users size={11} /><span>{table.capacity} seats</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                    <button onClick={() => { setEditId(table._id); setDeleteId(null); setFormErr(null); }} className="flex items-center gap-1 text-xs text-ink/40 hover:text-ink transition-colors">
                      <Pencil size={11} /> Edit
                    </button>
                    {deleteId === table._id ? (
                      <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-[#DC2626]">Delete?</span>
                        <button onClick={() => void handleDelete(table._id)} disabled={saving} className="text-xs font-semibold text-[#DC2626] hover:underline disabled:opacity-50">Yes</button>
                        <button onClick={() => setDeleteId(null)} className="text-xs text-ink/40 hover:underline">No</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteId(table._id)} className="ml-auto flex items-center gap-1 text-xs text-ink/25 hover:text-[#DC2626] transition-colors">
                        <Trash2 size={11} /> Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'floor' | 'config';

export function TablesPage() {
  const { role }         = useAuth();
  const { socket }       = useSocket();
  const { settings }     = useSettings();
  const isAdmin          = role === 'admin';
  const currencySymbol   = settings?.currencySymbol ?? '₹';

  const [tab,             setTab]             = useState<Tab>('floor');
  const [tables,          setTables]          = useState<Table[]>([]);
  const [sessions,        setSessions]        = useState<SessionSummary[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [selectedId,      setSelectedId]      = useState<string | null>(null);
  const [billingSessionId,setBillingSessionId] = useState<string | null>(null);
  const [openingTableId,  setOpeningTableId]  = useState<string | null>(null);
  const [editTable,       setEditTable]       = useState<Table | null>(null);
  const [connected,       setConnected]       = useState(true);
  const [newOrderSet,     setNewOrderSet]     = useState<Set<string>>(new Set());

  // ── Load ─────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [t, s] = await Promise.all([fetchTables(), fetchOpenSessions()]);
      setTables(t); setSessions(s);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  // ── Socket ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;
    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onNewOrder   = (data: unknown) => {
      const raw = (data && typeof data === 'object' && 'order' in data)
        ? (data as { order: Record<string, unknown> }).order
        : data as Record<string, unknown>;
      const tn = typeof raw?.tableNumber === 'string' ? raw.tableNumber : null;
      if (!tn) return;
      setNewOrderSet(s => new Set([...s, tn]));
      setTimeout(() => setNewOrderSet(s => { const n = new Set(s); n.delete(tn); return n; }), 10_000);
    };
    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('new_order',  onNewOrder);
    setConnected(socket.connected);
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('new_order', onNewOrder); };
  }, [socket]);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const sessionByTableNumber = useMemo(
    () => new Map(sessions.map(s => [s.tableNumber, s])),
    [sessions],
  );

  const gridItems = useMemo((): TableGridItem[] =>
    tables.map(t => ({ ...t, session: t.currentSessionId ? sessionByTableNumber.get(String(t.number)) : undefined })),
  [tables, sessionByTableNumber]);

  const selectedItem = useMemo(
    () => gridItems.find(t => t._id === selectedId) ?? null,
    [gridItems, selectedId],
  );

  const { occupiedCount, availableCount } = useMemo(() => ({
    occupiedCount: gridItems.filter(t => t.status === 'occupied').length,
    availableCount: gridItems.filter(t => t.status === 'available').length,
  }), [gridItems]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleTableSelect = useCallback((sessionId: string) => setBillingSessionId(sessionId), []);

  const handleAvailableTableClick = useCallback(async (tableId: string) => {
    if (selectedId === tableId && selectedItem?.status !== 'available') return;
    setOpeningTableId(tableId);
    try {
      const { session } = await openSession(tableId);
      void load();
      setBillingSessionId(session._id);
    } catch (err) {
      void load();
      if (!(err instanceof ApiError && err.status === 409))
        setError(err instanceof Error ? err.message : 'Failed to open table');
    } finally { setOpeningTableId(null); }
  }, [selectedId, selectedItem, load]);

  const handleCardClick = useCallback((tableId: string) => {
    setSelectedId(id => id === tableId ? null : tableId);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-5 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-ink">Tables</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setTab('floor')} className={`chip ${tab === 'floor' ? 'active' : ''}`}>Floor</button>
            {isAdmin && (
              <button onClick={() => setTab('config')} className={`chip ${tab === 'config' ? 'active' : ''}`}>Config</button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {tab === 'floor' && (
            <div className="flex items-center gap-2 text-xs">
              <span className={`flex items-center gap-1 font-medium ${connected ? 'text-green-600' : 'text-[#DC2626]'}`}>
                {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
                {connected ? 'Live' : 'Reconnecting'}
              </span>
              <span className="text-ink/40">{occupiedCount} occupied · {availableCount} available</span>
            </div>
          )}
          <button onClick={() => void load()} disabled={loading} className="btn btn-sm btn-ghost">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-error/25 bg-error/5 px-4 py-2.5 text-sm text-error">
          <AlertCircle size={14} />{error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {/* Body */}
      {tab === 'floor' ? (
        <div className="flex flex-1 overflow-hidden">

          {/* Floor grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading && tables.length === 0 ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner size="lg" />
              </div>
            ) : gridItems.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-ink/30">
                <LayoutGrid size={32} className="opacity-20" />
                <p className="text-sm">No tables configured</p>
                {isAdmin && (
                  <button onClick={() => setTab('config')} className="text-xs font-semibold text-brand hover:underline">
                    Go to Config to add tables
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {gridItems.map(item => {
                  const isSelected = selectedId === item._id;
                  return (
                    <div
                      key={item._id}
                      onClick={() => handleCardClick(item._id)}
                      className={`cursor-pointer outline-none rounded-xl ring-2 transition-all duration-150 ${
                        isSelected ? 'ring-brand shadow-2' : 'ring-transparent'
                      }`}
                    >
                      <TableCard
                        table={item}
                        hasNewOrder={newOrderSet.has(String(item.number))}
                        currencySymbol={currencySymbol}
                        onSelect={item.status === 'occupied' ? handleTableSelect : undefined}
                        onOpenAvailable={item.status === 'available' ? () => void handleAvailableTableClick(item._id) : undefined}
                        isOpening={openingTableId === item._id}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Context panel */}
          {selectedItem && !billingSessionId && (
            <div className="hidden md:flex w-72 shrink-0 flex-col border-l border-border bg-surface">
              <ContextPanel
                item={selectedItem}
                currencySymbol={currencySymbol}
                isAdmin={isAdmin}
                onOpenBilling={id => { setBillingSessionId(id); setSelectedId(null); }}
                onOpenSession={id => void handleAvailableTableClick(id)}
                onClose={() => setSelectedId(null)}
                onEditClick={t => { setEditTable(t); setTab('config'); }}
                isOpening={openingTableId === selectedItem._id}
              />
            </div>
          )}
        </div>
      ) : (
        /* Config tab */
        isAdmin ? (
          <ConfigTab
            tables={tables}
            onReload={() => { void load(); if (editTable) setEditTable(null); }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-ink/40">
            Admin access required
          </div>
        )
      )}

      {/* Edit drawer shortcut from context panel */}
      {editTable && tab === 'config' && (
        <div className="hidden" aria-hidden />
      )}

      {/* Billing drawer */}
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
