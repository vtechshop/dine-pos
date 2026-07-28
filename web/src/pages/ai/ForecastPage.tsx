import { useState, useEffect } from 'react';
import {
  TrendingUp, Package, AlertTriangle, Clock, Sparkles,
  ArrowUp, ArrowDown, Minus,
} from 'lucide-react';
import {
  fetchSalesForecast,
  fetchInventoryForecast,
  type SalesForecast,
  type InventoryForecast,
  type IngredientPrediction,
} from '../../api/aiForecast';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt0(n: number) { return n.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function fmt2(n: number) { return n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function dow(date: string) {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
}

// ── Mini components ───────────────────────────────────────────────────────────

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-canvas p-4 flex flex-col gap-1">
      <span className="text-xs text-ink/50 font-medium uppercase tracking-wide">{label}</span>
      <span className="text-xl font-bold tabular-nums text-brand">{value}</span>
    </div>
  );
}

function Skel() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map(i => <div key={i} className="h-20 animate-pulse rounded bg-border" />)}
      </div>
      <div className="h-48 animate-pulse rounded bg-border" />
      <div className="h-36 animate-pulse rounded bg-border" />
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
      <AlertTriangle size={14} />{msg}
    </div>
  );
}

function SourceBadge({ source }: { source: 'grn' | 'heuristic' }) {
  return source === 'grn'
    ? <span className="px-1.5 py-0.5 text-[10px] bg-green-50 text-green-700 border border-green-200 rounded">GRN data</span>
    : <span className="px-1.5 py-0.5 text-[10px] bg-gray-50 text-gray-500 border border-gray-200 rounded">Estimated</span>;
}

// ── Ingredient table (shared by Critical / Warning / Overstock) ───────────────

