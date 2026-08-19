import { LegalLayout } from './LegalLayout';

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="August 19, 2026">
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
        <p>
          Happya Softech ("we", "us", "our") operates DinePOS, a cloud-based restaurant and hotel
          management platform. This Privacy Policy explains how we collect, use, and protect
          information when you use DinePOS. By using our software, you agree to the practices
          described in this policy.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
        <h3 className="font-medium text-gray-800 mb-2">2.1 Account Information</h3>
        <p className="mb-3">
          When you register for DinePOS, we collect your business name, owner name, email address,
          phone number, business address, and state/city. This information is required to create
          and manage your account.
        </p>
        <h3 className="font-medium text-gray-800 mb-2">2.2 Operational Data</h3>
        <p className="mb-3">
          As part of normal use, DinePOS stores data you enter into the platform: menu items,
          order records, table assignments, inventory details, vendor information, customer records
          (if you choose to record them), and transaction history. This data is yours and is used
          solely to deliver the service to you.
        </p>
        <h3 className="font-medium text-gray-800 mb-2">2.3 Payment Information</h3>
        <p className="mb-3">
          Subscription payments for DinePOS are processed through Razorpay. We do not store
          complete card numbers, CVV codes, or net banking credentials. Payment processing is
          handled by Razorpay in accordance with their security standards (PCI-DSS). We receive
          only a confirmation of successful payment and relevant transaction identifiers.
        </p>
        <h3 className="font-medium text-gray-800 mb-2">2.4 Technical Information</h3>
        <p>
          We may collect device information, browser type, IP address, and usage logs for the
          purpose of maintaining service security, diagnosing issues, and improving the platform.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>To create and manage your DinePOS account.</li>
          <li>To provide, operate, and improve the Software.</li>
          <li>To process subscription payments and send billing-related communications.</li>
          <li>To provide customer support and respond to your queries.</li>
          <li>To send service-related notifications (account approvals, system updates, security alerts).</li>
          <li>To comply with applicable legal obligations.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Third-Party Services</h2>
        <p className="mb-2">
          DinePOS integrates with the following third-party services. Their use of data is governed
          by their own privacy policies:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Razorpay</strong> — Payment processing for DinePOS subscriptions and for hotel
            operators who connect their own Razorpay accounts for restaurant billing.
          </li>
        </ul>
        <p className="mt-3">
          We do not sell your data to third parties or use it for advertising purposes.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Security</h2>
        <p>
          We implement industry-standard security measures including encrypted data transmission
          (HTTPS/TLS), hashed credential storage, and access controls. While we take reasonable
          steps to protect your data, no system can guarantee absolute security. Please use a
          strong, unique password and do not share your credentials.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Data Retention</h2>
        <p>
          We retain your account data for as long as your subscription is active and for a
          reasonable period thereafter to comply with legal obligations or resolve disputes.
          You may request deletion of your account and associated data by contacting us at{' '}
          <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Your Rights</h2>
        <p className="mb-2">You have the right to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Access the personal information we hold about your account.</li>
          <li>Request correction of inaccurate information.</li>
          <li>Request deletion of your account and data.</li>
          <li>Export your operational data (orders, products, etc.).</li>
        </ul>
        <p className="mt-3">
          To exercise any of these rights, contact us at{' '}
          <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Updates to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify registered users of
          material changes via email. Continued use of DinePOS after changes are posted constitutes
          acceptance of the revised policy.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Contact Us</h2>
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
