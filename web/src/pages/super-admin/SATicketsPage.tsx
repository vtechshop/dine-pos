import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSATickets } from '../../context/SATicketsContext';
import { LifeBuoy, RefreshCw, Search, Send, Phone, X } from 'lucide-react';
import {
  fetchTickets, replyToTicket, setTicketStatus,
  type SupportTicket, type TicketStatus,
} from '../../api/saTickets';
import { Spinner } from '../../components/ui/Spinner';

type Filter = 'open' | 'resolved' | 'closed' | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open',     label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed',   label: 'Closed' },
  { key: 'all',      label: 'All' },
];

const STATUS_CLS: Record<TicketStatus, string> = {
  'open':        'bg-red-50 text-red-700 border-red-200',
  'in-progress': 'bg-amber-50 text-amber-700 border-amber-200',
  'resolved':    'bg-emerald-50 text-emerald-700 border-emerald-200',
  'closed':      'bg-mist text-ink/50 border-border',
};
const STATUS_LABEL: Record<TicketStatus, string> = {
  'open': 'Open', 'in-progress': 'In progress', 'resolved': 'Resolved', 'closed': 'Closed',
};
const PRIORITY_CLS: Record<SupportTicket['priority'], string> = {
  high: 'text-red-600', medium: 'text-amber-600', low: 'text-ink/40',
};

