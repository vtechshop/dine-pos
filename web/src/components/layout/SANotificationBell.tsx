import { useEffect, useRef, useState } from 'react';
import { Bell, X, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSANotifications } from '../../context/SANotificationsContext';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TYPE_DOT: Record<string, string> = {
  info:        'bg-blue-500',
  warning:     'bg-amber-500',
  maintenance: 'bg-orange-500',
  update:      'bg-violet-500',
  success:     'bg-green-500',
};

export function SANotificationBell() {
  const [open, setOpen]   = useState(false);
  const containerRef      = useRef<HTMLDivElement>(null);
  const { notifications, unreadCount, loading, markAllRead } = useSANotifications();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function toggle() {
    const opening = !open;
    setOpen(opening);
    if (opening) markAllRead();
  }

  const recent = notifications.slice(0, 5);

  return (
    <div ref={containerRef} className="relative">

      {/* ── Bell trigger ── */}
      <button
        onClick={toggle}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          open ? 'bg-brand/10 text-brand' : 'text-ink/70 hover:bg-mist hover:text-ink'
        }`}
      >
        <div className="relative flex-shrink-0">
          <Bell size={16} strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold leading-none text-canvas">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        <span>Notifications</span>
        {unreadCount > 0 && (
          <span className="ml-auto rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
            {unreadCount}
          </span>
        )}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 overflow-hidden rounded-xl border border-border bg-canvas shadow-lg">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-ink">Recent Notifications</p>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-ink/40 hover:bg-mist hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <p className="py-8 text-center text-sm text-ink/40">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink/40">No notifications</p>
            ) : (
              recent.map(n => (
                <div key={n._id} className="border-b border-border px-4 py-3 last:border-0 hover:bg-mist/40">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        TYPE_DOT[n.type] ?? 'bg-ink/30'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium text-ink">{n.title}</p>
                        <span className="flex-shrink-0 text-[11px] text-ink/40">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink/50">{n.message}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2.5">
            <Link
              to="/super-admin/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
            >
              View all notifications
              <ChevronRight size={12} />
            </Link>
          </div>

        </div>
      )}
    </div>
  );
}
