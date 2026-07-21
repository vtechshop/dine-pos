import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart2,
  Package,
  FileText,
  TrendingDown,
  Download,
  Printer,
  RefreshCw,
} from 'lucide-react';
import type {
  SalesReport,
  ProductSalesReport,
  GSTReport,
  ExpensePnL,
  HourlyBucket,
  DatePreset,
} from '../types/reports';
import {
  fetchSalesReport,
  fetchProductSalesReport,
  fetchGSTReport,
  fetchTallyReport,
  fetchGSTR1JSON,
  fetchExpensePnL,
  fetchOrdersForHourly,
} from '../api/reports';
import { ApiError } from '../api/client';
import { Spinner } from '../components/ui/Spinner';
import { useSettings } from '../context/SettingsContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'products' | 'gst' | 'expenses';

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA');
}

function getRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toLocaleDateString('en-CA');

  switch (preset) {
    case 'today':
      return { from: todayStr(), to: todayStr() };

    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y) };
    }

    case 'week': {
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      return { from: fmt(mon), to: todayStr() };
    }

    case 'last_week': {
      const day = now.getDay();
      const thisMon = new Date(now);
      thisMon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      const lastMon = new Date(thisMon);
      lastMon.setDate(thisMon.getDate() - 7);
      const lastSun = new Date(thisMon);
      lastSun.setDate(thisMon.getDate() - 1);
      return { from: fmt(lastMon), to: fmt(lastSun) };
    }

    case 'month': {
      const mon = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(mon), to: todayStr() };
    }

    case 'last_month': {
      const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastOfLast  = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(firstOfLast), to: fmt(lastOfLast) };
    }

    case 'custom':
      return { from: customFrom, to: customTo };
  }
}

function fmtDisplayDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000,
  );
}

// ── Export helpers ────────────────────────────────────────────────────────────

