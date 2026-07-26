import { Link } from 'react-router-dom';
import { usePageSEO } from '../hooks/usePageSEO';

export function NotFoundPage() {
  usePageSEO('Page Not Found — Dine POS', 'The page you are looking for does not exist. Return to Dine POS home.');
  return (
    <div className="flex flex-col items-center justify-center px-5 py-32 text-center">
      <p className="mb-2 text-7xl font-black text-[#E8380D]">404</p>
      <h1 className="mb-3 text-2xl font-bold text-gray-900">Page not found</h1>
      <p className="mb-8 max-w-sm text-gray-500">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Link
          to="/"
          className="rounded-xl bg-[#E8380D] px-7 py-3 text-sm font-semibold text-white hover:bg-[#C93008] transition-colors"
        >
          Go to Home
        </Link>
        <Link
          to="/contact"
          className="rounded-xl border border-gray-200 px-7 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Contact Support
        </Link>
      </div>
    </div>
  );
}
