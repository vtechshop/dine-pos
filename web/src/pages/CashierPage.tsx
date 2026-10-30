import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, Bell, LogOut,
  TrendingUp, ShoppingBag, AlertCircle, RefreshCw,
  X, Monitor,
} from 'lucide-react';
import { useShortcut } from '../hooks/useShortcut';
import { useCashier, calcCartTotals, type CashierTab } from '../context/CashierContext';
import { DISPLAY_KEY, type CustomerDisplayData } from './CustomerDisplayPage';
import { useNotifications } from '../context/NotificationContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { OfflineBanner } from '../components/cashier/OfflineBanner';
import { syncNow } from '../sync/syncEngine';
import { useOrderSyncStatus } from '../hooks/useOrderSyncStatus';
import { fetchSalesSummary, fetchPrinterDevices } from '../api/dashboard';
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
import { ZReportView }            from '../components/cashier/ZReportView';
import { ShiftHistoryPanel }      from '../components/cashier/ShiftHistoryPanel';
import { CashierQuickSearch }     from '../components/cashier/CashierQuickSearch';
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
    name: ((payload.cashierName ?? payload.name) as string | undefined) ?? 'Cashier',
    code: (payload.employeeCode as string | undefined) ?? '',
  };
}

// ── Header KPI strip ──────────────────────────────────────────────────────────

function HeaderKpi({
  report, drawerBalance, sym, offlinePrinters, dark = false,
}: {
  report: DailyReport | null;
  drawerBalance: number;
  sym: string;
  offlinePrinters: number;
  dark?: boolean;
}) {
  return (
    <div className={`flex items-center overflow-x-auto pb-0.5 scrollbar-hide ${dark ? 'gap-2' : 'gap-3'}`}>
      <KpiChip dark={dark} label="Sales"  value={fmtINR(sym, report?.totalSales ?? 0)}                   icon={<TrendingUp size={11} />} accent />
      <KpiChip dark={dark} label="Bills"  value={String(report?.totalOrders ?? 0)}                        icon={<ShoppingBag size={11} />} />
      <KpiChip dark={dark} label="Cash"   value={fmtINR(sym, report?.paymentBreakdown?.cash ?? 0)}        icon={<Wallet size={11} />} />
      <KpiChip dark={dark} label="Drawer" value={fmtINR(sym, drawerBalance)}                              icon={<Wallet size={11} />} />
      {offlinePrinters > 0 && (
        <KpiChip dark={dark} label="Printer" value={`${offlinePrinters} offline`} icon={<AlertCircle size={11} />} warn />
      )}
    </div>
  );
}

