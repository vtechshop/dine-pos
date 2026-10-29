import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { registerHotel } from '../api/hotels';
import { ApiError } from '../api/client';
import { Spinner } from '../components/ui/Spinner';

const BUSINESS_TYPES = [
  { value: 'restaurant',    label: 'Restaurant' },
  { value: 'hotel',         label: 'Hotel' },
  { value: 'bakery',        label: 'Bakery' },
  { value: 'cafe',          label: 'Café' },
  { value: 'sweet-shop',    label: 'Sweet Shop' },
  { value: 'juice-shop',    label: 'Juice Shop' },
  { value: 'fast-food',     label: 'Fast Food' },
  { value: 'cloud-kitchen', label: 'Cloud Kitchen' },
  { value: 'food-court',    label: 'Food Court' },
  { value: 'mess',          label: 'Mess' },
  { value: 'catering',      label: 'Catering' },
  { value: 'veg',           label: 'Pure Veg' },
  { value: 'non-veg',       label: 'Non-Veg' },
  { value: 'both',          label: 'Veg & Non-Veg' },
];

const inputCls =
  'mt-1.5 block w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20';
const labelCls = 'block text-sm font-medium text-ink/70';

export function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    hotelName: '', ownerName: '', phone: '', email: '',
    businessType: '', state: '', city: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  function field(key: keyof typeof form) {
    return (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  // Accept pasted "+91 98765 43210" / "098765 43210": keep the 10-digit number.
  function onPhone(e: ChangeEvent<HTMLInputElement>) {
    let digits = e.target.value.replace(/\D/g, '');
    if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
    if (digits.length > 10 && digits.startsWith('0'))  digits = digits.slice(1);
    setForm(f => ({ ...f, phone: digits.slice(0, 10) }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.email.trim()) {
      setError('Email address is required.');
      return;
    }

    setLoading(true);
    try {
      await registerHotel({
        ...form,
        hotelName: form.hotelName.trim(), ownerName: form.ownerName.trim(),
        email: form.email.trim(), state: form.state.trim(), city: form.city.trim(),
      });
      navigate('/register/success', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Please try again after an hour.');
      } else {
        setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-mist px-4 py-6 sm:py-8">
      <div className="my-auto w-full max-w-md">

        <Link
          to="/login"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 transition hover:text-ink"
        >
          <ArrowLeft size={15} />
          Back to login
        </Link>

        {/* Compact header so the submit button stays on screen on a laptop */}
        <div className="mb-5 flex items-center gap-3 sm:flex-col sm:gap-0 sm:text-center">
          <img
            src="/branding/logo-64.png"
            alt="Dine POS"
            className="h-11 w-11 shrink-0 rounded-2xl object-contain shadow-md sm:mx-auto sm:mb-2.5 sm:h-12 sm:w-12"
          />
          <div>
            <h1 className="text-xl font-bold text-ink sm:text-2xl">Start Free Trial</h1>
            <p className="mt-0.5 text-sm text-ink/50">Register your business on Dine POS</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-canvas p-5 shadow-sm sm:p-7">
          <form onSubmit={handleSubmit} className="space-y-3.5">

            <div>
              <label htmlFor="hotelName" className={labelCls}>Business Name *</label>
              <input
                id="hotelName" type="text" required autoComplete="organization"
                value={form.hotelName} onChange={field('hotelName')}
                placeholder="e.g. Annapoorna Restaurant"
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="ownerName" className={labelCls}>Owner Name *</label>
              <input
                id="ownerName" type="text" required autoComplete="name"
                value={form.ownerName} onChange={field('ownerName')}
                placeholder="Full name"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
              <div>
                <label htmlFor="phone" className={labelCls}>Mobile Number *</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] -translate-y-1/2 text-sm text-ink/45">+91</span>
                  <input
                    id="phone" type="tel" required autoComplete="tel-national"
                    pattern="\d{10}" inputMode="numeric"
                    title="Enter your 10-digit mobile number"
                    value={form.phone} onChange={onPhone}
                    placeholder="10-digit number"
                    className={`${inputCls} pl-12`}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="email" className={labelCls}>Email *</label>
                <input
                  id="email" type="email" required autoComplete="email"
                  value={form.email} onChange={field('email')}
                  placeholder="you@example.com"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label htmlFor="businessType" className={labelCls}>Business Type *</label>
              {/* appearance-none + own chevron so it lines up with the text inputs;
                  grey until chosen, like the other fields' placeholders */}
              <div className="relative">
              <select
                id="businessType" required
                value={form.businessType} onChange={field('businessType')}
                className={`${inputCls} appearance-none pr-10 ${form.businessType ? '' : 'text-ink/40'}`}
              >
                <option value="" disabled>Select type…</option>
                {BUSINESS_TYPES.map(t => (
                  <option key={t.value} value={t.value} className="text-ink">{t.label}</option>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 mt-[3px] -translate-y-1/2 text-ink/40" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
              <div>
                <label htmlFor="state" className={labelCls}>State *</label>
                <input
                  id="state" type="text" required autoComplete="address-level1"
                  value={form.state} onChange={field('state')}
                  placeholder="e.g. Tamil Nadu"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="city" className={labelCls}>City *</label>
                <input
                  id="city" type="text" required autoComplete="address-level2"
                  value={form.city} onChange={field('city')}
                  placeholder="e.g. Coimbatore"
                  className={inputCls}
                />
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Spinner size="sm" />}
              {loading ? 'Submitting…' : 'Start Free Trial'}
            </button>
            <p className="text-center text-xs text-ink/45">
              We'll review your details and share your login within 24–48 hours.
            </p>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-ink/50">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link>
        </p>
        <p className="mt-2 text-center text-xs text-ink/40">
          Need help?{' '}
          <Link to="/support" className="font-medium text-brand hover:underline">Contact Support</Link>
        </p>
      </div>
    </div>
  );
}
