import { useState } from 'react';
import type { GuestInfo } from '../../types/qr.ts';

interface GuestNamePromptProps {
  requiresPhone: boolean;
  onSubmit:      (info: GuestInfo) => void;
}

export function GuestNamePrompt({ requiresPhone, onSubmit }: GuestNamePromptProps) {
  const [name, setName]   = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    if (requiresPhone && !phone.trim()) {
      setError('Please enter your phone number');
      return;
    }
    onSubmit({ name: name.trim(), phone: phone.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#FFF6EE] rounded-2xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold text-[#1C0800] mb-1">Almost there!</h2>
        <p className="text-sm text-[#1C0800]/60 mb-4">
          Just a few details before we place your order.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#1C0800]/60 mb-1">
              Your name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Arjun"
              className="w-full border border-[#E8D5C0] rounded-lg px-3 py-2 text-sm bg-white text-[#1C0800] focus:outline-none focus:ring-1 focus:ring-[#E8380D]"
            />
          </div>
          {requiresPhone && (
            <div>
              <label className="block text-xs font-medium text-[#1C0800]/60 mb-1">
                Phone number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(''); }}
                placeholder="e.g. 9876543210"
                className="w-full border border-[#E8D5C0] rounded-lg px-3 py-2 text-sm bg-white text-[#1C0800] focus:outline-none focus:ring-1 focus:ring-[#E8380D]"
              />
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full py-3 bg-[#E8380D] text-white rounded-xl font-semibold mt-2"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
