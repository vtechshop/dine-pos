import { Link } from 'react-router-dom';
import { usePageSEO } from '../hooks/usePageSEO';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="mb-3 text-lg font-bold text-gray-900">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-600">{children}</div>
    </section>
  );
}

export function RefundPage() {
  usePageSEO(
    'Cancellation & Refund Policy — Dine POS | Happya Softech',
    'DinePOS cancellation and refund policy. 14-day free trial, annual subscription ₹12,000. Learn how to cancel and when refunds apply.',
  );

  return (
    <div>
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Cancellation &amp; Refund Policy</h1>
        <p className="text-gray-400">Last updated: August 19, 2026</p>
      </section>

      <div className="mx-auto max-w-4xl space-y-4 px-5 py-14">

        <Section title="1. Overview">
          <p>
            This policy applies to all subscriptions for DinePOS, operated by Happya Softech.
            Please read this carefully before subscribing. By activating a paid subscription,
            you agree to the terms below.
          </p>
        </Section>

        <Section title="2. Free Trial">
          <div className="rounded-xl bg-[#FFF6EE] px-5 py-4">
            <p className="font-semibold text-gray-800">14-Day Free Trial</p>
            <p className="mt-1 text-gray-600">
              No payment required. Cancel any time before the trial ends — no charges apply.
              After the trial, continued access requires a paid subscription.
            </p>
          </div>
        </Section>

        <Section title="3. Subscription Plan">
          <div className="rounded-xl bg-[#FFF6EE] px-5 py-4">
            <p className="font-semibold text-gray-800 text-base">Annual Plan — ₹12,000 / year</p>
            <p className="mt-1 text-gray-600">
              Billed once per year. Includes all platform features.
              Applicable taxes, if any, will be shown before payment is confirmed.
            </p>
          </div>
        </Section>

        <Section title="4. Cancellation">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              You may cancel your subscription at any time by contacting{' '}
              <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">info@happya.in</a>.
            </li>
            <li>
              Upon cancellation, your access continues until the end of the current paid billing
              year. No further renewals will be charged.
            </li>
            <li>
              Cancellation does not automatically delete your data. You may request a data export
              or deletion separately.
            </li>
          </ul>
        </Section>

        <Section title="5. Refund Policy">
          <p>
            DinePOS is a subscription-based software service. Paid subscription fees are{' '}
            <strong className="text-gray-800">generally non-refundable</strong> once the
            subscription has been activated.
          </p>
          <p>Refunds may be considered in the following exceptional circumstances only:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-gray-800">Duplicate payment</span> — your account
              was charged more than once for the same subscription period due to a technical error.
            </li>
            <li>
              <span className="font-medium text-gray-800">Failed activation</span> — payment was
              successfully deducted but your subscription was not activated due to a technical issue
              on our end.
            </li>
            <li>
              <span className="font-medium text-gray-800">Incorrect charge</span> — an amount
              different from the stated subscription price was charged due to an error by
              Happya Softech.
            </li>
            <li>
              <span className="font-medium text-gray-800">Statutory requirement</span> — where a
              refund is required under applicable Indian law.
            </li>
          </ul>
          <p>
            Refund requests must be submitted to{' '}
            <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">info@happya.in</a>{' '}
            with your registered email address and a description of the issue. We will review and
            respond within a reasonable timeframe.
          </p>
          <p>
            Approved refunds are processed through the original payment method. The time to reflect
            in your account depends on your bank or payment provider.
          </p>
        </Section>

        <Section title="6. Non-Refundable Circumstances">
          <p>Refunds will not be issued for:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Change of mind after subscription activation.</li>
            <li>Partial use of the subscription period.</li>
            <li>Failure to use the platform after activation.</li>
            <li>Dissatisfaction with features clearly documented before purchase.</li>
          </ul>
        </Section>

        <Section title="7. Contact for Refund Requests">
          <address className="not-italic">
            <p className="font-semibold text-gray-800">Happya Softech — Billing Support</p>
            <p>Email: <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">info@happya.in</a></p>
            <p>Phone: +91 63813 56683</p>
            <p>9/83, E, 4th Street, T.Balan Nagar, Ganapathipudur,</p>
            <p>Coimbatore – 641006, Tamil Nadu, India</p>
          </address>
        </Section>

        <div className="flex flex-wrap gap-3 pt-4 text-sm text-gray-500">
          <Link to="/terms" className="hover:text-[#E8380D]">Terms &amp; Conditions</Link>
          <span>·</span>
          <Link to="/privacy" className="hover:text-[#E8380D]">Privacy Policy</Link>
          <span>·</span>
          <Link to="/shipping" className="hover:text-[#E8380D]">Shipping Policy</Link>
        </div>
      </div>
    </div>
  );
}
