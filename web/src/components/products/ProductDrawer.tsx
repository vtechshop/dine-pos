import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Product, Category } from '../../types';
import type { ProductInput } from '../../api/products';
import { createProduct, updateProduct } from '../../api/products';
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

export function ProductDrawer({ product, categories, onSave, onClose }: Props) {
  const [form, setForm]     = useState<ProductInput>(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      const catId =
        product.category && typeof product.category === 'object'
          ? product.category._id
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
    } else {
      setForm(BLANK);
    }
    setError(null);
  }, [product]);

  useShortcut('Escape', onClose);

  function set<K extends keyof ProductInput>(key: K, val: ProductInput[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.category || form.price <= 0) {
      setError('Name, category and a price > 0 are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = product
        ? await updateProduct(product._id, form)
        : await createProduct(form);
      onSave(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  useShortcut('Enter', () => { void handleSave(); }, !saving);

  const field =
    'block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-900 px-5 py-3 text-white">
          <h2 className="text-sm font-semibold">
            {product ? 'Edit Product' : 'New Product'}
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

          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Type
              </label>
              <div className="flex overflow-hidden rounded-lg border border-gray-200">
                <button
                  type="button"
                  onClick={() => set('isVeg', true)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                    form.isVeg
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-gray-500 hover:bg-gray-50'
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
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  ● Non-veg
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Available
              </label>
              <button
                type="button"
                onClick={() => set('isAvailable', !form.isAvailable)}
                className={`w-full rounded-lg border py-2 text-xs font-semibold transition-colors ${
                  form.isAvailable
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-gray-50 text-gray-400'
                }`}
              >
                {form.isAvailable ? '✓ Available' : '✗ Unavailable'}
              </button>
            </div>
          </div>

          {/* Short Code + HSN */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Stock
            </label>
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                onClick={() => set('stock', -1)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  (form.stock ?? -1) === -1
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                Unlimited
              </button>
              <button
                type="button"
                onClick={() => set('stock', (form.stock ?? -1) < 0 ? 0 : (form.stock ?? 0))}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  (form.stock ?? -1) >= 0
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
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
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : product ? 'Update' : 'Create Product'}
          </button>
        </div>
      </div>
    </div>
  );
}
