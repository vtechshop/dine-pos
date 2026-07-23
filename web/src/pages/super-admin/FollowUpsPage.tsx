// M2 — Follow Ups (contacted + demo_scheduled leads needing follow-up)

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import {
  SAPageHeader, SABadge, SASpin, SAError, fmtAgo,
} from '../../components/ui/SAShared';
import { getLeads, type Lead, STATUS_LABELS } from '../../api/saLeads';

export function FollowUpsPage() {
  const [contacted,      setContacted]      = useState<Lead[]>([]);
  const [demoScheduled,  setDemoScheduled]  = useState<Lead[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [search,         setSearch]         = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [r1, r2] = await Promise.allSettled([
        getLeads({ status: 'contacted',      limit: 100 }),
        getLeads({ status: 'demo_scheduled', limit: 100 }),
      ]);
      if (r1.status === 'fulfilled') setContacted(r1.value.leads);
      if (r2.status === 'fulfilled') setDemoScheduled(r2.value.leads);
      if (r1.status === 'rejected' && r2.status === 'rejected') {
        setError('Failed to load follow-ups');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filter = (leads: Lead[]) => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase();
    return leads.filter(l =>
      l.companyName.toLowerCase().includes(q) ||
      l.ownerName.toLowerCase().includes(q) ||
      l.phone.includes(q),
    );
  };

  function LeadRow({ lead }: { lead: Lead }) {
    return (
      <tr className="border-b border-border/50 hover:bg-mist/30 transition">
        <td className="px-4 py-3">
          <Link to={`/super-admin/leads/${lead._id}`} className="font-medium text-brand hover:underline">
            {lead.companyName}
          </Link>
          {lead.city && <p className="text-xs text-ink/40">{lead.city}</p>}
        </td>
        <td className="px-4 py-3 text-ink/80 text-sm">{lead.ownerName}</td>
        <td className="px-4 py-3 font-mono text-xs">{lead.phone}</td>
        <td className="px-4 py-3">
          <SABadge label={STATUS_LABELS[lead.status]} variant={lead.status === 'demo_scheduled' ? 'amber' : 'gray'} />
        </td>
        <td className="px-4 py-3">
          <SABadge label={lead.priority} variant={lead.priority === 'high' ? 'red' : lead.priority === 'medium' ? 'amber' : 'gray'} />
        </td>
        <td className="px-4 py-3 text-xs text-ink/50">{lead.assignedTo || '—'}</td>
        <td className="px-4 py-3 text-xs text-ink/40 whitespace-nowrap">{fmtAgo(lead.createdAt)}</td>
      </tr>
    );
  }

  const total = contacted.length + demoScheduled.length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Follow Ups"
        sub={`${total} leads needing follow-up`}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Search */}
        <div className="relative max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads…"
            className="w-full rounded-lg border border-border bg-canvas pl-8 pr-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:border-brand/50"
          />
        </div>

        {error && <SAError message={error} onRetry={() => void load()} />}
        {loading ? <SASpin /> : (
          <>
            {/* Demo Scheduled section */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-3">
                Demo Scheduled ({filter(demoScheduled).length})
              </p>
              {filter(demoScheduled).length === 0 ? (
                <p className="text-sm text-ink/40 pl-1">No leads in this stage.</p>
              ) : (
                <div className="rounded-xl border border-border bg-canvas overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-mist/50">
                      <tr>
                        {['Company', 'Owner', 'Phone', 'Status', 'Priority', 'Assigned', 'Created'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink/40">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filter(demoScheduled).map(lead => <LeadRow key={lead._id} lead={lead} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Contacted section */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-ink/40 mb-3">
                Contacted ({filter(contacted).length})
              </p>
              {filter(contacted).length === 0 ? (
                <p className="text-sm text-ink/40 pl-1">No leads in this stage.</p>
              ) : (
                <div className="rounded-xl border border-border bg-canvas overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-mist/50">
                      <tr>
                        {['Company', 'Owner', 'Phone', 'Status', 'Priority', 'Assigned', 'Created'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink/40">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filter(contacted).map(lead => <LeadRow key={lead._id} lead={lead} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
