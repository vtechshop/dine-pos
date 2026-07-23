// M2 + M3 + M14 — Hotel Integration Status + Connection Management + SaaS Controls
// LIVE: hotel list + aggregator feature flag toggle (uses existing /superadmin/hotels/:id/features)
// REQUIRES BACKEND: per-hotel platform status, store IDs, webhook health, force-sync, reset, queue ops

import { useEffect, useState, useCallback } from 'react';
import {
  Search, RefreshCw, ToggleLeft, ToggleRight, Zap, RotateCcw, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  ApiRequired, SABadge, SAPageHeader, SASpin, SAError,
} from '../../components/ui/SAShared';
import { getHotels, type Hotel } from '../../api/superAdmin';
import {
  setHotelAggregatorFeature, forceHotelSync, resetHotelApi,
  clearHotelQueue, retryHotelQueue,
} from '../../api/saAggregator';

const CONNECTION_ENDPOINTS = [
  'GET  /superadmin/aggregator/hotels                 — per-hotel Swiggy/Zomato status, store IDs, last error',
  'POST /superadmin/aggregator/hotels/:id/platform    — enable/disable specific platform per hotel',
  'POST /superadmin/aggregator/hotels/:id/force-sync  — force menu sync',
  'POST /superadmin/aggregator/hotels/:id/reset-api   — rotate/reset API credentials',
  'POST /superadmin/aggregator/hotels/:id/clear-queue — clear retry queue',
  'POST /superadmin/aggregator/hotels/:id/retry-queue — retry queued failures',
];

function statusBadge(enabled: boolean) {
  return <SABadge label={enabled ? 'Enabled' : 'Disabled'} variant={enabled ? 'green' : 'gray'} />;
}

