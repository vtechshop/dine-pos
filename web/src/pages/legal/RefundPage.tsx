import { LegalLayout } from './LegalLayout';

export function RefundPage() {
  return (
    <LegalLayout title="Cancellation &amp; Refund Policy" lastUpdated="August 19, 2026">
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Overview</h2>
        <p>
          This policy applies to all subscriptions for DinePOS, a SaaS product operated by
          Happya Softech. Please read this policy carefully before subscribing. By activating
          a paid subscription, you agree to the terms below.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Free Trial</h2>
        <p>
          All new DinePOS accounts receive a <strong>14-day free trial</strong>. No payment is
          required during the trial period. You may cancel at any time before the trial ends
          without incurring any charges. After the trial period, continued access requires
          activating a paid subscription.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Subscription Plans</h2>
        <p className="mb-2">DinePOS is currently offered as an annual subscription:</p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 inline-block">
          <p className="font-semibold text-gray-900 text-lg">Annual Plan — ₹12,000 / year</p>
          <p className="text-sm text-gray-600 mt-1">Billed once per year. Includes all platform features.</p>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Applicable taxes, if any, will be shown before payment is confirmed.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Cancellation</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            You may cancel your DinePOS subscription at any time by contacting us at{' '}
            <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a>.
          </li>
          <li>
            Upon cancellation, your access to DinePOS will continue until the end of the
            current paid billing year. No further renewals will be charged after cancellation.
          </li>
          <li>
            Cancellation does not automatically delete your data. You may request data export
            or deletion separately.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Refund Policy</h2>
        <p className="mb-3">
          DinePOS is a subscription-based software service. Paid subscription fees are
          <strong> generally non-refundable</strong> once the subscription has been activated.
        </p>
        <p className="mb-2">Refunds may be considered in the following exceptional circumstances:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Duplicate payment:</strong> If your account was charged more than once for
            the same subscription period due to a technical error.
          </li>
          <li>
            <strong>Failed activation:</strong> If payment was successfully deducted but your
            subscription was not activated due to a technical issue on our end.
          </li>
          <li>
            <strong>Incorrect charge:</strong> If an amount different from the stated subscription
            price was charged due to an error by Happya Softech.
          </li>
          <li>
            <strong>Statutory requirement:</strong> Where a refund is required under applicable
            Indian law.
          </li>
        </ul>
        <p className="mt-3">
          Refund requests must be submitted to{' '}
          <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a>{' '}
          with your registered email address and a description of the issue. We will review
          the request and respond within a reasonable timeframe.
        </p>
        <p className="mt-3">
          Approved refunds are processed through the original payment method. The time for
          the refund to reflect in your account depends on your bank or payment provider.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Non-Refundable Circumstances</h2>
        <p className="mb-2">Refunds will not be issued for:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Change of mind after subscription activation.</li>
          <li>Partial use of the subscription period.</li>
          <li>Failure to use the platform after activation.</li>
          <li>Dissatisfaction with features that are clearly documented before purchase.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Contact for Refund Requests</h2>
        <address className="not-italic space-y-1 text-sm">
          <p className="font-medium">Happya Softech — Billing Support</p>
          <p>Email: <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a></p>
          <p>Phone: +91 63813 56683</p>
          <p>Address: 9/83, E, 4th Street, T.Balan Nagar, Ganapathipudur,</p>
          <p>Coimbatore – 641006, Tamil Nadu, India</p>
        </address>
      </section>
    </LegalLayout>
  );
}
