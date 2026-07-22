import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag, TrendingUp, Wallet, Clock, Users,
  Wifi, WifiOff, Printer, Cloud, CloudOff,
  Plus, Search, BarChart2, Layers, AlertTriangle,
  CheckCircle, Bell, CreditCard, Truck, UtensilsCrossed,
  RefreshCw, ChevronRight,
} from 'lucide-react';
import { useCashier } from '../../context/CashierContext';
import { useNotifications } from '../../context/NotificationContext';
import { useSocket } from '../../context/SocketContext';
import { useSettings } from '../../context/SettingsContext';
import { fetchDailyReport } from '../../api/dashboard';
import { fetchCashierOrders } from '../../api/orders';
import { fetchProductSalesReport } from '../../api/reports';
import type { DailyReport } from '../../types';
import type { CashierOrderItem } from '../../api/orders';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDuration(openedAt: string, nowMs: number) {
  const ms = nowMs - new Date(openedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon, color, onClick,
}: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; color: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
        onClick ? 'hover:shadow-sm active:scale-[0.98]' : 'cursor-default'
      } ${color}`}
    >
      <div className="shrink-0 rounded-lg p-2 bg-white/60">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-[10px] opacity-60 truncate">{sub}</p>}
      </div>
    </button>
  );
}

// ── Status indicator ──────────────────────────────────────────────────────────

function StatusDot({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink">{label}</p>
        {detail && <p className="text-[10px] text-ink/45 truncate">{detail}</p>}
      </div>
      {ok
        ? <CheckCircle size={12} className="ml-auto shrink-0 text-emerald-500" />
        : <AlertTriangle size={12} className="ml-auto shrink-0 text-red-500" />
      }
    </div>
  );
}

// ── Quick action button ───────────────────────────────────────────────────────

function QuickAction({
  icon, label, sub, onClick, badge, variant = 'default',
}: {
  icon: React.ReactNode; label: string; sub?: string;
  onClick: () => void; badge?: number;
  variant?: 'default' | 'primary' | 'success' | 'warning';
}) {
  const cls = {
    default: 'border-border bg-canvas text-ink hover:border-brand/30 hover:shadow-sm',
    primary: 'border-brand/30 bg-brand text-white hover:bg-brand/90',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
    warning: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl border p-4 transition active:scale-[0.97] ${cls}`}
    >
      {badge != null && badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
      {icon}
      <span className="text-xs font-semibold leading-tight text-center">{label}</span>
      {sub && <span className="text-[10px] opacity-60 leading-none">{sub}</span>}
    </button>
  );
}

// ── Recent order row ──────────────────────────────────────────────────────────

