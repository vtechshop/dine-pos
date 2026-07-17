import { Link } from 'react-router-dom';
import {
  Zap, LayoutGrid, Package, BarChart2, Printer, Smartphone,
  ChevronRight, CheckCircle2, Star,
} from 'lucide-react';

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#1C0800] px-5 py-24 text-white">
      {/* Subtle brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, #E8380D33 0%, transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-4xl text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-800/40 bg-orange-900/30 px-4 py-1.5 text-xs font-semibold text-orange-300">
          <Star size={12} className="text-[#E8380D]" />
          Trusted by 500+ restaurants across India
        </div>

        <h1 className="mb-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
          The Complete POS for{' '}
          <span className="text-[#E8380D]">Modern Restaurants</span>
        </h1>

        <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-gray-300">
          Streamline orders, billing, and inventory — all from one screen.
          Built for dine-in, takeaway, and cloud kitchens.
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/book-demo"
            className="rounded-xl bg-[#E8380D] px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#C93008]"
          >
            Book a Free Demo
          </Link>
          <Link
            to="/features"
            className="flex items-center gap-1.5 rounded-xl border border-white/20 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            See Features <ChevronRight size={16} />
          </Link>
        </div>

        <p className="mt-5 text-xs text-gray-500">No credit card required · 14-day free trial</p>
      </div>
    </section>
  );
}

// ── Stats strip ───────────────────────────────────────────────────────────────

const STATS = [
  { value: '500+', label: 'Restaurants' },
  { value: '1M+',  label: 'Orders processed' },
  { value: '99.9%', label: 'Uptime' },
  { value: '24/7',  label: 'Support' },
];

function StatsStrip() {
  return (
    <section className="border-b border-gray-100 bg-[#FFF6EE] py-8">
      <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 px-5 text-center sm:grid-cols-4">
        {STATS.map(({ value, label }) => (
          <div key={label}>
            <div className="text-2xl font-extrabold text-[#E8380D]">{value}</div>
            <div className="mt-0.5 text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Feature highlights ────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Zap,
    title: 'Instant Order Entry',
    desc:  'Take orders table-by-table or guest-by-guest with a keyboard-first interface. Zero training needed.',
  },
  {
    icon: LayoutGrid,
    title: 'Smart Table Management',
    desc:  'Visual table grid shows live status, occupied guests, and running totals at a glance.',
  },
  {
    icon: Package,
    title: 'Menu & Inventory',
    desc:  'Manage products, categories, and ingredient stock. Get low-stock alerts before you run out.',
  },
  {
    icon: BarChart2,
    title: 'Daily Reports',
    desc:  'Revenue by payment method, order source, and category — exportable to CSV.',
  },
  {
    icon: Printer,
    title: 'Kitchen Printing',
    desc:  'Auto-print KOTs to your kitchen printer the moment an order is placed.',
  },
  {
    icon: Smartphone,
    title: 'Works on Any Device',
    desc:  'Web-based POS runs on desktop, tablet, and mobile. No app installation needed.',
  },
];

function FeatureHighlights() {
  return (
    <section className="py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-gray-900">
            Everything your restaurant needs
          </h2>
          <p className="mt-3 text-gray-500">
            From the first order to end-of-day reports — Dine POS has you covered.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50">
                <Icon size={22} className="text-[#E8380D]" />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
              <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            to="/features"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8380D] hover:underline"
          >
            See all features <ChevronRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  { n: '01', title: 'Sign up & configure',    desc: 'Register your restaurant, add your menu, set table layout.' },
  { n: '02', title: 'Train in 30 minutes',    desc: 'Intuitive interface — your staff learns it in one shift.' },
  { n: '03', title: 'Start taking orders',    desc: 'Go live the same day. Print receipts, track billing, run reports.' },
];

function HowItWorks() {
  return (
    <section className="bg-[#FFF6EE] py-20 px-5">
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Up and running in one day</h2>
          <p className="mt-3 text-gray-500">No installation. No IT team. Just a browser.</p>
        </div>
        <div className="relative flex flex-col gap-8 md:flex-row">
          {STEPS.map(({ n, title, desc }, i) => (
            <div key={n} className="relative flex-1">
              {i < STEPS.length - 1 && (
                <div
                  aria-hidden
                  className="absolute right-0 top-5 hidden h-px w-full bg-gradient-to-r from-orange-200 to-transparent md:block"
                />
              )}
              <div className="relative rounded-2xl border border-[#EBD8C8] bg-white p-6 shadow-sm">
                <div className="mb-3 text-3xl font-black text-[#E8380D]/20">{n}</div>
                <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Testimonials ──────────────────────────────────────────────────────────────

const TESTIMONIALS = [
  {
    name:    'Rajesh Kumar',
    role:    'Owner, Spice Garden Restaurant',
    city:    'Chennai',
    quote:   'Dine POS cut our billing time in half. The table management alone is worth every rupee.',
  },
  {
    name:    'Priya Nair',
    role:    'Manager, The Coastal Kitchen',
    city:    'Kochi',
    quote:   'The kitchen printer integration works flawlessly. No more lost KOTs, no more arguments.',
  },
  {
    name:    'Mohammed Salim',
    role:    'Owner, Biryani House',
    city:    'Coimbatore',
    quote:   "We run 3 outlets on one account. The daily reports help me compare performance instantly.",
  },
];

function Testimonials() {
  return (
    <section className="py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Loved by restaurant owners</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map(({ name, role, city, quote }) => (
            <div
              key={name}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            >
              <div className="mb-4 flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={14} className="fill-[#E8380D] text-[#E8380D]" />
                ))}
              </div>
              <p className="mb-5 text-sm leading-relaxed text-gray-600">"{quote}"</p>
              <div>
                <div className="font-semibold text-gray-900">{name}</div>
                <div className="text-xs text-gray-400">{role} · {city}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── CTA banner ────────────────────────────────────────────────────────────────

const INCLUSIONS = [
  'Full POS access', 'Unlimited products', 'Kitchen printing',
  'Daily reports', 'Email support', 'No setup fee',
];

function CTABanner() {
  return (
    <section className="bg-[#E8380D] px-5 py-20 text-white">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="mb-4 text-3xl font-bold">
          Ready to modernise your restaurant?
        </h2>
        <p className="mb-6 text-orange-100">
          Get started free — no credit card, no commitment.
        </p>
        <div className="mb-8 flex flex-wrap justify-center gap-3">
          {INCLUSIONS.map(item => (
            <span key={item} className="flex items-center gap-1.5 text-sm text-orange-100">
              <CheckCircle2 size={14} className="text-white/70" />{item}
            </span>
          ))}
        </div>
        <Link
          to="/book-demo"
          className="inline-block rounded-xl bg-white px-8 py-3.5 text-sm font-semibold text-[#E8380D] transition-colors hover:bg-orange-50"
        >
          Book a Free Demo
        </Link>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function HomePage() {
  return (
    <>
      <Hero />
      <StatsStrip />
      <FeatureHighlights />
      <HowItWorks />
      <Testimonials />
      <CTABanner />
    </>
  );
}
