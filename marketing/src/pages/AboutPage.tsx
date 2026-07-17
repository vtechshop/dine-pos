import { Link } from 'react-router-dom';
import { Target, Heart, Zap } from 'lucide-react';

const VALUES = [
  {
    icon: Target,
    title: 'Built for the Indian restaurant',
    desc:  'GST-ready billing, HSN codes, Indian payment methods — Dine POS is designed from the ground up for the Indian market, not adapted from a Western product.',
  },
  {
    icon: Zap,
    title: 'Speed above everything',
    desc:  'Every screen is keyboard-first. A cashier should never wait for the system. We optimise relentlessly for time-to-bill.',
  },
  {
    icon: Heart,
    title: 'Owner-first product',
    desc:  'We talk to restaurant owners every week. Every feature in Dine POS came from a real conversation with a real restaurant.',
  },
];

const TIMELINE = [
  { year: '2022', event: 'Built first version for a single restaurant in Chennai.' },
  { year: '2023', event: 'Expanded to 50 restaurants across Tamil Nadu.' },
  { year: '2024', event: 'Launched kitchen printing, loyalty, and multi-outlet support.' },
  { year: '2025', event: '500+ restaurants across South India.' },
];

export function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-4 text-4xl font-extrabold">We build for the people who feed us</h1>
        <p className="mx-auto max-w-xl text-gray-400">
          Dine POS was born in a restaurant, not a boardroom.
          We've been in the kitchen — and we built the tool we wished we had.
        </p>
      </section>

      {/* Story */}
      <section className="mx-auto max-w-3xl px-5 py-16">
        <h2 className="mb-5 text-2xl font-bold text-gray-900">Our story</h2>
        <div className="space-y-4 text-base leading-relaxed text-gray-600">
          <p>
            Dine POS started in 2022 when we watched a restaurant in Chennai
            lose customers — not because the food was bad, but because the
            billing system was so slow that people left before paying.
          </p>
          <p>
            We built the first version of Dine POS in two weeks and installed
            it at that restaurant. Order-to-bill time dropped by 60%.
            Word spread. By the end of 2022 we were in 12 restaurants.
          </p>
          <p>
            Today, 500+ restaurants across India trust Dine POS for their
            daily operations. We're a small, focused team and we intend to
            stay that way — because the moment we stop talking to restaurant
            owners, we stop building the right product.
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="bg-[#FFF6EE] px-5 py-16">
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

      {/* Timeline */}
      <section className="mx-auto max-w-2xl px-5 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold text-gray-900">Our journey</h2>
        <div className="space-y-0">
          {TIMELINE.map(({ year, event }, i) => (
            <div key={year} className="flex gap-5">
              <div className="flex flex-col items-center">
                <div className="h-5 w-5 rounded-full border-2 border-[#E8380D] bg-white" />
                {i < TIMELINE.length - 1 && (
                  <div className="w-0.5 flex-1 bg-orange-100" />
                )}
              </div>
              <div className="pb-8">
                <div className="mb-1 text-sm font-bold text-[#E8380D]">{year}</div>
                <div className="text-sm text-gray-600">{event}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-[#1C0800] px-5 py-16 text-center text-white">
        <h2 className="mb-4 text-2xl font-bold">Come build with us</h2>
        <p className="mb-6 text-gray-400">
          We're always looking for feedback from restaurant owners.
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
