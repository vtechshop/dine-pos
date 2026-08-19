import { Link } from 'react-router-dom';

interface Props {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export function LegalLayout({ title, lastUpdated, children }: Props) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <span className="text-xl font-bold text-gray-900">DinePOS</span>
            <span className="ml-2 text-sm text-gray-500">by Happya Softech</span>
          </div>
          <Link to="/login" className="text-sm text-blue-600 hover:underline">
            Back to Login
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">{title}</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: {lastUpdated}</p>

        <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-8 text-gray-700 leading-relaxed">
          {children}
        </div>
      </main>

      <footer className="max-w-4xl mx-auto px-6 py-8 border-t border-gray-200 mt-6">
        <p className="text-sm text-gray-500 text-center">
          Happya Softech &nbsp;|&nbsp; 9/83, E, 4th Street, T.Balan Nagar, Ganapathipudur,
          Coimbatore – 641006, Tamil Nadu, India &nbsp;|&nbsp;
          <a href="mailto:info@happya.in" className="text-blue-600 hover:underline">info@happya.in</a>
          &nbsp;|&nbsp; +91 63813 56683
        </p>
        <div className="flex flex-wrap justify-center gap-4 mt-3 text-sm text-gray-500">
          <Link to="/terms" className="hover:text-blue-600">Terms &amp; Conditions</Link>
          <Link to="/privacy" className="hover:text-blue-600">Privacy Policy</Link>
          <Link to="/refund" className="hover:text-blue-600">Cancellation &amp; Refund</Link>
          <Link to="/shipping" className="hover:text-blue-600">Shipping Policy</Link>
          <Link to="/contact" className="hover:text-blue-600">Contact Us</Link>
        </div>
      </footer>
    </div>
  );
}
