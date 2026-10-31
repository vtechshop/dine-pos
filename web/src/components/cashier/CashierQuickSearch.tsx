import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useCashier, type CashierTab } from '../../context/CashierContext';

// Every cashier screen with the words people are likely to type for it.
const SCREENS: { tab: CashierTab; label: string; words: string }[] = [
  { tab: 'dashboard',     label: 'POS (today’s sales)', words: 'pos home dashboard sales today report summary' },
  { tab: 'new-order',     label: 'New Order',           words: 'new order bill billing takeaway dine delivery cart add' },
  { tab: 'pending',       label: 'Pending Bills',       words: 'pending bills unpaid payment pay settle' },
  { tab: 'hold',          label: 'Hold Bills',          words: 'hold held parked bills' },
  { tab: 'tables',        label: 'Tables',              words: 'tables table dine in seat' },
  { tab: 'kitchen',       label: 'Kitchen Queue',       words: 'kitchen kot queue cooking preparing ready' },
  { tab: 'online-orders', label: 'Online Orders',       words: 'online swiggy zomato delivery aggregator' },
  { tab: 'search',        label: 'Order History',       words: 'order history orders past today bill search find receipt invoice reprint refund' },
  { tab: 'customers',     label: 'Customers',           words: 'customers customer loyalty phone points' },
  { tab: 'shift',         label: 'Shift',               words: 'shift sales cash sales open close total' },
  { tab: 'shift-history', label: 'Shift History',       words: 'shift history past shifts z report' },
  { tab: 'drawer',        label: 'Cash Drawer',         words: 'cash drawer balance cash in out petty' },
  { tab: 'printers',      label: 'Printers',            words: 'printer printers print kot test offline' },
  { tab: 'profile',       label: 'Profile',             words: 'profile me account' },
  { tab: 'permissions',   label: 'Permissions',         words: 'permissions access rights' },
];

/** Jump to any cashier screen by typing its name ("drawer", "sales", "hold"…). Press / to focus. */
export function CashierQuickSearch({ dark = false }: { dark?: boolean }) {
  const { setActiveTab } = useCashier();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return SCREENS.filter(s => {
      const hay = `${s.label} ${s.words}`.toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [q]);

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

  function go(tab: CashierTab) {
    setActiveTab(tab);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const m = matches[hi]; if (m) go(m.tab); }
    else if (e.key === 'Escape') { setQ(''); setOpen(false); inputRef.current?.blur(); }
  }

  return (
    <div className="relative w-48 shrink-0 xl:w-60">
      <Search size={13} className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ${dark ? 'text-white/40' : 'text-ink/35'}`} />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search screens"
        value={q}
        onChange={e => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder="Search: drawer, sales…  ( / )"
        className={dark
          ? 'w-full rounded-lg border border-white/15 bg-white/[0.06] py-1.5 pl-8 pr-2 text-xs text-white placeholder-white/35 outline-none transition focus:border-white/30 focus:bg-white/[0.1]'
          : 'search-input w-full py-1.5 pl-8 pr-2 text-xs'}
      />
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-canvas py-1 shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink/40">No screen matches “{q.trim()}”</p>
          ) : matches.map((m, i) => (
            <button
              key={m.tab}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => go(m.tab)}
              className={`block w-full px-3 py-2 text-left text-xs ${i === hi ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-mist'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
