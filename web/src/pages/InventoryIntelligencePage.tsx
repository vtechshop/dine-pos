import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trash2, TrendingUp, Tag, Package, Activity, RefreshCw, ShoppingCart,
  Download, AlertTriangle, ArrowUp, ArrowDown, Minus, Search, Filter,
  ChevronLeft, ChevronRight, Utensils, BarChart2, Clock, CheckCircle,
  XCircle, AlertCircle, SlidersHorizontal, History, TrendingDown,
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { fetchIngredients } from '../api/inventory';
import { StockInDrawer }     from '../components/inventory/StockInDrawer';
import { StockAdjustDrawer } from '../components/inventory/StockAdjustDrawer';
import { StockHistoryDrawer } from '../components/inventory/StockHistoryDrawer';
import type { Ingredient } from '../types';
import {
  fetchWasteAnalysis,         fetchCostVariance,
  fetchVendorPriceComparison, fetchInventoryValue,
  fetchStockMovement,         fetchStockTurnover,
  fetchPurchaseIntelligence,  fetchFoodCost,
  fetchMovementsLog,          fetchReorderSuggestions,
  type WasteAnalysis,    type CostVariance,     type VendorPriceRow,
  type InventoryValue,   type StockMovement,    type StockTurnover,
  type PurchaseIntelligence, type FoodCostData, type MovementsLog,
  type ReorderData,
} from '../api/inventoryIntelligence';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt2(n: number) { return n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function fmt0(n: number) { return n.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, accent = false, warn = false, danger = false,
  icon: Icon,
}: {
  label: string; value: string; sub?: string;
  accent?: boolean; warn?: boolean; danger?: boolean;
  icon?: React.ElementType;
}) {
  const border = danger ? 'border-red-200 bg-red-50/60'
    : warn   ? 'border-amber-200 bg-amber-50/60'
    : accent ? 'border-brand/20 bg-brand/5'
    :          'border-border bg-canvas';
  const textColor = danger ? 'text-red-700' : warn ? 'text-amber-700' : accent ? 'text-brand' : 'text-ink';
  return (
    <div className={`rounded-lg border p-3.5 flex flex-col gap-1 ${border}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] text-ink/50 font-semibold uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={13} className="text-ink/30" />}
      </div>
      <span className={`text-xl font-bold tabular-nums leading-tight ${textColor}`}>{value}</span>
      {sub && <span className="text-[11px] text-ink/40">{sub}</span>}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-canvas ${className}`}>{children}</div>;
}

function CardHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/60">{title}</h3>
      {action}
    </div>
  );
}

