import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Check, X, Copy, Eye, EyeOff, PauseCircle, PlayCircle, CalendarPlus, CreditCard, Sliders, Settings, FileText } from 'lucide-react';
import {
  getHotel, approveHotel, rejectHotel, suspendHotel, activateHotel, extendTrial,
  updateFeatures, setPlan, setTrial,
  type Hotel, type ApproveResponse,
} from '../../api/superAdmin';
import { Spinner } from '../../components/ui/Spinner';

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  trial:     'bg-blue-50 text-blue-700 border-blue-200',
  active:    'bg-green-50 text-green-700 border-green-200',
  suspended: 'bg-red-50 text-red-700 border-red-200',
  rejected:  'bg-gray-100 text-gray-600 border-gray-200',
  expired:   'bg-gray-100 text-gray-500 border-gray-200',
};

const FEATURE_LABELS: [keyof Hotel['features'], string][] = [
  ['payment',      'Online Payment'],
  ['reservations', 'Reservations'],
  ['customerChat', 'Customer Chat'],
  ['qrOrdering',   'QR Ordering'],
  ['expenses',     'Expenses'],
  ['reports',      'Reports'],
  ['tables',       'Tables'],
  ['ingredients',  'Ingredients'],
  ['waste',        'Waste Tracking'],
  ['aggregator',   'Aggregator'],
];

type PlanId = 'trial' | 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

const PLAN_OPTIONS: { id: PlanId; label: string; tier?: 'starter' | 'professional' | 'enterprise'; days?: number }[] = [
  { id: 'trial',      label: 'Trial' },
  { id: 'monthly',    label: 'Monthly',     tier: 'starter',      days: 30  },
  { id: 'quarterly',  label: 'Quarterly',   tier: 'professional', days: 90  },
  { id: 'halfyearly', label: 'Half-Yearly', tier: 'professional', days: 180 },
  { id: 'yearly',     label: 'Yearly',      tier: 'enterprise',   days: 365 },
];

