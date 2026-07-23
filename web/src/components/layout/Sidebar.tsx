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
  ChefHat,
  CreditCard,
  Truck,
  Link2,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// ── Nav item types ─────────────────────────────────────────────────────────────

interface NavItem {
  to:    string;
  icon:  LucideIcon;
  label: string;
  hint?: string;
}

interface NavGroup {
  heading?: string;
  items:    NavItem[];
}

// ── Navigation structure ───────────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { to: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/orders',       icon: ShoppingCart,    label: 'Orders' },
      { to: '/tables',       icon: LayoutGrid,      label: 'Tables',    hint: 'F3' },
      { to: '/customers',    icon: Users,           label: 'Customers', hint: 'F4' },
      { to: '/products',     icon: Package,         label: 'Products' },
      { to: '/inventory',    icon: Archive,         label: 'Inventory' },
      { to: '/reports',      icon: BarChart2,       label: 'Reports' },
      { to: '/settings',     icon: Settings,        label: 'Settings' },
      { to: '/reservations', icon: CalendarDays,    label: 'Reservations' },
      { to: '/kitchen',      icon: ChefHat,         label: 'Kitchen' },
      // Cashier-only operational hub — hidden from admin and other staff
      { to: '/cashier',      icon: CreditCard,      label: 'Cashier Ops', hint: 'F2' },
    ],
  },
  {
    heading: 'Delivery',
    items: [
      { to: '/online-orders', icon: Truck,     label: 'Online Orders' },
      { to: '/integrations',  icon: Link2,     label: 'Integrations' },
      { to: '/menu-sync',     icon: RefreshCw, label: 'Menu Sync' },
    ],
  },
];

// Routes visible only to the admin role
const ADMIN_ONLY_ROUTES = new Set([
  '/orders', '/customers', '/products', '/inventory',
  '/reports', '/settings', '/reservations',
  '/online-orders', '/integrations', '/menu-sync',
]);

// Routes visible only to the cashier role
const CASHIER_ONLY_ROUTES = new Set(['/cashier']);

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

function NavItemRow({ item }: { item: NavItem }) {
  const { to, icon: Icon, label, hint } = item;

  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-brand text-white'
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
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const { role }  = useAuth();
  const isAdmin   = role === 'admin';
  const isCashier = role === 'cashier';

  return (
    <>
      {/* Mobile backdrop — click to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-52 flex-col border-r border-white/10 bg-ink transition-transform duration-200 ease-in-out md:static md:h-full md:shrink-0 md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Mobile close header */}
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 md:hidden">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
            Navigation
          </span>
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-lg p-1 text-white/40 hover:bg-white/[0.08] hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {/* Nav — onClick closes sidebar on mobile after navigating */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4" onClick={onClose}>
          {NAV_GROUPS.map((group, gi) => {
            const visibleItems = (() => {
              if (isAdmin)   return group.items.filter(i => !CASHIER_ONLY_ROUTES.has(i.to));
              if (isCashier) return group.items.filter(i => !ADMIN_ONLY_ROUTES.has(i.to));
              return group.items.filter(i => !ADMIN_ONLY_ROUTES.has(i.to) && !CASHIER_ONLY_ROUTES.has(i.to));
            })();
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
          <p className="text-[10px] text-white/20">Dine POS Web · v1.0</p>
        </div>
      </aside>
    </>
  );
}
