import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Pencil, Trash2, Loader2, X, Check,
  ChevronDown, ChevronUp, AlertCircle, Copy,
} from 'lucide-react';
import type { ModifierGroup, ModifierOption } from '../types';
import {
  fetchModifierGroups,
  createModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
  addModifierOption,
  updateModifierOption,
  deleteModifierOption,
  type ModifierGroupInput,
  type ModifierOptionInput,
} from '../api/modifiers';

// ── Form draft types ──────────────────────────────────────────────────────────

const BLANK_GROUP: ModifierGroupInput = {
  name: '',
  description: '',
  isActive: true,
  isRequired: false,
  selectionType: 'single',
  minSelections: 1,
  maxSelections: 1,
};

const BLANK_OPT: ModifierOptionInput = {
  name: '',
  price: 0,
  isActive: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ text, color }: { text: string; color: 'brand' | 'muted' | 'green' | 'red' }) {
  const cls = {
    brand: 'bg-brand/10 text-brand',
    muted: 'bg-mist text-ink/50',
    green: 'bg-emerald-50 text-emerald-700',
    red:   'bg-red-50 text-red-600',
  }[color];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {text}
    </span>
  );
}

// ── Option editor row ─────────────────────────────────────────────────────────

function OptionRow({
  option, groupId, onUpdated, onDeleted,
}: {
  option: ModifierOption;
  groupId: string;
  onUpdated: (updated: ModifierGroup) => void;
  onDeleted: (updated: ModifierGroup) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState<ModifierOptionInput>({ name: option.name, price: option.price, isActive: option.isActive });
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  async function handleSave() {
    if (!draft.name.trim()) { setErr('Name is required'); return; }
    setSaving(true); setErr(null);
    try {
      const updated = await updateModifierOption(groupId, option._id, draft);
      onUpdated(updated);
      setEditing(false);
    } catch { setErr('Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const updated = await deleteModifierOption(groupId, option._id);
      onDeleted(updated);
    } catch { setErr('Delete failed'); }
    finally { setDeleting(false); }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-brand/20 bg-brand/5 p-2">
        <div className="flex gap-1.5">
          <input
            className="flex-1 rounded border border-border px-2 py-1 text-xs text-ink outline-none focus:border-brand/40"
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            placeholder="Option name"
            autoFocus
          />
          <input
            type="number"
            min="0"
            step="0.01"
            className="w-20 rounded border border-border px-2 py-1 text-xs text-ink outline-none focus:border-brand/40"
            value={draft.price ?? 0}
            onChange={e => setDraft(d => ({ ...d, price: parseFloat(e.target.value) || 0 }))}
            placeholder="Price"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-ink/60 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isActive ?? true}
              onChange={e => setDraft(d => ({ ...d, isActive: e.target.checked }))}
              className="accent-brand"
            />
            Active
          </label>
          {err && <p className="flex-1 text-[10px] text-red-500">{err}</p>}
          <div className="ml-auto flex gap-1">
            <button type="button" onClick={() => setEditing(false)}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-ink/50 hover:bg-mist">
              Cancel
            </button>
            <button type="button" onClick={() => { void handleSave(); }} disabled={saving}
              className="flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-canvas px-2.5 py-1.5">
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-ink">{option.name}</span>
        {(option.price ?? 0) > 0 && (
          <span className="ml-1.5 text-[10px] text-brand font-semibold">+₹{option.price}</span>
        )}
      </div>
      {!option.isActive && <Badge text="Inactive" color="red" />}
      {err && <p className="text-[10px] text-red-500">{err}</p>}
      <button type="button" onClick={() => { setDraft({ name: option.name, price: option.price, isActive: option.isActive }); setEditing(true); }}
        className="rounded-md p-1 text-ink/30 hover:bg-mist hover:text-ink">
        <Pencil size={11} />
      </button>
      <button type="button" onClick={() => { void handleDelete(); }} disabled={deleting}
        className="rounded-md p-1 text-red-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40">
        {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
      </button>
    </div>
  );
}

// ── Group drawer ──────────────────────────────────────────────────────────────

function GroupDrawer({
  group,
  onSaved,
  onClose,
}: {
  group: ModifierGroup | null;
  onSaved: (g: ModifierGroup) => void;
  onClose: () => void;
}) {
  const [form, setForm]     = useState<ModifierGroupInput>(BLANK_GROUP);
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  // Saved-group state — set from prop (edit) or after first create (create→edit transition)
  const [liveGroup, setLiveGroup]   = useState<ModifierGroup | null>(group);
  const [newOpt, setNewOpt]         = useState<ModifierOptionInput>(BLANK_OPT);
  const [addingOpt, setAddingOpt]   = useState(false);
  const [optErr, setOptErr]         = useState<string | null>(null);
  const [showAddOpt, setShowAddOpt] = useState(false);

  // Pre-save pending options for CREATE mode (sent inline on first save)
  const [pendingOpts, setPendingOpts]       = useState<ModifierOptionInput[]>([]);
  const [newPendingOpt, setNewPendingOpt]   = useState<ModifierOptionInput>(BLANK_OPT);
  const [showAddPending, setShowAddPending] = useState(false);
  const [pendingOptErr, setPendingOptErr]   = useState<string | null>(null);

  useEffect(() => {
    if (group) {
      setForm({
        name:          group.name,
        description:   group.description ?? '',
        isActive:      group.isActive,
        isRequired:    group.isRequired,
        selectionType: group.selectionType,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
      });
      setLiveGroup(group);
    } else {
      setForm(BLANK_GROUP);
      setLiveGroup(null);
      setPendingOpts([]);
    }
    setErr(null);
  }, [group]);

  function set<K extends keyof ModifierGroupInput>(k: K, v: ModifierGroupInput[K]) {
    setForm(p => ({ ...p, [k]: v }));
  }

  async function handleSave() {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setSaving(true); setErr(null);
    try {
      let saved: ModifierGroup;
      if (group) {
        saved = await updateModifierGroup(group._id, form);
      } else if (liveGroup) {
        // Already created in this session — update
        saved = await updateModifierGroup(liveGroup._id, form);
      } else {
        // First-time create — send pending options inline
        saved = await createModifierGroup({ ...form, options: pendingOpts });
        setPendingOpts([]);
        setShowAddPending(false);
      }
      onSaved(saved);
      setLiveGroup(saved);
    } catch { setErr('Save failed'); }
    finally { setSaving(false); }
  }

  async function handleAddOption() {
    if (!liveGroup) return;
    if (!newOpt.name.trim()) { setOptErr('Name is required'); return; }
    setAddingOpt(true); setOptErr(null);
    try {
      const updated = await addModifierOption(liveGroup._id, newOpt);
      setLiveGroup(updated);
      onSaved(updated);
      setNewOpt(BLANK_OPT);
      setShowAddOpt(false);
    } catch { setOptErr('Failed to add option'); }
    finally { setAddingOpt(false); }
  }

  function handleAddPendingOpt() {
    if (!newPendingOpt.name.trim()) { setPendingOptErr('Name is required'); return; }
    setPendingOpts(p => [...p, { ...newPendingOpt }]);
    setNewPendingOpt(BLANK_OPT);
    setShowAddPending(false);
    setPendingOptErr(null);
  }

  const isEdit = !!(group || liveGroup);
  const field = 'block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-ink px-5 py-3 text-white">
          <h2 className="text-sm font-semibold">
            {isEdit ? 'Edit Modifier Group' : 'New Modifier Group'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {err && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertCircle size={13} /> {err}
            </div>
          )}

          {/* Created-in-session hint */}
          {!group && liveGroup && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <Check size={13} /> Group created — add options below or close.
            </div>
          )}

          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">Name *</label>
            <input className={field} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Spice Level, Add-ons" autoFocus />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">Description</label>
            <input className={field} value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="Shown to staff below group name" />
          </div>

          {/* Required + Active */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">Required</label>
              <button
                type="button"
                onClick={() => set('isRequired', !form.isRequired)}
                className={`w-full rounded-lg border py-2 text-xs font-semibold transition-colors ${
                  form.isRequired
                    ? 'border-brand/40 bg-brand/5 text-brand'
                    : 'border-border bg-mist text-ink/40'
                }`}
              >
                {form.isRequired ? '✓ Required' : 'Optional'}
              </button>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">Status</label>
              <button
                type="button"
                onClick={() => set('isActive', !form.isActive)}
                className={`w-full rounded-lg border py-2 text-xs font-semibold transition-colors ${
                  form.isActive
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-border bg-mist text-ink/40'
                }`}
              >
                {form.isActive ? '✓ Active' : '✗ Inactive'}
              </button>
            </div>
          </div>

          {/* Selection type */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">Selection Type</label>
            <div className="flex overflow-hidden rounded-lg border border-border">
              {(['single', 'multi'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('selectionType', t)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors capitalize ${
                    form.selectionType === t
                      ? 'bg-brand text-white'
                      : 'bg-canvas text-ink/50 hover:bg-mist'
                  }`}
                >
                  {t === 'single' ? 'Single select' : 'Multi select'}
                </button>
              ))}
            </div>
          </div>

          {/* Min / Max */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">Min Selections</label>
              <input
                className={field}
                type="number"
                min={0}
                value={form.minSelections ?? 1}
                onChange={e => set('minSelections', parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">Max Selections</label>
              <input
                className={field}
                type="number"
                min={1}
                value={form.maxSelections ?? 1}
                onChange={e => set('maxSelections', parseInt(e.target.value, 10) || 1)}
              />
            </div>
          </div>

          {/* ── Options — edit mode (saved group exists): per-option API calls ── */}
          {liveGroup && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Options ({liveGroup.options.length})
                </label>
                <button
                  type="button"
                  onClick={() => setShowAddOpt(p => !p)}
                  className="flex items-center gap-1 rounded-md border border-brand/30 bg-brand/5 px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
                >
                  {showAddOpt ? <ChevronUp size={11} /> : <Plus size={11} />}
                  {showAddOpt ? 'Cancel' : 'Add'}
                </button>
              </div>

              {showAddOpt && (
                <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-brand/20 bg-brand/5 p-2">
                  <div className="flex gap-1.5">
                    <input
                      className="flex-1 rounded border border-border px-2 py-1 text-xs text-ink outline-none focus:border-brand/40"
                      value={newOpt.name}
                      onChange={e => setNewOpt(d => ({ ...d, name: e.target.value }))}
                      placeholder="Option name (e.g. Extra Cheese)"
                      autoFocus
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-20 rounded border border-border px-2 py-1 text-xs text-ink outline-none focus:border-brand/40"
                      value={newOpt.price ?? 0}
                      onChange={e => setNewOpt(d => ({ ...d, price: parseFloat(e.target.value) || 0 }))}
                      placeholder="Price"
                    />
                  </div>
                  {optErr && <p className="text-[10px] text-red-500">{optErr}</p>}
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => setShowAddOpt(false)}
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-ink/50 hover:bg-mist">
                      Cancel
                    </button>
                    <button type="button" onClick={() => { void handleAddOption(); }} disabled={addingOpt}
                      className="flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-[11px] font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
                      {addingOpt ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                      Add Option
                    </button>
                  </div>
                </div>
              )}

              {liveGroup.options.length === 0 ? (
                <p className="text-xs italic text-ink/30">No options yet. Add options above.</p>
              ) : (
                <div className="space-y-1.5">
                  {liveGroup.options.map(opt => (
                    <OptionRow
                      key={opt._id}
                      option={opt}
                      groupId={liveGroup._id}
                      onUpdated={updated => { setLiveGroup(updated); onSaved(updated); }}
                      onDeleted={updated => { setLiveGroup(updated); onSaved(updated); }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Options — create mode (no saved group yet): local pending list ── */}
          {!liveGroup && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Options ({pendingOpts.length})
                </label>
                <button
                  type="button"
                  onClick={() => { setShowAddPending(p => !p); setPendingOptErr(null); }}
                  className="flex items-center gap-1 rounded-md border border-brand/30 bg-brand/5 px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
                >
                  {showAddPending ? <ChevronUp size={11} /> : <Plus size={11} />}
                  {showAddPending ? 'Cancel' : 'Add'}
                </button>
              </div>

              {showAddPending && (
                <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-brand/20 bg-brand/5 p-2">
                  <div className="flex gap-1.5">
                    <input
                      className="flex-1 rounded border border-border px-2 py-1 text-xs text-ink outline-none focus:border-brand/40"
                      value={newPendingOpt.name}
                      onChange={e => setNewPendingOpt(d => ({ ...d, name: e.target.value }))}
                      placeholder="Option name (e.g. Extra Cheese)"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddPendingOpt(); } }}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-20 rounded border border-border px-2 py-1 text-xs text-ink outline-none focus:border-brand/40"
                      value={newPendingOpt.price ?? 0}
                      onChange={e => setNewPendingOpt(d => ({ ...d, price: parseFloat(e.target.value) || 0 }))}
                      placeholder="₹"
                    />
                  </div>
                  {pendingOptErr && <p className="text-[10px] text-red-500">{pendingOptErr}</p>}
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => { setShowAddPending(false); setNewPendingOpt(BLANK_OPT); setPendingOptErr(null); }}
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-ink/50 hover:bg-mist">
                      Cancel
                    </button>
                    <button type="button" onClick={handleAddPendingOpt}
                      className="flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-[11px] font-semibold text-white hover:bg-brand/90">
                      <Plus size={10} /> Add
                    </button>
                  </div>
                </div>
              )}

              {pendingOpts.length === 0 ? (
                <p className="text-xs italic text-ink/30">Optional — add options before saving, or add them after.</p>
              ) : (
                <div className="space-y-1.5">
                  {pendingOpts.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-border/60 bg-canvas px-2.5 py-1.5">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-ink">{opt.name}</span>
                        {(opt.price ?? 0) > 0 && (
                          <span className="ml-1.5 text-[10px] text-brand font-semibold">+₹{opt.price}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPendingOpts(p => p.filter((_, j) => j !== i))}
                        className="rounded-md p-1 text-red-300 hover:bg-red-50 hover:text-red-500"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-2 border-t border-border bg-mist px-5 py-3">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-border bg-canvas px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-mist">
            {isEdit ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving}
            className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────

function GroupCard({
  group, onEdit, onDelete, onDuplicate, expanded, onToggle,
}: {
  group: ModifierGroup;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`rounded-xl border bg-canvas transition ${group.isActive ? 'border-border' : 'border-border/50 opacity-60'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-ink">{group.name}</p>
            <Badge text={group.isRequired ? 'Required' : 'Optional'} color={group.isRequired ? 'brand' : 'muted'} />
            <Badge text={group.selectionType === 'single' ? 'Single' : 'Multi'} color="muted" />
            {!group.isActive && <Badge text="Inactive" color="red" />}
          </div>
          {group.description && (
            <p className="mt-0.5 text-xs text-ink/45 truncate">{group.description}</p>
          )}
          <p className="mt-0.5 text-[10px] text-ink/35">
            {group.options.length} option{group.options.length !== 1 ? 's' : ''}
            {group.minSelections > 0 && ` · min ${group.minSelections}`}
            {` · max ${group.maxSelections}`}
          </p>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={onToggle} className="rounded-md p-1.5 text-ink/30 hover:bg-mist hover:text-ink">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button type="button" onClick={onDuplicate} title="Duplicate" className="rounded-md p-1.5 text-ink/30 hover:bg-mist hover:text-ink">
            <Copy size={13} />
          </button>
          <button type="button" onClick={onEdit} className="rounded-md p-1.5 text-ink/30 hover:bg-mist hover:text-ink">
            <Pencil size={13} />
          </button>
          <button type="button" onClick={onDelete} className="rounded-md p-1.5 text-red-300 hover:bg-red-50 hover:text-red-500">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {expanded && group.options.length > 0 && (
        <div className="border-t border-border/50 px-4 pb-3 pt-2">
          <div className="flex flex-wrap gap-1.5">
            {group.options.map(opt => (
              <span
                key={opt._id}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                  opt.isActive !== false ? 'border-border text-ink' : 'border-border/40 text-ink/35 line-through'
                }`}
              >
                {opt.name}
                {(opt.price ?? 0) > 0 && (
                  <span className="text-brand font-semibold">+₹{opt.price}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Delete confirm dialog ─────────────────────────────────────────────────────

function DeleteConfirm({
  group, onConfirm, onCancel, deleting,
}: { group: ModifierGroup; onConfirm: () => void; onCancel: () => void; deleting: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
            <Trash2 size={16} className="text-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Delete Modifier Group</p>
            <p className="text-xs text-ink/50">This cannot be undone</p>
          </div>
        </div>
        <p className="mb-4 text-sm text-ink/70">
          Delete <span className="font-semibold text-ink">"{group.name}"</span>?
          Products using this group will lose these modifier options.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel}
            className="flex-1 rounded-xl border border-border py-2 text-sm font-medium text-ink/70 hover:bg-mist">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={deleting}
            className="flex flex-[1.5] items-center justify-center gap-2 rounded-xl bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ModifierGroupsPage() {
  const [groups, setGroups]       = useState<ModifierGroup[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(0);
  const LIMIT = 20;

  const [drawer, setDrawer]             = useState<{ group: ModifierGroup | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModifierGroup | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [error, setError]               = useState<string | null>(null);

  const load = useCallback(async (q: string, p: number) => {
    setLoading(true); setError(null);
    try {
      const res = await fetchModifierGroups({ search: q || undefined, limit: LIMIT, skip: p * LIMIT });
      setGroups(res.groups);
      setTotal(res.total);
    } catch { setError('Failed to load modifier groups'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => { void load(search, 0); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [search, load]);

  useEffect(() => {
    void load(search, page);
  }, [page, load]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSaved(saved: ModifierGroup) {
    setGroups(prev => {
      const idx = prev.findIndex(g => g._id === saved._id);
      if (idx >= 0) return prev.map(g => g._id === saved._id ? saved : g);
      return [saved, ...prev];
    });
    setTotal(t => t + (groups.some(g => g._id === saved._id) ? 0 : 1));
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteModifierGroup(deleteTarget._id);
      setGroups(prev => prev.filter(g => g._id !== deleteTarget._id));
      setTotal(t => Math.max(0, t - 1));
      setDeleteTarget(null);
    } catch { setError('Failed to delete modifier group'); }
    finally { setDeleting(false); }
  }

  async function handleDuplicate(group: ModifierGroup) {
    try {
      const created = await createModifierGroup({
        name:          group.name + ' (Copy)',
        description:   group.description,
        isActive:      group.isActive,
        isRequired:    group.isRequired,
        selectionType: group.selectionType,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        options:       group.options.map(o => ({ name: o.name, price: o.price, isActive: o.isActive })),
      });
      handleSaved(created);
    } catch { setError('Failed to duplicate modifier group'); }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <div className="shrink-0 border-b border-border/30 bg-canvas px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-ink">Modifier Groups</h1>
            <p className="text-xs text-ink/45">Add-ons, extras, and customisation options for your menu items</p>
          </div>
          <button
            type="button"
            onClick={() => setDrawer({ group: null })}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 transition"
          >
            <Plus size={14} />
            New Group
          </button>
        </div>

        {/* Search */}
        <div className="relative mt-3 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search modifier groups…"
            className="w-full rounded-lg border border-border py-2 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/35 hover:text-ink/60">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
            <AlertCircle size={14} className="text-red-500" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {loading && groups.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-ink/25" />
          </div>
        ) : groups.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-ink/40">No modifier groups found</p>
            <p className="mt-1 text-xs text-ink/30">
              {search ? 'Try a different search term.' : 'Create your first modifier group above.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map(g => (
              <GroupCard
                key={g._id}
                group={g}
                expanded={expandedId === g._id}
                onToggle={() => setExpandedId(p => p === g._id ? null : g._id)}
                onEdit={() => setDrawer({ group: g })}
                onDelete={() => setDeleteTarget(g)}
                onDuplicate={() => { void handleDuplicate(g); }}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/60 hover:bg-mist disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs text-ink/50">Page {page + 1} of {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/60 hover:bg-mist disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Group drawer */}
      {drawer && (
        <GroupDrawer
          group={drawer.group}
          onSaved={handleSaved}
          onClose={() => setDrawer(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteConfirm
          group={deleteTarget}
          deleting={deleting}
          onConfirm={() => { void handleDelete(); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