function remainingDays(endDate: string | null): number | null {
  if (!endDate) return null;
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000));
}

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="ml-1.5 text-ink/40 hover:text-brand transition"
      title="Copy"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function CredentialBox({ creds }: { creds: ApproveResponse['credentials'] }) {
  const [showPwd, setShowPwd] = useState(false);
  return (
    <div className="mt-6 rounded-xl border-2 border-green-400 bg-green-50 p-5">
      <p className="mb-3 text-sm font-bold text-green-800">Hotel Credentials — share with the owner now</p>
      <div className="space-y-2 text-sm">
        {[
          { label: 'Admin ID',    value: creds.adminId },
          { label: 'Kitchen PIN', value: creds.kitchenPin },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-28 font-medium text-green-700">{label}</span>
            <code className="font-mono text-green-900">{value}</code>
            <CopyButton text={value} />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-28 font-medium text-green-700">Password</span>
          <code className="font-mono text-green-900">
            {showPwd ? creds.password : '••••••••'}
          </code>
          <button onClick={() => setShowPwd(v => !v)} className="text-green-700 hover:text-green-900 transition">
            {showPwd ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <CopyButton text={creds.password} />
        </div>
      </div>
      <p className="mt-3 text-xs text-green-700">These credentials will not be shown again.</p>
    </div>
  );
}

// ── Activity Timeline ─────────────────────────────────────────────────────────

type TLKind = 'info' | 'success' | 'warning' | 'danger' | 'active';
type TLEvent = { date: string | null; label: string; detail?: string; kind: TLKind };

const DOT_COLOR: Record<TLKind, string> = {
  info:    'bg-blue-400',
  success: 'bg-green-500',
  warning: 'bg-amber-400',
  danger:  'bg-red-500',
  active:  'bg-green-500',
};

function buildTimeline(hotel: Hotel): TLEvent[] {
  const now    = new Date();
  const events: TLEvent[] = [];

  events.push({ date: hotel.createdAt, label: 'Application submitted', kind: 'info' });

  if (hotel.status === 'rejected') {
    events.push({ date: hotel.updatedAt || null, label: 'Application rejected', detail: hotel.rejectionReason || undefined, kind: 'danger' });
    return events.sort(byDate);
  }

  if (hotel.approvedAt) {
    events.push({ date: hotel.approvedAt, label: 'Account approved', kind: 'success' });
  }

  if (hotel.trialStartDate) {
    const approvedMs = hotel.approvedAt ? new Date(hotel.approvedAt).getTime() : 0;
    if (Math.abs(new Date(hotel.trialStartDate).getTime() - approvedMs) > 60_000) {
      events.push({ date: hotel.trialStartDate, label: 'Trial period started', kind: 'info' });
    }
  }

  if (hotel.trialEndDate) {
    const past = new Date(hotel.trialEndDate) < now;
    events.push({ date: hotel.trialEndDate, label: past ? 'Trial period ended' : 'Trial ends', kind: past ? 'warning' : 'info' });
  }

  if (hotel.status === 'suspended') {
    events.push({ date: null, label: 'Account suspended', kind: 'danger' });
  } else if (hotel.status === 'expired') {
    events.push({ date: null, label: 'Subscription expired', kind: 'warning' });
  } else if (hotel.status === 'active') {
    events.push({ date: null, label: 'Account active', kind: 'active' });
  }

  return events.sort(byDate);
}

function byDate(a: TLEvent, b: TLEvent): number {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return new Date(a.date).getTime() - new Date(b.date).getTime();
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function HotelDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();

  const [hotel,   setHotel]   = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Approve
  const [showApprove,  setShowApprove]  = useState(false);
  const [trialDays,    setTrialDays]    = useState(14);
  const [features,     setFeatures]     = useState<Partial<Hotel['features']>>({});
  const [approving,    setApproving]    = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [credentials,  setCredentials]  = useState<ApproveResponse['credentials'] | null>(null);

  // Reject
  const [showReject,  setShowReject]  = useState(false);
  const [reason,      setReason]      = useState('');
  const [rejecting,   setRejecting]   = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Manage
  const [showSuspend,  setShowSuspend]  = useState(false);
  const [suspending,   setSuspending]   = useState(false);
  const [activating,   setActivating]   = useState(false);
  const [showExtend,   setShowExtend]   = useState(false);
  const [extending,    setExtending]    = useState(false);
  const [extendDays,   setExtendDays]   = useState(7);
  const [manageError,  setManageError]  = useState<string | null>(null);

  // Subscription plan
  const [selectedPlan,    setSelectedPlan]    = useState<PlanId | null>(null);
  const [planTrialDays,   setPlanTrialDays]   = useState(14);
  const [settingPlan,     setSettingPlan]     = useState(false);
  const [planError,       setPlanError]       = useState<string | null>(null);
  const [planSuccess,     setPlanSuccess]     = useState<string | null>(null);

  // Feature flags
  const [draftFeatures,   setDraftFeatures]   = useState<Hotel['features'] | null>(null);
  const [savingFeatures,  setSavingFeatures]  = useState(false);
  const [featuresError,   setFeaturesError]   = useState<string | null>(null);
  const [featuresSuccess, setFeaturesSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getHotel(id)
      .then(h => { setHotel(h); setFeatures(h.features); setDraftFeatures(h.features); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load hotel'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleApprove() {
    if (!id) return;
    setApproving(true);
    setApproveError(null);
    try {
      const res = await approveHotel(id, { trialDays, features });
      setHotel(res.hotel);
      setCredentials(res.credentials);
      setShowApprove(false);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!id || !reason.trim()) return;
    setRejecting(true);
    setRejectError(null);
    try {
      const res = await rejectHotel(id, reason.trim());
      setHotel(res.hotel);
      setShowReject(false);
      setReason('');
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setRejecting(false);
    }
  }

  async function handleSuspend() {
    if (!id) return;
    setSuspending(true);
    setManageError(null);
    try {
      const res = await suspendHotel(id);
      setHotel(res.hotel);
      setShowSuspend(false);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Suspend failed');
      setShowSuspend(false);
    } finally {
      setSuspending(false);
    }
  }

  async function handleActivate() {
    if (!id) return;
    setActivating(true);
    setManageError(null);
    try {
      const res = await activateHotel(id);
      setHotel(res.hotel);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setActivating(false);
    }
  }

  async function handleExtendTrial() {
    if (!id) return;
    setExtending(true);
    setManageError(null);
    try {
      const res = await extendTrial(id, extendDays);
      setHotel(res.hotel);
      setShowExtend(false);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Extend trial failed');
      setShowExtend(false);
    } finally {
      setExtending(false);
    }
  }

  async function handleSetPlan() {
    if (!id || !selectedPlan) return;
    setSettingPlan(true); setPlanError(null);
    try {
      let res;
      if (selectedPlan === 'trial') {
        res = await setTrial(id, planTrialDays);
      } else {
        const opt = PLAN_OPTIONS.find(p => p.id === selectedPlan)!;
        res = await setPlan(id, opt.tier!, opt.days!);
      }
      setHotel(res.hotel);
      setDraftFeatures(res.hotel.features);
      setSelectedPlan(null);
      setPlanSuccess(res.message);
      setTimeout(() => setPlanSuccess(null), 3000);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Plan change failed');
    } finally {
      setSettingPlan(false);
    }
  }

  async function handleSaveFeatures() {
    if (!id || !draftFeatures) return;
    setSavingFeatures(true); setFeaturesError(null);
    try {
      const result = await updateFeatures(id, draftFeatures);
      setHotel(prev => prev ? { ...prev, features: result.features } : null);
      setDraftFeatures(result.features);
      setFeaturesSuccess('Feature flags updated');
      setTimeout(() => setFeaturesSuccess(null), 3000);
    } catch (err) {
      setFeaturesError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingFeatures(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !hotel) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error ?? 'Hotel not found'}
        </div>
        <Link to="/super-admin/hotels" className="mt-4 inline-flex items-center gap-1 text-sm text-brand hover:underline">
          <ArrowLeft size={14} /> Back to Hotels
        </Link>
      </div>
    );
  }

  const isPending   = hotel.status === 'pending';
  const canSuspend  = hotel.status === 'trial' || hotel.status === 'active';
  const canActivate = hotel.status === 'suspended' || hotel.status === 'expired';
  const canExtend   = hotel.status === 'trial';
  const showManage  = !isPending && hotel.status !== 'rejected' && !credentials;

  const timeline = buildTimeline(hotel);

  return (
    <div className="p-6">
      {/* Back + header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/super-admin/hotels')}
          className="mb-3 flex items-center gap-1 text-sm text-ink/50 transition hover:text-ink"
        >
          <ArrowLeft size={14} /> Hotels
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-ink">{hotel.hotelName}</h1>
            <p className="mt-0.5 text-sm text-ink/50">{hotel.ownerName} · {hotel.city}, {hotel.state}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${STATUS_BADGE[hotel.status] ?? ''}`}>
            {hotel.status}
          </span>
        </div>
      </div>

      {/* Credentials box (shown immediately after approval) */}
      {credentials && <CredentialBox creds={credentials} />}

      {/* Approve / Reject — pending only */}
      {isPending && !credentials && (
        <div className="mb-6 flex gap-3">
          <button
            onClick={() => setShowApprove(true)}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
          >
            <Check size={15} /> Approve
          </button>
          <button
            onClick={() => setShowReject(true)}
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100"
          >
            <X size={15} /> Reject
          </button>
        </div>
      )}

      {/* Manage — non-pending, non-rejected */}
      {showManage && (
        <div className="mb-6 rounded-xl border border-border bg-canvas p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">Management</p>
          <div className="flex flex-wrap gap-2">
            {canSuspend && (
              <button
                onClick={() => { setManageError(null); setShowSuspend(true); }}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100"
              >
                <PauseCircle size={15} /> Suspend
              </button>
            )}
            {canActivate && (
              <button
                onClick={handleActivate}
                disabled={activating}
                className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-60"
              >
                {activating ? <Spinner size="sm" /> : <PlayCircle size={15} />}
                {activating ? 'Activating…' : 'Activate'}
              </button>
            )}
            {canExtend && (
              <button
                onClick={() => { setManageError(null); setShowExtend(true); }}
                className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-100"
              >
                <CalendarPlus size={15} /> Extend Trial
              </button>
            )}
          </div>
          {manageError && (
            <p className="mt-2 text-xs text-red-600">{manageError}</p>
          )}
        </div>
      )}

      {/* Hotel info cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-canvas p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">Registration</p>
          <dl className="space-y-2 text-sm">
            {[
              { label: 'Business Type', value: hotel.businessType },
              { label: 'Phone',         value: hotel.phone },
              { label: 'Email',         value: hotel.email || '—' },
              { label: 'Registered',    value: fmt(hotel.createdAt) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-ink/50">{label}</dt>
                <dd className="text-right font-medium text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-border bg-canvas p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">Account</p>
          <dl className="space-y-2 text-sm">
            {[
              { label: 'Admin ID',      value: hotel.adminId || '—' },
              { label: 'Plan',          value: hotel.subscriptionType || '—' },
              { label: 'Approved',      value: fmt(hotel.approvedAt) },
              { label: 'Trial End',     value: fmt(hotel.trialEndDate) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-ink/50">{label}</dt>
                <dd className="text-right font-medium text-ink capitalize">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {hotel.rejectionReason && (
          <div className="rounded-xl border border-red-100 bg-red-50 p-5 sm:col-span-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-red-400">Rejection Reason</p>
            <p className="text-sm text-red-700">{hotel.rejectionReason}</p>
          </div>
        )}
      </div>

      {/* Activity Timeline */}
      {timeline.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-canvas p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">Activity Timeline</p>
          <div className="relative">
            <div className="absolute bottom-0 left-[6px] top-0 w-px bg-border" />
            <ul className="space-y-4">
              {timeline.map((ev, i) => (
                <li key={i} className="relative flex gap-3 pl-5">
                  <span className={`absolute left-0 top-[5px] h-3 w-3 rounded-full border-2 border-canvas ${DOT_COLOR[ev.kind]}`} />
                  <div>
                    <p className="text-sm font-medium text-ink">{ev.label}</p>
                    {ev.date && (
                      <p className="mt-0.5 text-xs text-ink/40">{fmt(ev.date)}</p>
                    )}
                    {ev.detail && (
                      <p className="mt-0.5 text-xs text-red-600">{ev.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Subscription Management */}
      {!isPending && hotel.status !== 'rejected' && (
        <div className="mt-4 rounded-xl border border-border bg-canvas p-5">
          <div className="mb-4 flex items-center gap-2">
            <CreditCard size={15} className="text-ink/40" />
            <p className="text-xs font-semibold uppercase tracking-wider text-ink/40">Subscription</p>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink/50">Current Plan</p>
              <p className="mt-0.5 font-semibold capitalize text-ink">{hotel.subscriptionType || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-ink/50">Expiry Date</p>
              <p className="mt-0.5 font-semibold text-ink">
                {fmt(hotel.trialEndDate || hotel.subscriptionEndDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink/50">Days Remaining</p>
              <p className="mt-0.5 font-semibold text-ink">
                {(() => {
                  const d = remainingDays(hotel.trialEndDate || hotel.subscriptionEndDate);
                  return d === null ? '—' : `${d}d`;
                })()}
              </p>
            </div>
          </div>

          <p className="mb-2 text-sm font-medium text-ink/70">Change Plan</p>
          <div className="flex flex-wrap gap-2">
            {PLAN_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => setSelectedPlan(selectedPlan === opt.id ? null : opt.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  selectedPlan === opt.id
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border bg-canvas text-ink/60 hover:bg-mist'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {selectedPlan === 'trial' && (
            <div className="mt-3">
              <label className="mb-1.5 block text-sm font-medium text-ink/70">
                Trial days: <strong>{planTrialDays}</strong>
              </label>
              <input
                type="range" min={1} max={90} value={planTrialDays}
                onChange={e => setPlanTrialDays(Number(e.target.value))}
                className="w-full accent-brand"
              />
              <div className="mt-1 flex justify-between text-xs text-ink/40">
                <span>1 day</span><span>90 days</span>
              </div>
            </div>
          )}

          {selectedPlan && (
            <button
              onClick={handleSetPlan}
              disabled={settingPlan}
              className="mt-3 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60"
            >
              {settingPlan && <Spinner size="sm" />}
              {settingPlan ? 'Applying…' : `Apply ${PLAN_OPTIONS.find(p => p.id === selectedPlan)?.label} Plan`}
            </button>
          )}

          {planError   && <p className="mt-2 text-xs text-red-600">{planError}</p>}
          {planSuccess && <p className="mt-2 text-xs text-green-600">{planSuccess}</p>}
        </div>
      )}

      {/* Feature Flags */}
      {draftFeatures && !isPending && hotel.status !== 'rejected' && (
        <div className="mt-4 rounded-xl border border-border bg-canvas p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sliders size={15} className="text-ink/40" />
            <p className="text-xs font-semibold uppercase tracking-wider text-ink/40">Feature Flags</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {FEATURE_LABELS.map(([key, label]) => (
              <div
                key={key}
                className="flex cursor-pointer items-center gap-2.5"
                onClick={() => setDraftFeatures(f => f ? { ...f, [key]: !f[key] } : f)}
              >
                <div className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                  draftFeatures[key] ? 'bg-brand' : 'bg-ink/20'
                }`}>
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    draftFeatures[key] ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </div>
                <span className="text-sm text-ink">{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSaveFeatures}
              disabled={savingFeatures}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60"
            >
              {savingFeatures && <Spinner size="sm" />}
              {savingFeatures ? 'Saving…' : 'Save Flags'}
            </button>
            {featuresError   && <p className="text-xs text-red-600">{featuresError}</p>}
            {featuresSuccess && <p className="text-xs text-green-600">{featuresSuccess}</p>}
          </div>
        </div>
      )}

      {/* Hotel Settings (read-only) */}
      <div className="mt-4 rounded-xl border border-border bg-canvas p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={15} className="text-ink/40" />
            <p className="text-xs font-semibold uppercase tracking-wider text-ink/40">Hotel Settings</p>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
            Edit Coming Soon
          </span>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[
            { label: 'Hotel Name',    value: hotel.hotelName },
            { label: 'Owner Name',    value: hotel.ownerName },
            { label: 'Phone',         value: hotel.phone },
            { label: 'Email',         value: hotel.email || '—' },
            { label: 'Business Type', value: hotel.businessType },
            { label: 'City',          value: hotel.city || '—' },
            { label: 'State',         value: hotel.state || '—' },
            { label: 'Admin ID',      value: hotel.adminId || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-ink/50">{label}</dt>
              <dd className="text-right font-medium text-ink capitalize">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Internal Notes */}
      <div className="mt-4 rounded-xl border border-border bg-canvas p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileText size={15} className="text-ink/40" />
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/40">Internal Notes</p>
        </div>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <p className="text-sm font-medium text-ink/50">Coming Soon</p>
          <p className="mt-1 text-xs text-ink/30">Internal remarks and notes will appear here once the feature is available.</p>
        </div>
      </div>

      {/* ── Approve Modal ── */}
      {showApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-canvas p-6 shadow-xl">
            <h2 className="mb-4 text-base font-bold text-ink">Approve Hotel</h2>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-ink/70">
                Trial Period (days): <strong>{trialDays}</strong>
              </label>
              <input
                type="range" min={1} max={90} value={trialDays}
                onChange={e => setTrialDays(Number(e.target.value))}
                className="w-full accent-brand"
              />
              <div className="mt-1 flex justify-between text-xs text-ink/40">
                <span>1 day</span><span>90 days</span>
              </div>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-sm font-medium text-ink/70">Feature Flags</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {FEATURE_LABELS.map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={!!(features as any)[key]}
                      onChange={e => setFeatures(f => ({ ...f, [key]: e.target.checked }))}
                      className="accent-brand"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {approveError && (
              <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">
                {approveError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={approving}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
              >
                {approving && <Spinner size="sm" />}
                {approving ? 'Approving…' : 'Approve & Start Trial'}
              </button>
              <button
                onClick={() => setShowApprove(false)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm text-ink/60 transition hover:bg-mist"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Modal ── */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-canvas p-6 shadow-xl">
            <h2 className="mb-4 text-base font-bold text-ink">Reject Application</h2>
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-ink/70">Reason *</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="Explain why this registration is being rejected…"
                className="w-full resize-none rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
              />
            </div>
            {rejectError && (
              <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">
                {rejectError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleReject}
                disabled={rejecting || !reason.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {rejecting && <Spinner size="sm" />}
                {rejecting ? 'Rejecting…' : 'Reject Application'}
              </button>
              <button
                onClick={() => { setShowReject(false); setReason(''); }}
                className="rounded-lg border border-border px-4 py-2.5 text-sm text-ink/60 transition hover:bg-mist"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Suspend Modal ── */}
      {showSuspend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas p-6 shadow-xl">
            <h2 className="mb-2 text-base font-bold text-ink">Suspend Hotel?</h2>
            <p className="mb-5 text-sm text-ink/60">
              This will immediately revoke all active sessions and lock out{' '}
              <strong className="text-ink">{hotel.hotelName}</strong>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSuspend}
                disabled={suspending}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {suspending && <Spinner size="sm" />}
                {suspending ? 'Suspending…' : 'Yes, Suspend'}
              </button>
              <button
                onClick={() => setShowSuspend(false)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm text-ink/60 transition hover:bg-mist"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Extend Trial Modal ── */}
      {showExtend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas p-6 shadow-xl">
            <h2 className="mb-4 text-base font-bold text-ink">Extend Trial</h2>
            <label className="mb-1.5 block text-sm font-medium text-ink/70">
              Add days: <strong>{extendDays}</strong>
            </label>
            <input
              type="range" min={1} max={90} value={extendDays}
              onChange={e => setExtendDays(Number(e.target.value))}
              className="w-full accent-brand"
            />
            <div className="mb-5 mt-1 flex justify-between text-xs text-ink/40">
              <span>1 day</span><span>90 days</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleExtendTrial}
                disabled={extending}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
              >
                {extending && <Spinner size="sm" />}
                {extending ? 'Extending…' : `Add ${extendDays} day${extendDays !== 1 ? 's' : ''}`}
              </button>
              <button
                onClick={() => setShowExtend(false)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm text-ink/60 transition hover:bg-mist"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
