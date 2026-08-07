import { useState, useEffect, useCallback } from 'react';
import { Search, Shield, ChevronDown } from 'lucide-react';
import { fetchAuditLogs, type AuditLog } from '../api/audit';

const ACTOR_ROLES = ['', 'admin', 'cashier', 'waiter', 'kitchen', 'super_admin'];

const TARGET_TYPES = [
  '', 'vendor', 'purchase_order', 'grn', 'coupon', 'gift_voucher',
  'wallet', 'loyalty', 'payment', 'order', 'guest', 'product',
  'ingredient', 'expense', 'aggregator', 'device', 'settings',
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function metaSummary(meta?: Record<string, unknown>): string {
  if (!meta) return '';
  const parts: string[] = [];
  const skip = new Set(['hotelId', '_id', 'createdAt', 'updatedAt', '__v']);
  for (const [k, v] of Object.entries(meta)) {
    if (skip.has(k) || v == null) continue;
    if (typeof v === 'object') continue;
    parts.push(`${k}: ${String(v)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

export function AuditLogsPage() {
  const [logs, setLogs]       = useState<AuditLog[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const [filters, setFilters] = useState({
    action:     '',
    actorRole:  '',
    targetType: '',
    from:       '',
    to:         '',
  });

  const [expanded, setExpanded] = useState<string | null>(null);

  const LIMIT = 50;

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuditLogs({
        page: p,
        limit: LIMIT,
        action:     filters.action     || undefined,
        actorRole:  filters.actorRole  || undefined,
        targetType: filters.targetType || undefined,
        from:       filters.from       || undefined,
        to:         filters.to         || undefined,
      });
      setLogs(res.logs);
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(1); }, [load]);

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-brand" />
          <h1 className="text-sm font-bold text-ink">Audit Logs</h1>
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">{total}</span>
        </div>
        <p className="text-xs text-ink/50">All admin actions are recorded automatically.</p>
      </div>

      {/* Filters */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold text-ink/50">From</label>
            <input
              type="date"
              value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
              className={filterInputCls}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold text-ink/50">To</label>
            <input
              type="date"
              value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
              className={filterInputCls}
            />
          </div>

          {/* Role */}
          <select
            value={filters.actorRole}
            onChange={e => setFilters(f => ({ ...f, actorRole: e.target.value }))}
            className={filterInputCls}
          >
            <option value="">All roles</option>
            {ACTOR_ROLES.filter(Boolean).map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          {/* Module (targetType) */}
          <select
            value={filters.targetType}
            onChange={e => setFilters(f => ({ ...f, targetType: e.target.value }))}
            className={filterInputCls}
          >
            <option value="">All modules</option>
            {TARGET_TYPES.filter(Boolean).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Action text */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
            <input
              value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
              placeholder="Action keyword…"
              className={`${filterInputCls} pl-7`}
            />
          </div>

          <button
            onClick={() => setFilters({ action: '', actorRole: '', targetType: '', from: '', to: '' })}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-ink/60 hover:bg-ink/5"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-mist px-5 py-4">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-ink/40">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-ink/40">
            <Shield size={28} className="opacity-30" />
            <p>No audit log entries match the current filters.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-canvas overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-mist text-left text-xs font-semibold uppercase tracking-wide text-ink/50">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="w-8 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map(log => (
                  <>
                    <tr
                      key={log._id}
                      className="hover:bg-mist/50 cursor-pointer"
                      onClick={() => setExpanded(prev => prev === log._id ? null : log._id)}
                    >
                      <td className="px-4 py-3 text-xs text-ink/60 whitespace-nowrap">
                        {formatTime(log.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          log.actorRole === 'admin'       ? 'bg-blue-50 text-blue-700' :
                          log.actorRole === 'cashier'     ? 'bg-green-50 text-green-700' :
                          log.actorRole === 'super_admin' ? 'bg-purple-50 text-purple-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {log.actorRole}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-ink/70 capitalize">
                        {log.targetType.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-ink">
                        {log.action}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink/50 max-w-xs truncate">
                        {log.targetId ? <span className="font-mono text-[10px]">{String(log.targetId).slice(-8)}</span> : null}
                        {log.metadata && metaSummary(log.metadata) ? (
                          <span className="ml-2">{metaSummary(log.metadata)}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-ink/30">
                        <ChevronDown
                          size={14}
                          className={`transition-transform ${expanded === log._id ? 'rotate-180' : ''}`}
                        />
                      </td>
                    </tr>

                    {expanded === log._id && log.metadata && (
                      <tr key={`${log._id}-meta`} className="bg-mist/60">
                        <td colSpan={6} className="px-4 py-3">
                          <pre className="overflow-x-auto rounded-lg bg-ink/5 p-3 text-[10px] leading-relaxed text-ink/70">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => load(page - 1)}
              className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-ink/60">Page {page} of {pages} · {total} entries</span>
            <button
              disabled={page >= pages}
              onClick={() => load(page + 1)}
              className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const filterInputCls =
  'rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand/30';
