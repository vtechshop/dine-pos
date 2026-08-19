import { LegalLayout } from './LegalLayout';
import { Mail, Phone, MapPin } from 'lucide-react';

export function ContactPage() {
  return (
    <LegalLayout title="Contact Us" lastUpdated="August 19, 2026">
      <section>
        <p className="text-gray-600 mb-6">
          Have a question about DinePOS, your subscription, or need support? Reach out to the
          Happya Softech team using the details below. We typically respond within one business day.
        </p>

        <div className="grid gap-6 sm:grid-cols-3">
          <div className="flex flex-col items-center text-center bg-gray-50 rounded-xl p-6 border border-gray-200">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">Email</p>
            <a href="mailto:info@happya.in" className="text-blue-600 hover:underline text-sm break-all">
              info@happya.in
            </a>
          </div>

          <div className="flex flex-col items-center text-center bg-gray-50 rounded-xl p-6 border border-gray-200">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-3">
              <Phone className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">Phone</p>
            <a href="tel:+916381356683" className="text-green-600 hover:underline text-sm">
              +91 63813 56683
            </a>
          </div>

          <div className="flex flex-col items-center text-center bg-gray-50 rounded-xl p-6 border border-gray-200">
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-3">
              <MapPin className="w-5 h-5 text-purple-600" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">Address</p>
            <address className="not-italic text-sm text-gray-600 leading-5">
              <p>9/83, E, 4th Street,</p>
              <p>T.Balan Nagar, Ganapathipudur,</p>
              <p>Coimbatore – 641006,</p>
              <p>Tamil Nadu, India</p>
            </address>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">Support Topics</h2>
        <div className="space-y-3">
          {[
            { topic: 'Account &amp; Login Issues', detail: 'Trouble logging in, forgot password, credential reset' },
            { topic: 'Billing &amp; Subscription', detail: 'Invoice requests, payment queries, plan changes' },
            { topic: 'Refund Requests', detail: 'See our Cancellation &amp; Refund Policy for eligibility' },
            { topic: 'Technical Support', detail: 'App not loading, feature not working, data sync issues' },
            { topic: 'New Registration', detail: 'Questions before signing up for DinePOS' },
          ].map(({ topic, detail }) => (
            <div key={topic} className="flex gap-4 p-4 border border-gray-200 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
              <div>
                <p className="font-medium text-gray-800 text-sm" dangerouslySetInnerHTML={{ __html: topic }} />
                <p className="text-sm text-gray-500 mt-0.5" dangerouslySetInnerHTML={{ __html: detail }} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-gray-600">
          For all queries, email{' '}
          <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a>{' '}
          with your registered phone number or email so we can identify your account quickly.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">About DinePOS</h2>
        <p className="text-sm text-gray-600">
          DinePOS is developed and operated by Happya Softech, a software company based in
          Coimbatore, Tamil Nadu. DinePOS helps restaurants, hotels, cafés, and food-service
          businesses manage their daily operations through an integrated digital platform.
        </p>
      </section>
    </LegalLayout>
  );
}
