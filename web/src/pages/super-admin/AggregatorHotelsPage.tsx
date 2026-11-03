// Hotel Integrations — per-hotel Swiggy/Zomato connection status (read-only)
// plus the per-hotel aggregator on/off switch (PUT /superadmin/hotels/:id/features).
// Platform actions (enable/disable a platform, force sync, reset API, queue ops)
// need live partner API access and are not available in this release.

import { useEffect, useState, useCallback } from 'react';
import {
  Search, RefreshCw, ToggleLeft, ToggleRight, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  SABadge, SAPageHeader, SASpin, SAError, fmtAgo,
} from '../../components/ui/SAShared';
import {
  getHotelAggStatuses, setHotelAggregatorFeature,
  type HotelAggStatus, type AggConnStatus,
} from '../../api/saAggregator';

type PlatformInfo = NonNullable<HotelAggStatus['swiggy']>;

const CONN_LABEL: Record<AggConnStatus, string> = {
  connected:    'Connected',
  disconnected: 'Not connected',
  error:        'Error',
  pending:      'Waiting',
  disabled:     'Off',
};

const CONN_VARIANT: Record<AggConnStatus, Parameters<typeof SABadge>[0]['variant']> = {
  connected:    'green',
  disconnected: 'gray',
  error:        'red',
  pending:      'amber',
  disabled:     'gray',
};

function platformChip(name: string, info: PlatformInfo | null) {
  const status: AggConnStatus = info?.status ?? 'disconnected';
  return <SABadge label={`${name}: ${CONN_LABEL[status] ?? status}`} variant={CONN_VARIANT[status] ?? 'gray'} />;
}

function yesNo(ok: boolean) {
  return ok
    ? <span className="text-green-700">OK</span>
    : <span className="text-red-600">Not working</span>;
}

