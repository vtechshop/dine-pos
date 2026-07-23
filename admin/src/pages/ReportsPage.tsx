import { useState } from 'react';
import { FileText, Download, RefreshCw, TrendingUp, Package } from 'lucide-react';
import {
  SectionHeader, PageLoader, ErrorState, StatCard, Btn, ApiRequired, EmptyState,
} from '../components/ui';
import { fetchSalesReport, fetchProductSalesReport } from '../api/reports';
import type { SalesReportRow, ProductSalesRow } from '../api/reports';

const REPORT_ENDPOINTS = [
  'GET /reports/staff?from=&to=                   — staff performance report (CSV/PDF)',
  'GET /reports/attendance?from=&to=              — attendance report',
  'GET /reports/salary?month=                     — salary report',
  'GET /aggregator/reports/settlement?from=&to=   — settlement report',
  'GET /aggregator/reports/commission?from=&to=   — commission breakdown by platform',
  'GET /aggregator/reports/menu-sync?platform=    — menu sync history report',
  'GET /aggregator/reports/webhooks?from=&to=     — webhook error report',
  'GET /qr/reports?from=&to=                      — QR usage report',
];

type ReportTab = 'sales' | 'products' | 'gst' | 'staff' | 'aggregator';

const today = () => new Date().toISOString().slice(0, 10);

function fmtINR(n: number) { return `₹${Math.round(n).toLocaleString('en-IN')}`; }

