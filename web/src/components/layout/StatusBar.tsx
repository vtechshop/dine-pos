import { useEffect, useCallback, useState } from 'react';
import { TrendingUp, ShoppingCart, LayoutGrid, Printer, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';
import { useLiveOrders } from '../../context/LiveOrdersContext';
import { fetchDailyReport, fetchPrinterDevices } from '../../api/dashboard';
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
    <div className={`flex items-center gap-1.5 ${dim ? 'opacity-30' : ''}`}>
      <span className="text-gray-500">{icon}</span>
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-xs font-semibold text-gray-200 tabular-nums">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-3.5 w-px bg-gray-700" />;
}

// ── Status bar ────────────────────────────────────────────────────────────────

export function StatusBar() {
  const { connected, reconnecting, reconnectCount } = useSocket();
  const { orders: liveOrders } = useLiveOrders();
  const { settings } = useSettings();
  const symbol = settings?.currencySymbol ?? '₹';

  const [report,  setReport]  = useState<DailyReport | null>(null);
  const [devices, setDevices] = useState<PrinterDeviceStatus[]>([]);

  const load = useCallback(async () => {
    const [r, d] = await Promise.allSettled([fetchDailyReport(), fetchPrinterDevices()]);
    if (r.status === 'fulfilled') setReport(r.value);
    if (d.status === 'fulfilled') setDevices(d.value);
  }, []);

  // Initial fetch + refresh on every reconnect
  useEffect(() => { void load(); }, [load, reconnectCount]);

  const kitchen = devices.find(d => d.printerRole === 'kitchen');
  const cashier = devices.find(d => d.printerRole === 'cashier');
  const printersOnline = (kitchen?.online ?? false) || (cashier?.online ?? false);

  // Live orders count = today's backend orders + socket orders received this session
  const totalOrders = (report?.totalOrders ?? 0) + liveOrders.filter(o => o.isNew).length;

  // Active tables: use live orders to estimate (table grid is the source of truth)
  const revenue = report
    ? `${symbol}${Math.round(report.totalSales).toLocaleString('en-IN')}`
    : '—';

  return (
    <footer className="flex h-10 shrink-0 items-center justify-between border-t border-gray-700/60 bg-gray-900 px-5">
      {/* Left: stat chips */}
      <div className="flex items-center gap-4">
        <Chip icon={<TrendingUp size={12} />}  label="Revenue" value={revenue} dim={!report} />
        <Divider />
        <Chip icon={<ShoppingCart size={12} />} label="Orders"  value={report?.totalOrders ?? '—'} dim={!report} />
        <Divider />
        <Chip icon={<LayoutGrid size={12} />}   label="Tables"  value={liveOrders.length > 0 ? `${new Set(liveOrders.map(o => o.tableNumber)).size} active` : '—'} />
        <Divider />
        {/* Future feature placeholders */}
        <span className="text-[10px] text-gray-600">Reservations</span>
        <span className="text-[10px] text-gray-600">Cleaning</span>
        <span className="text-[10px] text-gray-600">Online Orders</span>
      </div>

      {/* Right: printer + socket + keyboard hints */}
      <div className="flex items-center gap-4">
        {/* Keyboard shortcut hints */}
        <div className="hidden items-center gap-2 xl:flex">
          {(['F1 Search', 'F2 New Order', 'F3 Tables', 'F4 Customers'] as const).map(hint => (
            <span key={hint} className="text-[9px] font-mono text-gray-600 tracking-wide">{hint}</span>
          ))}
          <Divider />
        </div>

        {/* Printer status */}
        <div className="flex items-center gap-1.5">
          <Printer size={12} className={printersOnline ? 'text-green-500' : 'text-gray-600'} />
          <span className={`text-[10px] ${printersOnline ? 'text-green-400' : 'text-gray-600'}`}>
            {devices.length === 0 ? 'No printer' : printersOnline ? 'Printer OK' : 'Printer offline'}
          </span>
        </div>

        <Divider />

        {/* Socket status */}
        <div className="flex items-center gap-1.5">
          {reconnecting ? (
            <RefreshCw size={12} className="animate-spin text-yellow-500" />
          ) : connected ? (
            <Wifi size={12} className="text-green-500" />
          ) : (
            <WifiOff size={12} className="text-gray-500" />
          )}
          <span className={`text-[10px] font-medium ${
            reconnecting ? 'text-yellow-400 animate-pulse'
            : connected  ? 'text-green-400'
            : 'text-gray-500'
          }`}>
            {reconnecting ? 'Reconnecting…' : connected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>
    </footer>
  );
}