const isOpen = (t: SupportTicket) => t.status === 'open' || t.status === 'in-progress';

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function SATicketsPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<Filter>('open');
  const [query, setQuery]     = useState('');
  const [params, setParams]   = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const [reply, setReply]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setTickets(await fetchTickets()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load tickets'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Opening the tickets page counts as seeing new tickets (clears the bell count)
  const watcher = useSATickets();
  const markSeenRef = useRef(watcher.markSeen);
  markSeenRef.current = watcher.markSeen;
  useEffect(() => () => markSeenRef.current(), []);
  useEffect(() => { watcher.markSeen(); }, [watcher.waiting.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    open:     tickets.filter(isOpen).length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    closed:   tickets.filter(t => t.status === 'closed').length,
    all:      tickets.length,
  }), [tickets]);

  const shown = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return tickets.filter(t => {
      if (filter === 'open' && !isOpen(t)) return false;
      if (filter === 'resolved' && t.status !== 'resolved') return false;
      if (filter === 'closed' && t.status !== 'closed') return false;
      if (!terms.length) return true;
      const hay = [t.subject, t.description, t.hotelName, t.hotelPhone, t.category].join(' ').toLowerCase();
      return terms.every(w => hay.includes(w));
    });
  }, [tickets, filter, query]);

  const selected = tickets.find(t => t._id === selectedId) ?? null;

  function select(id: string | null) {
    setSelectedId(id); setReply(''); setActionErr(null);
    setParams(id ? { id } : {}, { replace: true });
  }

  function patchLocal(t: SupportTicket) {
    setTickets(prev => prev.map(x => (x._id === t._id ? t : x)));
    void watcher.refresh();   // update the sidebar / bell counts straight away
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setBusy(true); setActionErr(null);
    try { patchLocal(await replyToTicket(selected._id, reply.trim())); setReply(''); }
    catch (e) { setActionErr(e instanceof Error ? e.message : 'Could not send reply'); }
    finally { setBusy(false); }
  }

  async function changeStatus(status: TicketStatus) {
    if (!selected) return;
    setBusy(true); setActionErr(null);
    try { patchLocal(await setTicketStatus(selected._id, status)); }
    catch (e) { setActionErr(e instanceof Error ? e.message : 'Could not update the ticket'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-canvas px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-ink"><LifeBuoy size={18} className="text-brand" /> Support Tickets</h1>
          <p className="text-xs text-ink/50">Questions and problems sent in by hotels</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/60 hover:bg-mist disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* List */}
        <div className={`flex min-h-0 flex-col border-r border-border bg-canvas ${selected ? 'hidden w-full md:flex md:w-[380px]' : 'w-full md:w-[380px]'}`}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search subject, hotel or phone…"
                className="search-input w-full py-1.5 pl-8 pr-2 text-xs" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(f => (
                <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    filter === f.key ? 'border-coffee bg-coffee text-white' : 'border-border text-umber hover:bg-mist'
                  }`}>
                  {f.label} <span className="opacity-70">{counts[f.key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && tickets.length === 0 ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : error ? (
              <p className="m-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            ) : shown.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink/40">
                {filter === 'open' && !query ? 'No open tickets — all clear.' : 'No tickets match.'}
              </p>
            ) : shown.map(t => (
              <button key={t._id} type="button" onClick={() => select(t._id)}
                className={`block w-full border-b border-border/60 px-4 py-3 text-left transition-colors ${t._id === selectedId ? 'bg-brand/[0.06]' : 'hover:bg-mist'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-ink">{t.subject}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-ink/55">{t.hotelName} · {t.hotelPhone}</p>
                <p className="mt-0.5 text-[10px] text-ink/40">
                  <span className={`font-semibold capitalize ${PRIORITY_CLS[t.priority]}`}>{t.priority}</span>
                  {' · '}<span className="capitalize">{t.category}</span>
                  {' · '}{fmtWhen(t.createdAt)}
                  {t.replies.length > 0 && ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}`}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        {selected ? (
          <div className="flex min-h-0 flex-1 flex-col bg-mist">
            <div className="flex items-start justify-between gap-3 border-b border-border bg-canvas px-5 py-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-ink">{selected.subject}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink/55">
                  <span className="font-medium text-ink/70">{selected.hotelName}</span>
                  <a href={`tel:${selected.hotelPhone}`} className="flex items-center gap-1 text-brand hover:underline"><Phone size={11} />{selected.hotelPhone}</a>
                  <span className="capitalize">· {selected.category}</span>
                  <span className={`font-semibold capitalize ${PRIORITY_CLS[selected.priority]}`}>· {selected.priority} priority</span>
                  {selected.hotelId && (
                    <Link to={`/super-admin/hotels/${selected.hotelId}`} className="font-medium text-brand hover:underline">
                      · Open hotel{selected.subject === 'Password reset request' ? ' to reset password' : ''} →
                    </Link>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_CLS[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
                <button type="button" onClick={() => select(null)} aria-label="Close ticket view"
                  className="rounded-lg border border-border p-1 text-ink/40 hover:bg-mist"><X size={14} /></button>
              </div>
            </div>

            {/* Thread */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <div className="max-w-[85%] rounded-xl border border-border bg-canvas px-4 py-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/40">{selected.hotelName} · {fmtWhen(selected.createdAt)}</p>
                <p className="whitespace-pre-wrap text-sm text-ink">{selected.description}</p>
              </div>
              {selected.replies.map((r, i) => (
                <div key={i} className={`max-w-[85%] rounded-xl px-4 py-3 ${r.by === 'superadmin' ? 'ml-auto bg-coffee text-white' : 'border border-border bg-canvas text-ink'}`}>
                  <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${r.by === 'superadmin' ? 'text-white/60' : 'text-ink/40'}`}>
                    {r.by === 'superadmin' ? 'Dine POS support' : selected.hotelName} · {fmtWhen(r.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{r.message}</p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="space-y-2 border-t border-border bg-canvas p-4">
              {actionErr && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{actionErr}</p>}
              <div className="flex gap-2">
                <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void sendReply(); } }}
                  placeholder="Write a reply to the hotel…  (Ctrl+Enter to send)"
                  className="min-w-0 flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50" />
                <button type="button" onClick={() => void sendReply()} disabled={busy || !reply.trim()}
                  className="flex items-center gap-1.5 self-end rounded-lg bg-action px-4 py-2 text-sm font-semibold text-white hover:bg-action-press">
                  <Send size={14} /> {busy ? 'Sending…' : 'Reply'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-ink/35">Mark as</span>
                {(['in-progress', 'resolved', 'closed'] as TicketStatus[]).filter(s => s !== selected.status).map(s => (
                  <button key={s} type="button" onClick={() => void changeStatus(s)} disabled={busy}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-umber hover:bg-mist">
                    {STATUS_LABEL[s]}
                  </button>
                ))}
                {!isOpen(selected) && (
                  <button type="button" onClick={() => void changeStatus('open')} disabled={busy}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-umber hover:bg-mist">Reopen</button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden flex-1 items-center justify-center text-sm text-ink/40 md:flex">
            Pick a ticket to read and reply.
          </div>
        )}
      </div>
    </div>
  );
}
