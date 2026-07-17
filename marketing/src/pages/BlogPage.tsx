import { Clock, Tag } from 'lucide-react';
import { Link } from 'react-router-dom';

const PLACEHOLDER_POSTS = [
  {
    title:   'How to reduce billing errors in your restaurant',
    excerpt: 'Manual billing causes 1 in 5 disputes at Indian restaurants. Here is how a digital POS eliminates them entirely.',
    tag:     'Tips & Tricks',
    date:    'Coming soon',
    slug:    '#',
  },
  {
    title:   'GST on restaurant bills — what every owner needs to know',
    excerpt: 'CGST, SGST, dine-in vs takeaway — we break down exactly how GST applies to restaurant billing in India.',
    tag:     'Compliance',
    date:    'Coming soon',
    slug:    '#',
  },
  {
    title:   'Kitchen printing 101: types, setup, and troubleshooting',
    excerpt: 'USB, Bluetooth, or LAN? 58mm or 80mm? Everything you need to know before buying a thermal printer.',
    tag:     'Hardware',
    date:    'Coming soon',
    slug:    '#',
  },
  {
    title:   'Why your restaurant needs a loyalty program (and how to start one)',
    excerpt: 'Repeat customers spend 67% more than new ones. Here is how a simple points system can transform your revenue.',
    tag:     'Growth',
    date:    'Coming soon',
    slug:    '#',
  },
  {
    title:   'How to train your staff on a new POS in one shift',
    excerpt: 'A structured 30-minute training plan that gets new waiters and cashiers confident on day one.',
    tag:     'Operations',
    date:    'Coming soon',
    slug:    '#',
  },
  {
    title:   'Table management best practices for busy restaurants',
    excerpt: 'From table assignment to bill splitting — the habits that keep your floor moving during a rush.',
    tag:     'Operations',
    date:    'Coming soon',
    slug:    '#',
  },
];

const TAG_COLORS: Record<string, string> = {
  'Tips & Tricks': 'bg-blue-50 text-blue-600',
  'Compliance':    'bg-yellow-50 text-yellow-700',
  'Hardware':      'bg-gray-100 text-gray-600',
  'Growth':        'bg-green-50 text-green-700',
  'Operations':    'bg-orange-50 text-[#E8380D]',
};

export function BlogPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Blog</h1>
        <p className="text-gray-400">
          Restaurant operations, technology, and growth — written for Indian restaurant owners.
        </p>
      </section>

      {/* Coming soon banner */}
      <section className="border-b border-orange-100 bg-orange-50 px-5 py-4 text-center">
        <p className="text-sm text-[#E8380D] font-medium">
          ✦ We're working on our first articles. Subscribe below to get notified when they publish.
        </p>
      </section>

      {/* Post grid */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PLACEHOLDER_POSTS.map(({ title, excerpt, tag, date, slug }) => (
            <article
              key={title}
              className="flex flex-col rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Thumbnail placeholder */}
              <div className="h-40 rounded-t-2xl bg-gradient-to-br from-[#FFF6EE] to-[#EBD8C8]" />

              <div className="flex flex-1 flex-col p-5">
                <div className="mb-3 flex items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <Tag size={10} />{tag}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-gray-400">
                    <Clock size={10} />{date}
                  </span>
                </div>
                <h2 className="mb-2 font-bold text-gray-900 leading-snug">{title}</h2>
                <p className="flex-1 text-sm leading-relaxed text-gray-500">{excerpt}</p>
                <a
                  href={slug}
                  className="mt-4 inline-flex items-center text-sm font-semibold text-[#E8380D] opacity-50"
                  aria-disabled
                  onClick={e => e.preventDefault()}
                >
                  Coming soon →
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Newsletter signup */}
      <section className="border-t border-gray-100 bg-[#FFF6EE] px-5 py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold text-gray-900">Get notified when we publish</h2>
        <p className="mb-6 text-gray-500 text-sm">No spam. One email per article, unsubscribe any time.</p>
        <form
          className="mx-auto flex max-w-sm gap-2"
          onSubmit={e => e.preventDefault()}
        >
          <input
            type="email"
            placeholder="your@email.com"
            className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-[#E8380D] focus:ring-2 focus:ring-[#E8380D]/10"
          />
          <button
            type="submit"
            className="rounded-xl bg-[#E8380D] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#C93008]"
          >
            Notify me
          </button>
        </form>
        <p className="mt-6 text-sm text-gray-500">
          Meanwhile, have a question?{' '}
          <Link to="/contact" className="font-semibold text-[#E8380D] hover:underline">
            Contact us
          </Link>.
        </p>
      </section>
    </div>
  );
}
