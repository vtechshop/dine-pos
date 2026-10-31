import { useState, useCallback, useEffect, useMemo } from 'react';
import { Search, Printer, FileText, AlertCircle, X, RefreshCw } from 'lucide-react';
import { fetchOrders, fetchCashierOrders, type CashierOrderItem } from '../../api/orders';
import { useAuth } from '../../context/AuthContext';
import { printBill } from '../../utils/printBill';
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

/** Admins search all orders; cashiers see today's orders (their order history). */
export function BillSearchPanel() {
  const { role } = useAuth();
  return role === 'admin' ? <AdminBillSearch /> : <TodayOrderHistory />;
}

// ── Cashier: today's order history ────────────────────────────────────────────

type HistoryFilter = 'all' | 'paid' | 'unpaid';

function historyStatus(o: CashierOrderItem): { label: string; cls: string } {
  if (o.status === 'completed') return { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' };
  if (o.status === 'payment_pending') return { label: 'Waiting for payment', cls: 'bg-amber-50 text-amber-700' };
  if (o.paymentTime) return { label: 'Paid · in kitchen', cls: 'bg-emerald-50 text-emerald-700' };
  return { label: 'Unpaid · ' + o.status, cls: 'bg-amber-50 text-amber-700' };
}

function TodayOrderHistory() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const [orders, setOrders]   = useState<CashierOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [filter, setFilter]   = useState<HistoryFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await fetchCashierOrders());
    } catch {
      setError("Could not load today's orders. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const today = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const t = start.getTime();
    // The cashier list also carries older unpaid bills; history here is today only
    return orders
      .filter(o => new Date(o.createdAt).getTime() >= t || (!!o.completedAt && new Date(o.completedAt).getTime() >= t))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders]);

  const shown = today.filter(o => {
    const paid = o.status === 'completed' || !!o.paymentTime;
    if (filter === 'paid' && !paid) return false;
    if (filter === 'unpaid' && paid) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [o.orderNumber, o.customerName, o.tableNumber].some(v => (v ?? '').toLowerCase().includes(q));
  });

  const header = {
    hotelName: settings?.hotelName, address: settings?.address, phone: settings?.phone,
    gstNumber: settings?.gstNumber, footerText: settings?.footerText, currencySymbol: sym,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Order History · Today</h2>
        <button type="button" onClick={() => void load()} title="Refresh"
          className="rounded-lg border border-border p-1.5 text-ink/50 hover:bg-mist">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            id="cashier-bill-search"
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search order #, customer or table…"
            className="search-input w-full py-2 pl-8 pr-8 text-sm"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/35 hover:text-ink/60">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          {(['all', 'paid', 'unpaid'] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={'rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors ' + (
                filter === f ? 'border-brand bg-brand text-white' : 'border-border bg-canvas text-umber hover:bg-mist hover:text-coffee'
              )}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertCircle size={13} className="text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      <p className="text-xs text-ink/50">
        {loading && today.length === 0
          ? 'Loading…'
          : shown.length + ' of ' + today.length + ' order' + (today.length === 1 ? '' : 's') + ' today'}
      </p>

      {!loading && shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center">
          <FileText size={20} className="mx-auto mb-2 text-ink/20" />
          <p className="text-sm text-ink/40">{today.length === 0 ? 'No orders yet today' : 'No orders match'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map(order => {
            const st = historyStatus(order);
            return (
              <div key={order._id} className="rounded-xl border border-border bg-canvas">
                <div className="flex cursor-pointer items-start gap-3 p-3" onClick={() => setExpanded(e => e === order._id ? null : order._id)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold text-ink">#{order.orderNumber}</span>
                      {order.tableNumber && <span className="rounded bg-mist px-1.5 py-0.5 text-[10px] font-medium text-ink/60">T{order.tableNumber}</span>}
                      <span className={'rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ' + st.cls}>{st.label}</span>
                      <span className="text-[10px] text-ink/40">{SOURCE_LABEL[order.orderSource] ?? order.orderSource}</span>
                    </div>
                    {order.customerName && <p className="mt-0.5 text-xs text-ink/55">{order.customerName}</p>}
                    <p className="text-[10px] text-ink/40">
                      {fmtDateTime(order.createdAt)} · {order.items.length} item{order.items.length === 1 ? '' : 's'}
                    </p>
                    {expanded === order._id && (
                      <div className="mt-2 space-y-0.5">
                        {order.items.map((item, i) => (
                          <p key={i} className="text-xs text-ink/60">{item.productName} × {item.quantity} = {fmtINR(sym, item.total)}</p>
                        ))}
                        <div className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5">
                          <p className="text-[10px] text-ink/50">Subtotal: {fmtINR(sym, order.subtotal)}</p>
                          <p className="text-[10px] text-ink/50">Tax: {fmtINR(sym, order.taxTotal)}</p>
                          {(order.discountAmount ?? 0) > 0 && (
                            <p className="text-[10px] text-emerald-600">Discount: −{fmtINR(sym, order.discountAmount ?? 0)}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="text-sm font-bold text-ink">{fmtINR(sym, order.grandTotal)}</p>
                    {(order.status === 'completed' || !!order.paymentTime) && order.paymentMethod && (
                      <span className="text-[10px] font-medium uppercase text-ink/40">{order.paymentMethod}</span>
                    )}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); printBill(order, header); }}
                      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-ink/60 hover:bg-mist"
                    >
                      <Printer size={11} /> Print
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Admin: search all orders ──────────────────────────────────────────────────

function AdminBillSearch() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [query, setQuery]       = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [status, setStatus]     = useState('');
  const [results, setResults]   = useState<OrderListItem[]>([]);
  const [jobs, setJobs]         = useState<PrintJob[]>([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [reprinting, setReprinting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage]         = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const handleSearch = useCallback(async (pageNum = 1) => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(pageNum);

    const params: Parameters<typeof fetchOrders>[0] = { limit: 20, page: pageNum };
    if (dateFrom) params.from = dateFrom;
    if (dateTo)   params.to   = dateTo;
    if (status)   params.status = status;
    if (query.trim()) params.q = query.trim();

    try {
      const [ordersRes, jobsRes] = await Promise.allSettled([
        fetchOrders(params),
        fetchReceiptJobs(),
      ]);
      if (!cancelled) {
        if (ordersRes.status === 'fulfilled') {
          const orders = ordersRes.value.orders;
          setResults(orders);
          setTotalPages(ordersRes.value.totalPages ?? ordersRes.value.pages ?? 1);
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
  }, [query, dateFrom, dateTo, status]);

  async function handleReprint(order: OrderListItem) {
    const job = jobs.find(j => j.orderId === order._id && j.jobType === 'receipt');
    if (!job) return;
    setReprinting(order._id);
    try { await reprintJob(job._id); } catch { /* non-fatal */ } finally { setReprinting(null); }
  }

  function handleClear() {
    setQuery(''); setDateFrom(''); setDateTo(''); setStatus('');
    setResults([]); setSearched(false); setError(null);
    setPage(1); setTotalPages(1);
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
            onKeyDown={e => { if (e.key === 'Enter') void handleSearch(1); }}
            placeholder="Order #, table, customer name…"
            className="search-input w-full py-2 pl-8 pr-8 text-sm"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/35 hover:text-ink/60">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Date range + status filters */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-ink/60">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="mt-0.5 block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink/60">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="mt-0.5 block w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
            />
          </div>
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
            onClick={() => void handleSearch(1)}
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
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-ink/50">
              {results.length} result{results.length !== 1 ? 's' : ''}
              {totalPages > 1 && ` (page ${page} of ${totalPages})`}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSearch(page - 1)}
                  disabled={page <= 1}
                  className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-ink/60 hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => void handleSearch(page + 1)}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-ink/60 hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>
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
