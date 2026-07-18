import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Ingredient } from '../../types';
import type { IngredientInput } from '../../api/products';
import { createIngredient, updateIngredient, restockIngredient } from '../../api/products';
import { useShortcut } from '../../hooks/useShortcut';

interface Props {
  ingredient: Ingredient | null;
  mode: 'form' | 'restock';
  onSave: (i: Ingredient) => void;
  onClose: () => void;
}

const PRESET_UNITS = ['kg', 'g', 'L', 'ml', 'pcs', 'dozen', 'box', 'packet'];

const BLANK: IngredientInput = {
  name:              '',
  unit:              'kg',
  currentStock:      0,
  lowStockThreshold: 5,
  costPerUnit:       0,
};

export function IngredientDrawer({ ingredient, mode, onSave, onClose }: Props) {
  const [form, setForm]     = useState<IngredientInput>(BLANK);
  const [qty, setQty]       = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (ingredient) {
      setForm({
        name:              ingredient.name,
        unit:              ingredient.unit,
        currentStock:      ingredient.currentStock,
        lowStockThreshold: ingredient.lowStockThreshold,
        costPerUnit:       ingredient.costPerUnit,
      });
    } else {
      setForm(BLANK);
    }
    setQty(0);
    setError(null);
  }, [ingredient]);

  useShortcut('Escape', onClose);

  function set<K extends keyof IngredientInput>(key: K, val: IngredientInput[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (mode === 'restock') {
      if (!ingredient || qty <= 0) {
        setError('Enter a positive quantity to add');
        return;
      }
      setSaving(true);
      try {
        const saved = await restockIngredient(ingredient._id, qty);
        onSave(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Restock failed');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!form.name.trim() || !form.unit.trim()) {
      setError('Name and unit are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = ingredient
        ? await updateIngredient(ingredient._id, form)
        : await createIngredient(form);
      onSave(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  useShortcut('Enter', () => { void handleSave(); }, !saving);

  const field =
    'block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#E8380D]/50 focus:ring-1 focus:ring-[#E8380D]/20';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-sm flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-900 px-5 py-3 text-white">
          <h2 className="text-sm font-semibold">
            {mode === 'restock'
              ? `Restock: ${ingredient?.name ?? ''}`
              : ingredient
              ? 'Edit Ingredient'
              : 'New Ingredient'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-700"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {mode === 'restock' ? (
            <>
              {/* Current state summary */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                <div className="mb-1 flex justify-between">
                  <span className="text-gray-500">Current Stock</span>
                  <span className="font-semibold">
                    {ingredient?.currentStock} {ingredient?.unit}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Low Stock Alert</span>
                  <span className="font-semibold">
                    {ingredient?.lowStockThreshold} {ingredient?.unit}
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Quantity to Add ({ingredient?.unit})
                </label>
                <input
                  className={field}
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={qty || ''}
                  onChange={e => setQty(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  autoFocus
                />
              </div>

              {qty > 0 && ingredient && (
                <p className="text-xs text-gray-500">
                  New total:{' '}
                  <span className="font-semibold text-green-600">
                    {(ingredient.currentStock + qty).toFixed(2)} {ingredient.unit}
                  </span>
                </p>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Name *
                </label>
                <input
                  className={field}
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="Ingredient name"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Unit *
                </label>
                <div className="mb-2 flex flex-wrap gap-2">
                  {PRESET_UNITS.map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => set('unit', u)}
                      className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                        form.unit === u
                          ? 'border-[#E8380D] bg-[#E8380D]/5 text-[#E8380D]'
                          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
                <input
                  className={field}
                  value={form.unit}
                  onChange={e => set('unit', e.target.value)}
                  placeholder="or type custom unit"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Current Stock
                  </label>
                  <input
                    className={field}
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.currentStock}
                    onChange={e => set('currentStock', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Low Stock Alert
                  </label>
                  <input
                    className={field}
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.lowStockThreshold}
                    onChange={e =>
                      set('lowStockThreshold', parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Cost Per Unit (₹)
                </label>
                <input
                  className={field}
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.costPerUnit}
                  onChange={e => set('costPerUnit', parseFloat(e.target.value) || 0)}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-40 ${
              mode === 'restock'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-[#E8380D] hover:bg-[#E8380D]/90'
            }`}
          >
            {saving
              ? 'Saving…'
              : mode === 'restock'
              ? 'Add Stock'
              : ingredient
              ? 'Update'
              : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
