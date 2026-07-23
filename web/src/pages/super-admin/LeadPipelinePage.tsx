// M2 — Lead Pipeline (Kanban view by status)

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  SAPageHeader, SABadge, SASpin, SAError, fmtAgo,
} from '../../components/ui/SAShared';
import { getLeads, type Lead, STATUS_LABELS, STATUS_ORDER } from '../../api/saLeads';

const STATUS_COLOR: Record<string, string> = {
  new:            'border-t-blue-400',
  contacted:      'border-t-amber-400',
  demo_scheduled: 'border-t-orange-400',
  proposal_sent:  'border-t-purple-400',
  won:            'border-t-green-500',
  lost:           'border-t-red-400',
};
type Pipeline = Record<string, Lead[]>;

export function LeadPipelinePage() {
  const [pipeline, setPipeline] = useState<Pipeline>({});
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const results = await Promise.allSettled(
        STATUS_ORDER.map(s => getLeads({ status: s, limit: 100 })),
      );
      const next: Pipeline = {};
      STATUS_ORDER.forEach((s, i) => {
        const r = results[i];
        next[s] = r.status === 'fulfilled' ? r.value.leads : [];
      });
      setPipeline(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pipeline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return (
    <div className="flex h-full items-center justify-center"><SASpin /></div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Pipeline"
        sub="Kanban view by lead status"
        onRefresh={() => void load()}
        refreshing={loading}
      />

      {error && (
        <div className="px-8 pt-4">
          <SAError message={error} onRetry={() => void load()} />
        </div>
      )}

      {/* Kanban board — horizontal scroll */}
      <div className="flex-1 overflow-x-auto px-8 py-6">
        <div className="flex gap-4 h-full min-w-max">
          {STATUS_ORDER.map(status => {
            const leads = pipeline[status] ?? [];
            return (
              <div key={status} className={`w-64 flex flex-col rounded-xl border-t-4 border border-border bg-mist/50 ${STATUS_COLOR[status]}`}>
                {/* Column header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-canvas/80 rounded-t-xl">
                  <p className="text-sm font-bold text-ink">{STATUS_LABELS[status]}</p>
                  <span className="text-xs font-semibold text-ink/50 bg-mist border border-border px-2 py-0.5 rounded-full">
                    {leads.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {leads.length === 0 ? (
                    <p className="text-xs text-ink/30 text-center py-6">No leads</p>
                  ) : (
                    leads.map(lead => (
                      <Link
                        key={lead._id}
                        to={`/super-admin/leads/${lead._id}`}
                        className="block rounded-lg border border-border bg-canvas p-3 hover:bg-mist transition shadow-sm"
                      >
                        <p className="text-sm font-semibold text-ink leading-snug">{lead.companyName}</p>
                        <p className="text-xs text-ink/50 mt-0.5">{lead.ownerName}</p>
                        <p className="text-xs font-mono text-ink/40 mt-0.5">{lead.phone}</p>
                        <div className="flex items-center justify-between mt-2">
                          <SABadge
                            label={lead.priority}
                            variant={lead.priority === 'high' ? 'red' : lead.priority === 'medium' ? 'amber' : 'gray'}
                          />
                          <span className="text-[10px] text-ink/30">{fmtAgo(lead.createdAt)}</span>
                        </div>
                        {lead.assignedTo && (
                          <p className="text-[10px] text-ink/40 mt-1">→ {lead.assignedTo}</p>
                        )}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
