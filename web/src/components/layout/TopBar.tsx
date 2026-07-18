import { useState } from 'react';
import { Hotel, LogOut, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { NotificationBell } from '../ui/NotificationBell';
import { LiveBadge } from '../ui/LiveBadge';

export function TopBar() {
  const { hotelName, logout, role } = useAuth();
  const { connected, reconnecting } = useSocket();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const roleLabel = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : 'Admin';

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#1C0800] px-5">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E8380D]">
            <Hotel size={14} className="text-white" />
          </div>
          <span className="text-base font-bold text-white tracking-tight">Dine POS</span>
          {hotelName && (
            <>
              <span className="text-white/25">/</span>
              <span className="max-w-48 truncate text-sm text-white/50">{hotelName}</span>
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
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E8380D]/20 ring-1 ring-[#E8380D]/30">
              <User size={13} className="text-[#E8380D]" />
            </div>
            <span className="hidden text-sm text-white/70 sm:block">{roleLabel}</span>
            <button
              onClick={() => setConfirmLogout(true)}
              className="ml-1 rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/[0.08] hover:text-white/70"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Logout confirmation */}
      {confirmLogout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-72 rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900 mb-1">Sign out?</h3>
            <p className="text-xs text-gray-500 mb-4">
              Your session will end. Any open tables remain unaffected.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmLogout(false)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={logout}
                className="flex-1 rounded-xl bg-[#E8380D] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#E8380D]/90"
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
