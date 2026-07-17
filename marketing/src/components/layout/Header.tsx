import { useState, useEffect } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

const POS_LOGIN_URL = 'https://app.dinepos.com/login';

const NAV_LINKS = [
  { to: '/',          label: 'Home' },
  { to: '/features',  label: 'Features' },
  { to: '/pricing',   label: 'Pricing' },
  { to: '/about',     label: 'About' },
  { to: '/faq',       label: 'FAQ' },
  { to: '/blog',      label: 'Blog' },
  { to: '/contact',   label: 'Contact' },
];

export function Header() {
  const [scrolled, setScrolled]   = useState(false);
  const [menuOpen, setMenuOpen]   = useState(false);

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 16); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false); }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-200 ${
        scrolled
          ? 'bg-white shadow-sm border-b border-gray-100'
          : 'bg-white/95 backdrop-blur'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
        {/* Logo */}
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <img
            src="/branding/logo-64.png"
            alt="Dine POS"
            className="h-9 w-9 rounded-xl object-contain"
          />
          <span className="text-base font-bold tracking-tight text-gray-900">
            Dine <span className="text-[#E8380D]">POS</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-orange-50 text-[#E8380D]'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-2 md:flex">
          <a
            href={POS_LOGIN_URL}
            className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Login
          </a>
          <Link
            to="/book-demo"
            className="rounded-lg bg-[#E8380D] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#C93008]"
          >
            Book Demo
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="ml-auto rounded-lg p-2 text-gray-600 hover:bg-gray-100 md:hidden"
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="border-t border-gray-100 bg-white px-5 pb-4 md:hidden">
          <nav className="flex flex-col gap-1 pt-2">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-orange-50 text-[#E8380D]' : 'text-gray-700 hover:bg-gray-50'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2">
            <a
              href={POS_LOGIN_URL}
              className="rounded-lg border border-gray-200 px-4 py-2 text-center text-sm font-medium text-gray-700"
            >
              Login
            </a>
            <Link
              to="/book-demo"
              onClick={() => setMenuOpen(false)}
              className="rounded-lg bg-[#E8380D] px-4 py-2 text-center text-sm font-semibold text-white"
            >
              Book Demo
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
