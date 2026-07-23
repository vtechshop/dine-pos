import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, CreditCard, PauseCircle, BarChart2,
  Wallet, Search, Users, Printer, Bell, LogOut,
  TrendingUp, ShoppingBag, AlertCircle, RefreshCw,
  Home, LayoutGrid, Flame, UserCircle, X, Monitor, Shield, Truck,
} from 'lucide-react';
import { useShortcut } from '../hooks/useShortcut';
import { useCashier, calcCartTotals, type CashierTab } from '../context/CashierContext';
import { DISPLAY_KEY, type CustomerDisplayData } from './CustomerDisplayPage';
import { useNotifications } from '../context/NotificationContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { OfflineBanner } from '../components/cashier/OfflineBanner';
import { getQueue } from '../utils/offlineQueue';
import { createOrder, completeOrder } from '../api/orders';
import { fetchDailyReport, fetchPrinterDevices } from '../api/dashboard';
import { NewOrderPanel }          from '../components/cashier/NewOrderPanel';
import { PendingBillsPanel }      from '../components/cashier/PendingBillsPanel';
import { HoldBillPanel }          from '../components/cashier/HoldBillPanel';
import { ShiftPanel }             from '../components/cashier/ShiftPanel';
import { CashDrawerPanel }        from '../components/cashier/CashDrawerPanel';
import { BillSearchPanel }        from '../components/cashier/BillSearchPanel';
import { CustomerPanel }          from '../components/cashier/CustomerPanel';
import { PrinterPanel }           from '../components/cashier/PrinterPanel';
import { DashboardPanel }         from '../components/cashier/DashboardPanel';
import { CashierTablePanel }      from '../components/cashier/CashierTablePanel';
import { KitchenStatusPanel }     from '../components/cashier/KitchenStatusPanel';
import { CashierProfilePanel }    from '../components/cashier/CashierProfilePanel';
import { PermissionsPanel }       from '../components/cashier/PermissionsPanel';
import { OnlineOrdersPanel }      from '../components/cashier/OnlineOrdersPanel';
import type { DailyReport, PrinterDeviceStatus } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function parseJwt(key: string): Record<string, unknown> {
  try {
    const token = localStorage.getItem(key) ?? '';
    if (!token) return {};
    return JSON.parse(atob(token.split('.')[1])) as Record<string, unknown>;
  } catch { return {}; }
}

function getCashierIdentity() {
  const payload = parseJwt('pos_cashier_token') || parseJwt('pos_token');
  return {
    name: (payload.name as string | undefined) ?? 'Cashier',
    code: (payload.employeeCode as string | undefined) ?? '',
  };
}

// ── Tab config ────────────────────────────────────────────────────────────────