function PlatformDetail({ name, info }: { name: string; info: PlatformInfo | null }) {
  return (
    <div className="rounded-lg border border-border bg-canvas p-3 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink/70">{name}</p>
        {platformChip(name, info)}
      </div>
      {info ? (
        <div className="text-[11px] text-ink/50 space-y-0.5">
          <p>Store ID: <span className="font-mono text-ink/70">{info.storeId || '—'}</span></p>
          <p>Receiving orders: {yesNo(info.webhookOk)}</p>
          <p>Platform link: {yesNo(info.apiOk)}</p>
          <p>Last menu sync: <span className="text-ink/70">{fmtAgo(info.lastSync)}</span></p>
          <p>Last order: <span className="text-ink/70">{fmtAgo(info.lastOrder)}</span></p>
          <p>Orders so far: <span className="text-ink/70">{info.orderCount}</span></p>
          {info.lastError && (
            <p>Last problem: <span className="text-red-600">{info.lastError}</span></p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-ink/40">Not set up for this hotel.</p>
      )}
    </div>
  );
}

export function AggregatorHotelsPage() {
  const [hotels,    setHotels]    = useState<HotelAggStatus[]>([]);
  const [total,     setTotal]     = useState(0);
  const [page,      setPage]      = useState(1);
  const [loading,   setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,     setError]     = useState('');
  const [toggleErr, setToggleErr] = useState('');
  const [search,    setSearch]    = useState('');
  const [filter,    setFilter]    = useState<'all' | 'enabled' | 'disabled'>('all');
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [toggling,  setToggling]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await getHotelAggStatuses({ page: 1 });
      setHotels(res.hotels);
      setTotal(res.total);
      setPage(1);
    } catch {
      setError("Couldn't load hotels. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res  = await getHotelAggStatuses({ page: next });
      setHotels(prev => {
        const seen = new Set(prev.map(h => h.hotelId));
        return [...prev, ...res.hotels.filter(h => !seen.has(h.hotelId))];
      });
      setTotal(res.total);
      setPage(next);
    } catch {
      setError("Couldn't load more hotels. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleFeature = async (hotel: HotelAggStatus) => {
    setToggling(hotel.hotelId); setToggleErr('');
    try {
      await setHotelAggregatorFeature(hotel.hotelId, !hotel.featureEnabled);
      setHotels(prev => prev.map(h =>
        h.hotelId === hotel.hotelId ? { ...h, featureEnabled: !h.featureEnabled } : h,
      ));
    } catch {
      setToggleErr(`Couldn't change Swiggy/Zomato for ${hotel.hotelName}. Please try again.`);
    } finally {
      setToggling(null);
    }
  };

  const q = search.toLowerCase();
  const visible = hotels.filter(h => {
    const matchSearch  = h.hotelName.toLowerCase().includes(q) || (h.city ?? '').toLowerCase().includes(q);
    const matchFilter  = filter === 'all' ? true :
                         filter === 'enabled' ? h.featureEnabled : !h.featureEnabled;
    return matchSearch && matchFilter;
  });

  const enabledCount  = hotels.filter(h => h.featureEnabled).length;
  const disabledCount = hotels.length - enabledCount;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Hotel Integrations"
        sub="Swiggy & Zomato connection status for each hotel"
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {toggleErr && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{toggleErr}</p>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search hotel or city…"
              className="search-input w-full pl-8 pr-3 py-2 text-sm"
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
              {f === 'all' ? 'All' : f === 'enabled' ? 'On' : 'Off'}{' '}
              {f === 'all' ? `(${hotels.length})` : f === 'enabled' ? `(${enabledCount})` : `(${disabledCount})`}
            </button>
          ))}
        </div>

        {loading ? <SASpin /> : error && hotels.length === 0 ? (
          <SAError message={error} onRetry={() => void load()} />
        ) : (
          <div className="space-y-2">
            {visible.map(hotel => (
              <div key={hotel.hotelId} className="rounded-xl border border-border bg-canvas overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3">
                  {/* Swiggy/Zomato on/off for this hotel */}
                  <button
                    onClick={() => void toggleFeature(hotel)}
                    disabled={toggling === hotel.hotelId}
                    className="shrink-0 text-ink/60 hover:text-brand transition disabled:opacity-50"
                    title={hotel.featureEnabled ? 'Turn off Swiggy/Zomato for this hotel' : 'Turn on Swiggy/Zomato for this hotel'}
                  >
                    {toggling === hotel.hotelId
                      ? <RefreshCw size={18} className="animate-spin" />
                      : hotel.featureEnabled
                        ? <ToggleRight size={22} className="text-green-600" />
                        : <ToggleLeft  size={22} className="text-ink/30" />
                    }
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-ink truncate">{hotel.hotelName}</p>
                    <p className="text-xs text-ink/50">
                      {[hotel.city, hotel.state].filter(Boolean).join(', ') || '—'}
                      {hotel.plan ? ` · ${hotel.plan}` : ''}
                    </p>
                  </div>

                  <SABadge label={hotel.featureEnabled ? 'On' : 'Off'} variant={hotel.featureEnabled ? 'green' : 'gray'} />

                  <div className="flex items-center gap-2">
                    {platformChip('Swiggy', hotel.swiggy)}
                    {platformChip('Zomato', hotel.zomato)}
                  </div>

                  <button
                    onClick={() => setExpanded(expanded === hotel.hotelId ? null : hotel.hotelId)}
                    className="shrink-0 text-ink/40 hover:text-ink"
                    title="Show details"
                  >
                    {expanded === hotel.hotelId ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {expanded === hotel.hotelId && (
                  <div className="border-t border-border bg-mist/50 px-4 py-3">
                    <div className="grid grid-cols-2 gap-3">
                      <PlatformDetail name="Swiggy" info={hotel.swiggy} />
                      <PlatformDetail name="Zomato" info={hotel.zomato} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {visible.length === 0 && (
              <div className="text-center py-12 text-sm text-ink/40">
                {hotels.length === 0 ? 'No hotels yet.' : 'No hotels match your search.'}
              </div>
            )}

            {hotels.length < total && (
              <div className="flex flex-col items-center gap-2 pt-2">
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-4 py-2 text-sm font-medium text-ink/70 hover:bg-mist disabled:opacity-50"
                >
                  {loadingMore && <RefreshCw size={14} className="animate-spin" />}
                  Show more ({hotels.length} of {total})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
