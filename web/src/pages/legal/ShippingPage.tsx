import { LegalLayout } from './LegalLayout';

export function ShippingPage() {
  return (
    <LegalLayout title="Shipping Policy" lastUpdated="August 19, 2026">
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">No Physical Shipping</h2>
        <p className="text-lg text-gray-800 font-medium mb-4">
          DinePOS does not ship any physical products.
        </p>
        <p>
          DinePOS is a cloud-based Software-as-a-Service (SaaS) platform. All features and
          services are delivered electronically through the DinePOS web application and mobile
          application. No hardware, physical media, or printed materials are shipped to customers.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">Service Delivery</h2>
        <p className="mb-3">
          Access to DinePOS is provided digitally upon successful account registration and,
          where applicable, successful subscription payment. Here is what to expect:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Free Trial:</strong> After completing registration, your account is reviewed
            and approved by our team. Once approved, you receive your login credentials via email
            and can immediately access the DinePOS platform.
          </li>
          <li>
            <strong>Paid Subscription:</strong> After successful payment, subscription access is
            activated for your account. You can continue using DinePOS through the web application
            at <a href="https://web.dinepos.happya.in" className="text-blue-600 hover:underline">web.dinepos.happya.in</a> and
            the DinePOS mobile application.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">Access Issues</h2>
        <p>
          If you have made a successful payment but are unable to access your DinePOS account,
          please contact our support team immediately:
        </p>
        <address className="not-italic mt-3 space-y-1 text-sm">
          <p>Email: <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a></p>
          <p>Phone: +91 63813 56683</p>
        </address>
        <p className="mt-3 text-sm text-gray-600">
          We will verify your payment and resolve access issues as quickly as possible.
        </p>
      </section>
    </LegalLayout>
  );
}
