import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageSEO } from '../hooks/usePageSEO';
import {
  Zap, LayoutGrid, Package, Printer, Sparkles,
  ChevronRight, CheckCircle2, Star, Check,
  Utensils, Coffee, Cake, Flame, Truck, Wine,
  UtensilsCrossed, Building, ShoppingBag, IceCream, ChefHat,
  Monitor, TrendingUp, Globe, FileText, Tablet,
  BarChart3, ArrowRight, Bluetooth, Smartphone,
  Brain, CreditCard,
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
          <Zap size={12} className="text-[#E8380D]" />
          Now onboarding founding restaurants — personal setup included
        </div>
        <h1 className="mb-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
          The Complete POS for{' '}
          <span className="text-[#E8380D]">Modern Restaurants</span>
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-gray-300">
          Billing, AI menu import, loyalty & CRM, vendor management, inventory intelligence,
          and AI analytics — all in one system built for Indian restaurants.
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
        <p className="mt-5 text-xs text-gray-500">No credit card required · 14-day free trial · ₹0 setup fee</p>
      </div>
    </section>
  );
}

// ── Honest product stats ───────────────────────────────────────────────────────

const PRODUCT_STATS = [
  { value: '< 2 min', label: 'AI Menu Import' },
  { value: '14 days', label: 'Free trial' },
  { value: '₹0',     label: 'Setup fee' },
  { value: '1 day',  label: 'Go live timeline' },
];

