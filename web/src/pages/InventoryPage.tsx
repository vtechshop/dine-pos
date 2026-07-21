import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Plus, RefreshCw, Search, AlertTriangle, Package } from 'lucide-react';
import type { Ingredient } from '../types';
import {
  fetchIngredients,
  fetchLowStockIngredients,
  deleteIngredient,
} from '../api/products';
import { IngredientDrawer } from '../components/products/IngredientDrawer';
import { Spinner } from '../components/ui/Spinner';
import { useShortcut } from '../hooks/useShortcut';

type DrawerState =
  | { mode: 'form'; ingredient: Ingredient | null }
  | { mode: 'restock'; ingredient: Ingredient }
  | null;

export function InventoryPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [lowStock, setLowStock]       = useState<Ingredient[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [drawer, setDrawer]           = useState<DrawerState>(null);
  const searchRef                     = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ ingredients: all }, { ingredients: low }] = await Promise.all([
        fetchIngredients({ limit: 500 }),
        fetchLowStockIngredients(),
      ]);
      setIngredients(all);
      setLowStock(low);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useShortcut('F1', () => searchRef.current?.focus(), drawer === null);
  useShortcut('F2', () => setDrawer({ mode: 'form', ingredient: null }), drawer === null);

  const visible = useMemo(() => {
    if (!search.trim()) return ingredients;
    const q = search.toLowerCase();
    return ingredients.filter(
      i => i.name.toLowerCase().includes(q) || i.unit.toLowerCase().includes(q),
    );
  }, [ingredients, search]);

  const lowStockIds = useMemo(() => new Set(lowStock.map(i => i._id)), [lowStock]);

  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [visible]);

  async function handleDelete(i: Ingredient) {
    if (!confirm(`Delete "${i.name}"?`)) return;
    try {
      await deleteIngredient(i._id);
      setIngredients(prev => prev.filter(x => x._id !== i._id));
      setLowStock(prev => prev.filter(x => x._id !== i._id));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function refreshLowStock() {
    try {
      const { ingredients: low } = await fetchLowStockIngredients();
      setLowStock(low);
    } catch {
      // silent
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-ink">Inventory</h1>
          {lowStock.length > 0 && !loading && (
            <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-600">
              <AlertTriangle size={11} />
              {lowStock.length} low stock
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40"
            />
            <label htmlFor="inventory-search" className="sr-only">Search ingredients</label>
            <input
              id="inventory-search"
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search… (F1)"
              className="h-8 w-44 rounded-lg border border-border pl-8 pr-3 text-xs outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
            />
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-ink/50 hover:bg-mist disabled:opacity-40"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setDrawer({ mode: 'form', ingredient: null })}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand/90"
          >
            <Plus size={13} />Add Ingredient (F2)
          </button>
        </div>
      </div>

      {/* Low-stock alert banner — orange is semantic for low-stock, keep all */}
      {lowStock.length > 0 && !loading && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-orange-100 bg-orange-50 px-5 py-2">
          <span className="text-xs font-semibold text-orange-700">Low stock:</span>
          {lowStock.map(i => (
            <button
              key={i._id}
              onClick={() => setDrawer({ mode: 'restock', ingredient: i })}
              className="rounded-lg bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 hover:bg-orange-200"
            >
              {i.name} ({i.currentStock} {i.unit})
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading && ingredients.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-ink/40">
            <Package size={32} className="mb-3 opacity-30" />
            <p className="text-sm">
              {search ? 'No ingredients match' : 'No ingredients yet'}
            </p>
            {!search && (
              <button
                onClick={() => setDrawer({ mode: 'form', ingredient: null })}
                className="mt-3 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90"
              >
                Add First Ingredient
              </button>
            )}
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-mist text-left">
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Ingredient
                </th>
                <th className="w-20 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Unit
                </th>
                <th className="w-28 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">
                  In Stock
                </th>
                <th className="w-28 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Alert At
                </th>
                <th className="w-28 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Cost/Unit
                </th>
                <th className="w-44 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, visibleCount).map(i => {
                const isLow = lowStockIds.has(i._id);
                return (
                  <tr
                    key={i._id}
                    className={`border-b border-border hover:bg-mist ${
                      isLow ? 'bg-orange-50/40' : 'bg-canvas'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isLow && (
                          <AlertTriangle size={12} className="shrink-0 text-orange-500" />
                        )}
                        <span className="font-medium text-ink">{i.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink/50">{i.unit}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                        isLow ? 'text-orange-600' : 'text-ink'
                      }`}
                    >
                      {i.currentStock}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink/40">
                      {i.lowStockThreshold}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink/60">
                      ₹{i.costPerUnit.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setDrawer({ mode: 'restock', ingredient: i })}
                          className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-100"
                        >
                          + Restock
                        </button>
                        <button
                          onClick={() => setDrawer({ mode: 'form', ingredient: i })}
                          className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-ink/50 hover:bg-mist"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => { void handleDelete(i); }}
                          className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-red-500 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {visible.length > visibleCount && (
            <div className="flex items-center justify-center gap-3 py-4 text-xs">
              <span className="text-ink/40">Showing {visibleCount} of {visible.length}</span>
              <button
                onClick={() => setVisibleCount(c => c + 50)}
                className="rounded-lg border border-border px-3 py-1.5 text-ink/50 hover:bg-mist"
              >
                Load {Math.min(50, visible.length - visibleCount)} more
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {drawer !== null && (
        <IngredientDrawer
          ingredient={drawer.ingredient}
          mode={drawer.mode}
          onSave={saved => {
            setIngredients(prev => {
              const idx = prev.findIndex(x => x._id === saved._id);
              return idx >= 0
                ? prev.map(x => (x._id === saved._id ? saved : x))
                : [saved, ...prev];
            });
            void refreshLowStock();
            setDrawer(null);
          }}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
