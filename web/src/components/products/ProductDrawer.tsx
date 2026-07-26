import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import type { Product, Category, ModifierGroup } from '../../types';
import type { ProductInput } from '../../api/products';
import { createProduct, updateProduct } from '../../api/products';
import {
  fetchModifierGroups,
  assignModifierGroupToProduct,
  removeModifierGroupFromProduct,
} from '../../api/modifiers';
import { useShortcut } from '../../hooks/useShortcut';

interface Props {
  product: Product | null;
  categories: Category[];
  onSave: (p: Product) => void;
  onClose: () => void;
}

const BLANK: ProductInput = {
  name: '',
  price: 0,
  category: '',
  taxPercent: 5,
  hsnCode: '',
  isAvailable: true,
  isVeg: true,
  shortCode: '',
  description: '',
  stock: -1,
};

type VariantDraft = { _id?: string; name: string; price: number };

export function ProductDrawer({ product, categories, onSave, onClose }: Props) {
  const [form, setForm]         = useState<ProductInput>(BLANK);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // ── Modifier group assignment (edit mode only) ─────────────────────────────
  const [assignedGroups, setAssignedGroups]   = useState<ModifierGroup[]>([]);
  const [allGroups, setAllGroups]             = useState<ModifierGroup[]>([]);
  const [mgLoading, setMgLoading]             = useState(false);
  const [mgSearch, setMgSearch]               = useState('');
  const [mgAssigning, setMgAssigning]         = useState(false);
  const [mgRemoving, setMgRemoving]           = useState<string | null>(null);
  const [mgError, setMgError]                 = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      const catId = product.category
        ? (typeof product.category === 'object'
            ? product.category._id
            : String(product.category))
        : '';
      setForm({
        name:        product.name,
        price:       product.price,
        category:    catId,
        taxPercent:  product.taxPercent,
        hsnCode:     product.hsnCode,
        isAvailable: product.isAvailable,
        isVeg:       product.isVeg,
        shortCode:   product.shortCode,
        description: product.description,
        stock:       product.stock,
      });
      setVariants(
        (product.variants ?? []).map(v => ({ _id: v._id, name: v.name, price: v.price })),
      );
      setAssignedGroups((product.modifierGroups ?? []) as ModifierGroup[]);
      // Load all active modifier groups for the dropdown
      setMgLoading(true);
      fetchModifierGroups({ active: true, limit: 200 })
        .then(res => setAllGroups(res.groups))
        .catch(() => setMgError('Failed to load modifier groups'))
        .finally(() => setMgLoading(false));
    } else {
      setForm(BLANK);
      setVariants([]);
      setAssignedGroups([]);
      setAllGroups([]);
    }
    setMgError(null);
    setError(null);
  }, [product]);

  async function handleAssignGroup(groupId: string) {
    if (!product) return;
    setMgAssigning(true);
    setMgError(null);
    try {
      await assignModifierGroupToProduct(product._id, groupId);
      const group = allGroups.find(g => g._id === groupId);
      if (group) setAssignedGroups(prev => [...prev, group]);
      setMgSearch('');
    } catch {
      setMgError('Failed to assign modifier group');
    } finally {
      setMgAssigning(false);
    }
  }

  async function handleRemoveGroup(mgId: string) {
    if (!product) return;
    setMgRemoving(mgId);
    setMgError(null);
    try {
      await removeModifierGroupFromProduct(product._id, mgId);
      setAssignedGroups(prev => prev.filter(g => g._id !== mgId));
    } catch {
      setMgError('Failed to remove modifier group');
    } finally {
      setMgRemoving(null);
    }
  }

  const availableGroups = allGroups.filter(
    g => !assignedGroups.some(a => a._id === g._id),
  );
  const filteredAvailable = mgSearch
    ? availableGroups.filter(g => g.name.toLowerCase().includes(mgSearch.toLowerCase()))
    : availableGroups;

  useShortcut('Escape', onClose);

  function set<K extends keyof ProductInput>(key: K, val: ProductInput[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.category || form.price <= 0) {
      setError('Name, category and a price > 0 are required');
      return;
    }
    for (const v of variants) {
      if (!v.name.trim()) { setError('Variant names cannot be empty'); return; }
      if (v.price < 0)    { setError('Variant prices must be ≥ 0'); return; }
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, variants };
      const saved = product
        ? await updateProduct(product._id, payload)
        : await createProduct(payload);
      onSave(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  useShortcut('Enter', () => { void handleSave(); }, !saving);

  const field =
    'block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-ink px-5 py-3 text-white">
          <h2 className="text-sm font-semibold">
            {product ? 'Edit Product' : 'New Product'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/10"
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

          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Name *
            </label>
            <input
              className={field}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Product name"
              autoFocus
            />
          </div>

          {/* Category */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Category *
            </label>
            <select
              className={field}
              value={form.category}
              onChange={e => set('category', e.target.value)}
            >
              <option value="">Select category…</option>
              {categories.map(c => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Price + Tax */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
                Price (₹) *
              </label>
              <input
                className={field}
                type="number"
                min={0}
                step={0.01}
                value={form.price}
                onChange={e => set('price', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
                Tax %
              </label>
              <input
                className={field}
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={form.taxPercent}
                onChange={e => set('taxPercent', parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Veg + Available */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
                Type
              </label>
              <div className="flex overflow-hidden rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => set('isVeg', true)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    form.isVeg
                      ? 'bg-green-600 text-white'
                      : 'bg-canvas text-ink/50 hover:bg-mist'
                  }`}
                >
                  ● Veg
                </button>
                <button
                  type="button"
                  onClick={() => set('isVeg', false)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    !form.isVeg
                      ? 'bg-red-600 text-white'
                      : 'bg-canvas text-ink/50 hover:bg-mist'
                  }`}
                >
                  ● Non-veg
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
                Available
              </label>
              <button
                type="button"
                onClick={() => set('isAvailable', !form.isAvailable)}
                className={`w-full rounded-lg border py-2 text-xs font-semibold transition-colors ${
                  form.isAvailable
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-border bg-mist text-ink/40'
                }`}
              >
                {form.isAvailable ? '✓ Available' : '✗ Unavailable'}
              </button>
            </div>
          </div>

          {/* Short Code + HSN */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
                Short Code
              </label>
              <input
                className={field}
                value={form.shortCode}
                onChange={e => set('shortCode', e.target.value)}
                placeholder="e.g. CB"
                maxLength={8}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
                HSN Code
              </label>
              <input
                className={field}
                value={form.hsnCode}
                onChange={e => set('hsnCode', e.target.value)}
                placeholder="HSN"
              />
            </div>
          </div>

          {/* Stock */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Stock
            </label>
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                onClick={() => set('stock', -1)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  (form.stock ?? -1) === -1
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-border bg-canvas text-ink/50 hover:bg-mist'
                }`}
              >
                Unlimited
              </button>
              <button
                type="button"
                onClick={() => set('stock', (form.stock ?? -1) < 0 ? 0 : (form.stock ?? 0))}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  (form.stock ?? -1) >= 0
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-border bg-canvas text-ink/50 hover:bg-mist'
                }`}
              >
                Track stock
              </button>
            </div>
            {(form.stock ?? -1) >= 0 && (
              <input
                className={field}
                type="number"
                min={0}
                value={form.stock ?? 0}
                onChange={e => set('stock', parseInt(e.target.value, 10) || 0)}
                placeholder="Current stock quantity"
              />
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Description
            </label>
            <textarea
              className={`${field} h-20 resize-none`}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Optional description"
              maxLength={500}
            />
          </div>

          {/* Variants */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                Variants
                <span className="ml-1 font-normal normal-case tracking-normal text-ink/30">
                  (e.g. Small, Medium, Large)
                </span>
              </label>
              <button
                type="button"
                onClick={() => setVariants(prev => [...prev, { name: '', price: 0 }])}
                className="flex items-center gap-1 rounded-md border border-brand/30 bg-brand/5 px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
              >
                <Plus size={12} />
                Add
              </button>
            </div>
            {variants.length === 0 && (
              <p className="text-xs italic text-ink/30">No variants — product has a single price above.</p>
            )}
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={v._id ?? `new-${i}`} className="flex items-center gap-2">
                  <input
                    className={`${field} flex-1`}
                    placeholder="Name (e.g. Large)"
                    value={v.name}
                    onChange={e =>
                      setVariants(prev =>
                        prev.map((item, idx) => idx === i ? { ...item, name: e.target.value } : item),
                      )
                    }
                  />
                  <input
                    className={`${field} w-24`}
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Price"
                    value={v.price}
                    onChange={e =>
                      setVariants(prev =>
                        prev.map((item, idx) => idx === i ? { ...item, price: parseFloat(e.target.value) || 0 } : item),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setVariants(prev => prev.filter((_, idx) => idx !== i))}
                    className="rounded-lg border border-red-100 p-2 text-red-400 hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Modifier Groups — edit mode only */}
          {product && (
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink/50">
                Modifier Groups
                <span className="ml-1 font-normal normal-case tracking-normal text-ink/30">
                  (add-ons, extras, customisations)
                </span>
              </label>

              {mgError && (
                <p className="mb-2 text-xs text-red-500">{mgError}</p>
              )}

              {/* Assigned groups */}
              {assignedGroups.length === 0 ? (
                <p className="mb-2 text-xs italic text-ink/30">No modifier groups assigned.</p>
              ) : (
                <div className="mb-3 space-y-1.5">
                  {assignedGroups.map(g => (
                    <div
                      key={g._id}
                      className="flex items-center justify-between rounded-lg border border-border bg-mist px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink truncate">{g.name}</p>
                        <p className="text-[10px] text-ink/40">
                          {g.isRequired ? 'Required' : 'Optional'} · {g.selectionType} · {g.options.length} option{g.options.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={mgRemoving === g._id}
                        onClick={() => { void handleRemoveGroup(g._id); }}
                        className="ml-2 shrink-0 rounded-md border border-red-100 p-1.5 text-red-400 hover:bg-red-50 disabled:opacity-40"
                      >
                        {mgRemoving === g._id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Trash2 size={12} />
                        }
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Assign dropdown */}
              {mgLoading ? (
                <div className="flex items-center gap-2 text-xs text-ink/40">
                  <Loader2 size={12} className="animate-spin" /> Loading groups…
                </div>
              ) : availableGroups.length > 0 ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mgSearch}
                    onChange={e => setMgSearch(e.target.value)}
                    placeholder="Search modifier groups to assign…"
                    className={`${field} flex-1 text-xs`}
                  />
                </div>
              ) : assignedGroups.length === 0 ? (
                <p className="text-xs text-ink/30">No modifier groups available. Create one on the Modifiers page.</p>
              ) : null}

              {mgSearch && filteredAvailable.length > 0 && (
                <div className="mt-1.5 max-h-36 overflow-y-auto rounded-lg border border-border bg-canvas shadow-sm">
                  {filteredAvailable.map(g => (
                    <button
                      key={g._id}
                      type="button"
                      disabled={mgAssigning}
                      onClick={() => { void handleAssignGroup(g._id); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-mist disabled:opacity-50"
                    >
                      {mgAssigning ? <Loader2 size={11} className="animate-spin shrink-0" /> : <Plus size={11} className="shrink-0 text-brand" />}
                      <span className="font-medium text-ink">{g.name}</span>
                      <span className="text-ink/40">· {g.options.length} options</span>
                    </button>
                  ))}
                </div>
              )}
              {mgSearch && filteredAvailable.length === 0 && (
                <p className="mt-1 text-xs text-ink/35">No matching groups.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-2 border-t border-border bg-mist px-5 py-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border bg-canvas px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-mist"
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleSave(); }}
            disabled={saving}
            className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : product ? 'Update' : 'Create Product'}
          </button>
        </div>
      </div>
    </div>
  );
}