function ConfirmAction({
  label, message, onConfirm, variant = 'secondary',
}: { label: string; message: string; onConfirm: () => Promise<unknown>; variant?: 'secondary' | 'danger' }) {
  const [open,  setOpen]  = useState(false);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true); setError('');
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`text-xs px-2 py-1 rounded-lg border font-medium transition ${
          variant === 'danger'
            ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
            : 'border-border bg-canvas text-ink/70 hover:bg-mist'
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-80 rounded-xl bg-canvas border border-border shadow-xl p-5 space-y-3">
            <p className="font-bold text-ink">{message}</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm rounded-lg border border-border text-ink/60 hover:bg-mist">
                Cancel
              </button>
              <button
                onClick={() => void run()} disabled={busy}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-50 ${
                  variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-ink text-canvas hover:bg-ink/80'
                }`}
              >
                {busy ? <RefreshCw size={12} className="animate-spin inline" /> : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AggregatorHotelsPage() {
  const [hotels,    setHotels]    = useState<Hotel[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState<'all' | 'enabled' | 'disabled'>('all');
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [toggling,  setToggling]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getHotels({ page: 1 });
      setHotels(res.hotels);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load hotels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleFeature = async (hotel: Hotel) => {
    setToggling(hotel._id);
    try {
      await setHotelAggregatorFeature(hotel._id, !hotel.features.aggregator);
      setHotels(prev => prev.map(h =>
        h._id === hotel._id ? { ...h, features: { ...h.features, aggregator: !h.features.aggregator } } : h,
      ));
    } catch {
      // ignore — user will see no change
    } finally {
      setToggling(null);
    }
  };

  const visible = hotels.filter(h => {
    const matchSearch  = h.hotelName.toLowerCase().includes(search.toLowerCase()) ||
                         h.city.toLowerCase().includes(search.toLowerCase());
    const matchFilter  = filter === 'all' ? true :
                         filter === 'enabled' ? h.features.aggregator : !h.features.aggregator;
    return matchSearch && matchFilter;
  });

  const enabledCount  = hotels.filter(h => h.features.aggregator).length;
  const disabledCount = hotels.length - enabledCount;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Hotel Integrations"
        sub="Enable/disable aggregator per hotel · connection management · SaaS controls"
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {error && <SAError message={error} onRetry={() => void load()} />}

        {/* Banner for cross-hotel connection data */}
        <ApiRequired endpoints={CONNECTION_ENDPOINTS} />

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search hotel or city…"
              className="w-full rounded-lg border border-border bg-canvas pl-8 pr-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:border-brand/50"
            />
          </div>
          {(['all', 'enabled', 'disabled'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize border transition ${
                filter === f ? 'bg-brand/10 text-brand border-brand/20' : 'border-border text-ink/60 bg-canvas hover:bg-mist'
              }`}
            >
              {f} {f === 'all' ? `(${hotels.length})` : f === 'enabled' ? `(${enabledCount})` : `(${disabledCount})`}
            </button>
          ))}
        </div>

        {loading ? <SASpin /> : (
          <div className="space-y-2">
            {visible.map(hotel => (
              <div key={hotel._id} className="rounded-xl border border-border bg-canvas overflow-hidden">
                {/* Row header */}
                <div className="flex items-center gap-4 px-4 py-3">
                  {/* Toggle aggregator feature — LIVE action */}
                  <button
                    onClick={() => void toggleFeature(hotel)}
                    disabled={toggling === hotel._id}
                    className="shrink-0 text-ink/60 hover:text-brand transition disabled:opacity-50"
                    title={hotel.features.aggregator ? 'Disable aggregator for this hotel' : 'Enable aggregator for this hotel'}
                  >
                    {toggling === hotel._id
                      ? <RefreshCw size={18} className="animate-spin" />
                      : hotel.features.aggregator
                        ? <ToggleRight size={22} className="text-green-600" />
                        : <ToggleLeft  size={22} className="text-ink/30" />
                    }
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-ink truncate">{hotel.hotelName}</p>
                    <p className="text-xs text-ink/50">{hotel.city}, {hotel.state} · {hotel.subscriptionType}</p>
                  </div>

                  {statusBadge(hotel.features.aggregator)}
                  <SABadge
                    label={hotel.status}
                    variant={hotel.status === 'active' ? 'green' : hotel.status === 'trial' ? 'blue' : hotel.status === 'suspended' ? 'red' : 'gray'}
                  />

                  {/* Platform status placeholders */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink/30 bg-mist border border-border px-2 py-0.5 rounded font-mono">
                      Swiggy: API required
                    </span>
                    <span className="text-xs text-ink/30 bg-mist border border-border px-2 py-0.5 rounded font-mono">
                      Zomato: API required
                    </span>
                  </div>

                  <button
                    onClick={() => setExpanded(expanded === hotel._id ? null : hotel._id)}
                    className="shrink-0 text-ink/40 hover:text-ink"
                  >
                    {expanded === hotel._id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {/* Expanded actions */}
                {expanded === hotel._id && (
                  <div className="border-t border-border bg-mist/50 px-4 py-3 space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">Actions</p>

                    <div className="flex flex-wrap gap-2">
                      {/* Force sync — requires backend */}
                      <ConfirmAction
                        label="Force Sync (Swiggy)"
                        message={`Force menu sync for ${hotel.hotelName} on Swiggy?`}
                        onConfirm={() => forceHotelSync(hotel._id, 'swiggy')}
                      />
                      <ConfirmAction
                        label="Force Sync (Zomato)"
                        message={`Force menu sync for ${hotel.hotelName} on Zomato?`}
                        onConfirm={() => forceHotelSync(hotel._id, 'zomato')}
                      />
                      <ConfirmAction
                        label="Reset API (Swiggy)"
                        message={`Reset/rotate Swiggy API credentials for ${hotel.hotelName}? This will disconnect until new credentials are entered.`}
                        onConfirm={() => resetHotelApi(hotel._id, 'swiggy')}
                        variant="danger"
                      />
                      <ConfirmAction
                        label="Reset API (Zomato)"
                        message={`Reset/rotate Zomato API credentials for ${hotel.hotelName}?`}
                        onConfirm={() => resetHotelApi(hotel._id, 'zomato')}
                        variant="danger"
                      />
                      <ConfirmAction
                        label="Retry Queue"
                        message={`Retry all failed queue items for ${hotel.hotelName}?`}
                        onConfirm={() => retryHotelQueue(hotel._id)}
                      />
                      <ConfirmAction
                        label="Clear Queue"
                        message={`Clear the entire retry queue for ${hotel.hotelName}? Failed items will be discarded.`}
                        onConfirm={() => clearHotelQueue(hotel._id)}
                        variant="danger"
                      />
                    </div>

                    <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      All actions above require <span className="font-mono">/superadmin/aggregator/hotels/{hotel._id}/</span> endpoints.
                      They will return an error until the backend is implemented.
                    </p>

                    {/* Connection detail placeholders */}
                    <div className="grid grid-cols-2 gap-3">
                      {['Swiggy', 'Zomato'].map(p => (
                        <div key={p} className="rounded-lg border border-border bg-canvas p-3 space-y-1">
                          <p className="text-xs font-bold text-ink/70">{p}</p>
                          <div className="text-[11px] text-ink/40 space-y-0.5">
                            <p>Store ID: <span className="text-amber-600">API required</span></p>
                            <p>Webhook: <span className="text-amber-600">API required</span></p>
                            <p>Last Sync: <span className="text-amber-600">API required</span></p>
                            <p>Last Order: <span className="text-amber-600">API required</span></p>
                            <p>Last Error: <span className="text-amber-600">API required</span></p>
                          </div>
                          {/* Platform-level enable/disable — requires backend */}
                          <div className="flex gap-1 mt-2">
                            <button
                              className="text-[10px] px-2 py-0.5 rounded border border-green-200 bg-green-50 text-green-700 opacity-50 cursor-not-allowed"
                              disabled title="Requires POST /superadmin/aggregator/hotels/:id/platform"
                            >
                              <Zap size={10} className="inline" /> Enable
                            </button>
                            <button
                              className="text-[10px] px-2 py-0.5 rounded border border-border bg-canvas text-ink/50 opacity-50 cursor-not-allowed"
                              disabled title="Requires POST /superadmin/aggregator/hotels/:id/platform"
                            >
                              <RotateCcw size={10} className="inline" /> Disable
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {visible.length === 0 && (
              <div className="text-center py-12 text-sm text-ink/40">
                No hotels match your search.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