function StatsStrip() {
  return (
    <section className="border-b border-gray-100 bg-[#FFF6EE] py-8">
      <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 px-5 text-center sm:grid-cols-4">
        {PRODUCT_STATS.map(({ value, label }) => (
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
  { icon: Utensils,        label: 'Restaurant' },
  { icon: Coffee,          label: 'Café' },
  { icon: Cake,            label: 'Bakery' },
  { icon: Flame,           label: 'Cloud Kitchen' },
  { icon: Truck,           label: 'Food Truck' },
  { icon: Wine,            label: 'Bar & Pub' },
  { icon: UtensilsCrossed, label: 'Fine Dining' },
  { icon: Building,        label: 'Hotel' },
  { icon: ShoppingBag,     label: 'QSR' },
  { icon: Package,         label: 'Sweet Shop' },
  { icon: IceCream,        label: 'Ice Cream' },
  { icon: ChefHat,         label: 'Tiffin Centre' },
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
  {
    icon: Zap,
    title: 'Instant Order Entry',
    desc: 'Take orders table-by-table or guest-by-guest with a keyboard-first interface. Zero training needed.',
  },
  {
    icon: Sparkles,
    title: 'AI Menu Import',
    desc: 'Upload a photo or PDF of your existing menu. Gemini AI extracts every dish, price, and category — live in under 2 minutes.',
  },
  {
    icon: CreditCard,
    title: 'Loyalty, Wallet & CRM',
    desc: 'Customer profiles, loyalty points, wallet credit, and coupon codes — turn first-time visitors into regulars at the billing counter.',
  },
  {
    icon: LayoutGrid,
    title: 'Smart Table Management',
    desc: 'Visual table grid shows live status, occupied guests, running totals, and table reservations at a glance.',
  },
  {
    icon: Brain,
    title: 'AI Business Intelligence',
    desc: 'Gemini analyses yesterday\'s orders, flags anomalies, and delivers a daily morning brief with action items before your first order.',
  },
  {
    icon: Truck,
    title: 'Vendor & Supply Chain',
    desc: 'Raise purchase orders, log GRN receipts, track vendor ledgers, and manage expense entries — fully integrated with inventory.',
  },
  {
    icon: Globe,
    title: 'QR & Kiosk Ordering',
    desc: 'Customers scan a QR to self-order from their phone, or walk up to a kiosk tablet. Both feed directly to your kitchen.',
  },
  {
    icon: Printer,
    title: 'Kitchen Display & Printing',
    desc: 'Real-time kitchen screen and auto-print KOTs. Bluetooth, WiFi, and USB thermal printers supported.',
  },
  {
    icon: Smartphone,
    title: 'Android POS App',
    desc: 'Native Android app for billing, waiter ordering, and kitchen display. Works on any affordable tablet.',
  },
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
    points: ['Split & merge bills', 'Multiple payment modes', 'GST auto-calculation', 'Instant KOT printing', 'Discount engine'],
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
          <div className="flex justify-between text-xs text-gray-500"><span>Subtotal</span><span>₹580</span></div>
          <div className="flex justify-between text-xs text-gray-500"><span>GST (5%)</span><span>₹29</span></div>
          <div className="flex justify-between text-sm font-bold mt-1"><span>Total</span><span className="text-[#E8380D]">₹609</span></div>
        </div>
        <button className="mt-4 w-full rounded-xl bg-[#E8380D] py-2.5 text-sm font-bold text-white">Collect Payment</button>
      </div>
    ),
  },
  {
    label: 'Kitchen Display',
    icon: Monitor,
    headline: 'Zero missed orders',
    description: 'Real-time kitchen display replaces printed KOTs. Orders appear the moment they are placed, with visual timers that flag delays before they escalate.',
    points: ['Real-time order feed', 'Delay alert timers', 'Multi-station support', 'Audio alerts', 'Mark orders ready'],
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
    label: 'QR Ordering',
    icon: Globe,
    headline: 'Guests order. Kitchen gets it. You smile.',
    description: 'Scan-to-menu on every table. No app download. Orders land directly in the POS and kitchen display. Reduce waiter dependency during rush hours.',
    points: ['No-app QR menu', 'Live order sync to POS', 'Table-mapped ordering', 'Customisable digital menu', 'Real-time updates'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md flex flex-col items-center gap-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide self-start">Table QR Code</p>
        <div className="h-32 w-32 rounded-2xl bg-gray-900 flex items-center justify-center relative overflow-hidden">
          <div className="grid grid-cols-7 gap-px p-2 opacity-90">
            {Array.from({ length: 49 }, (_, i) => {
              const pattern = [1,1,1,1,1,1,1,1,0,0,0,0,0,1,1,0,1,1,1,0,1,1,0,1,0,1,0,1,1,0,1,1,1,0,1,1,0,0,0,0,0,1,1,1,1,1,1,1,1,1];
              return (
                <div key={i} className={`h-2.5 w-2.5 rounded-[1px] ${(pattern[i] ?? (i % 3 === 0 ? 1 : 0)) ? 'bg-white' : 'bg-gray-900'}`} />
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
  {
    label: 'AI Import',
    icon: Sparkles,
    headline: 'Your entire menu live in 2 minutes',
    description: 'Upload a photo or PDF of your existing menu. Gemini AI reads every dish, price, and category — then imports it directly into your POS. No manual typing.',
    points: ['Photo or PDF upload', 'AI extracts names, prices, categories', 'One-click import to your menu', 'Review & edit before going live', 'Works on handwritten menus'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center">
            <Sparkles size={20} className="text-purple-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">AI Menu Import</p>
            <p className="text-xs text-gray-400">Powered by Gemini AI</p>
          </div>
          <span className="ml-auto flex h-2 w-2 rounded-full bg-green-400 animate-pulse" />
        </div>
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-xs font-black text-red-500">PDF</div>
          <div>
            <p className="text-xs font-semibold text-gray-700">hotel_menu_2024.pdf</p>
            <p className="text-xs text-gray-400">Uploaded · 2.4 MB</p>
          </div>
          <span className="ml-auto text-xs font-bold text-green-600">✓ Done</span>
        </div>
        <div className="space-y-2 mb-4">
          {[
            { cat: 'Starters',    count: '8 items' },
            { cat: 'Main Course', count: '14 items' },
            { cat: 'Breads',      count: '6 items' },
            { cat: 'Beverages',   count: '12 items' },
          ].map(({ cat, count }) => (
            <div key={cat} className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={12} className="text-green-500" />
                <span className="text-xs font-medium text-gray-700">{cat}</span>
              </div>
              <span className="text-xs font-semibold text-green-700">{count} extracted</span>
            </div>
          ))}
        </div>
        <button className="w-full rounded-xl bg-[#E8380D] py-2.5 text-sm font-bold text-white">
          Import 40 items to menu →
        </button>
      </div>
    ),
  },
  {
    label: 'Kiosk',
    icon: Tablet,
    headline: 'Let customers order themselves',
    description: 'Turn any Android tablet into a self-service kiosk. Customers browse the menu, add items, and pay via UPI — no waiter needed. Orders go straight to the kitchen.',
    points: ['Customer self-order interface', 'UPI & cash payment options', 'Orders go straight to Kitchen Display', 'Works on any Android tablet', 'No customer app download needed'],
    visual: (
      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-4 text-center">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Self-Order Kiosk</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          {[
            { name: 'Chicken Biryani', price: '₹180', emoji: '🍛' },
            { name: 'Veg Thali',       price: '₹120', emoji: '🥘' },
            { name: 'Butter Naan',     price: '₹40',  emoji: '🫓' },
            { name: 'Mango Lassi',     price: '₹60',  emoji: '🥤' },
          ].map(item => (
            <div key={item.name} className="rounded-xl bg-gray-800 p-3">
              <div className="text-2xl mb-1">{item.emoji}</div>
              <p className="text-xs font-semibold text-white leading-tight">{item.name}</p>
              <p className="text-xs font-bold text-[#E8380D] mt-0.5">{item.price}</p>
            </div>
          ))}
        </div>
        <div className="mb-3 flex justify-between rounded-xl bg-gray-800 px-3 py-2">
          <span className="text-xs text-gray-400">Cart · 2 items</span>
          <span className="text-xs font-bold text-white">₹220</span>
        </div>
        <button className="w-full rounded-xl bg-[#E8380D] py-2.5 text-center text-sm font-bold text-white">
          Pay ₹220 via UPI
        </button>
      </div>
    ),
  },
  {
    label: 'Inventory',
    icon: Package,
    headline: 'Know what runs low before it runs out',
    description: 'Track raw materials and finished goods, set reorder alerts, and see cost-per-ingredient. Inventory under control, always.',
    points: ['Ingredient-level tracking', 'Low-stock alerts', 'Recipe costing', 'Cost-per-unit tracking', 'Restock history'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4">Stock Levels</p>
        <div className="space-y-4">
          {[
            { name: 'Chicken',     qty: '3.2 kg', pct: 32, warn: true  },
            { name: 'Basmati Rice',qty: '18 kg',  pct: 75, warn: false },
            { name: 'Tomatoes',    qty: '1.1 kg', pct: 14, warn: true  },
            { name: 'Oil',         qty: '4 L',    pct: 55, warn: false },
          ].map(({ name, qty, pct, warn }) => (
            <div key={name}>
              <div className="flex justify-between text-xs mb-1">
                <span className={`font-semibold ${warn ? 'text-red-600' : 'text-gray-700'}`}>{name}</span>
                <span className={warn ? 'text-red-500' : 'text-gray-400'}>{qty}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100">
                <div className={`h-2 rounded-full ${warn ? 'bg-red-500' : 'bg-[#E8380D]'}`} style={{ width: `${pct}%` }} />
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
    description: 'Sales by item, category, and day. Tax collected, payment method breakdown — full visibility with no manual entry.',
    points: ['Sales by category', 'Payment method breakdown', 'GST tax report', 'Export to CSV', 'Daily revenue summary'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-gray-900">Today's Sales</p>
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-600">↑ 18% vs yesterday</span>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Biryani',   value: 38, amount: '₹7,600' },
            { label: 'Starters',  value: 27, amount: '₹5,400' },
            { label: 'Breads',    value: 20, amount: '₹4,000' },
            { label: 'Beverages', value: 15, amount: '₹3,000' },
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
    label: 'Loyalty & CRM',
    icon: CreditCard,
    headline: 'Turn walk-ins into regulars',
    description: 'Every customer gets a profile. Earn loyalty points on every bill, redeem via wallet credit, send coupon codes, and issue gift vouchers — all managed from the billing counter.',
    points: ['Customer profiles & visit history', 'Loyalty points on every bill', 'Wallet credit & redemption', 'Coupon codes & gift vouchers', 'Spend analytics per customer'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-pink-50 flex items-center justify-center">
            <CreditCard size={20} className="text-pink-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Priya Sharma</p>
            <p className="text-xs text-gray-400">Member since Aug 2024 · 14 visits</p>
          </div>
          <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">Gold</span>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          {[['₹1,240', 'Wallet'], ['620', 'Points'], ['₹8,400', 'Spent']].map(([v, l]) => (
            <div key={l} className="rounded-lg bg-[#FFF6EE] py-2">
              <p className="text-sm font-bold text-[#E8380D]">{v}</p>
              <p className="text-[10px] text-gray-500">{l}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2 mb-4">
          {[
            { label: 'Last visit', value: 'Yesterday · ₹480' },
            { label: 'Favourite', value: 'Chicken Biryani' },
            { label: 'Active coupon', value: '10% off next bill' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-gray-400">{label}</span>
              <span className="font-semibold text-gray-700">{value}</span>
            </div>
          ))}
        </div>
        <button className="w-full rounded-xl bg-[#E8380D] py-2.5 text-sm font-bold text-white">
          Apply ₹1,240 Wallet Credit
        </button>
      </div>
    ),
  },
  {
    label: 'Vendor & Supply',
    icon: Truck,
    headline: 'Full supply chain, zero spreadsheets',
    description: 'Create purchase orders, record GRN receipts, track vendor-wise balances, and log daily expenses. Every rupee from supplier to kitchen is accounted for.',
    points: ['Vendor master & contact list', 'Purchase orders with line items', 'GRN receipt & stock update', 'Vendor ledger & outstanding balance', 'Expense tracking & P&L dashboard'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Purchase Order #PO-0042</p>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Pending GRN</span>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50">
            <Truck size={14} className="text-[#E8380D]" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-800">Sri Balaji Traders</p>
            <p className="text-[10px] text-gray-400">Delivery: Today before 10 AM</p>
          </div>
        </div>
        <div className="space-y-1.5 mb-3">
          {[['Chicken (kg)', '20', '₹220', '₹4,400'], ['Tomatoes (kg)', '15', '₹40', '₹600'], ['Oil (L)', '10', '₹130', '₹1,300']].map(([item, qty, rate, total]) => (
            <div key={item} className="grid grid-cols-4 gap-1 rounded-lg bg-gray-50 px-2 py-1.5 text-[10px]">
              <span className="col-span-2 font-medium text-gray-700">{item}</span>
              <span className="text-center text-gray-500">{qty} × {rate}</span>
              <span className="text-right font-bold text-gray-800">{total}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between rounded-xl bg-[#FFF6EE] px-3 py-2 text-sm">
          <span className="font-semibold text-gray-700">Total</span>
          <span className="font-extrabold text-[#E8380D]">₹6,300</span>
        </div>
      </div>
    ),
  },
  {
    label: 'AI Analytics',
    icon: Brain,
    headline: 'Insights before your first order',
    description: 'Every morning Gemini analyses the previous day\'s orders, flags anomalies, forecasts demand, and delivers a plain-English brief with specific actions your team can act on immediately.',
    points: ['Daily AI morning brief', 'Sales anomaly detection', 'Demand forecasting by category', 'Menu profitability analysis', 'Actionable recommendations'],
    visual: (
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-md">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50">
            <Brain size={20} className="text-purple-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Morning Brief · Today</p>
            <p className="text-xs text-gray-400">Generated by Gemini AI · 6:30 AM</p>
          </div>
          <span className="ml-auto flex h-2 w-2 rounded-full bg-green-400 animate-pulse" />
        </div>
        <div className="space-y-2.5">
          {[
            { type: 'insight', text: 'Yesterday revenue ₹48,200 — up 18% vs last Thursday. Biryani drove 38% of sales.' },
            { type: 'alert',   text: 'Chicken stock projected to run out by 2 PM today based on yesterday\'s consumption rate.' },
            { type: 'tip',     text: 'Mango Lassi has 68% margin. Consider featuring it in QR menu today.' },
          ].map(({ type, text }) => (
            <div key={text} className={`rounded-xl p-3 text-xs leading-relaxed ${type === 'alert' ? 'bg-red-50 text-red-700' : type === 'tip' ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-700'}`}>
              <span className="mr-1 font-bold">
                {type === 'alert' ? '⚠' : type === 'tip' ? '💡' : '📊'}
              </span>
              {text}
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-between rounded-xl bg-purple-50 px-3 py-2 text-xs">
          <span className="text-purple-600 font-semibold">AI Confidence</span>
          <span className="font-bold text-purple-700">High · Based on 134 orders</span>
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

        <div role="tablist" aria-label="Product tour" className="mb-10 flex flex-wrap justify-center gap-2">
          {TOURS.map((t, i) => (
            <button
              key={t.label}
              role="tab"
              aria-selected={active === i}
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

        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
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
          <div className="w-full max-w-sm mx-auto lg:max-w-none">{tour.visual}</div>
        </div>
      </div>
    </section>
  );
}

// ── Why DinePOS ───────────────────────────────────────────────────────────────

const WHY = [
  { icon: Zap,        title: 'Fast Billing Interface',     desc: 'Keyboard-first search, touch quick-add, barcode scanning, and modifier groups — every item added from a searchable menu without scrolling.' },
  { icon: CreditCard, title: 'Loyalty, Wallet & CRM',      desc: 'Customer profiles with loyalty points at billing, wallet credit, coupon codes, and gift vouchers — all accessible from the payment screen.' },
  { icon: TrendingUp, title: 'P&L Dashboard & Expenses',   desc: 'Log expenses by category, see revenue vs COGS, and drill into margin per dish. Finance dashboard built in — no separate spreadsheets.' },
  { icon: Brain,      title: 'AI Morning Brief & Analytics', desc: 'Gemini reads your daily order data and delivers a morning brief with observations, anomaly flags, and sales trends before your first order.' },
  { icon: Sparkles,   title: 'AI Menu Import',              desc: 'Upload a photo or PDF of your existing menu. Gemini extracts every dish, price, and category and imports directly into your POS.' },
  { icon: Star,       title: 'Free Setup & Training',       desc: 'Our team installs, configures, and trains your staff — at no extra cost. Most restaurants go live the same day.' },
];

function WhyDinePOS() {
  return (
    <section className="bg-[#FFF6EE] py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Why DinePOS</p>
          <h2 className="text-3xl font-bold text-gray-900">Built for how restaurants actually work</h2>
          <p className="mt-3 text-gray-500">Every feature exists because a restaurant owner asked for it.</p>
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

// ── Full feature grid ─────────────────────────────────────────────────────────

const ALL_FEATURES = [
  // Ordering & Tables
  'POS Billing',
  'KOT Printing',
  'Table Management',
  'Table Reservations',
  'QR Menu Ordering',
  'Kiosk Ordering',
  'Captain / Waiter App',
  // Kitchen
  'Kitchen Display System',
  'Receipt Printing',
  'Bluetooth Printing',
  // AI & Menu
  'AI Menu Import',
  'AI Business Intelligence',
  'AI Forecasting',
  'AI Alerts & Recommendations',
  'AI Chat',
  'Morning Brief',
  'Product Image Management',
  'Modifier Groups',
  // Customers
  'Loyalty & CRM',
  'Customer Wallet',
  'Gift Vouchers',
  'Coupon Codes',
  // Inventory
  'Inventory Tracking',
  'Recipe Costing',
  'Low-stock Alerts',
  'Wastage Tracking',
  'Inventory Intelligence',
  'Stock Turnover Analysis',
  // Supply Chain
  'Vendor Management',
  'Purchase Orders',
  'Goods Receive Notes (GRN)',
  'Vendor Ledger',
  // Finance & Reporting
  'Expense Tracking',
  'P&L Dashboard',
  'Menu Profitability',
  'Reports & Analytics',
  'GST Billing',
  'Export to CSV',
  // Payments
  'UPI Payments',
  'Razorpay Checkout',
  'Split Payments',
  // Operations
  'Customer Display Screen',
  'Owner App',
  'Android POS App',
  // Platform
  'Device Activation',
  'Role Permissions',
  'Audit Logs',
  'Real-time Sync',
  'Trial & Subscription',
];

function FeatureGrid() {
  return (
    <section className="bg-white py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Features</p>
          <h2 className="text-3xl font-bold text-gray-900">Everything included, no extras</h2>
          <p className="mt-3 text-gray-500">One subscription. Nothing hidden.</p>
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
  { name: 'Razorpay',  cat: 'Payments',     badge: 'Live' },
  { name: 'UPI / QR',  cat: 'Payments',     badge: 'Live' },
  { name: 'Swiggy',    cat: 'Aggregators',  badge: 'Beta' },
  { name: 'Zomato',    cat: 'Aggregators',  badge: 'Beta' },
];

const COMING_SOON = ['WhatsApp', 'Tally'];

const CAT_COLOR: Record<string, string> = {
  Payments:    'bg-blue-50 text-blue-600',
  Aggregators: 'bg-orange-50 text-orange-600',
};

function Integrations() {
  return (
    <section className="bg-[#FFF6EE] py-20 px-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Integrations</p>
          <h2 className="text-3xl font-bold text-gray-900">Payments & hardware, ready on day one</h2>
          <p className="mt-3 text-gray-500">More integrations are actively being built.</p>
        </div>

        {/* Live integrations */}
        <div className="mb-8 flex flex-wrap justify-center gap-4">
          {INTEGRATIONS.map(({ name, cat, badge }) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-2xl border border-[#EBD8C8] bg-white px-5 py-4 shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 text-sm font-black text-gray-700">
                {name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{name}</p>
                <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${CAT_COLOR[cat]}`}>{cat}</span>
              </div>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge === 'Beta' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{badge}</span>
            </div>
          ))}
        </div>

        {/* Coming soon */}
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Coming soon</p>
          <div className="flex flex-wrap justify-center gap-3">
            {COMING_SOON.map(name => (
              <span key={name} className="rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-sm font-medium text-gray-500">
                {name}
              </span>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-gray-400">Hardware: Epson, TVS, Posiflex printers · Bluetooth thermal printers · Cash drawers</p>
      </div>
    </section>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  { n: '01', title: 'Sign up & configure',  desc: 'Register your restaurant, upload your menu (or let AI import it), set up table layout.' },
  { n: '02', title: 'Train in 30 minutes',  desc: 'Intuitive interface — your staff learns it in one shift.' },
  { n: '03', title: 'Start taking orders',  desc: 'Go live the same day. Print receipts, track billing, run reports.' },
];

function HowItWorks() {
  return (
    <section className="bg-white py-20 px-5">
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Up and running in one day</h2>
          <p className="mt-3 text-gray-500">No IT team. Just a browser and an Android tablet.</p>
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

// ── Founding restaurant offer ─────────────────────────────────────────────────

const FOUNDING_PERKS = [
  { title: 'Personal Setup',   desc: 'Our team configures your menu, tables, and printers on-site. You don\'t touch a config file.' },
  { title: 'Direct Support',   desc: 'Reach us directly on WhatsApp — not a ticket queue. Real response from the people who built it.' },
  { title: 'Founding Price',   desc: '₹12,000/year locked in for the lifetime of your subscription. Price won\'t change as we grow.' },
];

function FoundingOffer() {
  return (
    <section className="bg-[#FFF6EE] py-20 px-5">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-xs font-semibold text-[#E8380D]">
          <Star size={12} className="fill-[#E8380D] text-[#E8380D]" /> Founding Restaurant Offer
        </div>
        <h2 className="text-3xl font-bold text-gray-900">Be among our first restaurants</h2>
        <p className="mx-auto mt-4 max-w-xl text-gray-500">
          We're personally onboarding our first batch of restaurants. You get direct access to the team — for setup, training, and any questions.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {FOUNDING_PERKS.map(({ title, desc }) => (
            <div key={title} className="rounded-2xl border border-[#EBD8C8] bg-white p-5 text-left shadow-sm">
              <p className="mb-2 font-semibold text-gray-900">{title}</p>
              <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
        <Link
          to="/book-demo"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#E8380D] px-8 py-3.5 text-sm font-semibold text-white hover:bg-[#C93008] transition-colors"
        >
          Book Your Demo <ArrowRight size={14} />
        </Link>
        <p className="mt-4 text-xs text-gray-400">Limited spots · First come, first served</p>
      </div>
    </section>
  );
}

// ── CTA banner ────────────────────────────────────────────────────────────────

const INCLUSIONS = [
  'Full POS access', 'Unlimited products', 'Kitchen printing',
  'Daily reports', 'WhatsApp support', 'No setup fee',
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
  usePageSEO(
    'Dine POS — Restaurant POS System',
    'The complete point-of-sale system for modern Indian restaurants. AI menu import, QR ordering, kiosk, kitchen display, and Android POS — all in one. 14-day free trial.',
  );
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
      <FoundingOffer />
      <CTABanner />
    </>
  );
}
