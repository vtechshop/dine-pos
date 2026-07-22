import { useState, useCallback } from 'react';
import { Search, Printer, FileText, AlertCircle, X } from 'lucide-react';
import { fetchOrders } from '../../api/orders';
import { reprintJob, fetchReceiptJobs } from '../../api/billing';
import { useSettings } from '../../context/SettingsContext';
import { Spinner } from '../ui/Spinner';
import type { OrderListItem, PrintJob } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_STYLES: Record<string, string> = {
  completed:  'bg-emerald-50 text-emerald-700',
  cancelled:  'bg-red-50 text-red-600',
  served:     'bg-brand/10 text-brand',
  pending:    'bg-amber-50 text-amber-700',
  preparing:  'bg-blue-50 text-blue-600',
  ready:      'bg-purple-50 text-purple-600',
};

const SOURCE_LABEL: Record<string, string> = {
  'dine-in':  'Dine In',
  takeaway:   'Takeaway',
  delivery:   'Delivery',
  swiggy:     'Swiggy',
  zomato:     'Zomato',
  qr:         'QR',
  kiosk:      'Kiosk',
  waiter:     'Waiter',
  admin:      'Admin',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function BillSearchPanel() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [query, setQuery]   = useState('');
  const [date, setDate]     = useState('');
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<OrderListItem[]>([]);
  const [jobs, setJobs]     = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [reprinting, setReprinting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params: Parameters<typeof fetchOrders>[0] = { limit: 50, page: 1 };
    if (date) params.date = date;
    if (status) params.status = status;

    try {
      const [ordersRes, jobsRes] = await Promise.allSettled([
        fetchOrders(params),
        fetchReceiptJobs(),
      ]);
      if (!cancelled) {
        if (ordersRes.status === 'fulfilled') {
          let orders = ordersRes.value.orders;
          // Client-side filter by query (order #, table, customer, phone)
          if (query.trim()) {
            const q = query.trim().toLowerCase();
            orders = orders.filter(o =>
              o.orderNumber.toLowerCase().includes(q) ||
              (o.tableNumber ?? '').includes(q) ||
              (o.customerName ?? '').toLowerCase().includes(q),
            );
          }
          setResults(orders);
        } else {
          setError('Search failed. Please try again.');
        }
        if (jobsRes.status === 'fulfilled') setJobs(jobsRes.value);
        setSearched(true);
        setLoading(false);
      }
    } catch {
      if (!cancelled) { setError('Search failed'); setLoading(false); }
    }

    return () => { cancelled = true; };
  }, [query, date, status]);

  async function handleReprint(order: OrderListItem) {
    const job = jobs.find(j => j.orderId === order._id && j.jobType === 'receipt');
    if (!job) return;
    setReprinting(order._id);
    try { await reprintJob(job._id); } catch { /* non-fatal */ } finally { setReprinting(null); }
  }

  function handleClear() {
    setQuery(''); setDate(''); setStatus('');
    setResults([]); setSearched(false); setError(null);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Bill Search</h2>

      {/* Search controls */}
      <div className="rounded-xl border border-border bg-canvas p-3 space-y-2.5">
        {/* Text search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            id="cashier-bill-search"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleSearch(); }}
            placeholder="Order #, table, customer name…"
            className="w-full rounded-lg border border-border py-2 pl-8 pr-8 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/35 hover:text-ink/60">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-ink/60">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="mt-0.5 block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink/60">Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="mt-0.5 block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            >
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="served">Served</option>
              <option value="pending">Pending</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {searched && (
            <button type="button" onClick={handleClear}
              className="rounded-lg border border-border px-3 py-2 text-sm text-ink/60 hover:bg-mist">
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
          >
            {loading ? <Spinner size="sm" /> : <Search size={14} />}
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertCircle size={13} className="text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Results */}
      {searched && !loading && (
        <div>
          <p className="mb-2 text-xs text-ink/50">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </p>
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 text-center">
              <FileText size={20} className="mx-auto mb-2 text-ink/20" />
              <p className="text-sm text-ink/40">No bills found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map(order => {
                const hasJob = jobs.some(j => j.orderId === order._id && j.jobType === 'receipt');
                return (
                  <div key={order._id} className="rounded-xl border border-border bg-canvas">
                    <div
                      className="flex items-start gap-3 p-3 cursor-pointer"
                      onClick={() => setExpanded(e => e === order._id ? null : order._id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-mono font-semibold text-ink">#{order.orderNumber}</span>
                          {order.tableNumber && (
                            <span className="rounded bg-mist px-1.5 py-0.5 text-[10px] font-medium text-ink/60">T{order.tableNumber}</span>
                          )}
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${STATUS_STYLES[order.status] ?? 'bg-mist text-ink/60'}`}>
                            {order.status}
                          </span>
                          <span className="text-[10px] text-ink/40">{SOURCE_LABEL[order.orderSource] ?? order.orderSource}</span>
                        </div>
                        {order.customerName && <p className="mt-0.5 text-xs text-ink/55">{order.customerName}</p>}
                        <p className="text-[10px] text-ink/40">{fmtDateTime(order.createdAt)}</p>
                        {expanded === order._id && (
                          <div className="mt-2 space-y-0.5">
                            {order.items.map((item, i) => (
                              <p key={i} className="text-xs text-ink/60">{item.productName} × {item.quantity} = {fmtINR(sym, item.total)}</p>
                            ))}
                            <div className="mt-1.5 border-t border-border/60 pt-1.5 space-y-0.5">
                              <p className="text-[10px] text-ink/50">Subtotal: {fmtINR(sym, order.subtotal)}</p>
                              <p className="text-[10px] text-ink/50">Tax: {fmtINR(sym, order.taxTotal)}</p>
                              {(order.discountAmount ?? 0) > 0 && (
                                <p className="text-[10px] text-emerald-600">Discount: −{fmtINR(sym, order.discountAmount ?? 0)}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <p className="text-sm font-bold text-ink">{fmtINR(sym, order.grandTotal)}</p>
                        {order.paymentMethod && (
                          <span className="text-[10px] font-medium capitalize text-ink/40">{order.paymentMethod}</span>
                        )}
                        {hasJob && (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); void handleReprint(order); }}
                            disabled={reprinting === order._id}
                            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-ink/60 hover:bg-mist disabled:opacity-50"
                          >
                            {reprinting === order._id ? <Spinner size="sm" /> : <Printer size={11} />}
                            Reprint
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
