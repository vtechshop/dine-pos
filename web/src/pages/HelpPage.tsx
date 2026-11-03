import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LifeBuoy, MessageCircle, Phone, Mail, Plus, Send, X, RefreshCw, ArrowLeft } from 'lucide-react';
import {
  fetchMyTickets, raiseTicket, replyToMyTicket,
  type HotelTicket, type TicketCategory, type TicketPriority, type TicketStatus,
} from '../api/tickets';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY, SUPPORT_EMAIL, supportWhatsAppUrl } from '../config/support';
import { Spinner } from '../components/ui/Spinner';

// Help & Support inside the signed-in website: quick contact options plus
// support tickets (raise one, read our replies, reply back).

const STATUS_LABEL: Record<TicketStatus, string> = {
  'open': 'Waiting for support', 'in-progress': 'Support replied', 'resolved': 'Resolved', 'closed': 'Closed',
};
const STATUS_CLS: Record<TicketStatus, string> = {
  'open':        'border-amber-200 bg-amber-50 text-amber-700',
  'in-progress': 'border-sky-200 bg-sky-50 text-sky-700',
  'resolved':    'border-emerald-200 bg-emerald-50 text-emerald-700',
  'closed':      'border-border bg-mist text-ink/50',
};
const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: 'technical', label: 'Something is not working' },
  { value: 'billing',   label: 'Billing / subscription' },
  { value: 'account',   label: 'Account / login' },
  { value: 'other',     label: 'Other' },
];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function HelpPage() {
  const [tickets, setTickets]   = useState<HotelTicket[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setTickets(await fetchMyTickets()); }
    catch { setError("Couldn't load your tickets. Please try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = tickets.find(t => t._id === openId) ?? null;
  const patch = (t: HotelTicket) => setTickets(prev => prev.map(x => (x._id === t._id ? t : x)));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-5 md:p-8">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink"><LifeBuoy size={20} className="text-brand" /> Help &amp; Support</h1>
          <p className="mt-1 text-sm text-ink/50">Talk to the Dine POS team, or raise a ticket and track our reply here.</p>
        </div>

        {/* Quick contact */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: MessageCircle, title: 'WhatsApp', detail: 'Fastest reply', href: supportWhatsAppUrl(), ext: true,  tone: 'bg-green-50 text-green-600' },
            { icon: Phone,         title: 'Call us',  detail: SUPPORT_PHONE_DISPLAY, href: `tel:${SUPPORT_PHONE}`, ext: false, tone: 'bg-brand/10 text-brand' },
            { icon: Mail,          title: 'Email',    detail: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Dine POS support')}`, ext: false, tone: 'bg-sky-50 text-sky-600' },
          ].map(o => (
            <a key={o.title} href={o.href} {...(o.ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="flex items-center gap-3 rounded-xl border border-border bg-canvas p-4 transition hover:border-brand/40 hover:shadow-sm">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${o.tone}`}><o.icon size={18} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{o.title}</span>
                <span className="block truncate text-xs text-ink/50">{o.detail}</span>
              </span>
            </a>
          ))}
        </div>

        {/* Tickets */}
        <section className="rounded-2xl border border-border bg-canvas">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-ink">My support tickets</h2>
              <p className="text-xs text-ink/45">We usually reply within a few hours (Mon–Sat, 9 AM–6 PM).</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void load()} aria-label="Refresh tickets"
                className="rounded-lg p-1.5 text-ink/40 hover:bg-mist hover:text-ink/70">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              {!creating && !open && (
                <button type="button" onClick={() => setCreating(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-action px-3 py-2 text-xs font-semibold text-white hover:bg-action-press">
                  <Plus size={14} /> Raise a ticket
                </button>
              )}
            </div>
          </div>

          {creating ? (
            <NewTicketForm
              onCancel={() => setCreating(false)}
              onCreated={t => { setTickets(prev => [t, ...prev]); setCreating(false); setOpenId(t._id); }}
            />
          ) : open ? (
            <TicketThread ticket={open} onBack={() => setOpenId(null)} onUpdated={patch} />
          ) : loading && tickets.length === 0 ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button type="button" onClick={() => void load()}
                className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist">Try again</button>
            </div>
          ) : tickets.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-ink/50">No tickets yet.</p>
              <p className="mt-1 text-xs text-ink/40">Something not working? Press “Raise a ticket” and tell us.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {tickets.map(t => {
                const last = t.replies[t.replies.length - 1];
                return (
                  <li key={t._id}>
                    <button type="button" onClick={() => setOpenId(t._id)} className="block w-full px-5 py-3 text-left hover:bg-mist">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-semibold text-ink">{t.subject}</p>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink/50">
                        {last ? `${last.by === 'superadmin' ? 'Support' : 'You'}: ${last.message}` : t.description}
                      </p>
                      <p className="mt-0.5 text-[10px] text-ink/40">Raised {fmtWhen(t.createdAt)} · {t.replies.length} repl{t.replies.length === 1 ? 'y' : 'ies'}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Raise a ticket ────────────────────────────────────────────────────────────

function NewTicketForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (t: HotelTicket) => void }) {
  const [subject, setSubject]         = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory]       = useState<TicketCategory>('technical');
  const [priority, setPriority]       = useState<TicketPriority>('medium');
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) { setErr('Please fill in the subject and what happened.'); return; }
    setSaving(true); setErr(null);
    try {
      onCreated(await raiseTicket({ subject: subject.trim(), description: description.trim(), category, priority }));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not send the ticket. Please try again.');
      setSaving(false);
    }
  }

  const field = 'w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50';
  return (
    <form onSubmit={submit} className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Raise a ticket</p>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="rounded p-1 text-ink/40 hover:bg-mist"><X size={15} /></button>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/60">Subject *</span>
        <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={120} placeholder="e.g. Kitchen printer not printing KOT" className={field} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink/60">Type</span>
          <select value={category} onChange={e => setCategory(e.target.value as TicketCategory)} className={field}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink/60">How urgent?</span>
          <select value={priority} onChange={e => setPriority(e.target.value as TicketPriority)} className={field}>
            <option value="high">High — billing is stopped</option>
            <option value="medium">Medium</option>
            <option value="low">Low — a question</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/60">What happened? *</span>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} maxLength={4000}
          placeholder="What were you doing, what went wrong, and when?" className={`${field} resize-y`} />
      </label>
      {err && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm text-ink/60 hover:bg-mist">Cancel</button>
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-action px-4 py-2 text-sm font-semibold text-white hover:bg-action-press">
          <Send size={14} /> {saving ? 'Sending…' : 'Send ticket'}
        </button>
      </div>
    </form>
  );
}

// ── One ticket: conversation + reply ──────────────────────────────────────────

function TicketThread({ ticket, onBack, onUpdated }: { ticket: HotelTicket; onBack: () => void; onUpdated: (t: HotelTicket) => void }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  async function send() {
    if (!reply.trim()) return;
    setBusy(true); setErr(null);
    try { onUpdated(await replyToMyTicket(ticket._id, reply.trim())); setReply(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not send your reply.'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <button type="button" onClick={onBack} aria-label="Back to tickets" className="mt-0.5 rounded p-1 text-ink/40 hover:bg-mist"><ArrowLeft size={15} /></button>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{ticket.subject}</p>
            <p className="text-[11px] capitalize text-ink/45">{ticket.category} · {ticket.priority} priority · raised {fmtWhen(ticket.createdAt)}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLS[ticket.status]}`}>{STATUS_LABEL[ticket.status]}</span>
      </div>

      <div className="space-y-3 bg-mist/60 px-5 py-4">
        <div className="ml-auto max-w-[85%] rounded-xl bg-coffee px-4 py-3 text-white">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/60">You · {fmtWhen(ticket.createdAt)}</p>
          <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
        </div>
        {ticket.replies.map((r, i) => (
          <div key={i} className={`max-w-[85%] rounded-xl px-4 py-3 ${r.by === 'hotel' ? 'ml-auto bg-coffee text-white' : 'border border-border bg-canvas text-ink'}`}>
            <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${r.by === 'hotel' ? 'text-white/60' : 'text-brand'}`}>
              {r.by === 'hotel' ? 'You' : 'Dine POS support'} · {fmtWhen(r.createdAt)}
            </p>
            <p className="whitespace-pre-wrap text-sm">{r.message}</p>
          </div>
        ))}
        {ticket.replies.length === 0 && (
          <p className="text-center text-xs text-ink/40">Our team will reply here — usually within a few hours.</p>
        )}
      </div>

      <div className="space-y-2 border-t border-border p-4">
        {err && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
        <div className="flex gap-2">
          <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }}
            placeholder={ticket.status === 'resolved' || ticket.status === 'closed' ? 'Still a problem? Reply to reopen this ticket…' : 'Write a reply…'}
            className="min-w-0 flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50" />
          <button type="button" onClick={() => void send()} disabled={busy || !reply.trim()}
            className="flex items-center gap-1.5 self-end rounded-lg bg-action px-4 py-2 text-sm font-semibold text-white hover:bg-action-press">
            <Send size={14} /> {busy ? 'Sending…' : 'Reply'}
          </button>
        </div>
      </div>
    </div>
  );
}
