import { useEffect, useMemo, useState, type ElementType } from 'react';
import {
  Megaphone, Wrench, Star, AlertTriangle, Bell,
  RefreshCw, Check, AlertCircle, Trash2, TrendingUp,
} from 'lucide-react';
import {
  getRemoteConfig,
  updateRemoteConfig,
  type RemoteConfig,
  type SANotification,
} from '../../api/superAdmin';
import { useSANotifications } from '../../context/SANotificationsContext';

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

interface Template {
  key:            string;
  label:          string;
  type:           SANotification['type'];
  icon:           ElementType;
  suggestTitle:   string;
  suggestMessage: string;
  defaultExpiry:  string;
}

const TEMPLATES: Template[] = [
  {
    key: 'maintenance', label: 'Maintenance', type: 'maintenance',
    icon: Wrench,
    suggestTitle:   'Scheduled Maintenance',
    suggestMessage: 'We will be performing scheduled maintenance. Service may be briefly interrupted.',
    defaultExpiry:  '1',
  },
  {
    key: 'festival', label: 'Festival', type: 'success',
    icon: Star,
    suggestTitle:   'Festival Greetings',
    suggestMessage: 'Wishing you a wonderful festival season! Special offers are now active on the platform.',
    defaultExpiry:  '7',
  },
  {
    key: 'promotion', label: 'Promotion', type: 'info',
    icon: Megaphone,
    suggestTitle:   'Special Promotion',
    suggestMessage: 'A special promotion is now live. Check your dashboard for details.',
    defaultExpiry:  '3',
  },
  {
    key: 'emergency', label: 'Emergency', type: 'warning',
    icon: AlertTriangle,
    suggestTitle:   'Urgent Notice',
    suggestMessage: 'This is an urgent notice requiring your immediate attention.',
    defaultExpiry:  '',
  },
  {
    key: 'update', label: 'Update', type: 'update',
    icon: RefreshCw,
    suggestTitle:   'Platform Update',
    suggestMessage: 'A platform update has been released. Please update your app for the best experience.',
    defaultExpiry:  '7',
  },
  {
    key: 'general', label: 'General', type: 'info',
    icon: Bell,
    suggestTitle:   '',
    suggestMessage: '',
    defaultExpiry:  '',
  },
];

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

// ── shared styles ──────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink ' +
  'placeholder-ink/30 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

// ── sub-components ─────────────────────────────────────────────────────────────