function IngTable({ items, rowCls, title }: {
  items: IngredientPrediction[];
  rowCls: string;
  title: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={`rounded-xl border p-4 ${rowCls}`}>
      <h3 className="font-semibold text-sm text-ink mb-3">{title} ({items.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left">
              {['Name', 'Unit', 'Stock', 'Days Left', 'Reorder Qty', 'Est. Cost', 'Source'].map(h => (
                <th key={h} className="py-1.5 pr-3 last:pr-0 text-xs text-ink/50 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.ingredientId} className="border-b border-black/10 last:border-0">
                <td className="py-2 pr-3 font-medium text-ink whitespace-nowrap">{it.name}</td>
                <td className="py-2 pr-3 text-ink/60 text-xs">{it.unit}</td>
                <td className="py-2 pr-3 tabular-nums text-ink/70">{fmt2(it.currentStock)}</td>
                <td className="py-2 pr-3 tabular-nums font-semibold">
                  {it.daysRemaining < 1 ? '<1' : Math.round(it.daysRemaining)}
                </td>
                <td className="py-2 pr-3 tabular-nums">{fmt0(it.reorderQty)}</td>
                <td className="py-2 pr-3 tabular-nums">₹{fmt0(it.reorderCost)}</td>
                <td className="py-2"><SourceBadge source={it.usageSource} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sales tab ─────────────────────────────────────────────────────────────────

function SalesTab({ data }: { data: SalesForecast }) {
  const {
    forecastWeekRevenue, forecastWeekOrders, avgForecastAOV,
    revenueForecastMeta, dataPoints, revenueNext7d,
    itemDemand, topPeakHours, narrative, narrativeSource,
  } = data;

  if (dataPoints < 3) {
    return <p className="text-sm text-ink/50">Need at least 3 days of sales history to generate forecasts.</p>;
  }

  const { method, confidence, mape } = revenueForecastMeta;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPI label="Expected Revenue This Week" value={`₹${fmt0(forecastWeekRevenue)}`} />
        <KPI label="Expected Orders This Week" value={fmt0(forecastWeekOrders)} />
        <KPI label="Avg Expected AOV" value={`₹${fmt2(avgForecastAOV)}`} />
      </div>

      {/* Confidence strip */}
      <div className="rounded-xl border border-border bg-canvas px-4 py-3 text-sm text-ink/60">
        <span className="font-semibold text-ink">{(confidence * 100).toFixed(0)}% confidence</span>
        {' — '}{method} model — {dataPoints} data points
        {mape > 0 && <span className="ml-2 text-ink/40">(MAPE {mape.toFixed(1)}%)</span>}
      </div>

      {/* 7-day revenue table */}
      {revenueNext7d.length > 0 && (
        <div className="rounded-xl border border-border bg-canvas p-4">
          <h3 className="font-semibold text-sm text-ink mb-3">7-Day Revenue Forecast</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-mist rounded-lg text-left">
                  <th className="px-3 py-2 text-xs text-ink/50 font-medium rounded-l-lg">Date</th>
                  <th className="px-3 py-2 text-xs text-ink/50 font-medium">Day</th>
                  <th className="px-3 py-2 text-xs text-ink/50 font-medium text-right rounded-r-lg">Expected Revenue</th>
                </tr>
              </thead>
              <tbody>
                {revenueNext7d.map(pt => (
                  <tr key={pt.date} className="border-b border-border/40 last:border-0 hover:bg-mist/50">
                    <td className="px-3 py-2 text-ink/70 tabular-nums">{pt.date}</td>
                    <td className="px-3 py-2 text-ink/60">{dow(pt.date)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">₹{fmt0(pt.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Item demand */}
      {itemDemand.length > 0 && (
        <div className="rounded-xl border border-border bg-canvas p-4">
          <h3 className="font-semibold text-sm text-ink mb-3">Item Demand Forecast</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-mist rounded-lg text-left">
                  {['Item', 'Trend', 'Forecast Qty', 'Avg Qty (7d)'].map((h, i) => (
                    <th key={h} className={`px-3 py-2 text-xs text-ink/50 font-medium ${i === 0 ? 'rounded-l-lg' : ''} ${i === 3 ? 'rounded-r-lg text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itemDemand.map(it => (
                  <tr key={it.productId} className="border-b border-border/40 last:border-0 hover:bg-mist/50">
                    <td className="px-3 py-2 font-medium text-ink">{it.productName}</td>
                    <td className="px-3 py-2">
                      {it.trend === 'rising'  && <span className="inline-flex items-center gap-1 text-green-600 text-xs"><ArrowUp size={11} />Rising</span>}
                      {it.trend === 'falling' && <span className="inline-flex items-center gap-1 text-red-600 text-xs"><ArrowDown size={11} />Falling</span>}
                      {it.trend === 'stable'  && <span className="inline-flex items-center gap-1 text-ink/40 text-xs"><Minus size={11} />Stable</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-ink">{fmt2(it.forecastQty)}</td>
                    <td className="px-3 py-2 tabular-nums text-ink/60 text-right">{fmt2(it.avgQty7d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Peak hours */}
      {topPeakHours.length > 0 && (
        <div className="rounded-xl border border-border bg-canvas p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-ink/40" />
            <h3 className="font-semibold text-sm text-ink">Peak Hours</h3>
            <span className="text-xs text-ink/40">(hours stored as UTC)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {topPeakHours.map(h => (
              <span key={h} className="px-3 py-1 rounded-full border border-border bg-mist text-sm font-medium text-ink">
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI Narrative */}
      {narrative && narrativeSource !== 'unavailable' ? (
        <div className="rounded-xl border border-brand/15 bg-brand/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-brand" />
            <span className="text-xs font-semibold text-brand uppercase tracking-wide">AI Insights</span>
            {narrativeSource === 'cache' && <span className="text-xs text-ink/40">(cached)</span>}
          </div>
          <p className="text-sm text-ink/80 leading-relaxed">{narrative}</p>
        </div>
      ) : (
        <p className="text-xs text-ink/40 italic">AI narrative unavailable for this forecast.</p>
      )}
    </div>
  );
}

// ── Inventory tab ─────────────────────────────────────────────────────────────

function InventoryTab({ data }: { data: InventoryForecast }) {
  const { coverageSummary, totalReorderCost, criticalItems, warningItems, overstockItems } = data;

  if (data.totalIngredients === 0) {
    return (
      <p className="text-sm text-ink/50">No ingredients found. Add ingredients in inventory management.</p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Coverage pills */}
      <div className="flex flex-wrap gap-2">
        <span className="px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">
          Critical: {coverageSummary.criticalCount}
        </span>
        <span className="px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold">
          Warning: {coverageSummary.warningCount}
        </span>
        <span className="px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-green-700 text-sm font-semibold">
          OK: {coverageSummary.okCount}
        </span>
        <span className="px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-sm font-semibold">
          Overstock: {coverageSummary.overstockCount}
        </span>
      </div>

      {/* Total reorder cost */}
      <div className="rounded-xl border border-border bg-canvas p-4">
        <span className="text-xs text-ink/50 font-medium uppercase tracking-wide block mb-1">
          Total Reorder Cost
        </span>
        <span className="text-2xl font-bold text-brand tabular-nums">₹{fmt0(totalReorderCost)}</span>
      </div>

      <IngTable items={criticalItems}  rowCls="bg-red-50 border-red-200"    title="Critical Items" />
      <IngTable items={warningItems}   rowCls="bg-amber-50 border-amber-200" title="Warning Items" />
      <IngTable items={overstockItems} rowCls="bg-blue-50 border-blue-200"   title="Overstock Items" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'sales' | 'inventory';

export function ForecastPage() {
  const [tab, setTab] = useState<Tab>('sales');

  const [sales,        setSales]        = useState<SalesForecast | null>(null);
  const [inv,          setInv]          = useState<InventoryForecast | null>(null);
  const [salesLoading, setSalesLoading] = useState(true);
  const [invLoading,   setInvLoading]   = useState(true);
  const [salesErr,     setSalesErr]     = useState<string | null>(null);
  const [invErr,       setInvErr]       = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([fetchSalesForecast(), fetchInventoryForecast()]).then(([sr, ir]) => {
      if (sr.status === 'fulfilled') {
        setSales(sr.value);
      } else {
        setSalesErr((sr.reason as Error).message ?? 'Failed to load sales forecast');
      }
      setSalesLoading(false);

      if (ir.status === 'fulfilled') {
        setInv(ir.value);
      } else {
        setInvErr((ir.reason as Error).message ?? 'Failed to load inventory forecast');
      }
      setInvLoading(false);
    });
  }, []);

  const tabCls = (t: Tab) =>
    tab === t
      ? 'border-b-2 border-brand text-brand font-semibold'
      : 'text-ink/50 hover:text-ink';

  const isSalesInsufficient = salesErr?.includes('404') || salesErr?.includes('insufficient') || salesErr?.includes('3 days');
  const isInvEmpty = invErr?.includes('404') || invErr?.includes('No ingredients');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <h1 className="font-bold text-ink">AI Forecast</h1>
        <p className="text-xs text-ink/50 mt-0.5">Predictive analytics for sales and inventory</p>
        {/* Tabs */}
        <div className="flex gap-6 mt-3">
          <button
            onClick={() => setTab('sales')}
            className={`flex items-center gap-1.5 pb-2 text-sm transition-colors ${tabCls('sales')}`}
          >
            <TrendingUp size={14} />Sales Forecast
          </button>
          <button
            onClick={() => setTab('inventory')}
            className={`flex items-center gap-1.5 pb-2 text-sm transition-colors ${tabCls('inventory')}`}
          >
            <Package size={14} />Inventory Forecast
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {tab === 'sales' && (
          <>
            {salesLoading && <Skel />}
            {!salesLoading && salesErr && (
              isSalesInsufficient
                ? <p className="text-sm text-ink/50">Need at least 3 days of sales history to generate forecasts.</p>
                : <ErrBox msg={salesErr} />
            )}
            {!salesLoading && !salesErr && sales && <SalesTab data={sales} />}
          </>
        )}

        {tab === 'inventory' && (
          <>
            {invLoading && <Skel />}
            {!invLoading && invErr && (
              isInvEmpty
                ? <p className="text-sm text-ink/50">No ingredients found. Add ingredients in inventory management.</p>
                : <ErrBox msg={invErr} />
            )}
            {!invLoading && !invErr && inv && <InventoryTab data={inv} />}
          </>
        )}
      </div>
    </div>
  );
}
