import { CheckCircle2, X } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Plan {
  name:     string;
  price:    string;
  period:   string;
  tagline:  string;
  cta:      string;
  ctaTo:    string;
  popular?: boolean;
  features: Array<{ label: string; included: boolean }>;
}

const PLANS: Plan[] = [
  {
    name:    'Starter',
    price:   '₹999',
    period:  '/month',
    tagline: 'Perfect for single-outlet restaurants.',
    cta:     'Start Free Trial',
    ctaTo:   '/book-demo',
    features: [
      { label: '1 outlet',                     included: true },
      { label: 'Unlimited products',            included: true },
      { label: 'Table management',              included: true },
      { label: 'Billing & payments',            included: true },
      { label: 'Kitchen printing',              included: true },
      { label: 'Daily reports',                 included: true },
      { label: 'Email support',                 included: true },
      { label: 'Inventory tracking',            included: false },
      { label: 'Loyalty program',               included: false },
      { label: 'Multi-outlet management',       included: false },
      { label: 'Priority support',              included: false },
    ],
  },
  {
    name:    'Pro',
    price:   '₹1,999',
    period:  '/month',
    tagline: 'For restaurants that need the full suite.',
    cta:     'Start Free Trial',
    ctaTo:   '/book-demo',
    popular: true,
    features: [
      { label: 'Up to 3 outlets',               included: true },
      { label: 'Unlimited products',             included: true },
      { label: 'Table management',               included: true },
      { label: 'Billing & payments',             included: true },
      { label: 'Kitchen printing',               included: true },
      { label: 'Daily reports',                  included: true },
      { label: 'Email support',                  included: true },
      { label: 'Inventory tracking',             included: true },
      { label: 'Loyalty program',                included: true },
      { label: 'Multi-outlet management',        included: false },
      { label: 'Priority support',               included: false },
    ],
  },
  {
    name:    'Enterprise',
    price:   'Custom',
    period:  '',
    tagline: 'For chains and cloud kitchens with 4+ outlets.',
    cta:     'Contact Sales',
    ctaTo:   '/contact',
    features: [
      { label: 'Unlimited outlets',              included: true },
      { label: 'Unlimited products',             included: true },
      { label: 'Table management',               included: true },
      { label: 'Billing & payments',             included: true },
      { label: 'Kitchen printing',               included: true },
      { label: 'Daily reports',                  included: true },
      { label: 'Email support',                  included: true },
      { label: 'Inventory tracking',             included: true },
      { label: 'Loyalty program',                included: true },
      { label: 'Multi-outlet management',        included: true },
      { label: 'Priority support',               included: true },
    ],
  },
];

const FAQ_ITEMS = [
  {
    q: 'Is there a free trial?',
    a: 'Yes — all plans come with a 14-day free trial. No credit card required.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Absolutely. Upgrade or downgrade at any time from your account settings.',
  },
  {
    q: 'Is the price per outlet or per account?',
    a: 'The Starter plan covers 1 outlet. Pro covers up to 3. Enterprise is unlimited.',
  },
  {
    q: 'Is there a setup fee?',
    a: 'No setup fee on any plan. You pay only the monthly subscription.',
  },
];

export function PricingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-4 text-4xl font-extrabold">Simple, honest pricing</h1>
        <p className="text-gray-400">
          No hidden fees. No per-feature charges. Cancel any time.
        </p>
      </section>

      {/* Plans */}
      <section className="mx-auto max-w-5xl px-5 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map(plan => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border p-7 shadow-sm ${
                plan.popular
                  ? 'border-[#E8380D] ring-1 ring-[#E8380D]'
                  : 'border-gray-200 bg-white'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#E8380D] px-3 py-0.5 text-xs font-bold text-white">
                  Most Popular
                </div>
              )}

              <div className="mb-5">
                <div className="mb-1 text-sm font-semibold uppercase tracking-widest text-gray-400">
                  {plan.name}
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-extrabold text-gray-900">{plan.price}</span>
                  {plan.period && (
                    <span className="mb-1 text-sm text-gray-400">{plan.period}</span>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-500">{plan.tagline}</p>
              </div>

              <ul className="mb-7 flex-1 space-y-2.5">
                {plan.features.map(({ label, included }) => (
                  <li key={label} className="flex items-center gap-2 text-sm">
                    {included ? (
                      <CheckCircle2 size={15} className="shrink-0 text-green-500" />
                    ) : (
                      <X size={15} className="shrink-0 text-gray-300" />
                    )}
                    <span className={included ? 'text-gray-700' : 'text-gray-400'}>
                      {label}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                to={plan.ctaTo}
                className={`block rounded-xl py-3 text-center text-sm font-semibold transition-colors ${
                  plan.popular
                    ? 'bg-[#E8380D] text-white hover:bg-[#C93008]'
                    : 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Mini FAQ */}
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
