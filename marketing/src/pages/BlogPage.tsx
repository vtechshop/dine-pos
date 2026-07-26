import { Tag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePageSEO } from '../hooks/usePageSEO';

const UPCOMING_POSTS = [
  {
    title:   'How to reduce billing errors in your restaurant',
    excerpt: 'Manual billing causes 1 in 5 disputes at Indian restaurants. Here is how a digital POS eliminates them entirely.',
    tag:     'Tips & Tricks',
    slug:    '/contact',
  },
  {
    title:   'GST on restaurant bills — what every owner needs to know',
    excerpt: 'CGST, SGST, dine-in vs takeaway — we break down exactly how GST applies to restaurant billing in India.',
    tag:     'Compliance',
    slug:    '/contact',
  },
  {
    title:   'Kitchen printing 101: types, setup, and troubleshooting',
    excerpt: 'USB, Bluetooth, or LAN? 58mm or 80mm? Everything you need to know before buying a thermal printer.',
    tag:     'Hardware',
    slug:    '/contact',
  },
  {
    title:   'Why your restaurant needs a loyalty program (and how to start one)',
    excerpt: 'Repeat customers spend 67% more than new ones. Here is how a simple points system can transform your revenue.',
    tag:     'Growth',
    slug:    '/contact',
  },
  {
    title:   'How to train your staff on a new POS in one shift',
    excerpt: 'A structured 30-minute training plan that gets new waiters and cashiers confident on day one.',
    tag:     'Operations',
    slug:    '/contact',
  },
  {
    title:   'Table management best practices for busy restaurants',
    excerpt: 'From table assignment to bill splitting — the habits that keep your floor moving during a rush.',
    tag:     'Operations',
    slug:    '/contact',
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
  usePageSEO(
    'Blog — Dine POS',
    'Restaurant operations, technology, and growth tips — written for Indian restaurant owners by the team at Dine POS.',
  );
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Blog</h1>
        <p className="text-gray-400">
          Restaurant operations, technology, and growth — written for Indian restaurant owners.
        </p>
      </section>

      {/* Article previews */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="mb-8 flex items-center justify-between">
          <p className="text-sm text-gray-500">Upcoming articles — subscribe below to get them first.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {UPCOMING_POSTS.map(({ title, excerpt, tag, slug }) => (
            <article
              key={title}
              className="flex flex-col rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Thumbnail */}
              <div className="h-40 rounded-t-2xl bg-gradient-to-br from-[#FFF6EE] to-[#EBD8C8]" />

              <div className="flex flex-1 flex-col p-5">
                <div className="mb-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <Tag size={10} />{tag}
                  </span>
                </div>
                <h2 className="mb-2 font-bold text-gray-900 leading-snug">{title}</h2>
                <p className="flex-1 text-sm leading-relaxed text-gray-500">{excerpt}</p>
                <Link
                  to={slug}
                  className="mt-4 inline-flex items-center text-sm font-semibold text-[#E8380D] hover:underline"
                >
                  Get in touch →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Contact CTA */}
      <section className="border-t border-gray-100 bg-[#FFF6EE] px-5 py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold text-gray-900">Have a question or topic request?</h2>
        <p className="mb-6 text-sm text-gray-500">
          We'd love to hear from restaurant owners. Tell us what you want us to write about.
        </p>
        <Link
          to="/contact"
          className="inline-block rounded-xl bg-[#E8380D] px-8 py-3 text-sm font-semibold text-white hover:bg-[#C93008] transition-colors"
        >
          Get in Touch
        </Link>
      </section>
    </div>
  );
}
