import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, Search, Download, Shield } from 'lucide-react';
import {
  SectionHeader, PageLoader, EmptyState, Btn, Badge, ApiRequired,
} from '../components/ui';
import { fetchCashiers, fetchWaiters } from '../api/staff';
import type { StaffMember } from '../api/staff';

// Audit Log
// Full audit logging requires a /audit backend endpoint.
// Until it's implemented, we log admin actions client-side in sessionStorage
// and display them in this table. Actions persist for the current browser session only.

const AUDIT_ENDPOINTS = [
  'GET  /audit?from=&to=&type=&userId=&limit=  — paginated audit log with filters',
  'GET  /audit/:id                              — single audit entry detail',
];

type AuditAction =
  | 'qr_generated'    | 'qr_printed'     | 'qr_disabled'    | 'qr_enabled'
  | 'staff_added'     | 'staff_edited'    | 'staff_deleted'  | 'staff_disabled'
  | 'staff_enabled'   | 'pin_reset'       | 'permission_changed'
  | 'menu_synced'     | 'aggregator_settings' | 'store_status_changed'
  | 'webhook_retried' | 'login'           | 'logout';

export interface AuditEntry {
  id:        string;
  action:    AuditAction;
  entity:    string;
  detail:    string;
  actorId:   string;
  actorName: string;
  timestamp: string;
  ip?:       string;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  qr_generated:         'QR Generated',
  qr_printed:           'QR Printed',
  qr_disabled:          'QR Disabled',
  qr_enabled:           'QR Enabled',
  staff_added:          'Staff Added',
  staff_edited:         'Staff Edited',
  staff_deleted:        'Staff Deleted',
  staff_disabled:       'Staff Disabled',
  staff_enabled:        'Staff Enabled',
  pin_reset:            'PIN Reset',
  permission_changed:   'Permission Changed',
  menu_synced:          'Menu Synced',
  aggregator_settings:  'Aggregator Settings',
  store_status_changed: 'Store Status Changed',
  webhook_retried:      'Webhook Retried',
  login:                'Admin Login',
  logout:               'Admin Logout',
};

const ACTION_VARIANT: Partial<Record<AuditAction, 'green' | 'red' | 'amber' | 'blue'>> = {
  staff_added:          'green',
  qr_generated:         'green',
  qr_enabled:           'green',
  staff_enabled:        'green',
  menu_synced:          'blue',
  login:                'blue',
  staff_deleted:        'red',
  qr_disabled:          'red',
  staff_disabled:       'amber',
  pin_reset:            'amber',
  store_status_changed: 'amber',
  webhook_retried:      'amber',
};

const AUDIT_KEY = 'dinepos_admin_audit';

export function appendAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
  const entries: AuditEntry[] = JSON.parse(sessionStorage.getItem(AUDIT_KEY) ?? '[]') as AuditEntry[];
  entries.unshift({ ...entry, id: `audit_${Date.now()}`, timestamp: new Date().toISOString() });
  sessionStorage.setItem(AUDIT_KEY, JSON.stringify(entries.slice(0, 500)));
}

function loadLocalAudit(): AuditEntry[] {
  return JSON.parse(sessionStorage.getItem(AUDIT_KEY) ?? '[]') as AuditEntry[];
}

type ActionFilter = 'all' | AuditAction;

