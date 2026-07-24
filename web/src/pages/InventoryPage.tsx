import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Plus, RefreshCw, Search, AlertTriangle, Package, Trash2 } from 'lucide-react';
import type { Ingredient, WasteLog, WasteAnalytics } from '../types';
import {
  fetchIngredients,
  fetchLowStockIngredients,
  deleteIngredient,
} from '../api/products';
import { fetchWasteLogs, fetchWasteAnalytics, createWasteLog, deleteWasteLog } from '../api/waste';
import { IngredientDrawer } from '../components/products/IngredientDrawer';
import { Spinner } from '../components/ui/Spinner';
import { useShortcut } from '../hooks/useShortcut';
import { useSettings } from '../context/SettingsContext';

type DrawerState =
  | { mode: 'form'; ingredient: Ingredient | null }
  | { mode: 'restock'; ingredient: Ingredient }
  | null;

type InventoryTab = 'ingredients' | 'waste';

const WASTE_REASONS: Array<{ id: WasteLog['reason']; label: string; color: string }> = [
  { id: 'expired',    label: 'Expired',    color: '#C62828' },
  { id: 'damaged',    label: 'Damaged',    color: '#E65100' },
  { id: 'overcooked', label: 'Overcooked', color: '#F57F17' },
  { id: 'returned',   label: 'Returned',   color: '#1565C0' },
  { id: 'other',      label: 'Other',      color: '#616161' },
];

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA');
}

function fmtDisplayDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function InventoryPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const fmtCur = (n: number) => `${sym}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  // ── Tab ─────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<InventoryTab>('ingredients');

  // ── Ingredients state ──────────────────────────────────────────────────────
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [lowStock, setLowStock]       = useState<Ingredient[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [drawer, setDrawer]           = useState<DrawerState>(null);
  const searchRef                     = useRef<HTMLInputElement>(null);

  // ── Waste state ─────────────────────────────────────────────────────────────
  const [wasteDate, setWasteDate]           = useState(todayStr);
  const [wasteLogs, setWasteLogs]           = useState<WasteLog[]>([]);
  const [wasteAnalytics, setWasteAnalytics] = useState<WasteAnalytics | null>(null);
  const [wasteLoading, setWasteLoading]     = useState(false);
  const [wasteError, setWasteError]         = useState<string | null>(null);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [wasteSaving, setWasteSaving]       = useState(false);
  const [wasteDeleting, setWasteDeleting]   = useState<string | null>(null);

  const emptyWasteForm = {
    productName:   '',
    quantity:      '',
    unit:          'pcs',
    reason:        'expired' as WasteLog['reason'],
    estimatedLoss: '',
    notes:         '',
  };
  const [wasteForm, setWasteForm] = useState(emptyWasteForm);

  // ── Ingredients load ───────────────────────────────────────────────────────
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

  async function refreshLowStock() {
    try {
      const { ingredients: low } = await fetchLowStockIngredients();
      setLowStock(low);
    } catch { /* silent */ }
  }

  // ── Waste load ─────────────────────────────────────────────────────────────
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useShortcut('F1', () => searchRef.current?.focus(), drawer === null && tab === 'ingredients');
  useShortcut('F2', () => setDrawer({ mode: 'form', ingredient: null }), drawer === null && tab === 'ingredients');

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

  // ── Waste create ───────────────────────────────────────────────────────────
  async function handleCreateWaste() {
    if (!wasteForm.productName.trim() || !wasteForm.quantity) return;
    setWasteSaving(true);
    try {
      await createWasteLog({
        productName:   wasteForm.productName.trim(),
        quantity:      parseFloat(wasteForm.quantity),
        unit:          wasteForm.unit || 'pcs',
        reason:        wasteForm.reason,
        estimatedLoss: wasteForm.estimatedLoss ? parseFloat(wasteForm.estimatedLoss) : 0,
        date:          wasteDate,
        notes:         wasteForm.notes.trim(),
      });
      setShowWasteModal(false);
      setWasteForm(emptyWasteForm);
      await loadWaste(wasteDate);
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

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-canvas">
        {/* Title + controls row */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-ink">Inventory</h1>
            {tab === 'ingredients' && lowStock.length > 0 && !loading && (
              <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-600">
                <AlertTriangle size={11} />
                {lowStock.length} low stock
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
                tab === t
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink/40 hover:text-ink'
              }`}
            >
              {t === 'ingredients' ? (
                <><Package size={11} />Ingredients</>
              ) : (
                <><Trash2 size={11} />Waste Log</>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════ INGREDIENTS TAB ════════════════ */}
      {tab === 'ingredients' && (
        <>
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
        </>
      )}

      {/* ════════════════ WASTE TAB ════════════════ */}
      {tab === 'waste' && (
        <div className="flex-1 overflow-y-auto bg-mist p-5 space-y-5">
          {wasteError && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {wasteError}
            </div>
          )}

          {wasteLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : (
            <>
              {wasteAnalytics && (
                <>
                  {/* KPI row */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Total Loss</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-red-600">
                        {fmtCur(wasteAnalytics.totalLoss)}
                      </p>
                      <p className="mt-0.5 text-xs text-ink/40">{fmtDisplayDate(wasteAnalytics.date)}</p>
                    </div>
                    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Total Entries</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
                        {wasteAnalytics.totalEntries}
                      </p>
                      <p className="mt-0.5 text-xs text-ink/40">waste logs</p>
                    </div>
                  </div>

                  {/* Reason breakdown */}
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
                                      className="h-2 rounded-full transition-all duration-300"
                                      style={{
                                        width: `${(r.totalLoss / maxLoss) * 100}%`,
                                        background: reasonDef?.color ?? '#616161',
                                      }}
                                    />
                                  </div>
                                  <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">
                                    {fmtCur(r.totalLoss)}
                                  </span>
                                  <span className="w-10 shrink-0 text-right text-[10px] text-ink/40">
                                    {r.count}×
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Top wasted items */}
                  {wasteAnalytics.topItems.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-border bg-canvas">
                      <div className="border-b border-border px-5 py-3">
                        <h3 className="text-sm font-semibold text-ink">Top Wasted Items</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="bg-mist">
                              <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Product</th>
                              <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Qty Wasted</th>
                              <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Est. Loss</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {wasteAnalytics.topItems.map((item, idx) => (
                              <tr key={idx} className="hover:bg-mist">
                                <td className="px-5 py-2.5 font-medium text-ink">{item.productName}</td>
                                <td className="px-5 py-2.5 text-right tabular-nums text-ink/60">{item.totalQty}</td>
                                <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-red-600">
                                  {fmtCur(item.totalLoss)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Waste log entries table */}
              <div className="overflow-hidden rounded-xl border border-border bg-canvas">
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <h3 className="text-sm font-semibold text-ink">
                    Waste Log — {fmtDisplayDate(wasteDate)}
                  </h3>
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
                          <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Product</th>
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
                                <span
                                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                                  style={{
                                    background: (reason?.color ?? '#616161') + '20',
                                    color: reason?.color ?? '#616161',
                                  }}
                                >
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
                                  title="Delete waste entry"
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

      {/* ── IngredientDrawer ── */}
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

      {/* ── Log Waste Modal ── */}
      {showWasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-canvas p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Log Waste</h2>
              <button
                onClick={() => setShowWasteModal(false)}
                className="text-ink/40 hover:text-ink text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink/60">Product Name *</label>
                <input
                  type="text"
                  value={wasteForm.productName}
                  onChange={e => setWasteForm(f => ({ ...f, productName: e.target.value }))}
                  placeholder="e.g. Tomatoes"
                  className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/60">Quantity *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={wasteForm.quantity}
                    onChange={e => setWasteForm(f => ({ ...f, quantity: e.target.value }))}
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
                    className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/60">Reason</label>
                  <select
                    value={wasteForm.reason}
                    onChange={e => setWasteForm(f => ({ ...f, reason: e.target.value as WasteLog['reason'] }))}
                    className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  >
                    {WASTE_REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink/60">Est. Loss ({sym})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
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
                onClick={() => setShowWasteModal(false)}
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
