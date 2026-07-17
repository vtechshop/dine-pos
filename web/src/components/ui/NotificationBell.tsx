import { Bell } from 'lucide-react';
import { useLiveOrders } from '../../context/LiveOrdersContext';

export function NotificationBell() {
  const { unreadCount, markRead } = useLiveOrders();

  return (
    <button
      onClick={markRead}
      className="relative rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
      title={unreadCount > 0 ? `${unreadCount} new order${unreadCount > 1 ? 's' : ''}` : 'No new orders'}
      aria-label="Notifications"
    >
      <Bell size={18} />
      {unreadCount > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white leading-none">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
