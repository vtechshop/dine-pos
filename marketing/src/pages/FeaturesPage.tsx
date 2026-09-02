import {
  ShoppingCart, LayoutGrid, Package, Archive,
  BarChart2, Printer, Users, Shield,
  Globe, Smartphone, Image,
  CreditCard, Clock, ShoppingBag, Wifi,
  DollarSign,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePageSEO } from '../hooks/usePageSEO';

interface FeatureBlock {
  icon: React.ElementType;
  title: string;
  desc: string;
  bullets: string[];
}

interface BetaBlock {
  icon: React.ElementType;
  title: string;
  desc: string;
  note: string;
}

interface ComingSoonBlock {
  icon: React.ElementType;
  title: string;
  desc: string;
  eta?: string;
}

const LIVE_FEATURES: FeatureBlock[] = [
  // ── Core POS ──────────────────────────────────────────────────────────────
  {
    icon: ShoppingCart,
    title: 'Billing & Orders',
    desc: 'Fast, accurate billing for every order type and payment mode.',
    bullets: [
      'Table-wise and guest-wise billing',
      'Split bills across guests in one session',
      'Dine-in, takeaway, parcel, and aggregator orders',
      'Cash, UPI, card, split, and Razorpay payments',
      'GST auto-calculation per item',
      'Discount and promo engine',
    ],
  },
  {
    icon: LayoutGrid,
    title: 'Table Management & Reservations',
    desc: 'Visual floor plan with real-time occupancy and advance booking.',
    bullets: [
      'Customisable table grid',
      'Live status: available / occupied / reserved',
      'Transfer guests between tables',
      'Merge bills from multiple tables',
      'Session tracking per table',
      'Advance reservations with confirm / seat / cancel / no-show flow',
    ],
  },
  {
    icon: Package,
    title: 'Menu & Products',
    desc: 'Build and organise your full menu with images, modifiers, and instant availability control.',
    bullets: [
      'Category and sub-category support',
      'Veg / non-veg indicators',
      'Item availability toggle (instant)',
      'Tax percent per item (HSN support)',
      'Short codes for fast keyboard entry',
      'Product variants with per-variant pricing',
    ],
  },
  // ── Customers ─────────────────────────────────────────────────────────────
  {
    icon: CreditCard,
    title: 'Loyalty, Wallet & CRM',
    desc: 'Customer profiles, loyalty points, digital wallet, gift vouchers, and coupons — all at the billing counter.',
    bullets: [
      'Customer profiles with phone lookup',
      'Points earned per order, redeemable at billing',
      'Customer wallet: top-up, deduct, and refund',
      'Gift vouchers with balance and expiry tracking',
      'Coupon codes with usage limits and date windows',
      'Lifetime spend, visit count, and birthday tracking',
    ],
  },
  // ── Kitchen ───────────────────────────────────────────────────────────────
  {
    icon: Printer,
    title: 'Kitchen Printing & Display',
    desc: 'Auto-print KOTs and live kitchen display the moment an order is confirmed.',
    bullets: [
      'Dedicated kitchen printer per outlet',
      'KOT auto-print on order submit',
      'Receipt printing for cashier',
      '58mm and 80mm paper support',
      'Bluetooth thermal printer support',
      'Real-time Kitchen Display System (KDS)',
    ],
  },
  // ── Inventory ─────────────────────────────────────────────────────────────
  {
    icon: Archive,
    title: 'Wastage Tracking',
    desc: 'Log every item loss with quantity, reason, and estimated value — then see it in your analytics.',
    bullets: [
      'Wastage logging per item with quantity and unit',
      'Reason tagging (spoilage, overcooking, expiry, etc.)',
      'Estimated loss value per wastage entry',
      'Daily and range-based wastage analytics',
      'Staff-attributed wastage tracking',
      'Dashboard summary: total wastage vs revenue',
    ],
  },
  // ── Finance ───────────────────────────────────────────────────────────────
  {
    icon: DollarSign,
    title: 'Expense Tracking & Finance',
    desc: 'Log daily expenses, see revenue vs spend, and track net profit in one view.',
    bullets: [
      'Daily expense logging by category',
      'Expense category breakdown',
      'Revenue vs expense comparison',
      'Net profit and loss calculation',
      'P&L view combining revenue and expenses',
      'Date-range filtered reports',
    ],
  },
  // ── Reports ───────────────────────────────────────────────────────────────
  {
    icon: BarChart2,
    title: 'Reports & Analytics',
    desc: 'Daily snapshots and payment breakdowns at a glance.',
    bullets: [
      'Daily revenue summary',
      'Payment method breakdown (cash / UPI / card)',
      'Tax collected report',
      'Order source breakdown',
      'Top-selling items and categories',
      'Export to CSV',
    ],
  },
  // ── Platforms ─────────────────────────────────────────────────────────────
  {
    icon: Globe,
    title: 'QR Ordering',
    desc: 'Scan-to-menu on every table. Orders land directly in the POS and kitchen.',
    bullets: [
      'No-app QR menu for customers',
      'Live order sync to POS',
      'Table-mapped ordering',
      'Customisable digital menu',
      'Real-time menu updates',
    ],
  },
  {
    icon: Image,
    title: 'Product Images',
    desc: 'Every dish with a photo — visible on your QR menu and in the POS.',
    bullets: [
      'Bulk image assignment from your gallery',
      'Camera capture per product',
      'Cloudinary CDN delivery — fast on any connection',
      'Images shown on QR menu and in the POS',
    ],
  },
  {
    icon: Smartphone,
    title: 'Android POS App',
    desc: 'Native Android app for billing, waiter ordering, and kitchen display.',
    bullets: [
      'Full POS on any Android tablet or phone',
      'Bluetooth thermal printer support',
      'Camera for product image capture',
      'Secure device activation code',
      'Cashier, waiter, and kitchen modes',
      'Works on affordable Android hardware',
    ],
  },
  // ── People & Security ─────────────────────────────────────────────────────
  {
    icon: Users,
    title: 'Staff & Roles',
    desc: 'Role-based access so everyone sees only what they need.',
    bullets: [
      'Hotel admin (full access)',
      'Cashier (billing and payment)',
      'Waiter (order entry only)',
      'Kitchen display (read-only KOT)',
      'PIN-based staff login',
    ],
  },
  {
    icon: Shield,
    title: 'Security, Audit & Real-time',
    desc: 'Enterprise-grade security with live sync across all devices.',
    bullets: [
      'JWT + refresh token authentication',
      'Per-action audit log',
      'Role-based route protection',
      'Rate limiting on all login endpoints',
      'Socket-powered live updates — no page refresh needed',
      'Secure device registration and remote revocation',
    ],
  },
];

