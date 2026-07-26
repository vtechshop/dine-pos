import { useEffect, useMemo, useRef, useState } from 'react';
import type { Product } from '@dinepos/shared/types';
import { X, Check } from 'lucide-react';
import { QuantityStepper } from '@dinepos/shared/components';
import { useCart } from '../../context/CartContext.tsx';
import { useMenu } from '../../context/MenuContext.tsx';
import type { SelectedModifier } from '../../types/qr.ts';

interface ProductDetailSheetProps {
  product:      Product;
  isBestseller: boolean;
  onClose:      () => void;
}

// ── Option chip ───────────────────────────────────────────────────────────────

function OptionChip({
  label, price, sym, active, onClick,
}: { label: string; price: number; sym: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-[#E8380D] bg-[#E8380D]/10 text-[#E8380D]'
          : 'border-[#E8D5C0] bg-white text-[#1C0800]/60'
      }`}
    >
      {active && <Check size={9} className="shrink-0" />}
      <span>{label}</span>
      {price > 0 && (
        <span className={`font-semibold ${active ? 'text-[#E8380D]' : 'text-[#1C0800]/40'}`}>
          +{sym}{price}
        </span>
      )}
    </button>
  );
}

// ── Main sheet ────────────────────────────────────────────────────────────────

export function ProductDetailSheet({ product, isBestseller, onClose }: ProductDetailSheetProps) {
  const { addItem, setQty, removeItem, getQty, simpleLineId } = useCart();
  const { hotel } = useMenu();
  const overlayRef = useRef<HTMLDivElement>(null);
  const symbol = hotel?.currencySymbol ?? '₹';

  const [notes, setNotes]                 = useState('');
  const [selectedVariantId, setVariantId] = useState<string | undefined>();
  const [modSelections, setModSelections] = useState<Record<string, string[]>>({});
  const [validationError, setValidErr]    = useState<string | null>(null);

  const variants = product.variants ?? [];
  const groups   = product.modifierGroups ?? [];
  const hasModifiers = groups.length > 0;
  const hasVariants  = variants.length > 0;
  const isComplex    = hasModifiers || hasVariants;

  const effectivePrice = useMemo(() => {
    if (!selectedVariantId) return product.price;
    const v = variants.find(v => v._id === selectedVariantId);
    return v?.price ?? product.price;
  }, [product.price, selectedVariantId, variants]);

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

  const unitPrice = effectivePrice + modifierTotal;

  // Simple product (no modifiers/variants) — use legacy qty stepper
  const simpleQty = isComplex ? 0 : getQty(product._id);

  const isVeg =
    product.isVeg !== undefined ? product.isVeg : hotel?.businessType === 'veg';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function toggleOption(groupId: string, optionId: string, selectionType: 'single' | 'multi') {
    setValidErr(null);
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
            modifierGroupId:   group._id,
            modifierGroupName: group.name,
            modifierOptionId:  opt._id,
            modifierOptionName: opt.name,
            modifierPrice:     opt.price,
            modifierTotal:     opt.price,
          });
        }
      }
    }
    return result;
  }

  function validate(): string | null {
    for (const group of groups) {
      const selected = (modSelections[group._id] ?? []).length;
      if (group.isRequired && selected < group.minSelections) {
        return `"${group.name}" requires at least ${group.minSelections} selection(s)`;
      }
      if (group.maxSelections > 0 && selected > group.maxSelections) {
        return `"${group.name}" allows at most ${group.maxSelections} selection(s)`;
      }
    }
    return null;
  }

  function handleAddToCart() {
    const err = validate();
    if (err) { setValidErr(err); return; }
    const selectedModifiers = buildSelectedModifiers();
    const selectedVariant = selectedVariantId
      ? variants.find(v => v._id === selectedVariantId)
      : undefined;
    addItem({
      productId:         product._id,
      name:              product.name,
      price:             effectivePrice,
      modifierTotal,
      isVeg,
      variantId:         selectedVariantId,
      variantName:       selectedVariant?.name,
      selectedModifiers: selectedModifiers.length > 0 ? selectedModifiers : undefined,
    }, 1, notes);
    onClose();
  }

  function handleAddSimpleWithNotes() {
    addItem({
      productId: product._id,
      name:      product.name,
      price:     product.price,
      modifierTotal: 0,
      isVeg,
    }, 1, notes);
    onClose();
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/50 flex items-end"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="w-full bg-[#FFF6EE] rounded-t-2xl max-h-[90vh] overflow-y-auto">
        {product.image && (
          <img src={product.image} alt={product.name} className="w-full h-48 object-cover" />
        )}
        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-start gap-2">
              <span className={[
                'mt-1 w-3.5 h-3.5 border-2 rounded-sm flex-shrink-0 flex items-center justify-center',
                isVeg ? 'border-green-600' : 'border-red-600',
              ].join(' ')}>
                <span className={`w-1.5 h-1.5 rounded-full ${isVeg ? 'bg-green-600' : 'bg-red-600'}`} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-[#1C0800]">{product.name}</h2>
                {isBestseller && (
                  <span className="text-xs bg-[#E8380D]/10 text-[#E8380D] px-2 py-0.5 rounded-full font-medium">
                    Bestseller
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-[#1C0800]/50">
              <X size={20} />
            </button>
          </div>

          {product.description && (
            <p className="text-sm text-[#1C0800]/70 mb-4">{product.description}</p>
          )}

          {/* Base price */}
          <p className="text-xl font-bold text-[#1C0800] mb-4">
            {symbol}{unitPrice.toFixed(2)}
            {modifierTotal > 0 && (
              <span className="text-sm font-normal text-[#1C0800]/50 ml-1">
                (base {symbol}{effectivePrice.toFixed(2)} + {symbol}{modifierTotal.toFixed(2)})
              </span>
            )}
          </p>

          {/* Variants */}
          {hasVariants && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-[#1C0800]/60 uppercase tracking-wide mb-2">
                Variant
                <span className="ml-1.5 text-[#E8380D] text-[10px] font-normal">Required</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {variants.map(v => (
                  <OptionChip
                    key={v._id}
                    label={v.name}
                    price={v.price - product.price}
                    sym={symbol}
                    active={selectedVariantId === v._id}
                    onClick={() => setVariantId(prev => prev === v._id ? undefined : v._id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Modifier groups */}
          {groups.filter(g => g.isActive !== false).map(group => {
            const activeOptions = group.options.filter(o => o.isActive !== false);
            if (!activeOptions.length) return null;
            const selected = modSelections[group._id] ?? [];
            return (
              <div key={group._id} className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-[#1C0800]/60 uppercase tracking-wide">
                    {group.name}
                    <span className={`ml-1.5 text-[10px] font-normal ${group.isRequired ? 'text-[#E8380D]' : 'text-[#1C0800]/40'}`}>
                      {group.isRequired ? 'Required' : 'Optional'}
                    </span>
                  </p>
                  {group.selectionType === 'multi' && group.maxSelections > 0 && (
                    <span className="text-[10px] text-[#1C0800]/35">
                      {selected.length}/{group.maxSelections}
                    </span>
                  )}
                </div>
                {group.description && (
                  <p className="text-xs text-[#1C0800]/45 -mt-1 mb-2">{group.description}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {activeOptions.map(opt => (
                    <OptionChip
                      key={opt._id}
                      label={opt.name}
                      price={opt.price}
                      sym={symbol}
                      active={selected.includes(opt._id)}
                      onClick={() => toggleOption(group._id, opt._id, group.selectionType)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Validation error */}
          {validationError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-600">{validationError}</p>
            </div>
          )}

          {/* Notes */}
          <label className="block text-xs font-medium text-[#1C0800]/60 mb-1">
            Special instructions (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. No onions, extra spicy…"
            rows={2}
            className="w-full text-sm border border-[#E8D5C0] rounded-lg px-3 py-2 bg-white text-[#1C0800] resize-none focus:outline-none focus:ring-1 focus:ring-[#E8380D]"
          />

          {/* Footer action */}
          <div className="mt-4 flex items-center gap-3">
            {isComplex ? (
              <button
                onClick={handleAddToCart}
                className="flex-1 py-3 bg-[#E8380D] text-white rounded-xl font-semibold"
              >
                Add to cart — {symbol}{unitPrice.toFixed(2)}
              </button>
            ) : simpleQty === 0 ? (
              <button
                onClick={handleAddSimpleWithNotes}
                className="flex-1 py-3 bg-[#E8380D] text-white rounded-xl font-semibold"
              >
                Add to cart — {symbol}{product.price.toFixed(2)}
              </button>
            ) : (
              <>
                <QuantityStepper
                  quantity={simpleQty}
                  min={0}
                  size="md"
                  onIncrement={() => setQty(simpleLineId(product._id), simpleQty + 1)}
                  onDecrement={() => {
                    if (simpleQty <= 1) removeItem(simpleLineId(product._id));
                    else setQty(simpleLineId(product._id), simpleQty - 1);
                  }}
                />
                <button onClick={onClose} className="flex-1 py-3 bg-[#E8380D] text-white rounded-xl font-semibold">
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