interface TabDef {
  key: CashierTab;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

const TABS: TabDef[] = [
  { key: 'dashboard',  icon: <Home size={15} />,          label: 'Dashboard',   shortcut: '' },
  { key: 'new-order',  icon: <Plus size={15} />,          label: 'New Order',   shortcut: 'Ctrl+N' },
  { key: 'pending',    icon: <CreditCard size={15} />,    label: 'Pending',     shortcut: 'F6' },
  { key: 'hold',       icon: <PauseCircle size={15} />,   label: 'Hold',        shortcut: '' },
  { key: 'tables',     icon: <LayoutGrid size={15} />,    label: 'Tables',      shortcut: 'Ctrl+T' },
  { key: 'kitchen',       icon: <Flame size={15} />,  label: 'Kitchen',       shortcut: 'Ctrl+K' },
  { key: 'online-orders', icon: <Truck size={15} />,  label: 'Online Orders', shortcut: 'Ctrl+O' },
  { key: 'search',        icon: <Search size={15} />, label: 'Bill Search',   shortcut: 'Ctrl+F' },
  { key: 'customers',  icon: <Users size={15} />,         label: 'Customers',   shortcut: 'F4' },
  { key: 'shift',      icon: <BarChart2 size={15} />,     label: 'Shift',       shortcut: '' },
  { key: 'drawer',     icon: <Wallet size={15} />,        label: 'Drawer',      shortcut: 'Ctrl+D' },
  { key: 'printers',   icon: <Printer size={15} />,       label: 'Printers',    shortcut: '' },
  { key: 'profile',      icon: <UserCircle size={15} />,  label: 'Profile',      shortcut: '' },
  { key: 'permissions',  icon: <Shield size={15} />,      label: 'Permissions',  shortcut: '' },
];

// ── Header KPI strip ──────────────────────────────────────────────────────────

function HeaderKpi({
  report, drawerBalance, sym, offlinePrinters,
}: {
  report: DailyReport | null;
  drawerBalance: number;
  sym: string;
  offlinePrinters: number;
}) {
  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-0.5 scrollbar-hide">
      <KpiChip label="Sales"  value={fmtINR(sym, report?.totalSales ?? 0)}                   icon={<TrendingUp size={11} />} accent />
      <KpiChip label="Bills"  value={String(report?.totalOrders ?? 0)}                        icon={<ShoppingBag size={11} />} />
      <KpiChip label="Cash"   value={fmtINR(sym, report?.paymentBreakdown?.cash ?? 0)}        icon={<Wallet size={11} />} />
      <KpiChip label="Drawer" value={fmtINR(sym, drawerBalance)}                              icon={<Wallet size={11} />} />
      {offlinePrinters > 0 && (
        <KpiChip label="Printer" value={`${offlinePrinters} offline`} icon={<AlertCircle size={11} />} warn />
      )}
    </div>
  );
}

