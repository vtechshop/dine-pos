import { useState, type FormEvent, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await registerHotel(form);
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-mist px-4 py-10">
      <div className="w-full max-w-md">

        <div className="mb-8 text-center">
          <img
            src="/branding/logo-64.png"
            alt="Dine POS"
            className="mx-auto mb-3 h-14 w-14 rounded-2xl object-contain shadow-md"
          />
          <h1 className="text-2xl font-bold text-ink">Start Free Trial</h1>
          <p className="mt-1 text-sm text-ink/50">Register your business on Dine POS</p>
        </div>

        <div className="rounded-2xl border border-border bg-canvas p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <label htmlFor="hotelName" className={labelCls}>Business Name *</label>
              <input
                id="hotelName" type="text" required
                value={form.hotelName} onChange={field('hotelName')}
                placeholder="e.g. Annapoorna Restaurant"
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="ownerName" className={labelCls}>Owner Name *</label>
              <input
                id="ownerName" type="text" required
                value={form.ownerName} onChange={field('ownerName')}
                placeholder="Full name"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="phone" className={labelCls}>Mobile Number *</label>
                <input
                  id="phone" type="tel" required
                  maxLength={10} pattern="\d{10}" inputMode="numeric"
                  value={form.phone} onChange={field('phone')}
                  placeholder="10-digit number"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="email" className={labelCls}>Email</label>
                <input
                  id="email" type="email"
                  value={form.email} onChange={field('email')}
                  placeholder="Optional"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label htmlFor="businessType" className={labelCls}>Business Type *</label>
              <select
                id="businessType" required
                value={form.businessType} onChange={field('businessType')}
                className={inputCls}
              >
                <option value="">Select type…</option>
                {BUSINESS_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="state" className={labelCls}>State *</label>
                <input
                  id="state" type="text" required
                  value={form.state} onChange={field('state')}
                  placeholder="e.g. Tamil Nadu"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="city" className={labelCls}>City *</label>
                <input
                  id="city" type="text" required
                  value={form.city} onChange={field('city')}
                  placeholder="e.g. Coimbatore"
                  className={inputCls}
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Spinner size="sm" />}
              {loading ? 'Submitting…' : 'Start Free Trial'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink/50">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
