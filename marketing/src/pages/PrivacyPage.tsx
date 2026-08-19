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

export function PrivacyPage() {
  usePageSEO(
    'Privacy Policy — Dine POS | Happya Softech',
    'Read the DinePOS Privacy Policy. Learn how Happya Softech collects, uses, and protects your data when you use the DinePOS restaurant management platform.',
  );

  return (
    <div>
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Privacy Policy</h1>
        <p className="text-gray-400">Last updated: August 19, 2026</p>
      </section>

      <div className="mx-auto max-w-4xl space-y-4 px-5 py-14">

        <Section title="1. Introduction">
          <p>
            Happya Softech ("we", "us", "our") operates DinePOS, a cloud-based restaurant and
            hotel management platform. This Privacy Policy explains how we collect, use, and protect
            information when you use DinePOS. By using our software, you agree to the practices
            described here.
          </p>
        </Section>

        <Section title="2. Information We Collect">
          <h3 className="font-semibold text-gray-800">2.1 Account Information</h3>
          <p>
            When you register, we collect your business name, owner name, email address, phone
            number, business address, and state/city. This is required to create and manage
            your account.
          </p>
          <h3 className="font-semibold text-gray-800">2.2 Operational Data</h3>
          <p>
            As part of normal use, DinePOS stores data you enter: menu items, order records, table
            assignments, inventory details, vendor information, customer records (if you choose to
            record them), and transaction history. This data is yours and is used solely to deliver
            the service to you.
          </p>
          <h3 className="font-semibold text-gray-800">2.3 Payment Information</h3>
          <p>
            Subscription payments are processed through Razorpay. We do not store complete card
            numbers, CVV codes, or net banking credentials. Payment processing is handled by
            Razorpay in accordance with PCI-DSS standards. We receive only a confirmation of
            successful payment and a transaction identifier.
          </p>
          <h3 className="font-semibold text-gray-800">2.4 Technical Information</h3>
          <p>
            We may collect device information, browser type, IP address, and usage logs to
            maintain security, diagnose issues, and improve the platform.
          </p>
        </Section>

        <Section title="3. How We Use Your Information">
          <ul className="list-disc space-y-2 pl-5">
            <li>To create and manage your DinePOS account.</li>
            <li>To provide, operate, and improve the Software.</li>
            <li>To process subscription payments and send billing-related communications.</li>
            <li>To provide customer support and respond to your queries.</li>
            <li>To send service-related notifications (account approvals, system updates, security alerts).</li>
            <li>To comply with applicable legal obligations.</li>
          </ul>
        </Section>

        <Section title="4. Third-Party Services">
          <p>
            DinePOS integrates with third-party services whose use of data is governed by their
            own privacy policies:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-gray-800">Razorpay</span> — Payment processing for
              DinePOS subscriptions and for hotel operators who connect their own Razorpay accounts
              for restaurant billing.
            </li>
          </ul>
          <p>We do not sell your data to third parties or use it for advertising purposes.</p>
        </Section>

        <Section title="5. Data Security">
          <p>
            We implement industry-standard security measures including encrypted data transmission
            (HTTPS/TLS), hashed credential storage, and access controls. While we take reasonable
            steps to protect your data, no system can guarantee absolute security. Use a strong,
            unique password and do not share your credentials.
          </p>
        </Section>

        <Section title="6. Data Retention">
          <p>
            We retain your account data for as long as your subscription is active and for a
            reasonable period thereafter to comply with legal obligations or resolve disputes.
            You may request deletion of your account and associated data by contacting us at{' '}
            <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">info@happya.in</a>.
          </p>
        </Section>

        <Section title="7. Your Rights">
          <p>You have the right to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Access the personal information we hold about your account.</li>
            <li>Request correction of inaccurate information.</li>
            <li>Request deletion of your account and data.</li>
            <li>Export your operational data (orders, products, etc.).</li>
          </ul>
          <p>
            To exercise any of these rights, contact{' '}
            <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">info@happya.in</a>.
          </p>
        </Section>

        <Section title="8. Updates to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify registered users of
            material changes via email. Continued use of DinePOS after changes are posted
            constitutes acceptance of the revised policy.
          </p>
        </Section>

        <Section title="9. Contact">
          <address className="not-italic">
            <p className="font-semibold text-gray-800">Happya Softech</p>
            <p>9/83, E, 4th Street, T.Balan Nagar, Ganapathipudur,</p>
            <p>Coimbatore – 641006, Tamil Nadu, India</p>
            <p>Email: <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">info@happya.in</a></p>
            <p>Phone: +91 63813 56683</p>
          </address>
        </Section>

        <div className="flex flex-wrap gap-3 pt-4 text-sm text-gray-500">
          <Link to="/terms" className="hover:text-[#E8380D]">Terms &amp; Conditions</Link>
          <span>·</span>
          <Link to="/refund" className="hover:text-[#E8380D]">Cancellation &amp; Refund</Link>
          <span>·</span>
          <Link to="/shipping" className="hover:text-[#E8380D]">Shipping Policy</Link>
        </div>
      </div>
    </div>
  );
}
