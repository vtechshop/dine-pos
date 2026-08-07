import { CheckCircle2, Printer, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePageSEO } from '../hooks/usePageSEO';

const PROFESSIONAL_FEATURES = [
  '1 Year Subscription',
  '1 Outlet',
  'Unlimited Billing',
  'Unlimited Products',
  // ── Core POS
  'POS Billing (Web + Android)',
  'Table Management & Reservations',
  'QR Ordering',
  'Kiosk Ordering',
  'Kitchen Display System',
  'Kitchen & Receipt Printing',
  'Bluetooth Printing',
  'Customer Display Screen',
  // ── Menu
  'AI Menu Import',
  'Product Image Management',
  'Modifier Groups',
  // ── Customers
  'Loyalty & CRM',
  'Customer Wallet',
  'Gift Vouchers',
  'Coupon Codes',
  // ── Inventory & Supply Chain
  'Inventory Management',
  'Recipe Costing',
  'Wastage Tracking',
  'Inventory Intelligence',
  'Vendor Management',
  'Purchase Orders & GRN',
  'Vendor Ledger',
  // ── Finance
  'Expense Tracking',
  'P&L Dashboard',
  'Menu Profitability',
  // ── Reports
  'Reports & Analytics',
  'GST Billing',
  'Export to CSV',
  // ── AI Suite
  'AI Business Intelligence',
  'AI Forecasting',
  'AI Alerts & Recommendations',
  'AI Chat',
  'Morning Brief',
  // ── Platform
  'Android POS App',
  'Role-based Access',
  'Audit Logs',
  'Device Activation',
  'Web Dashboard',
  'Real-time Sync',
  // ── Support
  'Free Installation',
  'Free Training',
  'Phone & WhatsApp Support',
];

const COMING_SOON_FEATURES = [
  'Shift Management',
  'Offline Mode',
];

const ENTERPRISE_FEATURES = [
  'All Professional features',
  'Unlimited Outlets',
  'Multi-outlet Management',
  'Priority Support',
  'Custom Onboarding',
  'SLA Agreement',
];

const SUITABLE_FOR = [
  'Restaurants', 'Hotels', 'Cafes',
  'Bakeries', 'Cloud Kitchens', 'Fast Food', 'Food Courts',
];

const FAQ_ITEMS = [
  {
    q: 'Are there any monthly charges?',
    a: 'None. You pay ₹12,000 once per year per outlet. No monthly billing, no hidden fees.',
  },
  {
    q: 'Is the FREE Dual Thermal Printer really free?',
    a: 'Yes — every new Professional subscription includes a free dual thermal printer for your kitchen or billing counter. Subject to availability.',
  },
  {
    q: 'What happens after one year?',
    a: 'You can renew at the same rate. We will notify you 30 days before expiry so there is no interruption to your service.',
  },
  {
    q: 'Is there a setup or installation fee?',
    a: 'No. Installation, configuration, and staff training are all included free with every plan.',
  },
  {
    q: 'What about features listed as coming soon?',
    a: 'Shift Management and Offline Mode are actively being built. When they ship, every existing Professional subscriber gets access automatically — no upgrade fee.',
  },
];

