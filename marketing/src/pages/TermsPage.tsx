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

export function TermsPage() {
  usePageSEO(
    'Terms & Conditions — Dine POS | Happya Softech',
    'Read the Terms & Conditions for DinePOS, a SaaS restaurant management platform by Happya Softech. Covers subscriptions, acceptable use, and liability.',
  );

  return (
    <div>
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Terms &amp; Conditions</h1>
        <p className="text-gray-400">Last updated: August 19, 2026</p>
      </section>

      <div className="mx-auto max-w-4xl space-y-4 px-5 py-14">

        <Section title="1. Acceptance of Terms">
          <p>
            By registering for or using DinePOS ("the Software"), a product of Happya Softech
            ("Company", "we", "us"), you ("Customer", "you") agree to be bound by these Terms &amp;
            Conditions. If you do not agree, do not use the Software.
          </p>
        </Section>

        <Section title="2. Description of Service">
          <p>
            DinePOS is a cloud-based restaurant and hospitality management platform that provides
            billing, order management, kitchen display, table management, inventory, reporting,
            and payment processing features to hotel and restaurant operators. The Software is
            offered as a Software-as-a-Service (SaaS) subscription.
          </p>
        </Section>

        <Section title="3. Account Registration">
          <p>
            You must provide accurate and complete information when registering. You are responsible
            for maintaining the confidentiality of your Admin ID, password, and kitchen PIN. All
            activities that occur under your account are your responsibility.
          </p>
          <p>
            Happya Softech will never ask for your password via email or phone. Do not share
            credentials with unauthorised parties.
          </p>
        </Section>

        <Section title="4. Subscription and Payment">
          <ul className="list-disc space-y-2 pl-5">
            <li>A 14-day free trial is available to all new accounts. No payment is required during the trial period.</li>
            <li>After the trial, continued use requires an active paid subscription (currently ₹12,000 per year).</li>
            <li>Subscription fees are billed annually in advance. All prices are in Indian Rupees (INR).</li>
            <li>Applicable taxes, if any, will be displayed before payment is confirmed.</li>
            <li>Pricing may be revised with 30 days' prior notice to the registered email address.</li>
          </ul>
        </Section>

        <Section title="5. Acceptable Use">
          <p>You agree not to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Use the Software for any unlawful purpose or in violation of applicable law.</li>
            <li>Attempt to reverse-engineer, decompile, or extract source code from the Software.</li>
            <li>Introduce malicious code or conduct security attacks against the platform.</li>
            <li>Use the Software to process transactions on behalf of third parties without authorisation.</li>
          </ul>
        </Section>

        <Section title="6. Data Ownership">
          <p>
            All data you enter into DinePOS — orders, menus, customer records, financial
            transactions — remains your property. We do not claim ownership of your data. You may
            request an export at any time by contacting{' '}
            <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">info@happya.in</a>.
          </p>
        </Section>

        <Section title="7. Service Availability">
          <p>
            We strive to maintain high availability. However, we do not guarantee uninterrupted
            service. Scheduled maintenance will be communicated in advance where possible.
            Happya Softech is not liable for losses arising from temporary service unavailability.
          </p>
        </Section>

        <Section title="8. Limitation of Liability">
          <p>
            To the maximum extent permitted by applicable law, Happya Softech shall not be liable
            for any indirect, incidental, special, or consequential damages. Our total liability
            in any matter shall not exceed the subscription fees paid by you in the 12 months
            preceding the claim.
          </p>
        </Section>

        <Section title="9. Termination">
          <p>
            Either party may terminate the subscription at any time. Upon termination, your access
            continues until the end of the current paid billing period. Happya Softech reserves the
            right to suspend accounts that violate these Terms without prior notice.
          </p>
        </Section>

        <Section title="10. Governing Law">
          <p>
            These Terms are governed by the laws of India. Any disputes shall be subject to the
            exclusive jurisdiction of the courts in Coimbatore, Tamil Nadu, India.
          </p>
        </Section>

        <Section title="11. Changes to Terms">
          <p>
            We may update these Terms from time to time. Continued use of the Software after
            changes are posted constitutes acceptance. We will notify registered users of material
            changes via email.
          </p>
        </Section>

        <Section title="12. Contact">
          <address className="not-italic">
            <p className="font-semibold text-gray-800">Happya Softech</p>
            <p>9/83, E, 4th Street, T.Balan Nagar, Ganapathipudur,</p>
            <p>Coimbatore – 641006, Tamil Nadu, India</p>
            <p>Email: <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">info@happya.in</a></p>
            <p>Phone: +91 63813 56683</p>
          </address>
        </Section>

        <div className="flex flex-wrap gap-3 pt-4 text-sm text-gray-500">
          <Link to="/privacy" className="hover:text-[#E8380D]">Privacy Policy</Link>
          <span>·</span>
          <Link to="/refund" className="hover:text-[#E8380D]">Cancellation &amp; Refund</Link>
          <span>·</span>
          <Link to="/shipping" className="hover:text-[#E8380D]">Shipping Policy</Link>
        </div>
      </div>
    </div>
  );
}
