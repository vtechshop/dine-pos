import { useState } from 'react';
import { Hotel, LogOut, User, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { NotificationBell } from '../ui/NotificationBell';
import { LiveBadge } from '../ui/LiveBadge';

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { hotelName, logout, role } = useAuth();
  const { connected, reconnecting } = useSocket();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const roleLabel = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : 'Admin';

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-ink px-5">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          {/* Hamburger — mobile only */}
          <button
            onClick={onMenuClick}
            aria-label="Open navigation"
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/[0.08] hover:text-white md:hidden"
          >
            <Menu size={18} />
          </button>

          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand">
            <Hotel size={14} className="text-white" />
          </div>
          <span className="text-base font-bold text-white tracking-tight">Dine POS</span>
          {hotelName && (
            <>
              <span className="text-white/25">/</span>
              <span className="max-w-48 truncate text-sm text-white/50" title={hotelName}>{hotelName}</span>
            </>
          )}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1">
          {/* Notification bell */}
          <NotificationBell />

          {/* Socket status badge */}
          <div className="mx-2">
            {connected ? (
              <LiveBadge label="Live" />
            ) : reconnecting ? (
              <span className="animate-pulse rounded-full bg-yellow-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white">
                Reconnecting
              </span>
            ) : (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/40">
                Offline
              </span>
            )}
          </div>

          <div className="h-4 w-px bg-white/15" />

          {/* User / sign-out */}
          <div className="flex items-center gap-1.5 pl-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 ring-1 ring-brand/30">
              <User size={13} className="text-brand" />
            </div>
            <span className="hidden text-sm text-white/70 sm:block">{roleLabel}</span>
            <button
              onClick={() => setConfirmLogout(true)}
              aria-label="Sign out"
              className="ml-1 rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/[0.08] hover:text-white/70"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Logout confirmation */}
      {confirmLogout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-72 rounded-2xl bg-canvas p-6 shadow-2xl">
            <h3 className="text-base font-bold text-ink mb-1">Sign out?</h3>
            <p className="text-xs text-ink/50 mb-4">
              Your session will end. Any open tables remain unaffected.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmLogout(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-ink/70 transition-colors hover:bg-mist"
              >
                Cancel
              </button>
              <button
                onClick={logout}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand/90"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
