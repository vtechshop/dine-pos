import { useState } from 'react';
import { Mail, Phone, MapPin, CheckCircle2 } from 'lucide-react';

interface FormState {
  name: string;
  email: string;
  phone: string;
  restaurant: string;
  message: string;
}

const BLANK: FormState = { name: '', email: '', phone: '', restaurant: '', message: '' };

export function ContactPage() {
  const [form, setForm]       = useState<FormState>(BLANK);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]     = useState('');

  function set(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setError('Please fill in name, email, and message.');
      return;
    }
    // Static — no backend. Show success.
    setSubmitted(true);
  }

  const field =
    'block w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none transition-colors focus:border-[#E8380D] focus:ring-2 focus:ring-[#E8380D]/10';

  return (
    <div>
      {/* Hero */}
      <section className="bg-[#1C0800] px-5 py-20 text-center text-white">
        <h1 className="mb-3 text-4xl font-extrabold">Get in touch</h1>
        <p className="text-gray-400">
          Questions, feedback, or a demo request — we reply within one business day.
        </p>
      </section>

      <section className="mx-auto grid max-w-5xl gap-10 px-5 py-16 md:grid-cols-2">
        {/* Contact info */}
        <div>
          <h2 className="mb-6 text-xl font-bold text-gray-900">Contact details</h2>
          <div className="space-y-5">
            <div className="flex items-start gap-4 rounded-xl border border-gray-100 bg-[#FFF6EE] p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                <Mail size={18} className="text-[#E8380D]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-700">Email</div>
                <a
                  href="mailto:support@dinepos.com"
                  className="text-sm text-[#E8380D] hover:underline"
                >
                  support@dinepos.com
                </a>
                <div className="mt-0.5 text-xs text-gray-400">We reply within 24 hours</div>
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-xl border border-gray-100 bg-[#FFF6EE] p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                <Phone size={18} className="text-[#E8380D]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-700">Phone / WhatsApp</div>
                <a
                  href="tel:+919876543210"
                  className="text-sm text-[#E8380D] hover:underline"
                >
                  +91 98765 43210
                </a>
                <div className="mt-0.5 text-xs text-gray-400">Mon – Sat, 9 AM – 7 PM IST</div>
              </div>
            </div>

            <div className="flex items-start gap-4 rounded-xl border border-gray-100 bg-[#FFF6EE] p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                <MapPin size={18} className="text-[#E8380D]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-700">Office</div>
                <div className="text-sm text-gray-600">Chennai, Tamil Nadu, India</div>
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <div>
          <h2 className="mb-6 text-xl font-bold text-gray-900">Send us a message</h2>

          {submitted ? (
            <div className="flex flex-col items-center rounded-2xl border border-green-100 bg-green-50 px-6 py-12 text-center">
              <CheckCircle2 size={40} className="mb-4 text-green-500" />
              <h3 className="mb-2 font-bold text-gray-900">Message sent!</h3>
              <p className="text-sm text-gray-500">
                We'll get back to you within one business day.
              </p>
              <button
                onClick={() => { setForm(BLANK); setSubmitted(false); }}
                className="mt-6 text-sm font-semibold text-[#E8380D] hover:underline"
              >
                Send another message
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
                    Phone
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
                  Message *
                </label>
                <textarea
                  className={`${field} h-28 resize-none`}
                  value={form.message}
                  onChange={e => set('message', e.target.value)}
                  placeholder="Tell us how we can help…"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-[#E8380D] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C93008]"
              >
                Send Message
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