function KpiChip({ label, value, icon, accent, warn }: {
  label: string; value: string; icon: React.ReactNode; accent?: boolean; warn?: boolean;
}) {
  return (
    <div className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
      accent ? 'border-brand/20 bg-brand/5' :
      warn   ? 'border-amber-200 bg-amber-50' :
               'border-border bg-canvas'
    }`}>
      <span className={accent ? 'text-brand' : warn ? 'text-amber-500' : 'text-ink/35'}>{icon}</span>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wide text-ink/40">{label}</p>
        <p className={`text-xs font-bold leading-none ${accent ? 'text-brand' : warn ? 'text-amber-700' : 'text-ink'}`}>{value}</p>
      </div>
    </div>
  );
}

// ── Notification bell (uses NotificationContext) ───────────────────────────────

const SEVERITY_CLS: Record<'critical' | 'warning' | 'info', string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  warning:  'border-amber-200 bg-amber-50 text-amber-700',
  info:     'border-blue-200 bg-blue-50 text-blue-700',
};

function NotificationBell() {
  const { notifications, unreadCount, markAllRead, dismiss } = useNotifications();
  const [open, setOpen] = useState(false);

  function handleOpen() {
    setOpen(o => {
      if (!o) markAllRead();
      return !o;
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className={`relative rounded-lg border p-1.5 transition ${
          unreadCount > 0
            ? 'border-amber-200 bg-amber-50 text-amber-600'
            : 'border-border text-ink/40 hover:bg-mist'
        }`}
        title="Notifications"
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-20 w-72 rounded-xl border border-border bg-canvas shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Notifications</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-ink/30 hover:text-ink/60"
            >
              <X size={13} />
            </button>
          </div>

          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <Bell size={18} className="mx-auto mb-2 text-ink/20" />
              <p className="text-xs text-ink/40">No alerts</p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {notifications.slice(0, 12).map(n => (
                <div
                  key={n.id}
                  className={`flex items-start gap-2 border-b border-border/60 px-3 py-2.5 last:border-0 ${
                    !n.read ? 'bg-mist/40' : ''
                  }`}
                >
                  <span className={`mt-0.5 shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold uppercase ${SEVERITY_CLS[n.severity]}`}>
                    {n.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-ink leading-tight">{n.title}</p>
                    <p className="text-[10px] text-ink/50 mt-0.5 line-clamp-2">{n.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(n.id)}
                    className="shrink-0 text-ink/20 hover:text-ink/60 transition"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CashierPage() {
  const navigate = useNavigate();
  const { activeTab, setActiveTab, heldBills, shift, drawerBalance, cart } = useCashier();
  const { settings } = useSettings();
  const { logout, hotelId } = useAuth();
  const { connected: socketConnected } = useSocket();
  const sym = settings?.currencySymbol ?? '₹';

  // ── Customer display window ────────────────────────────────────────────────
  const displayWindowRef = useRef<Window | null>(null);

  function openCustomerDisplay() {
    if (displayWindowRef.current && !displayWindowRef.current.closed) {
      displayWindowRef.current.focus();
      return;
    }
    displayWindowRef.current = window.open(
      '/customer-display',
      'pos_customer_display',
      'width=1280,height=720,menubar=no,toolbar=no,status=no,scrollbars=yes',
    );
  }

  // Publish cart state to localStorage whenever cart changes
  useEffect(() => {
    const { subtotal, taxTotal, grandTotal } = calcCartTotals(cart, 0);
    const payload: CustomerDisplayData = {
      hotelName: settings?.hotelName ?? '',
      sym: settings?.currencySymbol ?? '₹',
      items: cart.map(i => ({
        name: i.productName,
        qty: i.quantity,
        price: i.price,
        ...(i.notes ? { notes: i.notes } : {}),
      })),
      subtotal,
      taxTotal,
      grandTotal,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(payload));
  }, [cart, settings]);

  const identity = getCashierIdentity();

  // ── Offline queue sync ─────────────────────────────────────────────────────
  const [queueLen, setQueueLen] = useState(0);
  const [syncing, setSyncing]   = useState(false);
  // Ref guards concurrent runs without adding `syncing` to useCallback deps,
  // which would cause a new syncQueue reference on every setSyncing call and
  // trigger an infinite effect→syncQueue→setState→effect loop.
  const syncingRef = useRef(false);

  useEffect(() => {
    setQueueLen(hotelId ? getQueue(hotelId).length : 0);
  }, [hotelId, activeTab]);

  const syncQueue = useCallback(async () => {
    if (!hotelId || syncingRef.current) return;
    const { removeFromQueue } = await import('../utils/offlineQueue');
    const queue = getQueue(hotelId);
    if (queue.length === 0) { setQueueLen(0); return; }
    syncingRef.current = true;
    setSyncing(true);
    let remaining = queue.length;
    for (const entry of queue) {
      try {
        const payload = entry.payload as Parameters<typeof createOrder>[0];
        const created = await createOrder({ ...payload, offlineId: entry.id });
        if (payload.orderSource !== 'dine-in') {
          await completeOrder(created._id);
        }
        removeFromQueue(hotelId, entry.id);
        remaining--;
      } catch { /* leave in queue, will retry next sync */ }
    }
    setQueueLen(remaining);
    syncingRef.current = false;
    setSyncing(false);
  }, [hotelId]);

  // Auto-sync when socket reconnects
  useEffect(() => {
    if (socketConnected && hotelId) {
      const q = getQueue(hotelId);
      if (q.length > 0) void syncQueue();
    }
  }, [socketConnected, hotelId, syncQueue]);

  // Header data
  const [report, setReport]     = useState<DailyReport | null>(null);
  const [printers, setPrinters] = useState<PrinterDeviceStatus[]>([]);
  const [nowMs, setNowMs]       = useState(() => Date.now());

  const loadHeader = useCallback(async () => {
    let cancelled = false;
    const [rptRes, prtRes] = await Promise.allSettled([
      fetchDailyReport(),
      fetchPrinterDevices(),
    ]);
    if (!cancelled) {
      if (rptRes.status === 'fulfilled') setReport(rptRes.value);
      if (prtRes.status === 'fulfilled') setPrinters(prtRes.value);
      setNowMs(Date.now());
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void loadHeader();
    const t = setInterval(() => { void loadHeader(); }, 60_000);
    return () => clearInterval(t);
  }, [loadHeader]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useShortcut('F2', () => navigate('/cashier'));
  useShortcut('F4', () => setActiveTab('customers'));
  useShortcut('Escape', () => {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      switch (e.key.toLowerCase()) {
        case 'n': e.preventDefault(); setActiveTab('new-order'); break;
        case 'f': e.preventDefault(); setActiveTab('search');
          requestAnimationFrame(() => {
            const el = document.getElementById('cashier-bill-search');
            if (el) (el as HTMLInputElement).focus();
          });
          break;
        case 'b': e.preventDefault(); navigate('/dashboard'); break;
        case 'd': e.preventDefault(); setActiveTab('drawer'); break;
        case 't': e.preventDefault(); setActiveTab('tables'); break;
        case 'k': e.preventDefault(); setActiveTab('kitchen'); break;
        case 'p':
          if (e.shiftKey) { e.preventDefault(); setActiveTab('printers'); }
          else             { e.preventDefault(); setActiveTab('pending'); }
          break;
      }
    };
    const onFn = (e: KeyboardEvent) => {
      if (e.key === 'F5') { e.preventDefault(); void loadHeader(); }
      if (e.key === 'F6') { e.preventDefault(); setActiveTab('pending'); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onFn);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onFn);
    };
  }, [navigate, setActiveTab, loadHeader]);

  const offlinePrinters = printers.filter(
    p => !p.online || !p.lastHeartbeat ||
      nowMs - new Date(p.lastHeartbeat).getTime() >= 3 * 60_000,
  ).length;

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border bg-canvas px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* Profile chip */}
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className="flex items-center gap-2 rounded-lg hover:bg-mist px-1.5 py-1 transition"
            title="My Profile"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
              {identity.name.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold leading-tight text-ink">{identity.name}</p>
              <p className="text-[10px] text-ink/45">
                {identity.code && `${identity.code} · `}
                {shift?.status === 'open'
                  ? `Shift open · ${new Date(shift.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                  : 'No active shift'}
              </p>
            </div>
          </button>

          {/* KPI strip */}
          <div className="flex-1 overflow-x-auto">
            <HeaderKpi
              report={report}
              drawerBalance={drawerBalance}
              sym={sym}
              offlinePrinters={offlinePrinters}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <NotificationBell />
            <button
              type="button"
              onClick={openCustomerDisplay}
              className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist hover:text-ink/70"
              title="Customer Display (second screen)"
            >
              <Monitor size={13} />
            </button>
            <button
              type="button"
              onClick={() => void loadHeader()}
              className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist"
              title="Refresh (F5)"
            >
              <RefreshCw size={13} />
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist hover:text-ink/70"
              title="Logout"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Offline banner ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-2">
        <OfflineBanner
          socketConnected={socketConnected}
          queueLength={queueLen}
          onRetrySync={() => void syncQueue()}
          syncing={syncing}
        />
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 overflow-x-auto border-b border-border bg-canvas px-2">
        <div className="flex gap-0.5 py-1.5">
          {TABS.map(tab => {
            const badge = tab.key === 'hold' && heldBills.length > 0 ? heldBills.length : 0;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  active
                    ? 'bg-brand text-white'
                    : 'text-ink/60 hover:bg-mist hover:text-ink'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
                {badge > 0 && (
                  <span className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                    active ? 'bg-white text-brand' : 'bg-amber-400 text-white'
                  }`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Panel content ───────────────────────────────────────────────────── */}
      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === 'dashboard'  && <DashboardPanel />}
        {activeTab === 'new-order'  && <NewOrderPanel />}
        {activeTab === 'pending'    && <PendingBillsPanel />}
        {activeTab === 'hold'       && <HoldBillPanel />}
        {activeTab === 'tables'     && <CashierTablePanel />}
        {activeTab === 'kitchen'       && <KitchenStatusPanel />}
        {activeTab === 'online-orders' && <OnlineOrdersPanel />}
        {activeTab === 'shift'         && <ShiftPanel />}
        {activeTab === 'drawer'     && <CashDrawerPanel />}
        {activeTab === 'search'     && <BillSearchPanel />}
        {activeTab === 'customers'  && <CustomerPanel />}
        {activeTab === 'printers'    && <PrinterPanel />}
        {activeTab === 'profile'     && <CashierProfilePanel />}
        {activeTab === 'permissions' && <PermissionsPanel />}
      </main>
    </div>
  );
}
