import { LegalLayout } from './LegalLayout';

export function TermsPage() {
  return (
    <LegalLayout title="Terms &amp; Conditions" lastUpdated="August 19, 2026">
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
        <p>
          By registering for or using DinePOS ("the Software"), a product of Happya Softech
          ("Company", "we", "us"), you ("Customer", "you") agree to be bound by these Terms &amp;
          Conditions. If you do not agree, do not use the Software.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
        <p>
          DinePOS is a cloud-based restaurant and hospitality management platform that provides
          billing, order management, inventory, reporting, and payment processing features to
          hotel and restaurant operators. The Software is offered as a Software-as-a-Service (SaaS)
          subscription.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Account Registration</h2>
        <p className="mb-2">
          You must provide accurate and complete information when registering. You are responsible
          for maintaining the confidentiality of your Admin ID, password, and kitchen PIN. All
          activities that occur under your account are your responsibility.
        </p>
        <p>
          Happya Softech will never ask for your password via email or phone. Do not share
          credentials with unauthorized parties.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Subscription and Payment</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>A 14-day free trial is available to all new accounts. No payment is required during the trial period.</li>
          <li>After the trial, continued use requires an active paid subscription (currently ₹12,000 per year).</li>
          <li>Subscription fees are billed annually in advance. All prices are in Indian Rupees (INR) and inclusive of applicable taxes.</li>
          <li>Pricing may be revised with 30 days' prior notice to the registered email address.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Acceptable Use</h2>
        <p className="mb-2">You agree not to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use the Software for any unlawful purpose or in violation of any applicable law.</li>
          <li>Attempt to reverse-engineer, decompile, or extract source code from the Software.</li>
          <li>Use the Software to process transactions on behalf of third parties without authorization.</li>
          <li>Introduce malicious code, conduct security attacks, or disrupt the Software's availability.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Data Ownership</h2>
        <p>
          All data you enter into DinePOS (orders, menus, customer records, financial transactions)
          remains your property. We do not claim ownership of your data. You may request an export
          of your data at any time by contacting us at <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Service Availability</h2>
        <p>
          We strive to maintain high availability of the Software. However, we do not guarantee
          uninterrupted service. Scheduled maintenance will be communicated in advance where
          possible. Happya Softech is not liable for losses arising from temporary service
          unavailability.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, Happya Softech shall not be liable
          for any indirect, incidental, special, or consequential damages arising out of the use
          or inability to use the Software. Our total liability in any matter arising out of these
          Terms shall not exceed the subscription fees paid by you in the 12 months preceding the
          claim.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Termination</h2>
        <p>
          Either party may terminate the subscription at any time. Upon termination, your access
          to the Software will continue until the end of the current paid billing period. Happya
          Softech reserves the right to suspend or terminate accounts that violate these Terms
          without prior notice.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Governing Law</h2>
        <p>
          These Terms are governed by the laws of India. Any disputes arising shall be subject
          to the exclusive jurisdiction of the courts in Coimbatore, Tamil Nadu, India.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Changes to Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of the Software after
          changes are posted constitutes your acceptance of the revised Terms. We will notify
          registered users of material changes via email.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Contact Us</h2>
        <address className="not-italic space-y-1 text-sm">
          <p className="font-medium">Happya Softech</p>
          <p>9/83, E, 4th Street, T.Balan Nagar, Ganapathipudur,</p>
          <p>Coimbatore – 641006, Tamil Nadu, India</p>
          <p>Email: <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a></p>
          <p>Phone: +91 63813 56683</p>
        </address>
      </section>
    </LegalLayout>
  );
}
