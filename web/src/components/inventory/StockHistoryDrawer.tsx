import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { X, History, TrendingUp, RotateCcw, SlidersHorizontal, Package, ShoppingCart, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Ingredient, StockMovement, StockMovementType } from '../../types';
import { fetchIngredientHistory } from '../../api/inventory';
import { Spinner } from '../ui/Spinner';

interface Props {
  ingredient: Ingredient;
  onClose: () => void;
}

interface MovementMeta {
  label: string;
  color: string;
  bg: string;
  Icon: LucideIcon;
}

const META: Record<StockMovementType, MovementMeta> = {
  stock_in:       { label: 'Stock In',        color: 'text-green-700',  bg: 'bg-green-100',  Icon: TrendingUp },
  restock:        { label: 'Restock',         color: 'text-green-700',  bg: 'bg-green-100',  Icon: TrendingUp },
  grn:            { label: 'GRN Receipt',     color: 'text-teal-700',   bg: 'bg-teal-100',   Icon: Package },
  opening_stock:  { label: 'Opening Stock',   color: 'text-teal-700',   bg: 'bg-teal-100',   Icon: Package },
  sale:           { label: 'Sale / Recipe',   color: 'text-blue-700',   bg: 'bg-blue-100',   Icon: ShoppingCart },
  sale_reversal:  { label: 'Order Cancelled', color: 'text-purple-700', bg: 'bg-purple-100', Icon: RotateCcw },
  waste:          { label: 'Waste',           color: 'text-red-700',    bg: 'bg-red-100',    Icon: Trash2 },
  adjustment:     { label: 'Adjustment',      color: 'text-amber-700',  bg: 'bg-amber-100',  Icon: SlidersHorizontal },
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtCur(n: number, sym = '₹'): string {
  return `${sym}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function StockHistoryDrawer({ ingredient, onClose }: Props) {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [skip,      setSkip]      = useState(0);
  const LIMIT = 50;

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIngredientHistory(ingredient._id, { limit: LIMIT, skip: offset });
      setMovements(prev => offset === 0 ? res.movements : [...prev, ...res.movements]);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [ingredient._id]);

  useEffect(() => {
    setSkip(0);
    setMovements([]);
    void load(0);
  }, [ingredient._id, load]);

  function loadMore() {
    const next = skip + LIMIT;
    setSkip(next);
    void load(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-ink px-5 py-3 text-white">
          <div className="flex items-center gap-2">
            <History size={15} className="text-white/60" />
            <div>
              <h2 className="text-sm font-semibold">{ingredient.name} — Stock History</h2>
              <p className="text-[11px] text-white/40">{total} movements total</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {loading && movements.length === 0 ? (
            <div className="flex h-48 items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : movements.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-ink/40">
              <History size={32} className="mb-3 opacity-30" />
              <p className="text-sm">No history yet</p>
              <p className="mt-1 text-xs">History records every stock change going forward.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {movements.map(m => {
                const meta = META[m.type] ?? { label: m.type, color: 'text-ink', bg: 'bg-ink/10', Icon: Package };
                const isPositive = m.delta > 0;
                return (
                  <div key={m._id} className="flex gap-3 px-5 py-3.5 hover:bg-mist">
                    {/* Icon */}
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.bg}`}>
                      <meta.Icon size={13} className={meta.color} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                        <span className={`shrink-0 text-sm font-bold tabular-nums ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {isPositive ? '+' : ''}{m.delta.toFixed(3)} {ingredient.unit}
                        </span>
                      </div>

                      {/* Stock before → after */}
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink/40">
                        <span className="tabular-nums">{m.previousStock.toFixed(3)}</span>
                        <span>→</span>
                        <span className="tabular-nums font-medium text-ink/60">{m.resultingStock.toFixed(3)} {ingredient.unit}</span>
                      </div>

                      {/* Cost / total */}
                      {(m.costPerUnit != null || m.totalCost != null) && (
                        <div className="mt-1 flex gap-3 text-[11px] text-ink/50">
                          {m.costPerUnit != null && <span>{sym}{m.costPerUnit.toFixed(2)}/{ingredient.unit}</span>}
                          {m.totalCost != null && <span className="font-semibold">{fmtCur(m.totalCost, sym)}</span>}
                        </div>
                      )}

                      {/* Supplier / Invoice */}
                      {(m.supplier || m.invoiceNumber) && (
                        <p className="mt-1 text-[11px] text-ink/40">
                          {[m.supplier, m.invoiceNumber].filter(Boolean).join(' · ')}
                        </p>
                      )}

                      {/* Reason / notes */}
                      {(m.reason || m.notes) && (
                        <p className="mt-0.5 text-[11px] text-ink/40">
                          {[m.reason, m.notes].filter(Boolean).join(' — ')}
                        </p>
                      )}

                      {/* Timestamp */}
                      <p className="mt-1 text-[10px] text-ink/30">{fmtDateTime(m.createdAt)}</p>
                    </div>
                  </div>
                );
              })}

              {/* Load more */}
              {movements.length < total && (
                <div className="flex items-center justify-center py-4">
                  <button
                    onClick={loadMore}
                    disabled={loading}
                    className="rounded-lg border border-border px-4 py-1.5 text-xs text-ink/50 hover:bg-mist disabled:opacity-40"
                  >
                    {loading ? 'Loading…' : `Load more (${total - movements.length} remaining)`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
