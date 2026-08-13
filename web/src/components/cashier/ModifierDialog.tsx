import { useState, useMemo } from 'react';
import { X, Plus, Minus, Check } from 'lucide-react';
import type { Product, SelectedModifier } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModifierResult {
  quantity: number;
  notes: string;
  selectedModifiers: SelectedModifier[];
  effectivePrice: number;
  variantId?: string;
  variantName?: string;
}

interface ModifierDialogProps {
  product: Product;
  sym: string;
  onConfirm: (result: ModifierResult) => void;
  onClose: () => void;
}

// ── Option chip ───────────────────────────────────────────────────────────────

function OptionChip({
  label, price, sym, active, onClick,
}: { label: string; price: number; sym: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-border bg-canvas text-ink/60 hover:border-brand/40 hover:text-ink'
      }`}
    >
      {active && <Check size={9} className="shrink-0" />}
      <span>{label}</span>
      {price > 0 && (
        <span className={`font-semibold ${active ? 'text-brand' : 'text-ink/45'}`}>
          +{sym}{price}
        </span>
      )}
    </button>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function ModifierDialog({ product, sym, onConfirm, onClose }: ModifierDialogProps) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>();
  const [modSelections, setModSelections] = useState<Record<string, string[]>>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  const variants = product.variants ?? [];
  const groups = product.modifierGroups ?? [];

  const effectivePrice = useMemo(() => {
    if (!selectedVariantId) return product.price;
    const v = variants.find(v => v._id === selectedVariantId);
    return v?.price ?? product.price;
  }, [product, selectedVariantId, variants]);

  const modifierTotal = useMemo(() => {
    let total = 0;
    for (const group of groups) {
      for (const optId of modSelections[group._id] ?? []) {
        const opt = group.options.find(o => o._id === optId);
        if (opt) total += opt.price;
      }
    }
    return total;
  }, [groups, modSelections]);

  const unitTotal = effectivePrice + modifierTotal;

  function toggleOption(groupId: string, optionId: string, selectionType: 'single' | 'multi') {
    setValidationError(null);
    setModSelections(prev => {
      const current = prev[groupId] ?? [];
      if (selectionType === 'single') {
        return { ...prev, [groupId]: current[0] === optionId ? [] : [optionId] };
      }
      return {
        ...prev,
        [groupId]: current.includes(optionId)
          ? current.filter(id => id !== optionId)
          : [...current, optionId],
      };
    });
  }

  function buildSelectedModifiers(): SelectedModifier[] {
    const result: SelectedModifier[] = [];
    for (const group of groups) {
      for (const optId of modSelections[group._id] ?? []) {
        const opt = group.options.find(o => o._id === optId);
        if (opt) {
          result.push({
            modifierGroupId: group._id,
            modifierGroupName: group.name,
            modifierOptionId: opt._id,
            modifierOptionName: opt.name,
            modifierPrice: opt.price,
            modifierTotal: opt.price,
          });
        }
      }
    }
    return result;
  }

  function validate(): string | null {
    for (const group of groups) {
      const selected = (modSelections[group._id] ?? []).length;
      const minRequired = group.isRequired ? Math.max(1, group.minSelections) : group.minSelections;
      if (minRequired > 0 && selected < minRequired) {
        return `"${group.name}" requires at least ${minRequired} selection(s)`;
      }
      if (group.maxSelections > 0 && selected > group.maxSelections) {
        return `"${group.name}" allows at most ${group.maxSelections} selection(s)`;
      }
    }
    return null;
  }

  function handleConfirm() {
    const err = validate();
    if (err) { setValidationError(err); return; }
    const selectedModifiers = buildSelectedModifiers();
    const selectedVariant = selectedVariantId
      ? variants.find(v => v._id === selectedVariantId)
      : undefined;
    onConfirm({
      quantity: qty,
      notes,
      selectedModifiers,
      effectivePrice,
      variantId: selectedVariantId,
      variantName: selectedVariant?.name,
    });
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
            <p className="text-xs text-ink/50">Base {sym}{product.price.toLocaleString('en-IN')}</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist shrink-0">
            <X size={14} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

          {/* Variants */}
          {variants.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
                Variant
                <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">Required</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {variants.map(v => (
                  <OptionChip
                    key={v._id}
                    label={v.name}
                    price={v.price - product.price}
                    sym={sym}
                    active={selectedVariantId === v._id}
                    onClick={() => setSelectedVariantId(prev => prev === v._id ? undefined : v._id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Modifier groups */}
          {groups.filter(g => g.isActive !== false && g.options.filter(o => o.isActive !== false).length > 0).map(group => {
            const activeOptions = group.options.filter(o => o.isActive !== false);
            const selected = modSelections[group._id] ?? [];
            return (
              <div key={group._id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
                    {group.name}
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      group.isRequired
                        ? 'bg-brand/10 text-brand'
                        : 'bg-mist text-ink/40'
                    }`}>
                      {group.isRequired ? 'Required' : 'Optional'}
                    </span>
                  </p>
                  {group.selectionType === 'multi' && group.maxSelections > 0 && (
                    <span className="text-[10px] text-ink/35">
                      {selected.length}/{group.maxSelections}
                    </span>
                  )}
                </div>
                {group.description && (
                  <p className="text-[10px] text-ink/40 -mt-1">{group.description}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {activeOptions.map(opt => (
                    <OptionChip
                      key={opt._id}
                      label={opt.name}
                      price={opt.price}
                      sym={sym}
                      active={selected.includes(opt._id)}
                      onClick={() => toggleOption(group._id, opt._id, group.selectionType)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

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

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
              Kitchen Note
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. No salt, well done…"
              className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink outline-none transition focus:border-brand/50"
            />
          </div>

          {/* Validation error */}
          {validationError && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-600">{validationError}</p>
            </div>
          )}
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
              {sym}{(unitTotal * qty).toLocaleString('en-IN')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
