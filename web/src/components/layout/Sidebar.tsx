import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, LayoutGrid, Users, Package, Archive, BarChart2,
  Settings, CalendarDays, ChefHat, CreditCard, Truck, Link2, RefreshCw, Layers,
  Store, ShoppingBag, ClipboardList, Wallet, TrendingUp, Sparkles, X, Bot, Sunrise,
  FileBarChart, MessageSquare, Bell, Lightbulb, ScanLine, Tag, Gift, Shield,
  Plus, PauseCircle, Search, Printer, UserCircle, History,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCashier, type CashierTab } from '../../context/CashierContext';

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface PosNavItem {
  key:   CashierTab;
  icon:  LucideIcon;
  label: string;
  hint?: string;
}

// ── Admin navigation ───────────────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    // Operations — daily restaurant workflow, top of list
    items: [
      { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard'  },
      { to: '/tables',     icon: LayoutGrid,      label: 'Tables',    hint: 'F3' },
      { to: '/kitchen',    icon: ChefHat,         label: 'Kitchen'    },
      { to: '/orders',     icon: ShoppingCart,    label: 'Orders'     },
    ],
  },
  {
    heading: 'Menu & Catalog',
    items: [
      { to: '/products',               icon: Package,    label: 'Products'   },
      { to: '/modifiers',              icon: Layers,     label: 'Modifiers'  },
      { to: '/inventory',              icon: Archive,    label: 'Inventory'  },
      { to: '/inventory-intelligence', icon: TrendingUp, label: 'Stock Intel' },
    ],
  },
  {
    heading: 'Customers & Promotions',
    items: [
      { to: '/customers',    icon: Users,          label: 'Customers',    hint: 'F4' },
      { to: '/campaigns',    icon: MessageSquare,  label: 'Campaigns'     },
      { to: '/coupons',      icon: Tag,            label: 'Coupons'       },
      { to: '/gift-vouchers', icon: Gift,          label: 'Gift Vouchers' },
      { to: '/reservations', icon: CalendarDays,   label: 'Reservations'  },
    ],
  },
  {
    heading: 'Purchasing',
    items: [
      { to: '/vendors',         icon: Store,         label: 'Vendors'         },
      { to: '/purchase-orders', icon: ShoppingBag,   label: 'Purchase Orders' },
      { to: '/grn',             icon: ClipboardList, label: 'Receive Goods'   },
      { to: '/vendor-ledger',   icon: Wallet,        label: 'Vendor Ledger'   },
    ],
  },
  {
    heading: 'Finance & Admin',
    items: [
      { to: '/reports',    icon: BarChart2,  label: 'Reports'    },
      { to: '/payments',   icon: CreditCard, label: 'Payments'   },
      { to: '/audit-logs', icon: Shield,     label: 'Audit Logs' },
      { to: '/settings',   icon: Settings,   label: 'Settings'   },
    ],
  },
  {
    heading: 'Delivery',
    items: [
      { to: '/online-orders', icon: Truck,     label: 'Online Orders' },
      { to: '/integrations',  icon: Link2,     label: 'Integrations'  },
      { to: '/menu-sync',     icon: RefreshCw, label: 'Menu Sync'     },
    ],
  },
  {
    heading: 'Restaurant Tools',
    items: [
      { to: '/ai-menu-import', icon: Sparkles, label: 'AI Menu Import' },
    ],
  },
  {
    heading: 'AI Platform',
    items: [
      { to: '/ai',                 icon: Bot,          label: 'AI Dashboard'    },
      { to: '/ai/brief',           icon: Sunrise,      label: 'Morning Brief'   },
      { to: '/ai/reports',         icon: FileBarChart,  label: 'AI Reports'      },
      { to: '/ai/chat',            icon: MessageSquare, label: 'AI Chat'         },
      { to: '/ai/forecast',        icon: TrendingUp,    label: 'Forecast'        },
      { to: '/ai/alerts',          icon: Bell,          label: 'Alerts'          },
      { to: '/ai/recommendations', icon: Lightbulb,     label: 'Recommendations' },
      { to: '/ai/purchase',        icon: ScanLine,      label: 'Purchase AI'     },
    ],
  },
];

// ── Cashier POS nav (drives CashierPage tabs via context) ─────────────────────

