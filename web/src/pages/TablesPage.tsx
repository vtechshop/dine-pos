import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, LayoutGrid, Circle,
  RefreshCw, X, Check, Search, MoreHorizontal,
} from 'lucide-react';
import type { Table } from '../types';
import { fetchTables, createTable, updateTable, deleteTable } from '../api/tables';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useShortcut } from '../hooks/useShortcut';

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  number:   string;
  name:     string;
  capacity: string;
  shape:    'square' | 'round';
}

const BLANK: FormState = { number: '', name: '', capacity: '4', shape: 'square' };

function formFromTable(t: Table): FormState {
  return {
    number:   String(t.number),
    name:     t.name || `T${t.number}`,
    capacity: String(t.capacity),
    shape:    t.shape,
  };
}

const INPUT =
  'block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20';

// ── TableDrawer — add / edit ──────────────────────────────────────────────────

interface TableDrawerProps {
  table:   Table | null;          // null = add mode
  onSave(values: FormState): void;
  onClose(): void;
  saving:  boolean;
  error:   string | null;
}

function TableDrawer({ table, onSave, onClose, saving, error }: TableDrawerProps) {
  const [form, setForm]               = useState<FormState>(() => table ? formFromTable(table) : BLANK);
  const [nameTouched, setNameTouched] = useState(!!table);  // edit: name already set

  function handleNumberChange(val: string) {
    setForm(prev => ({
      ...prev,
      number: val,
      name:   nameTouched ? prev.name : `T${val}`,
    }));
  }

  function handleNameChange(val: string) {
    setNameTouched(true);
    setForm(prev => ({ ...prev, name: val }));
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const isValid = !!(form.number && form.name.trim() && form.capacity);

  useShortcut('Escape', onClose);
  useShortcut('Enter', () => { if (isValid && !saving) onSave(form); }, isValid && !saving);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-sm flex-col bg-canvas shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Drawer header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-ink px-5 py-3 text-white">
          <h2 className="text-sm font-semibold">
            {table ? `Edit — ${table.name || `T${table.number}`}` : 'Add Table'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        {/* Drawer body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && (
            <p className="mb-4 rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink/50">
                Number <span className="text-brand">*</span>
              </label>
              <input
                type="number"
                min={1}
                value={form.number}
                onChange={e => handleNumberChange(e.target.value)}
                placeholder="1"
                className={INPUT}
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink/50">
                Name <span className="text-brand">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="T1"
                className={INPUT}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink/50">
                Capacity <span className="text-brand">*</span>
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={form.capacity}
                onChange={e => set('capacity', e.target.value)}
                placeholder="4"
                className={INPUT}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink/50">Shape</label>
              <select
                value={form.shape}
                onChange={e => set('shape', e.target.value as FormState['shape'])}
                className={INPUT}
              >
                <option value="square">Square</option>
                <option value="round">Round</option>
              </select>
            </div>
          </div>

          <p className="mt-4 text-[11px] text-ink/30">
            <span className="text-brand">*</span> Required fields
          </p>
        </div>

        {/* Drawer footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-mist px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-ink/50 hover:bg-ink/5"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (isValid) onSave(form); }}
            disabled={!isValid || saving}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            <Check size={13} />
            {saving ? 'Saving…' : table ? 'Save Changes' : 'Add Table'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DeleteDialog ──────────────────────────────────────────────────────────────

interface DeleteDialogProps {
  table:     Table;
  onConfirm(): void;
  onCancel(): void;
  saving:    boolean;
}

function DeleteDialog({ table, onConfirm, onCancel, saving }: DeleteDialogProps) {
  useShortcut('Escape', onCancel);
  const label = table.name || `T${table.number}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-2xl">
        <h3 className="mb-2 text-sm font-semibold text-ink">Delete Table {label}?</h3>
        <p className="mb-5 text-xs leading-relaxed text-ink/50">
          This will permanently remove the table from your restaurant
          configuration. Active sessions must be closed before deleting.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-ink/50 hover:bg-ink/5"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {saving ? 'Deleting…' : 'Delete Table'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Compact tile fill colors (mirrors CashierTablePanel) ─────────────────────

function tileFillCls(status: Table['status']): string {
  switch (status) {
    case 'occupied': return 'bg-blue-50 border-blue-200';
    case 'reserved': return 'bg-amber-50 border-amber-200';
    case 'inactive': return 'bg-ink/[0.03] border-dashed border-ink/15';
    default:         return 'bg-canvas border-dashed border-border/60';
  }
}

function tileNameCls(status: Table['status']): string {
  switch (status) {
    case 'occupied': return 'text-blue-900';
    case 'reserved': return 'text-amber-900';
    case 'inactive': return 'text-ink/30';
    default:         return 'text-ink';
  }
}

// ── TablesPage ────────────────────────────────────────────────────────────────

export function TablesPage() {
  const { role } = useAuth();
  const isAdmin  = role === 'admin';

  const [tables,  setTables]  = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const [drawerMode,   setDrawerMode]   = useState<'add' | 'edit' | null>(null);
  const [editTarget,   setEditTarget]   = useState<Table | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Table | null>(null);
  const [moreOpen,     setMoreOpen]     = useState<string | null>(null);
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const visible = tables.filter(t => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q || t.name.toLowerCase().includes(q) || String(t.number).includes(q);
    const matchStatus = !statusFilter || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTables(await fetchTables());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Close the ⋮ dropdown when clicking outside
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.more-menu-root')) setMoreOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen]);

  // ── Drawer helpers ──

  function openAddDrawer() {
    setDrawerMode('add');
    setEditTarget(null);
    setFormErr(null);
    setMoreOpen(null);
  }

  function openEditDrawer(t: Table) {
    setDrawerMode('edit');
    setEditTarget(t);
    setFormErr(null);
    setMoreOpen(null);
  }

  function closeDrawer() {
    setDrawerMode(null);
    setEditTarget(null);
    setFormErr(null);
  }

  // ── API handlers ──

  async function handleSave(form: FormState) {
    setFormErr(null);
    setSaving(true);
    try {
      if (drawerMode === 'add') {
        await createTable({
          number:   parseInt(form.number),
          name:     form.name.trim(),
          capacity: parseInt(form.capacity),
          shape:    form.shape,
        });
      } else if (editTarget) {
        await updateTable(editTarget._id, {
          number:   parseInt(form.number),
          name:     form.name.trim(),
          capacity: parseInt(form.capacity),
          shape:    form.shape,
        });
      }
      closeDrawer();
      void load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to save table');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteTable(deleteTarget._id);
      setDeleteTarget(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete table');
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  }

  const hasFilter = !!(search || statusFilter);

  return (
    <div className="flex h-full flex-col">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-border bg-canvas px-5 py-3">

        {/* Title row */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-ink">Tables</h1>
            <p className="text-xs text-ink/40">
              {loading ? '…' : `${tables.length} table${tables.length !== 1 ? 's' : ''} configured`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh tables"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70 disabled:opacity-40"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            {isAdmin && (
              <button
                onClick={openAddDrawer}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand/90"
              >
                <Plus size={13} />
                Add Table
              </button>
            )}
          </div>
        </div>

        {/* Search + filter row */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tables…"
              aria-label="Search tables"
              className="h-8 w-44 rounded-lg border border-border bg-canvas pl-8 pr-3 text-xs text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="h-8 rounded-lg border border-border bg-canvas px-2 text-xs text-ink/60 outline-none focus:border-brand/50"
          >
            <option value="">All Statuses</option>
            <option value="available">Available</option>
            <option value="occupied">Occupied</option>
            <option value="reserved">Reserved</option>
            <option value="inactive">Inactive</option>
          </select>

          {hasFilter && (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); }}
              className="text-xs text-ink/40 hover:text-ink/70"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5">

        {error && (
          <div className="mb-4 rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
            {error}
          </div>
        )}

        {loading && tables.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>

        ) : tables.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <LayoutGrid size={40} className="mb-3 text-ink/15" />
            <p className="text-sm font-medium text-ink/40">No tables configured yet</p>
            <p className="mt-1 max-w-xs text-xs text-ink/30">
              Add your first table to start managing your restaurant floor.
            </p>
            {isAdmin && (
              <button
                onClick={openAddDrawer}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90"
              >
                <Plus size={13} /> Add Table
              </button>
            )}
          </div>

        ) : visible.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <p className="text-sm text-ink/40">No tables match your filters</p>
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); }}
              className="mt-2 text-xs font-semibold text-brand hover:underline"
            >
              Clear filters
            </button>
          </div>

        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {visible.map(table => {
              const label = table.name || `T${table.number}`;
              return (
                <div
                  key={table._id}
                  onClick={() => isAdmin && openEditDrawer(table)}
                  className={`relative flex min-h-[82px] flex-col items-center justify-center rounded-xl border p-2 text-center transition-all hover:shadow-md ${tileFillCls(table.status)} ${isAdmin ? 'cursor-pointer active:scale-[0.97]' : ''}`}
                >
                  {/* Shape indicator — top-left */}
                  <div className="absolute left-1.5 top-1.5 text-ink/25">
                    {table.shape === 'round'
                      ? <Circle size={8} />
                      : <LayoutGrid size={8} />
                    }
                  </div>

                  {/* ⋮ More dropdown — top-right, admin only */}
                  {isAdmin && (
                    <div className="more-menu-root absolute right-1 top-1">
                      <button
                        onClick={e => { e.stopPropagation(); setMoreOpen(moreOpen === table._id ? null : table._id); }}
                        aria-label="More options"
                        aria-expanded={moreOpen === table._id}
                        aria-haspopup="menu"
                        className="rounded p-0.5 text-ink/25 hover:text-ink/60"
                      >
                        <MoreHorizontal size={12} />
                      </button>

                      {moreOpen === table._id && (
                        <div
                          role="menu"
                          className="more-menu-root absolute right-0 top-full z-20 mt-1 min-w-[144px] overflow-hidden rounded-lg border border-border bg-canvas shadow-lg"
                        >
                          <button
                            role="menuitem"
                            onClick={e => { e.stopPropagation(); openEditDrawer(table); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink/70 hover:bg-mist"
                          >
                            <Pencil size={12} />
                            Edit Table
                          </button>
                          <div className="mx-2 border-t border-border" />
                          <button
                            role="menuitem"
                            onClick={e => { e.stopPropagation(); setMoreOpen(null); setDeleteTarget(table); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-brand hover:bg-brand/5"
                          >
                            <Trash2 size={12} />
                            Delete Table
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Table name */}
                  <p className={`text-sm font-bold leading-tight ${tileNameCls(table.status)}`}>{label}</p>

                  {/* Seats */}
                  <p className="mt-0.5 text-[9px] text-ink/30">{table.capacity} seats</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Drawer ─────────────────────────────────────────────────────── */}
      {drawerMode !== null && (
        <TableDrawer
          table={drawerMode === 'edit' ? editTarget : null}
          onSave={values => void handleSave(values)}
          onClose={closeDrawer}
          saving={saving}
          error={formErr}
        />
      )}

      {/* ── Delete dialog ───────────────────────────────────────────────── */}
      {deleteTarget !== null && (
        <DeleteDialog
          table={deleteTarget}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteTarget(null)}
          saving={saving}
        />
      )}
    </div>
  );
}
