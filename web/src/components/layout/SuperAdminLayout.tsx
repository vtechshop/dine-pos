import { NavLink, Outlet } from 'react-router-dom';
import { Activity, BarChart2, Building2, Heart, LayoutDashboard, LogOut, Megaphone, ShieldCheck, Tag } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { SANotificationsProvider } from '../../context/SANotificationsContext';
import { SANotificationBell } from './SANotificationBell';

export function SuperAdminLayout() {
  const { logout } = useAuth();

  return (
    <SANotificationsProvider>
      <div className="flex h-screen bg-mist">
        {/* Sidebar */}
        <aside className="flex w-56 flex-shrink-0 flex-col border-r border-border bg-canvas">
          {/* Brand */}
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink">
              <ShieldCheck className="h-4 w-4 text-canvas" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-xs font-bold text-ink leading-none">Super Admin</p>
              <p className="text-[10px] text-ink/40 leading-none mt-0.5">Dine POS</p>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
            <NavLink
              to="/super-admin/dashboard"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink/70 hover:bg-mist hover:text-ink'
                }`
              }
            >
              <LayoutDashboard size={16} strokeWidth={1.75} />
              Dashboard
            </NavLink>
            <NavLink
              to="/super-admin/hotels"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink/70 hover:bg-mist hover:text-ink'
                }`
              }
            >
              <Building2 size={16} strokeWidth={1.75} />
              Hotels
            </NavLink>
            <NavLink
              to="/super-admin/live"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink/70 hover:bg-mist hover:text-ink'
                }`
              }
            >
              <Activity size={16} strokeWidth={1.75} />
              Live
            </NavLink>
            <NavLink
              to="/super-admin/health"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink/70 hover:bg-mist hover:text-ink'
                }`
              }
            >
              <Heart size={16} strokeWidth={1.75} />
              Health
            </NavLink>
            <NavLink
              to="/super-admin/versions"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink/70 hover:bg-mist hover:text-ink'
                }`
              }
            >
              <Tag size={16} strokeWidth={1.75} />
              Versions
            </NavLink>

            <NavLink
              to="/super-admin/analytics"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink/70 hover:bg-mist hover:text-ink'
                }`
              }
            >
              <BarChart2 size={16} strokeWidth={1.75} />
              Analytics
            </NavLink>
            <NavLink
              to="/super-admin/broadcast"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-ink/70 hover:bg-mist hover:text-ink'
                }`
              }
            >
              <Megaphone size={16} strokeWidth={1.75} />
              Broadcast
            </NavLink>

            {/* Notification bell — dropdown preview + badge */}
            <SANotificationBell />
          </nav>

          {/* Logout */}
          <div className="border-t border-border p-3">
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink/60 transition hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={16} strokeWidth={1.75} />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </SANotificationsProvider>
  );
}
