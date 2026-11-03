import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, RefreshCw } from 'lucide-react';
import { fetchProducts, setProductAvailability } from '../../api/products';
import { ApiError } from '../../api/client';
import type { Product } from '../../types';
import { Spinner } from '../ui/Spinner';

type Filter = 'all' | 'out';

/**
 * Kitchen "Stock" drawer: every dish with an on/off switch. Off = out of stock —
 * it can't be ordered at the counter, by waiters or on QR until switched back on.
 */
export function KitchenStockPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems]     = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [filter, setFilter]   = useState<Filter>('all');
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

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const outCount = useMemo(() => items.filter(p => !p.isAvailable).length, [items]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(p => {
      if (filter === 'out' && p.isAvailable) return false;
      return !q || p.name.toLowerCase().includes(q) || (p.shortCode ?? '').toLowerCase().includes(q);
    });
  }, [items, query, filter]);

  async function toggle(p: Product) {
    const next = !p.isAvailable;
    setBusyId(p._id); setRowErr(null);
    setItems(prev => prev.map(x => (x._id === p._id ? { ...x, isAvailable: next } : x)));   // feels instant
    try {
      await setProductAvailability(p._id, next);
    } catch (e) {
      setItems(prev => prev.map(x => (x._id === p._id ? { ...x, isAvailable: !next } : x))); // undo
      const msg = e instanceof ApiError && e.code === 'NO_STOCK'
        ? 'No stock left — restock it in Inventory first.'
        : e instanceof Error ? e.message : 'Could not update this dish.';
      setRowErr({ id: p._id, msg });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-label="Stock"
        className="flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Stock</h2>
            <p className="text-xs text-ink/50">
              {outCount === 0 ? 'Everything is available' : `${outCount} dish${outCount === 1 ? '' : 'es'} out of stock`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void load()} aria-label="Refresh menu"
              className="rounded-lg p-1.5 text-ink/40 hover:bg-mist hover:text-ink/70">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close"
              className="rounded-lg p-1.5 text-ink/40 hover:bg-mist hover:text-ink/70">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-2 border-b border-border px-5 py-3">
          <div className="relative">
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
          <div className="flex gap-1.5">
            {([['all', `All (${items.length})`], ['out', `Out of stock (${outCount})`]] as [Filter, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  filter === k ? 'border-coffee bg-coffee text-white' : 'border-border text-umber hover:bg-mist'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button type="button" onClick={() => void load()}
                className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist">Try again</button>
            </div>
          ) : shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink/40">{filter === 'out' ? 'Nothing is out of stock.' : 'No dishes match.'}</p>
          ) : (
            <ul className="space-y-1.5">
              {shown.map(p => (
                <li key={p._id} className={`rounded-xl border px-3.5 py-2.5 ${p.isAvailable ? 'border-border bg-canvas' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-semibold ${p.isAvailable ? 'text-ink' : 'text-ink/60'}`}>{p.name}</p>
                      <p className={`text-[11px] font-medium ${p.isAvailable ? 'text-emerald-700' : 'text-red-600'}`}>
                        {p.isAvailable ? 'Available' : 'Out of stock'}
                        {typeof p.stock === 'number' && p.stock >= 0 ? ` · ${p.stock} left` : ''}
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
      </aside>
    </div>
  );
}
