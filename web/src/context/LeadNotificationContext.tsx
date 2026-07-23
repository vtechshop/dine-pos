import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Lead } from '../api/saLeads';

// H-5: Never fall back to localhost — if VITE_SOCKET_URL is unset use VITE_API_URL
// (the API base is already required for all other SA calls, so it's always present).
const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL;
const FEED_MAX = 50;

export interface ActivityFeedItem {
  id: string;
  message: string;
  lead: Lead;
  ts: string;
}

interface LeadNotifCtx {
  connected: boolean;
  activityFeed: ActivityFeedItem[];
  unreadCount: number;
  clearUnread: () => void;
}

const Ctx = createContext<LeadNotifCtx>({
  connected:    false,
  activityFeed: [],
  unreadCount:  0,
  clearUnread:  () => undefined,
});

export function useLeadNotifications() {
  return useContext(Ctx);
}

// H-4: requestPermission() MUST be called from a user gesture (click/keypress).
// Calling it from a socket callback causes Chrome 80+ and Firefox 72+ to auto-deny.
// Export this function; the UI calls it from a button onClick handler.
export async function requestLeadNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

export function LeadNotificationProvider({ children }: { children: ReactNode }) {
  const [connected,    setConnected]    = useState(false);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>([]);
  const [unreadCount,  setUnreadCount]  = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  useEffect(() => {
    const saToken = localStorage.getItem('pos_token');
    if (!saToken) return;

    const socket = io(SOCKET_URL, {
      auth: { token: saToken },
      transports: ['websocket'],
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on('connect',    () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('new_lead', (lead: Lead) => {
      const item: ActivityFeedItem = {
        id:      lead._id,
        message: `${lead.companyName} ${lead.source === 'website_demo' ? 'booked a demo' : 'submitted a contact form'}`,
        lead,
        ts:      new Date().toISOString(),
      };

      setActivityFeed(prev => [item, ...prev].slice(0, FEED_MAX));
      setUnreadCount(prev => prev + 1);

      // H-4: Only fire if permission already granted — never call requestPermission()
      // from here. Permission must be requested via a user gesture (see
      // requestLeadNotificationPermission exported above).
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('New Lead', {
          body: `${lead.companyName} — ${lead.phone}`,
          icon: '/favicon.ico',
        });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return (
    <Ctx.Provider value={{ connected, activityFeed, unreadCount, clearUnread }}>
      {children}
    </Ctx.Provider>
  );
}
