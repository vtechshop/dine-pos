import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CreditCard, Printer, Trash2, AlertCircle,
  ShoppingBag, UtensilsCrossed, Truck, Clock,
} from 'lucide-react';
import { fetchCashierOrders, cancelOrder } from '../../api/orders';
import { reprintJob, fetchReceiptJobs } from '../../api/billing';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { AuditModal } from './AuditModal';
import { Spinner } from '../ui/Spinner';
import type { CashierOrderItem } from '../../api/orders';
import type { PrintJob } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtAge(nowMs: number, iso: string): string {
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const SOURCE_ICON: Record<string, React.ReactNode> = {
  'dine-in':  <UtensilsCrossed size={12} />,
  takeaway:   <ShoppingBag size={12} />,
  delivery:   <Truck size={12} />,
};

// ── Payment quick modal ───────────────────────────────────────────────────────

type PayMethod = 'cash' | 'upi' | 'card' | 'split';

function QuickPayModal({
  order,
  sym,
  onClose,
  onDone,
}: {
  order: CashierOrderItem;
  sym: string;
  cashierName?: string;
  cashierId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<PayMethod>('cash');
  const [cashGiven, setCashGiven] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [splitUpi, setSplitUpi] = useState('');
  const [splitCard, setSplitCard] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grand = order.grandTotal;
  const change = (parseFloat(cashGiven) || 0) - grand;
  const splitTotal = (parseFloat(splitCash) || 0) + (parseFloat(splitUpi) || 0) + (parseFloat(splitCard) || 0);

  async function handlePay() {
    if (method === 'cash' && (parseFloat(cashGiven) || 0) < grand) {
      setError('Cash given is less than total'); return;
    }
    if (method === 'split' && Math.abs(splitTotal - grand) > 0.5) {
      setError('Split amounts do not add up to total'); return;
    }
    setError(null);
    setLoading(true);
    try {
      // Use the existing order status endpoint — cashier marks as completed
      const { updateOrderPayment, completeOrder } = await import('../../api/orders');
      const splitDetails = method === 'split'
        ? { cash: parseFloat(splitCash) || 0, upi: parseFloat(splitUpi) || 0, card: parseFloat(splitCard) || 0 }
        : undefined;
      await updateOrderPayment(order._id, method, splitDetails);
      await completeOrder(order._id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setLoading(false);
    }
  }

  const METHODS: { key: PayMethod; label: string }[] = [
    { key: 'cash', label: 'Cash' },
    { key: 'upi', label: 'UPI' },
    { key: 'card', label: 'Card' },
    { key: 'split', label: 'Split' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">Take Payment</p>
            <p className="text-xs text-ink/50">#{order.orderNumber} · {order.tableNumber ? `T${order.tableNumber}` : order.customerName ?? 'Walk-in'}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-brand">{fmtINR(sym, grand)}</p>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* Method */}
          <div className="flex gap-1 rounded-lg border border-border p-1">
            {METHODS.map(m => (
              <button key={m.key} type="button" onClick={() => setMethod(m.key)}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${method === m.key ? 'bg-brand text-white' : 'text-ink/60 hover:bg-mist'}`}>
                {m.label}
              </button>
            ))}
          </div>

          {method === 'cash' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {[100, 200, 500, 1000].map(p => (
                  <button key={p} type="button" onClick={() => setCashGiven(String(p))}
                    className="rounded border border-border bg-mist px-2 py-1 text-[11px] font-medium text-ink hover:bg-canvas">
                    {sym}{p}
                  </button>
                ))}
                <button type="button" onClick={() => setCashGiven(String(Math.ceil(grand)))}
                  className="rounded border border-brand/30 bg-brand/5 px-2 py-1 text-[11px] font-medium text-brand">Exact</button>
              </div>
              <input type="number" value={cashGiven} onChange={e => setCashGiven(e.target.value)}
                placeholder={`Amount given…`}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20" />
              {cashGiven && (
                <div className={`flex justify-between rounded-lg px-3 py-2 ${change >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-100'}`}>
                  <span className="text-xs">{change >= 0 ? 'Change' : 'Short'}</span>
                  <span className={`text-sm font-bold ${change >= 0 ? 'text-emerald-700' : 'text-red-500'}`}>{fmtINR(sym, Math.abs(change))}</span>
                </div>
              )}
            </div>
          )}

          {(method === 'upi' || method === 'card') && (
            <div className="rounded-lg bg-mist px-3 py-3 text-center">
              <p className="text-xs text-ink/60">Collect {fmtINR(sym, grand)} via {method.toUpperCase()}</p>
            </div>
          )}

          {method === 'split' && (
            <div className="space-y-2">
              {(['cash', 'upi', 'card'] as const).map(k => (
                <div key={k} className="flex items-center gap-2">
                  <label className="w-10 text-xs capitalize text-ink/60">{k}</label>
                  <input type="number" min="0" placeholder="0"
                    value={k === 'cash' ? splitCash : k === 'upi' ? splitUpi : splitCard}
                    onChange={e => { if (k === 'cash') setSplitCash(e.target.value); else if (k === 'upi') setSplitUpi(e.target.value); else setSplitCard(e.target.value); }}
                    className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm text-ink outline-none focus:border-brand/50" />
                </div>
              ))}
              <p className={`text-center text-xs font-medium ${Math.abs(splitTotal - grand) < 0.5 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {Math.abs(splitTotal - grand) < 0.5 ? '✓ Balanced' : `${fmtINR(sym, Math.abs(splitTotal - grand))} ${splitTotal > grand ? 'over' : 'short'}`}
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink/70 hover:bg-mist">
              Cancel
            </button>
            <button type="button" onClick={() => void handlePay()} disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
              {loading && <Spinner size="sm" />}
              {loading ? 'Processing…' : 'Confirm Payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Order row ─────────────────────────────────────────────────────────────────

function OrderRow({
  order,
  nowMs,
  sym,
  jobs,
  cashierName,
  cashierId,
  onRefresh,
}: {
  order: CashierOrderItem;
  nowMs: number;
  sym: string;
  jobs: PrintJob[];
  cashierName: string;
  cashierId: string;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [reprinting, setReprinting] = useState(false);

  const ageMs = nowMs - new Date(order.createdAt).getTime();
  const isOld = ageMs > 20 * 60_000;
  const receiptJob = jobs.find(j => j.orderId === order._id && j.jobType === 'receipt');

  async function handleReprint() {
    if (!receiptJob) return;
    setReprinting(true);
    try { await reprintJob(receiptJob._id); } catch { /* show err inline */ } finally { setReprinting(false); }
  }

  async function handleCancel(_payload: { reason: string; cashierName: string; cashierId: string }) {
    await cancelOrder(order._id);
    onRefresh();
  }

  return (
    <>
      <div className={`rounded-xl border bg-canvas transition-shadow hover:shadow-sm ${isOld ? 'border-amber-200' : 'border-border'}`}>
        <div className="flex items-start gap-3 p-3">
          {/* Source icon */}
          <span className="mt-0.5 rounded-lg border border-border p-1.5 text-ink/40">
            {SOURCE_ICON[order.orderSource] ?? <UtensilsCrossed size={12} />}
          </span>

          {/* Details */}
          <div className="flex-1 min-w-0" onClick={() => setExpanded(e => !e)}>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono font-semibold text-ink">#{order.orderNumber}</span>
              {order.tableNumber && (
                <span className="rounded bg-mist px-1.5 py-0.5 text-[10px] font-medium text-ink/60">T{order.tableNumber}</span>
              )}
              {isOld && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Waiting</span>}
            </div>
            {order.customerName && <p className="text-xs text-ink/55">{order.customerName}</p>}
            <p className="mt-0.5 text-[10px] text-ink/40 flex items-center gap-1">
              <Clock size={10} />
              {fmtAge(nowMs, order.createdAt)}
              <span className="text-ink/20">·</span>
              {order.items.length} item{order.items.length !== 1 ? 's' : ''}
            </p>
            {expanded && (
              <div className="mt-2 space-y-0.5">
                {order.items.map((item, i) => (
                  <p key={i} className="text-xs text-ink/60">{item.productName} × {item.quantity}</p>
                ))}
              </div>
            )}
          </div>

          {/* Amount + actions */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <p className="text-sm font-bold text-ink">{fmtINR(sym, order.grandTotal)}</p>
            <div className="flex gap-1.5">
              {receiptJob && (
                <button
                  type="button"
                  title="Reprint"
                  onClick={() => void handleReprint()}
                  disabled={reprinting}
                  className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist disabled:opacity-50"
                >
                  {reprinting ? <Spinner size="sm" /> : <Printer size={13} />}
                </button>
              )}
              <button
                type="button"
                title="Cancel order"
                onClick={() => setShowCancel(true)}
                className="rounded-lg border border-border p-1.5 text-ink/40 hover:border-red-200 hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 size={13} />
              </button>
              <button
                type="button"
                onClick={() => setShowPay(true)}
                className="flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
              >
                <CreditCard size={11} />
                Pay
              </button>
            </div>
          </div>
        </div>
      </div>

      {showPay && (
        <QuickPayModal
          order={order}
          sym={sym}
          cashierName={cashierName}
          cashierId={cashierId}
          onClose={() => setShowPay(false)}
          onDone={() => { setShowPay(false); onRefresh(); }}
        />
      )}

      {showCancel && (
        <AuditModal
          title="Cancel Order"
          description={`Cancel order #${order.orderNumber}? This will restore stock.`}
          actionLabel="Cancel Order"
          danger
          cashierName={cashierName}
          cashierId={cashierId}
          onConfirm={handleCancel}
          onClose={() => setShowCancel(false)}
        />
      )}
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function PendingBillsPanel() {
  const { settings } = useSettings();
  useAuth(); // auth JWT used by API calls internally
  const sym = settings?.currencySymbol ?? '₹';

  const [orders, setOrders] = useState<CashierOrderItem[]>([]);
  const [jobs, setJobs]     = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [nowMs, setNowMs]   = useState(() => Date.now());

  // Get cashier identity from JWT
  const cashierName = (() => {
    try {
      const token = localStorage.getItem('pos_token') ?? localStorage.getItem('pos_cashier_token') ?? '';
      if (!token) return 'Cashier';
      const p = JSON.parse(atob(token.split('.')[1]));
      return (p.name as string | undefined) ?? 'Cashier';
    } catch { return 'Cashier'; }
  })();
  const cashierId = (() => {
    try {
      const token = localStorage.getItem('pos_token') ?? localStorage.getItem('pos_cashier_token') ?? '';
      if (!token) return '';
      const p = JSON.parse(atob(token.split('.')[1]));
      return (p.employeeCode as string | undefined) ?? (p.sub as string | undefined) ?? '';
    } catch { return ''; }
  })();

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    const [ordersRes, jobsRes] = await Promise.allSettled([
      fetchCashierOrders(),
      fetchReceiptJobs(),
    ]);
    if (!cancelled) {
      if (ordersRes.status === 'fulfilled') {
        setOrders(ordersRes.value);
        setError(null);
      } else {
        setError('Failed to load pending bills');
      }
      if (jobsRes.status === 'fulfilled') setJobs(jobsRes.value);
      setLoading(false);
      setNowMs(Date.now());
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); setNowMs(Date.now()); }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Pending Bills</h2>
        <div className="flex items-center gap-2">
          {orders.length > 0 && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
              {orders.length} pending
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {loading && orders.length === 0 && (
        <div className="flex justify-center py-8"><Spinner /></div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertCircle size={13} className="text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {!loading && orders.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <CreditCard size={24} className="mx-auto mb-2 text-ink/20" />
          <p className="text-sm font-medium text-ink/40">No pending bills</p>
          <p className="mt-0.5 text-xs text-ink/30">Served orders awaiting payment appear here</p>
        </div>
      )}

      <div className="space-y-2.5">
        {orders.map(order => (
          <OrderRow
            key={order._id}
            order={order}
            nowMs={nowMs}
            sym={sym}
            jobs={jobs}
            cashierName={cashierName}
            cashierId={cashierId}
            onRefresh={() => void load()}
          />
        ))}
      </div>
    </div>
  );
}
