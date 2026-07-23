import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap, LayoutGrid, Package, BarChart2, Printer, Smartphone,
  ChevronRight, CheckCircle2, Star, Check,
  Utensils, Coffee, Cake, Flame, Truck, Wine,
  UtensilsCrossed, Building, ShoppingBag, IceCream, ChefHat,
  Monitor, TrendingUp, Globe, Shield, Users, Clock,
  BarChart3, ArrowRight,
} from 'lucide-react';

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#1C0800] px-5 py-24 text-white">
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
  { value: '500+',  label: 'Restaurants' },
  { value: '1M+',   label: 'Orders processed' },
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

// ── Restaurant types ──────────────────────────────────────────────────────────

const RESTAURANT_TYPES = [
  { icon: Utensils,       label: 'Restaurant' },
  { icon: Coffee,         label: 'Café' },
  { icon: Cake,           label: 'Bakery' },
  { icon: Flame,          label: 'Cloud Kitchen' },
  { icon: Truck,          label: 'Food Truck' },
  { icon: Wine,           label: 'Bar & Pub' },
  { icon: UtensilsCrossed,label: 'Fine Dining' },
  { icon: Building,       label: 'Hotel' },
  { icon: ShoppingBag,    label: 'QSR' },
  { icon: Package,        label: 'Sweet Shop' },
  { icon: IceCream,       label: 'Ice Cream' },
  { icon: ChefHat,        label: 'Tiffin Centre' },
];

