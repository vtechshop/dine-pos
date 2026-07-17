import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Category } from '../../types';
import type { CategoryInput } from '../../api/products';
import { createCategory, updateCategory } from '../../api/products';
import { useShortcut } from '../../hooks/useShortcut';

interface Props {
  category: Category | null;
  onSave: (c: Category) => void;
  onClose: () => void;
}

const BLANK: CategoryInput = {
  name:      '',
  color:     '#FF6B35',
  icon:      'restaurant',
  isActive:  true,
  sortOrder: 0,
};

export function CategoryDrawer({ category, onSave, onClose }: Props) {
  const [form, setForm]     = useState<CategoryInput>(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (category) {
      setForm({
        name:      category.name,
        color:     category.color,
        icon:      category.icon,
        isActive:  category.isActive,
        sortOrder: category.sortOrder,
      });
    } else {
      setForm(BLANK);
    }
    setError(null);
  }, [category]);

  useShortcut('Escape', onClose);

  function set<K extends keyof CategoryInput>(key: K, val: CategoryInput[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError('Category name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = category
        ? await updateCategory(category._id, form)
        : await createCategory(form);
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
        className="flex h-full w-full max-w-sm flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-900 px-5 py-3 text-white">
          <h2 className="text-sm font-semibold">
            {category ? 'Edit Category' : 'New Category'}
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

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Name *
            </label>
            <input
              className={field}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Category name"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.color ?? '#FF6B35'}
                onChange={e => set('color', e.target.value)}
                className="h-10 w-16 cursor-pointer rounded-lg border border-gray-200 p-1"
              />
              <input
                className={`${field} font-mono`}
                value={form.color}
                onChange={e => set('color', e.target.value)}
                placeholder="#FF6B35"
                maxLength={7}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Icon
              </label>
              <input
                className={field}
                value={form.icon}
                onChange={e => set('icon', e.target.value)}
                placeholder="restaurant"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Sort Order
              </label>
              <input
                className={field}
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={e => set('sortOrder', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">Active</span>
            <button
              type="button"
              onClick={() => set('isActive', !form.isActive)}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                form.isActive ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  form.isActive ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
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
            {saving ? 'Saving…' : category ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
