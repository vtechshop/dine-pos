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

export function ShippingPage() {
  usePageSEO(
    'Shipping Policy — Dine POS | Happya Softech',
    'DinePOS shipping policy. DinePOS is a digital SaaS product — no physical products are shipped. Access is delivered electronically upon subscription.',
  );

  return (
    <div>
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Shipping Policy</h1>
        <p className="text-gray-400">Last updated: August 19, 2026</p>
      </section>

      <div className="mx-auto max-w-4xl space-y-4 px-5 py-14">

        <div className="rounded-2xl border border-orange-100 bg-[#FFF6EE] px-6 py-5 text-center">
          <p className="text-xl font-bold text-gray-900">
            No physical products are shipped by DinePOS.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            DinePOS is a cloud-based Software-as-a-Service (SaaS) platform. All features and
            services are delivered electronically.
          </p>
        </div>

        <Section title="Digital Delivery">
          <p>
            DinePOS is delivered electronically through the DinePOS web application and mobile
            application. No hardware, physical media, or printed materials are shipped to customers.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-medium text-gray-800">Free Trial:</span> After completing
              registration, your account is reviewed and approved by our team. Once approved,
              you receive your login credentials and can immediately access DinePOS.
            </li>
            <li>
              <span className="font-medium text-gray-800">Paid Subscription:</span> After successful
              payment, subscription access is activated for your account. You can access DinePOS
              immediately through{' '}
              <a
                href="https://web.dinepos.happya.in"
                className="text-[#E8380D] hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                web.dinepos.happya.in
              </a>{' '}
              and the DinePOS mobile application.
            </li>
          </ul>
        </Section>

        <Section title="Access Issues">
          <p>
            If you have made a successful payment but are unable to access your DinePOS account,
            contact our support team:
          </p>
          <div className="mt-2 space-y-1">
            <p>
              Email:{' '}
              <a href="mailto:info@happya.in" className="text-[#E8380D] hover:underline">
                info@happya.in
              </a>
            </p>
            <p>
              Phone:{' '}
              <a href="tel:+916381356683" className="text-[#E8380D] hover:underline">
                +91 63813 56683
              </a>
            </p>
          </div>
          <p className="text-gray-500">
            We will verify your payment and resolve access issues as quickly as possible.
          </p>
        </Section>

        <div className="flex flex-wrap gap-3 pt-4 text-sm text-gray-500">
          <Link to="/terms" className="hover:text-[#E8380D]">Terms &amp; Conditions</Link>
          <span>·</span>
          <Link to="/privacy" className="hover:text-[#E8380D]">Privacy Policy</Link>
          <span>·</span>
          <Link to="/refund" className="hover:text-[#E8380D]">Cancellation &amp; Refund</Link>
        </div>
      </div>
    </div>
  );
}