function RestaurantTypes() {
  return (
    <section className="bg-white py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Solutions</p>
          <h2 className="text-3xl font-bold text-gray-900">Built for every food business</h2>
          <p className="mt-3 text-gray-500">One platform adapts to the way you run — whatever your format.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {RESTAURANT_TYPES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="group flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-5 text-center transition-all hover:border-orange-200 hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 transition-colors group-hover:bg-orange-100">
                <Icon size={22} className="text-[#E8380D]" />
              </div>
              <span className="text-xs font-semibold text-gray-700 group-hover:text-[#E8380D] transition-colors">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Feature highlights ────────────────────────────────────────────────────────

const FEATURES = [
  { icon: Zap,        title: 'Instant Order Entry',     desc: 'Take orders table-by-table or guest-by-guest with a keyboard-first interface. Zero training needed.' },
  { icon: LayoutGrid, title: 'Smart Table Management',  desc: 'Visual table grid shows live status, occupied guests, and running totals at a glance.' },
  { icon: Package,    title: 'Menu & Inventory',        desc: 'Manage products, categories, and ingredient stock. Get low-stock alerts before you run out.' },
  { icon: BarChart2,  title: 'Daily Reports',           desc: 'Revenue by payment method, order source, and category — exportable to CSV.' },
  { icon: Printer,    title: 'Kitchen Printing',        desc: 'Auto-print KOTs to your kitchen printer the moment an order is placed.' },
  { icon: Smartphone, title: 'Works on Any Device',     desc: 'Web-based POS runs on desktop, tablet, and mobile. No app installation needed.' },
];

function FeatureHighlights() {
  return (
    <section className="bg-[#FFF6EE] py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Everything your restaurant needs</h2>
          <p className="mt-3 text-gray-500">From the first order to end-of-day reports — Dine POS has you covered.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-[#EBD8C8] bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50">
                <Icon size={22} className="text-[#E8380D]" />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
              <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link to="/features" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#E8380D] hover:underline">
            See all features <ChevronRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Product tour ──────────────────────────────────────────────────────────────

const TOURS = [
  {
    label: 'Billing',
    icon: Zap,
    headline: 'Bill in seconds, not minutes',
    description: 'Keyboard-first POS with smart product search, split payments, multi-mode billing, GST auto-calculation and instant KOT printing.',
    points: ['Split & merge bills', 'Multiple payment modes', 'GST auto-calculation', 'Instant KOT printing', 'Discount & promo engine'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-bold text-gray-900 text-sm">Table 4 · Dine In</span>
          <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-[#E8380D]">Open</span>
        </div>
        <div className="space-y-2 mb-4">
          {[['Chicken Biryani ×2', '₹340'], ['Butter Naan ×4', '₹120'], ['Mango Lassi ×2', '₹120']].map(([item, price]) => (
            <div key={item} className="flex justify-between text-sm">
              <span className="text-gray-600">{item}</span>
              <span className="font-semibold text-gray-900">{price}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Subtotal</span><span>₹580</span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>GST (5%)</span><span>₹29</span>
          </div>
          <div className="flex justify-between text-sm font-bold mt-1">
            <span>Total</span><span className="text-[#E8380D]">₹609</span>
          </div>
        </div>
        <button className="mt-4 w-full rounded-xl bg-[#E8380D] py-2.5 text-sm font-bold text-white">
          Collect Payment
        </button>
      </div>
    ),
  },
  {
    label: 'Kitchen Display',
    icon: Monitor,
    headline: 'Zero missed orders',
    description: 'Real-time kitchen display replaces printed KOTs. Orders appear the moment they are placed, with visual timers that flag delays before they escalate.',
    points: ['Real-time order feed', 'Delay alert timers', 'Course-wise tracking', 'Multi-station support', 'Audio alerts'],
    visual: (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Kitchen Display</span>
          <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { num: '#142', items: ['Biryani ×2', 'Naan ×3'], time: '04:12', urgent: false },
            { num: '#143', items: ['Masala Dosa', 'Chai ×2'], time: '12:38', urgent: true  },
            { num: '#144', items: ['Veg Thali ×4'], time: '01:50', urgent: false },
            { num: '#145', items: ['Chicken 65', 'Juice'], time: '00:30', urgent: false },
          ].map(({ num, items, time, urgent }) => (
            <div key={num} className={`rounded-xl p-3 ${urgent ? 'bg-red-900/60 border border-red-700' : 'bg-gray-800'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white">{num}</span>
                <span className={`text-xs font-mono font-bold ${urgent ? 'text-red-300' : 'text-gray-400'}`}>{time}</span>
              </div>
              {items.map(i => <p key={i} className="text-[11px] text-gray-300">{i}</p>)}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    label: 'Inventory',
    icon: Package,
    headline: 'Know what runs low before it runs out',
    description: 'Track raw materials and finished goods, set reorder alerts, reduce wastage and see live cost-per-dish. Food cost under control, always.',
    points: ['Ingredient-level tracking', 'Low-stock alerts', 'Recipe costing', 'Wastage reports', 'Purchase orders'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4">Stock Levels</p>
        <div className="space-y-4">
          {[
            { name: 'Chicken', qty: '3.2 kg', pct: 32, warn: true  },
            { name: 'Basmati Rice', qty: '18 kg', pct: 75, warn: false },
            { name: 'Tomatoes', qty: '1.1 kg', pct: 14, warn: true  },
            { name: 'Oil', qty: '4 L', pct: 55, warn: false },
          ].map(({ name, qty, pct, warn }) => (
            <div key={name}>
              <div className="flex justify-between text-xs mb-1">
                <span className={`font-semibold ${warn ? 'text-red-600' : 'text-gray-700'}`}>{name}</span>
                <span className={warn ? 'text-red-500' : 'text-gray-400'}>{qty}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100">
                <div
                  className={`h-2 rounded-full transition-all ${warn ? 'bg-red-500' : 'bg-[#E8380D]'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
          <p className="text-xs font-semibold text-red-600">⚠ 2 items below reorder level</p>
        </div>
      </div>
    ),
  },
  {
    label: 'Reports',
    icon: BarChart3,
    headline: 'Every number you need, one dashboard',
    description: 'Sales by item, category, shift, or day. Profit & loss, top sellers, voids, discounts — full visibility with no manual entry.',
    points: ['Sales by category', 'Shift-wise reports', 'P&L overview', 'GST summary', 'Export to Excel'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-gray-900">Today's Sales</p>
          <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">↑ 18% vs yesterday</span>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Biryani',     value: 38, amount: '₹7,600' },
            { label: 'Starters',    value: 27, amount: '₹5,400' },
            { label: 'Breads',      value: 20, amount: '₹4,000' },
            { label: 'Beverages',   value: 15, amount: '₹3,000' },
          ].map(({ label, value, amount }) => (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">{label}</span>
                <span className="font-semibold text-gray-900">{amount}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100">
                <div className="h-2 rounded-full bg-[#E8380D]" style={{ width: `${value}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[['₹48.2k', 'Revenue'], ['134', 'Orders'], ['₹360', 'Avg bill']].map(([v, l]) => (
            <div key={l} className="rounded-lg bg-[#FFF6EE] py-2">
              <p className="text-sm font-bold text-[#E8380D]">{v}</p>
              <p className="text-[10px] text-gray-500">{l}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    label: 'CRM',
    icon: Users,
    headline: 'Turn regulars into loyal fans',
    description: 'Capture every customer at checkout. Track visits, spending and preferences. Send targeted promotions that convert.',
    points: ['Customer profiles', 'Visit & spend history', 'Loyalty points', 'WhatsApp promotions', 'Birthday offers'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-[#E8380D]">AR</div>
          <div>
            <p className="text-sm font-bold text-gray-900">Arun Rajan</p>
            <p className="text-xs text-gray-400">+91 98765 43210</p>
          </div>
          <span className="ml-auto text-xs font-semibold bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">⭐ VIP</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center mb-4">
          {[['23', 'Visits'], ['₹18,420', 'Spent'], ['460 pts', 'Loyalty']].map(([v, l]) => (
            <div key={l} className="rounded-lg bg-gray-50 py-2">
              <p className="text-sm font-bold text-gray-900">{v}</p>
              <p className="text-[10px] text-gray-400">{l}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-orange-50 border border-orange-100 p-3">
          <p className="text-xs font-semibold text-[#E8380D] mb-1">Birthday offer active</p>
          <p className="text-xs text-gray-500">15% off on next visit — valid till 28 Jul</p>
        </div>
      </div>
    ),
  },
  {
    label: 'QR Ordering',
    icon: Globe,
    headline: 'Guests order. Kitchen gets it. You smile.',
    description: 'Scan-to-menu on every table. No app download. Orders land directly in the POS. Reduce waiter dependency during rush hours.',
    points: ['No-app QR menu', 'Live order sync to POS', 'Table-mapped ordering', 'Customisable digital menu', 'Real-time updates'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md flex flex-col items-center gap-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide self-start">Table QR Code</p>
        <div className="h-32 w-32 rounded-2xl bg-gray-900 flex items-center justify-center relative overflow-hidden">
          {/* QR code visual pattern */}
          <div className="grid grid-cols-7 gap-px p-2 opacity-90">
            {Array.from({ length: 49 }, (_, i) => {
              const pattern = [1,1,1,1,1,1,1,1,0,0,0,0,0,1,1,0,1,1,1,0,1,1,0,1,0,1,0,1,1,0,1,1,1,0,1,1,0,0,0,0,0,1,1,1,1,1,1,1,1,1];
              return (
                <div key={i} className={`h-2.5 w-2.5 rounded-[1px] ${(pattern[i] ?? Math.random() > 0.5 ? 1 : 0) ? 'bg-white' : 'bg-gray-900'}`} />
              );
            })}
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-gray-900">Table 7 · Dine In</p>
          <p className="text-xs text-gray-400 mt-0.5">Scan to view menu & order</p>
        </div>
        <div className="w-full rounded-xl bg-green-50 border border-green-100 p-3 text-center">
          <p className="text-xs font-semibold text-green-700">3 new orders received via QR</p>
        </div>
      </div>
    ),
  },
];

function ProductTour() {
  const [active, setActive] = useState(0);
  const tour = TOURS[active];

  return (
    <section className="bg-white py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Product Tour</p>
          <h2 className="text-3xl font-bold text-gray-900">Everything in one platform</h2>
          <p className="mt-3 text-gray-500">Explore each module below.</p>
        </div>

        {/* Tab buttons */}
        <div className="mb-10 flex flex-wrap justify-center gap-2">
          {TOURS.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setActive(i)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                active === i
                  ? 'bg-[#E8380D] text-white shadow-md'
                  : 'border border-gray-200 text-gray-600 hover:border-orange-200 hover:text-[#E8380D]'
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
          {/* Left: copy */}
          <div className="space-y-6">
            <h3 className="text-2xl font-bold text-gray-900 sm:text-3xl">{tour.headline}</h3>
            <p className="text-gray-500 leading-relaxed">{tour.description}</p>
            <ul className="space-y-3">
              {tour.points.map(p => (
                <li key={p} className="flex items-center gap-3">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-50">
                    <Check size={11} className="text-[#E8380D]" />
                  </div>
                  <span className="text-sm font-medium text-gray-700">{p}</span>
                </li>
              ))}
            </ul>
            <Link
              to="/book-demo"
              className="inline-flex items-center gap-2 rounded-xl bg-[#E8380D] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#C93008] transition-colors"
            >
              See {tour.label} live <ArrowRight size={14} />
            </Link>
          </div>

          {/* Right: visual */}
          <div className="w-full max-w-sm mx-auto lg:max-w-none">{tour.visual}</div>
        </div>
      </div>
    </section>
  );
}

// ── Why DinePOS ───────────────────────────────────────────────────────────────

const WHY = [
  { icon: Zap,      title: 'Bill 3× Faster',          desc: 'Smart product search, quick-add and saved orders make billing faster than any manual system.' },
  { icon: Package,  title: 'Cut Food Waste',           desc: 'Real-time inventory with recipe-level costing alerts your team before stock runs critical.' },
  { icon: TrendingUp, title: 'More Table Turns',       desc: 'Kitchen display + captain app eliminate delays. Faster service means more covers per shift.' },
  { icon: BarChart3,  title: 'Reports in Seconds',     desc: 'Daily sales, top sellers, shift summaries and GST reports — one tap. No spreadsheets.' },
  { icon: Globe,    title: 'Multi-Branch Control',     desc: 'Manage every outlet from one dashboard. Live sales, staff and inventory across locations.' },
  { icon: Shield,   title: 'Works Offline',            desc: 'Internet goes down? Billing continues. Orders sync automatically when connectivity returns.' },
];

function WhyDinePOS() {
  return (
    <section className="bg-[#FFF6EE] py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Why DinePOS</p>
          <h2 className="text-3xl font-bold text-gray-900">Real business results</h2>
          <p className="mt-3 text-gray-500">Not a feature list. Outcomes that move your bottom line.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {WHY.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-4 rounded-2xl border border-[#EBD8C8] bg-white p-6 shadow-sm">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50">
                <Icon size={22} className="text-[#E8380D]" />
              </div>
              <div>
                <h3 className="mb-1.5 font-semibold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Full feature grid ──────────────────────────────────────────────────────────

const ALL_FEATURES = [
  'POS Billing', 'KOT Printing', 'Table Management', 'Kitchen Display',
  'Inventory Tracking', 'Recipe Costing', 'QR Menu', 'Captain App',
  'Owner App', 'Customer Display', 'CRM & Loyalty', 'GST Billing',
  'Reports & Analytics', 'Multi-Branch', 'Cloud Backup', 'Loyalty Points',
  'Coupons & Offers', 'Expense Tracking', 'Staff Management', 'Role Permissions',
  'Audit Logs', 'Integrations', 'Offline Mode', 'Reservations',
];

function FeatureGrid() {
  return (
    <section className="bg-white py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Features</p>
          <h2 className="text-3xl font-bold text-gray-900">Everything included, no extras</h2>
          <p className="mt-3 text-gray-500">24 modules. One subscription. Nothing hidden.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ALL_FEATURES.map(f => (
            <div key={f} className="flex items-center gap-2.5 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
              <CheckCircle2 size={15} className="shrink-0 text-[#E8380D]" />
              <span className="text-sm font-medium text-gray-700">{f}</span>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            to="/features"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-[#E8380D] px-6 py-2.5 text-sm font-semibold text-[#E8380D] hover:bg-orange-50 transition-colors"
          >
            Explore all features <ChevronRight size={15} />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Integrations ──────────────────────────────────────────────────────────────

const INTEGRATIONS = [
  { name: 'Razorpay',   cat: 'Payments' },
  { name: 'PhonePe',    cat: 'Payments' },
  { name: 'Google Pay', cat: 'Payments' },
  { name: 'Paytm',      cat: 'Payments' },
  { name: 'WhatsApp',   cat: 'Communication' },
  { name: 'Swiggy',     cat: 'Delivery' },
  { name: 'Zomato',     cat: 'Delivery' },
  { name: 'ONDC',       cat: 'Delivery' },
  { name: 'Tally',      cat: 'Accounting' },
  { name: 'Zoho Books', cat: 'Accounting' },
];

const CAT_COLOR: Record<string, string> = {
  Payments:      'bg-blue-50 text-blue-600',
  Communication: 'bg-green-50 text-green-600',
  Delivery:      'bg-orange-50 text-[#E8380D]',
  Accounting:    'bg-purple-50 text-purple-600',
};

function Integrations() {
  return (
    <section className="bg-[#FFF6EE] py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Integrations</p>
          <h2 className="text-3xl font-bold text-gray-900">Connects to the tools you already use</h2>
          <p className="mt-3 text-gray-500">Payments, delivery platforms, accounting software — all in sync.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {INTEGRATIONS.map(({ name, cat }) => (
            <div
              key={name}
              className="flex flex-col items-center gap-3 rounded-2xl border border-[#EBD8C8] bg-white p-5 text-center shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-50 text-sm font-black text-gray-700">
                {name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{name}</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${CAT_COLOR[cat]}`}>{cat}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-gray-400">+ Hardware: Epson, TVS, Posiflex printers · Barcode scanners · Cash drawers</p>
      </div>
    </section>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  { n: '01', title: 'Sign up & configure',   desc: 'Register your restaurant, add your menu, set table layout.' },
  { n: '02', title: 'Train in 30 minutes',   desc: 'Intuitive interface — your staff learns it in one shift.' },
  { n: '03', title: 'Start taking orders',   desc: 'Go live the same day. Print receipts, track billing, run reports.' },
];

function HowItWorks() {
  return (
    <section className="bg-white py-20 px-5">
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
    name:  'Rajesh Kumar',
    role:  'Owner, Spice Garden Restaurant',
    city:  'Chennai',
    quote: 'Dine POS cut our billing time in half. The table management alone is worth every rupee.',
  },
  {
    name:  'Priya Nair',
    role:  'Manager, The Coastal Kitchen',
    city:  'Kochi',
    quote: 'The kitchen printer integration works flawlessly. No more lost KOTs, no more arguments.',
  },
  {
    name:  'Mohammed Salim',
    role:  'Owner, Biryani House',
    city:  'Coimbatore',
    quote: 'We run 3 outlets on one account. The daily reports help me compare performance instantly.',
  },
];

function Testimonials() {
  return (
    <section className="bg-[#FFF6EE] py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Loved by restaurant owners</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map(({ name, role, city, quote }) => (
            <div key={name} className="rounded-2xl border border-[#EBD8C8] bg-white p-6 shadow-sm">
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

// ── ROI calculator ────────────────────────────────────────────────────────────

function ROICalculator() {
  const [orders, setOrders]   = useState(80);
  const [avgBill, setAvgBill] = useState(350);
  const [tables, setTables]   = useState(20);

  const extraOrders   = Math.round(orders * 0.15);
  const revenueGain   = extraOrders * avgBill * 30;
  const timeSaved     = Math.round(orders * 0.5);
  const labourSaved   = Math.round(timeSaved * 4 * 30);

  function Slider({ label, value, min, max, step, unit, onChange }: {
    label: string; value: number; min: number; max: number; step: number; unit: string;
    onChange: (v: number) => void;
  }) {
    return (
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium text-gray-700">{label}</span>
          <span className="font-bold text-[#E8380D]">{unit}{value.toLocaleString('en-IN')}</span>
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full accent-[#E8380D]"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>{unit}{min}</span><span>{unit}{max}</span>
        </div>
      </div>
    );
  }

  return (
    <section className="bg-white py-20 px-5">
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">ROI Calculator</p>
          <h2 className="text-3xl font-bold text-gray-900">See what DinePOS is worth to you</h2>
          <p className="mt-3 text-gray-500">Adjust the sliders to match your restaurant.</p>
        </div>
        <div className="rounded-3xl border border-gray-100 bg-white shadow-xl overflow-hidden">
          <div className="grid md:grid-cols-2">
            {/* Inputs */}
            <div className="p-8 space-y-8 border-b border-gray-100 md:border-b-0 md:border-r">
              <p className="text-sm font-bold text-gray-500 uppercase tracking-wide">Your Restaurant</p>
              <Slider label="Orders per day"     value={orders}  min={20}  max={500} step={10}  unit=""  onChange={setOrders} />
              <Slider label="Average bill value" value={avgBill} min={100} max={2000} step={50} unit="₹" onChange={setAvgBill} />
              <Slider label="Number of tables"   value={tables}  min={5}   max={100} step={5}   unit=""  onChange={setTables} />
            </div>
            {/* Outputs */}
            <div className="p-8 bg-[#1C0800] text-white space-y-6">
              <p className="text-sm font-bold text-gray-400 uppercase tracking-wide">Your Monthly Gain</p>
              <div className="space-y-4">
                {[
                  { label: 'Extra orders/day (15% faster billing)', value: `+${extraOrders} orders` },
                  { label: 'Revenue increase',                      value: `+₹${revenueGain.toLocaleString('en-IN')}` },
                  { label: 'Time saved per day',                    value: `${timeSaved} min` },
                  { label: 'Labour cost saved',                     value: `₹${labourSaved.toLocaleString('en-IN')}` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between border-b border-white/10 pb-4 last:border-0 last:pb-0">
                    <p className="text-sm text-gray-400 max-w-[55%]">{label}</p>
                    <p className="text-lg font-black text-[#E8380D]">{value}</p>
                  </div>
                ))}
              </div>
              <Link
                to="/book-demo"
                className="mt-2 block w-full rounded-xl bg-[#E8380D] py-3 text-center text-sm font-bold text-white hover:bg-[#C93008] transition-colors"
              >
                Book a Free Demo
              </Link>
            </div>
          </div>
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
        <h2 className="mb-4 text-3xl font-bold">Ready to modernise your restaurant?</h2>
        <p className="mb-6 text-orange-100">Get started free — no credit card, no commitment.</p>
        <div className="mb-8 flex flex-wrap justify-center gap-3">
          {INCLUSIONS.map(item => (
            <span key={item} className="flex items-center gap-1.5 text-sm text-orange-100">
              <CheckCircle2 size={14} className="text-white/70" />{item}
            </span>
          ))}
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            to="/book-demo"
            className="rounded-xl bg-white px-8 py-3.5 text-sm font-semibold text-[#E8380D] transition-colors hover:bg-orange-50"
          >
            Book a Free Demo
          </Link>
          <Link
            to="/pricing"
            className="rounded-xl border border-white/30 px-8 py-3.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
          >
            View Pricing
          </Link>
        </div>
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
      <RestaurantTypes />
      <FeatureHighlights />
      <ProductTour />
      <WhyDinePOS />
      <FeatureGrid />
      <Integrations />
      <HowItWorks />
      <Testimonials />
      <ROICalculator />
      <CTABanner />
    </>
  );
}
