import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Package } from 'lucide-react';
import { fetchProducts, setProductAvailability } from '../api/products';
import { ApiError } from '../api/client';
import type { Product } from '../types';
import { Spinner } from '../components/ui/Spinner';

type Filter = 'all' | 'out' | 'in';

/**
 * Stock — every dish with an on/off switch, full page. Off = out of stock: it can't
 * be ordered at the counter, by waiters, on QR, or on Swiggy / Zomato (when connected)
 * until it's switched back on.
 */
export function KitchenStockPage() {
  const [items, setItems]     = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [filter, setFilter]   = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [rowErr, setRowErr]   = useState<{ id: string; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await fetchProducts();
      setItems([...list].sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setError("Couldn't load the menu. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const outCount = useMemo(() => items.filter(p => !p.isAvailable).length, [items]);
  const categories = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of items) if (p.category) m.set(p.category._id, p.category.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(p => {
      if (filter === 'out' && p.isAvailable) return false;
      if (filter === 'in' && !p.isAvailable) return false;
      if (category && p.category?._id !== category) return false;
      return !q || p.name.toLowerCase().includes(q) || (p.shortCode ?? '').toLowerCase().includes(q);
    });
  }, [items, query, filter, category]);

  async function toggle(p: Product) {
    const next = !p.isAvailable;
    setBusyId(p._id); setRowErr(null);
    setItems(prev => prev.map(x => (x._id === p._id ? { ...x, isAvailable: next } : x)));   // feels instant
    try {
      await setProductAvailability(p._id, next);
    } catch (e) {
      setItems(prev => prev.map(x => (x._id === p._id ? { ...x, isAvailable: !next } : x))); // undo
      const msg = e instanceof ApiError && e.code === 'NO_STOCK'
        ? '0 left — the admin must update its count in Products → this dish → Stock first.'
        : e instanceof Error ? e.message : 'Could not update this dish.';
      setRowErr({ id: p._id, msg });
    } finally {
      setBusyId(null);
    }
  }

  const chips: [Filter, string][] = [
    ['all', `All (${items.length})`],
    ['out', `Out of stock (${outCount})`],
    ['in',  `Available (${items.length - outCount})`],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-canvas px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Package size={20} className="text-ink/60" />
          <div>
            <h1 className="text-lg font-semibold text-ink">Stock</h1>
            <p className="text-xs text-ink/50">
              {outCount === 0 ? 'Everything is available' : `${outCount} dish${outCount === 1 ? '' : 'es'} out of stock`}
              {' · '}switch a dish off when it runs out — counter, waiters, QR and Swiggy / Zomato stop taking it
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink/70 disabled:opacity-40">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search dish…"
            aria-label="Search dish"
            className="search-input w-full py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === k ? 'border-coffee bg-coffee text-white' : 'border-border text-umber hover:bg-mist'
              }`}>
              {label}
            </button>
          ))}
        </div>
        {categories.length > 1 && (
          <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category"
            className="rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand/50">
            <option value="">All categories</option>
            {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      {/* Dishes */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <div className="py-16 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" onClick={() => void load()}
              className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist">Try again</button>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink/40">{filter === 'out' ? 'Nothing is out of stock.' : 'No dishes match.'}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shown.map(p => (
              <li key={p._id} className={`rounded-xl border px-4 py-3 ${p.isAvailable ? 'border-border bg-canvas' : 'border-red-200 bg-red-50'}`}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${p.isAvailable ? 'text-ink' : 'text-ink/60'}`}>{p.name}</p>
                    <p className={`text-[11px] font-medium ${p.isAvailable ? 'text-emerald-700' : 'text-red-600'}`}>
                      {p.isAvailable ? 'Available' : 'Out of stock'}
                      {typeof p.stock === 'number' && p.stock >= 0 ? ` · ${p.stock} left` : ''}
                      {p.category ? <span className="font-normal text-ink/40"> · {p.category.name}</span> : null}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.isAvailable}
                    aria-label={`${p.name}: ${p.isAvailable ? 'available — switch off to mark out of stock' : 'out of stock — switch on to make available'}`}
                    disabled={busyId === p._id}
                    onClick={() => void toggle(p)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${p.isAvailable ? 'bg-emerald-500' : 'bg-red-300'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${p.isAvailable ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </div>
                {rowErr?.id === p._id && <p className="mt-1.5 text-[11px] text-red-600">{rowErr.msg}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
