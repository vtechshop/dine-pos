import { NavLink } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useSANotifications } from '../../context/SANotificationsContext';

export function SANotificationBell() {
  const { unreadCount } = useSANotifications();

  return (
    <NavLink
      to="/super-admin/notifications"
      className={({ isActive }) =>
        `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          isActive ? 'bg-brand/10 text-brand' : 'text-ink/70 hover:bg-mist hover:text-ink'
        }`
      }
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
    </NavLink>
  );
}
