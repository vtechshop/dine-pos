import {
  ShoppingCart, LayoutGrid, Package, Archive,
  BarChart2, Printer, Users, Settings, Zap,
  CreditCard, Globe, Shield,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface FeatureBlock {
  icon: React.ElementType;
  title: string;
  desc: string;
  bullets: string[];
}

const FEATURE_BLOCKS: FeatureBlock[] = [
  {
    icon: ShoppingCart,
    title: 'Billing & Orders',
    desc: 'Fast, accurate billing for every order type.',
    bullets: [
      'Table-wise and guest-wise billing',
      'Split bills across guests',
      'Parcel / takeaway orders',
      'Discount and tax management',
      'UPI, cash, card and split payments',
      'Complimentary orders with reason',
    ],
  },
  {
    icon: LayoutGrid,
    title: 'Table Management',
    desc: 'Visual floor plan with real-time occupancy.',
    bullets: [
      'Customisable table grid',
      'Live status: available / occupied / reserved',
      'Transfer guests between tables',
      'Merge bills from multiple tables',
      'Session tracking per table',
    ],
  },
  {
    icon: Package,
    title: 'Products & Menu',
    desc: 'Build and organise your full menu in minutes.',
    bullets: [
      'Category and sub-category support',
      'Veg / non-veg indicators',
      'Item availability toggle (instant)',
      'Tax percent per item (HSN support)',
      'Short codes for fast keyboard entry',
      'Bulk CSV import / export',
    ],
  },
  {
    icon: Archive,
    title: 'Inventory',
    desc: 'Track ingredients and get low-stock alerts.',
    bullets: [
      'Ingredient stock tracking by unit',
      'Low-stock threshold alerts',
      'Restock flow with history',
      'Cost-per-unit tracking',
    ],
  },
  {
    icon: BarChart2,
    title: 'Reports & Analytics',
    desc: 'Daily snapshots and payment breakdowns.',
    bullets: [
      'Daily revenue summary',
      'Payment method breakdown (cash / UPI / card)',
      'Tax collected report',
      'Order source breakdown',
      'Export to CSV',
    ],
  },
  {
    icon: Printer,
    title: 'Kitchen Printing',
    desc: 'Auto-print KOTs the moment an order is confirmed.',
    bullets: [
      'Dedicated kitchen printer per outlet',
      'KOT auto-print on order submit',
      'Receipt printing for cashier',
      '58mm and 80mm paper support',
      'Dual-printer mode (kitchen + cashier)',
    ],
  },
  {
    icon: Users,
    title: 'Staff & Roles',
    desc: 'Role-based access so everyone sees only what they need.',
    bullets: [
      'Hotel admin (full access)',
      'Cashier (billing only)',
      'Waiter (order entry only)',
      'Kitchen display (read-only KOT)',
      'PIN-based staff login',
    ],
  },
  {
    icon: CreditCard,
    title: 'Loyalty & Customers',
    desc: 'Build repeat business with a simple points system.',
    bullets: [
      'Customer profile with visit history',
      'Points earned per order',
      'Points redemption on billing',
      'Customer lookup by phone',
    ],
  },
  {
    icon: Globe,
    title: 'Multi-outlet Support',
    desc: 'One account for all your locations.',
    bullets: [
      'Separate data per outlet',
      'Central super-admin dashboard',
      'Outlet-specific menus and pricing',
      'Consolidated reporting (coming soon)',
    ],
  },
  {
    icon: Shield,
    title: 'Security & Audit',
    desc: 'Enterprise-grade security, built in from day one.',
    bullets: [
      'JWT + refresh token authentication',
      'Per-action audit log',
      'Role-based route protection',
      'Rate limiting on all login endpoints',
    ],
  },
  {
    icon: Settings,
    title: 'Settings & Config',
    desc: 'Configure every detail of your outlet.',
    bullets: [
      'Hotel profile and GST number',
      'Default tax rate',
      'UPI ID for QR display on receipt',
      'Printer address configuration',
      'Feature flag per outlet',
    ],
  },
  {
    icon: Zap,
    title: 'Real-time Updates',
    desc: 'Socket-powered live updates across all devices.',
    bullets: [
      'New order notification without refresh',
      'Live KOT delivery to kitchen',
      'Printer heartbeat monitoring',
      'Table status sync across sessions',
    ],
  },
];

export function FeaturesPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-4 text-4xl font-extrabold">
          Every feature your restaurant needs
        </h1>
        <p className="mx-auto max-w-xl text-gray-400">
          Dine POS packs professional-grade tools into a single screen.
          No extra modules, no per-feature pricing.
        </p>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_BLOCKS.map(({ icon: Icon, title, desc, bullets }) => (
            <div
              key={title}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50">
                <Icon size={20} className="text-[#E8380D]" />
              </div>
              <h3 className="mb-1 font-bold text-gray-900">{title}</h3>
              <p className="mb-4 text-sm text-gray-500">{desc}</p>
              <ul className="space-y-1.5">
                {bullets.map(b => (
                  <li key={b} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="mt-0.5 text-[#E8380D]">✓</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-[#FFF6EE] px-5 py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold text-gray-900">
          See it all in action
        </h2>
        <p className="mb-6 text-gray-500">Book a live demo — we'll walk you through every feature.</p>
        <Link
          to="/book-demo"
          className="inline-block rounded-xl bg-[#E8380D] px-8 py-3.5 text-sm font-semibold text-white hover:bg-[#C93008]"
        >
          Book a Free Demo
        </Link>
      </section>
    </div>
  );
}
