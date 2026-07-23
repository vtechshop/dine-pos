import { useState } from 'react';
import { X, Plus, Minus, Check, Info } from 'lucide-react';
import type { Product } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModifierResult {
  quantity: number;
  notes: string;
}

interface ModifierDialogProps {
  product: Product;
  sym: string;
  onConfirm: (result: ModifierResult) => void;
  onClose: () => void;
}

// ── Hardcoded presets (client-side; no backend required) ──────────────────────

const SPICE_TAGS = ['No Spice', 'Less Spicy', 'Medium Spicy', 'Extra Spicy'];

const INGREDIENT_TAGS = [
  'No Onion', 'No Garlic', 'No Salt', 'No Sugar',
  'Extra Cheese', 'Extra Sauce', 'No Nuts',
];

const SIZE_TAGS = [
  { label: 'Half',   tag: '[Half]'   },
  { label: 'Full',   tag: '[Full]'   },
  { label: 'Small',  tag: '[Small]'  },
  { label: 'Medium', tag: '[Medium]' },
  { label: 'Large',  tag: '[Large]'  },
];

// ── Chip toggle ───────────────────────────────────────────────────────────────

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-border bg-canvas text-ink/55 hover:border-brand/40 hover:text-ink'
      }`}
    >
      {active && <Check size={9} className="inline mr-0.5" />}
      {label}
    </button>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function ModifierDialog({ product, sym, onConfirm, onClose }: ModifierDialogProps) {
  const [qty, setQty] = useState(1);
  const [sizeTag, setSizeTag] = useState<string>('');
  const [spice, setSpice] = useState<string>('');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [kitchenNote, setKitchenNote] = useState('');
  const [diningNote, setDiningNote] = useState('');

  function toggleIngredient(tag: string) {
    setIngredients(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  }

  function buildNotes(): string {
    const parts: string[] = [];
    if (sizeTag) parts.push(sizeTag);
    if (spice) parts.push(spice);
    if (ingredients.length) parts.push(ingredients.join(', '));
    if (kitchenNote.trim()) parts.push(`Kitchen: ${kitchenNote.trim()}`);
    if (diningNote.trim()) parts.push(`Dining: ${diningNote.trim()}`);
    return parts.join(' | ');
  }

  function handleConfirm() {
    onConfirm({ quantity: qty, notes: buildNotes() });
  }

  const isVeg = product.isVeg !== false;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-3 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-border bg-canvas shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-4 py-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`h-3 w-3 shrink-0 rounded-sm border ${isVeg ? 'border-emerald-500' : 'border-red-500'}`}>
                <span className={`block h-1.5 w-1.5 m-[2px] rounded-full ${isVeg ? 'bg-emerald-500' : 'bg-red-500'}`} />
              </span>
              <p className="text-sm font-semibold text-ink truncate">{product.name}</p>
            </div>
            <p className="text-xs text-ink/50">{sym}{product.price.toLocaleString('en-IN')}</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist shrink-0">
            <X size={14} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

          {/* Quantity */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">Quantity</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQty(q => Math.max(1, q - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-ink/60 hover:bg-mist"
              >
                <Minus size={13} />
              </button>
              <span className="w-6 text-center text-sm font-bold text-ink">{qty}</span>
              <button
                type="button"
                onClick={() => setQty(q => q + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-ink/60 hover:bg-mist"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          {/* Size / Variant */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">Size / Variant</p>
            <div className="flex flex-wrap gap-1.5">
              {SIZE_TAGS.map(({ label, tag }) => (
                <Chip
                  key={tag}
                  label={label}
                  active={sizeTag === tag}
                  onClick={() => setSizeTag(sizeTag === tag ? '' : tag)}
                />
              ))}
            </div>
            <p className="text-[10px] text-ink/35 flex items-center gap-1">
              <Info size={9} />
              Variant price adjustment requires backend: POST /products/:id/modifiers
            </p>
          </div>

          {/* Spice level */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">Spice Level</p>
            <div className="flex flex-wrap gap-1.5">
              {SPICE_TAGS.map(tag => (
                <Chip
                  key={tag}
                  label={tag}
                  active={spice === tag}
                  onClick={() => setSpice(spice === tag ? '' : tag)}
                />
              ))}
            </div>
          </div>

          {/* Ingredient preferences */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">Preferences</p>
            <div className="flex flex-wrap gap-1.5">
              {INGREDIENT_TAGS.map(tag => (
                <Chip
                  key={tag}
                  label={tag}
                  active={ingredients.includes(tag)}
                  onClick={() => toggleIngredient(tag)}
                />
              ))}
            </div>
          </div>

          {/* Kitchen note */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
              Kitchen Note
            </label>
            <input
              type="text"
              value={kitchenNote}
              onChange={e => setKitchenNote(e.target.value)}
              placeholder="e.g. Make it well done, no salt on fries…"
              className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none transition focus:border-brand/50"
            />
          </div>

          {/* Dining note */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
              Dining Note
            </label>
            <input
              type="text"
              value={diningNote}
              onChange={e => setDiningNote(e.target.value)}
              placeholder="e.g. Allergy: nuts, serve separately…"
              className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none transition focus:border-brand/50"
            />
          </div>

          {/* Preview */}
          {buildNotes() && (
            <div className="rounded-lg border border-dashed border-brand/30 bg-brand/5 px-3 py-2">
              <p className="text-[10px] text-ink/50 mb-0.5">Cart note preview</p>
              <p className="text-xs text-ink/80">{buildNotes()}</p>
            </div>
          )}

          {/* Add-ons gap note */}
          <div className="rounded-lg border border-dashed border-border px-3 py-2">
            <p className="text-[10px] text-ink/35">
              Add-ons with individual prices require backend: GET /products/:id/addons (not yet implemented)
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-border px-4 py-3 shrink-0">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-ink/70 hover:bg-mist">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-bold text-white hover:bg-brand/90"
          >
            <Plus size={14} />
            Add {qty > 1 ? `${qty}× ` : ''}to Cart
            <span className="ml-1 opacity-80 text-xs">
              {sym}{(product.price * qty).toLocaleString('en-IN')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
