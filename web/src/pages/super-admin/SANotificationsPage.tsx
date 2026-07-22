import { useEffect, useState, type FormEvent } from 'react';
import { Bell, Plus, Search, Trash2, AlertCircle, RefreshCw, X } from 'lucide-react';
import { useSANotifications } from '../../context/SANotificationsContext';
import { type CreateNotificationPayload, type SANotification } from '../../api/superAdmin';
import { Spinner } from '../../components/ui/Spinner';

// ── helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Never expires';
  const d = new Date(expiresAt);
  if (d < new Date()) return 'Expired';
  return `Expires ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

// ── constants ──────────────────────────────────────────────────────────────────

const ALL_TYPES: SANotification['type'][] = [
  'info', 'warning', 'maintenance', 'update', 'success',
];

const TYPE_STYLES: Record<SANotification['type'], { badge: string; dot: string; label: string }> = {
  info:        { badge: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500',    label: 'Info'        },
  warning:     { badge: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500',   label: 'Warning'     },
  maintenance: { badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500',  label: 'Maintenance' },
  update:      { badge: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500',  label: 'Update'      },
  success:     { badge: 'bg-green-100 text-green-700',   dot: 'bg-green-500',   label: 'Success'     },
};

const EXPIRY_OPTIONS = [
  { label: 'Never',    value: ''   },
  { label: '1 day',   value: '1'  },
  { label: '3 days',  value: '3'  },
  { label: '7 days',  value: '7'  },
  { label: '30 days', value: '30' },
];

const inputCls =
  'w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink ' +
  'placeholder-ink/30 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

// ── SANotificationsPage ────────────────────────────────────────────────────────

export function SANotificationsPage() {
  const {
    notifications, loading, error,
    refresh, create, remove,
    markAllRead, isRead, hotelCount,
  } = useSANotifications();

  // Mark all as read whenever this page mounts
  useEffect(() => { markAllRead(); }, [markAllRead]);

  // ── create form ──────────────────────────────────────────────────────────────
  const [showCreate,  setShowCreate]  = useState(false);
  const [formTitle,   setFormTitle]   = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formType,    setFormType]    = useState<SANotification['type']>('info');
  const [formExpiry,  setFormExpiry]  = useState('');
  const [creating,    setCreating]    = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── filter / search ──────────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState<SANotification['type'] | ''>('');
  const [searchQ,    setSearchQ]    = useState('');

  // ── delete tracking ──────────────────────────────────────────────────────────
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  // ── derived ──────────────────────────────────────────────────────────────────
  const q = searchQ.toLowerCase();
  const filtered = notifications
    .filter(n => !filterType || n.type === filterType)
    .filter(n =>
      !q ||
      n.title.toLowerCase().includes(q) ||
      n.message.toLowerCase().includes(q),
    );

  // ── handlers ─────────────────────────────────────────────────────────────────

  function resetForm() {
    setFormTitle('');
    setFormMessage('');
    setFormType('info');
    setFormExpiry('');
    setCreateError(null);
    setShowCreate(false);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const title   = formTitle.trim();
    const message = formMessage.trim();
    if (!title || !message) {
      setCreateError('Title and message are required');
      return;
    }
    const payload: CreateNotificationPayload = {
      title,
      message,
      type: formType,
      ...(formExpiry ? { expiresInDays: Number(formExpiry) } : {}),
    };
    setCreating(true);
    setCreateError(null);
    try {
      await create(payload);
      resetForm();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(prev => new Set([...prev, id]));
    try {
      await remove(id);
    } catch {
      // Item stays in list; context will retry on next refresh
    } finally {
      setDeleting(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="space-y-5 p-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Bell size={18} className="text-brand" />
          <h1 className="text-xl font-bold text-ink">Notifications</h1>
          {!loading && (
            <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-medium text-ink/50">
              {notifications.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refresh()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-ink/60 transition hover:bg-mist"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
          <button
            onClick={() => { setShowCreate(v => !v); setCreateError(null); }}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-canvas transition hover:opacity-90"
          >
            <Plus size={14} />
            New Notification
          </button>
        </div>
      </div>

      {/* Fetch error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* ── Create form ── */}
      {showCreate && (
        <section className="rounded-xl border border-border bg-canvas p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">New Notification</h2>
            <button
              onClick={resetForm}
              className="rounded p-0.5 text-ink/40 hover:bg-mist hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>

          {createError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle size={13} />
              {createError}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="nTitle" className="mb-1.5 block text-sm font-medium text-ink">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="nTitle"
                type="text"
                placeholder="Notification title"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                disabled={creating}
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="nMessage" className="mb-1.5 block text-sm font-medium text-ink">
                Message <span className="text-red-500">*</span>
              </label>
              <textarea
                id="nMessage"
                rows={3}
                placeholder="Notification message"
                value={formMessage}
                onChange={e => setFormMessage(e.target.value)}
                disabled={creating}
                className={`${inputCls} resize-none`}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="nType" className="mb-1.5 block text-sm font-medium text-ink">
                  Type
                </label>
                <select
                  id="nType"
                  value={formType}
                  onChange={e => setFormType(e.target.value as SANotification['type'])}
                  disabled={creating}
                  className={inputCls}
                >
                  {ALL_TYPES.map(t => (
                    <option key={t} value={t}>{TYPE_STYLES[t].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="nExpiry" className="mb-1.5 block text-sm font-medium text-ink">
                  Expires in
                </label>
                <select
                  id="nExpiry"
                  value={formExpiry}
                  onChange={e => setFormExpiry(e.target.value)}
                  disabled={creating}
                  className={inputCls}
                >
                  {EXPIRY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-xs text-ink/40">
              {hotelCount !== null
                ? `Broadcast to all ${hotelCount} active hotels`
                : 'Broadcast to all hotels'}
            </p>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-canvas transition hover:opacity-90 disabled:opacity-50"
              >
                {creating ? 'Sending…' : 'Send Notification'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={creating}
                className="rounded-lg border border-border px-4 py-2 text-sm text-ink/60 transition hover:bg-mist disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ── Filters + Search ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Type filter pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilterType('')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filterType === ''
                ? 'bg-brand text-canvas'
                : 'bg-mist text-ink/60 hover:bg-ink/10'
            }`}
          >
            All
          </button>
          {ALL_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t === filterType ? '' : t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filterType === t
                  ? TYPE_STYLES[t].badge
                  : 'bg-mist text-ink/60 hover:bg-ink/10'
              }`}
            >
              {TYPE_STYLES[t].label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
          <input
            type="search"
            placeholder="Search notifications…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="w-52 rounded-lg border border-border bg-canvas py-1.5 pl-8 pr-8 text-sm text-ink placeholder-ink/30 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          {searchQ && (
            <button
              onClick={() => setSearchQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Notification list ── */}
      {loading && notifications.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-canvas py-16 text-center">
          <Bell size={32} className="mx-auto mb-3 text-ink/20" />
          <p className="text-sm font-medium text-ink/40">
            {searchQ || filterType
              ? 'No notifications match your filters'
              : 'No active notifications'}
          </p>
          {(searchQ || filterType) && (
            <button
              onClick={() => { setSearchQ(''); setFilterType(''); }}
              className="mt-2 text-xs text-brand hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(n => {
            const ts   = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
            const read = isRead(n._id);
            const isDel = deleting.has(n._id);
            return (
              <div
                key={n._id}
                className={`rounded-xl border p-4 transition ${
                  read ? 'border-border bg-canvas' : 'border-brand/20 bg-brand/5'
                } ${isDel ? 'pointer-events-none opacity-50' : ''}`}
              >
                <div className="flex items-start gap-3">
                  {/* Type dot */}
                  <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${ts.dot}`} />

                  <div className="min-w-0 flex-1">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ts.badge}`}>
                          {ts.label}
                        </span>
                        <p className="text-sm font-medium text-ink">{n.title}</p>
                        {!read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <span className="text-xs text-ink/40">{timeAgo(n.createdAt)}</span>
                        <button
                          onClick={() => handleDelete(n._id)}
                          disabled={isDel}
                          className="rounded-md p-1 text-ink/30 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed"
                          title="Delete notification"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Message */}
                    <p className="mt-1.5 line-clamp-2 text-sm text-ink/60">{n.message}</p>

                    {/* Meta */}
                    <p className="mt-1.5 text-[11px] text-ink/35">
                      {n.targetHotels.length === 0
                        ? 'Broadcast to all hotels'
                        : `${n.targetHotels.length} hotel${n.targetHotels.length > 1 ? 's' : ''} targeted`}
                      {' · '}
                      {fmtExpiry(n.expiresAt)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {!loading && (
        <p className="text-center text-[11px] text-ink/30">
          {filtered.length} of {notifications.length} active notifications shown
          {' · '}Read state is client-side only
        </p>
      )}

    </div>
  );
}