function Toggle({
  checked, onChange, disabled,
}: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent
        transition-colors duration-200 focus:outline-none focus-visible:ring-2
        focus-visible:ring-brand focus-visible:ring-offset-2
        ${checked ? 'bg-brand' : 'bg-ink/20'}
        ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-canvas
          shadow transition duration-200 ease-in-out
          ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

function NotificationPreview({
  title, message, type,
}: {
  title: string; message: string; type: SANotification['type'];
}) {
  const ts      = TYPE_STYLES[type];
  const isEmpty = !title && !message;
  return (
    <div className={`rounded-xl border p-4 transition ${
      isEmpty ? 'border-dashed border-border' : 'border-border'
    } bg-canvas`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${ts.dot} ${isEmpty ? 'opacity-30' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ts.badge}`}>
              {ts.label}
            </span>
            <p className={`text-sm font-medium ${title ? 'text-ink' : 'text-ink/25'}`}>
              {title || 'Notification title'}
            </p>
          </div>
          <p className={`mt-1 text-xs ${message ? 'text-ink/60' : 'text-ink/25'}`}>
            {message || 'Notification message will appear here'}
          </p>
          <p className="mt-1.5 text-[11px] text-ink/35">
            Broadcast to all hotels · Just now
          </p>
        </div>
      </div>
    </div>
  );
}

// ── BroadcastCenterPage ────────────────────────────────────────────────────────

export function BroadcastCenterPage() {
  const {
    notifications, loading: nLoading,
    create, remove, hotelCount,
  } = useSANotifications();

  // ── remote-config state ──────────────────────────────────────────────────────
  const [config,       setConfig]       = useState<RemoteConfig | null>(null);
  const [cfgLoading,   setCfgLoading]   = useState(true);
  const [cfgError,     setCfgError]     = useState<string | null>(null);
  const [maintMode,    setMaintMode]    = useState(false);
  const [maintMsg,     setMaintMsg]     = useState('');
  const [savingMaint,  setSavingMaint]  = useState(false);
  const [maintSavedAt, setMaintSavedAt] = useState<number | null>(null);
  const [maintSaveErr, setMaintSaveErr] = useState<string | null>(null);

  // ── composer state ───────────────────────────────────────────────────────────
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [bTitle,   setBTitle]   = useState('');
  const [bMessage, setBMessage] = useState('');
  const [bType,    setBType]    = useState<SANotification['type']>('info');
  const [bExpiry,  setBExpiry]  = useState('');
  const [sending,  setSending]  = useState(false);
  const [sendErr,  setSendErr]  = useState<string | null>(null);
  const [sentAt,   setSentAt]   = useState<number | null>(null);

  // ── history filter ───────────────────────────────────────────────────────────
  const [histFilter,    setHistFilter]    = useState<SANotification['type'] | ''>('');
  const [deleting,      setDeleting]      = useState<Set<string>>(new Set());
  const [expiringSoon,  setExpiringSoon]  = useState(0);

  // ── load remote-config ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [cfgRes] = await Promise.allSettled([getRemoteConfig()]);
      if (cancelled) return;
      if (cfgRes.status === 'fulfilled') {
        const c = cfgRes.value;
        setConfig(c);
        setMaintMode(c.maintenanceMode);
        setMaintMsg(c.maintenanceMessage);
        setCfgError(null);
      } else {
        setCfgError('Failed to load configuration');
      }
      setCfgLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Compute expiring-soon count outside render (Date.now() is impure in useMemo)
  useEffect(() => {
    const THREE_DAYS_MS = 3 * 86_400_000;
    const now = Date.now();
    setExpiringSoon(
      notifications.filter(n => {
        if (!n.expiresAt) return false;
        const diff = new Date(n.expiresAt).getTime() - now;
        return diff > 0 && diff < THREE_DAYS_MS;
      }).length,
    );
  }, [notifications]);

  // Auto-dismiss success banners
  useEffect(() => {
    if (!maintSavedAt) return;
    const t = setTimeout(() => setMaintSavedAt(null), 3_500);
    return () => clearTimeout(t);
  }, [maintSavedAt]);

  useEffect(() => {
    if (!sentAt) return;
    const t = setTimeout(() => setSentAt(null), 4_000);
    return () => clearTimeout(t);
  }, [sentAt]);

  // ── derived ──────────────────────────────────────────────────────────────────
  const maintDirty = config !== null && (
    maintMode !== config.maintenanceMode ||
    maintMsg  !== config.maintenanceMessage
  );

  const stats = useMemo(() => {
    const total = notifications.length;
    const byType = ALL_TYPES.reduce((acc, t) => {
      acc[t] = notifications.filter(n => n.type === t).length;
      return acc;
    }, {} as Record<SANotification['type'], number>);
    return { total, byType };
  }, [notifications]);

  const history = useMemo(
    () => notifications.filter(n => !histFilter || n.type === histFilter).slice(0, 20),
    [notifications, histFilter],
  );

  // ── handlers ─────────────────────────────────────────────────────────────────

  function applyTemplate(tpl: Template) {
    setActiveTemplate(tpl.key);
    setBTitle(tpl.suggestTitle);
    setBMessage(tpl.suggestMessage);
    setBType(tpl.type);
    setBExpiry(tpl.defaultExpiry);
    setSendErr(null);
  }

  async function handleMaintSave() {
    setSavingMaint(true);
    setMaintSaveErr(null);
    try {
      const res = await updateRemoteConfig({
        maintenanceMode:    maintMode,
        maintenanceMessage: maintMsg,
      });
      setConfig(res.config);
      setMaintSavedAt(Date.now());
    } catch (e) {
      setMaintSaveErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingMaint(false);
    }
  }

  async function handleSend() {
    const title   = bTitle.trim();
    const message = bMessage.trim();
    if (!title || !message) { setSendErr('Title and message are required'); return; }
    setSending(true);
    setSendErr(null);
    try {
      await create({
        title,
        message,
        type: bType,
        ...(bExpiry ? { expiresInDays: Number(bExpiry) } : {}),
      });
      setBTitle('');
      setBMessage('');
      setBExpiry('');
      setActiveTemplate(null);
      setSentAt(Date.now());
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Failed to send broadcast');
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(prev => new Set([...prev, id]));
    try {
      await remove(id);
    } catch {
      // Item stays in list; context refreshes on next poll
    } finally {
      setDeleting(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Megaphone size={18} className="text-brand" />
            <h1 className="text-xl font-bold text-ink">Broadcast Center</h1>
          </div>
          <p className="mt-1 text-sm text-ink/40">
            Compose and send platform-wide messages to all hotels
          </p>
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-5">
          <div className="text-center">
            <p className="text-xl font-bold tabular-nums text-ink">
              {nLoading ? '—' : stats.total}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-ink/40">Active</p>
          </div>
          <div className={`text-center ${maintMode ? 'text-orange-600' : 'text-green-600'}`}>
            <p className="text-xl font-bold">{cfgLoading ? '—' : maintMode ? 'ON' : 'OFF'}</p>
            <p className="text-[10px] uppercase tracking-wide text-ink/40">Maintenance</p>
          </div>
          {expiringSoon > 0 && (
            <div className="text-center text-amber-600">
              <p className="text-xl font-bold tabular-nums">{expiringSoon}</p>
              <p className="text-[10px] uppercase tracking-wide text-ink/40">Expiring</p>
            </div>
          )}
        </div>
      </div>

      {/* ── 1. Maintenance Control ── */}
      <section className={`rounded-xl border p-5 transition ${
        maintMode ? 'border-orange-200 bg-orange-50' : 'border-border bg-canvas'
      }`}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Wrench size={15} className={maintMode ? 'text-orange-600' : 'text-ink/40'} />
            <h2 className="text-sm font-semibold text-ink">Maintenance Mode</h2>
            {!cfgLoading && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                maintMode
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-green-100 text-green-700'
              }`}>
                {maintMode ? 'ACTIVE' : 'OPERATIONAL'}
              </span>
            )}
          </div>
          {cfgLoading ? (
            <div className="h-6 w-11 animate-pulse rounded-full bg-mist" />
          ) : (
            <Toggle
              checked={maintMode}
              onChange={v => { setMaintMode(v); setMaintSaveErr(null); }}
              disabled={savingMaint || !!cfgError}
            />
          )}
        </div>

        {cfgError ? (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle size={13} />
            {cfgError}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-ink/50">
                Message shown to hotels during maintenance
              </label>
              <input
                type="text"
                value={maintMsg}
                onChange={e => { setMaintMsg(e.target.value); setMaintSaveErr(null); }}
                disabled={cfgLoading || savingMaint}
                placeholder="e.g. We'll be back shortly. Thank you for your patience."
                className={inputCls}
              />
            </div>

            {maintSaveErr && (
              <p className="mt-2 text-xs text-red-600">{maintSaveErr}</p>
            )}

            {(maintDirty || maintSavedAt) && (
              <div className="mt-3 flex items-center gap-3">
                {maintDirty && (
                  <button
                    onClick={handleMaintSave}
                    disabled={savingMaint}
                    className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
                  >
                    {savingMaint ? 'Applying…' : 'Apply Changes'}
                  </button>
                )}
                {maintSavedAt && !maintDirty && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <Check size={12} />
                    Changes applied
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── 2. Broadcast Composer + Live Preview ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* Composer */}
        <section className="rounded-xl border border-border bg-canvas p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">New Broadcast</h2>

          {/* Template picker */}
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium text-ink/40">Templates</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map(tpl => {
                const Icon = tpl.icon;
                return (
                  <button
                    key={tpl.key}
                    onClick={() => applyTemplate(tpl)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                      activeTemplate === tpl.key
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-border text-ink/60 hover:border-brand/30 hover:text-ink'
                    }`}
                  >
                    <Icon size={11} />
                    {tpl.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Success banner */}
          {sentAt && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
              <Check size={13} />
              Broadcast sent successfully to all hotels
            </div>
          )}

          {/* Error banner */}
          {sendErr && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle size={13} />
              {sendErr}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="bTitle" className="mb-1.5 block text-xs font-medium text-ink/50">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="bTitle"
                type="text"
                placeholder="Notification title"
                value={bTitle}
                onChange={e => { setBTitle(e.target.value); setSendErr(null); }}
                disabled={sending}
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="bMessage" className="mb-1.5 block text-xs font-medium text-ink/50">
                Message <span className="text-red-500">*</span>
              </label>
              <textarea
                id="bMessage"
                rows={4}
                placeholder="Notification message…"
                value={bMessage}
                onChange={e => { setBMessage(e.target.value); setSendErr(null); }}
                disabled={sending}
                className={`${inputCls} resize-none`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="bType" className="mb-1.5 block text-xs font-medium text-ink/50">
                  Type
                </label>
                <select
                  id="bType"
                  value={bType}
                  onChange={e => setBType(e.target.value as SANotification['type'])}
                  disabled={sending}
                  className={inputCls}
                >
                  {ALL_TYPES.map(t => (
                    <option key={t} value={t}>{TYPE_STYLES[t].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="bExpiry" className="mb-1.5 block text-xs font-medium text-ink/50">
                  Expires in
                </label>
                <select
                  id="bExpiry"
                  value={bExpiry}
                  onChange={e => setBExpiry(e.target.value)}
                  disabled={sending}
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
                ? `Broadcast to ${hotelCount} active hotels`
                : 'Broadcast to all hotels'}
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-canvas hover:opacity-90 disabled:opacity-50"
              >
                <Megaphone size={14} />
                {sending ? 'Sending…' : 'Send Broadcast'}
              </button>
              {(bTitle || bMessage) && !sending && (
                <button
                  onClick={() => {
                    setBTitle('');
                    setBMessage('');
                    setBExpiry('');
                    setActiveTemplate(null);
                    setSendErr(null);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-ink/60 hover:bg-mist"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Live Preview */}
        <section className="rounded-xl border border-border bg-mist/30 p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Live Preview</h2>
          <p className="mb-4 text-xs text-ink/40">How hotels will see this notification</p>
          <NotificationPreview title={bTitle} message={bMessage} type={bType} />
          <p className="mt-3 text-center text-[10px] text-ink/30">
            Preview updates as you type
          </p>
        </section>
      </div>

      {/* ── 3. Broadcast Statistics ── */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp size={13} className="text-ink/40" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/40">
            Broadcast Statistics
          </h2>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {/* Total card */}
          <div className="rounded-xl border border-border bg-canvas p-3 text-center">
            <p className="text-2xl font-bold tabular-nums text-ink">
              {nLoading ? '—' : stats.total}
            </p>
            <p className="mt-0.5 text-xs text-ink/40">Total</p>
          </div>

          {/* Per-type cards */}
          {ALL_TYPES.map(t => (
            <div key={t} className="rounded-xl border border-border bg-canvas p-3 text-center">
              <p className={`text-2xl font-bold tabular-nums ${nLoading ? 'text-ink/20' : 'text-ink'}`}>
                {nLoading ? '—' : stats.byType[t]}
              </p>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_STYLES[t].badge}`}>
                {TYPE_STYLES[t].label}
              </span>
            </div>
          ))}
        </div>
        {expiringSoon > 0 && (
          <p className="mt-2 text-xs text-amber-600">
            ⚠ {expiringSoon} notification{expiringSoon > 1 ? 's' : ''} expiring within 3 days
          </p>
        )}
      </section>

      {/* ── 4. Broadcast History ── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/40">
            Broadcast History
          </h2>

          {/* Type filter */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setHistFilter('')}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                histFilter === ''
                  ? 'bg-brand text-canvas'
                  : 'bg-mist text-ink/60 hover:bg-ink/10'
              }`}
            >
              All
            </button>
            {ALL_TYPES.map(t => (
              <button
                key={t}
                onClick={() => setHistFilter(t === histFilter ? '' : t)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  histFilter === t
                    ? TYPE_STYLES[t].badge
                    : 'bg-mist text-ink/60 hover:bg-ink/10'
                }`}
              >
                {TYPE_STYLES[t].label}
              </button>
            ))}
          </div>
        </div>

        {nLoading && history.length === 0 ? (
          <div className="rounded-xl border border-border bg-canvas py-12 text-center text-sm text-ink/40">
            Loading history…
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-xl border border-border bg-canvas py-12 text-center">
            <Megaphone size={28} className="mx-auto mb-2 text-ink/20" />
            <p className="text-sm font-medium text-ink/40">
              {histFilter ? 'No broadcasts of this type' : 'No broadcast history yet'}
            </p>
            {histFilter && (
              <button
                onClick={() => setHistFilter('')}
                className="mt-2 text-xs text-brand hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(n => {
              const ts    = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
              const isDel = deleting.has(n._id);
              return (
                <div
                  key={n._id}
                  className={`rounded-xl border border-border bg-canvas p-4 transition ${
                    isDel ? 'pointer-events-none opacity-50' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${ts.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ts.badge}`}>
                            {ts.label}
                          </span>
                          <p className="text-sm font-medium text-ink">{n.title}</p>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <span className="text-xs text-ink/40">{timeAgo(n.createdAt)}</span>
                          <button
                            onClick={() => handleDelete(n._id)}
                            disabled={isDel}
                            className="rounded-md p-1 text-ink/30 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed"
                            title="Delete broadcast"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-ink/50">{n.message}</p>
                      <p className="mt-1 text-[11px] text-ink/30">
                        {n.targetHotels.length === 0
                          ? 'All hotels'
                          : `${n.targetHotels.length} hotel${n.targetHotels.length > 1 ? 's' : ''}`}
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
      </section>

      <p className="text-center text-[11px] text-ink/30">
        History shows up to 20 active broadcasts · Config changes apply immediately
      </p>
    </div>
  );
}
