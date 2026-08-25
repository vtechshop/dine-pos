import { useState, useEffect } from 'react';
import {
  getSaasStatus,
  getSaasInvoices,
  createSaasSubscription,
  cancelSaasSubscription,
  type SaasStatus,
  type SaasInvoice,
} from '../api/saasBilling';

export function SubscriptionPage() {
  const [status, setStatus]         = useState<SaasStatus | null>(null);
  const [invoices, setInvoices]     = useState<SaasInvoice[]>([]);
  const [loading, setLoading]       = useState(true);
  const [actionMsg, setActionMsg]   = useState('');
  const [actionErr, setActionErr]   = useState('');
  const [subscribing, setSubscribing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [s, inv] = await Promise.all([getSaasStatus(), getSaasInvoices(1, 10)]);
      setStatus(s);
      setInvoices(inv.invoices);
    } catch {
      setActionErr('Failed to load subscription information.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe() {
    setSubscribing(true);
    setActionErr('');
    try {
      const data = await createSaasSubscription();
      window.location.href = data.checkoutUrl;
    } catch (err: any) {
      setActionErr(err?.message ?? 'Could not start subscription. Please try again.');
      setSubscribing(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    setActionErr('');
    try {
      const res = await cancelSaasSubscription();
      setActionMsg(res.message);
      setShowCancel(false);
      await loadData();
    } catch (err: any) {
      setActionErr(err?.message ?? 'Could not cancel subscription. Please contact support.');
    } finally {
      setCancelling(false);
    }
  }

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const fmtAmount = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
      </div>
    );
  }

  const isActive       = status?.hasActiveSubscription;
  const isCancelled    = status?.rzpSubscriptionStatus === 'cancelled';
  const canSubscribe   = !isActive || isCancelled;
  const endDate        = fmt(status?.subscriptionEndDate ?? null);
  const nextBilling    = fmt(status?.rzpNextBillingAt ?? null);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Subscription</h1>

      {/* Status card */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              DinePOS SaaS Standard
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {fmtAmount(status?.annualPrice ?? 12000)}/year · Unlimited devices
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
            isActive && !isCancelled
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : isCancelled
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
          }`}>
            {isCancelled ? 'Cancelled' : isActive ? 'Active' : 'Not Subscribed'}
          </span>
        </div>

        {isActive && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-400 dark:text-gray-500">Valid until</p>
              <p className="font-medium text-gray-800 dark:text-gray-200">{endDate}</p>
            </div>
            {!isCancelled && (
              <div>
                <p className="text-gray-400 dark:text-gray-500">Next billing</p>
                <p className="font-medium text-gray-800 dark:text-gray-200">{nextBilling}</p>
              </div>
            )}
          </div>
        )}

        {/* Printer entitlement badge */}
        {status?.printerEntitlement.granted && (
          <div className={`mt-4 rounded-xl p-3 text-sm ${
            status.printerEntitlement.fulfilledAt
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
          }`}>
            {status.printerEntitlement.fulfilledAt
              ? `2 Bluetooth printers shipped on ${fmt(status.printerEntitlement.fulfilledAt)}`
              : '2 free Bluetooth printers — delivery being arranged by DinePOS team'}
          </div>
        )}
      </div>

      {/* Action messages */}
      {actionMsg && (
        <div className="rounded-xl bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          {actionMsg}
        </div>
      )}
      {actionErr && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {actionErr}
        </div>
      )}

      {/* Subscribe button */}
      {canSubscribe && (
        <button
          onClick={() => void handleSubscribe()}
          disabled={subscribing}
          className="w-full rounded-2xl bg-green-600 py-3.5 text-base font-bold text-white shadow transition hover:bg-green-700 active:scale-[0.98] disabled:opacity-60"
        >
          {subscribing ? 'Starting checkout…' : `Subscribe — ${fmtAmount(status?.annualPrice ?? 12000)}/year`}
        </button>
      )}

      {/* Cancel flow */}
      {isActive && !isCancelled && (
        <>
          {showCancel ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-700 dark:bg-red-900/20">
              <p className="mb-3 text-sm text-red-700 dark:text-red-400">
                Your subscription will remain active until <strong>{endDate}</strong>. After that, your account will expire. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleCancel()}
                  disabled={cancelling}
                  className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                >
                  {cancelling ? 'Cancelling…' : 'Yes, cancel subscription'}
                </button>
                <button
                  onClick={() => setShowCancel(false)}
                  className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
                >
                  Keep subscription
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCancel(true)}
              className="w-full rounded-2xl border border-gray-200 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel subscription
            </button>
          )}
        </>
      )}

      {/* Billing history */}
      {invoices.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">Billing History</h2>
          <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white shadow-sm dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
            {invoices.map(inv => (
              <div key={inv._id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {inv.isRenewal ? 'Renewal' : 'First Subscription'}
                  </p>
                  <p className="text-xs text-gray-400">{fmt(inv.startDate)} → {fmt(inv.endDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{fmtAmount(inv.amount)}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    inv.status === 'active'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  }`}>
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
