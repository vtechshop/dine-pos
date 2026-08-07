import { Link } from 'react-router-dom';
import { Target, Heart, Zap, Cpu, Cloud, Compass } from 'lucide-react';
import { usePageSEO } from '../hooks/usePageSEO';

const VALUES = [
  {
    icon: Target,
    title: 'Built for the Indian restaurant',
    desc: 'GST-ready billing, HSN codes, UPI payments, and Indian accounting formats — Dine POS is designed from the ground up for the Indian market, not adapted from a Western product.',
  },
  {
    icon: Zap,
    title: 'Speed is a feature',
    desc: 'Every screen is keyboard-first. A cashier should never wait for the system. Fast product search, quick-add, and instant KOT printing keep every shift moving.',
  },
  {
    icon: Heart,
    title: 'Owner-first product',
    desc: 'Every feature in Dine POS came from a conversation with a restaurant owner. We talk to the people who use it — and we build what they actually need.',
  },
];

const PROBLEMS = [
  {
    icon: Cpu,
    title: 'Billing was the bottleneck',
    desc: 'Most restaurants still use billing software designed in the early 2000s. Slow lookup, no search, no modifier support — every order took longer than it should.',
  },
  {
    icon: Cloud,
    title: 'No real-time visibility',
    desc: 'Owners had no way to see what was happening across the restaurant in real time. Kitchen delays, low stock, and missed orders were only discovered after the fact.',
  },
  {
    icon: Compass,
    title: 'Menu setup was the #1 friction point',
    desc: 'Getting an existing menu into a new POS meant hours of manual entry. A 40-item menu could take half a day. That single friction point stopped most restaurants from switching.',
  },
];

const ROADMAP = [
  { label: 'Live now',       items: ['AI Menu Import', 'Loyalty & CRM', 'Vendor & Supply Chain', 'Inventory Intelligence', 'AI Analytics & Morning Brief', 'QR Ordering', 'Kiosk', 'Kitchen Display', 'Expense Tracking', 'P&L Dashboard'] },
  { label: 'Coming in v1.1', items: ['Shift Management'] },
  { label: 'Coming in v2',   items: ['Offline Mode'] },
];

