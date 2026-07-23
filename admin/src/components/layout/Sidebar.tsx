import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, QrCode, Users, Truck, ShoppingBag,
  BarChart2, FileText, Settings, ChevronRight,
  Package, Wallet, UserCheck, Activity,
} from 'lucide-react';

interface NavItem {
  to:    string;
  icon:  React.ReactNode;
  label: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    group: 'Overview',
    items: [
      { to: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
    ],
  },
  {
    group: 'QR & Tables',
    items: [
      { to: '/qr',          icon: <QrCode size={18} />,      label: 'QR Management' },
      { to: '/qr-analytics',icon: <Activity size={18} />,    label: 'QR Analytics' },
    ],
  },
  {
    group: 'Staff',
    items: [
      { to: '/staff',          icon: <Users size={18} />,    label: 'Staff Management' },
      { to: '/staff-analytics',icon: <UserCheck size={18} />, label: 'Staff Analytics' },
    ],
  },
  {
    group: 'Delivery',
    items: [
      { to: '/integrations',   icon: <Truck size={18} />,       label: 'Swiggy & Zomato' },
      { to: '/online-orders',  icon: <ShoppingBag size={18} />, label: 'Online Orders' },
      { to: '/settlement',     icon: <Wallet size={18} />,      label: 'Settlement' },
    ],
  },
  {
    group: 'Menu',
    items: [
      { to: '/menu-channels', icon: <Package size={18} />, label: 'Channel Pricing' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { to: '/reports', icon: <FileText size={18} />, label: 'Reports' },
      { to: '/audit',   icon: <BarChart2 size={18} />, label: 'Audit Log' },
    ],
  },
  {
    group: 'System',
    items: [
      { to: '/settings', icon: <Settings size={18} />, label: 'Settings' },
    ],
  },
];

const LINK = 'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors text-[#C4A090] hover:text-white hover:bg-white/10';
const LINK_ACTIVE = 'bg-[#E8380D] text-white hover:bg-[#E8380D]/90';

export default function Sidebar() {
  return (
    <aside className="w-60 min-h-screen bg-[#1C0800] flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-[#E8380D] rounded-lg flex items-center justify-center">
            <ChevronRight size={16} className="text-white" />
          </div>
          <div>
            <p className="text-white font-black text-sm leading-tight">DinePOS</p>
            <p className="text-[#92745E] text-xs">Admin Portal</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <p className="text-[#664433] text-[10px] font-bold uppercase tracking-widest mb-1.5 px-3">
              {group}
            </p>
            <div className="space-y-0.5">
              {items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `${LINK} ${isActive ? LINK_ACTIVE : ''}`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
