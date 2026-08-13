import { useState, useEffect } from 'react';
import { X, SlidersHorizontal } from 'lucide-react';
import type { Ingredient } from '../../types';
import { adjustIngredient } from '../../api/inventory';
import { useShortcut } from '../../hooks/useShortcut';

interface Props {
  ingredient: Ingredient;
  onSave: (updated: Ingredient) => void;
  onClose: () => void;
}

const ADJUST_REASONS = [
  { id: 'physical_count', label: 'Physical Count' },
  { id: 'damaged',        label: 'Damaged' },
  { id: 'expired',        label: 'Expired' },
  { id: 'correction',     label: 'Correction' },
  { id: 'other',          label: 'Other' },
] as const;

export function StockAdjustDrawer({ ingredient, onSave, onClose }: Props) {
  const [physicalStock, setPhysicalStock] = useState(String(ingredient.currentStock));
  const [reason,        setReason]        = useState('physical_count');
  const [notes,         setNotes]         = useState('');
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  useEffect(() => {
    setPhysicalStock(String(ingredient.currentStock));
    setReason('physical_count');
    setNotes('');
    setError(null);
  }, [ingredient]);

  useShortcut('Escape', onClose);

  const physical = parseFloat(physicalStock);
  const delta    = isNaN(physical) ? null : physical - ingredient.currentStock;

  async function handleSave() {
    if (isNaN(physical) || physical < 0) {
      setError('Physical stock must be a non-negative number');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await adjustIngredient(ingredient._id, {
        physicalStock: physical,
        reason,
        notes: notes.trim(),
      });
      onSave(res.ingredient);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Adjustment failed');
    } finally {
      setSaving(false);
    }
  }

  useShortcut('Enter', () => { void handleSave(); }, !saving);

  const field = 'block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 bg-canvas';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-sm flex-col bg-canvas shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-ink px-5 py-3 text-white">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-amber-400" />
            <h2 className="text-sm font-semibold">Adjust Stock — {ingredient.name}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {/* System stock (read-only) */}
          <div className="rounded-lg border border-border bg-mist px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink/50">System Stock</span>
              <span className="font-semibold tabular-nums">
                {ingredient.currentStock} {ingredient.unit}
              </span>
            </div>
          </div>

          {/* Physical count input */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Physical Count ({ingredient.unit}) *
            </label>
            <input
              type="number"
              min={0}
              step={0.001}
              className={field}
              value={physicalStock}
              onChange={e => setPhysicalStock(e.target.value)}
              autoFocus
            />
          </div>

          {/* Delta preview */}
          {delta !== null && delta !== 0 && (
            <div className={`rounded-lg border px-4 py-3 ${
              delta > 0 ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
            }`}>
              <div className="flex justify-between text-sm">
                <span className="text-ink/60">Adjustment</span>
                <span className={`font-bold tabular-nums ${delta > 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {delta > 0 ? '+' : ''}{delta.toFixed(3)} {ingredient.unit}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-xs text-ink/40">
                <span>{ingredient.currentStock} → {physical}</span>
                <span>{ingredient.unit}</span>
              </div>
            </div>
          )}

          {delta === 0 && physicalStock !== '' && (
            <p className="text-xs text-ink/40">Physical stock matches system stock — no change will be recorded.</p>
          )}

          {/* Reason */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Reason *
            </label>
            <select
              className={field}
              value={reason}
              onChange={e => setReason(e.target.value)}
            >
              {ADJUST_REASONS.map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Notes
            </label>
            <input
              type="text"
              className={field}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-2 border-t border-border bg-mist px-5 py-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border bg-canvas px-4 py-2 text-sm font-medium text-ink/60 hover:bg-mist"
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving || isNaN(physical) || physical < 0}
            className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
}
