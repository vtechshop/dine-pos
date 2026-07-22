import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, ChevronLeft } from 'lucide-react';
import { getHotels, type Hotel } from '../../api/superAdmin';
import { Spinner } from '../../components/ui/Spinner';

const STATUSES = ['all', 'pending', 'trial', 'active', 'suspended', 'rejected', 'expired'] as const;
type StatusTab = typeof STATUSES[number];

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  trial:     'bg-blue-50 text-blue-700 border-blue-200',
  active:    'bg-green-50 text-green-700 border-green-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  rejected:  'bg-gray-100 text-gray-600 border-gray-200',
  expired:   'bg-gray-100 text-gray-500 border-gray-200',
};

function trialDaysLeft(endDate: string | null): string {
  if (!endDate) return '';
  const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return 'Expired';
  return `${diff}d left`;
}

export function HotelsPage() {
  const [searchParams] = useSearchParams();
  const initialStatus  = searchParams.get('status');

  const [hotels,  setHotels]  = useState<Hotel[]>([]);
  const [total,   setTotal]   = useState(0);
  const [pages,   setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [tab,     setTab]     = useState<StatusTab>(() =>
    initialStatus && (STATUSES as readonly string[]).includes(initialStatus)
      ? (initialStatus as StatusTab)
      : 'all',
  );
  const [search,  setSearch]  = useState('');
  const [query,   setQuery]   = useState('');
  const [page,    setPage]    = useState(1);

  const load = useCallback(async (status: StatusTab, q: string, pg: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getHotels({ status: status === 'all' ? undefined : status, search: q || undefined, page: pg });
      setHotels(res.hotels);
      setTotal(res.total);
      setPages(res.pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load hotels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab, query, page); }, [load, tab, query, page]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  function handleTabChange(s: StatusTab) {
    setTab(s);
    setPage(1);
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Hotels</h1>
          <p className="mt-0.5 text-sm text-ink/50">{total} total</p>
        </div>
        <button
          onClick={() => load(tab, query, page)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink/60 transition hover:bg-mist"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, owner, or phone…"
            className="w-full rounded-lg border border-border bg-canvas py-2.5 pl-9 pr-4 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90"
        >
          Search
        </button>
        {query && (
          <button
            type="button"
            onClick={() => { setSearch(''); setQuery(''); setPage(1); }}
            className="rounded-lg border border-border px-3 py-2.5 text-sm text-ink/60 transition hover:bg-mist"
          >
            Clear
          </button>
        )}
      </form>

      {/* Status tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => handleTabChange(s)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
              tab === s
                ? 'bg-ink text-canvas'
                : 'border border-border bg-canvas text-ink/60 hover:bg-mist'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* List */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {!loading && !error && hotels.length === 0 && (
        <div className="py-16 text-center text-sm text-ink/40">
          No hotels found{query ? ` for "${query}"` : ''}.
        </div>
      )}

      {!loading && !error && hotels.length > 0 && (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-canvas">
            {hotels.map((hotel, i) => (
              <Link
                key={hotel._id}
                to={`/super-admin/hotels/${hotel._id}`}
                className={`flex items-center gap-4 px-5 py-4 transition hover:bg-mist ${
                  i < hotels.length - 1 ? 'border-b border-border' : ''
                }`}
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold uppercase text-brand">
                  {hotel.hotelName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{hotel.hotelName}</p>
                  <p className="truncate text-xs text-ink/50">{hotel.ownerName} · {hotel.phone}</p>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold capitalize ${STATUS_BADGE[hotel.status] ?? ''}`}>
                    {hotel.status}
                  </span>
                  {hotel.status === 'trial' && hotel.trialEndDate && (
                    <span className="text-[10px] text-ink/40">{trialDaysLeft(hotel.trialEndDate)}</span>
                  )}
                </div>
                <ChevronRight size={16} className="flex-shrink-0 text-ink/30" />
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-ink/40">
                Page {page} of {pages} · {total} hotels
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/60 transition hover:bg-mist disabled:opacity-40"
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/60 transition hover:bg-mist disabled:opacity-40"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