const POS_NAV: PosNavItem[] = [
  { key: 'dashboard',     icon: LayoutDashboard, label: 'POS'            },
  { key: 'new-order',     icon: Plus,            label: 'New Order',     hint: 'Ctrl+N' },
  { key: 'pending',       icon: CreditCard,      label: 'Pending Bills', hint: 'F6'     },
  { key: 'hold',          icon: PauseCircle,     label: 'Hold Bills'    },
  { key: 'tables',        icon: LayoutGrid,      label: 'Tables'        },
  { key: 'kitchen',       icon: ChefHat,         label: 'Kitchen Queue', hint: 'Ctrl+K' },
  { key: 'online-orders', icon: Truck,           label: 'Online Orders', hint: 'Ctrl+O' },
  { key: 'search',        icon: Search,          label: 'Bill Search',   hint: 'Ctrl+F' },
  { key: 'customers',     icon: Users,           label: 'Customers',     hint: 'F4'     },
  { key: 'shift',         icon: BarChart2,       label: 'Shift'         },
  { key: 'shift-history', icon: History,         label: 'Shift History'  },
  { key: 'drawer',        icon: Wallet,          label: 'Cash Drawer',   hint: 'Ctrl+D' },
  { key: 'printers',      icon: Printer,         label: 'Printers'      },
  { key: 'profile',       icon: UserCircle,      label: 'Profile'       },
  { key: 'permissions',   icon: Shield,          label: 'Permissions'   },
];

// ── Kitchen & Waiter minimal navs ─────────────────────────────────────────────

const KITCHEN_NAV: NavItem[] = [
  { to: '/kitchen', icon: ChefHat, label: 'Kitchen Display' },
];

const WAITER_NAV: NavItem[] = [
  { to: '/tables', icon: LayoutGrid, label: 'Tables' },
];

// ── Props ──────────────────────────────────────────────────────────────────────

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

// ── Shared NavLink row ─────────────────────────────────────────────────────────

function NavItemRow({ item }: { item: NavItem }) {
  const { to, icon: Icon, label, hint } = item;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-brand text-white'
            : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={16} />
          <span className="flex-1">{label}</span>
          {hint && (
            <span className={`text-[9px] font-mono font-semibold ${isActive ? 'text-orange-200' : 'text-white/40'}`}>
              {hint}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const { role }                    = useAuth();
  const navigate                    = useNavigate();
  const { activeTab, setActiveTab } = useCashier();

  const isCashier = role === 'cashier';
  const isKitchen = role === 'kitchen';
  const isWaiter  = role === 'waiter';

  // ── Role-specific nav content ────────────────────────────────────────────────

  const navContent = (() => {
    // Cashier → full POS sidebar (tabs drive CashierPage via context)
    if (isCashier) {
      return (
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5" onClick={onClose}>
          {POS_NAV.map(item => {
            const Icon    = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { setActiveTab(item.key); navigate('/cashier'); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand text-white'
                    : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                <Icon size={16} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.hint && (
                  <span className={`text-[9px] font-mono font-semibold ${isActive ? 'text-orange-200' : 'text-white/40'}`}>
                    {item.hint}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      );
    }

    // Kitchen → only Kitchen Display
    if (isKitchen) {
      return (
        <nav className="flex-1 overflow-y-auto px-2 py-3" onClick={onClose}>
          <ul className="space-y-0.5">
            {KITCHEN_NAV.map(item => (
              <li key={item.to}><NavItemRow item={item} /></li>
            ))}
          </ul>
        </nav>
      );
    }

    // Waiter → Tables
    if (isWaiter) {
      return (
        <nav className="flex-1 overflow-y-auto px-2 py-3" onClick={onClose}>
          <ul className="space-y-0.5">
            {WAITER_NAV.map(item => (
              <li key={item.to}><NavItemRow item={item} /></li>
            ))}
          </ul>
        </nav>
      );
    }

    // Admin → full nav
    return (
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4" onClick={onClose}>
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.heading && (
              <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-widest text-white/40">
                {group.heading}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={item.to}><NavItemRow item={item} /></li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    );
  })();

  return (
    <>
      {/* Mobile backdrop */}
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
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/45">
            Navigation
          </span>
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-lg p-1 text-white/50 hover:bg-white/[0.08] hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {navContent}

        <div className="border-t border-white/10 px-4 py-3">
          <p className="text-[10px] text-white/35">Dine POS Web · v1.0</p>
        </div>
      </aside>
    </>
  );
}
