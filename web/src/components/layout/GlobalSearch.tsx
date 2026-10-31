import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CalendarDays, ShoppingCart, User, LayoutGrid, Loader2 } from 'lucide-react';
import { globalSearch, type SearchResults } from '../../api/search';

const EMPTY: SearchResults = { reservations: [], orders: [], customers: [], tables: [] };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Top-bar search: reservations, orders, customers and tables by name / phone / number. */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ]             = useState('');
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [res, setRes]         = useState<SearchResults>(EMPTY);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search; ignore responses for stale queries.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(EMPTY); setLoading(false); return; }
    setLoading(true);
    let live = true;
    const t = setTimeout(() => {
      globalSearch(term)
        .then(r => { if (live) setRes(r); })
        .catch(() => { if (live) setRes(EMPTY); })
        .finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  // Close when clicking outside.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const go = (path: string) => { setOpen(false); setQ(''); navigate(path); };

  const total = res.reservations.length + res.orders.length + res.customers.length + res.tables.length;
  const showPanel = open && q.trim().length >= 2;

  const row = 'flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-mist';
  const head = 'px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink/40';

  return (
    <div ref={boxRef} className="relative hidden w-64 md:block xl:w-80">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); } }}
        placeholder="Search reservations, orders, customers…"
        aria-label="Search"
        className="search-input h-8 w-full pl-8 pr-8 text-xs"
      />
      {loading && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink/35" />}

      {showPanel && (
        <div className="absolute left-0 right-0 top-10 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-canvas py-1 shadow-xl">
          {!loading && total === 0 && (
            <p className="px-3 py-4 text-center text-xs text-ink/45">No matches for “{q.trim()}”</p>
          )}

          {res.reservations.length > 0 && (
            <>
              <p className={head}>Reservations</p>
              {res.reservations.map(r => (
                <button key={r._id} className={row}
                  onClick={() => go(`/reservations?date=${new Date(r.date).toISOString().slice(0, 10)}`)}>
                  <CalendarDays size={14} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink">{r.customerName}</span>
                    <span className="block truncate text-[11px] text-ink/50">
                      {fmtDate(r.date)} · {r.time}{r.partySize ? ` · ${r.partySize} guests` : ''}{r.phone ? ` · ${r.phone}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] capitalize text-ink/45">{r.status.replace(/_/g, ' ')}</span>
                </button>
              ))}
            </>
          )}

          {res.orders.length > 0 && (
            <>
              <p className={head}>Orders</p>
              {res.orders.map(o => (
                <button key={o._id} className={row}
                  onClick={() => go(`/orders?order=${encodeURIComponent(o._id)}&q=${encodeURIComponent(o.orderNumber)}`)}>
                  <ShoppingCart size={14} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs font-semibold text-ink">{o.orderNumber}</span>
                    <span className="block truncate text-[11px] text-ink/50">
                      {fmtDate(o.createdAt)}{o.customerName ? ` · ${o.customerName}` : ''}{o.tableNumber ? ` · Table ${o.tableNumber}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] capitalize text-ink/45">{o.status === 'completed' ? 'paid' : o.status.replace(/_/g, ' ')}</span>
                </button>
              ))}
            </>
          )}

          {res.customers.length > 0 && (
            <>
              <p className={head}>Customers</p>
              {res.customers.map(c => (
                <button key={c._id} className={row} onClick={() => go(`/customers?id=${encodeURIComponent(c._id)}`)}>
                  <User size={14} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink">{c.name}</span>
                    {c.phone && <span className="block truncate text-[11px] text-ink/50">{c.phone}</span>}
                  </span>
                </button>
              ))}
            </>
          )}

          {res.tables.length > 0 && (
            <>
              <p className={head}>Tables</p>
              {res.tables.map(t => (
                <button key={t._id} className={row} onClick={() => go('/tables')}>
                  <LayoutGrid size={14} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                    {t.name || `T${t.number}`} <span className="font-normal text-ink/45">#{t.number}</span>
                  </span>
                  <span className="shrink-0 text-[10px] capitalize text-ink/45">{t.status}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
