import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';

interface FAQItem {
  q: string;
  a: string;
}

const FAQ_GROUPS: { heading: string; items: FAQItem[] }[] = [
  {
    heading: 'Getting started',
    items: [
      {
        q: 'How do I sign up?',
        a: 'Book a free demo and our team will set up your account, configure your menu, and walk you through everything — usually in the same session.',
      },
      {
        q: 'Is there a free trial?',
        a: 'Yes — all plans include a 14-day free trial with full access. No credit card required.',
      },
      {
        q: 'How long does setup take?',
        a: 'Most restaurants are live within one day. Menu import via CSV makes the initial setup fast. We also offer assisted onboarding.',
      },
      {
        q: 'Do I need to install anything?',
        a: 'No. Dine POS is browser-based — it runs on any device with Chrome, Safari, or Edge. No app downloads, no Windows-only software.',
      },
    ],
  },
  {
    heading: 'Features & usage',
    items: [
      {
        q: 'How many tables and products can I have?',
        a: 'Unlimited on all plans. There are no caps on the number of tables, products, or categories.',
      },
      {
        q: 'Can I use Dine POS for takeaway and delivery orders?',
        a: 'Yes. Parcel and takeaway orders are tracked separately with their own billing flow. Online delivery integration is on the roadmap.',
      },
      {
        q: 'Does Dine POS support split billing?',
        a: 'Yes — you can split a bill across UPI, cash, and card in one transaction. You can also split a table bill across multiple guests.',
      },
      {
        q: 'Can staff log in with their own accounts?',
        a: 'Yes. Waiters and cashiers get their own PIN-based login. Each role sees only the screens relevant to them.',
      },
      {
        q: 'How does kitchen printing work?',
        a: 'When an order is placed, Dine POS automatically sends a KOT (kitchen order ticket) to the connected kitchen printer via your local network. Supports 58mm and 80mm thermal printers.',
      },
    ],
  },
  {
    heading: 'Billing & pricing',
    items: [
      {
        q: 'What payment methods does Dine POS support for receipts?',
        a: 'Cash, UPI, card, split payment, and complimentary (with reason). Each payment type is tracked separately in reports.',
      },
      {
        q: 'Is GST calculation built in?',
        a: 'Yes. Set a default tax rate for the outlet, or configure tax per product with HSN codes for detailed GST reports.',
      },
      {
        q: 'Can I change my plan?',
        a: 'Yes. Upgrade or downgrade at any time. Changes take effect at the start of your next billing cycle.',
      },
      {
        q: 'Is there a setup fee or contract?',
        a: 'No setup fee. No annual contract. Pay month to month and cancel any time.',
      },
    ],
  },
  {
    heading: 'Technical',
    items: [
      {
        q: 'What happens if the internet goes down?',
        a: 'Dine POS requires an internet connection. We recommend a stable broadband connection with a mobile data backup. Offline mode is on our roadmap.',
      },
      {
        q: 'Is my data secure?',
        a: 'All data is encrypted in transit (HTTPS). Authentication uses JWT with token rotation. Role-based access ensures staff see only what they need.',
      },
      {
        q: 'Can I export my data?',
        a: 'Yes — products, reports, and billing data can be exported to CSV at any time.',
      },
    ],
  },
];

function Accordion({ items }: { items: FAQItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {items.map(({ q, a }, i) => (
        <div key={q} className="overflow-hidden rounded-xl border border-gray-200">
          <button
            className="flex w-full items-center justify-between gap-4 bg-white px-5 py-4 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span>{q}</span>
            <ChevronDown
              size={16}
              className={`shrink-0 text-gray-400 transition-transform ${
                open === i ? 'rotate-180' : ''
              }`}
            />
          </button>
          {open === i && (
            <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 text-sm leading-relaxed text-gray-600">
              {a}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function FAQPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Frequently asked questions</h1>
        <p className="text-gray-400">
          Can't find what you're looking for?{' '}
          <Link to="/contact" className="text-[#E8380D] hover:underline">
            Contact us
          </Link>.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-16 space-y-12">
        {FAQ_GROUPS.map(({ heading, items }) => (
          <div key={heading}>
            <h2 className="mb-5 text-lg font-bold text-gray-900">{heading}</h2>
            <Accordion items={items} />
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="border-t border-gray-100 bg-[#FFF6EE] px-5 py-14 text-center">
        <h2 className="mb-3 text-2xl font-bold text-gray-900">Still have questions?</h2>
        <p className="mb-6 text-gray-500">
          Our team is happy to walk you through anything on a live call.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/book-demo"
            className="rounded-xl bg-[#E8380D] px-7 py-3 text-sm font-semibold text-white hover:bg-[#C93008]"
          >
            Book a Demo
          </Link>
          <Link
            to="/contact"
            className="rounded-xl border border-gray-200 bg-white px-7 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Send a Message
          </Link>
        </div>
      </section>
    </div>
  );
}
