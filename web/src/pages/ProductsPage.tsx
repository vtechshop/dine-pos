import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Plus, Search, RefreshCw, Download, Upload, Edit2, Trash2 } from 'lucide-react';
import type { Product, Category } from '../types';
import {
  fetchProducts,
  fetchCategories,
  updateProduct,
  deleteProduct,
  createProduct,
  deleteCategory,
} from '../api/products';
import { ProductDrawer } from '../components/products/ProductDrawer';
import { CategoryDrawer } from '../components/products/CategoryDrawer';
import { Spinner } from '../components/ui/Spinner';
import { useShortcut } from '../hooks/useShortcut';

type Tab = 'products' | 'categories';
type VegFilter = 'all' | 'veg' | 'nonveg';

// ── CSV helpers ───────────────────────────────────────────────────────────────

function buildCSV(products: Product[]): string {
  const header = [
    'name', 'price', 'category', 'taxPercent', 'isVeg',
    'isAvailable', 'shortCode', 'description', 'stock', 'hsnCode',
  ];
  const rows = products.map(p => [
    p.name,
    p.price,
    p.category?.name ?? '',
    p.taxPercent,
    p.isVeg,
    p.isAvailable,
    p.shortCode,
    (p.description ?? '').replace(/,/g, ';'),
    p.stock,
    p.hsnCode,
  ]);
  return [header, ...rows]
    .map(row =>
      row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cells.push(cur.trim());
  return cells.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
}

// ── Root page ─────────────────────────────────────────────────────────────────

export function ProductsPage() {
  const [tab, setTab] = useState<Tab>('products');

  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  const loadCategories = useCallback(async () => {
    setCatLoading(true);
    try {
      setCategories(await fetchCategories());
    } catch {
      // silent
    } finally {
      setCatLoading(false);
    }
  }, []);

  useEffect(() => { void loadCategories(); }, [loadCategories]);

  return (
    <div className="flex h-full flex-col">
      {/* Page header + tabs */}
      <div className="flex shrink-0 flex-col border-b border-border bg-canvas">
        <div className="px-5 py-3">
          <h1 className="text-base font-semibold text-ink">Products</h1>
        </div>
        <div className="flex gap-0 px-5">
          {(['products', 'categories'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink/50 hover:text-ink/70'
              }`}
            >
              {t === 'products' ? 'Products' : 'Categories'}
              {t === 'categories' && !catLoading && (
                <span className="ml-1.5 rounded-full bg-border/40 px-1.5 py-0.5 text-[10px] text-ink/50">
                  {categories.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab panels — conditional mount means shortcuts don't conflict */}
      <div className="flex-1 overflow-hidden">
        {tab === 'products' && (
          <ProductsPanel categories={categories} />
        )}
        {tab === 'categories' && (
          <CategoriesPanel categories={categories} onRefresh={loadCategories} />
        )}
      </div>
    </div>
  );
}

// ── Products panel ────────────────────────────────────────────────────────────

function ProductsPanel({ categories }: { categories: Category[] }) {
  const [products, setProducts]       = useState<Product[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [catFilter, setCatFilter]     = useState('');
  const [vegFilter, setVegFilter]     = useState<VegFilter>('all');
  const [availFilter, setAvailFilter] = useState<boolean | null>(null);
  const [editing, setEditing]         = useState<Product | 'new' | null>(null);
  const [toggling, setToggling]       = useState<Set<string>>(new Set());
  const [importMsg, setImportMsg]     = useState('');
  const [importing, setImporting]     = useState(false);
  const fileInputRef                  = useRef<HTMLInputElement>(null);
  const searchRef                     = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await fetchProducts());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Keyboard shortcuts — F1 search, F2 new, Escape clear
  useShortcut('F1', () => searchRef.current?.focus(), editing === null);
  useShortcut('F2', () => setEditing('new'),          editing === null);

  const visible = useMemo(() => {
    let ps = products;
    if (catFilter)              ps = ps.filter(p => p.category?._id === catFilter);
    if (vegFilter === 'veg')    ps = ps.filter(p => p.isVeg);
    if (vegFilter === 'nonveg') ps = ps.filter(p => !p.isVeg);
    if (availFilter !== null)   ps = ps.filter(p => p.isAvailable === availFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      ps = ps.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.shortCode ?? '').toLowerCase().includes(q),
      );
    }
    return ps;
  }, [products, catFilter, vegFilter, availFilter, search]);

  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [visible]);

  async function toggleAvail(p: Product) {
    if (toggling.has(p._id)) return;
    setToggling(prev => new Set([...prev, p._id]));
    try {
      const updated = await updateProduct(p._id, { isAvailable: !p.isAvailable });
      setProducts(prev => prev.map(x => (x._id === updated._id ? updated : x)));
    } catch {
      // revert on next load
    } finally {
      setToggling(prev => {
        const n = new Set(prev);
        n.delete(p._id);
        return n;
      });
    }
  }

  async function handleDelete(p: Product) {
    if (!confirm(`Delete "${p.name}"? This will mark it unavailable.`)) return;
    try {
      await deleteProduct(p._id);
      setProducts(prev => prev.filter(x => x._id !== p._id));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  function handleExport() {
    downloadCSV(
      buildCSV(products),
      `products-${new Date().toISOString().split('T')[0]}.csv`,
    );
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg('');
    const text = await file.text();
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    const [, ...dataLines] = lines;
    const catMap = new Map(categories.map(c => [c.name.toLowerCase(), c._id]));
    let ok = 0; let fail = 0;
    for (const line of dataLines) {
      const [
        name, price, cat, taxPct, isVeg,
        isAvail, shortCode, desc, stock, hsnCode,
      ] = parseCSVRow(line);
      const catId = catMap.get((cat ?? '').toLowerCase());
      if (!name || !catId) { fail++; continue; }
      try {
        const created = await createProduct({
          name,
          price:       parseFloat(price)   || 0,
          category:    catId,
          taxPercent:  parseFloat(taxPct)  || 5,
          isVeg:       (isVeg  ?? 'true').toLowerCase() !== 'false',
          isAvailable: (isAvail ?? 'true').toLowerCase() !== 'false',
          shortCode:   shortCode ?? '',
          description: desc      ?? '',
          stock:       stock ? parseInt(stock, 10) : -1,
          hsnCode:     hsnCode   ?? '',
        });
        setProducts(prev => [...prev, created]);
        ok++;
      } catch {
        fail++;
      }
    }
    setImportMsg(`Imported ${ok}${fail > 0 ? `, ${fail} failed` : ''}`);
    setImporting(false);
    if (e.target) e.target.value = '';
  }

  const hasFilter = catFilter || vegFilter !== 'all' || availFilter !== null || search;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-canvas px-5 py-2.5">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
          <label htmlFor="products-search" className="sr-only">Search products</label>
          <input
            id="products-search"
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search… (F1)"
            className="h-8 w-48 rounded-lg border border-border pl-8 pr-3 text-xs outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
          />
        </div>

        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          className="h-8 rounded-lg border border-border px-2 text-xs text-ink/60 outline-none focus:border-brand/50"
        >
          <option value="">All Categories</option>
          {categories.map(c => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>

        {(['all', 'veg', 'nonveg'] as VegFilter[]).map(v => (
          <button
            key={v}
            onClick={() => setVegFilter(v)}
            className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors ${
              vegFilter === v
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-border bg-canvas text-ink/50 hover:bg-mist'
            }`}
          >
            {v === 'all' ? 'All' : v === 'veg' ? '● Veg' : '● Non-veg'}
          </button>
        ))}

        <button
          onClick={() => setAvailFilter(availFilter === true ? null : true)}
          className={`h-8 rounded-lg border px-3 text-xs font-medium transition-colors ${
            availFilter === true
              ? 'border-green-500 bg-green-50 text-green-700'
              : 'border-border bg-canvas text-ink/50 hover:bg-mist'
          }`}
        >
          Available only
        </button>

        <div className="flex-1" />

        {importMsg && (
          <span className="text-xs text-ink/40">{importMsg}</span>
        )}

        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-ink/50 hover:bg-mist disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>

        <button
          onClick={handleExport}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-ink/60 hover:bg-mist"
        >
          <Download size={12} />Export CSV
        </button>

        <label
          className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-ink/60 hover:bg-mist ${
            importing ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <Upload size={12} />
          {importing ? 'Importing…' : 'Import CSV'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="sr-only"
            onChange={e => { void handleImportFile(e); }}
          />
        </label>

        <button
          onClick={() => setEditing('new')}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand/90"
        >
          <Plus size={13} />New (F2)
        </button>
      </div>

      {/* Count + clear */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-mist/60 px-5 py-1 text-xs text-ink/40">
        <span>
          {visible.length} of {products.length} product{products.length !== 1 ? 's' : ''}
        </span>
        {hasFilter && (
          <button
            onClick={() => {
              setSearch(''); setCatFilter(''); setVegFilter('all'); setAvailFilter(null);
            }}
            className="text-brand hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading && products.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-ink/40">
            <p className="text-sm">{hasFilter ? 'No products match the filters' : 'No products yet'}</p>
            {!hasFilter && (
              <button
                onClick={() => setEditing('new')}
                className="mt-3 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90"
              >
                Add First Product
              </button>
            )}
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-mist text-left">
                <th className="w-7 px-3 py-2.5" />
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Name
                </th>
                <th className="w-36 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Category
                </th>
                <th className="w-24 px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Price
                </th>
                <th className="w-16 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Tax%
                </th>
                <th className="w-20 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Stock
                </th>
                <th className="w-24 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Avail.
                </th>
                <th className="w-20 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, visibleCount).map(p => {
                const color = p.category?.color ?? '#888';
                const name  = p.category?.name  ?? '—';
                return (
                  <tr key={p._id} className="border-b border-border hover:bg-mist">
                    {/* Veg indicator */}
                    <td className="px-3 py-2.5 text-center">
                      <span
                        aria-hidden="true"
                        className={`inline-flex h-3 w-3 items-center justify-center rounded-sm border-2 ${
                          p.isVeg ? 'border-green-600' : 'border-red-600'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            p.isVeg ? 'bg-green-600' : 'bg-red-600'
                          }`}
                        />
                      </span>
                      <span className="sr-only">{p.isVeg ? 'Veg' : 'Non-veg'}</span>
                    </td>
                    {/* Name */}
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{p.name}</div>
                      {p.shortCode && (
                        <div className="font-mono text-[10px] text-ink/40">{p.shortCode}</div>
                      )}
                    </td>
                    {/* Category badge */}
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: `${color}1a`, color }}
                      >
                        {name}
                      </span>
                    </td>
                    {/* Price */}
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-ink">
                      ₹{p.price.toFixed(2)}
                    </td>
                    {/* Tax */}
                    <td className="px-3 py-2.5 text-center text-xs text-ink/50">
                      {p.taxPercent}%
                    </td>
                    {/* Stock */}
                    <td className="px-3 py-2.5 text-center text-xs">
                      {p.stock === -1 ? (
                        <span className="text-ink/40">∞</span>
                      ) : (
                        <span className={p.stock <= 5 ? 'font-semibold text-orange-500' : 'text-ink/70'}>
                          {p.stock}
                        </span>
                      )}
                    </td>
                    {/* Toggle */}
                    <td className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => { void toggleAvail(p); }}
                        disabled={toggling.has(p._id)}
                        className={`relative inline-flex h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
                          p.isAvailable ? 'bg-green-500' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            p.isAvailable ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                          className="rounded-lg p-1.5 text-ink/40 hover:bg-border/40 hover:text-ink/70"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => { void handleDelete(p); }}
                          aria-label={`Delete ${p.name}`}
                          className="rounded-lg p-1.5 text-ink/40 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={13} />
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

      {editing !== null && (
        <ProductDrawer
          product={editing === 'new' ? null : editing}
          categories={categories}
          onSave={saved => {
            setProducts(prev => {
              const idx = prev.findIndex(x => x._id === saved._id);
              return idx >= 0
                ? prev.map(x => (x._id === saved._id ? saved : x))
                : [saved, ...prev];
            });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Categories panel ──────────────────────────────────────────────────────────

function CategoriesPanel({
  categories,
  onRefresh,
}: {
  categories: Category[];
  onRefresh: () => void;
}) {
  const [editing, setEditing]   = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useShortcut('F2', () => setEditing('new'), editing === null);

  async function handleDelete(c: Category) {
    if (
      !confirm(
        `Delete category "${c.name}"? Products in this category must be reassigned first.`,
      )
    )
      return;
    setDeleting(c._id);
    try {
      await deleteCategory(c._id);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-5 py-2.5">
        <span className="text-xs text-ink/40">{categories.length} categories</span>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
        >
          <Plus size={13} />New (F2)
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {categories.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-ink/40">
            <p className="text-sm">No categories yet</p>
            <button
              onClick={() => setEditing('new')}
              className="mt-3 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90"
            >
              Add First Category
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {categories.map(c => (
              <div
                key={c._id}
                className="flex items-center gap-3 rounded-xl border border-border bg-canvas px-4 py-3 shadow-sm"
              >
                <div
                  className="h-10 w-10 shrink-0 rounded-lg"
                  style={{ backgroundColor: c.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{c.name}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-[10px] text-ink/40">#{c.sortOrder}</span>
                    <span
                      className={`text-[10px] font-medium ${
                        c.isActive ? 'text-green-600' : 'text-gray-400'
                      }`}
                    >
                      {c.isActive ? '● Active' : '○ Inactive'}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setEditing(c)}
                    className="rounded-lg p-1.5 text-ink/40 hover:bg-border/40 hover:text-ink/70"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    onClick={() => { void handleDelete(c); }}
                    disabled={deleting === c._id}
                    className="rounded-lg p-1.5 text-ink/40 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing !== null && (
        <CategoryDrawer
          category={editing === 'new' ? null : editing}
          onSave={() => { onRefresh(); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
