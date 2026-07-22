import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, CreditCard, PauseCircle, BarChart2,
  Wallet, Search, Users, Printer, Bell, LogOut,
  TrendingUp, ShoppingBag, AlertCircle, RefreshCw,
} from 'lucide-react';
import { useShortcut } from '../hooks/useShortcut';
import { useCashier, type CashierTab } from '../context/CashierContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { fetchDailyReport, fetchPrinterDevices } from '../api/dashboard';
import { NewOrderPanel }      from '../components/cashier/NewOrderPanel';
import { PendingBillsPanel }  from '../components/cashier/PendingBillsPanel';
import { HoldBillPanel }      from '../components/cashier/HoldBillPanel';
import { ShiftPanel }         from '../components/cashier/ShiftPanel';
import { CashDrawerPanel }    from '../components/cashier/CashDrawerPanel';
import { BillSearchPanel }    from '../components/cashier/BillSearchPanel';
import { CustomerPanel }      from '../components/cashier/CustomerPanel';
import { PrinterPanel }       from '../components/cashier/PrinterPanel';
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
  const payload =
    parseJwt('pos_cashier_token') ||
    parseJwt('pos_token');
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
  { key: 'new-order',  icon: <Plus size={15} />,       label: 'New Order',  shortcut: 'Ctrl+N' },
  { key: 'pending',    icon: <CreditCard size={15} />,  label: 'Pending',    shortcut: 'F6' },
  { key: 'hold',       icon: <PauseCircle size={15} />, label: 'Hold',       shortcut: '' },
  { key: 'search',     icon: <Search size={15} />,      label: 'Bill Search', shortcut: 'Ctrl+F' },
  { key: 'customers',  icon: <Users size={15} />,       label: 'Customers',  shortcut: 'F4' },
  { key: 'shift',      icon: <BarChart2 size={15} />,   label: 'Shift',      shortcut: '' },
  { key: 'drawer',     icon: <Wallet size={15} />,      label: 'Drawer',     shortcut: '' },
  { key: 'printers',   icon: <Printer size={15} />,     label: 'Printers',   shortcut: '' },
];

// ── Header KPI strip ──────────────────────────────────────────────────────────

function HeaderKpi({
  report,
  drawerBalance,
  sym,
  offlinePrinters,
}: {
  report: DailyReport | null;
  drawerBalance: number;
  sym: string;
  offlinePrinters: number;
}) {
  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-0.5 scrollbar-hide">
      <KpiChip
        label="Sales"
        value={fmtINR(sym, report?.totalSales ?? 0)}
        icon={<TrendingUp size={11} />}
        accent
      />
      <KpiChip
        label="Bills"
        value={String(report?.totalOrders ?? 0)}
        icon={<ShoppingBag size={11} />}
      />
      <KpiChip
        label="Cash"
        value={fmtINR(sym, report?.paymentBreakdown?.cash ?? 0)}
        icon={<Wallet size={11} />}
      />
      <KpiChip
        label="Drawer"
        value={fmtINR(sym, drawerBalance)}
        icon={<Wallet size={11} />}
      />
      {offlinePrinters > 0 && (
        <KpiChip
          label="Printer"
          value={`${offlinePrinters} offline`}
          icon={<AlertCircle size={11} />}
          warn
        />
      )}
    </div>
  );
}

function KpiChip({
  label,
  value,
  icon,
  accent,
  warn,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
  warn?: boolean;
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

// ── Notifications bell (printer offline alerts) ───────────────────────────────

function AlertBell({ printers, nowMs }: { printers: PrinterDeviceStatus[]; nowMs: number }) {
  const [open, setOpen] = useState(false);

  const offline = printers.filter(
    p => !p.online || !p.lastHeartbeat ||
      nowMs - new Date(p.lastHeartbeat).getTime() >= 3 * 60_000,
  );

  if (offline.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative rounded-lg border border-amber-200 bg-amber-50 p-1.5 text-amber-600"
      >
        <Bell size={15} />
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
          {offline.length}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-56 rounded-xl border border-border bg-canvas shadow-lg">
          <p className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink/40">
            Alerts
          </p>
          {offline.map(p => (
            <div key={p._id} className="flex items-center gap-2 px-3 py-2">
              <Printer size={12} className="text-red-400" />
              <p className="text-xs text-ink">{p.printerName ?? 'Printer'} offline</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CashierPage() {
  const navigate = useNavigate();
  const { activeTab, setActiveTab, heldBills, shift, drawerBalance } = useCashier();
  const { settings } = useSettings();
  const { logout } = useAuth();
  const sym = settings?.currencySymbol ?? '₹';

  const identity = getCashierIdentity();

  // Header data
  const [report, setReport]         = useState<DailyReport | null>(null);
  const [printers, setPrinters]     = useState<PrinterDeviceStatus[]>([]);
  const [nowMs, setNowMs]           = useState(() => Date.now());

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
  // F2 → this page (already registered in Sidebar); handled externally
  useShortcut('F2', () => navigate('/cashier'));
  useShortcut('F4', () => setActiveTab('customers'));
  useShortcut('Escape', () => {
    // Allow modals / panels to intercept Escape before this fallback fires
  });

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
        case 'p':
          if (e.shiftKey) {
            e.preventDefault();
            // Ctrl+Shift+P — reprint last; delegate to PrinterPanel
            setActiveTab('printers');
          } else {
            e.preventDefault();
            setActiveTab('pending');
          }
          break;
      }
    };
    const onF5 = (e: KeyboardEvent) => {
      if (e.key === 'F5') { e.preventDefault(); void loadHeader(); }
      if (e.key === 'F6') { e.preventDefault(); setActiveTab('pending'); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onF5);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onF5);
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
          {/* Profile */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
              {identity.name.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-semibold leading-tight text-ink">{identity.name}</p>
              <p className="text-[10px] text-ink/45">
                {identity.code && `${identity.code} · `}
                {shift?.status === 'open'
                  ? `Shift open · ${new Date(shift.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                  : 'No active shift'}
              </p>
            </div>
          </div>

          {/* KPIs */}
          <div className="flex-1 overflow-x-auto">
            <HeaderKpi
              report={report}
              drawerBalance={drawerBalance}
              sym={sym}
              offlinePrinters={offlinePrinters}
            />
          </div>

          {/* Alerts + actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <AlertBell printers={printers} nowMs={nowMs} />
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
        {activeTab === 'new-order' && <NewOrderPanel />}
        {activeTab === 'pending'   && <PendingBillsPanel />}
        {activeTab === 'hold'      && <HoldBillPanel />}
        {activeTab === 'shift'     && <ShiftPanel />}
        {activeTab === 'drawer'    && <CashDrawerPanel />}
        {activeTab === 'search'    && <BillSearchPanel />}
        {activeTab === 'customers' && <CustomerPanel />}
        {activeTab === 'printers'  && <PrinterPanel />}
      </main>
    </div>
  );
}
