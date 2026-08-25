import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { createSaasSubscription } from '../api/saasBilling';

const SUPPORT_PHONE    = '+917871469095';
const SUPPORT_WHATSAPP = '917871469095';
const SUPPORT_EMAIL    = 'support@dinepos.in';

interface ExpiredInfo {
  code:             string;
  hotelName:        string;
  expiredOn:        string;
  subscriptionType: string;
}

function readExpiredInfo(): ExpiredInfo {
  try {
    const raw = sessionStorage.getItem('sub_expired_info');
    if (raw) return JSON.parse(raw) as ExpiredInfo;
  } catch { /* ignore */ }
  return { code: 'TRIAL_EXPIRED', hotelName: '', expiredOn: '', subscriptionType: 'trial' };
}

export function SubscriptionExpiredPage() {
  const navigate = useNavigate();
  const info = readExpiredInfo();
  const isTrial = !info.subscriptionType || info.subscriptionType === 'trial';

  const [checking, setChecking]       = useState(false);
  const [statusMsg, setStatusMsg]     = useState('');
  const [subscribing, setSubscribing] = useState(false);

  const expiredDate = info.expiredOn
    ? new Date(info.expiredOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

  const handleCheckStatus = async () => {
    setChecking(true);
    setStatusMsg('');
    try {
      const data = await apiFetch<{ isExpired: boolean; subscriptionStatus: string }>('/hotels/subscription');
      if (!data.isExpired) {
        sessionStorage.removeItem('sub_expired_info');
        navigate('/dashboard', { replace: true });
      } else {
        setStatusMsg('Still expired. Please contact support to renew.');
      }
    } catch {
      setStatusMsg('Could not connect. Check your internet connection.');
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_refresh_token');
    localStorage.removeItem('pos_role');
    sessionStorage.removeItem('sub_expired_info');
    window.location.replace('/login');
  };

  const handleSubscribeNow = async () => {
    setSubscribing(true);
    setStatusMsg('');
    try {
      const data = await createSaasSubscription();
      // Redirect to Razorpay hosted checkout
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setStatusMsg(err?.message ?? 'Could not start subscription. Please try again or contact support.');
      setSubscribing(false);
    }
  };

  const whatsappMsg = encodeURIComponent(
    `Hi Dine POS Support,\n\nMy ${isTrial ? 'trial' : 'subscription'} for *${info.hotelName || 'my hotel'}* has expired. Please help me renew.\n\nThank you.`
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg dark:bg-gray-800">

        {/* Icon */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg className="h-10 w-10 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-900 dark:text-white">
          {isTrial ? 'Trial Expired' : 'Subscription Expired'}
        </h1>
        {info.hotelName && (
          <p className="mb-1 text-center text-sm font-medium text-gray-500 dark:text-gray-400">
            {info.hotelName}
          </p>
        )}
        {expiredDate && (
          <p className="mb-6 text-center text-xs text-gray-400 dark:text-gray-500">
            Expired on {expiredDate}
          </p>
        )}

        <p className="mb-8 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {isTrial
            ? 'Your free trial has ended. Contact our support team to upgrade your plan and continue using Dine POS.'
            : 'Your subscription has expired. Contact our support team to renew and continue using Dine POS.'}
        </p>

        {/* Contact buttons */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <a
            href={`tel:${SUPPORT_PHONE}`}
            className="flex flex-col items-center gap-1 rounded-xl bg-blue-600 px-2 py-3 text-center text-xs font-semibold text-white transition hover:bg-blue-700 active:scale-95"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
            </svg>
            Call
          </a>
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${whatsappMsg}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1 rounded-xl bg-green-600 px-2 py-3 text-center text-xs font-semibold text-white transition hover:bg-green-700 active:scale-95"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            WhatsApp
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Renewal Request - ' + (info.hotelName || 'Hotel'))}`}
            className="flex flex-col items-center gap-1 rounded-xl bg-indigo-600 px-2 py-3 text-center text-xs font-semibold text-white transition hover:bg-indigo-700 active:scale-95"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            Email
          </a>
        </div>

        {/* Subscribe Now — starts Razorpay hosted checkout */}
        <button
          onClick={() => void handleSubscribeNow()}
          disabled={subscribing || checking}
          className="mb-3 w-full rounded-xl bg-green-600 py-3 text-sm font-bold text-white transition hover:bg-green-700 active:scale-95 disabled:opacity-60"
        >
          {subscribing ? 'Starting checkout…' : '⚡ Subscribe Now — ₹12,000/year'}
        </button>

        {/* Check status */}
        <button
          onClick={() => void handleCheckStatus()}
          disabled={checking}
          className="mb-3 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {checking ? 'Checking…' : 'Check Subscription Status'}
        </button>

        {statusMsg && (
          <p className="mb-3 text-center text-xs text-red-500 dark:text-red-400">{statusMsg}</p>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/50"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