function KpiChip({ label, value, icon, accent, warn, dark }: {
  label: string; value: string; icon: React.ReactNode; accent?: boolean; warn?: boolean; dark?: boolean;
}) {
  const box = dark
    ? (accent ? 'border-brand/40 bg-brand/15' : warn ? 'border-amber-400/40 bg-amber-400/10' : 'border-white/10 bg-white/[0.05]')
    : (accent ? 'border-brand/20 bg-brand/5'  : warn ? 'border-amber-200 bg-amber-50'       : 'border-border bg-canvas');
  const iconCls = accent ? 'text-brand' : warn ? (dark ? 'text-amber-300' : 'text-amber-500') : (dark ? 'text-white/40' : 'text-ink/35');
  const valueCls = accent ? 'text-brand' : warn ? (dark ? 'text-amber-300' : 'text-amber-700') : (dark ? 'text-white' : 'text-ink');
  return (
    <div className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 ${dark ? 'py-1' : 'py-1.5'} ${box}`}>
      <span className={iconCls}>{icon}</span>
      <div>
        <p className={`text-[9px] font-semibold uppercase tracking-wide ${dark ? 'text-white/45' : 'text-ink/40'}`}>{label}</p>
        <p className={`text-xs font-bold leading-none ${valueCls}`}>{value}</p>
      </div>
    </div>
  );
}

/** The top bar's page slot, on wide screens only (null = render the header inline). */
function useTopBarSlot(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setEl(mq.matches ? document.getElementById('topbar-page-slot') : null);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return el;
}

// ── Notification bell (uses NotificationContext) ───────────────────────────────

const SEVERITY_CLS: Record<'critical' | 'warning' | 'info', string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  warning:  'border-amber-200 bg-amber-50 text-amber-700',
  info:     'border-blue-200 bg-blue-50 text-blue-700',
};

function NotificationBell({ dark = false }: { dark?: boolean }) {
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
            ? (dark ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-600')
            : (dark ? 'border-white/15 text-white/55 hover:bg-white/[0.08]' : 'border-border text-ink/40 hover:bg-mist')
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
  const { activeTab, setActiveTab, heldBills, shift, drawerBalance, cart, selectedShiftId } = useCashier();
  const { settings } = useSettings();
  const { logout, hotelId, role } = useAuth();
  const { connected: socketConnected } = useSocket();
  const sym = settings?.currencySymbol ?? '₹';
  const topBarSlot = useTopBarSlot();

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

  // ── Offline order queue (IndexedDB) and sync engine ────────────────────────
  // The engine owns retries, backoff and the single sync lock; this page only shows its state.
  const orderSync = useOrderSyncStatus(hotelId);

  // Reconnect-triggered sync, as before — through the same global lock as every other trigger.
  useEffect(() => {
    if (socketConnected && hotelId) void syncNow(hotelId);
  }, [socketConnected, hotelId]);

  // Header data
  const [report, setReport]     = useState<DailyReport | null>(null);
  const [printers, setPrinters] = useState<PrinterDeviceStatus[]>([]);
  const [nowMs, setNowMs]       = useState(() => Date.now());

  const loadHeader = useCallback(async () => {
    let cancelled = false;
    const [rptRes, prtRes] = await Promise.allSettled([
      fetchSalesSummary(role),   // cashier: own shift; admin: whole day
      fetchPrinterDevices(),
    ]);
    if (!cancelled) {
      if (rptRes.status === 'fulfilled') setReport(rptRes.value);
      if (prtRes.status === 'fulfilled') setPrinters(prtRes.value);
      setNowMs(Date.now());
    }
    return () => { cancelled = true; };
  }, [role]);

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

  // inTopBar = rendered inside the (light) top bar on wide screens; otherwise its own row.
  // Only the layout differs — colours are the same light style in both places.
  const actionCls = (dark: boolean) => dark
    ? 'rounded-lg border border-white/15 p-1.5 text-white/55 transition hover:bg-white/[0.08] hover:text-white'
    : 'rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist hover:text-ink/70';

  const headerBar = (inTopBar: boolean) => (
    <div className={`flex min-w-0 items-center gap-3 ${inTopBar ? 'flex-1' : ''}`}>
      {/* Profile chip */}
      <button
        type="button"
        onClick={() => setActiveTab('profile')}
        className={`flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-mist`}
        title="My Profile"
      >
        <div className={`flex shrink-0 items-center justify-center rounded-full bg-brand/10 font-bold text-brand ${inTopBar ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm'}`}>
          {identity.name.charAt(0).toUpperCase()}
        </div>
        <div className={`text-left ${inTopBar ? 'hidden xl:block' : 'hidden sm:block'}`}>
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
      <div className="min-w-0 flex-1 overflow-x-auto">
        <HeaderKpi
          report={report}
          drawerBalance={drawerBalance}
          sym={sym}
          offlinePrinters={offlinePrinters}
          dark={false}
        />
      </div>

      {/* Jump to a screen by name */}
      <CashierQuickSearch />

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <NotificationBell />
        <button type="button" onClick={openCustomerDisplay} className={actionCls(false)} title="Customer Display (second screen)">
          <Monitor size={13} />
        </button>
        <button type="button" onClick={() => void loadHeader()} className={actionCls(false)} title="Refresh (F5)">
          <RefreshCw size={13} />
        </button>
        {/* The top bar already has a sign-out button */}
        {!inTopBar && (
          <button type="button" onClick={() => void logout()} className={actionCls(false)} title="Logout">
            <LogOut size={13} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {/* ── Header: in the top bar on wide screens, its own row otherwise ──── */}
      {topBarSlot
        ? createPortal(headerBar(true), topBarSlot)
        : (
          <header className="shrink-0 border-b border-border bg-canvas px-4 py-2.5">
            {headerBar(false)}
          </header>
        )}

      {/* ── Offline banner ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-2">
        <OfflineBanner
          socketConnected={socketConnected}
          summary={orderSync.summary}
          syncing={orderSync.syncing}
          onSyncNow={orderSync.syncNow}
          onRetryFailed={id => void orderSync.retryFailed(id)}
        />
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
        {activeTab === 'profile'       && <CashierProfilePanel />}
        {activeTab === 'permissions'   && <PermissionsPanel />}
        {activeTab === 'z-report'      && <ZReportView shiftId={selectedShiftId} />}
        {activeTab === 'shift-history' && <ShiftHistoryPanel />}
      </main>
    </div>
  );
}
