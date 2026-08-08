import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Info, AlertTriangle, Wrench, RefreshCw, CheckCheck, X } from 'lucide-react';
import { apiFetch } from '../../api/client';
import { useSocket } from '../../context/SocketContext';

interface BroadcastNotification {
  _id:       string;
  title:     string;
  message:   string;
  type:      'info' | 'warning' | 'maintenance' | 'update' | 'success';
  isRead:    boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: BroadcastNotification[];
  unreadCount:   number;
}

function typeIcon(type: BroadcastNotification['type']) {
  switch (type) {
    case 'warning':     return <AlertTriangle size={13} className="text-amber-500" />;
    case 'maintenance': return <Wrench         size={13} className="text-amber-600" />;
    case 'success':     return <CheckCheck     size={13} className="text-green-500" />;
    default:            return <Info           size={13} className="text-blue-500"  />;
  }
}

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function BroadcastBell() {
  const [open,      setOpen]      = useState(false);
  const [items,     setItems]     = useState<BroadcastNotification[]>([]);
  const [unread,    setUnread]    = useState(0);
  const [loading,   setLoading]   = useState(false);
  const { socket } = useSocket();
  const panelRef   = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<NotificationsResponse>('/notifications');
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch { /* silently ignore — admin may not have access */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => { fetchNotifications(); };
    socket.on('new_broadcast', handler);
    return () => { socket.off('new_broadcast', handler); };
  }, [socket, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'PUT' });
      setItems(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
      setUnread(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await apiFetch('/notifications/read-all', { method: 'PUT' });
      setItems(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnread(0);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Broadcast notifications"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-border bg-canvas shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-xs font-semibold text-ink">Announcements</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] font-medium text-brand hover:underline"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={fetchNotifications}
                className="rounded p-0.5 text-ink/30 hover:text-ink/60"
                aria-label="Refresh"
              >
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              </button>
              <button onClick={() => setOpen(false)} className="text-ink/30 hover:text-ink/60">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink/30">No announcements</p>
            ) : (
              items.map(n => (
                <div
                  key={n._id}
                  className={`flex gap-3 border-b border-border/50 px-4 py-3 transition-colors hover:bg-mist/60 ${!n.isRead ? 'bg-brand/[0.03]' : ''}`}
                >
                  <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-semibold leading-snug text-ink ${!n.isRead ? '' : 'opacity-70'}`}>
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <button
                          onClick={() => markRead(n._id)}
                          className="shrink-0 text-[9px] text-brand hover:underline"
                        >
                          read
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink/50">{n.message}</p>
                    <p className="mt-1 text-[10px] text-ink/30">{formatAge(n.createdAt)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
