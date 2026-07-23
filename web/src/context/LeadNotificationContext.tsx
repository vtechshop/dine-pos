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

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5000';
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

export function LeadNotificationProvider({ children }: { children: ReactNode }) {
  const [connected,    setConnected]    = useState(false);
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>([]);
  const [unreadCount,  setUnreadCount]  = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  useEffect(() => {
    const saToken = localStorage.getItem('sa_token');
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

      // M4: Browser Notification (Web Notifications API)
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('New Demo Request', {
          body: `${lead.companyName} — ${lead.phone}`,
          icon: '/favicon.ico',
        });
      } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') {
            new Notification('New Demo Request', {
              body: `${lead.companyName} — ${lead.phone}`,
              icon: '/favicon.ico',
            });
          }
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
