import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getNotifications,
  getDashboard,
  createNotification as apiCreate,
  deleteNotification as apiDelete,
  type SANotification,
  type CreateNotificationPayload,
} from '../api/superAdmin';

// ── localStorage read-state helpers ───────────────────────────────────────────

const READ_KEY = 'sa_notif_read';

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function persistReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch { /* localStorage blocked — silent */ }
}

// ── context shape ──────────────────────────────────────────────────────────────

interface SANotificationsCtxValue {
  notifications: SANotification[];
  loading:       boolean;
  error:         string | null;
  unreadCount:   number;
  hotelCount:    number | null; // active + trial hotels for broadcast copy
  refresh:       () => Promise<void>;
  create:        (p: CreateNotificationPayload) => Promise<void>;
  remove:        (id: string) => Promise<void>;
  markAllRead:   () => void;
  isRead:        (id: string) => boolean;
}

const SANotificationsCtx = createContext<SANotificationsCtxValue | null>(null);

// ── provider ───────────────────────────────────────────────────────────────────

export function SANotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<SANotification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [readIds,       setReadIds]       = useState<Set<string>>(loadReadIds);
  const [hotelCount,    setHotelCount]    = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [notifRes, dashRes] = await Promise.allSettled([
      getNotifications(),
      getDashboard(),
    ]);

    if (notifRes.status === 'fulfilled') {
      setNotifications(notifRes.value);
      setError(null);
    } else {
      setError(
        notifRes.reason instanceof Error
          ? notifRes.reason.message
          : 'Failed to load notifications',
      );
    }

    if (dashRes.status === 'fulfilled') {
      const { active, trial } = dashRes.value.hotelStats;
      setHotelCount(active + trial);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Unread count derived from current notifications vs read set
  const unreadCount = useMemo(
    () => notifications.filter(n => !readIds.has(n._id)).length,
    [notifications, readIds],
  );

  const markAllRead = useCallback(() => {
    setReadIds(prev => {
      const next = new Set([...prev, ...notifications.map(n => n._id)]);
      persistReadIds(next);
      return next;
    });
  }, [notifications]);

  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);

  const create = useCallback(async (payload: CreateNotificationPayload) => {
    const res = await apiCreate(payload);
    setNotifications(prev => [res.notification, ...prev]);
  }, []);

  const remove = useCallback(async (id: string) => {
    await apiDelete(id);
    setNotifications(prev => prev.filter(n => n._id !== id));
    setReadIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      persistReadIds(next);
      return next;
    });
  }, []);

  return (
    <SANotificationsCtx.Provider value={{
      notifications, loading, error, unreadCount, hotelCount,
      refresh, create, remove, markAllRead, isRead,
    }}>
      {children}
    </SANotificationsCtx.Provider>
  );
}

// ── consumer hook ──────────────────────────────────────────────────────────────

export function useSANotifications(): SANotificationsCtxValue {
  const ctx = useContext(SANotificationsCtx);
  if (!ctx) throw new Error('useSANotifications must be inside SANotificationsProvider');
  return ctx;
}
