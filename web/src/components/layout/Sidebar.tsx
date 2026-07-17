import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  LayoutGrid,
  Users,
  Package,
  Archive,
  BarChart2,
  Settings,
  CalendarDays,
  Sparkles,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// ── Nav item types ─────────────────────────────────────────────────────────────

interface NavItem {
  to:       string;
  icon:     LucideIcon;
  label:    string;
  hint?:    string;  // keyboard shortcut label
  soon?:    boolean;
}

interface NavGroup {
  heading?: string;
  items:    NavItem[];
}

// ── Navigation structure ───────────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/orders',    icon: ShoppingCart,    label: 'Orders' },
      { to: '/tables',    icon: LayoutGrid,      label: 'Tables',    hint: 'F3' },
      { to: '/customers', icon: Users,           label: 'Customers', hint: 'F4' },
      { to: '/products',  icon: Package,         label: 'Products' },
      { to: '/inventory', icon: Archive,         label: 'Inventory' },
      { to: '/reports',   icon: BarChart2,       label: 'Reports' },
      { to: '/settings',  icon: Settings,        label: 'Settings' },
    ],
  },
  {
    heading: 'Coming soon',
    items: [
      { to: '/reservations', icon: CalendarDays, label: 'Reservations', soon: true },
      { to: '/cleaning',     icon: Sparkles,     label: 'Cleaning',     soon: true },
      { to: '/online',       icon: Globe,        label: 'Online Orders', soon: true },
    ],
  },
];

// ── Active routes — pages not yet implemented go back to dashboard ─────────────

const IMPLEMENTED = new Set(['/dashboard', '/login', '/products', '/inventory', '/customers', '/reports', '/settings']);

// Routes visible only to the admin role; all others see Dashboard + Tables only
const ADMIN_ONLY_ROUTES = new Set(['/orders', '/customers', '/products', '/inventory', '/reports', '/settings']);

// ── Component ─────────────────────────────────────────────────────────────────

function NavItemRow({ item }: { item: NavItem }) {
  const { to, icon: Icon, label, hint, soon } = item;

  if (soon) {
    return (
      <div className="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-white/25">
        <Icon size={16} />
        <span className="flex-1 text-sm">{label}</span>
        <span className="text-[9px] font-medium uppercase tracking-widest text-white/20">soon</span>
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-[#E8380D] text-white'
            : 'text-white/50 hover:bg-white/[0.08] hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={16} />
          <span className="flex-1">{label}</span>
          {hint && (
            <span className={`text-[9px] font-mono font-semibold ${isActive ? 'text-orange-200' : 'text-white/25'}`}>
              {hint}
            </span>
          )}
          {!IMPLEMENTED.has(to) && !isActive && (
            <span className="text-[8px] text-white/20 uppercase tracking-widest">—</span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-white/10 bg-[#1C0800]">
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {NAV_GROUPS.map((group, gi) => {
          const visibleItems = isAdmin
            ? group.items
            : group.items.filter(item => !ADMIN_ONLY_ROUTES.has(item.to));
          if (visibleItems.length === 0) return null;
          return (
            <div key={gi}>
              {group.heading && (
                <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-widest text-white/25">
                  {group.heading}
                </p>
              )}
              <ul className="space-y-0.5">
                {visibleItems.map(item => (
                  <li key={item.to}>
                    <NavItemRow item={item} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-[10px] text-white/20">Dine POS Web · W7</p>
      </div>
    </aside>
  );
}
