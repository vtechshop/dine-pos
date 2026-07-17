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

const IMPLEMENTED = new Set(['/dashboard', '/login']);

// ── Component ─────────────────────────────────────────────────────────────────

function NavItemRow({ item }: { item: NavItem }) {
  const { to, icon: Icon, label, hint, soon } = item;

  if (soon) {
    return (
      <div className="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-gray-600">
        <Icon size={16} />
        <span className="flex-1 text-sm">{label}</span>
        <span className="text-[9px] font-medium uppercase tracking-widest text-gray-700">soon</span>
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-blue-600 text-white'
            : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={16} />
          <span className="flex-1">{label}</span>
          {hint && (
            <span className={`text-[9px] font-mono font-semibold ${isActive ? 'text-blue-200' : 'text-gray-600'}`}>
              {hint}
            </span>
          )}
          {!IMPLEMENTED.has(to) && !isActive && (
            <span className="text-[8px] text-gray-700 uppercase tracking-widest">—</span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-gray-700/60 bg-gray-900">
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.heading && (
              <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-widest text-gray-700">
                {group.heading}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={item.to}>
                  <NavItemRow item={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-700/60 px-4 py-3">
        <p className="text-[10px] text-gray-700">Dine POS Web · W2</p>
      </div>
    </aside>
  );
}
