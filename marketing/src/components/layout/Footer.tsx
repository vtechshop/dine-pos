import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin } from 'lucide-react';

const POS_LOGIN_URL = 'https://app.dinepos.com/login';

const LINKS = {
  Product: [
    { label: 'Features',  to: '/features' },
    { label: 'Pricing',   to: '/pricing' },
    { label: 'Book Demo', to: '/book-demo' },
    { label: 'Blog',      to: '/blog' },
  ],
  Company: [
    { label: 'About',   to: '/about' },
    { label: 'Contact', to: '/contact' },
    { label: 'FAQ',     to: '/faq' },
  ],
};

export function Footer() {
  return (
    <footer className="bg-[#1C0800] text-gray-300">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center gap-2.5">
              <img
                src="/branding/logo-64.png"
                alt="Dine POS"
                className="h-9 w-9 rounded-xl object-contain"
              />
              <span className="text-lg font-bold text-white">
                Dine <span className="text-[#E8380D]">POS</span>
              </span>
            </div>
            <p className="mb-5 max-w-xs text-sm leading-relaxed text-gray-400">
              The complete point-of-sale system built for modern restaurants.
              Streamline orders, billing, and inventory — all from one screen.
            </p>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-[#E8380D]" />
                <a href="mailto:support@dinepos.com" className="hover:text-white">
                  support@dinepos.com
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-[#E8380D]" />
                <span>+91 98765 43210</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-[#E8380D]" />
                <span>Chennai, Tamil Nadu, India</span>
              </div>
            </div>
          </div>

          {/* Link groups */}
          {Object.entries(LINKS).map(([heading, items]) => (
            <div key={heading}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
                {heading}
              </h3>
              <ul className="space-y-2">
                {items.map(({ label, to }) => (
                  <li key={to}>
                    <Link
                      to={to}
                      className="text-sm text-gray-400 transition-colors hover:text-white"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-xs text-gray-600">
            © {new Date().getFullYear()} Dine POS. All rights reserved.
          </p>
          <a
            href={POS_LOGIN_URL}
            className="text-xs text-gray-500 transition-colors hover:text-[#E8380D]"
          >
            Login to your account →
          </a>
        </div>
      </div>
    </footer>
  );
}
