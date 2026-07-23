import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, CreditCard, Printer, Trash2, AlertCircle,
  ShoppingBag, UtensilsCrossed, Truck, Clock, GitBranch,
} from 'lucide-react';
import { fetchCashierOrders, cancelOrder, updateOrderPayment, completeOrder } from '../../api/orders';
import { reprintJob, fetchReceiptJobs } from '../../api/billing';
import { PaymentModal } from './PaymentModal';
import { OrderTimelineModal } from './OrderTimelineModal';
import type { PaymentResult } from './PaymentModal';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { useCashierPermissions } from '../../hooks/useCashierPermissions';
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
  const perms = useCashierPermissions();
  const [expanded, setExpanded] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const paymentCompletedRef = useRef(false);

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
              <button
                type="button"
                title="Order Timeline"
                onClick={() => setShowTimeline(true)}
                className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist"
              >
                <GitBranch size={13} />
              </button>
              {receiptJob && (
                <button
                  type="button"
                  title={perms.canVoidOrder ? 'Reprint' : 'Reprint — permission required'}
                  onClick={() => { if (perms.canVoidOrder) void handleReprint(); }}
                  disabled={reprinting || !perms.canVoidOrder}
                  className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {reprinting ? <Spinner size="sm" /> : <Printer size={13} />}
                </button>
              )}
              <button
                type="button"
                title={perms.canCancelOrder ? 'Cancel order' : 'Cancel — permission required'}
                onClick={() => { if (perms.canCancelOrder) setShowCancel(true); }}
                disabled={!perms.canCancelOrder}
                className="rounded-lg border border-border p-1.5 text-ink/40 hover:border-red-200 hover:bg-red-50 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-ink/40"
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
        <PaymentModal
          sym={sym}
          orderNumber={order.orderNumber}
          tableNumber={order.tableNumber}
          customerName={order.customerName}
          items={order.items}
          subtotal={order.subtotal}
          taxTotal={order.taxTotal}
          appliedDiscount={order.discountAmount ?? 0}
          onConfirm={async (result: PaymentResult) => {
            await updateOrderPayment(order._id, result.method, result.splitDetails);
            await completeOrder(order._id);
            paymentCompletedRef.current = true;
          }}
          onClose={() => {
            setShowPay(false);
            if (paymentCompletedRef.current) {
              paymentCompletedRef.current = false;
              onRefresh();
            }
          }}
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

      {showTimeline && (
        <OrderTimelineModal
          order={order}
          onClose={() => setShowTimeline(false)}
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
