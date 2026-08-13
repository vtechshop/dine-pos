import { useState, useEffect } from 'react';
import { X, TrendingUp } from 'lucide-react';
import type { Ingredient } from '../../types';
import { stockInIngredient } from '../../api/inventory';
import { useShortcut } from '../../hooks/useShortcut';

interface Props {
  ingredient: Ingredient;
  onSave: (updated: Ingredient) => void;
  onClose: () => void;
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function StockInDrawer({ ingredient, onSave, onClose }: Props) {
  const [quantity,      setQuantity]      = useState('');
  const [costPerUnit,   setCostPerUnit]   = useState(String(ingredient.costPerUnit || ''));
  const [supplier,      setSupplier]      = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [date,          setDate]          = useState(todayStr());
  const [notes,         setNotes]         = useState('');
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  useEffect(() => {
    setCostPerUnit(String(ingredient.costPerUnit || ''));
    setQuantity('');
    setSupplier('');
    setInvoiceNumber('');
    setDate(todayStr());
    setNotes('');
    setError(null);
  }, [ingredient]);

  useShortcut('Escape', onClose);

  const qty  = parseFloat(quantity)    || 0;
  const cost = parseFloat(costPerUnit) || 0;
  const totalCost = qty * cost;

  async function handleSave() {
    if (qty <= 0) { setError('Quantity must be greater than 0'); return; }
    if (cost < 0) { setError('Cost per unit cannot be negative'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await stockInIngredient(ingredient._id, {
        quantity:      qty,
        costPerUnit:   cost,
        supplier:      supplier.trim(),
        invoiceNumber: invoiceNumber.trim(),
        date,
        notes:         notes.trim(),
      });
      onSave(res.ingredient);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stock In failed');
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
            <TrendingUp size={15} className="text-green-400" />
            <h2 className="text-sm font-semibold">Stock In — {ingredient.name}</h2>
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

          {/* Current stock summary */}
          <div className="rounded-lg border border-border bg-mist px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink/50">Current Stock</span>
              <span className="font-semibold">{ingredient.currentStock} {ingredient.unit}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-ink/50">Current Cost / {ingredient.unit}</span>
              <span className="font-semibold">₹{ingredient.costPerUnit.toFixed(2)}</span>
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Quantity ({ingredient.unit}) *
            </label>
            <input
              type="number"
              min={0.001}
              step={0.001}
              className={field}
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="0"
              autoFocus
            />
          </div>

          {/* Cost per unit */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Cost per {ingredient.unit} (₹) *
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              className={field}
              value={costPerUnit}
              onChange={e => setCostPerUnit(e.target.value)}
              placeholder="0.00"
            />
            <p className="mt-1 text-[11px] text-ink/40">
              Cost per unit will be updated using Weighted Average Cost
            </p>
          </div>

          {/* Calculated total */}
          {qty > 0 && cost > 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <div className="flex justify-between text-sm">
                <span className="text-ink/60">{qty} {ingredient.unit} × ₹{cost.toFixed(2)}</span>
                <span className="font-bold text-green-700">= ₹{totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-ink/40">
                <span>New total stock</span>
                <span className="font-semibold text-green-600">
                  {(ingredient.currentStock + qty).toFixed(3)} {ingredient.unit}
                </span>
              </div>
            </div>
          )}

          {/* Supplier */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Supplier
            </label>
            <input
              type="text"
              className={field}
              value={supplier}
              onChange={e => setSupplier(e.target.value)}
              placeholder="e.g. ABC Traders"
            />
          </div>

          {/* Invoice number */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Invoice Number
            </label>
            <input
              type="text"
              className={field}
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              placeholder="e.g. INV-001"
            />
          </div>

          {/* Date */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Date
            </label>
            <input
              type="date"
              className={field}
              value={date}
              onChange={e => setDate(e.target.value)}
            />
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
            disabled={saving || qty <= 0}
            className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : `+ Stock In`}
          </button>
        </div>
      </div>
    </div>
  );
}
