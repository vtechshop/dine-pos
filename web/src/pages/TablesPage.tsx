import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, LayoutGrid, Circle, Users, RefreshCw, X, Check } from 'lucide-react';
import type { Table } from '../types';
import { fetchTables, createTable, updateTable, deleteTable } from '../api/tables';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  available: 'bg-green-50 text-green-700 border-green-200',
  occupied:  'bg-brand/10 text-brand border-brand/20',
  reserved:  'bg-amber-50 text-amber-700 border-amber-200',
  inactive:  'bg-gray-50 text-gray-400 border-gray-200',
};

// ── Table form ────────────────────────────────────────────────────────────────

interface FormState {
  number: string;
  name: string;
  capacity: string;
  shape: 'square' | 'round';
}

const BLANK: FormState = { number: '', name: '', capacity: '4', shape: 'square' };

interface TableFormProps {
  initial?: FormState;
  onSave(values: FormState): void;
  onCancel(): void;
  saving: boolean;
}

function TableForm({ initial = BLANK, onSave, onCancel, saving }: TableFormProps) {
  const [form, setForm] = useState<FormState>(initial);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const inputCls =
    'block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20';

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-ink/50">Number *</label>
        <input
          type="number"
          min={1}
          value={form.number}
          onChange={e => set('number', e.target.value)}
          placeholder="1"
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-ink/50">Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="T1"
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-ink/50">Capacity *</label>
        <input
          type="number"
          min={1}
          max={50}
          value={form.capacity}
          onChange={e => set('capacity', e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-ink/50">Shape</label>
        <select value={form.shape} onChange={e => set('shape', e.target.value as 'square' | 'round')} className={inputCls}>
          <option value="square">Square</option>
          <option value="round">Round</option>
        </select>
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.number || !form.name || !form.capacity}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-50"
        >
          <Check size={13} />
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink/50 transition-colors hover:bg-ink/5"
        >
          <X size={13} />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TablesPage() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  const [tables,  setTables]  = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const [addOpen,  setAddOpen]  = useState(false);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  async function handleAdd(form: FormState) {
    setFormErr(null);
    setSaving(true);
    try {
      await createTable({
        number: parseInt(form.number),
        name: form.name.trim(),
        capacity: parseInt(form.capacity),
        shape: form.shape,
      });
      setAddOpen(false);
      void load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to create table');
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(id: string, form: FormState) {
    setFormErr(null);
    setSaving(true);
    try {
      await updateTable(id, {
        number: parseInt(form.number),
        name: form.name.trim(),
        capacity: parseInt(form.capacity),
        shape: form.shape,
      });
      setEditId(null);
      void load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to update table');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    try {
      await deleteTable(id);
      setDeleteId(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete table');
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-ink">Tables</h1>
          <span className="text-xs text-ink/40">{tables.length} configured</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70 disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {isAdmin && !addOpen && (
            <button
              onClick={() => { setAddOpen(true); setFormErr(null); }}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand/90"
            >
              <Plus size={13} />
              Add table
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <div className="mb-4 rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
            {error}
          </div>
        )}

        {/* Add form */}
        {addOpen && isAdmin && (
          <div className="mb-5 rounded-xl border border-border bg-mist p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink/40">New Table</p>
            {formErr && (
              <p className="mb-3 text-xs text-brand">{formErr}</p>
            )}
            <TableForm
              onSave={handleAdd}
              onCancel={() => { setAddOpen(false); setFormErr(null); }}
              saving={saving}
            />
          </div>
        )}

        {loading && tables.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : tables.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-ink/30">
            <LayoutGrid size={36} className="mb-3 opacity-20" />
            <p className="text-sm">No tables configured</p>
            {isAdmin && (
              <button
                onClick={() => setAddOpen(true)}
                className="mt-3 text-xs font-semibold text-brand hover:underline"
              >
                Add your first table
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tables.map(table => (
              <div
                key={table._id}
                className="rounded-xl border border-border bg-canvas p-4 transition-shadow hover:shadow-sm"
              >
                {editId === table._id && isAdmin ? (
                  <div>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink/40">Edit Table</p>
                    {formErr && <p className="mb-2 text-xs text-brand">{formErr}</p>}
                    <TableForm
                      initial={{
                        number: String(table.number),
                        name: table.name,
                        capacity: String(table.capacity),
                        shape: table.shape,
                      }}
                      onSave={form => void handleEdit(table._id, form)}
                      onCancel={() => { setEditId(null); setFormErr(null); }}
                      saving={saving && editId === table._id}
                    />
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {table.shape === 'round'
                          ? <Circle size={18} className="text-brand" />
                          : <LayoutGrid size={18} className="text-brand" />
                        }
                        <div>
                          <p className="text-sm font-bold text-ink">{table.name}</p>
                          <p className="text-[10px] text-ink/40">#{table.number}</p>
                        </div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLE[table.status] ?? ''}`}>
                        {table.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-ink/50">
                      <Users size={11} />
                      <span>{table.capacity} seats</span>
                    </div>

                    {isAdmin && (
                      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                        <button
                          onClick={() => { setEditId(table._id); setDeleteId(null); setFormErr(null); }}
                          className="flex items-center gap-1 text-xs text-ink/40 transition-colors hover:text-ink"
                        >
                          <Pencil size={11} />
                          Edit
                        </button>
                        {deleteId === table._id ? (
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-brand">Delete?</span>
                            <button
                              onClick={() => void handleDelete(table._id)}
                              disabled={saving}
                              className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setDeleteId(null)}
                              className="text-xs text-ink/40 hover:underline"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteId(table._id)}
                            className="ml-auto flex items-center gap-1 text-xs text-ink/25 transition-colors hover:text-brand"
                          >
                            <Trash2 size={11} />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
