import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building2, ArrowRight } from 'lucide-react';
import { getHotels, type Hotel } from '../../api/superAdmin';

// Every Super Admin page with the words people are likely to type for it.
const PAGES: { to: string; label: string; words: string }[] = [
  { to: '/super-admin/dashboard',            label: 'Dashboard',                 words: 'home overview revenue sales today monthly growth registrations totals' },
  { to: '/super-admin/hotels',               label: 'Hotels',                    words: 'hotels restaurants clients approve reject suspend trial pending active' },
  { to: '/super-admin/live',                 label: 'Live',                      words: 'live realtime online now activity orders' },
  { to: '/super-admin/health',               label: 'Health',                    words: 'health status uptime server errors system' },
  { to: '/super-admin/versions',             label: 'Versions',                  words: 'versions app release update remote config maintenance' },
  { to: '/super-admin/analytics',            label: 'Analytics',                 words: 'analytics sales revenue charts top hotels trends reports' },
  { to: '/super-admin/broadcast',            label: 'Broadcast',                 words: 'broadcast announcement message notify all hotels' },
  { to: '/super-admin/subscriptions',        label: 'Subscriptions',             words: 'subscriptions billing plans payments renew saas invoice' },
  { to: '/super-admin/tickets',              label: 'Support Tickets',           words: 'support tickets help complaints issues problems reply open' },
  { to: '/super-admin/notifications',        label: 'Notifications',             words: 'notifications alerts bell support tickets' },
  { to: '/super-admin/leads/dashboard',      label: 'Sales CRM · Dashboard',     words: 'sales crm leads dashboard conversion' },
  { to: '/super-admin/leads',                label: 'Sales CRM · All Leads',     words: 'sales crm leads prospects enquiries contacts' },
  { to: '/super-admin/leads/demos',          label: 'Sales CRM · Demo Requests', words: 'sales crm demo requests booking' },
  { to: '/super-admin/leads/followups',      label: 'Sales CRM · Follow Ups',    words: 'sales crm follow ups calls reminders' },
  { to: '/super-admin/leads/pipeline',       label: 'Sales CRM · Pipeline',      words: 'sales crm pipeline kanban stages deals' },
  { to: '/super-admin/aggregator',           label: 'Delivery · Dashboard',      words: 'delivery swiggy zomato aggregator dashboard' },
  { to: '/super-admin/aggregator/hotels',    label: 'Delivery · Hotels',         words: 'delivery swiggy zomato hotels integrations enable' },
  { to: '/super-admin/aggregator/monitor',   label: 'Delivery · Monitor',        words: 'delivery swiggy zomato monitor api health menu sync' },
  { to: '/super-admin/aggregator/orders',    label: 'Delivery · Orders',         words: 'delivery swiggy zomato orders feed' },
  { to: '/super-admin/aggregator/analytics', label: 'Delivery · Analytics',      words: 'delivery swiggy zomato analytics top hotels cities items trends' },
  { to: '/super-admin/aggregator/webhooks',  label: 'Delivery · Webhooks',       words: 'delivery swiggy zomato webhooks log retry' },
  { to: '/super-admin/aggregator/settings',  label: 'Delivery · Settings',       words: 'delivery swiggy zomato settings timeout retry rate limit' },
  { to: '/super-admin/aggregator/audit',     label: 'Delivery · Alerts & Audit', words: 'delivery swiggy zomato alerts audit log' },
  { to: '/super-admin/aggregator/reports',   label: 'Delivery · Reports',        words: 'delivery swiggy zomato reports csv download export' },
];

type Result =
  | { kind: 'page';  key: string; label: string; to: string }
  | { kind: 'hotel'; key: string; label: string; to: string; sub: string };

/** Jump to any Super Admin page or hotel by typing. Press / to focus. */
export function SAQuickSearch() {
  const navigate = useNavigate();
  const [q, setQ]       = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi]     = useState(0);
  const [hotels, setHotels] = useState<Hotel[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the hotel list the first time the box is used
  function ensureHotels() {
    if (hotels !== null) return;
    setHotels([]);
    getHotels().then(r => setHotels(r.hotels)).catch(() => setHotels([]));
  }

  const results = useMemo<Result[]>(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const pages: Result[] = PAGES
      .filter(p => terms.every(t => `${p.label} ${p.words}`.toLowerCase().includes(t)))
      .map(p => ({ kind: 'page', key: p.to, label: p.label, to: p.to }));
    const hotelHits: Result[] = (hotels ?? [])
      .filter(h => terms.every(t => [h.hotelName, h.city, h.ownerName, h.phone, h.status].join(' ').toLowerCase().includes(t)))
      .slice(0, 6)
      .map(h => ({
        kind: 'hotel', key: h._id, label: h.hotelName, to: `/super-admin/hotels/${h._id}`,
        sub: [h.city, h.status].filter(Boolean).join(' · '),
      }));
    return [...pages, ...hotelHits];
  }, [q, hotels]);

  // "/" focuses the box unless the user is already typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function go(r: Result) {
    navigate(r.to);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[hi]; if (r) go(r); }
    else if (e.key === 'Escape') { setQ(''); setOpen(false); inputRef.current?.blur(); }
  }

  return (
    <div className="relative">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search pages and hotels"
        value={q}
        onChange={e => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onFocus={() => { setOpen(true); ensureHotels(); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder="Search: sales, hotels…  ( / )"
        className="search-input w-full py-1.5 pl-8 pr-2 text-xs"
      />
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-canvas py-1 shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink/40">Nothing matches “{q.trim()}”</p>
          ) : results.map((r, i) => (
            <button
              key={r.kind + r.key}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => go(r)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${i === hi ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-mist'}`}
            >
              {r.kind === 'hotel'
                ? <Building2 size={12} className="shrink-0 text-ink/40" />
                : <ArrowRight size={12} className="shrink-0 text-ink/30" />}
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {r.kind === 'hotel' && r.sub && <span className="shrink-0 text-[10px] capitalize text-ink/40">{r.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