export function PricingPage() {
  usePageSEO(
    'Pricing — Dine POS',
    'Dine POS annual pricing — ₹12,000/year per outlet. No monthly charges. Includes AI menu import, kiosk ordering, Android POS app, free dual thermal printer, free installation, and training.',
  );
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-4 text-4xl font-extrabold">Simple, honest pricing</h1>
        <p className="text-gray-400">
          One annual subscription. No monthly charges. No hidden fees.
        </p>
      </section>

      {/* Plans */}
      <section className="mx-auto max-w-4xl px-5 py-16">
        <div className="grid gap-6 md:grid-cols-2">

          {/* ── Professional ──────────────────────────────── */}
          <div className="flex flex-col rounded-2xl border border-[#E8380D] ring-1 ring-[#E8380D] bg-white p-7 shadow-sm">
            <div className="mb-1 text-sm font-semibold uppercase tracking-widest text-gray-400">
              Professional
            </div>

            <div className="flex items-end gap-1.5">
              <span className="text-4xl font-extrabold text-gray-900">₹12,000</span>
              <span className="mb-1.5 text-sm font-medium text-gray-400">/ Year</span>
            </div>

            <div className="mt-2 space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                No Monthly Charges
              </div>
              <p className="text-xs text-gray-400">One Time Annual Subscription</p>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Suitable for
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUITABLE_FOR.map(type => (
                  <span
                    key={type}
                    className="rounded-full border border-orange-100 bg-[#FFF6EE] px-2.5 py-0.5 text-xs font-medium text-[#E8380D]"
                  >
                    {type}
                  </span>
                ))}
              </div>
            </div>

            <div className="my-5 border-t border-gray-100" />

            {/* Live now */}
            <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Live now
            </p>
            <ul className="mb-5 flex-1 space-y-2.5">
              {PROFESSIONAL_FEATURES.map(label => (
                <li key={label} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 size={15} className="shrink-0 text-green-500" />
                  <span className="text-gray-700">{label}</span>
                </li>
              ))}
            </ul>

            {/* Coming soon */}
            <div className="mb-5 rounded-xl border border-dashed border-amber-200 bg-amber-50 p-4">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">
                <Clock size={12} />
                Coming soon — included when ready
              </p>
              <ul className="space-y-1.5">
                {COMING_SOON_FEATURES.map(label => (
                  <li key={label} className="flex items-center gap-2 text-sm text-amber-800">
                    <span className="shrink-0 text-amber-400">→</span>
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Free Printer premium badge */}
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100">
                <Printer size={17} className="text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-amber-800">FREE Dual Thermal Printer</p>
                <p className="text-xs text-amber-600">Included with every new subscription</p>
              </div>
              <span className="ml-auto shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Free
              </span>
            </div>

            <Link
              to="/book-demo"
              className="block rounded-xl bg-[#E8380D] py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[#C93008]"
            >
              Book Demo
            </Link>
          </div>

          {/* ── Enterprise ────────────────────────────────── */}
          <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="mb-1 text-sm font-semibold uppercase tracking-widest text-gray-400">
              Enterprise
            </div>

            <div className="flex items-end gap-1.5">
              <span className="text-4xl font-extrabold text-gray-900">Custom</span>
              <span className="mb-1.5 text-sm font-medium text-gray-400">Pricing</span>
            </div>

            <p className="mt-2 text-sm text-gray-500">
              For restaurant chains, hotels, and franchises with multiple outlets.
            </p>

            <div className="my-5 border-t border-gray-100" />

            <ul className="mb-7 flex-1 space-y-2.5">
              {ENTERPRISE_FEATURES.map(label => (
                <li key={label} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 size={15} className="shrink-0 text-green-500" />
                  <span className="text-gray-700">{label}</span>
                </li>
              ))}
            </ul>

            <Link
              to="/contact"
              className="block rounded-xl border border-gray-200 bg-white py-3 text-center text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
            >
              Contact Sales
            </Link>
          </div>

        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-gray-100 bg-[#FFF6EE] px-5 py-16">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-gray-900">
            Common pricing questions
          </h2>
          <div className="space-y-5">
            {FAQ_ITEMS.map(({ q, a }) => (
              <div key={q} className="rounded-xl border border-[#EBD8C8] bg-white p-5">
                <div className="mb-1 font-semibold text-gray-800">{q}</div>
                <div className="text-sm text-gray-500">{a}</div>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-gray-500">
            More questions?{' '}
            <Link to="/faq" className="font-semibold text-[#E8380D] hover:underline">
              See full FAQ
            </Link>{' '}
            or{' '}
            <Link to="/contact" className="font-semibold text-[#E8380D] hover:underline">
              contact us
            </Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
