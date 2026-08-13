import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Plus, RefreshCw, Search, AlertTriangle, Package, Trash2,
  TrendingUp, SlidersHorizontal, History, ChevronDown,
} from 'lucide-react';
import type { Ingredient, WasteLog, WasteAnalytics, WasteReason } from '../types';
import {
  fetchIngredients,
  fetchLowStockIngredients,
  deleteIngredient,
} from '../api/products';
import { fetchWasteLogs, fetchWasteAnalytics, createWasteLog, deleteWasteLog } from '../api/waste';
import { IngredientDrawer } from '../components/products/IngredientDrawer';
import { StockInDrawer } from '../components/inventory/StockInDrawer';
import { StockAdjustDrawer } from '../components/inventory/StockAdjustDrawer';
import { StockHistoryDrawer } from '../components/inventory/StockHistoryDrawer';
import { Spinner } from '../components/ui/Spinner';
import { useShortcut } from '../hooks/useShortcut';
import { useSettings } from '../context/SettingsContext';

// ── Types ─────────────────────────────────────────────────────────────────────
type DrawerState =
  | { mode: 'form';     ingredient: Ingredient | null }
  | { mode: 'stock-in'; ingredient: Ingredient }
  | { mode: 'adjust';   ingredient: Ingredient }
  | { mode: 'history';  ingredient: Ingredient }
  | null;

type InventoryTab   = 'ingredients' | 'waste';
type StockStatus    = 'in_stock' | 'low_stock' | 'out_of_stock';
type StatusFilter   = 'all' | StockStatus;
type SortKey        = 'name' | 'stock' | 'value' | 'updated';

// ── Constants ─────────────────────────────────────────────────────────────────
const WASTE_REASONS: Array<{ id: WasteReason; label: string; bgClass: string; badgeClass: string }> = [
  { id: 'expired',       label: 'Expired',       bgClass: 'bg-red-700',    badgeClass: 'bg-red-100 text-red-700' },
  { id: 'spoiled',       label: 'Spoiled',       bgClass: 'bg-red-600',    badgeClass: 'bg-red-50 text-red-600' },
  { id: 'damaged',       label: 'Damaged',       bgClass: 'bg-orange-700', badgeClass: 'bg-orange-100 text-orange-700' },
  { id: 'overcooked',    label: 'Overcooked',    bgClass: 'bg-yellow-500', badgeClass: 'bg-yellow-100 text-yellow-700' },
  { id: 'overproduction',label: 'Overproduction',bgClass: 'bg-yellow-600', badgeClass: 'bg-yellow-50 text-yellow-600' },
  { id: 'preparation',   label: 'Prep Waste',    bgClass: 'bg-amber-600',  badgeClass: 'bg-amber-100 text-amber-700' },
  { id: 'spillage',      label: 'Spillage',      bgClass: 'bg-blue-600',   badgeClass: 'bg-blue-100 text-blue-700' },
  { id: 'returned',      label: 'Returned',      bgClass: 'bg-blue-700',   badgeClass: 'bg-blue-50 text-blue-600' },
  { id: 'other',         label: 'Other',         bgClass: 'bg-ink/40',     badgeClass: 'bg-ink/10 text-ink/60' },
];