function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number)[][][],
): void {
  const all = [headers, ...rows.flat()];
  const content = all
    .map(row =>
      row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Inline chart components ───────────────────────────────────────────────────

function fmtCur(value: number, sym: string): string {
  return `${sym}${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function KPICard({
  label, value, sub, accent = false,
}: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-brand' : 'text-ink'}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

function HorizBars({
  data,
  sym,
}: {
  data: Array<{ label: string; value: number; sub?: string }>;
  sym: string;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="space-y-3">
      {data
        .filter(d => d.value > 0)
        .map(d => (
          <div key={d.label} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-right text-xs capitalize text-ink/50">
              {d.label}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/5">
              <div
                className="h-2 rounded-full bg-brand transition-all duration-300"
                style={{ width: `${(d.value / max) * 100}%` }}
              />
            </div>
            <span className="w-28 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">
              {fmtCur(d.value, sym)}
            </span>
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-ink/40">
              {total > 0 ? `${Math.round((d.value / total) * 100)}%` : '—'}
            </span>
          </div>
        ))}
    </div>
  );
}

function VertBars({
  data,
  sym,
  height = 120,
}: {
  data: Array<{ label: string; value: number }>;
  sym?: string;
  height?: number;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-px overflow-hidden" style={{ height }}>
      {data.map((d, i) => {
        const pct = Math.max((d.value / max) * 85, d.value > 0 ? 3 : 0);
        return (
          <div
            key={i}
            className="group relative flex flex-1 flex-col items-center justify-end"
            style={{ height: '100%' }}
            title={`${d.label}: ${sym ?? ''}${d.value.toLocaleString('en-IN')}`}
          >
            <div
              className="w-full rounded-sm bg-brand/70 transition-all group-hover:bg-brand"
              style={{ height: `${pct}%`, minHeight: d.value > 0 ? 3 : 0 }}
            />
            <span className="mt-1 block w-full truncate text-center text-[8px] text-ink/40">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/40">
        {title}
      </h3>
      {action}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-canvas p-5 ${className}`}>
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const { settings }   = useSettings();
  const sym            = settings?.currencySymbol ?? '₹';

  // ── Tabs & date range ───────────────────────────────────────────────────────

  const [tab, setTab]               = useState<Tab>('overview');
  const [preset, setPreset]         = useState<DatePreset>('today');
  const [customFrom, setCustomFrom] = useState(todayStr);
  const [customTo, setCustomTo]     = useState(todayStr);

  // Products and expenses use their own per-tab date (single day)
  const [productDate, setProductDate] = useState(todayStr);
  const [expenseDate, setExpenseDate] = useState(todayStr);

  const { from, to } = useMemo(
    () => getRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );
  const isSingleDay = from === to;
  const days        = daysBetween(from, to);

  // ── Overview state ──────────────────────────────────────────────────────────

  const [sales, setSales]               = useState<SalesReport | null>(null);
  const [hourly, setHourly]             = useState<HourlyBucket[]>([]);
  const [overviewLoading, setOvLoading] = useState(false);
  const [overviewError, setOvError]     = useState<string | null>(null);

  // ── Products state ──────────────────────────────────────────────────────────

  const [products, setProducts]         = useState<ProductSalesReport | null>(null);
  const [prodLoading, setProdLoading]   = useState(false);
  const [prodError, setProdError]       = useState<string | null>(null);

  // ── GST state ───────────────────────────────────────────────────────────────

  const [gst, setGst]                   = useState<GSTReport | null>(null);
  const [gstLoading, setGstLoading]     = useState(false);
  const [gstError, setGstError]         = useState<string | null>(null);
  const [exportingTally, setExpTally]   = useState(false);
  const [exportingGSTR, setExpGSTR]     = useState(false);

  // ── Expenses state ──────────────────────────────────────────────────────────

  const [pnl, setPnl]                   = useState<ExpensePnL | null>(null);
  const [pnlLoading, setPnlLoading]     = useState(false);
  const [pnlError, setPnlError]         = useState<string | null>(null);
  const [expFeature, setExpFeature]     = useState(true);

  // ── Load overview ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (tab !== 'overview') return;
    let cancelled = false;
    setOvLoading(true);
    setOvError(null);

    void (async () => {
      try {
        const [salesData, ordersForHourly] = await Promise.all([
          fetchSalesReport(from, to),
          isSingleDay
            ? fetchOrdersForHourly(from)
            : Promise.resolve({ orders: [] as Array<{ grandTotal: number; createdAt: string }> }),
        ]);

        if (cancelled) return;
        setSales(salesData);

        if (isSingleDay) {
          const buckets: HourlyBucket[] = Array.from({ length: 24 }, (_, h) => ({
            hour: h,
            orders: 0,
            revenue: 0,
          }));
          for (const o of ordersForHourly.orders) {
            const h = new Date(o.createdAt).getHours();
            buckets[h].orders++;
            buckets[h].revenue += o.grandTotal;
          }
          setHourly(buckets);
        } else {
          setHourly([]);
        }
      } catch (e) {
        if (!cancelled)
          setOvError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setOvLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tab, from, to, isSingleDay]);

  // ── Load products ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (tab !== 'products') return;
    let cancelled = false;
    setProdLoading(true);
    setProdError(null);

    void (async () => {
      try {
        const data = await fetchProductSalesReport(productDate);
        if (!cancelled) setProducts(data);
      } catch (e) {
        if (!cancelled) setProdError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setProdLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tab, productDate]);

  // ── Load GST ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (tab !== 'gst') return;
    let cancelled = false;
    setGstLoading(true);
    setGstError(null);

    void (async () => {
      try {
        const data = await fetchGSTReport(from, to);
        if (!cancelled) setGst(data);
      } catch (e) {
        if (!cancelled) setGstError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setGstLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tab, from, to]);

  // ── Load expenses ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (tab !== 'expenses') return;
    let cancelled = false;
    setPnlLoading(true);
    setPnlError(null);

    void (async () => {
      try {
        const data = await fetchExpensePnL(expenseDate);
        if (!cancelled) setPnl(data);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          if (!cancelled) setExpFeature(false);
        } else if (!cancelled) {
          setPnlError(e instanceof Error ? e.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setPnlLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tab, expenseDate]);

  // ── CSV exports ─────────────────────────────────────────────────────────────

  const exportSalesCSV = useCallback(() => {
    if (!sales) return;
    const pb = sales.paymentBreakdown;
    downloadCSV(`sales-${from}-${to}.csv`, [
      'Period', 'Sales', 'Orders', 'Tax', 'Discount',
      'Cash', 'UPI', 'Card', 'Split', 'Parcel Orders', 'Parcel Revenue',
    ], [[
      [isSingleDay ? from : `${from} to ${to}`,
       sales.totalSales, sales.totalOrders, sales.totalTax, sales.totalDiscount,
       pb.cash, pb.upi, pb.card, pb.split,
       sales.parcelOrders, sales.parcelRevenue],
    ]]);
  }, [sales, from, to, isSingleDay]);

  const exportProductsCSV = useCallback(() => {
    if (!products) return;
    downloadCSV(`products-${productDate}.csv`,
      ['Product', 'Quantity', 'Revenue'],
      [products.products.map(p => [p.productName, p.totalQuantity, p.totalRevenue])],
    );
  }, [products, productDate]);

  const exportGSTCSV = useCallback(() => {
    if (!gst) return;
    downloadCSV(`gst-${from}-${to}.csv`,
      ['Tax %', 'Taxable Value', 'CGST', 'SGST', 'Total Tax', 'Total Value', 'Items'],
      [[
        ...gst.rows.map(r => [r.taxPercent, r.taxableValue, r.cgst, r.sgst, r.totalTax, r.totalValue, r.totalItems]),
        ['TOTAL', gst.totalTaxableValue, gst.totalCGST, gst.totalSGST, gst.totalTax, gst.totalValue, ''],
      ]],
    );
  }, [gst, from, to]);

  const exportTallyCSV = useCallback(async () => {
    setExpTally(true);
    try {
      const data = await fetchTallyReport(from, to);
      downloadCSV(`tally-${from}-${to}.csv`,
        ['Date', 'Voucher No', 'Party', 'Payment Mode', 'Subtotal', 'CGST', 'SGST', 'Discount', 'Grand Total', 'Narration'],
        [data.rows.map(r => [r.date, r.voucherNo, r.party, r.paymentMode, r.subtotal, r.cgst, r.sgst, r.discount, r.grandTotal, r.narration])],
      );
    } catch { /* silent */ } finally { setExpTally(false); }
  }, [from, to]);

  const exportGSTR1 = useCallback(async () => {
    setExpGSTR(true);
    try {
      const data = await fetchGSTR1JSON(from, to);
      downloadJSON(`gstr1-${from}-${to}.json`, data);
    } catch { /* silent */ } finally { setExpGSTR(false); }
  }, [from, to]);

  const exportExpensesCSV = useCallback(() => {
    if (!pnl) return;
    downloadCSV(`expenses-${expenseDate}.csv`,
      ['Category', 'Count', 'Total Amount'],
      [pnl.breakdown.map(b => [b._id, b.count, b.total])],
    );
  }, [pnl, expenseDate]);

  // ── Current tab CSV handler ─────────────────────────────────────────────────

  const handleCSV = () => {
    if (tab === 'overview')  exportSalesCSV();
    if (tab === 'products')  exportProductsCSV();
    if (tab === 'gst')       exportGSTCSV();
    if (tab === 'expenses')  exportExpensesCSV();
  };

  // ── Hourly chart data (trim to 7–22) ────────────────────────────────────────

  const hourlyChartData = useMemo(() => {
    if (!isSingleDay || hourly.length === 0) return [];
    return hourly
      .slice(7, 23)
      .map(b => ({ label: `${b.hour > 12 ? b.hour - 12 : b.hour}${b.hour >= 12 ? 'p' : 'a'}`, value: b.revenue }));
  }, [hourly, isSingleDay]);

  // ── Tabs config ─────────────────────────────────────────────────────────────

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'overview',  label: 'Overview',  icon: <BarChart2 size={12} />  },
    { id: 'products',  label: 'Products',  icon: <Package size={12} />    },
    { id: 'gst',       label: 'GST / Tax', icon: <FileText size={12} />   },
    { id: 'expenses',  label: 'Expenses',  icon: <TrendingDown size={12} /> },
  ];

  const PRESETS: Array<{ id: DatePreset; label: string }> = [
    { id: 'today',     label: 'Today'      },
    { id: 'yesterday', label: 'Yesterday'  },
    { id: 'week',      label: 'This Week'  },
    { id: 'last_week', label: 'Last Week'  },
    { id: 'month',     label: 'This Month' },
    { id: 'last_month',label: 'Last Month' },
    { id: 'custom',    label: 'Custom'     },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* ── Top bar ── */}
      <div className="shrink-0 border-b border-border bg-canvas">
        {/* Tab row + actions */}
        <div className="flex items-center border-b border-border px-5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink/40 hover:text-ink'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2 py-2">
            <button
              onClick={handleCSV}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink"
            >
              <Download size={12} />
              CSV
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink"
            >
              <Printer size={12} />
              Print / PDF
            </button>
          </div>
        </div>

        {/* Date range bar — shown for overview and gst tabs */}
        {(tab === 'overview' || tab === 'gst') && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  preset === p.id
                    ? 'bg-brand text-white'
                    : 'bg-ink/5 text-ink/50 hover:bg-ink/10'
                }`}
              >
                {p.label}
              </button>
            ))}
            {preset === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="h-7 rounded-lg border border-border bg-mist px-2 text-xs text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                />
                <span className="text-xs text-ink/30">—</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  onChange={e => setCustomTo(e.target.value)}
                  className="h-7 rounded-lg border border-border bg-mist px-2 text-xs text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                />
              </div>
            )}
            {preset !== 'custom' && (
              <span className="ml-2 text-xs text-ink/30">
                {isSingleDay
                  ? fmtDisplayDate(from)
                  : `${fmtDisplayDate(from)} – ${fmtDisplayDate(to)} (${days + 1}d)`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto bg-mist">

        {/* ════════════════ OVERVIEW TAB ════════════════ */}
        {tab === 'overview' && (
          <div className="p-5 space-y-5">
            {overviewError && (
              <div className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
                {overviewError}
              </div>
            )}

            {overviewLoading ? (
              <div className="flex items-center justify-center py-20">
                <Spinner size="lg" />
              </div>
            ) : sales ? (
              <>
                {/* KPI row */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <KPICard
                    label="Total Sales"
                    value={fmtCur(sales.totalSales, sym)}
                    sub={`${sales.totalOrders} orders`}
                    accent
                  />
                  <KPICard
                    label="Tax Collected"
                    value={fmtCur(sales.totalTax, sym)}
                    sub="GST total"
                  />
                  <KPICard
                    label="Discounts"
                    value={fmtCur(sales.totalDiscount, sym)}
                    sub="Total given"
                  />
                  <KPICard
                    label="Avg Order"
                    value={
                      sales.totalOrders > 0
                        ? fmtCur(Math.round(sales.totalSales / sales.totalOrders), sym)
                        : `${sym}0`
                    }
                    sub={`${sales.parcelOrders} parcels`}
                  />
                </div>

                {/* Payment breakdown + Source breakdown */}
                <div className="grid gap-5 lg:grid-cols-2">
                  <Card>
                    <SectionHead title="Payment Breakdown" />
                    <HorizBars
                      sym={sym}
                      data={[
                        { label: 'Cash',  value: sales.paymentBreakdown.cash  },
                        { label: 'UPI',   value: sales.paymentBreakdown.upi   },
                        { label: 'Card',  value: sales.paymentBreakdown.card  },
                        { label: 'Split', value: sales.paymentBreakdown.split },
                      ]}
                    />
                  </Card>

                  <Card>
                    <SectionHead title="Order Source" />
                    <HorizBars
                      sym={sym}
                      data={Object.entries(sales.sourceBreakdown)
                        .map(([key, val]) => ({
                          label: key === 'dine-in' ? 'Dine-In' : key,
                          value: typeof val === 'object' ? val.revenue : (val as number),
                        }))
                        .filter(d => d.value > 0)
                        .sort((a, b) => b.value - a.value)}
                    />
                  </Card>
                </div>

                {/* Hourly chart — single day only */}
                {isSingleDay && hourlyChartData.length > 0 && (
                  <Card>
                    <SectionHead title="Hourly Sales (7 am – 10 pm)" />
                    <VertBars data={hourlyChartData} sym={sym} height={140} />
                  </Card>
                )}

                {/* Parcel summary */}
                {sales.parcelOrders > 0 && (
                  <Card>
                    <SectionHead title="Parcel Orders" />
                    <div className="flex gap-8">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-ink/40">Orders</p>
                        <p className="mt-0.5 text-xl font-bold tabular-nums text-ink">
                          {sales.parcelOrders}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-ink/40">Revenue</p>
                        <p className="mt-0.5 text-xl font-bold tabular-nums text-ink">
                          {fmtCur(sales.parcelRevenue, sym)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-ink/40">% of Total</p>
                        <p className="mt-0.5 text-xl font-bold tabular-nums text-ink">
                          {sales.totalSales > 0
                            ? `${Math.round((sales.parcelRevenue / sales.totalSales) * 100)}%`
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* ════════════════ PRODUCTS TAB ════════════════ */}
        {tab === 'products' && (
          <div className="p-5 space-y-5">
            {/* Date picker */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink/50">Date</span>
              <input
                type="date"
                value={productDate}
                onChange={e => setProductDate(e.target.value)}
                className="h-8 rounded-lg border border-border bg-canvas px-3 text-xs text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
              />
              <button
                onClick={() => setProductDate(todayStr())}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5"
              >
                Today
              </button>
              {prodLoading && <Spinner size="sm" />}
            </div>

            {prodError && (
              <div className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
                {prodError}
              </div>
            )}

            {prodLoading && !products ? (
              <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
            ) : products ? (
              <>
                {/* Mini bar chart of top 10 */}
                {products.products.length > 0 && (
                  <Card>
                    <SectionHead title="Top 10 by Revenue" />
                    <VertBars
                      height={140}
                      sym={sym}
                      data={products.products.slice(0, 10).map(p => ({
                        label: p.productName.split(' ')[0] ?? p.productName,
                        value: p.totalRevenue,
                      }))}
                    />
                  </Card>
                )}

                {/* Full table */}
                <Card className="overflow-hidden !p-0">
                  <div className="flex items-center justify-between border-b border-border px-5 py-3">
                    <h3 className="text-sm font-semibold text-ink">
                      Top Products — {fmtDisplayDate(productDate)}
                    </h3>
                    <span className="text-xs text-ink/40">
                      {products.products.length} items
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-mist">
                          <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">#</th>
                          <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Product</th>
                          <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Qty</th>
                          <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Revenue</th>
                          <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">% Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {products.products.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-5 py-8 text-center text-xs text-ink/30">
                              No orders on this date
                            </td>
                          </tr>
                        ) : (() => {
                          const totalRevenue = products.products.reduce((s, p) => s + p.totalRevenue, 0);
                          return products.products.map((p, i) => (
                            <tr key={p.productName} className="hover:bg-mist">
                              <td className="px-5 py-2.5 text-xs tabular-nums text-ink/30">{i + 1}</td>
                              <td className="px-5 py-2.5 text-sm text-ink">{p.productName}</td>
                              <td className="px-5 py-2.5 text-right text-sm tabular-nums text-ink">{p.totalQuantity}</td>
                              <td className="px-5 py-2.5 text-right text-sm font-semibold tabular-nums text-ink">
                                {fmtCur(p.totalRevenue, sym)}
                              </td>
                              <td className="px-5 py-2.5 text-right text-xs tabular-nums text-ink/40">
                                {totalRevenue > 0 ? `${Math.round((p.totalRevenue / totalRevenue) * 100)}%` : '—'}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : null}
          </div>
        )}

        {/* ════════════════ GST / TAX TAB ════════════════ */}
        {tab === 'gst' && (
          <div className="p-5 space-y-5">
            {gstError && (
              <div className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
                {gstError}
              </div>
            )}

            {gstLoading ? (
              <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
            ) : gst ? (
              <>
                {/* Summary KPIs */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <KPICard label="Taxable Value"  value={fmtCur(gst.totalTaxableValue, sym)} />
                  <KPICard label="Total CGST"     value={fmtCur(gst.totalCGST, sym)} />
                  <KPICard label="Total SGST"     value={fmtCur(gst.totalSGST, sym)} />
                  <KPICard label="Total Tax"      value={fmtCur(gst.totalTax, sym)} accent />
                </div>

                {/* Rate-wise table */}
                <Card className="overflow-hidden !p-0">
                  <div className="flex items-center justify-between border-b border-border px-5 py-3">
                    <h3 className="text-sm font-semibold text-ink">
                      Rate-wise GST Breakup
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={exportGSTCSV}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5"
                      >
                        <Download size={11} />
                        GST CSV
                      </button>
                      <button
                        onClick={() => void exportTallyCSV()}
                        disabled={exportingTally}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5 disabled:opacity-40"
                      >
                        {exportingTally ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />}
                        Tally CSV
                      </button>
                      <button
                        onClick={() => void exportGSTR1()}
                        disabled={exportingGSTR || days > 91}
                        title={days > 91 ? 'GSTR-1 export is limited to 92 days' : undefined}
                        className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
                      >
                        {exportingGSTR ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />}
                        GSTR-1 JSON
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-mist">
                          {['Tax %', 'Taxable Value', 'CGST', 'SGST', 'Total Tax', 'Total Value', 'Items'].map(h => (
                            <th key={h} className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40 first:text-left">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {gst.rows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-5 py-8 text-center text-xs text-ink/30">
                              No taxable orders in this period
                            </td>
                          </tr>
                        ) : (
                          <>
                            {gst.rows.map(r => (
                              <tr key={r.taxPercent} className="hover:bg-mist">
                                <td className="px-5 py-2.5 text-sm text-ink">{r.taxPercent}%</td>
                                <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(r.taxableValue, sym)}</td>
                                <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(r.cgst, sym)}</td>
                                <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(r.sgst, sym)}</td>
                                <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(r.totalTax, sym)}</td>
                                <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(r.totalValue, sym)}</td>
                                <td className="px-5 py-2.5 text-right tabular-nums text-ink/60">{r.totalItems}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-border bg-mist font-semibold">
                              <td className="px-5 py-2.5 text-sm text-ink">Total</td>
                              <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(gst.totalTaxableValue, sym)}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(gst.totalCGST, sym)}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(gst.totalSGST, sym)}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums text-brand">{fmtCur(gst.totalTax, sym)}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums">{fmtCur(gst.totalValue, sym)}</td>
                              <td className="px-5 py-2.5" />
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {days > 91 && (
                  <p className="text-xs text-amber-600">
                    GSTR-1 export is limited to 92 days. Narrow the date range to enable it.
                  </p>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* ════════════════ EXPENSES TAB ════════════════ */}
        {tab === 'expenses' && (
          <div className="p-5 space-y-5">
            {!expFeature ? (
              <div className="flex h-48 flex-col items-center justify-center text-center">
                <TrendingDown size={36} className="mb-3 text-ink/10" />
                <p className="text-sm text-ink/40">Expenses feature not enabled</p>
                <p className="mt-1 text-xs text-ink/25">Enable it in hotel settings.</p>
              </div>
            ) : (
              <>
                {/* Date picker */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink/50">Date</span>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={e => setExpenseDate(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-canvas px-3 text-xs text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  />
                  <button
                    onClick={() => setExpenseDate(todayStr())}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5"
                  >
                    Today
                  </button>
                  {pnlLoading && <Spinner size="sm" />}
                </div>

                {pnlError && (
                  <div className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
                    {pnlError}
                  </div>
                )}

                {pnlLoading && !pnl ? (
                  <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
                ) : pnl ? (
                  <>
                    {/* P&L KPIs */}
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                      <KPICard
                        label="Revenue"
                        value={fmtCur(pnl.revenue, sym)}
                        sub={`${pnl.orders} orders`}
                        accent
                      />
                      <KPICard
                        label="Expenses"
                        value={fmtCur(pnl.expenses, sym)}
                      />
                      <KPICard
                        label="Net Profit"
                        value={fmtCur(pnl.profit, sym)}
                        sub={`${pnl.profitMargin}% margin`}
                      />
                      <KPICard
                        label="Profit Margin"
                        value={`${pnl.profitMargin}%`}
                      />
                    </div>

                    {/* Expense breakdown */}
                    {pnl.breakdown.length > 0 && (
                      <Card className="overflow-hidden !p-0">
                        <div className="flex items-center justify-between border-b border-border px-5 py-3">
                          <h3 className="text-sm font-semibold text-ink">
                            Expense Breakdown — {fmtDisplayDate(expenseDate)}
                          </h3>
                          <button
                            onClick={exportExpensesCSV}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5"
                          >
                            <Download size={11} />
                            CSV
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-sm">
                            <thead>
                              <tr className="bg-mist">
                                <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Category</th>
                                <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Count</th>
                                <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Total</th>
                                <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">% of Expenses</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {pnl.breakdown.map(b => (
                                <tr key={b._id} className="hover:bg-mist">
                                  <td className="px-5 py-2.5 text-sm capitalize text-ink">{b._id}</td>
                                  <td className="px-5 py-2.5 text-right tabular-nums text-ink/60">{b.count}</td>
                                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-ink">
                                    {fmtCur(b.total, sym)}
                                  </td>
                                  <td className="px-5 py-2.5 text-right tabular-nums text-ink/40">
                                    {pnl.expenses > 0
                                      ? `${Math.round((b.total / pnl.expenses) * 100)}%`
                                      : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Horizontal breakdown bars */}
                        <div className="border-t border-border p-5">
                          <HorizBars
                            sym={sym}
                            data={pnl.breakdown.map(b => ({ label: b._id, value: b.total }))}
                          />
                        </div>
                      </Card>
                    )}
                  </>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
