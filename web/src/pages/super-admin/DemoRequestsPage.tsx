// M2 — Demo Requests (filtered view of leads with source=website_demo)

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  SAPageHeader, SABadge, SASpin, SAError, fmtAgo,
} from '../../components/ui/SAShared';
import {
  getLeads, type Lead, type LeadsFilter, STATUS_LABELS, STATUS_ORDER,
} from '../../api/saLeads';

const STATUS_VARIANT: Record<string, 'green' | 'blue' | 'red' | 'amber' | 'gray'> = {
  new:            'blue',
  contacted:      'amber',
  demo_scheduled: 'amber',
  proposal_sent:  'blue',
  won:            'green',
  lost:           'red',
};

export function DemoRequestsPage() {
  const [leads,   setLeads]   = useState<Lead[]>([]);
  const [total,   setTotal]   = useState(0);
  const [pages,   setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [filter, setFilter] = useState<LeadsFilter>({
    page: 1, limit: 50, source: 'website_demo', status: 'all', search: '',
  });

  const load = useCallback(async (f: LeadsFilter) => {
    setLoading(true); setError('');
    try {
      const res = await getLeads(f);
      setLeads(res.leads);
      setTotal(res.total);
      setPages(res.pages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load demo requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter); }, [filter, load]);
  const set = (patch: Partial<LeadsFilter>) => setFilter(prev => ({ ...prev, ...patch, page: 1 }));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Demo Requests"
        sub={`${total} demo requests from the booking form`}
        onRefresh={() => void load(filter)}
        refreshing={loading}
      />

      <div className="flex-1 overflow-hidden flex flex-col px-8 py-6 gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              value={filter.search}
              onChange={e => set({ search: e.target.value })}
              placeholder="Search company, phone…"
              className="w-52 rounded-lg border border-border bg-canvas pl-8 pr-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:border-brand/50"
            />
          </div>
          <select
            value={filter.status}
            onChange={e => set({ status: e.target.value })}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none"
          >
            <option value="all">All Statuses</option>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>

        {error && <SAError message={error} onRetry={() => void load(filter)} />}

        <div className="flex-1 overflow-auto rounded-xl border border-border bg-canvas">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><SASpin /></div>
          ) : leads.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-ink/40">No demo requests found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-mist/50 sticky top-0">
                <tr>
                  {['Restaurant', 'Owner', 'Phone', 'Email', 'Preferred Date', 'Status', 'Priority', 'Received'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink/40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead._id} className="border-b border-border/50 hover:bg-mist/30 transition">
                    <td className="px-4 py-3">
                      <Link to={`/super-admin/leads/${lead._id}`} className="font-medium text-brand hover:underline">
                        {lead.companyName}
                      </Link>
                      {lead.city && <p className="text-xs text-ink/40">{lead.city}</p>}
                    </td>
                    <td className="px-4 py-3 text-ink/80">{lead.ownerName}</td>
                    <td className="px-4 py-3 font-mono text-xs">{lead.phone}</td>
                    <td className="px-4 py-3 text-xs text-ink/60">{lead.email}</td>
                    <td className="px-4 py-3 text-xs text-ink/60">{lead.restaurantType || '—'}</td>
                    <td className="px-4 py-3">
                      <SABadge label={STATUS_LABELS[lead.status]} variant={STATUS_VARIANT[lead.status] ?? 'gray'} />
                    </td>
                    <td className="px-4 py-3">
                      <SABadge label={lead.priority} variant={lead.priority === 'high' ? 'red' : lead.priority === 'medium' ? 'amber' : 'gray'} />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/40 whitespace-nowrap">{fmtAgo(lead.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink/50">Page {filter.page} of {pages}</span>
            <div className="flex gap-2">
              <button onClick={() => setFilter(p => ({ ...p, page: (p.page ?? 1) - 1 }))} disabled={(filter.page ?? 1) <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-ink/60 hover:bg-mist disabled:opacity-40">
                <ChevronLeft size={14} /> Prev
              </button>
              <button onClick={() => setFilter(p => ({ ...p, page: (p.page ?? 1) + 1 }))} disabled={(filter.page ?? 1) >= pages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-ink/60 hover:bg-mist disabled:opacity-40">
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
