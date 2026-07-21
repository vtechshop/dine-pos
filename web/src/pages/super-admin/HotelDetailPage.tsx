import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Check, X, Copy, Eye, EyeOff } from 'lucide-react';
import { getHotel, approveHotel, rejectHotel, type Hotel, type ApproveResponse } from '../../api/superAdmin';
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

function fmt(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
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
            <span className="w-28 text-green-700 font-medium">{label}</span>
            <code className="font-mono text-green-900">{value}</code>
            <CopyButton text={value} />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-28 text-green-700 font-medium">Password</span>
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

export function HotelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [hotel,   setHotel]   = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Approve state
  const [showApprove,  setShowApprove]  = useState(false);
  const [trialDays,    setTrialDays]    = useState(14);
  const [features,     setFeatures]     = useState<Partial<Hotel['features']>>({});
  const [approving,    setApproving]    = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [credentials,  setCredentials]  = useState<ApproveResponse['credentials'] | null>(null);

  // Reject state
  const [showReject,  setShowReject]  = useState(false);
  const [reason,      setReason]      = useState('');
  const [rejecting,   setRejecting]   = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getHotel(id)
      .then(h => { setHotel(h); setFeatures(h.features); })
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

  const isPending = hotel.status === 'pending';

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

      {/* Approve / Reject actions for pending */}
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

      {/* Hotel info */}
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
                <dd className="font-medium text-ink text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-border bg-canvas p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/40">Account</p>
          <dl className="space-y-2 text-sm">
            {[
              { label: 'Admin ID',      value: hotel.adminId || '—' },
              { label: 'Approved',      value: fmt(hotel.approvedAt) },
              { label: 'Trial Start',   value: fmt(hotel.trialStartDate) },
              { label: 'Trial End',     value: fmt(hotel.trialEndDate) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-ink/50">{label}</dt>
                <dd className="font-medium text-ink text-right">{value}</dd>
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

      {/* ── Approve Modal ── */}
      {showApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-canvas p-6 shadow-xl">
            <h2 className="mb-4 text-base font-bold text-ink">Approve Hotel</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium text-ink/70 mb-1.5">
                Trial Period (days): <strong>{trialDays}</strong>
              </label>
              <input
                type="range" min={1} max={90} value={trialDays}
                onChange={e => setTrialDays(Number(e.target.value))}
                className="w-full accent-brand"
              />
              <div className="flex justify-between text-xs text-ink/40 mt-1">
                <span>1 day</span><span>90 days</span>
              </div>
            </div>

            <div className="mb-5">
              <p className="mb-2 text-sm font-medium text-ink/70">Feature Flags</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {FEATURE_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
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
              <label className="block text-sm font-medium text-ink/70 mb-1.5">
                Reason *
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="Explain why this registration is being rejected…"
                className="w-full rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder-ink/40 outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20 resize-none"
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
    </div>
  );
}
