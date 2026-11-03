import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { fetchTickets, type SupportTicket } from '../api/saTickets';

// Watches support tickets for the Super Admin console: what needs a reply,
// what is new since last seen, and a toast for anything that just arrived.

const SEEN_KEY = 'sa_ticket_seen';
const POLL_MS  = 30_000;

/** Waiting on us: never answered, or the hotel wrote last. */
export function needsReply(t: SupportTicket): boolean {
  if (t.status === 'resolved' || t.status === 'closed') return false;
  if (t.status === 'open') return true;
  const last = t.replies[t.replies.length - 1];
  return !!last && last.by === 'hotel';
}

/** Changes whenever the hotel adds something (new ticket or new reply). */
const activityKey = (t: SupportTicket) => `${t._id}:${t.replies.length}`;

function loadSeen(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]); }
  catch { return new Set<string>(); }
}
function saveSeen(s: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500))); } catch { /* storage blocked */ }
}

interface Ctx {
  waiting:   SupportTicket[];   // tickets that need a reply
  unseen:    SupportTicket[];   // waiting tickets not looked at yet
  latestNew: SupportTicket | null;   // most recent arrival this session (for the toast)
  refresh:   () => Promise<void>;
  markSeen:  () => void;
}

const SATicketsCtx = createContext<Ctx>({
  waiting: [], unseen: [], latestNew: null, refresh: async () => {}, markSeen: () => {},
});

export const useSATickets = () => useContext(SATicketsCtx);

export function SATicketsProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets]     = useState<SupportTicket[]>([]);
  const [seen, setSeen]           = useState<Set<string>>(loadSeen);
  const [latestNew, setLatestNew] = useState<SupportTicket | null>(null);
  const known = useRef<Set<string> | null>(null);   // activity keys at the previous poll

  const refresh = useCallback(async () => {
    try {
      const list = await fetchTickets();
      const keys = new Set(list.filter(needsReply).map(activityKey));
      if (known.current) {
        // Something that wasn't waiting at the last poll → announce it
        const arrived = list.filter(t => needsReply(t) && !known.current!.has(activityKey(t)));
        if (arrived.length) {
          const newest = [...arrived].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
          setLatestNew(newest);
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Support ticket', { body: `${newest.hotelName}: ${newest.subject}`, icon: '/favicon.ico' }); } catch { /* ignore */ }
          }
        }
      }
      known.current = keys;
      setTickets(list);
    } catch { /* keep last known list; the tickets page shows errors */ }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const waiting = useMemo(() => tickets.filter(needsReply), [tickets]);
  const unseen  = useMemo(() => waiting.filter(t => !seen.has(activityKey(t))), [waiting, seen]);

  const markSeen = useCallback(() => {
    setSeen(prev => {
      const next = new Set([...prev, ...waiting.map(activityKey)]);
      saveSeen(next);
      return next;
    });
  }, [waiting]);

  return (
    <SATicketsCtx.Provider value={{ waiting, unseen, latestNew, refresh, markSeen }}>
      {children}
    </SATicketsCtx.Provider>
  );
}
