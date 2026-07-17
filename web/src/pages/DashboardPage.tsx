import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  ShoppingCart,
  Receipt,
  Printer,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { TopBar } from '../components/layout/TopBar';
import { StatCard } from '../components/ui/StatCard';
import { Spinner } from '../components/ui/Spinner';
import { fetchDailyReport, fetchPrinterDevices } from '../api/dashboard';
import { useSettings } from '../context/SettingsContext';
import { useSocket } from '../context/SocketContext';
import type { DailyReport, PrinterDeviceStatus } from '../types';

function fmt(value: number, symbol: string) {
  return `${symbol}${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function PaymentRow({ label, value, symbol, total }: { label: string; value: number; symbol: string; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-right text-xs font-medium text-gray-500">{label}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-20 text-right text-sm font-semibold text-gray-800 tabular-nums">
        {fmt(value, symbol)}
      </span>
      <span className="w-8 text-right text-xs text-gray-400">{pct}%</span>
    </div>
  );
}

function PrinterChip({ device }: { device: PrinterDeviceStatus }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <Printer size={15} className={device.online ? 'text-green-500' : 'text-gray-300'} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-800">
          {device.printerName ?? (device.printerRole === 'kitchen' ? 'Kitchen Printer' : 'Cashier Printer')}
        </p>
        <p className="text-xs text-gray-400 capitalize">{device.printerRole}</p>
      </div>
      <div className={`ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${device.online ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
        {device.online ? <Wifi size={10} /> : <WifiOff size={10} />}
        {device.online ? 'Online' : 'Offline'}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { settings } = useSettings();
  const { socket } = useSocket();
  const symbol = settings?.currencySymbol ?? '₹';

  const [report, setReport] = useState<DailyReport | null>(null);
  const [devices, setDevices] = useState<PrinterDeviceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentOrderCount, setRecentOrderCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, d] = await Promise.allSettled([fetchDailyReport(), fetchPrinterDevices()]);
      if (r.status === 'fulfilled') setReport(r.value);
      else setError(r.reason instanceof Error ? r.reason.message : 'Failed to load report');
      if (d.status === 'fulfilled') setDevices(d.value);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Real-time: increment order count on new_order socket event
  useEffect(() => {
    if (!socket) return;
    const handler = () => setRecentOrderCount(n => n + 1);
    socket.on('new_order', handler);
    return () => { socket.off('new_order', handler); };
  }, [socket]);

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="flex flex-col overflow-hidden">
      <TopBar title="Dashboard" />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Date + refresh */}
        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm text-gray-500">{today}</p>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading && !report ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
              <StatCard
                label="Today's Revenue"
                value={report ? fmt(report.totalSales, symbol) : '—'}
                sub="Excluding tax"
                accent="green"
                icon={<TrendingUp size={18} />}
              />
              <StatCard
                label="Total Orders"
                value={report ? report.totalOrders + recentOrderCount : '—'}
                sub={recentOrderCount > 0 ? `+${recentOrderCount} since load` : undefined}
                accent="blue"
                icon={<ShoppingCart size={18} />}
              />
              <StatCard
                label="Tax Collected"
                value={report ? fmt(report.totalTax, symbol) : '—'}
                accent="orange"
                icon={<Receipt size={18} />}
              />
              <StatCard
                label="Parcel Orders"
                value={report ? report.parcelOrders : '—'}
                sub={report ? `${fmt(report.parcelRevenue, symbol)} revenue` : undefined}
                accent="purple"
                icon={<ShoppingCart size={18} />}
              />
            </div>

            {/* Payment breakdown + Printer status */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Payment breakdown */}
              {report && (
                <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                  <h2 className="mb-4 text-sm font-semibold text-gray-700">Payment Breakdown</h2>
                  <div className="space-y-3">
                    {Object.entries(report.paymentBreakdown).map(([method, value]) => (
                      <PaymentRow
                        key={method}
                        label={method.charAt(0).toUpperCase() + method.slice(1)}
                        value={value}
                        symbol={symbol}
                        total={report.totalSales}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Printer status */}
              <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold text-gray-700">Printer Devices</h2>
                {devices.length === 0 ? (
                  <p className="text-sm text-gray-400">No printer devices registered.</p>
                ) : (
                  <div className="space-y-2">
                    {devices.map(d => (
                      <PrinterChip key={d._id} device={d} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