// ── Beta ──────────────────────────────────────────────────────────────────────
// Real implementation, live in production, but requires external partner setup
// or has known limitations before it can be fully self-served.

const BETA_FEATURES: BetaBlock[] = [
  {
    icon: ShoppingBag,
    title: 'Aggregator Orders — Swiggy & Zomato',
    desc: 'DinePOS accepts Swiggy and Zomato orders via webhook. Accept, reject, and mark dispatched directly from your POS dashboard. Menu sync back to the platform is supported. Requires webhook URL registration with each aggregator — contact us to enable it for your outlet.',
    note: 'Beta · Requires aggregator partner setup',
  },
];

// ── Genuinely coming soon ──────────────────────────────────────────────────────

const COMING_SOON: ComingSoonBlock[] = [
  {
    icon: Clock,
    title: 'Shift Management',
    desc: 'Open and close shifts with cash drawer reconciliation, shift-wise reports, and handover notes.',
    eta: 'v1.1',
  },
  {
    icon: Wifi,
    title: 'Offline Mode',
    desc: 'Take orders and print bills when the internet goes down. Sync automatically when connectivity returns.',
    eta: 'v2',
  },
];

export function FeaturesPage() {
  usePageSEO(
    'Features — Dine POS',
    'All Dine POS features: billing & orders, loyalty & CRM, wastage tracking, expense & P&L, QR ordering, kitchen display, Android POS, reports, and more.',
  );
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-4 text-4xl font-extrabold">
          Every feature your restaurant needs
        </h1>
        <p className="mx-auto max-w-xl text-gray-400">
          From billing and loyalty to kitchen display and QR ordering — Dine POS ships it all in one system.
          No extra modules. No per-feature pricing.
        </p>
      </section>

      {/* Live feature grid */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-8 flex items-center gap-3">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">✓</span>
          <h2 className="text-xl font-bold text-gray-900">Live now</h2>
          <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700">{LIVE_FEATURES.length} modules</span>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {LIVE_FEATURES.map(({ icon: Icon, title, desc, bullets }) => (
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
                    <span className="mt-0.5 shrink-0 text-[#E8380D]">✓</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Beta */}
      <section className="border-t border-gray-100 bg-blue-50/40 px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">β</span>
            <h2 className="text-xl font-bold text-gray-900">Beta</h2>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">Built & working · setup required</span>
          </div>
          <p className="mb-8 max-w-xl text-sm text-gray-500">
            These features are fully implemented and running in production, but require an external partner setup or configuration step before they can be self-served. Contact us to activate.
          </p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {BETA_FEATURES.map(({ icon: Icon, title, desc, note }) => (
              <div
                key={title}
                className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
                    <Icon size={20} className="text-blue-600" />
                  </div>
                  <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                    Beta
                  </span>
                </div>
                <h3 className="mb-1 font-bold text-gray-900">{title}</h3>
                <p className="mb-3 text-sm leading-relaxed text-gray-500">{desc}</p>
                <p className="text-[11px] font-semibold text-blue-600">{note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Coming Soon */}
      <section className="border-t border-gray-100 bg-[#FFF6EE] px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">→</span>
            <h2 className="text-xl font-bold text-gray-900">Coming soon</h2>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">On the roadmap</span>
          </div>
          <p className="mb-8 max-w-xl text-sm text-gray-500">
            These features are actively being built. Founding restaurant subscribers get access to each module as it ships — at no extra cost.
          </p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {COMING_SOON.map(({ icon: Icon, title, desc, eta }) => (
              <div
                key={title}
                className="relative rounded-2xl border border-dashed border-amber-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
                    <Icon size={20} className="text-amber-600" />
                  </div>
                  {eta && (
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                      {eta}
                    </span>
                  )}
                </div>
                <h3 className="mb-1 font-bold text-gray-700">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-white px-5 py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold text-gray-900">
          See it all in action
        </h2>
        <p className="mb-6 text-gray-500">Book a live demo — we'll walk you through every live feature.</p>
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