function RecentRow({ order, sym }: { order: CashierOrderItem; sym: string }) {
  const STATUS_CLS: Record<string, string> = {
    completed: 'text-emerald-600',
    cancelled: 'text-red-500',
    served: 'text-brand',
    pending: 'text-amber-600',
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-canvas px-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-ink">#{order.orderNumber}</p>
        <p className="text-[10px] text-ink/50 truncate">
          {order.customerName ?? (order.tableNumber ? `Table ${order.tableNumber}` : 'Walk-in')}
          {' · '}
          {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-bold text-ink">{fmtINR(sym, order.grandTotal)}</p>
        <p className={`text-[10px] font-medium capitalize ${STATUS_CLS[order.status] ?? 'text-ink/40'}`}>{order.status}</p>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface TopProduct { productName: string; totalQuantity: number; totalRevenue: number }

export function DashboardPanel() {
  const { shift, heldBills, drawerBalance, setActiveTab, setOrderPrefill } = useCashier();
  const { notifications, unreadCount } = useNotifications();
  const { connected: socketConnected } = useSocket();
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  // Live clock
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(t);
  }, []);

  // Interval for shift duration
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Internet status
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Remote data
  const [report, setReport] = useState<DailyReport | null>(null);
  const [orders, setOrders] = useState<CashierOrderItem[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    let cancelled = false;
    const today = new Date().toISOString().split('T')[0] ?? '';
    const [rptRes, ordRes, topRes] = await Promise.allSettled([
      fetchDailyReport(),
      fetchCashierOrders(),
      fetchProductSalesReport(today),
    ]);
    if (!cancelled) {
      if (rptRes.status === 'fulfilled') setReport(rptRes.value);
      if (ordRes.status === 'fulfilled') setOrders(ordRes.value);
      if (topRes.status === 'fulfilled') {
        const sorted = [...topRes.value.products]
          .sort((a, b) => b.totalQuantity - a.totalQuantity)
          .slice(0, 6);
        setTopProducts(sorted);
      }
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void loadData();
    const t = setInterval(() => void loadData(), 60_000);
    return () => clearInterval(t);
  }, [loadData]);

  // Derived counts
  const pendingCount = orders.filter(o => o.status === 'served' || o.status === 'pending').length;
  const recentOrders = orders
    .filter(o => o.status === 'completed' || o.status === 'cancelled')
    .slice(0, 6);

  const avgBill = report && report.totalOrders > 0
    ? report.totalSales / report.totalOrders
    : 0;

  // Notification severity counts
  const criticalCount = notifications.filter(n => n.severity === 'critical' && !n.read).length;
  const hasPrinterIssue = notifications.some(n => n.category === 'printer_offline');

  return (
    <div className="space-y-4 pb-4">
      {/* ── Clock + date ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold tabular-nums text-ink">{fmtTime(now)}</p>
          <p className="text-xs text-ink/50">{fmtDate(now)}</p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
              criticalCount > 0 ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}>
              <Bell size={12} />
              {unreadCount} alert{unreadCount !== 1 ? 's' : ''}
            </div>
          )}
          <button
            type="button"
            onClick={() => { setLoading(true); void loadData(); }}
            className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Shift status bar ──────────────────────────────────────────────── */}
      <div className={`rounded-xl border p-3 ${
        shift?.status === 'open'
          ? 'border-emerald-200 bg-emerald-50/60'
          : 'border-amber-200 bg-amber-50/60'
      }`}>
        <div className="flex items-center gap-3">
          <Clock size={16} className={shift?.status === 'open' ? 'text-emerald-600' : 'text-amber-600'} />
          <div className="flex-1">
            {shift?.status === 'open' ? (
              <>
                <p className="text-sm font-semibold text-emerald-800">Shift Open</p>
                <p className="text-[10px] text-emerald-700/70">
                  Since {new Date(shift.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}Duration: {fmtDuration(shift.openedAt, nowMs)}
                  {' · '}Opening cash: {fmtINR(sym, shift.openingCash)}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-amber-800">No Active Shift</p>
                <p className="text-[10px] text-amber-700/70">Open a shift before taking payments</p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('shift')}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              shift?.status === 'open'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}
          >
            {shift?.status === 'open' ? 'Close Shift' : 'Open Shift'}
          </button>
        </div>
      </div>

      {/* ── KPI grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard
          label="Today's Sales"
          value={fmtINR(sym, report?.totalSales ?? 0)}
          sub={`${report?.totalOrders ?? 0} orders`}
          icon={<TrendingUp size={16} className="text-brand" />}
          color="border-brand/20 bg-brand/5 text-brand"
          onClick={() => setActiveTab('search')}
        />
        <KpiCard
          label="Bills Today"
          value={String(report?.totalOrders ?? 0)}
          sub={`Avg ${fmtINR(sym, avgBill)}`}
          icon={<ShoppingBag size={16} className="text-blue-600" />}
          color="border-blue-100 bg-blue-50 text-blue-800"
          onClick={() => setActiveTab('search')}
        />
        <KpiCard
          label="Pending Payment"
          value={String(pendingCount)}
          sub="Awaiting collection"
          icon={<CreditCard size={16} className="text-amber-600" />}
          color={`border-amber-100 bg-amber-50 text-amber-800 ${pendingCount > 0 ? 'ring-1 ring-amber-300' : ''}`}
          onClick={pendingCount > 0 ? () => setActiveTab('pending') : undefined}
        />
        <KpiCard
          label="Hold Bills"
          value={String(heldBills.length)}
          sub="Parked orders"
          icon={<Layers size={16} className="text-purple-600" />}
          color="border-purple-100 bg-purple-50 text-purple-800"
          onClick={heldBills.length > 0 ? () => setActiveTab('hold') : undefined}
        />
        <KpiCard
          label="Drawer Balance"
          value={fmtINR(sym, drawerBalance)}
          sub={`Cash: ${fmtINR(sym, report?.paymentBreakdown?.cash ?? 0)}`}
          icon={<Wallet size={16} className="text-emerald-600" />}
          color="border-emerald-100 bg-emerald-50 text-emerald-800"
          onClick={() => setActiveTab('drawer')}
        />
        <KpiCard
          label="Customers Served"
          value={String(report?.totalOrders ?? 0)}
          sub={`UPI: ${fmtINR(sym, report?.paymentBreakdown?.upi ?? 0)}`}
          icon={<Users size={16} className="text-ink/60" />}
          color="border-border bg-canvas text-ink"
        />
      </div>

      {/* ── Payment breakdown ─────────────────────────────────────────────── */}
      {report && (
        <div className="rounded-xl border border-border bg-canvas p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink/40">Payment Breakdown — Today</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {([
              { label: 'Cash', val: report.paymentBreakdown.cash, cls: 'text-emerald-700' },
              { label: 'UPI', val: report.paymentBreakdown.upi, cls: 'text-brand' },
              { label: 'Card', val: report.paymentBreakdown.card, cls: 'text-blue-600' },
              { label: 'Split', val: report.paymentBreakdown.split, cls: 'text-purple-600' },
            ] as const).map(({ label, val, cls }) => (
              <div key={label}>
                <p className="text-[10px] text-ink/50">{label}</p>
                <p className={`text-sm font-bold ${cls}`}>{fmtINR(sym, val ?? 0)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── System status ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-canvas p-3">
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink/40">System Status</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusDot
            ok={isOnline}
            label="Internet"
            detail={isOnline ? 'Connected' : 'Offline'}
          />
          <StatusDot
            ok={socketConnected}
            label="Live Data"
            detail={socketConnected ? 'Synced' : 'Reconnecting…'}
          />
          <StatusDot
            ok={!hasPrinterIssue}
            label="Printers"
            detail={hasPrinterIssue ? 'Issue detected' : 'All online'}
          />
          <StatusDot
            ok={isOnline && socketConnected}
            label="Cloud Sync"
            detail={isOnline && socketConnected ? 'Live' : 'Degraded'}
          />
        </div>
      </div>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink/40">Quick Actions</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <QuickAction
            icon={<Plus size={20} />}
            label="New Order"
            sub="Ctrl+N"
            onClick={() => setActiveTab('new-order')}
            variant="primary"
          />
          <QuickAction
            icon={<UtensilsCrossed size={20} />}
            label="Tables"
            sub="Dine In"
            onClick={() => setActiveTab('tables')}
          />
          <QuickAction
            icon={<CreditCard size={20} />}
            label="Pending Bills"
            sub="F6"
            badge={pendingCount}
            onClick={() => setActiveTab('pending')}
            variant={pendingCount > 0 ? 'warning' : 'default'}
          />
          <QuickAction
            icon={<Search size={20} />}
            label="Bill Search"
            sub="Ctrl+F"
            onClick={() => setActiveTab('search')}
          />
          <QuickAction
            icon={<Users size={20} />}
            label="Customer"
            sub="Lookup"
            onClick={() => setActiveTab('customers')}
          />
          <QuickAction
            icon={<Wallet size={20} />}
            label="Cash Drawer"
            onClick={() => setActiveTab('drawer')}
          />
          <QuickAction
            icon={<Truck size={20} />}
            label="Takeaway"
            onClick={() => {
              setOrderPrefill({ orderType: 'takeaway' });
              setActiveTab('new-order');
            }}
          />
          <QuickAction
            icon={<BarChart2 size={20} />}
            label="Shift"
            onClick={() => setActiveTab('shift')}
          />
          <QuickAction
            icon={<Printer size={20} />}
            label="Printers"
            badge={hasPrinterIssue ? 1 : 0}
            onClick={() => setActiveTab('printers')}
            variant={hasPrinterIssue ? 'warning' : 'default'}
          />
        </div>
      </div>

      {/* ── Active alerts ─────────────────────────────────────────────────── */}
      {notifications.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink/40">Active Alerts</p>
          <div className="space-y-1.5">
            {notifications.slice(0, 5).map(n => (
              <div
                key={n.id}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                  n.severity === 'critical' ? 'border-red-200 bg-red-50' :
                  n.severity === 'warning'  ? 'border-amber-200 bg-amber-50' :
                                             'border-border bg-canvas'
                }`}
              >
                <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${
                  n.severity === 'critical' ? 'text-red-500' :
                  n.severity === 'warning'  ? 'text-amber-500' : 'text-ink/40'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-ink">{n.title}</p>
                  <p className="text-[10px] text-ink/60 truncate">{n.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Bottom: recent transactions + top products ─────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent transactions */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Recent Transactions</p>
            <button
              type="button"
              onClick={() => setActiveTab('search')}
              className="flex items-center gap-1 text-[10px] font-medium text-brand hover:underline"
            >
              View all <ChevronRight size={10} />
            </button>
          </div>
          {recentOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-6 text-center">
              <p className="text-xs text-ink/40">No completed orders yet today</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentOrders.map(o => (
                <RecentRow key={o._id} order={o} sym={sym} />
              ))}
            </div>
          )}
        </div>

        {/* Top products today */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Top Selling Today</p>
            <span className="text-[10px] text-ink/35">by quantity</span>
          </div>
          {topProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-6 text-center">
              <p className="text-xs text-ink/40">No product data yet</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {topProducts.map((p, i) => (
                <div key={p.productName} className="flex items-center gap-3 rounded-lg border border-border bg-canvas px-3 py-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink truncate">{p.productName}</p>
                    <p className="text-[10px] text-ink/45">{p.totalQuantity} sold</p>
                  </div>
                  <p className="shrink-0 text-xs font-semibold text-ink">{fmtINR(sym, p.totalRevenue)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
