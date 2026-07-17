import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Package,
  BarChart2,
  Settings,
  Hotel,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  soon?: boolean;
}

const navItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/orders',    icon: ShoppingCart,    label: 'Orders',   soon: true },
  { to: '/billing',   icon: Receipt,         label: 'Billing',  soon: true },
  { to: '/products',  icon: Package,         label: 'Products', soon: true },
  { to: '/reports',   icon: BarChart2,       label: 'Reports',  soon: true },
  { to: '/settings',  icon: Settings,        label: 'Settings', soon: true },
];

export function Sidebar() {
  const { hotelName } = useAuth();

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col bg-gray-900 text-gray-300">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-gray-700/60 px-4 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600">
          <Hotel size={16} className="text-white" />
        </div>
        <span className="truncate text-sm font-semibold text-white">
          {hotelName ?? 'Hotel POS'}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, soon }) => (
            <li key={to}>
              {soon ? (
                <div className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2.5 text-gray-500">
                  <Icon size={17} />
                  <span className="text-sm">{label}</span>
                  <span className="ml-auto rounded-sm bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    soon
                  </span>
                </div>
              ) : (
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`
                  }
                >
                  <Icon size={17} />
                  {label}
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-700/60 px-4 py-3">
        <p className="text-[11px] text-gray-600">Hotel POS Web v1.0</p>
      </div>
    </aside>
  );
}