function HorizBars({ data, sym = '' }: { data: { label: string; value: number }[]; sym?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  if (data.length === 0) return <EmptyState msg="No data for this period" />;
  return (
    <div className="space-y-2 px-4 py-3">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-28 text-xs text-ink/60 truncate shrink-0">{d.label}</span>
          <div className="flex-1 h-4 bg-mist rounded overflow-hidden">
            <div className="h-full bg-brand/60 rounded transition-all" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="text-xs font-semibold tabular-nums text-ink w-20 text-right shrink-0">{sym}{fmt0(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

function VertBars({ data, sym = '', height = 110 }: { data: { label: string; value: number }[]; sym?: string; height?: number }) {
  const max = Math.max(...data.map(d => d.value), 1);
  if (data.length === 0) return <EmptyState msg="No trend data" />;
  return (
    <div className="overflow-x-auto px-4 py-3">
      <div className="flex items-end gap-1 min-w-max" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5" style={{ width: 34 }}>
            <span className="text-[9px] text-ink/40 tabular-nums">
              {sym}{d.value < 1000 ? fmt2(d.value) : `${Math.round(d.value / 1000)}k`}
            </span>
            <div className="w-5 rounded-t bg-brand/60 transition-all" style={{ height: `${Math.max(3, (d.value / max) * (height - 30))}px` }} />
            <span className="text-[8px] text-ink/40 text-center w-8 truncate leading-tight">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ msg, sub, action }: { msg: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
      <Package size={28} className="text-ink/20 mb-2" />
      <p className="text-sm font-medium text-ink/50">{msg}</p>
      {sub && <p className="text-xs text-ink/30 mt-1">{sub}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: 'in-stock' | 'low' | 'out' }) {
  if (status === 'out')  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700"><XCircle size={9}/>Out</span>;
  if (status === 'low')  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700"><AlertCircle size={9}/>Low</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700"><CheckCircle size={9}/>OK</span>;
}

function MovTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sale:          { label: 'Sale',          cls: 'bg-blue-100 text-blue-700' },
    sale_reversal: { label: 'Reversal',      cls: 'bg-purple-100 text-purple-700' },
    stock_in:      { label: 'Stock In',      cls: 'bg-green-100 text-green-700' },
    restock:       { label: 'Restock',       cls: 'bg-green-100 text-green-700' },
    adjustment:    { label: 'Adjustment',    cls: 'bg-amber-100 text-amber-700' },
    waste:         { label: 'Waste',         cls: 'bg-red-100 text-red-700' },
    grn:           { label: 'GRN',           cls: 'bg-teal-100 text-teal-700' },
    opening_stock: { label: 'Opening',       cls: 'bg-slate-100 text-slate-700' },
  };
  const m = map[type] ?? { label: type, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${m.cls}`}>{m.label}</span>;
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  function preset(days: number) {
    const end   = new Date(); end.setHours(23, 59, 59, 999);
    const start = new Date(Date.now() - (days - 1) * 86_400_000);
    onChange(start.toLocaleDateString('en-CA'), end.toLocaleDateString('en-CA'));
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {([['7D', 7], ['30D', 30], ['90D', 90], ['180D', 180]] as [string, number][]).map(([l, d]) => (
        <button key={l} onClick={() => preset(d)}
          className="px-2.5 py-1 text-[11px] font-medium rounded border border-border text-ink/60 hover:bg-mist transition-colors">
          {l}
        </button>
      ))}
      <input type="date" value={from} onChange={e => onChange(e.target.value, to)}
        className="text-[11px] border border-border rounded px-2 py-1 bg-canvas text-ink" />
      <span className="text-xs text-ink/30">–</span>
      <input type="date" value={to} onChange={e => onChange(from, e.target.value)}
        className="text-[11px] border border-border rounded px-2 py-1 bg-canvas text-ink" />
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
      <AlertTriangle size={14} />{msg}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
    </div>
  );
}

function ThTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-mist/50">
            {headers.map((h, i) => (
              <th key={i} className={`py-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-ink/50 ${i > 0 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'consumption' | 'waste' | 'food-cost' | 'cost-variance' | 'vendors' | 'movements' | 'purchases' | 'turnover';

const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
  { key: 'overview',      label: 'Overview',      Icon: BarChart2    },
  { key: 'consumption',   label: 'Consumption',   Icon: Activity     },
  { key: 'waste',         label: 'Waste',         Icon: Trash2       },
  { key: 'food-cost',     label: 'Food Cost',     Icon: Utensils     },
  { key: 'cost-variance', label: 'Cost Variance', Icon: TrendingUp   },
  { key: 'vendors',       label: 'Vendors',       Icon: Tag          },
  { key: 'movements',     label: 'Movements',     Icon: Clock        },
  { key: 'purchases',     label: 'Purchases',     Icon: ShoppingCart },
  { key: 'turnover',      label: 'Turnover',      Icon: RefreshCw    },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function InventoryIntelligencePage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const cur = (n: number) => `${sym}${fmt0(n)}`;

  const [tab, setTab] = useState<Tab>('overview');

  function defaultFrom() {
    const d = new Date(Date.now() - 29 * 86_400_000);
    return d.toLocaleDateString('en-CA');
  }
  function defaultTo() { return new Date().toLocaleDateString('en-CA'); }
  function todayStr()  { return new Date().toLocaleDateString('en-CA'); }

  const [from, setFrom] = useState(defaultFrom);
  const [to,   setTo]   = useState(defaultTo);
  const setRange = (f: string, t: string) => { setFrom(f); setTo(t); };

  // ── Per-tab data ───────────────────────────────────────────────────────────
  const [ingredients,    setIngredients]    = useState<Ingredient[]>([]);
  const [invValue,       setInvValue]       = useState<InventoryValue | null>(null);
  const [todayWaste,     setTodayWaste]     = useState<WasteAnalysis | null>(null);
  const [todayConsump,   setTodayConsump]   = useState<StockMovement | null>(null);
  const [consumptionData,setConsumptionData]= useState<StockMovement | null>(null);
  const [wasteData,      setWasteData]      = useState<WasteAnalysis | null>(null);
  const [foodCostData,   setFoodCostData]   = useState<FoodCostData | null>(null);
  const [costData,       setCostData]       = useState<CostVariance | null>(null);
  const [vendorData,     setVendorData]     = useState<VendorPriceRow[] | null>(null);
  const [movementsData,  setMovementsData]  = useState<MovementsLog | null>(null);
  const [movPage,        setMovPage]        = useState(0);
  const [movTypeFilter,  setMovTypeFilter]  = useState('all');
  const [purchData,      setPurchData]      = useState<PurchaseIntelligence | null>(null);
  const [turnoverData,   setTurnoverData]   = useState<StockTurnover | null>(null);
  const [reorderData,    setReorderData]    = useState<ReorderData | null>(null);

  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  // ── Drawer state (stock actions from Overview) ─────────────────────────────
  const [drawer, setDrawer] = useState<{ type: 'stock-in' | 'adjust' | 'history'; ingredient: Ingredient } | null>(null);

  // ── Search / filter for stock overview ────────────────────────────────────
  const [stockSearch, setStockSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');

  // ── Load data ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const today = todayStr();
    try {
      switch (tab) {
        case 'overview':
          await Promise.all([
            fetchIngredients().then(setIngredients),
            fetchInventoryValue().then(setInvValue),
            fetchWasteAnalysis(today, today).then(setTodayWaste),
            fetchStockMovement(today, today).then(setTodayConsump),
          ]);
          break;
        case 'consumption':
          setConsumptionData(await fetchStockMovement(from, to));
          break;
        case 'waste':
          setWasteData(await fetchWasteAnalysis(from, to));
          break;
        case 'food-cost':
          setFoodCostData(await fetchFoodCost());
          break;
        case 'cost-variance':
          setCostData(await fetchCostVariance());
          break;
        case 'vendors':
          setVendorData(await fetchVendorPriceComparison(from, to));
          break;
        case 'movements':
          setMovPage(0);
          setMovementsData(await fetchMovementsLog(from, to, 50, 0, movTypeFilter));
          break;
        case 'purchases':
          setPurchData(await fetchPurchaseIntelligence(from, to));
          break;
        case 'turnover':
          await Promise.all([
            fetchStockTurnover(from, to).then(setTurnoverData),
            fetchReorderSuggestions().then(setReorderData),
          ]);
          break;
      }
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [tab, from, to, movTypeFilter]);

  useEffect(() => { void load(); }, [load]);

  // Movement pagination
  const loadMovPage = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const data = await fetchMovementsLog(from, to, 50, page * 50, movTypeFilter);
      setMovementsData(data);
      setMovPage(page);
    } catch (e) {
      setErr((e as Error).message ?? 'Failed');
    } finally {
      setLoading(false);
    }
  }, [from, to, movTypeFilter]);

  // Refresh a single ingredient after drawer action
  function refreshIngredient(updated: Ingredient) {
    setIngredients(prev => prev.map(i => i._id === updated._id ? updated : i));
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const todayConsumptionCost = useMemo(() => {
    if (!todayConsump) return 0;
    return [...todayConsump.fastMoving, ...todayConsump.slowMoving]
      .reduce((s, i) => s + i.totalConsumed * i.costPerUnit, 0);
  }, [todayConsump]);

  const stockTableData = useMemo(() => {
    let list = [...ingredients];
    if (stockSearch) {
      const q = stockSearch.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    if (stockFilter === 'low') list = list.filter(i => i.currentStock > 0 && i.currentStock <= i.lowStockThreshold);
    if (stockFilter === 'out') list = list.filter(i => i.currentStock <= 0);
    list.sort((a, b) => {
      const sa = a.currentStock <= 0 ? 0 : a.currentStock <= a.lowStockThreshold ? 1 : 2;
      const sb = b.currentStock <= 0 ? 0 : b.currentStock <= b.lowStockThreshold ? 1 : 2;
      return sa - sb;
    });
    return list;
  }, [ingredients, stockSearch, stockFilter]);

  function ingStatus(i: Ingredient): 'out' | 'low' | 'in-stock' {
    if (i.currentStock <= 0) return 'out';
    if (i.currentStock <= i.lowStockThreshold) return 'low';
    return 'in-stock';
  }

  const needsAttention = useMemo(
    () => ingredients.filter(i => i.currentStock <= i.lowStockThreshold || i.currentStock <= 0)
      .sort((a, b) => a.currentStock - b.currentStock)
      .slice(0, 8),
    [ingredients],
  );

  // ── CSV export ─────────────────────────────────────────────────────────────

  function csvDownload(name: string, rows: string[][]) {
    const blob = new Blob([rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${from}-${to}.csv`;
    a.click();
  }

  function exportCSV() {
    if (tab === 'overview' && ingredients.length) {
      csvDownload('stock-overview', [
        ['Ingredient', 'Unit', 'Current Stock', 'Min Stock', 'Cost/Unit', 'Stock Value', 'Status'],
        ...ingredients.map(i => [i.name, i.unit, String(i.currentStock), String(i.lowStockThreshold), String(i.costPerUnit), String(Math.round(i.currentStock * i.costPerUnit)), ingStatus(i)]),
      ]);
    } else if (tab === 'consumption' && consumptionData) {
      csvDownload('consumption', [
        ['Ingredient', 'Unit', 'Consumed', 'Avg Daily', 'Current Stock', 'Cost/Unit'],
        ...[...consumptionData.fastMoving, ...consumptionData.slowMoving].map(i => [i.name, i.unit, String(i.totalConsumed), String(i.avgDailyConsumption), String(i.currentStock), String(i.costPerUnit)]),
      ]);
    } else if (tab === 'waste' && wasteData) {
      csvDownload('waste', [
        ['Product Name', 'Loss (₹)', 'Qty', 'Count'],
        ...wasteData.topItems.map(i => [i.productName, String(i.totalLoss), String(i.totalQty), String(i.count)]),
      ]);
    } else if (tab === 'food-cost' && foodCostData) {
      csvDownload('food-cost', [
        ['Item', 'Price', 'Recipe Cost', 'Food Cost %', 'Gross Margin', 'Margin %'],
        ...foodCostData.withRecipe.map(i => [i.name, String(i.price), String(i.recipeCost), String(i.foodCostPct), String(i.grossMargin), String(i.marginPct)]),
      ]);
    } else if (tab === 'cost-variance' && costData) {
      csvDownload('cost-variance', [
        ['Ingredient', 'Unit', 'Current WAC', 'Avg Purchase', 'Variance %', 'Trend'],
        ...costData.items.map(i => [i.name, i.unit, String(i.currentCost), String(i.avgPurchaseCost), String(i.variancePct), i.trend]),
      ]);
    } else if (tab === 'purchases' && purchData) {
      csvDownload('purchases', [
        ['Ingredient', 'Unit', 'Total Qty', 'Total Value', 'GRNs', 'Avg Price'],
        ...purchData.topIngredients.map(i => [i.name, i.unit, String(i.totalQty), String(i.totalValue), String(i.grnCount), String(i.avgPrice)]),
      ]);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden bg-mist">
      {/* ── Shell ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Header */}
        <div className="sticky top-0 z-20 bg-mist border-b border-border px-5 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
            <div>
              <h1 className="text-base font-bold text-ink">Stock Intelligence</h1>
              <p className="text-[11px] text-ink/50">
                {from === to
                  ? `${new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                  : `${new Date(from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – ${new Date(to).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                }
              </p>
            </div>
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-canvas border border-border rounded-lg text-ink/70 hover:bg-mist transition-colors">
              <Download size={13}/> Export CSV
            </button>
          </div>

          {/* Date range — hidden for food-cost (static) */}
          {tab !== 'food-cost' && tab !== 'cost-variance' && (
            <DateRange from={from} to={to} onChange={setRange} />
          )}

          {/* Tab bar */}
          <div className="flex gap-1 mt-2.5 overflow-x-auto pb-0.5">
            {TABS.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${
                  tab === key ? 'bg-ink text-white' : 'bg-canvas border border-border text-ink/60 hover:bg-mist'}`}>
                <Icon size={12}/>{label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 md:p-5 space-y-4">

          {err && <Err msg={err} />}

          {/* ── OVERVIEW ──────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <KPICard label="Stock Value"     icon={Package}
                  value={cur(invValue?.summary.currentStockValue ?? 0)}
                  sub={`${invValue?.summary.totalIngredients ?? 0} ingredients`} accent />
                <KPICard label="Low Stock"       icon={AlertCircle}
                  value={String(invValue?.summary.lowStockCount ?? 0)}
                  sub="needs reorder" warn={!!invValue?.summary.lowStockCount} />
                <KPICard label="Out of Stock"    icon={XCircle}
                  value={String(invValue?.summary.outOfStockCount ?? 0)}
                  sub="immediate action" danger={!!invValue?.summary.outOfStockCount} />
                <KPICard label="Today Consumed"  icon={TrendingDown}
                  value={cur(todayConsumptionCost)}
                  sub="recipe deductions" />
                <KPICard label="Today Waste"     icon={Trash2}
                  value={cur(todayWaste?.summary.totalCost ?? 0)}
                  sub={`${todayWaste?.summary.itemCount ?? 0} incidents`}
                  warn={!!todayWaste?.summary.totalCost} />
              </div>

              {loading && <Spinner />}
              {!loading && (
                <div className="grid md:grid-cols-3 gap-4">

                  {/* Needs Attention */}
                  <Card className="md:col-span-1">
                    <CardHead title="Needs Attention"
                      action={needsAttention.length > 0
                        ? <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{needsAttention.length}</span>
                        : null}
                    />
                    {needsAttention.length === 0
                      ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                          <CheckCircle size={24} className="text-green-500 mb-2" />
                          <p className="text-sm font-medium text-ink/60">Inventory looks healthy</p>
                          <p className="text-xs text-ink/30 mt-0.5">No low or out-of-stock items</p>
                        </div>
                      )
                      : (
                        <div className="divide-y divide-border">
                          {needsAttention.map(i => (
                            <div key={i._id} className="flex items-center justify-between px-4 py-2.5 gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-ink truncate">{i.name}</p>
                                <p className="text-[10px] text-ink/40">
                                  {i.currentStock <= 0 ? '0' : fmt2(i.currentStock)} {i.unit} · min {fmt2(i.lowStockThreshold)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <StatusBadge status={ingStatus(i)} />
                                <button
                                  onClick={() => setDrawer({ type: 'stock-in', ingredient: i })}
                                  className="text-[10px] font-semibold px-2 py-0.5 bg-brand/10 text-brand rounded hover:bg-brand/20 transition-colors">
                                  + In
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    }
                  </Card>

                  {/* Stock Overview */}
                  <Card className="md:col-span-2 overflow-hidden">
                    <CardHead title="Stock Overview"
                      action={
                        <div className="flex items-center gap-1.5">
                          <div className="relative">
                            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink/30" />
                            <input
                              type="text" placeholder="Search…" value={stockSearch}
                              onChange={e => setStockSearch(e.target.value)}
                              className="pl-6 pr-2 py-0.5 text-[11px] border border-border rounded bg-mist w-28 focus:outline-none focus:border-brand/40"
                            />
                          </div>
                          <select value={stockFilter} onChange={e => setStockFilter(e.target.value as 'all' | 'low' | 'out')}
                            className="text-[10px] border border-border rounded px-1 py-0.5 bg-mist text-ink/60 focus:outline-none">
                            <option value="all">All</option>
                            <option value="low">Low</option>
                            <option value="out">Out</option>
                          </select>
                        </div>
                      }
                    />
                    {stockTableData.length === 0
                      ? <EmptyState msg="No ingredients found" sub="Try adjusting search or filter" />
                      : (
                        <ThTable headers={['Ingredient', 'Stock', 'Min', 'Cost/Unit', 'Value', 'Status', '']}>
                          {stockTableData.map(i => (
                            <tr key={i._id} className="border-b border-border/40 hover:bg-mist/50 transition-colors">
                              <td className="py-2 px-3 font-medium text-ink text-xs">{i.name} <span className="text-ink/30">{i.unit}</span></td>
                              <td className="py-2 px-3 text-right tabular-nums text-xs">
                                <span className={i.currentStock <= 0 ? 'text-red-600 font-bold' : i.currentStock <= i.lowStockThreshold ? 'text-amber-600 font-semibold' : 'text-ink'}>
                                  {fmt2(i.currentStock)}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/40">{fmt2(i.lowStockThreshold)}</td>
                              <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{sym}{fmt2(i.costPerUnit)}</td>
                              <td className="py-2 px-3 text-right tabular-nums text-xs font-semibold">{sym}{fmt0(i.currentStock * i.costPerUnit)}</td>
                              <td className="py-2 px-3"><StatusBadge status={ingStatus(i)} /></td>
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-1">
                                  <button title="Stock In" onClick={() => setDrawer({ type: 'stock-in', ingredient: i })}
                                    className="p-1 rounded hover:bg-green-100 text-green-700 transition-colors">
                                    <TrendingUp size={11}/>
                                  </button>
                                  <button title="Adjust" onClick={() => setDrawer({ type: 'adjust', ingredient: i })}
                                    className="p-1 rounded hover:bg-amber-100 text-amber-700 transition-colors">
                                    <SlidersHorizontal size={11}/>
                                  </button>
                                  <button title="History" onClick={() => setDrawer({ type: 'history', ingredient: i })}
                                    className="p-1 rounded hover:bg-blue-100 text-blue-700 transition-colors">
                                    <History size={11}/>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </ThTable>
                      )
                    }
                    {!stockSearch && stockFilter === 'all' && ingredients.length > 0 && (
                      <p className="text-[10px] text-ink/30 px-4 py-2 border-t border-border">{ingredients.length} ingredients total</p>
                    )}
                  </Card>
                </div>
              )}
            </>
          )}

          {/* ── CONSUMPTION ───────────────────────────────────────────────── */}
          {tab === 'consumption' && (
            <>
              {loading ? <Spinner /> : consumptionData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <KPICard label="Fast Moving" icon={TrendingUp}
                      value={String(consumptionData.summary.fastMovingCount)} sub="ingredients" accent />
                    <KPICard label="Slow Moving" icon={Minus}
                      value={String(consumptionData.summary.slowMovingCount)} sub="ingredients" />
                    <KPICard label="Dead Stock"  icon={AlertTriangle}
                      value={String(consumptionData.summary.deadStockCount)}  sub="not consumed" warn={!!consumptionData.summary.deadStockCount} />
                    <KPICard label="Dead Value"  icon={Package}
                      value={cur(consumptionData.summary.deadStockValue)} />
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <Card>
                      <CardHead title="Top Consumed (Fast Moving)" />
                      {consumptionData.fastMoving.length === 0
                        ? <EmptyState msg="No consumption data" sub="No orders with recipes in this period" />
                        : <HorizBars data={consumptionData.fastMoving.map(i => ({ label: i.name, value: i.totalConsumed }))} />
                      }
                    </Card>
                    <Card>
                      <CardHead title="Slow Moving" />
                      {consumptionData.slowMoving.length === 0
                        ? <EmptyState msg="No slow-moving items" sub="All consumed items are fast-moving" />
                        : <HorizBars data={consumptionData.slowMoving.map(i => ({ label: i.name, value: i.totalConsumed }))} />
                      }
                    </Card>
                  </div>

                  {[...consumptionData.fastMoving, ...consumptionData.slowMoving].length > 0 && (
                    <Card>
                      <CardHead title="Consumption Detail" />
                      <ThTable headers={['Ingredient', 'Unit', 'Consumed', 'Avg/Day', 'Orders', 'Stock', 'Cost/Unit', 'Cost Impact']}>
                        {[...consumptionData.fastMoving, ...consumptionData.slowMoving].map((i, idx) => (
                          <tr key={idx} className="border-b border-border/40 hover:bg-mist/50">
                            <td className="py-2 px-3 font-medium text-ink text-xs">{i.name}</td>
                            <td className="py-2 px-3 text-right text-xs text-ink/50">{i.unit}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-xs font-semibold">{fmt2(i.totalConsumed)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{fmt2(i.avgDailyConsumption)}</td>
                            <td className="py-2 px-3 text-right text-xs text-ink/50">{i.orderCount}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-xs">{fmt2(i.currentStock)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{sym}{fmt2(i.costPerUnit)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-xs font-semibold text-brand">
                              {sym}{fmt0(i.totalConsumed * i.costPerUnit)}
                            </td>
                          </tr>
                        ))}
                      </ThTable>
                    </Card>
                  )}

                  {consumptionData.deadStock.length > 0 && (
                    <Card>
                      <CardHead title="Dead Stock — In inventory but zero consumption this period" />
                      <ThTable headers={['Ingredient', 'Unit', 'Stock', 'Cost/Unit', 'Idle Value']}>
                        {consumptionData.deadStock.map((i, idx) => (
                          <tr key={idx} className="border-b border-border/40 hover:bg-mist/50">
                            <td className="py-2 px-3 font-medium text-ink text-xs">{i.name}</td>
                            <td className="py-2 px-3 text-right text-xs text-ink/50">{i.unit}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-xs text-amber-600">{fmt2(i.currentStock)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{sym}{fmt2(i.costPerUnit)}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-xs font-semibold">{sym}{fmt0(i.value)}</td>
                          </tr>
                        ))}
                      </ThTable>
                    </Card>
                  )}
                </div>
              ) : null}
            </>
          )}

          {/* ── WASTE ─────────────────────────────────────────────────────── */}
          {tab === 'waste' && (
            <>
              {loading ? <Spinner /> : wasteData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <KPICard label="Total Waste Cost"    icon={Trash2}
                      value={cur(wasteData.summary.totalCost)} accent={wasteData.summary.totalCost > 0} />
                    <KPICard label="Waste % of Revenue"  icon={Activity}
                      value={`${wasteData.summary.wastePct}%`} sub="of gross revenue"
                      warn={wasteData.summary.wastePct > 3} />
                    <KPICard label="Waste Incidents"     icon={AlertTriangle}
                      value={fmt0(wasteData.summary.itemCount)} />
                    <KPICard label="Avg Daily Loss"      icon={TrendingDown}
                      value={cur(wasteData.summary.avgDailyLoss)} />
                  </div>

                  {wasteData.summary.itemCount === 0
                    ? (
                      <Card>
                        <EmptyState
                          msg="No waste recorded for this period"
                          sub="Use the Inventory page to log waste against ingredients."
                        />
                      </Card>
                    )
                    : (
                      <>
                        <div className="grid md:grid-cols-2 gap-4">
                          <Card>
                            <CardHead title="Waste by Reason" />
                            <HorizBars sym={sym} data={wasteData.byReason.map(r => ({ label: r.reason, value: r.totalLoss }))} />
                          </Card>
                          <Card>
                            <CardHead title="Top 10 Wasted Items" />
                            <HorizBars sym={sym} data={wasteData.topItems.map(i => ({ label: i.productName, value: i.totalLoss }))} />
                          </Card>
                        </div>

                        {wasteData.trend.length > 1 && (
                          <Card>
                            <CardHead title="Daily Waste Trend" />
                            <VertBars sym={sym} height={120}
                              data={wasteData.trend.map(t => ({ label: t.date.slice(5), value: t.totalLoss }))} />
                          </Card>
                        )}

                        <Card>
                          <CardHead title="Waste Detail" />
                          <ThTable headers={['Item', 'Loss (₹)', 'Qty', 'Incidents']}>
                            {wasteData.topItems.map((i, idx) => (
                              <tr key={idx} className="border-b border-border/40 hover:bg-mist/50">
                                <td className="py-2 px-3 font-medium text-ink text-xs">{i.productName}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs font-semibold text-red-600">{sym}{fmt0(i.totalLoss)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{fmt2(i.totalQty)}</td>
                                <td className="py-2 px-3 text-right text-xs text-ink/50">{i.count}</td>
                              </tr>
                            ))}
                          </ThTable>
                        </Card>
                      </>
                    )
                  }
                </div>
              ) : null}
            </>
          )}

          {/* ── FOOD COST ─────────────────────────────────────────────────── */}
          {tab === 'food-cost' && (
            <>
              {loading ? <Spinner /> : foodCostData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <KPICard label="Items with Recipe" icon={Utensils}
                      value={String(foodCostData.summary.totalWithRecipe)} sub="food cost computed" accent />
                    <KPICard label="No Recipe"         icon={AlertTriangle}
                      value={String(foodCostData.summary.totalWithoutRecipe)}
                      sub="cost unavailable"
                      warn={foodCostData.summary.totalWithoutRecipe > 0} />
                    <KPICard label="Avg Food Cost %"   icon={BarChart2}
                      value={`${foodCostData.summary.avgFoodCostPct}%`}
                      sub="across all recipes"
                      accent={foodCostData.summary.avgFoodCostPct > 0}
                      warn={foodCostData.summary.avgFoodCostPct > 35} />
                  </div>

                  {foodCostData.withRecipe.length === 0
                    ? (
                      <Card>
                        <EmptyState
                          msg="No recipes configured"
                          sub="Add recipes to menu items in Products to calculate food cost and margins."
                        />
                      </Card>
                    )
                    : (
                      <Card>
                        <CardHead title="Food Cost by Menu Item (based on current ingredient WAC)" />
                        <ThTable headers={['Menu Item', 'Price', 'Recipe Cost', 'Food Cost %', 'Gross Margin', 'Margin %']}>
                          {foodCostData.withRecipe.map((i, idx) => {
                            const fcWarn = i.foodCostPct > 40;
                            const fcOk   = i.foodCostPct <= 30;
                            return (
                              <tr key={idx} className="border-b border-border/40 hover:bg-mist/50">
                                <td className="py-2 px-3 font-medium text-ink text-xs">{i.name}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs">{sym}{fmt2(i.price)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{sym}{fmt2(i.recipeCost)}</td>
                                <td className={`py-2 px-3 text-right tabular-nums text-xs font-bold ${fcWarn ? 'text-red-600' : fcOk ? 'text-green-700' : 'text-amber-600'}`}>
                                  {fmt2(i.foodCostPct)}%
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs font-semibold">{sym}{fmt2(i.grossMargin)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-green-700 font-semibold">
                                  {fmt2(i.marginPct)}%
                                </td>
                              </tr>
                            );
                          })}
                        </ThTable>
                      </Card>
                    )
                  }

                  {foodCostData.withoutRecipe.length > 0 && (
                    <Card>
                      <CardHead title={`Items Without Recipe (${foodCostData.withoutRecipe.length}) — Food cost unavailable`} />
                      <div className="px-4 py-3 flex flex-wrap gap-2">
                        {foodCostData.withoutRecipe.map((i, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-mist border border-border rounded text-xs text-ink/60">
                            {i.name}
                            {i.price > 0 && <span className="text-ink/40">{sym}{i.price}</span>}
                          </span>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              ) : null}
            </>
          )}

          {/* ── COST VARIANCE ─────────────────────────────────────────────── */}
          {tab === 'cost-variance' && (
            <>
              {loading ? <Spinner /> : costData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <KPICard label="Price Increased" icon={ArrowUp}
                      value={String(costData.summary.increased)} sub="vs last purchase"
                      warn={costData.summary.increased > 0} />
                    <KPICard label="Price Decreased" icon={ArrowDown}
                      value={String(costData.summary.decreased)} sub="cheaper recently" accent={costData.summary.decreased > 0} />
                    <KPICard label="Stable"          icon={Minus}
                      value={String(costData.summary.stable)}    sub="within ±3%" />
                  </div>
                  <Card>
                    <CardHead title="Cost Variance — Current WAC vs avg of last 10 purchase prices" />
                    {costData.items.length === 0
                      ? <EmptyState msg="No purchase history" sub="Receive stock via GRN to track cost changes" />
                      : (
                        <ThTable headers={['Ingredient', 'Current WAC', 'Avg Purchase', 'Last Price', 'Variance %', 'Trend', 'Impact']}>
                          {costData.items.map((it, i) => {
                            const impact = Math.abs(it.variancePct) > 15 ? 'High' : Math.abs(it.variancePct) > 5 ? 'Med' : 'Low';
                            const impactCls = impact === 'High' ? 'bg-red-100 text-red-700' : impact === 'Med' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';
                            return (
                              <tr key={i} className="border-b border-border/40 hover:bg-mist/50">
                                <td className="py-2 px-3 font-medium text-ink text-xs">{it.name} <span className="text-ink/30">/{it.unit}</span></td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs">{sym}{fmt2(it.currentCost)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{sym}{fmt2(it.avgPurchaseCost)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{sym}{fmt2(it.lastPrice)}</td>
                                <td className={`py-2 px-3 text-right tabular-nums text-xs font-bold ${it.variancePct > 3 ? 'text-red-600' : it.variancePct < -3 ? 'text-green-700' : 'text-ink/40'}`}>
                                  {it.variancePct > 0 ? '+' : ''}{fmt2(it.variancePct)}%
                                </td>
                                <td className="py-2 px-3 text-xs">
                                  {it.trend === 'increased' && <span className="flex items-center gap-0.5 text-red-600"><ArrowUp size={10}/>Up</span>}
                                  {it.trend === 'decreased' && <span className="flex items-center gap-0.5 text-green-700"><ArrowDown size={10}/>Down</span>}
                                  {it.trend === 'stable'    && <span className="flex items-center gap-0.5 text-ink/40"><Minus size={10}/>Stable</span>}
                                </td>
                                <td className="py-2 px-3">
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${impactCls}`}>{impact}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </ThTable>
                      )
                    }
                  </Card>
                </div>
              ) : null}
            </>
          )}

          {/* ── VENDORS ───────────────────────────────────────────────────── */}
          {tab === 'vendors' && (
            <>
              {loading ? <Spinner /> : vendorData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <KPICard label="Ingredients Tracked" icon={Package}
                      value={fmt0(vendorData.length)} sub="with vendor price history" />
                    <KPICard label="Unique Vendors"      icon={Tag}
                      value={fmt0(new Set(vendorData.flatMap(r => r.vendors.map(v => v.vendorId))).size)} />
                  </div>
                  <Card>
                    <CardHead title="Vendor Price Comparison — cheapest vendor highlighted" />
                    {vendorData.length === 0
                      ? <EmptyState msg="No vendor price data for this period" sub="Receive stock via GRN to build vendor price history" />
                      : (
                        <ThTable headers={['Ingredient', 'Vendor', 'Min Price', 'Max Price', 'Avg Price', 'Last Price', 'Current WAC']}>
                          {vendorData.map((row, ri) =>
                            row.vendors.map((v, vi) => (
                              <tr key={`${ri}-${vi}`}
                                className={`border-b border-border/40 hover:bg-mist/50 ${vi === 0 ? 'bg-green-50/40' : ''}`}>
                                {vi === 0 && (
                                  <td className="py-2 px-3 font-medium text-ink text-xs align-top" rowSpan={row.vendors.length}>
                                    {row.ingredientName} <span className="text-ink/30">/{row.unit}</span>
                                  </td>
                                )}
                                <td className={`py-2 px-3 text-xs ${vi === 0 ? 'font-semibold text-green-700' : 'text-ink/70'}`}>
                                  {v.vendorName || v.vendorCode}
                                  {vi === 0 && <span className="ml-1 text-[9px] text-green-600 font-normal">(best)</span>}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-green-700">{sym}{fmt2(v.minPrice)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-red-600">{sym}{fmt2(v.maxPrice)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs">{sym}{fmt2(v.avgPrice)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{sym}{fmt2(v.lastPrice)}</td>
                                {vi === 0 && (
                                  <td className="py-2 px-3 text-right tabular-nums text-xs font-bold text-brand align-top" rowSpan={row.vendors.length}>
                                    {sym}{fmt2(row.currentWAC)}
                                  </td>
                                )}
                              </tr>
                            ))
                          )}
                        </ThTable>
                      )
                    }
                  </Card>
                </div>
              ) : null}
            </>
          )}

          {/* ── MOVEMENTS ─────────────────────────────────────────────────── */}
          {tab === 'movements' && (
            <>
              {/* Filter bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <Filter size={12} className="text-ink/40" />
                <span className="text-xs text-ink/50 font-medium">Type:</span>
                {(['all', 'sale', 'sale_reversal', 'stock_in', 'waste', 'grn', 'adjustment', 'opening_stock'] as const).map(t => (
                  <button key={t} onClick={() => { setMovTypeFilter(t); }}
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors ${
                      movTypeFilter === t ? 'bg-ink text-white border-ink' : 'bg-canvas border-border text-ink/50 hover:bg-mist'}`}>
                    {t === 'all' ? 'All' : t.replace('_', ' ')}
                  </button>
                ))}
              </div>

              {loading ? <Spinner /> : movementsData ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-ink/50">{movementsData.total} movements in period</p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => void loadMovPage(movPage - 1)} disabled={movPage === 0 || loading}
                        className="p-1.5 rounded border border-border hover:bg-mist disabled:opacity-30 transition-colors">
                        <ChevronLeft size={13}/>
                      </button>
                      <span className="text-xs text-ink/50">
                        {movPage * 50 + 1}–{Math.min((movPage + 1) * 50, movementsData.total)} of {movementsData.total}
                      </span>
                      <button onClick={() => void loadMovPage(movPage + 1)}
                        disabled={(movPage + 1) * 50 >= movementsData.total || loading}
                        className="p-1.5 rounded border border-border hover:bg-mist disabled:opacity-30 transition-colors">
                        <ChevronRight size={13}/>
                      </button>
                    </div>
                  </div>

                  <Card>
                    {movementsData.movements.length === 0
                      ? <EmptyState msg="No stock movements in this period" sub="Movements are recorded when orders are placed, stock is received, or waste is logged." />
                      : (
                        <ThTable headers={['Time', 'Ingredient', 'Type', 'Change', 'Before', 'After', 'Cost', 'Reference']}>
                          {movementsData.movements.map((m, i) => (
                            <tr key={i} className="border-b border-border/40 hover:bg-mist/50">
                              <td className="py-2 px-3 text-[10px] text-ink/40 whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
                              <td className="py-2 px-3 text-xs font-medium text-ink">{m.ingredientName}</td>
                              <td className="py-2 px-3"><MovTypeBadge type={m.type} /></td>
                              <td className={`py-2 px-3 text-right tabular-nums text-xs font-bold ${m.delta >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                                {m.delta >= 0 ? '+' : ''}{fmt2(m.delta)}
                              </td>
                              <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/40">{fmt2(m.previousStock)}</td>
                              <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/70">{fmt2(m.resultingStock)}</td>
                              <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/50">
                                {m.totalCost != null ? `${sym}${fmt0(m.totalCost)}` : m.costPerUnit != null ? `${sym}${fmt2(m.costPerUnit)}/u` : '—'}
                              </td>
                              <td className="py-2 px-3 text-[10px] text-ink/40 max-w-[100px] truncate" title={m.reason || m.referenceId}>
                                {m.reason || m.referenceType || '—'}
                              </td>
                            </tr>
                          ))}
                        </ThTable>
                      )
                    }
                  </Card>
                </div>
              ) : null}
            </>
          )}

          {/* ── PURCHASES ─────────────────────────────────────────────────── */}
          {tab === 'purchases' && (
            <>
              {loading ? <Spinner /> : purchData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <KPICard label="Total Spend"        icon={ShoppingCart}
                      value={cur(purchData.summary.totalSpend)} accent />
                    <KPICard label="GRNs Received"      icon={Package}
                      value={fmt0(purchData.summary.totalGRNs)} />
                    <KPICard label="Vendors"            icon={Tag}
                      value={fmt0(purchData.summary.uniqueVendors)} />
                    <KPICard label="Ingredients Bought" icon={Utensils}
                      value={fmt0(purchData.summary.uniqueIngredients)} />
                  </div>

                  {purchData.summary.totalGRNs === 0
                    ? (
                      <Card>
                        <EmptyState msg="No purchases in this period" sub="GRN receipts will appear here once stock is received against purchase orders." />
                      </Card>
                    )
                    : (
                      <>
                        <div className="grid md:grid-cols-2 gap-4">
                          <Card>
                            <CardHead title="Top Ingredients by Spend" />
                            <HorizBars sym={sym} data={purchData.topIngredients.map(i => ({ label: i.name, value: i.totalValue }))} />
                          </Card>
                          <Card>
                            <CardHead title="Vendor Contribution" />
                            <div className="px-4 py-3 space-y-2">
                              {purchData.vendorContribution.map((v, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm">
                                  <span className="w-28 text-xs text-ink/60 truncate shrink-0">{v.vendorName || v.vendorCode}</span>
                                  <div className="flex-1 h-4 bg-mist rounded overflow-hidden">
                                    <div className="h-full bg-brand/60 rounded" style={{ width: `${v.pct}%` }} />
                                  </div>
                                  <span className="text-xs font-semibold text-ink tabular-nums w-12 text-right">{v.pct}%</span>
                                  <span className="text-[10px] text-ink/40 w-20 text-right tabular-nums">{sym}{fmt0(v.totalSpend)}</span>
                                </div>
                              ))}
                            </div>
                          </Card>
                        </div>

                        {purchData.monthlySpend.length > 1 && (
                          <Card>
                            <CardHead title="Monthly Spend" />
                            <VertBars sym={sym} height={130}
                              data={purchData.monthlySpend.map(m => ({ label: m._id.slice(5), value: m.totalSpend }))} />
                          </Card>
                        )}

                        <Card>
                          <CardHead title="Purchase Detail by Ingredient" />
                          <ThTable headers={['Ingredient', 'Unit', 'Total Qty', 'Avg Price', 'Total Value', 'GRNs']}>
                            {purchData.topIngredients.map((it, i) => (
                              <tr key={i} className="border-b border-border/40 hover:bg-mist/50">
                                <td className="py-2 px-3 font-medium text-ink text-xs">{it.name}</td>
                                <td className="py-2 px-3 text-right text-xs text-ink/50">{it.unit}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs">{fmt2(it.totalQty)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">{sym}{fmt2(it.avgPrice)}</td>
                                <td className="py-2 px-3 text-right tabular-nums text-xs font-semibold">{sym}{fmt0(it.totalValue)}</td>
                                <td className="py-2 px-3 text-right text-xs text-ink/50">{it.grnCount}</td>
                              </tr>
                            ))}
                          </ThTable>
                        </Card>
                      </>
                    )
                  }
                </div>
              ) : null}
            </>
          )}

          {/* ── TURNOVER + REORDER ────────────────────────────────────────── */}
          {tab === 'turnover' && (
            <>
              {loading ? <Spinner /> : (
                <div className="space-y-4">
                  {turnoverData && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <KPICard label="Turnover Ratio"    icon={RefreshCw}
                          value={`${fmt2(turnoverData.turnoverRatio)}×`} sub="annualized" accent />
                        <KPICard label="Days of Inventory" icon={Clock}
                          value={`${fmt0(turnoverData.daysOfInventory)} days`} sub="at current rate"
                          warn={turnoverData.daysOfInventory > 30} />
                        <KPICard label="COGS This Period"  icon={TrendingDown}
                          value={cur(turnoverData.cogs)} sub={`${turnoverData.period.days} days`} />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <KPICard label="Inventory Value"   icon={Package}  value={cur(turnoverData.inventoryValue)} />
                        <KPICard label="Annualized COGS"   icon={Activity} value={cur(turnoverData.annualCOGS)} />
                        <KPICard label="Avg Daily COGS"    icon={BarChart2} value={cur(turnoverData.avgDailyCOGS)} />
                      </div>
                      <Card className="px-4 py-3">
                        <p className="text-xs text-ink/60">
                          Turnover ratio <strong className="text-ink">{fmt2(turnoverData.turnoverRatio)}×</strong> — inventory is consumed and replenished {fmt2(turnoverData.turnoverRatio)} times/year.
                          At current consumption, stock lasts <strong className="text-ink">{fmt0(turnoverData.daysOfInventory)} days</strong>.
                        </p>
                        <p className="text-[10px] text-ink/30 mt-1">
                          Formula: annualized COGS ÷ current inventory value. Inventory is a current snapshot (no historical balance tracking).
                        </p>
                      </Card>
                    </>
                  )}

                  {/* Reorder Intelligence */}
                  <Card>
                    <CardHead title="Reorder Intelligence — based on 30-day consumption average"
                      action={reorderData && <span className="text-[10px] text-ink/40">{reorderData.summary.totalItems} items</span>}
                    />
                    {!reorderData ? <Spinner /> : reorderData.suggestions.length === 0
                      ? (
                        <EmptyState
                          msg="No reorder needed right now"
                          sub="Items appear here when stock falls below threshold or days of stock ≤ 7 days. Requires 30 days of order history."
                        />
                      )
                      : (
                        <>
                          <div className="grid grid-cols-3 gap-3 px-4 pt-3">
                            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-center">
                              <p className="text-lg font-bold text-red-700">{reorderData.summary.criticalItems}</p>
                              <p className="text-[10px] text-red-600 font-medium">Critical</p>
                            </div>
                            <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-center">
                              <p className="text-lg font-bold text-amber-700">{reorderData.summary.totalItems - reorderData.summary.criticalItems}</p>
                              <p className="text-[10px] text-amber-600 font-medium">Reorder Soon</p>
                            </div>
                            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-center">
                              <p className="text-lg font-bold text-blue-700">{sym}{fmt0(reorderData.summary.estimatedTotal)}</p>
                              <p className="text-[10px] text-blue-600 font-medium">Est. Purchase Cost</p>
                            </div>
                          </div>
                          <div className="mt-3">
                            <ThTable headers={['Ingredient', 'Current', 'Min', 'Avg/Day', 'Days Left', 'Suggested Buy', 'Est. Cost', 'Status']}>
                              {reorderData.suggestions.map((s, i) => {
                                const isCritical = s.currentStock <= 0 || (s.daysOfStock !== null && s.daysOfStock <= 2);
                                return (
                                  <tr key={i} className={`border-b border-border/40 hover:bg-mist/50 ${isCritical ? 'bg-red-50/30' : ''}`}>
                                    <td className="py-2 px-3 font-medium text-ink text-xs">{s.name}</td>
                                    <td className="py-2 px-3 text-right tabular-nums text-xs">
                                      <span className={isCritical ? 'text-red-600 font-bold' : 'text-amber-600 font-semibold'}>
                                        {fmt2(s.currentStock)} {s.unit}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/40">{fmt2(s.lowStockThreshold)}</td>
                                    <td className="py-2 px-3 text-right tabular-nums text-xs text-ink/60">
                                      {s.avgDailyConsumption > 0 ? `${fmt2(s.avgDailyConsumption)}/day` : '—'}
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums text-xs">
                                      {s.daysOfStock === null ? <span className="text-ink/30">—</span>
                                        : <span className={s.daysOfStock <= 2 ? 'text-red-600 font-bold' : s.daysOfStock <= 7 ? 'text-amber-600 font-semibold' : 'text-ink'}>
                                          {s.daysOfStock}d
                                        </span>
                                      }
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums text-xs font-semibold">
                                      {s.suggestedQty > 0 ? `${fmt2(s.suggestedQty)} ${s.unit}` : '—'}
                                    </td>
                                    <td className="py-2 px-3 text-right tabular-nums text-xs text-brand font-semibold">
                                      {s.estimatedCost > 0 ? `${sym}${fmt0(s.estimatedCost)}` : '—'}
                                    </td>
                                    <td className="py-2 px-3">
                                      {isCritical
                                        ? <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">Critical</span>
                                        : <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">Reorder</span>
                                      }
                                    </td>
                                  </tr>
                                );
                              })}
                            </ThTable>
                          </div>
                        </>
                      )
                    }
                  </Card>
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* ── Drawers ────────────────────────────────────────────────────────── */}
      {drawer?.type === 'stock-in' && (
        <StockInDrawer
          ingredient={drawer.ingredient}
          onSave={updated => { refreshIngredient(updated); setDrawer(null); }}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer?.type === 'adjust' && (
        <StockAdjustDrawer
          ingredient={drawer.ingredient}
          onSave={updated => { refreshIngredient(updated); setDrawer(null); }}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer?.type === 'history' && (
        <StockHistoryDrawer
          ingredient={drawer.ingredient}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