export default function AuditLogPage() {
  const [entries,  setEntries]  = useState<AuditEntry[]>([]);
  const [staff,    setStaff]    = useState<StaffMember[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [actFilter,setActFilter]= useState<ActionFilter>('all');
  const [from,     setFrom]     = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0,10); });
  const [to,       setTo]       = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([fetchCashiers(), fetchWaiters()])
      .then(([c, w]) => {
        const all = [
          ...(c.status === 'fulfilled' ? c.value : []),
          ...(w.status === 'fulfilled' ? w.value : []),
        ];
        setStaff(all);
        setEntries(loadLocalAudit());
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const actionOptions = Array.from(new Set(entries.map(e => e.action))) as AuditAction[];

  const visible = entries.filter(e => {
    const matchSearch = !search || e.detail.toLowerCase().includes(search.toLowerCase())
      || e.actorName.toLowerCase().includes(search.toLowerCase())
      || e.entity.toLowerCase().includes(search.toLowerCase());
    const matchAction = actFilter === 'all' || e.action === actFilter;
    const ts = new Date(e.timestamp).toISOString().slice(0, 10);
    const matchDate = ts >= from && ts <= to;
    return matchSearch && matchAction && matchDate;
  });

  const exportCSV = () => {
    const rows = visible.map(e => [e.timestamp, ACTION_LABELS[e.action] ?? e.action, e.entity, e.detail, e.actorName]);
    const csv  = [['Timestamp', 'Action', 'Entity', 'Detail', 'Actor'], ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `audit_${from}_${to}.csv`;
    a.click();
  };

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Audit Log"
        sub="All admin actions logged — QR, staff, aggregator, settings"
        action={
          <div className="flex items-center gap-2">
            <Btn size="sm" onClick={exportCSV}><Download size={14} /> CSV</Btn>
            <Btn size="sm" onClick={() => { setEntries(loadLocalAudit()); }}><RefreshCw size={14} /></Btn>
          </div>
        }
      />

      <ApiRequired endpoints={AUDIT_ENDPOINTS} />

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
        <p className="text-xs text-blue-700">
          <span className="font-bold">Session-only audit:</span> Entries below are stored in browser session storage
          and will be lost when you close this tab. A persistent audit log requires the
          <span className="font-mono"> /audit</span> backend endpoint.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#C4A090]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search actions…"
            className="pl-8 pr-3 py-2 rounded-lg border border-[#E8D5C0] text-sm focus:outline-none focus:border-[#E8380D] bg-white"
          />
        </div>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm text-[#1C0800] focus:outline-none focus:border-[#E8380D]" />
        <select
          value={actFilter}
          onChange={e => setActFilter(e.target.value as ActionFilter)}
          className="rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm text-[#1C0800] bg-white focus:outline-none focus:border-[#E8380D]"
        >
          <option value="all">All actions</option>
          {actionOptions.map(a => (
            <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
          ))}
        </select>
      </div>

      {/* Log */}
      {entries.length === 0 ? (
        <EmptyState
          icon={<Shield className="h-10 w-10" />}
          title="No audit entries this session"
          sub="Admin actions (staff changes, QR generation, integrations) will appear here."
        />
      ) : visible.length === 0 ? (
        <EmptyState title="No entries match the filters" />
      ) : (
        <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
                {['Timestamp', 'Action', 'Entity', 'Detail', 'Actor', 'IP'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(e => (
                <tr key={e.id} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                  <td className="px-4 py-3 text-xs text-[#92745E] whitespace-nowrap font-mono">
                    {new Date(e.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      label={ACTION_LABELS[e.action] ?? e.action}
                      variant={ACTION_VARIANT[e.action] ?? 'gray'}
                    />
                  </td>
                  <td className="px-4 py-3 text-[#1C0800] font-semibold">{e.entity}</td>
                  <td className="px-4 py-3 text-[#92745E] max-w-xs truncate">{e.detail}</td>
                  <td className="px-4 py-3 text-[#1C0800]">{e.actorName || 'Admin'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#92745E]">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-[#E8D5C0] flex items-center justify-between">
            <p className="text-xs text-[#92745E]">{visible.length} of {entries.length} entries</p>
          </div>
        </div>
      )}

      {/* Staff with active sessions */}
      {staff.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E8D5C0] p-4">
          <p className="font-bold text-sm text-[#1C0800] mb-3">Current Staff</p>
          <div className="flex flex-wrap gap-2">
            {staff.map(m => (
              <span key={m._id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${m.isActive ? 'bg-green-50 border-green-200 text-green-800' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${m.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
