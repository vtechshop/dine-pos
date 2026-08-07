import { useState, useEffect, useCallback } from 'react';
import {
  Trash2, TrendingUp, Tag, Package, Activity, RefreshCw, ShoppingCart,
  Download, AlertTriangle, ArrowUp, ArrowDown, Minus,
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import {
  fetchWasteAnalysis,  fetchCostVariance,        fetchVendorPriceComparison,
  fetchInventoryValue, fetchStockMovement,        fetchStockTurnover,
  fetchPurchaseIntelligence,
  type WasteAnalysis,  type CostVariance,         type VendorPriceRow,
  type InventoryValue, type StockMovement,        type StockTurnover,
  type PurchaseIntelligence,
} from '../api/inventoryIntelligence';

// ── Local UI helpers ───────────────────────────────────────────────────────────

function fmt2(n: number) { return n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function fmt0(n: number) { return n.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }

function KPICard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 ${accent ? 'border-brand/30 bg-brand/5' : 'border-border bg-white'}`}>
      <span className="text-xs text-ink/50 font-medium uppercase tracking-wide">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${accent ? 'text-brand' : 'text-ink'}`}>{value}</span>
      {sub && <span className="text-xs text-ink/40">{sub}</span>}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-white p-4 ${className}`}>{children}</div>;
}

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-semibold text-ink text-sm">{title}</h3>
      {action}
    </div>
  );
}

function HorizBars({ data, sym = '' }: { data: { label: string; value: number }[]; sym?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-32 text-xs text-ink/60 truncate flex-shrink-0">{d.label}</span>
          <div className="flex-1 h-5 bg-mist rounded overflow-hidden">
            <div className="h-full bg-brand/70 rounded transition-all" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="text-xs font-medium text-ink tabular-nums w-20 text-right">{sym}{fmt0(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

function VertBars({ data, sym = '', height = 100 }: { data: { label: string; value: number }[]; sym?: string; height?: number }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 min-w-max" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-1" style={{ width: 36 }}>
            <span className="text-[9px] text-ink/50 tabular-nums">{sym}{d.value < 1000 ? fmt2(d.value) : `${Math.round(d.value / 1000)}k`}</span>
            <div className="w-6 rounded-t bg-brand/70 transition-all" style={{ height: `${Math.max(2, (d.value / max) * (height - 28))}px` }} />
            <span className="text-[8px] text-ink/50 text-center w-9 truncate leading-tight">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  function preset(days: number) {
    const end   = new Date(); end.setHours(23, 59, 59, 999);
    const start = new Date(Date.now() - (days - 1) * 86_400_000);
    onChange(start.toLocaleDateString('en-CA'), end.toLocaleDateString('en-CA'));
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[['7D',7],['30D',30],['90D',90],['180D',180]] .map(([l, d]) => (
        <button key={l} onClick={() => preset(Number(d))}
          className="px-3 py-1 text-xs rounded-full border border-border text-ink/60 hover:bg-mist transition-colors">
          {l}
        </button>
      ))}
      <input type="date" value={from} onChange={e => onChange(e.target.value, to)}
        className="text-xs border border-border rounded-lg px-2 py-1 bg-white text-ink" />
      <span className="text-xs text-ink/40">–</span>
      <input type="date" value={to} onChange={e => onChange(from, e.target.value)}
        className="text-xs border border-border rounded-lg px-2 py-1 bg-white text-ink" />
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"><AlertTriangle size={14}/>{msg}</div>;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = 'waste' | 'cost-variance' | 'vendor-prices' | 'stock-value' | 'stock-movement' | 'turnover' | 'purchases';

const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
  { key: 'waste',         label: 'Waste Cost',      Icon: Trash2     },
  { key: 'cost-variance', label: 'Cost Variance',   Icon: TrendingUp  },
  { key: 'vendor-prices', label: 'Vendor Prices',   Icon: Tag         },
  { key: 'stock-value',   label: 'Stock Value',     Icon: Package     },
  { key: 'stock-movement',label: 'Stock Movement',  Icon: Activity    },
  { key: 'turnover',      label: 'Turnover',        Icon: RefreshCw   },
  { key: 'purchases',     label: 'Purchases',       Icon: ShoppingCart},
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function InventoryIntelligencePage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const cur = (n: number) => `${sym}${fmt0(n)}`;

  const [tab, setTab] = useState<Tab>('waste');

  // Shared date range (used by all tabs that accept it)
  function defaultFrom() {
    const d = new Date(Date.now() - 29 * 86_400_000);
    return d.toLocaleDateString('en-CA');
  }
  function defaultTo() { return new Date().toLocaleDateString('en-CA'); }

  const [from, setFrom] = useState(defaultFrom);
  const [to,   setTo]   = useState(defaultTo);

  const setRange = (f: string, t: string) => { setFrom(f); setTo(t); };

  // ── State per tab ──────────────────────────────────────────────────────────

  const [wasteData,    setWasteData]    = useState<WasteAnalysis      | null>(null);
  const [costData,     setCostData]     = useState<CostVariance       | null>(null);
  const [vendorData,   setVendorData]   = useState<VendorPriceRow[]   | null>(null);
  const [stockValData, setStockValData] = useState<InventoryValue     | null>(null);
  const [stockMovData, setStockMovData] = useState<StockMovement      | null>(null);
  const [turnoverData, setTurnoverData] = useState<StockTurnover      | null>(null);
  const [purchData,    setPurchData]    = useState<PurchaseIntelligence | null>(null);

  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      switch (tab) {
        case 'waste':          setWasteData(await fetchWasteAnalysis(from, to));          break;
        case 'cost-variance':  setCostData(await fetchCostVariance());                    break;
        case 'vendor-prices':  setVendorData(await fetchVendorPriceComparison(from, to)); break;
        case 'stock-value':    setStockValData(await fetchInventoryValue());              break;
        case 'stock-movement': setStockMovData(await fetchStockMovement(from, to));       break;
        case 'turnover':       setTurnoverData(await fetchStockTurnover(from, to));       break;
        case 'purchases':      setPurchData(await fetchPurchaseIntelligence(from, to));   break;
      }
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [tab, from, to]);

  useEffect(() => { load(); }, [load]);

  // ── CSV exports ────────────────────────────────────────────────────────────

  function csvDownload(name: string, rows: string[][]) {
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${name}-${from}-${to}.csv`; a.click();
  }

  function exportCSV() {
    if (tab === 'waste' && wasteData) {
      csvDownload('waste-analysis', [
        ['Product Name','Loss (₹)','Qty','Count'],
        ...wasteData.topItems.map(i => [i.productName, String(i.totalLoss), String(i.totalQty), String(i.count)]),
      ]);
    } else if (tab === 'cost-variance' && costData) {
      csvDownload('cost-variance', [
        ['Ingredient','Unit','Current WAC','Avg Purchase Price','Last Price','Variance','Variance %','Trend'],
        ...costData.items.map(i => [i.name, i.unit, String(i.currentCost), String(i.avgPurchaseCost), String(i.lastPrice), String(i.variance), String(i.variancePct), i.trend]),
      ]);
    } else if (tab === 'vendor-prices' && vendorData) {
      const rows: string[][] = [['Ingredient','Unit','Current WAC','Vendor','Min Price','Max Price','Avg Price','Last Price','Count']];
      vendorData.forEach(r => r.vendors.forEach(v => rows.push([r.ingredientName, r.unit, String(r.currentWAC), v.vendorName ?? v.vendorCode, String(v.minPrice), String(v.maxPrice), String(v.avgPrice), String(v.lastPrice), String(v.purchaseCount)])));
      csvDownload('vendor-prices', rows);
    } else if (tab === 'stock-value' && stockValData) {
      csvDownload('stock-value', [
        ['Ingredient','Unit','Stock','Cost/Unit','Value'],
        ...stockValData.topByValue.map(i => [i.name, i.unit, String(i.currentStock), String(i.costPerUnit), String(i.value)]),
      ]);
    } else if (tab === 'stock-movement' && stockMovData) {
      const rows: string[][] = [['Ingredient','Unit','Classification','Total Consumed','Avg Daily','Current Stock','Value']];
      stockMovData.fastMoving.forEach(i => rows.push([i.name, i.unit, 'Fast', String(i.totalConsumed), String(i.avgDailyConsumption), String(i.currentStock), String(i.value)]));
      stockMovData.slowMoving.forEach(i => rows.push([i.name, i.unit, 'Slow', String(i.totalConsumed), String(i.avgDailyConsumption), String(i.currentStock), String(i.value)]));
      stockMovData.deadStock.forEach( i => rows.push([i.name, i.unit, 'Dead', '0', '0', String(i.currentStock), String(i.value)]));
      csvDownload('stock-movement', rows);
    } else if (tab === 'purchases' && purchData) {
      csvDownload('purchase-intelligence', [
        ['Ingredient','Unit','Total Qty','Total Value','GRN Count','Avg Price'],
        ...purchData.topIngredients.map(i => [i.name, i.unit, String(i.totalQty), String(i.totalValue), String(i.grnCount), String(i.avgPrice)]),
      ]);
    }
  }

  const needsDate = tab !== 'cost-variance' && tab !== 'stock-value';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
    <div className="flex-1 overflow-y-auto bg-mist p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">Inventory Intelligence</h1>
          <p className="text-sm text-ink/50 mt-0.5">Waste, costs, vendor prices and stock analytics</p>
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-border rounded-xl text-ink hover:bg-mist transition-colors">
          <Download size={14}/> Export CSV
        </button>
      </div>

      {/* Date range */}
      {needsDate && (
        <div className="mb-4">
          <DateRange from={from} to={to} onChange={setRange} />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              tab === key ? 'bg-brand text-white' : 'bg-white border border-border text-ink/70 hover:bg-mist'}`}>
            <Icon size={14}/>{label}
          </button>
        ))}
      </div>

      {/* Error */}
      {err && <Err msg={err} />}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-border/40 rounded-xl" />)}
        </div>
      )}

      {/* ── Waste Cost ──────────────────────────────────────────────────── */}
      {!loading && tab === 'waste' && wasteData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Total Waste Cost"  value={cur(wasteData.summary.totalCost)} accent />
            <KPICard label="Waste % of Revenue" value={`${wasteData.summary.wastePct}%`} sub="of gross revenue" />
            <KPICard label="Waste Incidents"   value={fmt0(wasteData.summary.itemCount)} />
            <KPICard label="Avg Daily Loss"    value={cur(wasteData.summary.avgDailyLoss)} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <SectionHead title="Waste by Reason" />
              <HorizBars sym={sym} data={wasteData.byReason.map(r => ({ label: r.reason, value: r.totalLoss }))} />
            </Card>
            <Card>
              <SectionHead title="Top 10 Wasted Items" />
              <HorizBars sym={sym} data={wasteData.topItems.map(i => ({ label: i.productName, value: i.totalLoss }))} />
            </Card>
          </div>

          {wasteData.trend.length > 0 && (
            <Card>
              <SectionHead title="Daily Waste Trend" />
              <VertBars sym={sym} height={140}
                data={wasteData.trend.map(t => ({
                  label: t.date.slice(5),
                  value: t.totalLoss,
                }))}
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Cost Variance ────────────────────────────────────────────────── */}
      {!loading && tab === 'cost-variance' && costData && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <KPICard label="Price Increased"  value={String(costData.summary.increased)} sub="ingredients" accent />
            <KPICard label="Price Decreased"  value={String(costData.summary.decreased)} sub="ingredients" />
            <KPICard label="Stable Price"     value={String(costData.summary.stable)}    sub="ingredients" />
          </div>
          <Card>
            <SectionHead title="Ingredient Cost Variance (current WAC vs recent avg purchase price)" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium">Ingredient</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Current WAC</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Avg Purchase</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Last Price</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Variance %</th>
                    <th className="py-2 text-xs text-ink/50 font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {costData.items.map((it, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-mist/50 transition-colors">
                      <td className="py-2 pr-3 font-medium text-ink">{it.name} <span className="text-ink/40 text-xs">/{it.unit}</span></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{sym}{fmt2(it.currentCost)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink/60">{sym}{fmt2(it.avgPurchaseCost)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink/60">{sym}{fmt2(it.lastPrice)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${it.variancePct > 3 ? 'text-red-600' : it.variancePct < -3 ? 'text-green-700' : 'text-ink/50'}`}>
                        {it.variancePct > 0 ? '+' : ''}{fmt2(it.variancePct)}%
                      </td>
                      <td className="py-2">
                        {it.trend === 'increased' && <span className="flex items-center gap-1 text-red-600 text-xs"><ArrowUp size={11}/>Up</span>}
                        {it.trend === 'decreased' && <span className="flex items-center gap-1 text-green-700 text-xs"><ArrowDown size={11}/>Down</span>}
                        {it.trend === 'stable'    && <span className="flex items-center gap-1 text-ink/40 text-xs"><Minus size={11}/>Stable</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── Vendor Prices ────────────────────────────────────────────────── */}
      {!loading && tab === 'vendor-prices' && vendorData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KPICard label="Ingredients Tracked" value={fmt0(vendorData.length)} />
            <KPICard label="Unique Vendors" value={fmt0(new Set(vendorData.flatMap(r => r.vendors.map(v => v.vendorId))).size)} />
          </div>
          <Card>
            <SectionHead title="Vendor Price Comparison (ranked cheapest → priciest per ingredient)" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium">Ingredient</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium">Vendor</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Min</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Max</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Avg</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Last</th>
                    <th className="py-2 text-xs text-ink/50 font-medium text-right">Current WAC</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorData.map((row, ri) =>
                    row.vendors.map((v, vi) => (
                      <tr key={`${ri}-${vi}`} className={`border-b border-border/50 hover:bg-mist/50 transition-colors ${vi === 0 ? 'bg-green-50/50' : ''}`}>
                        {vi === 0 && (
                          <td className="py-2 pr-3 font-medium text-ink align-top" rowSpan={row.vendors.length}>
                            {row.ingredientName} <span className="text-ink/40 text-xs">/{row.unit}</span>
                          </td>
                        )}
                        <td className="py-2 pr-3 text-ink/70">{v.vendorName || v.vendorCode}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-green-700">{sym}{fmt2(v.minPrice)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-red-600">{sym}{fmt2(v.maxPrice)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{sym}{fmt2(v.avgPrice)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink/60">{sym}{fmt2(v.lastPrice)}</td>
                        {vi === 0 && (
                          <td className="py-2 text-right tabular-nums font-semibold text-brand align-top" rowSpan={row.vendors.length}>
                            {sym}{fmt2(row.currentWAC)}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── Stock Value ──────────────────────────────────────────────────── */}
      {!loading && tab === 'stock-value' && stockValData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KPICard label="Total Stock Value"   value={cur(stockValData.summary.currentStockValue)} accent />
            <KPICard label="Low Stock Items"     value={fmt0(stockValData.summary.lowStockCount)}    sub={`${cur(stockValData.summary.lowStockValue)} at risk`} />
            <KPICard label="Out of Stock"        value={fmt0(stockValData.summary.outOfStockCount)}  sub="zero stock" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <SectionHead title="Top 20 by Value" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-2 text-xs text-ink/50 font-medium text-left">Ingredient</th>
                      <th className="py-1.5 pr-2 text-xs text-ink/50 font-medium text-right">Stock</th>
                      <th className="py-1.5 pr-2 text-xs text-ink/50 font-medium text-right">Cost/Unit</th>
                      <th className="py-1.5 text-xs text-ink/50 font-medium text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockValData.topByValue.map((it, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-mist/50">
                        <td className="py-1.5 pr-2 font-medium text-ink">{it.name} <span className="text-ink/40 text-xs">{it.unit}</span></td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink/60">{fmt2(it.currentStock)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink/60">{sym}{fmt2(it.costPerUnit)}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{sym}{fmt0(it.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="space-y-4">
              {stockValData.lowStockItems.length > 0 && (
                <Card>
                  <SectionHead title={`Low Stock (${stockValData.lowStockItems.length})`} />
                  <div className="space-y-2">
                    {stockValData.lowStockItems.map((it, i) => (
                      <div key={i} className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
                        <div>
                          <span className="text-sm font-medium text-ink">{it.name}</span>
                          <span className="text-xs text-ink/40 ml-1">{it.unit}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm text-orange-600 font-semibold">{fmt2(it.currentStock)}</span>
                          <span className="text-xs text-ink/40">/{fmt2(it.lowStockThreshold)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {stockValData.outOfStockItems.length > 0 && (
                <Card>
                  <SectionHead title={`Out of Stock (${stockValData.outOfStockItems.length})`} />
                  <div className="space-y-1">
                    {stockValData.outOfStockItems.map((it, i) => (
                      <div key={i} className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
                        <span className="text-sm font-medium text-ink">{it.name}</span>
                        <span className="text-xs text-red-600 font-semibold">0 {it.unit}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Stock Movement ───────────────────────────────────────────────── */}
      {!loading && tab === 'stock-movement' && stockMovData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Fast Moving"   value={fmt0(stockMovData.summary.fastMovingCount)} sub="ingredients" accent />
            <KPICard label="Slow Moving"   value={fmt0(stockMovData.summary.slowMovingCount)} sub="ingredients" />
            <KPICard label="Dead Stock"    value={fmt0(stockMovData.summary.deadStockCount)}  sub="ingredients" />
            <KPICard label="Dead Stock Value" value={cur(stockMovData.summary.deadStockValue)} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <SectionHead title="Fast Moving Ingredients" />
              <HorizBars data={stockMovData.fastMoving.map(i => ({ label: i.name, value: i.totalConsumed }))} />
            </Card>
            <Card>
              <SectionHead title="Slow Moving Ingredients" />
              {stockMovData.slowMoving.length === 0
                ? <p className="text-sm text-ink/40">None in this period</p>
                : <HorizBars data={stockMovData.slowMoving.map(i => ({ label: i.name, value: i.totalConsumed }))} />
              }
            </Card>
          </div>

          {stockMovData.deadStock.length > 0 && (
            <Card>
              <SectionHead title="Dead Stock (in inventory but 0 consumption this period)" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-2 text-xs text-ink/50 font-medium text-left">Ingredient</th>
                      <th className="py-1.5 pr-2 text-xs text-ink/50 font-medium text-right">Stock</th>
                      <th className="py-1.5 pr-2 text-xs text-ink/50 font-medium text-right">Cost/Unit</th>
                      <th className="py-1.5 text-xs text-ink/50 font-medium text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockMovData.deadStock.map((it, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-mist/50">
                        <td className="py-1.5 pr-2 font-medium text-ink">{it.name} <span className="text-ink/40 text-xs">{it.unit}</span></td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-orange-600">{fmt2(it.currentStock)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-ink/60">{sym}{fmt2(it.costPerUnit)}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{sym}{fmt0(it.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Turnover ─────────────────────────────────────────────────────── */}
      {!loading && tab === 'turnover' && turnoverData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KPICard label="Stock Turnover Ratio" value={`${fmt2(turnoverData.turnoverRatio)}×`} sub="annualized" accent />
            <KPICard label="Days of Inventory"    value={`${fmt0(turnoverData.daysOfInventory)} days`} sub="at current consumption rate" />
            <KPICard label="COGS This Period"     value={cur(turnoverData.cogs)} sub={`${turnoverData.period.days} days`} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KPICard label="Current Inventory Value" value={cur(turnoverData.inventoryValue)} />
            <KPICard label="Annualized COGS"         value={cur(turnoverData.annualCOGS)} />
            <KPICard label="Avg Daily COGS"          value={cur(turnoverData.avgDailyCOGS)} />
          </div>
          <Card>
            <p className="text-sm text-ink/60">
              A turnover ratio of <strong className="text-ink">{fmt2(turnoverData.turnoverRatio)}×</strong> means inventory is consumed and replenished&nbsp;
              {fmt2(turnoverData.turnoverRatio)} times per year.
              At the current consumption rate, current stock will last&nbsp;
              <strong className="text-ink">{fmt0(turnoverData.daysOfInventory)} days</strong>.
            </p>
            <p className="text-xs text-ink/40 mt-2">Formula: annualized COGS ÷ current inventory value. Inventory approximated as current snapshot (no historical balance tracking).</p>
          </Card>
        </div>
      )}

      {/* ── Purchase Intelligence ─────────────────────────────────────────── */}
      {!loading && tab === 'purchases' && purchData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Total Spend"         value={cur(purchData.summary.totalSpend)} accent />
            <KPICard label="GRNs Received"       value={fmt0(purchData.summary.totalGRNs)} />
            <KPICard label="Unique Vendors"      value={fmt0(purchData.summary.uniqueVendors)} />
            <KPICard label="Ingredients Bought"  value={fmt0(purchData.summary.uniqueIngredients)} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <SectionHead title="Top Ingredients by Spend" />
              <HorizBars sym={sym} data={purchData.topIngredients.map(i => ({ label: i.name, value: i.totalValue }))} />
            </Card>
            <Card>
              <SectionHead title="Vendor Contribution" />
              <div className="space-y-2">
                {purchData.vendorContribution.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-28 text-xs text-ink/60 truncate flex-shrink-0">{v.vendorName || v.vendorCode}</span>
                    <div className="flex-1 h-5 bg-mist rounded overflow-hidden">
                      <div className="h-full bg-brand/70 rounded" style={{ width: `${v.pct}%` }} />
                    </div>
                    <span className="text-xs font-medium text-ink tabular-nums w-16 text-right">{v.pct}%</span>
                    <span className="text-xs text-ink/40 w-20 text-right tabular-nums">{sym}{fmt0(v.totalSpend)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {purchData.monthlySpend.length > 0 && (
            <Card>
              <SectionHead title="Monthly Spend Trend" />
              <VertBars sym={sym} height={140}
                data={purchData.monthlySpend.map(m => ({ label: m._id.slice(5), value: m.totalSpend }))}
              />
            </Card>
          )}

          <Card>
            <SectionHead title="Top Ingredients Detail" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium">Ingredient</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Total Qty</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Avg Price</th>
                    <th className="py-2 pr-3 text-xs text-ink/50 font-medium text-right">Total Value</th>
                    <th className="py-2 text-xs text-ink/50 font-medium text-right">GRNs</th>
                  </tr>
                </thead>
                <tbody>
                  {purchData.topIngredients.map((it, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-mist/50">
                      <td className="py-2 pr-3 font-medium text-ink">{it.name} <span className="text-ink/40 text-xs">/{it.unit}</span></td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink/60">{fmt2(it.totalQty)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink/60">{sym}{fmt2(it.avgPrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">{sym}{fmt0(it.totalValue)}</td>
                      <td className="py-2 text-right tabular-nums text-ink/50">{it.grnCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
    </div>
  );
}