const STATUS_CHIP: Record<StockStatus, { label: string; cls: string }> = {
  in_stock:     { label: 'In Stock',     cls: 'bg-green-100 text-green-700' },
  low_stock:    { label: 'Low Stock',    cls: 'bg-orange-100 text-orange-700' },
  out_of_stock: { label: 'Out of Stock', cls: 'bg-red-100 text-red-700' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr(): string { return new Date().toLocaleDateString('en-CA'); }

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtRelDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function getStatus(i: Ingredient): StockStatus {
  if (i.currentStock <= 0)                     return 'out_of_stock';
  if (i.currentStock <= i.lowStockThreshold)   return 'low_stock';
  return 'in_stock';
}

// ── Component ─────────────────────────────────────────────────────────────────
export function InventoryPage() {
  const { settings } = useSettings();
  const sym    = settings?.currencySymbol ?? '₹';
  const fmtCur = (n: number) => `${sym}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  // ── Tab ──────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<InventoryTab>('ingredients');

  // ── Ingredients state ────────────────────────────────────────────────────────
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [lowStock,    setLowStock]    = useState<Ingredient[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [todayWasteKpi, setTodayWasteKpi] = useState(0);

  // Filters
  const [search,        setSearch]       = useState('');
  const [statusFilter,  setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy,        setSortBy]       = useState<SortKey>('name');

  const [drawer, setDrawer]   = useState<DrawerState>(null);
  const searchRef             = useRef<HTMLInputElement>(null);
  const [visibleCount, setVisibleCount] = useState(50);

  // ── Waste state ──────────────────────────────────────────────────────────────
  const [wasteDate,       setWasteDate]       = useState(todayStr);
  const [wasteLogs,       setWasteLogs]       = useState<WasteLog[]>([]);
  const [wasteAnalytics,  setWasteAnalytics]  = useState<WasteAnalytics | null>(null);
  const [wasteLoading,    setWasteLoading]    = useState(false);
  const [wasteError,      setWasteError]      = useState<string | null>(null);
  const [showWasteModal,  setShowWasteModal]  = useState(false);
  const [wasteSaving,     setWasteSaving]     = useState(false);
  const [wasteDeleting,   setWasteDeleting]   = useState<string | null>(null);

  const emptyWasteForm = {
    ingredientId:  '',
    productName:   '',
    quantity:      '',
    unit:          'pcs',
    reason:        'expired' as WasteReason,
    estimatedLoss: '',
    notes:         '',
  };
  const [wasteForm, setWasteForm] = useState(emptyWasteForm);

  // ── Load ingredients ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ ingredients: all }, { ingredients: low }, analytics] = await Promise.all([
        fetchIngredients({ limit: 500 }),
        fetchLowStockIngredients(),
        fetchWasteAnalytics(todayStr()),
      ]);
      setIngredients(all);
      setLowStock(low);
      setTodayWasteKpi(analytics.totalLoss);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function refreshLowStock() {
    try {
      const { ingredients: low } = await fetchLowStockIngredients();
      setLowStock(low);
    } catch { /* silent */ }
  }

  // ── Load waste ───────────────────────────────────────────────────────────────
  const loadWaste = useCallback(async (date: string) => {
    setWasteLoading(true);
    setWasteError(null);
    try {
      const [analytics, { logs }] = await Promise.all([
        fetchWasteAnalytics(date),
        fetchWasteLogs(date),
      ]);
      setWasteAnalytics(analytics);
      setWasteLogs(logs);
    } catch (e) {
      setWasteError(e instanceof Error ? e.message : 'Failed to load waste data');
    } finally {
      setWasteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'waste') void loadWaste(wasteDate);
  }, [tab, wasteDate, loadWaste]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useShortcut('F1', () => searchRef.current?.focus(), drawer === null && tab === 'ingredients');
  useShortcut('F2', () => setDrawer({ mode: 'form', ingredient: null }), drawer === null && tab === 'ingredients');

  // ── KPI calculations ──────────────────────────────────────────────────────────
  const kpi = useMemo(() => ({
    total:      ingredients.length,
    lowStock:   ingredients.filter(i => getStatus(i) === 'low_stock').length,
    outOfStock: ingredients.filter(i => getStatus(i) === 'out_of_stock').length,
    stockValue: ingredients.reduce((s, i) => s + i.currentStock * i.costPerUnit, 0),
  }), [ingredients]);

  // ── Filtered + sorted list ────────────────────────────────────────────────────
  const visible = useMemo(() => {
    let result = ingredients;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(i => i.name.toLowerCase().includes(q) || i.unit.toLowerCase().includes(q));
    }

    if (statusFilter !== 'all') {
      result = result.filter(i => getStatus(i) === statusFilter);
    }

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'stock':   return b.currentStock - a.currentStock;
        case 'value':   return (b.currentStock * b.costPerUnit) - (a.currentStock * a.costPerUnit);
        case 'updated': return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        default:        return a.name.localeCompare(b.name);
      }
    });

    return result;
  }, [ingredients, search, statusFilter, sortBy]);

  useEffect(() => { setVisibleCount(50); }, [visible]);

  // ── Actions ───────────────────────────────────────────────────────────────────
  async function handleDelete(i: Ingredient) {
    if (!confirm(`Delete "${i.name}"? This cannot be undone.`)) return;
    try {
      await deleteIngredient(i._id);
      setIngredients(prev => prev.filter(x => x._id !== i._id));
      setLowStock(prev => prev.filter(x => x._id !== i._id));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  function onIngredientSaved(saved: Ingredient) {
    setIngredients(prev => {
      const idx = prev.findIndex(x => x._id === saved._id);
      return idx >= 0 ? prev.map(x => x._id === saved._id ? saved : x) : [saved, ...prev];
    });
    void refreshLowStock();
    setDrawer(null);
  }

  // ── Waste ingredient selection auto-fill ──────────────────────────────────────
  function handleWasteIngredientChange(ingredientId: string) {
    const ing = ingredients.find(i => i._id === ingredientId);
    if (ing) {
      const qty = parseFloat(wasteForm.quantity) || 0;
      setWasteForm(f => ({
        ...f,
        ingredientId,
        productName: ing.name,
        unit: ing.unit,
        estimatedLoss: qty > 0 ? String((qty * ing.costPerUnit).toFixed(2)) : f.estimatedLoss,
      }));
    } else {
      setWasteForm(f => ({ ...f, ingredientId: '' }));
    }
  }

  function handleWasteQuantityChange(value: string) {
    const qty = parseFloat(value) || 0;
    const ing = ingredients.find(i => i._id === wasteForm.ingredientId);
    setWasteForm(f => ({
      ...f,
      quantity: value,
      estimatedLoss: ing && qty > 0 ? String((qty * ing.costPerUnit).toFixed(2)) : f.estimatedLoss,
    }));
  }

  // ── Waste create ──────────────────────────────────────────────────────────────
  async function handleCreateWaste() {
    if (!wasteForm.productName.trim() || !wasteForm.quantity) return;
    setWasteSaving(true);
    try {
      await createWasteLog({
        productName:   wasteForm.productName.trim(),
        ingredientId:  wasteForm.ingredientId || undefined,
        quantity:      parseFloat(wasteForm.quantity),
        unit:          wasteForm.unit || 'pcs',
        reason:        wasteForm.reason,
        estimatedLoss: wasteForm.estimatedLoss ? parseFloat(wasteForm.estimatedLoss) : undefined,
        date:          wasteDate,
        notes:         wasteForm.notes.trim(),
      });
      setShowWasteModal(false);
      setWasteForm(emptyWasteForm);
      await loadWaste(wasteDate);
      // Refresh ingredient stock if we deducted from it
      if (wasteForm.ingredientId) void load();
    } catch { /* silent */ } finally {
      setWasteSaving(false);
    }
  }

  async function handleDeleteWaste(id: string) {
    if (!confirm('Delete this waste entry?')) return;
    setWasteDeleting(id);
    try {
      await deleteWasteLog(id);
      await loadWaste(wasteDate);
    } catch { /* silent */ } finally {
      setWasteDeleting(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">

      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-canvas">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-ink">Inventory</h1>
            {tab === 'ingredients' && kpi.lowStock > 0 && !loading && (
              <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-600">
                <AlertTriangle size={11} />{kpi.lowStock} low stock
              </span>
            )}
            {tab === 'ingredients' && kpi.outOfStock > 0 && !loading && (
              <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-600">
                <Package size={11} />{kpi.outOfStock} out of stock
              </span>
            )}
          </div>

          {tab === 'ingredients' ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
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
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={wasteDate}
                onChange={e => setWasteDate(e.target.value)}
                className="h-8 rounded-lg border border-border bg-mist px-3 text-xs text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
              />
              <button
                onClick={() => setWasteDate(todayStr())}
                className="flex h-8 items-center rounded-lg border border-border px-3 text-xs text-ink/50 hover:bg-mist"
              >
                Today
              </button>
              <button
                onClick={() => setShowWasteModal(true)}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand/90"
              >
                <Plus size={13} />Log Waste
              </button>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-border px-5">
          {(['ingredients', 'waste'] as InventoryTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
                tab === t ? 'border-brand text-brand' : 'border-transparent text-ink/40 hover:text-ink'
              }`}
            >
              {t === 'ingredients' ? <><Package size={11} />Ingredients</> : <><Trash2 size={11} />Waste Log</>}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════ INGREDIENTS TAB ════════════════ */}
      {tab === 'ingredients' && (
        <>
          {/* KPI cards */}
          {!loading && (
            <div className="shrink-0 grid grid-cols-5 gap-0 border-b border-border divide-x divide-border bg-canvas">
              <KpiCard label="Total Ingredients" value={String(kpi.total)}     sub="ingredients" />
              <KpiCard label="Low Stock"          value={String(kpi.lowStock)}  sub="items" accent="orange" />
              <KpiCard label="Out of Stock"       value={String(kpi.outOfStock)} sub="items" accent="red" />
              <KpiCard label="Stock Value"        value={fmtCur(kpi.stockValue)} sub="total cost" />
              <KpiCard label="Today's Waste Loss" value={fmtCur(todayWasteKpi)} sub="estimated" accent={todayWasteKpi > 0 ? 'red' : undefined} />
            </div>
          )}

          {/* Filter row */}
          <div className="shrink-0 flex items-center gap-2 border-b border-border bg-mist/50 px-5 py-2">
            {/* Status filter buttons */}
            <div className="flex items-center gap-1">
              {(['all', 'in_stock', 'low_stock', 'out_of_stock'] as StatusFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    statusFilter === f
                      ? 'bg-brand text-white'
                      : 'text-ink/50 hover:bg-mist hover:text-ink'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'in_stock' ? 'In Stock' : f === 'low_stock' ? 'Low Stock' : 'Out of Stock'}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-ink/40">{visible.length} items</span>
              {/* Sort */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as SortKey)}
                  className="h-7 appearance-none rounded-lg border border-border bg-canvas pl-2.5 pr-6 text-[11px] text-ink/60 outline-none focus:border-brand/50"
                >
                  <option value="name">Sort: Name</option>
                  <option value="stock">Sort: Stock</option>
                  <option value="value">Sort: Value</option>
                  <option value="updated">Sort: Updated</option>
                </select>
                <ChevronDown size={10} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink/40" />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {error && (
              <div className="m-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
            )}

            {loading && ingredients.length === 0 ? (
              <div className="flex h-48 items-center justify-center"><Spinner size="lg" /></div>
            ) : visible.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center text-ink/40">
                <Package size={32} className="mb-3 opacity-30" />
                <p className="text-sm">{search || statusFilter !== 'all' ? 'No ingredients match' : 'No ingredients yet'}</p>
                {!search && statusFilter === 'all' && (
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
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink/40">Ingredient</th>
                        <th className="w-28 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">In Stock</th>
                        <th className="w-24 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Alert At</th>
                        <th className="w-24 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Cost/Unit</th>
                        <th className="w-28 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Stock Value</th>
                        <th className="w-24 px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-ink/40">Status</th>
                        <th className="w-24 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Updated</th>
                        <th className="w-60 px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {visible.slice(0, visibleCount).map(i => {
                        const status = getStatus(i);
                        const chip   = STATUS_CHIP[status];
                        const value  = i.currentStock * i.costPerUnit;
                        return (
                          <tr key={i._id} className="border-b border-border bg-canvas hover:bg-mist">
                            <td className="px-4 py-3">
                              <span className="font-medium text-ink">{i.name}</span>
                              <span className="ml-1.5 text-xs text-ink/40">{i.unit}</span>
                            </td>
                            <td className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                              status === 'out_of_stock' ? 'text-red-600' : status === 'low_stock' ? 'text-orange-600' : 'text-ink'
                            }`}>
                              {i.currentStock > 0 ? i.currentStock.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-ink/40 text-xs">
                              {i.lowStockThreshold} {i.unit}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-ink/60 text-xs">
                              {sym}{i.costPerUnit.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-ink/70">
                              {value > 0 ? fmtCur(value) : '—'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.cls}`}>
                                {chip.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-[11px] text-ink/40">
                              {fmtRelDate(i.updatedAt)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => setDrawer({ mode: 'stock-in', ingredient: i })}
                                  className="flex items-center gap-0.5 rounded-lg border border-green-300 bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-100"
                                >
                                  <TrendingUp size={10} />+ In
                                </button>
                                <button
                                  onClick={() => setDrawer({ mode: 'adjust', ingredient: i })}
                                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/50 hover:bg-mist"
                                  title="Adjust stock"
                                >
                                  <SlidersHorizontal size={11} />
                                </button>
                                <button
                                  onClick={() => setDrawer({ mode: 'history', ingredient: i })}
                                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/50 hover:bg-mist"
                                  title="Stock history"
                                >
                                  <History size={11} />
                                </button>
                                <button
                                  onClick={() => setDrawer({ mode: 'form', ingredient: i })}
                                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/50 hover:bg-mist"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => { void handleDelete(i); }}
                                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-red-500 hover:bg-red-50"
                                >
                                  Del
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
        </>
      )}

      {/* ════════════════ WASTE TAB ════════════════ */}
      {tab === 'waste' && (
        <div className="flex-1 overflow-y-auto bg-mist p-5 space-y-5">
          {wasteError && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{wasteError}</div>
          )}

          {wasteLoading ? (
            <div className="flex h-48 items-center justify-center"><Spinner size="lg" /></div>
          ) : (
            <>
              {wasteAnalytics && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Total Loss</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-red-600">{fmtCur(wasteAnalytics.totalLoss)}</p>
                      <p className="mt-0.5 text-xs text-ink/40">{fmtDate(wasteAnalytics.date)}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Total Entries</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{wasteAnalytics.totalEntries}</p>
                      <p className="mt-0.5 text-xs text-ink/40">waste logs</p>
                    </div>
                  </div>

                  {wasteAnalytics.byReason.length > 0 && (
                    <div className="rounded-xl border border-border bg-canvas p-5">
                      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">By Reason</h3>
                      {(() => {
                        const maxLoss = Math.max(...wasteAnalytics.byReason.map(x => x.totalLoss), 1);
                        return (
                          <div className="space-y-3">
                            {wasteAnalytics.byReason.map(r => {
                              const reasonDef = WASTE_REASONS.find(w => w.id === r._id);
                              return (
                                <div key={r._id} className="flex items-center gap-3">
                                  <span className="w-24 shrink-0 text-right text-xs capitalize text-ink/50">
                                    {reasonDef?.label ?? r._id}
                                  </span>
                                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/5">
                                    <div
                                      className={`h-2 rounded-full transition-all duration-300 ${reasonDef?.bgClass ?? 'bg-ink/40'}`}
                                      style={{ width: `${(r.totalLoss / maxLoss) * 100}%` }}
                                    />
                                  </div>
                                  <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">{fmtCur(r.totalLoss)}</span>
                                  <span className="w-10 shrink-0 text-right text-[10px] text-ink/40">{r.count}×</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {wasteAnalytics.topItems.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-border bg-canvas">
                      <div className="border-b border-border px-5 py-3">
                        <h3 className="text-sm font-semibold text-ink">Top Wasted Items</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="bg-mist">
                              <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Item</th>
                              <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Qty Wasted</th>
                              <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Est. Loss</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {wasteAnalytics.topItems.map((item, idx) => (
                              <tr key={idx} className="hover:bg-mist">
                                <td className="px-5 py-2.5 font-medium text-ink">{item.productName}</td>
                                <td className="px-5 py-2.5 text-right tabular-nums text-ink/60">{item.totalQty}</td>
                                <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-red-600">{fmtCur(item.totalLoss)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Waste log entries */}
              <div className="overflow-hidden rounded-xl border border-border bg-canvas">
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <h3 className="text-sm font-semibold text-ink">Waste Log — {fmtDate(wasteDate)}</h3>
                  <span className="text-xs text-ink/40">{wasteLogs.length} entries</span>
                </div>

                {wasteLogs.length === 0 ? (
                  <div className="flex h-32 flex-col items-center justify-center text-ink/40">
                    <Trash2 size={24} className="mb-2 opacity-30" />
                    <p className="text-sm">No waste logged on this date</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-mist">
                          <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Item</th>
                          <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Qty</th>
                          <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Unit</th>
                          <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Reason</th>
                          <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Est. Loss</th>
                          <th className="px-5 py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {wasteLogs.map(log => {
                          const reason = WASTE_REASONS.find(r => r.id === log.reason);
                          return (
                            <tr key={log._id} className="hover:bg-mist">
                              <td className="px-5 py-2.5">
                                <p className="font-medium text-ink">{log.productName}</p>
                                {log.notes && <p className="text-xs text-ink/40">{log.notes}</p>}
                              </td>
                              <td className="px-5 py-2.5 text-right tabular-nums text-ink">{log.quantity}</td>
                              <td className="px-5 py-2.5 text-ink/60">{log.unit}</td>
                              <td className="px-5 py-2.5">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${reason?.badgeClass ?? 'bg-ink/10 text-ink/60'}`}>
                                  {reason?.label ?? log.reason}
                                </span>
                              </td>
                              <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-red-600">
                                {log.estimatedLoss > 0 ? fmtCur(log.estimatedLoss) : '—'}
                              </td>
                              <td className="px-5 py-2.5 text-right">
                                <button
                                  onClick={() => { void handleDeleteWaste(log._id); }}
                                  disabled={wasteDeleting === log._id}
                                  className="text-ink/30 hover:text-red-500 disabled:opacity-40"
                                  title="Delete"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Drawers ── */}
      {drawer?.mode === 'form' && (
        <IngredientDrawer
          ingredient={drawer.ingredient}
          mode="form"
          onSave={onIngredientSaved}
          onClose={() => setDrawer(null)}
        />
      )}

      {drawer?.mode === 'stock-in' && (
        <StockInDrawer
          ingredient={drawer.ingredient}
          onSave={saved => { onIngredientSaved(saved); }}
          onClose={() => setDrawer(null)}
        />
      )}

      {drawer?.mode === 'adjust' && (
        <StockAdjustDrawer
          ingredient={drawer.ingredient}
          onSave={saved => { onIngredientSaved(saved); }}
          onClose={() => setDrawer(null)}
        />
      )}

      {drawer?.mode === 'history' && (
        <StockHistoryDrawer
          ingredient={drawer.ingredient}
          onClose={() => setDrawer(null)}
        />
      )}

      {/* ── Log Waste Modal ── */}
      {showWasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-canvas p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Log Waste</h2>
              <button onClick={() => setShowWasteModal(false)} className="text-ink/40 hover:text-ink text-lg leading-none" aria-label="Close">×</button>
            </div>

            <div className="space-y-4">
              {/* Ingredient selector */}
              <div>
                <label className="mb-1 block text-xs font-medium text-ink/60">Ingredient (optional)</label>
                <select
                  value={wasteForm.ingredientId}
                  onChange={e => handleWasteIngredientChange(e.target.value)}
                  className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                >
                  <option value="">— Free text (no ingredient selected) —</option>
                  {ingredients.map(i => (
                    <option key={i._id} value={i._id}>
                      {i.name} ({i.currentStock} {i.unit})
                    </option>
                  ))}
                </select>
                {wasteForm.ingredientId && (
                  <p className="mt-0.5 text-[11px] text-orange-600">
                    Stock will be deducted from {wasteForm.productName} automatically.
                  </p>
                )}
              </div>

              {/* Product name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-ink/60">
                  {wasteForm.ingredientId ? 'Ingredient Name' : 'Product / Item Name'} *
                </label>
                <input
                  type="text"
                  value={wasteForm.productName}
                  onChange={e => setWasteForm(f => ({ ...f, productName: e.target.value }))}
                  placeholder="e.g. Tomatoes"
                  readOnly={!!wasteForm.ingredientId}
                  className={`w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 ${wasteForm.ingredientId ? 'opacity-60' : ''}`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/60">Quantity *</label>
                  <input
                    type="number" min="0" step="0.001"
                    value={wasteForm.quantity}
                    onChange={e => handleWasteQuantityChange(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/60">Unit</label>
                  <input
                    type="text"
                    value={wasteForm.unit}
                    onChange={e => setWasteForm(f => ({ ...f, unit: e.target.value }))}
                    placeholder="pcs, kg, l…"
                    readOnly={!!wasteForm.ingredientId}
                    className={`w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 ${wasteForm.ingredientId ? 'opacity-60' : ''}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/60">Reason</label>
                  <select
                    value={wasteForm.reason}
                    onChange={e => setWasteForm(f => ({ ...f, reason: e.target.value as WasteReason }))}
                    className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  >
                    {WASTE_REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/60">
                    Est. Loss ({sym})
                    {wasteForm.ingredientId && <span className="ml-1 text-[10px] text-ink/40">auto-computed</span>}
                  </label>
                  <input
                    type="number" min="0" step="0.01"
                    value={wasteForm.estimatedLoss}
                    onChange={e => setWasteForm(f => ({ ...f, estimatedLoss: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-ink/60">Notes</label>
                <input
                  type="text"
                  value={wasteForm.notes}
                  onChange={e => setWasteForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <button
                onClick={() => { setShowWasteModal(false); setWasteForm(emptyWasteForm); }}
                className="flex-1 rounded-lg border border-border py-2 text-sm text-ink/50 hover:bg-mist"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleCreateWaste(); }}
                disabled={wasteSaving || !wasteForm.productName.trim() || !wasteForm.quantity}
                className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
              >
                {wasteSaving ? 'Saving…' : 'Log Waste'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: 'orange' | 'red';
}) {
  const valueClass = accent === 'red' ? 'text-red-600' : accent === 'orange' ? 'text-orange-600' : 'text-ink';
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-[10px] text-ink/30">{sub}</p>
    </div>
  );
}
