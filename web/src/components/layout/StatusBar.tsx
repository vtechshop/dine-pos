import { useEffect, useCallback, useState } from 'react';
import { TrendingUp, ShoppingCart, LayoutGrid, Printer, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';
import { useLiveOrders } from '../../context/LiveOrdersContext';
import { fetchSalesSummary, fetchPrinterDevices } from '../../api/dashboard';
import { useAuth } from '../../context/AuthContext';
import type { DailyReport, PrinterDeviceStatus } from '../../types';
import { useSettings } from '../../context/SettingsContext';

// ── Stat chip ─────────────────────────────────────────────────────────────────

interface ChipProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  dim?: boolean;
}

function Chip({ icon, label, value, dim }: ChipProps) {
  return (
    <div className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap ${dim ? 'opacity-50' : ''}`} title={label}>
      <span className="text-ink/40">{icon}</span>
      {/* Phones: icon + value only */}
      <span className="hidden text-xs text-ink/55 sm:inline">{label}</span>
      <span className="text-xs font-semibold text-ink tabular-nums">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-3.5 w-px bg-border" />;
}

// ── Status bar ────────────────────────────────────────────────────────────────

export function StatusBar() {
  const { connected, reconnecting, reconnectCount } = useSocket();
  const { orders: liveOrders } = useLiveOrders();
  const { settings } = useSettings();
  const { role } = useAuth();
  const symbol = settings?.currencySymbol ?? '₹';

  const [report,  setReport]  = useState<DailyReport | null>(null);
  const [devices, setDevices] = useState<PrinterDeviceStatus[]>([]);

  const load = useCallback(async () => {
    // Admin: whole day; cashier: own shift; other roles: no sales figures (they'd get 403)
    const [r, d] = await Promise.allSettled([fetchSalesSummary(role), fetchPrinterDevices()]);
    if (r.status === 'fulfilled') setReport(r.value);
    if (d.status === 'fulfilled') setDevices(d.value);
  }, [role]);

  // Initial fetch + refresh on every reconnect
  useEffect(() => { void load(); }, [load, reconnectCount]);

  const kitchen = devices.find(d => d.printerRole === 'kitchen');
  const cashier = devices.find(d => d.printerRole === 'cashier');
  const printersOnline = (kitchen?.online ?? false) || (cashier?.online ?? false);

  // Active tables: use live orders to estimate (table grid is the source of truth)
  const revenue = report
    ? `${symbol}${Math.round(report.totalSales).toLocaleString('en-IN')}`
    : '—';

  return (
    <footer className="flex h-10 shrink-0 items-center justify-between gap-3 overflow-hidden whitespace-nowrap border-t border-border bg-canvas px-3 sm:px-5">
      {/* Left: stat chips */}
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <Chip icon={<TrendingUp size={12} />}  label="Revenue" value={revenue} dim={!report} />
        <Divider />
        <Chip icon={<ShoppingCart size={12} />} label="Orders"  value={report?.totalOrders ?? '—'} dim={!report} />
        <Divider />
        <Chip icon={<LayoutGrid size={12} />}   label="Tables"  value={liveOrders.length > 0 ? `${new Set(liveOrders.map(o => o.tableNumber)).size} active` : '—'} />
      </div>

      {/* Right: printer + socket + keyboard hints */}
      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        {/* Keyboard shortcut hints */}
        <div className="hidden items-center gap-2 xl:flex">
          {(['F1 Search', 'F2 New Order', 'F3 Tables', 'F4 Customers'] as const).map(hint => (
            <span key={hint} className="text-[9px] font-mono text-ink/40 tracking-wide">{hint}</span>
          ))}
          <Divider />
        </div>

        {/* Printer status — green/gray are semantic online/offline indicators */}
        <div className="flex items-center gap-1.5" title={devices.length === 0 ? 'No printer' : printersOnline ? 'Printer OK' : 'Printer offline'}>
          <Printer size={12} className={printersOnline ? 'text-green-500' : 'text-ink/35'} />
          <span className={`hidden text-[10px] sm:inline ${printersOnline ? 'text-green-600' : 'text-ink/35'}`}>
            {devices.length === 0 ? 'No printer' : printersOnline ? 'Printer OK' : 'Printer offline'}
          </span>
        </div>

        <Divider />

        {/* Socket status — yellow/green/white are semantic connection indicators */}
        <div className="flex items-center gap-1.5">
          {reconnecting ? (
            <RefreshCw size={12} className="animate-spin text-yellow-500" />
          ) : connected ? (
            <Wifi size={12} className="text-green-500" />
          ) : (
            <WifiOff size={12} className="text-ink/35" />
          )}
          <span className={`text-[10px] font-medium ${
            reconnecting ? 'text-amber-600 animate-pulse'
            : connected  ? 'text-green-600'
            : 'text-ink/35'
          }`}>
            {reconnecting ? 'Reconnecting…' : connected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>
    </footer>
  );
}
