import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Users, TrendingUp, Award } from 'lucide-react';
import {
  SectionHeader, PageLoader, StatCard, ApiRequired, Btn, EmptyState,
} from '../components/ui';
import { fetchCashiers, fetchWaiters } from '../api/staff';
import type { StaffMember } from '../api/staff';

// Staff Analytics
// Basic staff counts from existing endpoints.
// Attendance %, late coming, sales per staff, performance ranking
// require dedicated backend analytics endpoints not yet implemented.

const ANALYTICS_ENDPOINTS = [
  'GET /staff/analytics/attendance?from=&to=   — attendance percentage per staff',
  'GET /staff/analytics/late-coming?from=&to=  — late arrival records',
  'GET /staff/analytics/sales?from=&to=        — sales / orders handled per staff',
  'GET /staff/analytics/performance?from=&to=  — performance ranking with discounts, refunds, cancel rate',
  'GET /staff/analytics/billing-time?from=&to= — average billing time per cashier',
];

type SortField = 'name' | 'code' | 'status' | 'joined';

function sort(list: StaffMember[], field: SortField): StaffMember[] {
  return [...list].sort((a, b) => {
    if (field === 'name')   return a.name.localeCompare(b.name);
    if (field === 'code')   return a.employeeCode.localeCompare(b.employeeCode);
    if (field === 'status') return Number(b.isActive) - Number(a.isActive);
    if (field === 'joined') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return 0;
  });
}

export default function StaffAnalyticsPage() {
  const [cashiers,  setCashiers]  = useState<StaffMember[]>([]);
  const [waiters,   setWaiters]   = useState<StaffMember[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [sortField, setSortField] = useState<SortField>('name');
  const [from,      setFrom]      = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([fetchCashiers(), fetchWaiters()]).then(([c, w]) => {
      if (c.status === 'fulfilled') setCashiers(c.value);
      if (w.status === 'fulfilled') setWaiters(w.value);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const all = [
    ...sort(cashiers, sortField).map(m => ({ ...m, role: 'Cashier' })),
    ...sort(waiters,  sortField).map(m => ({ ...m, role: 'Waiter'  })),
  ];

  const activeCount   = all.filter(m => m.isActive).length;
  const inactiveCount = all.length - activeCount;

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Staff Analytics"
        sub="Performance, attendance and ranking"
        action={
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-[#E8D5C0] px-3 py-1.5 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-[#E8D5C0] px-3 py-1.5 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
            <Btn size="sm" onClick={load}><RefreshCw size={14} /></Btn>
          </div>
        }
      />

      <ApiRequired endpoints={ANALYTICS_ENDPOINTS} />

      {/* Live stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Staff"   value={all.length}      icon={<Users size={16} />} />
        <StatCard label="Active"        value={activeCount}      icon={<TrendingUp size={16} />} accent />
        <StatCard label="Inactive"      value={inactiveCount} />
        <StatCard label="Cashiers"      value={cashiers.length}  sub={`${waiters.length} waiters`} icon={<Award size={16} />} />
      </div>

      {/* Analytics placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: 'Attendance %',        endpoint: 'GET /staff/analytics/attendance' },
          { label: 'Late Coming',         endpoint: 'GET /staff/analytics/late-coming' },
          { label: 'Sales per Staff',     endpoint: 'GET /staff/analytics/sales' },
          { label: 'Average Billing Time',endpoint: 'GET /staff/analytics/billing-time' },
        ].map(({ label, endpoint }) => (
          <div key={label} className="bg-white rounded-xl border border-[#E8D5C0] p-4">
            <p className="font-bold text-[#1C0800] mb-2">{label}</p>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-mono">
              Requires: {endpoint}
            </p>
          </div>
        ))}
      </div>

      {/* Staff directory — live data */}
      <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8D5C0] bg-[#FFF6EE]">
          <p className="font-bold text-sm text-[#1C0800]">Staff Directory ({all.length})</p>
          <select
            value={sortField}
            onChange={e => setSortField(e.target.value as SortField)}
            className="text-xs rounded border border-[#E8D5C0] px-2 py-1 text-[#92745E] bg-white focus:outline-none"
          >
            <option value="name">Sort by Name</option>
            <option value="code">Sort by Code</option>
            <option value="status">Sort by Status</option>
            <option value="joined">Sort by Joined</option>
          </select>
        </div>
        {all.length === 0 ? (
          <EmptyState icon={<Users className="h-8 w-8" />} title="No staff members" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8D5C0]">
                {['Staff Member', 'Code', 'Role', 'Status', 'Joined', 'Attendance*', 'Orders*', 'Sales*', 'Rank*'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {all.map(m => (
                <tr key={m._id} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-[#E8380D] text-white flex items-center justify-center text-xs font-black shrink-0">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-semibold text-[#1C0800]">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[#92745E]">{m.employeeCode}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-[#92745E]">{m.role}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold ${m.isActive ? 'text-green-600' : 'text-gray-400'}`}>
                      {m.isActive ? '● Active' : '○ Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#92745E] text-xs">{new Date(m.createdAt).toLocaleDateString('en-IN')}</td>
                  {['Attendance*', 'Orders*', 'Sales*', 'Rank*'].map(k => (
                    <td key={k} className="px-4 py-3 text-xs text-amber-600">—</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-[#92745E] px-4 py-2 border-t border-[#E8D5C0]">
          * Analytics columns require backend implementation
        </p>
      </div>
    </div>
  );
}
