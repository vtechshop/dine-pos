import { useEffect, useState, useCallback } from 'react';
import { saFetch } from '../../api/superAdmin';

interface HotelSaasRow {
  _id: string;
  hotelName: string;
  ownerName: string;
  phone: string;
  city: string;
  status: string;
  subscriptionType: string;
  subscriptionEndDate: string | null;
  saasAnnualPrice: number | null;
  rzpSubscriptionId: string;
  rzpSubscriptionStatus: string;
  rzpNextBillingAt: string | null;
  printerEntitlementGranted: boolean;
  printerEntitlementFulfilledAt: string | null;
  printerEntitlementSkipped: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  trial:     'bg-blue-100 text-blue-700',
  expired:   'bg-gray-100 text-gray-500',
  suspended: 'bg-red-100 text-red-700',
  pending:   'bg-amber-100 text-amber-700',
  rejected:  'bg-gray-100 text-gray-400',
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtAmount = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

type ActivePanel = { type: 'price'; hotel: HotelSaasRow } | { type: 'printer'; hotel: HotelSaasRow } | null;

export function SaasSubscriptionsPage() {
  const [hotels, setHotels]           = useState<HotelSaasRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<string>('all');
  const [page, setPage]               = useState(1);
  const [totalPages, setTotalPages]   = useState(1);
  const [panel, setPanel]             = useState<ActivePanel>(null);
  const [priceInput, setPriceInput]   = useState('');
  const [actionMsg, setActionMsg]     = useState('');
  const [actionErr, setActionErr]     = useState('');
  const [saving, setSaving]           = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (tab !== 'all') params.set('status', tab);
      const data = await saFetch<{ hotels: HotelSaasRow[]; pagination: any }>(`/saas/subscriptions?${params}`);
      setHotels(data.hotels);
      setTotalPages(data.pagination.pages || 1);
    } catch {
      setActionErr('Failed to load subscriptions.');
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => { void load(); }, [load]);

  function openPricePanel(hotel: HotelSaasRow) {
    setPanel({ type: 'price', hotel });
    setPriceInput(hotel.saasAnnualPrice ? String(hotel.saasAnnualPrice) : '');
    setActionMsg('');
    setActionErr('');
  }

  function openPrinterPanel(hotel: HotelSaasRow) {
    setPanel({ type: 'printer', hotel });
    setActionMsg('');
    setActionErr('');
  }

  async function savePrice() {
    if (!panel || panel.type !== 'price') return;
    setSaving(true);
    setActionErr('');
    try {
      const price = priceInput.trim() === '' ? null : Number(priceInput);
      await saFetch(`/hotels/${panel.hotel._id}/saas-price`, {
        method: 'PUT',
        body: JSON.stringify({ price }),
      });
      setActionMsg(price === null
        ? 'Custom price cleared — hotel reverts to ₹12,000/year from next renewal.'
        : `Custom price ₹${price}/year set. Effective from next renewal.`);
      setPanel(null);
      await load();
    } catch (err: any) {
      setActionErr(err?.message ?? 'Failed to save price.');
    } finally {
      setSaving(false);
    }
  }

  async function savePrinterAction(action: 'fulfilled' | 'skipped') {
    if (!panel || panel.type !== 'printer') return;
    setSaving(true);
    setActionErr('');
    try {
      await saFetch(`/hotels/${panel.hotel._id}/printer-entitlement`, {
        method: 'PUT',
        body: JSON.stringify({ action }),
      });
      setActionMsg(action === 'fulfilled' ? 'Printers marked as shipped.' : 'Marked as not applicable.');
      setPanel(null);
      await load();
    } catch (err: any) {
      setActionErr(err?.message ?? 'Failed to update printer status.');
    } finally {
      setSaving(false);
    }
  }

  const TABS = ['all', 'active', 'trial', 'expired', 'suspended'];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">SaaS Subscriptions</h1>
        <button onClick={() => void load()} className="rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300">
          Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === t
                ? 'bg-brand text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Messages */}
      {actionMsg && <div className="rounded-xl bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">{actionMsg}</div>}
      {actionErr && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{actionErr}</div>}

      {/* Panel overlay */}
      {panel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            {panel.type === 'price' && (
              <>
                <h2 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">Set Custom Price</h2>
                <p className="mb-4 text-sm text-gray-500">{panel.hotel.hotelName}</p>
                <p className="mb-1 text-xs text-gray-400">Annual price in INR (blank = standard ₹12,000)</p>
                <input
                  type="number"
                  value={priceInput}
                  onChange={e => setPriceInput(e.target.value)}
                  placeholder="e.g. 8000"
                  className="mb-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void savePrice()}
                    disabled={saving}
                    className="flex-1 rounded-xl bg-brand py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setPanel(null)} className="flex-1 rounded-xl border py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">
                    Cancel
                  </button>
                </div>
              </>
            )}
            {panel.type === 'printer' && (
              <>
                <h2 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">Printer Entitlement</h2>
                <p className="mb-4 text-sm text-gray-500">{panel.hotel.hotelName}</p>
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                  This hotel is entitled to 2 free Bluetooth thermal printers. Update fulfillment status:
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => void savePrinterAction('fulfilled')}
                    disabled={saving}
                    className="rounded-xl bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                  >
                    {saving ? '…' : '✅ Mark printers as shipped'}
                  </button>
                  <button
                    onClick={() => void savePrinterAction('skipped')}
                    disabled={saving}
                    className="rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
                  >
                    Mark as not applicable
                  </button>
                  <button onClick={() => setPanel(null)} className="py-2 text-xs text-gray-400 hover:text-gray-600">
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand border-t-transparent" />
        </div>
      ) : hotels.length === 0 ? (
        <p className="py-12 text-center text-gray-400">No hotels found.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400 dark:border-gray-700">
                <th className="px-4 py-3 font-medium">Hotel</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">RZP Status</th>
                <th className="px-4 py-3 font-medium">Price/yr</th>
                <th className="px-4 py-3 font-medium">Valid Until</th>
                <th className="px-4 py-3 font-medium">Printer</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {hotels.map(h => (
                <tr key={h._id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-white">{h.hotelName}</p>
                    <p className="text-xs text-gray-400">{h.city} · {h.phone}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[h.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {h.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{h.rzpSubscriptionStatus || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
                    {fmtAmount(h.saasAnnualPrice ?? 12000)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmt(h.subscriptionEndDate)}</td>
                  <td className="px-4 py-3">
                    {h.printerEntitlementGranted ? (
                      h.printerEntitlementSkipped ? (
                        <span className="text-xs text-gray-400">N/A</span>
                      ) : h.printerEntitlementFulfilledAt ? (
                        <span className="text-xs text-green-600">Shipped {fmt(h.printerEntitlementFulfilledAt)}</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Pending</span>
                      )
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => openPricePanel(h)}
                        className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
                      >
                        Price
                      </button>
                      {h.printerEntitlementGranted && !h.printerEntitlementFulfilledAt && !h.printerEntitlementSkipped && (
                        <button
                          onClick={() => openPrinterPanel(h)}
                          className="rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-700 hover:bg-amber-200"
                        >
                          Printer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
