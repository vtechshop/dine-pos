import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, MessageCircle, Mail, ChevronRight } from 'lucide-react';
import {
  SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY, SUPPORT_EMAIL, supportWhatsAppUrl,
} from '../config/support';
import { useAuth } from '../context/AuthContext';

// Public support page — reachable from the login, register and other screens
// without signing in. Every option opens the user's own app (phone, WhatsApp,
// mail); nothing is sent from here.

const OPTIONS = [
  {
    key:    'whatsapp',
    icon:   MessageCircle,
    title:  'Chat on WhatsApp',
    detail: 'Fastest — send us a message',
    href:   supportWhatsAppUrl(),
    external: true,
    tone:   'bg-green-50 text-green-600',
  },
  {
    key:    'call',
    icon:   Phone,
    title:  'Call us',
    detail: SUPPORT_PHONE_DISPLAY,
    href:   `tel:${SUPPORT_PHONE}`,
    external: false,
    tone:   'bg-brand/10 text-brand',
  },
  {
    key:    'email',
    icon:   Mail,
    title:  'Email us',
    detail: SUPPORT_EMAIL,
    href:   `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Dine POS support')}`,
    external: false,
    tone:   'bg-sky-50 text-sky-600',
  },
] as const;

export function SupportPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  // Go back where the user came from; fall back to login on a direct visit.
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/login'));

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-mist px-4 py-8 sm:py-10">
      <div className="my-auto w-full max-w-md">
        <button
          type="button"
          onClick={goBack}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 transition hover:text-ink"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        <div className="mb-6 text-center">
          <img
            src="/branding/logo-64.png"
            alt="Dine POS"
            className="mx-auto mb-3 h-12 w-12 rounded-2xl object-contain shadow-md"
          />
          <h1 className="text-2xl font-bold text-ink">How can we help?</h1>
          <p className="mt-1 text-sm text-ink/50">Reach the Dine POS support team</p>
        </div>

        <ul className="space-y-3">
          {OPTIONS.map(o => (
            <li key={o.key}>
              <a
                href={o.href}
                {...(o.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="flex items-center gap-4 rounded-2xl border border-border bg-canvas p-4 shadow-sm transition hover:border-brand/40 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${o.tone}`}>
                  <o.icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{o.title}</span>
                  <span className="block truncate text-sm text-ink/55">{o.detail}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink/30" />
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-2xl border border-border bg-canvas p-4 text-sm text-ink/60">
          <p className="font-medium text-ink/80">To help us answer quickly, mention:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your business name and registered mobile number</li>
            <li>What you were doing and what went wrong</li>
            <li>A screenshot, if you can</li>
          </ul>
        </div>

        {/* Signed-in staff (opened from the sidebar) don't need sign-in / trial links */}
        {!isAuthenticated && <p className="mt-6 text-center text-sm text-ink/50">
          <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link>
          <span className="text-ink/30"> · </span>
          <Link to="/register" className="font-medium text-brand hover:underline">Start Free Trial</Link>
        </p>}
      </div>
    </div>
  );
}