function exportToCSV(rows: string[][], filename: string) {
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

export default function ReportsPage() {
  const [tab,      setTab]      = useState<ReportTab>('sales');
  const [from,     setFrom]     = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [to,       setTo]       = useState(today());
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const [salesRows,   setSalesRows]   = useState<SalesReportRow[] | null>(null);
  const [productRows, setProductRows] = useState<ProductSalesRow[] | null>(null);

  const loadSales = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetchSalesReport(from, to);
      const data = res as { orders?: SalesReportRow[] };
      setSalesRows(data.orders ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load sales report');
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetchProductSalesReport(from);
      const data = res as { products?: ProductSalesRow[] };
      setProductRows(data.products ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load product report');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    if (tab === 'sales')    loadSales();
    else if (tab === 'products') loadProducts();
  };

  const handleExportSales = () => {
    if (!salesRows) return;
    exportToCSV(
      [['Date', 'Orders', 'Revenue', 'GST', 'Net Revenue'],
       ...salesRows.map(r => [r.date, String(r.totalOrders), String(r.totalRevenue), String(r.totalGST), String(r.netRevenue)])],
      `sales_${from}_${to}.csv`,
    );
  };

  const handleExportProducts = () => {
    if (!productRows) return;
    exportToCSV(
      [['Product', 'Quantity', 'Revenue'],
       ...productRows.map(r => [r.productName, String(r.quantity), String(r.revenue)])],
      `products_${from}.csv`,
    );
  };

  const totalRevenue  = salesRows ? salesRows.reduce((s, r) => s + r.totalRevenue, 0)  : 0;
  const totalOrders   = salesRows ? salesRows.reduce((s, r) => s + r.totalOrders, 0)   : 0;
  const totalGST      = salesRows ? salesRows.reduce((s, r) => s + r.totalGST, 0)      : 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Reports"
        sub="Sales, products, GST, staff and aggregator reports"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={today()} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-[#E8D5C0] px-3 py-1.5 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
            <input type="date" value={to}   max={today()} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-[#E8D5C0] px-3 py-1.5 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
            <Btn variant="primary" size="sm" onClick={handleGenerate} loading={loading}>
              <RefreshCw size={14} /> Generate
            </Btn>
          </div>
        }
      />

      {/* Tab bar */}
      <div className="flex border-b border-[#E8D5C0]">
        {([
          { key: 'sales',      label: 'Sales Report' },
          { key: 'products',   label: 'Product Sales' },
          { key: 'gst',        label: 'GST' },
          { key: 'staff',      label: 'Staff Report' },
          { key: 'aggregator', label: 'Aggregator' },
        ] as { key: ReportTab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSalesRows(null); setProductRows(null); setError(''); }}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-[#E8380D] text-[#E8380D]' : 'border-transparent text-[#92745E] hover:text-[#1C0800]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sales report */}
      {tab === 'sales' && (
        <div className="space-y-4">
          {error && <ErrorState message={error} onRetry={handleGenerate} />}
          {loading && <PageLoader />}
          {!loading && !error && salesRows !== null && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="Total Revenue" value={fmtINR(totalRevenue)} accent icon={<TrendingUp size={16} />} />
                <StatCard label="Total Orders"  value={totalOrders} />
                <StatCard label="Total GST"     value={fmtINR(totalGST)} />
              </div>
              {salesRows.length === 0 ? (
                <EmptyState title="No sales data" sub="No orders found for the selected date range." />
              ) : (
                <>
                  <div className="flex justify-end gap-2">
                    <Btn size="sm" onClick={handleExportSales}><Download size={14} /> CSV</Btn>
                    <Btn size="sm" disabled title="PDF export requires backend PDF generation endpoint">
                      <Download size={14} /> PDF
                    </Btn>
                  </div>
                  <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
                          {['Date', 'Orders', 'Revenue', 'GST', 'Net Revenue'].map(h => (
                            <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {salesRows.map((r, i) => (
                          <tr key={i} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                            <td className="px-4 py-3 font-semibold text-[#1C0800]">{r.date}</td>
                            <td className="px-4 py-3 text-[#1C0800]">{r.totalOrders}</td>
                            <td className="px-4 py-3 font-bold text-[#E8380D]">{fmtINR(r.totalRevenue)}</td>
                            <td className="px-4 py-3 text-[#92745E]">{fmtINR(r.totalGST)}</td>
                            <td className="px-4 py-3 font-bold text-green-700">{fmtINR(r.netRevenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
          {!loading && !error && salesRows === null && (
            <EmptyState
              icon={<FileText className="h-10 w-10" />}
              title="Set date range and click Generate"
              sub="Sales report will appear here"
            />
          )}
        </div>
      )}

      {/* Product sales */}
      {tab === 'products' && (
        <div className="space-y-4">
          {error   && <ErrorState message={error} onRetry={handleGenerate} />}
          {loading && <PageLoader />}
          {!loading && !error && productRows !== null && (
            <>
              {productRows.length === 0 ? (
                <EmptyState title="No product data" sub="No orders found for the selected date." />
              ) : (
                <>
                  <div className="flex justify-end gap-2">
                    <Btn size="sm" onClick={handleExportProducts}><Download size={14} /> CSV</Btn>
                  </div>
                  <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
                          {['Product', 'Quantity Sold', 'Revenue'].map(h => (
                            <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {productRows.sort((a, b) => b.revenue - a.revenue).map((r, i) => (
                          <tr key={i} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                            <td className="px-4 py-3 font-semibold text-[#1C0800]">{r.productName}</td>
                            <td className="px-4 py-3 text-[#1C0800]">{r.quantity}</td>
                            <td className="px-4 py-3 font-bold text-[#E8380D]">{fmtINR(r.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
          {!loading && !error && productRows === null && (
            <EmptyState
              icon={<Package className="h-10 w-10" />}
              title="Set date and click Generate"
              sub="Product sales report will appear here. Note: uses from date only."
            />
          )}
        </div>
      )}

      {/* GST / Staff / Aggregator — backend required */}
      {(tab === 'gst' || tab === 'staff' || tab === 'aggregator') && (
        <div className="space-y-4">
          <ApiRequired endpoints={REPORT_ENDPOINTS.filter(e =>
            tab === 'gst'        ? e.includes('gst')   :
            tab === 'staff'      ? (e.includes('staff') || e.includes('attendance') || e.includes('salary')) :
            /* aggregator */      (e.includes('aggregator') || e.includes('qr') || e.includes('webhook') || e.includes('settlement') || e.includes('commission') || e.includes('menu-sync'))
          )} />
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="Report unavailable"
            sub="This report requires a backend endpoint listed above."
          />
        </div>
      )}
    </div>
  );
}
