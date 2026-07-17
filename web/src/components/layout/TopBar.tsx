import { Hotel, LogOut, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { NotificationBell } from '../ui/NotificationBell';
import { LiveBadge } from '../ui/LiveBadge';

export function TopBar() {
  const { hotelName, logout } = useAuth();
  const { connected, reconnecting } = useSocket();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-700/60 bg-gray-900 px-5">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
          <Hotel size={14} className="text-white" />
        </div>
        <span className="text-base font-bold text-white tracking-tight">Dine POS</span>
        {hotelName && (
          <>
            <span className="text-gray-600">/</span>
            <span className="max-w-48 truncate text-sm text-gray-400">{hotelName}</span>
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
            <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-gray-400">
              Offline
            </span>
          )}
        </div>

        <div className="h-4 w-px bg-gray-700" />

        {/* User / sign-out */}
        <div className="flex items-center gap-1.5 pl-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-700">
            <User size={13} className="text-gray-300" />
          </div>
          <span className="hidden text-sm text-gray-300 sm:block">Admin</span>
          <button
            onClick={logout}
            className="ml-1 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
