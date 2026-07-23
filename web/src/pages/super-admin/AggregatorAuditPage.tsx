// M9 + M12 — Alert Engine + Audit Log
// Requires: GET /superadmin/aggregator/alerts, GET /superadmin/aggregator/audit

import { useEffect, useState, useCallback } from 'react';
import { Bell, ClipboardList, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import {
  ApiRequired, SABadge, SAPageHeader, SASpin, SAError, fmtDateTime,
} from '../../components/ui/SAShared';
import {
  getAggAlerts, getAggAudit,
} from '../../api/saAggregator';

type Alert = {
  id: string; type: string; severity: 'critical' | 'warning' | 'info';
  hotelId?: string; hotelName?: string; message: string; createdAt: string; resolved: boolean;
};
type AuditEntry = {
  id: string; action: string; hotelId?: string; hotelName?: string;
  detail: string; actorId: string; createdAt: string;
};

const AUDIT_ENDPOINTS = [
  'GET /superadmin/aggregator/alerts — active alert engine output (hotel disconnected, webhook failed, etc.)',
  'GET /superadmin/aggregator/audit  — cross-hotel aggregator audit log (credential changes, syncs, etc.)',
];

type Tab = 'alerts' | 'audit';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

export function AggregatorAuditPage() {
  const [tab,     setTab]     = useState<Tab>('alerts');
  const [alerts,  setAlerts]  = useState<Alert[]>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [from,    setFrom]    = useState(daysAgo(7));
  const [to,      setTo]      = useState(today());
  const [type,    setType]    = useState('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const [alertsRes, auditRes] = await Promise.allSettled([
      getAggAlerts(),
      getAggAudit({ from, to, type: type !== 'all' ? type : undefined }),
    ]);
    if (alertsRes.status  === 'fulfilled') setAlerts(alertsRes.value.alerts);
    if (auditRes.status   === 'fulfilled') setEntries(auditRes.value.entries);
    if (alertsRes.status  === 'rejected')  setError(alertsRes.reason instanceof Error ? alertsRes.reason.message : 'Failed');
    setLoading(false);
  }, [from, to, type]);

  useEffect(() => { void load(); }, [load]);

  const critical = alerts.filter(a => a.severity === 'critical' && !a.resolved);
  const warning  = alerts.filter(a => a.severity === 'warning'  && !a.resolved);

  function severityIcon(sev: Alert['severity']) {
    if (sev === 'critical') return <AlertCircle   size={16} className="text-red-500 shrink-0" />;
    if (sev === 'warning')  return <AlertTriangle size={16} className="text-amber-500 shrink-0" />;
    return <Info size={16} className="text-blue-500 shrink-0" />;
  }

  const exportAudit = () => {
    const rows = entries.map(e => [e.action, e.hotelName ?? '', e.detail, e.actorId, fmtDateTime(e.createdAt)]);
    const csv = [['Action', 'Hotel', 'Detail', 'Actor', 'Time'], ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `sa_audit_${from}_${to}.csv`,
    }).click();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Alerts & Audit"
        sub="Alert engine · cross-hotel aggregator audit log"
        onRefresh={() => void load()}
        refreshing={loading}
        action={
          tab === 'audit' && entries.length > 0 ? (
            <button onClick={exportAudit} className="px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-canvas text-ink/70 hover:bg-mist">
              Export CSV
            </button>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        <ApiRequired endpoints={AUDIT_ENDPOINTS} />

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab('alerts')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === 'alerts' ? 'border-brand text-brand' : 'border-transparent text-ink/50 hover:text-ink'
            }`}
          >
            <Bell size={14} />
            Alerts
            {critical.length > 0 && (
              <span className="rounded-full bg-red-600 text-canvas text-[10px] font-bold px-1.5 py-0.5">{critical.length}</span>
            )}
          </button>
          <button
            onClick={() => setTab('audit')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === 'audit' ? 'border-brand text-brand' : 'border-transparent text-ink/50 hover:text-ink'
            }`}
          >
            <ClipboardList size={14} />
            Audit Log
          </button>
        </div>

        {error && <SAError message={error} onRetry={() => void load()} />}

        {/* Alerts tab */}
        {tab === 'alerts' && (
          loading ? <SASpin /> : (
            <div className="space-y-4">
              {/* Active alert summary */}
              {(critical.length > 0 || warning.length > 0) && (
                <div className="flex gap-3">
                  {critical.length > 0 && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-2">
                      <AlertCircle size={16} className="text-red-600" />
                      <p className="text-sm font-bold text-red-700">{critical.length} critical alerts</p>
                    </div>
                  )}
                  {warning.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-amber-600" />
                      <p className="text-sm font-bold text-amber-700">{warning.length} warnings</p>
                    </div>
                  )}
                </div>
              )}

              {alerts.length === 0 ? (
                <div className="text-center py-12">
                  <Bell size={32} className="mx-auto text-ink/20 mb-3" />
                  <p className="text-sm text-ink/40">No alerts — requires <code className="font-mono text-xs bg-mist px-1 rounded">GET /superadmin/aggregator/alerts</code></p>
                </div>
              ) : (
                <div className="space-y-2">
                  {alerts.sort((a, b) =>
                    (a.resolved ? 1 : 0) - (b.resolved ? 1 : 0) ||
                    (['critical', 'warning', 'info'].indexOf(a.severity) - ['critical', 'warning', 'info'].indexOf(b.severity))
                  ).map(alert => (
                    <div key={alert.id} className={`rounded-xl border p-4 flex items-start gap-3 ${
                      alert.resolved ? 'border-border bg-canvas opacity-50' :
                      alert.severity === 'critical' ? 'border-red-200 bg-red-50' :
                      alert.severity === 'warning'  ? 'border-amber-200 bg-amber-50' :
                                                      'border-blue-200 bg-blue-50'
                    }`}>
                      {severityIcon(alert.severity)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SABadge
                            label={alert.severity}
                            variant={alert.severity === 'critical' ? 'red' : alert.severity === 'warning' ? 'amber' : 'blue'}
                          />
                          <SABadge label={alert.type} variant="gray" />
                          {alert.hotelName && <span className="text-xs text-ink/60 font-semibold">{alert.hotelName}</span>}
                          {alert.resolved && <SABadge label="Resolved" variant="green" />}
                        </div>
                        <p className="text-sm text-ink mt-1">{alert.message}</p>
                        <p className="text-[10px] text-ink/40 mt-0.5">{fmtDateTime(alert.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {/* Audit tab */}
        {tab === 'audit' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input type="date" value={from} max={today()} onChange={e => setFrom(e.target.value)}
                className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
              <input type="date" value={to}   max={today()} onChange={e => setTo(e.target.value)}
                className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
              <select value={type} onChange={e => setType(e.target.value)}
                className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none">
                <option value="all">All Actions</option>
                <option value="feature_toggle">Feature Toggle</option>
                <option value="credential_change">Credential Change</option>
                <option value="menu_sync">Menu Sync</option>
                <option value="webhook_retry">Webhook Retry</option>
                <option value="platform_toggle">Platform Toggle</option>
                <option value="settings_update">Settings Update</option>
              </select>
              <button onClick={() => void load()} className="px-3 py-2 rounded-lg bg-brand text-canvas text-xs font-semibold">Filter</button>
            </div>

            {loading ? <SASpin /> : (
              <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-mist">
                      {['Action', 'Hotel', 'Detail', 'Actor', 'Time'].map(c => (
                        <th key={c} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink/50">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink/40">
                          No audit entries — requires <code className="font-mono text-xs bg-mist px-1 rounded">GET /superadmin/aggregator/audit</code>
                        </td>
                      </tr>
                    ) : entries.map(e => (
                      <tr key={e.id} className="border-b border-border/50 hover:bg-mist/50 last:border-0">
                        <td className="px-4 py-3"><SABadge label={e.action} variant="blue" /></td>
                        <td className="px-4 py-3 text-ink/70">{e.hotelName ?? '—'}</td>
                        <td className="px-4 py-3 text-ink/60 text-xs max-w-[200px] truncate">{e.detail}</td>
                        <td className="px-4 py-3 font-mono text-xs text-ink/50">{e.actorId}</td>
                        <td className="px-4 py-3 text-xs text-ink/50 whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
