import { Wifi, WifiOff, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  const { hotelName, logout } = useAuth();
  const { connected } = useSocket();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      <h1 className="text-base font-semibold text-gray-800">{title}</h1>

      <div className="flex items-center gap-4">
        {/* Socket status */}
        <div className="flex items-center gap-1.5">
          {connected ? (
            <Wifi size={15} className="text-green-500" />
          ) : (
            <WifiOff size={15} className="text-gray-400" />
          )}
          <span className={`text-xs font-medium ${connected ? 'text-green-600' : 'text-gray-400'}`}>
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        <div className="h-4 w-px bg-gray-200" />

        {/* Hotel name */}
        {hotelName && (
          <span className="text-sm text-gray-500">{hotelName}</span>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="Sign out"
        >
          <LogOut size={15} />
          <span>Sign out</span>
        </button>
      </div>
    </header>
  );
}
