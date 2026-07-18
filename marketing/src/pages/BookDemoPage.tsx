import { useState } from 'react';
import { CheckCircle2, Clock, Monitor, Headphones } from 'lucide-react';
import { submitDemo } from '../api';

interface FormState {
  name: string;
  email: string;
  phone: string;
  restaurant: string;
  outlets: string;
  preferredDate: string;
  preferredTime: string;
  notes: string;
}

const BLANK: FormState = {
  name: '', email: '', phone: '', restaurant: '',
  outlets: '1', preferredDate: '', preferredTime: '', notes: '',
};

const TIME_SLOTS = [
  '10:00 AM', '11:00 AM', '12:00 PM',
  '2:00 PM',  '3:00 PM',  '4:00 PM',  '5:00 PM',
];

const PERKS = [
  { icon: Clock,      text: '30-minute live walkthrough' },
  { icon: Monitor,    text: 'See the real product, not slides' },
  { icon: Headphones, text: 'Ask anything — our team answers live' },
];

export function BookDemoPage() {
  const [form, setForm]           = useState<FormState>(BLANK);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]         = useState('');

  function set(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
      setError('Name, email and phone are required.');
      return;
    }
    setError('');
    try {
      await submitDemo({
        name:          form.name.trim(),
        email:         form.email.trim(),
        phone:         form.phone.trim(),
        restaurant:    form.restaurant.trim() || undefined,
        outlets:       form.outlets || undefined,
        preferredDate: form.preferredDate || undefined,
        preferredTime: form.preferredTime || undefined,
        notes:         form.notes.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    }
  }

  const field =
    'block w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none transition-colors focus:border-[#E8380D] focus:ring-2 focus:ring-[#E8380D]/10';

  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Book a free demo</h1>
        <p className="text-gray-400">
          See Dine POS live in 30 minutes. No sales pitch — just a real product demo.
        </p>
      </section>

      <section className="mx-auto grid max-w-5xl gap-10 px-5 py-16 md:grid-cols-2">
        {/* Left side info */}
        <div>
          <h2 className="mb-6 text-xl font-bold text-gray-900">What happens in the demo?</h2>
          <div className="mb-8 space-y-4">
            {PERKS.map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="flex items-center gap-4 rounded-xl border border-gray-100 bg-[#FFF6EE] p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                  <Icon size={18} className="text-[#E8380D]" />
                </div>
                <span className="text-sm font-medium text-gray-700">{text}</span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-orange-100 bg-orange-50 p-5">
            <h3 className="mb-3 font-semibold text-gray-900">We'll cover</h3>
            <ul className="space-y-2">
              {[
                'Order entry and billing flow',
                'Table and guest management',
                'Menu setup and categories',
                'Kitchen printing',
                'Reports and analytics',
                'Staff roles and access',
              ].map(item => (
                <li key={item} className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="text-[#E8380D]">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Form */}
        <div>
          <h2 className="mb-6 text-xl font-bold text-gray-900">Your details</h2>

          {submitted ? (
            <div className="flex flex-col items-center rounded-2xl border border-green-100 bg-green-50 px-6 py-14 text-center">
              <CheckCircle2 size={44} className="mb-4 text-green-500" />
              <h3 className="mb-2 text-lg font-bold text-gray-900">Demo booked!</h3>
              <p className="text-sm text-gray-500">
                We'll confirm your slot via email or WhatsApp within a few hours.
              </p>
              <button
                onClick={() => { setForm(BLANK); setSubmitted(false); }}
                className="mt-6 text-sm font-semibold text-[#E8380D] hover:underline"
              >
                Book another demo
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">
                    Your name *
                  </label>
                  <input
                    className={field}
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Rajesh Kumar"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">
                    Email *
                  </label>
                  <input
                    className={field}
                    type="email"
                    value={form.email}
                    onChange={e => set('email', e.target.value)}
                    placeholder="you@restaurant.com"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">
                    Phone / WhatsApp *
                  </label>
                  <input
                    className={field}
                    type="tel"
                    value={form.phone}
                    onChange={e => set('phone', e.target.value)}
                    placeholder="+91 98765 43210"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">
                    Restaurant name
                  </label>
                  <input
                    className={field}
                    value={form.restaurant}
                    onChange={e => set('restaurant', e.target.value)}
                    placeholder="Spice Garden"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">
                  Number of outlets
                </label>
                <select
                  className={field}
                  value={form.outlets}
                  onChange={e => set('outlets', e.target.value)}
                >
                  {['1', '2', '3', '4–6', '7+'].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">
                    Preferred date
                  </label>
                  <input
                    className={field}
                    type="date"
                    value={form.preferredDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={e => set('preferredDate', e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">
                    Preferred time (IST)
                  </label>
                  <select
                    className={field}
                    value={form.preferredTime}
                    onChange={e => set('preferredTime', e.target.value)}
                  >
                    <option value="">Any time</option>
                    {TIME_SLOTS.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">
                  Anything specific you want to see?
                </label>
                <textarea
                  className={`${field} h-24 resize-none`}
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="e.g. kitchen printing, loyalty program, inventory…"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-[#E8380D] px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#C93008]"
              >
                Book My Free Demo
              </button>
              <p className="text-center text-xs text-gray-400">
                We'll confirm via WhatsApp or email within a few hours.
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
