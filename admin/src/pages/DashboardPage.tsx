import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  QrCode, Users, Truck, ShoppingBag, FileText, BarChart2,
  ArrowRight, Package, Wallet, UserCheck, Activity,
} from 'lucide-react';
import { StatCard, PageLoader, ErrorState } from '../components/ui';
import { fetchOnlineOrders } from '../api/aggregator';
import { fetchCashiers, fetchWaiters } from '../api/staff';
import { fetchSalesReport } from '../api/reports';

interface DashSummary {
  totalStaff:   number;
  pendingOrders: number;
  todayRevenue: number;
  swiggyOrders: number;
  zomatoOrders: number;
}

const today = new Date().toISOString().slice(0, 10);

const MODULES = [
  { to: '/qr',           icon: <QrCode size={20} />,     label: 'QR Management',   desc: 'Restaurant & table QR codes' },
  { to: '/staff',        icon: <Users size={20} />,      label: 'Staff Management', desc: 'Cashiers, waiters, HR' },
  { to: '/integrations', icon: <Truck size={20} />,      label: 'Swiggy & Zomato', desc: 'Aggregator controls' },
  { to: '/online-orders',icon: <ShoppingBag size={20} />,label: 'Online Orders',   desc: 'Delivery order dashboard' },
  { to: '/menu-channels',icon: <Package size={20} />,    label: 'Channel Pricing', desc: 'Per-channel prices' },
  { to: '/settlement',   icon: <Wallet size={20} />,     label: 'Settlement',      desc: 'Daily settlement & payouts' },
  { to: '/staff-analytics',icon:<UserCheck size={20}/>,  label: 'Staff Analytics', desc: 'Attendance, performance' },
  { to: '/qr-analytics', icon: <Activity size={20} />,   label: 'QR Analytics',   desc: 'Scan counts, revenue' },
  { to: '/audit',        icon: <BarChart2 size={20} />,  label: 'Audit Log',       desc: 'All admin actions' },
  { to: '/reports',      icon: <FileText size={20} />,   label: 'Reports',         desc: 'CSV, PDF, Excel' },
];

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetchCashiers(),
      fetchWaiters(),
      fetchOnlineOrders({ date: today, limit: 200 }),
      fetchSalesReport(today, today),
    ]).then(([cashiers, waiters, orders, sales]) => {
      if (cancelled) return;
      const staffTotal = (cashiers.status === 'fulfilled' ? cashiers.value.length : 0)
        + (waiters.status === 'fulfilled' ? waiters.value.length : 0);

      const orderList = orders.status === 'fulfilled' ? (orders.value.orders ?? []) : [];
      const pending   = orderList.filter(o => o.status === 'pending').length;
      const swiggy    = orderList.filter(o => o.orderSource === 'swiggy').length;
      const zomato    = orderList.filter(o => o.orderSource === 'zomato').length;

      let revenue = 0;
      if (sales.status === 'fulfilled') {
        const s = sales.value as { summary?: { totalRevenue?: number } };
        revenue = s.summary?.totalRevenue ?? 0;
      }

      setSummary({ totalStaff: staffTotal, pendingOrders: pending, todayRevenue: revenue, swiggyOrders: swiggy, zomatoOrders: zomato });
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setError('Failed to load dashboard data'); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <PageLoader />;
  if (error)   return <ErrorState message={error} />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black text-[#1C0800]">Admin Dashboard</h1>
        <p className="text-sm text-[#92745E] mt-0.5">Today · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Today's Revenue" value={`₹${Math.round(summary?.todayRevenue ?? 0).toLocaleString('en-IN')}`} accent />
        <StatCard label="Staff Members"   value={summary?.totalStaff ?? 0} />
        <StatCard label="Pending Orders"  value={summary?.pendingOrders ?? 0} sub={`Swiggy ${summary?.swiggyOrders ?? 0} · Zomato ${summary?.zomatoOrders ?? 0}`} />
        <StatCard label="Online Orders"   value={(summary?.swiggyOrders ?? 0) + (summary?.zomatoOrders ?? 0)} sub="Today" />
      </div>

      {/* Module grid */}
      <div>
        <h2 className="text-sm font-bold text-[#92745E] uppercase tracking-wide mb-4">Modules</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {MODULES.map(m => (
            <Link
              key={m.to}
              to={m.to}
              className="group bg-white rounded-xl border border-[#E8D5C0] p-4 flex flex-col gap-2 hover:border-[#E8380D] hover:shadow-md transition-all"
            >
              <div className="h-9 w-9 bg-[#FFF6EE] rounded-lg flex items-center justify-center text-[#E8380D] group-hover:bg-[#E8380D] group-hover:text-white transition-colors">
                {m.icon}
              </div>
              <div>
                <p className="font-bold text-sm text-[#1C0800]">{m.label}</p>
                <p className="text-xs text-[#92745E] mt-0.5">{m.desc}</p>
              </div>
              <ArrowRight size={14} className="text-[#C4A090] group-hover:text-[#E8380D] self-end mt-auto transition-colors" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