export function AboutPage() {
  usePageSEO(
    'About — Dine POS',
    'Dine POS is built for Indian restaurant owners who need fast billing, real-time kitchen operations, AI-powered menu import, and full inventory visibility — without a large IT team.',
  );
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-4 text-4xl font-extrabold">We build for the people who feed us</h1>
        <p className="mx-auto max-w-xl text-gray-400">
          Dine POS is a restaurant operating system built specifically for Indian restaurants.
          Fast billing, AI-powered tools, and complete business visibility — in one system.
        </p>
      </section>

      {/* Why we built it */}
      <section className="mx-auto max-w-3xl px-5 py-16">
        <h2 className="mb-5 text-2xl font-bold text-gray-900">Why we built Dine POS</h2>
        <div className="space-y-4 text-base leading-relaxed text-gray-600">
          <p>
            Restaurant owners in India were using billing software that hadn't changed in
            two decades. It was slow, required trained operators, gave no real-time data,
            and had no path to modern tools like QR ordering or AI-powered analytics.
          </p>
          <p>
            At the same time, global POS platforms were not built for the Indian
            market — GST structure, UPI payments, local hardware, and the specific
            workflows of Indian restaurant service weren't first-class concerns.
          </p>
          <p>
            Dine POS is our answer: a modern, cloud-native POS built ground-up for
            Indian restaurants. Every feature — from AI Menu Import to Vendor Ledgers
            to Morning Briefs — came directly from conversations with restaurant owners.
          </p>
        </div>
      </section>

      {/* Problems we solve */}
      <section className="bg-[#FFF6EE] px-5 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-gray-900">Problems we set out to solve</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {PROBLEMS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl border border-[#EBD8C8] bg-white p-6 shadow-sm">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50">
                  <Icon size={20} className="text-[#E8380D]" />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why AI Menu Import */}
      <section className="mx-auto max-w-3xl px-5 py-16">
        <h2 className="mb-5 text-2xl font-bold text-gray-900">Why we built AI Menu Import first</h2>
        <div className="space-y-4 text-base leading-relaxed text-gray-600">
          <p>
            The single biggest reason restaurants didn't switch POS was the menu migration
            burden. A 40-item menu with categories, prices, and variants meant hours of
            manual typing — and restaurants with 100+ items simply wouldn't start.
          </p>
          <p>
            AI Menu Import uses Gemini to read an existing menu from a photo or PDF
            and import it directly into the POS. It removes the migration friction entirely.
            A restaurant owner can go from "we have a printed menu" to "our POS is live"
            without typing a single item manually.
          </p>
        </div>
      </section>

      {/* Why cloud */}
      <section className="bg-[#FFF6EE] px-5 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-5 text-2xl font-bold text-gray-900">Why cloud POS</h2>
          <div className="space-y-4 text-base leading-relaxed text-gray-600">
            <p>
              Traditional POS systems run on a local Windows PC. When that PC fails,
              billing stops. When the owner is offsite, there's no visibility.
              When the software needs an update, it requires a technician.
            </p>
            <p>
              Cloud POS means: real-time sync across devices, remote access for owners,
              automatic updates, and no single point of failure. The web dashboard works
              on any browser; the kitchen display runs on any Android tablet; the cashier
              app runs on a phone. No dedicated hardware required.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="px-5 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-gray-900">What we believe</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {VALUES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl border border-[#EBD8C8] bg-white p-6 shadow-sm">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50">
                  <Icon size={20} className="text-[#E8380D]" />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission & Vision */}
      <section className="bg-[#1C0800] px-5 py-16 text-white">
        <div className="mx-auto max-w-3xl space-y-10">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Mission</p>
            <h2 className="mb-4 text-2xl font-bold">Give every Indian restaurant owner the tools large chains have</h2>
            <p className="text-gray-400 leading-relaxed">
              Enterprise-grade POS, AI analytics, inventory intelligence, and loyalty programs
              should not be reserved for hotel chains with IT departments.
              Dine POS puts those capabilities in the hands of any single-outlet restaurant owner
              for a flat annual fee, with zero setup cost and a one-day go-live.
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#E8380D]">Vision</p>
            <h2 className="mb-4 text-2xl font-bold">A restaurant OS that thinks with you</h2>
            <p className="text-gray-400 leading-relaxed">
              Beyond billing and orders, we are building an AI layer that reads your data every day
              and surfaces what matters: which dishes drive margin, which suppliers are overcharging,
              when you're heading toward a stock-out, and what yesterday's numbers mean for today.
              Operations handled by the system. Decisions guided by AI. The owner focused on the food.
            </p>
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="px-5 py-16">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-gray-900">What's built and what's coming</h2>
          <div className="space-y-6">
            {ROADMAP.map(({ label, items }) => (
              <div key={label} className="rounded-2xl border border-[#EBD8C8] bg-white p-6 shadow-sm">
                <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#E8380D]">{label}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map(item => (
                    <span key={item} className="rounded-full bg-[#FFF6EE] px-3 py-1 text-xs font-medium text-gray-700">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-[#1C0800] px-5 py-16 text-center text-white">
        <h2 className="mb-4 text-2xl font-bold">Come build with us</h2>
        <p className="mb-6 text-gray-400">
          We're onboarding founding restaurants and taking feedback directly from owners.
        </p>
        <Link
          to="/contact"
          className="inline-block rounded-xl bg-[#E8380D] px-8 py-3.5 text-sm font-semibold text-white hover:bg-[#C93008]"
        >
          Get in touch
        </Link>
      </section>
    </div>
  );
}
