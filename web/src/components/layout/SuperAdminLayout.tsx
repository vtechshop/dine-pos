import { NavLink, Outlet } from 'react-router-dom';
import { Building2, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export function SuperAdminLayout() {
  const { logout } = useAuth();

  return (
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
        <nav className="flex-1 space-y-0.5 p-3">
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
  );
}
