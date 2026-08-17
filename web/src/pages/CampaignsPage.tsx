import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageCircle, Plus, Send, Clock, CheckCircle2, XCircle,
  ChevronDown, AlertTriangle, Users, RefreshCw, X, Info,
  Edit2, Copy, FlaskConical, BarChart2,
} from 'lucide-react';
import type { Campaign, CampaignAudience, CampaignStatus } from '../types/customers';
import {
  fetchCampaigns, createCampaign, sendCampaign, cancelCampaign,
  fetchProviderStatus, updateCampaign, duplicateCampaign,
  testSendCampaign, fetchCampaignMessages, fetchAudienceCount,
} from '../api/campaigns';
import type {
  CampaignMessageRecord, CampaignMessageStats, UpdateCampaignBody,
} from '../api/campaigns';
import { Spinner } from '../components/ui/Spinner';

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  all:             'All Customers',
  new:             'New Customers',
  repeat:          'Repeat Customers',
  vip:             'VIP / Top Spenders',
  inactive30:      'Inactive 30+ Days',
  inactive60:      'Inactive 60+ Days',
  inactive90:      'Inactive 90+ Days',
  birthday:        'Birthday This Month',
  anniversary:     'Anniversary This Month',
  birthdayweek:    'Birthday This Week',
  anniversaryweek: 'Anniversary This Week',
  loyalty:         'Loyalty Members',
  noloyalty:       'Without Loyalty',
  custom:          'Custom List',
};

const STATUS_CONFIG: Record<CampaignStatus, { label: string; cls: string; Icon: React.ElementType; desc: string }> = {
  draft:     { label: 'Draft',     cls: 'text-ink/50 bg-mist border-border',          Icon: Clock,        desc: 'Not yet scheduled or sent' },
  scheduled: { label: 'Scheduled', cls: 'text-amber-700 bg-amber-50 border-amber-200', Icon: Clock,        desc: 'Will be sent automatically at scheduled time' },
  sending:   { label: 'Sending',   cls: 'text-blue-700 bg-blue-50 border-blue-200',   Icon: RefreshCw,    desc: 'Dispatch in progress — recipients being reached' },
  sent:      { label: 'Sent',      cls: 'text-green-700 bg-green-50 border-green-200', Icon: CheckCircle2, desc: 'Delivered to eligible recipients' },
  partial:   { label: 'Partial',   cls: 'text-amber-700 bg-amber-50 border-amber-200', Icon: AlertTriangle,desc: 'Some recipients sent, some failed — can retry' },
  failed:    { label: 'Failed',    cls: 'text-red-700 bg-red-50 border-red-200',       Icon: XCircle,      desc: 'Delivery failed — see reason below' },
  cancelled: { label: 'Cancelled', cls: 'text-ink/30 bg-ink/5 border-border',          Icon: XCircle,      desc: 'Campaign was cancelled' },
};

// Variables substituted server-side at send time: {name}, {hotel}, {points}
const TEMPLATE_VARS = ['{name}', '{hotel}', '{points}'];

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Minimum datetime-local value: now + 5 minutes, in local time for the input
function minScheduleValue(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Audience count display ─────────────────────────────────────────────────────

function AudienceCount({ total, eligible }: { total: number; eligible: number }) {
  const optedOut = total - eligible;
  return (
    <div className="mt-2 rounded-lg border border-border bg-mist p-3 text-[11px] space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-ink/60">Total in segment</span>
        <span className="font-semibold tabular-nums text-ink">{total.toLocaleString()}</span>
      </div>
      {optedOut > 0 && (
        <div className="flex items-center justify-between text-red-600/70">
          <span>Opted out (excluded)</span>
          <span className="font-semibold tabular-nums">−{optedOut.toLocaleString()}</span>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border pt-1 mt-1">
        <span className="font-semibold text-ink">Eligible recipients</span>
        <span className="font-bold tabular-nums text-brand">{eligible.toLocaleString()}</span>
      </div>
      {eligible === 0 && (
        <p className="text-amber-700 text-[10px]">No opted-in customers in this segment. Enable marketing opt-in in customer profiles.</p>
      )}
    </div>
  );
}

// ── Edit Campaign Modal ────────────────────────────────────────────────────────

interface EditModalProps {
  campaign:       Campaign;
  onClose:        () => void;
  onSaved:        (c: Campaign) => void;
  providerStatus: { whatsapp: boolean; sms: boolean };
}

function EditModal({ campaign, onClose, onSaved, providerStatus }: EditModalProps) {
  const [name,               setName]               = useState(campaign.name);
  const [message,            setMessage]            = useState(campaign.messageTemplate);
  const [audience,           setAudience]           = useState<CampaignAudience>(campaign.audience);
  const [scheduleMode,       setScheduleMode]       = useState<'draft' | 'scheduled'>(
    campaign.status === 'scheduled' ? 'scheduled' : 'draft',
  );
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (!campaign.scheduledAt) return '';
    const d   = new Date(campaign.scheduledAt as string);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [waTemplateName,      setWaTemplateName]      = useState(campaign.waTemplateName ?? '');
  const [waTemplateLanguage,  setWaTemplateLanguage]  = useState(campaign.waTemplateLanguage ?? 'en');
  const [waTemplateNamespace, setWaTemplateNamespace] = useState(campaign.waTemplateNamespace ?? '');
  const [waTemplateVars, setWaTemplateVars] = useState<string[]>(() => {
    const existing = campaign.waTemplateVars ?? [];
    return [...existing, '', ''].slice(0, 3);
  });
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [audienceCounts, setAudienceCounts] = useState<{ total: number; eligible: number } | null>(null);
  const [countLoading,   setCountLoading]   = useState(false);
  const countDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAudienceCounts(null);
    if (audience === 'custom') return;
    if (countDebounceRef.current) clearTimeout(countDebounceRef.current);
    setCountLoading(true);
    countDebounceRef.current = setTimeout(() => {
      void fetchAudienceCount(audience)
        .then(r => setAudienceCounts({ total: r.count, eligible: r.eligibleCount }))
        .catch(() => {})
        .finally(() => setCountLoading(false));
    }, 400);
    return () => { if (countDebounceRef.current) clearTimeout(countDebounceRef.current); };
  }, [audience]);

  const insertVar = (v: string) => setMessage(prev => prev + v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim())    { setError('Campaign name is required'); return; }
    if (!message.trim()) { setError('Message template is required'); return; }
    if (scheduleMode === 'scheduled' && !scheduledAt) {
      setError('Please select a scheduled date and time'); return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: UpdateCampaignBody = {
        name:            name.trim(),
        messageTemplate: message,
        audience,
        scheduledAt:     scheduleMode === 'scheduled'
          ? new Date(scheduledAt).toISOString()
          : null,
      };
      if (campaign.channel === 'whatsapp') {
        body.waTemplateName      = waTemplateName.trim() || null;
        body.waTemplateLanguage  = waTemplateLanguage.trim() || 'en';
        body.waTemplateNamespace = waTemplateNamespace.trim();
        body.waTemplateVars      = waTemplateVars.map(v => v.trim()).filter(Boolean);
      }
      const res = await updateCampaign(campaign._id, body);
      onSaved(res.campaign);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-canvas shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-canvas px-5 py-4 z-10">
          <h2 className="text-sm font-semibold text-ink">Edit Campaign</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink"><X size={16} /></button>
        </div>

        <form onSubmit={e => void handleSubmit(e)} className="space-y-4 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={12} className="shrink-0" />{error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Campaign Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-mist px-3 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Channel</label>
              <div className="h-9 flex items-center rounded-lg border border-border bg-mist px-3 text-sm text-ink/60 capitalize">
                {campaign.channel}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Audience</label>
              <div className="relative">
                <select value={audience} onChange={e => setAudience(e.target.value as CampaignAudience)}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-mist px-3 pr-8 text-sm text-ink outline-none focus:border-brand/50">
                  {(Object.entries(AUDIENCE_LABELS) as [CampaignAudience, string][])
                    .filter(([k]) => k !== 'custom')
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
              </div>
            </div>
          </div>

          {countLoading && <div className="flex items-center gap-2 text-xs text-ink/40"><Spinner size="sm" />Computing audience…</div>}
          {audienceCounts && <AudienceCount total={audienceCounts.total} eligible={audienceCounts.eligible} />}

          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Send Timing</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setScheduleMode('draft')}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${scheduleMode === 'draft' ? 'border-brand bg-brand/5 text-brand' : 'border-border text-ink/50 hover:bg-mist'}`}>
                Draft (send manually)
              </button>
              <button type="button" onClick={() => setScheduleMode('scheduled')}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${scheduleMode === 'scheduled' ? 'border-brand bg-brand/5 text-brand' : 'border-border text-ink/50 hover:bg-mist'}`}>
                Schedule
              </button>
            </div>
            {scheduleMode === 'scheduled' && (
              <div className="mt-2">
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  min={minScheduleValue()}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-mist px-3 text-xs text-ink outline-none focus:border-brand/50"
                />
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Message Template</label>
            <div className="mb-1.5 flex flex-wrap gap-1">
              {TEMPLATE_VARS.map(v => (
                <button key={v} type="button" onClick={() => insertVar(v)}
                  className="rounded-full border border-border bg-mist px-2 py-0.5 text-[10px] font-medium text-ink/60 hover:bg-ink/10">
                  {v}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-border bg-mist px-3 py-2.5 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-none"
            />
            <p className="mt-1 text-[10px] text-ink/30">{message.length} / 4000 characters</p>
          </div>

          {message && (
            <div className="rounded-lg border border-brand/20 bg-brand/5 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-brand/60">Preview (sample data)</p>
              <p className="text-xs text-ink/80 whitespace-pre-wrap">
                {message
                  .replace(/\{name\}/g,   'Ramesh Kumar')
                  .replace(/\{hotel\}/g,  'Your Restaurant')
                  .replace(/\{points\}/g, '250')}
              </p>
            </div>
          )}

          {campaign.channel === 'whatsapp' && (
            <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                WhatsApp Template
              </p>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">Template Name</label>
                <input type="text" value={waTemplateName} onChange={e => setWaTemplateName(e.target.value)}
                  placeholder="e.g. restaurant_promo_v1"
                  className="h-9 w-full rounded-lg border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand/50 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">Language</label>
                  <input type="text" value={waTemplateLanguage} onChange={e => setWaTemplateLanguage(e.target.value)} placeholder="en"
                    className="h-9 w-full rounded-lg border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand/50 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">Namespace (optional)</label>
                  <input type="text" value={waTemplateNamespace} onChange={e => setWaTemplateNamespace(e.target.value)} placeholder="Cloud API: leave blank"
                    className="h-9 w-full rounded-lg border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand/50 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                  Template Variables (body_1, body_2, body_3)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['body_1', 'body_2', 'body_3'] as const).map((slot, i) => (
                    <div key={slot}>
                      <p className="mb-0.5 text-[10px] text-ink/40">{slot}</p>
                      <select value={waTemplateVars[i] ?? ''} onChange={e => {
                          const next = [...waTemplateVars]; next[i] = e.target.value; setWaTemplateVars(next);
                        }}
                        className="h-8 w-full rounded border border-border bg-canvas px-2 text-xs text-ink focus:border-brand/50 focus:outline-none">
                        <option value="">— none —</option>
                        <option value="name">name</option>
                        <option value="hotel">hotel</option>
                        <option value="points">points</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!providerStatus[campaign.channel as 'whatsapp' | 'sms'] && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-[11px] text-amber-800">
                No {campaign.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} provider configured. Add MSG91 credentials in Settings → Integrations.
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-ink/60 hover:bg-mist">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              {saving ? <Spinner size="sm" /> : <Edit2 size={13} />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Create Campaign Modal ──────────────────────────────────────────────────────

interface CreateModalProps {
  onClose:        () => void;
  onCreated:      (c: Campaign) => void;
  providerStatus: { whatsapp: boolean; sms: boolean };
}

function CreateModal({ onClose, onCreated, providerStatus }: CreateModalProps) {
  const [name,               setName]               = useState('');
  const [channel,            setChannel]            = useState<'whatsapp' | 'sms'>('whatsapp');
  const [audience,           setAudience]           = useState<CampaignAudience>('all');
  const [message,            setMessage]            = useState('');
  const [scheduleNow,        setScheduleNow]        = useState(true);
  const [scheduledAt,        setScheduledAt]        = useState('');
  const [saving,             setSaving]             = useState(false);
  const [error,              setError]              = useState<string | null>(null);
  const [audienceCounts,     setAudienceCounts]     = useState<{ total: number; eligible: number } | null>(null);
  const [countLoading,       setCountLoading]       = useState(false);
  // WA template fields (required at dispatch time for WhatsApp campaigns)
  const [waTemplateName,      setWaTemplateName]      = useState('');
  const [waTemplateLanguage,  setWaTemplateLanguage]  = useState('en');
  const [waTemplateNamespace, setWaTemplateNamespace] = useState('');
  const [waTemplateVars,      setWaTemplateVars]      = useState(['', '', '']); // up to 3 body_N slots

  const countDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAudienceCounts(null);
    if (audience === 'custom') return;
    if (countDebounceRef.current) clearTimeout(countDebounceRef.current);
    setCountLoading(true);
    countDebounceRef.current = setTimeout(() => {
      void fetchAudienceCount(audience)
        .then(r => setAudienceCounts({ total: r.count, eligible: r.eligibleCount }))
        .catch(() => {})
        .finally(() => setCountLoading(false));
    }, 400);
    return () => { if (countDebounceRef.current) clearTimeout(countDebounceRef.current); };
  }, [audience]);

  const insertVar = (v: string) => setMessage(prev => prev + v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim())    { setError('Campaign name is required'); return; }
    if (!message.trim()) { setError('Message template is required'); return; }
    if (!scheduleNow && !scheduledAt) { setError('Please select a scheduled date and time'); return; }

    setSaving(true);
    setError(null);
    try {
      const body: Parameters<typeof createCampaign>[0] = {
        name:            name.trim(),
        channel,
        audience,
        messageTemplate: message,
      };
      if (!scheduleNow && scheduledAt) {
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }
      // WhatsApp template fields (optional at creation — required at dispatch)
      if (channel === 'whatsapp') {
        if (waTemplateName.trim())      body.waTemplateName      = waTemplateName.trim();
        if (waTemplateLanguage.trim())  body.waTemplateLanguage  = waTemplateLanguage.trim();
        if (waTemplateNamespace.trim()) body.waTemplateNamespace = waTemplateNamespace.trim();
        const vars = waTemplateVars.map(v => v.trim()).filter(Boolean);
        if (vars.length > 0)            body.waTemplateVars      = vars;
      }
      const res = await createCampaign(body);
      setAudienceCounts({ total: res.campaign.recipientCount, eligible: res.campaign.eligibleCount });
      onCreated(res.campaign);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create campaign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-canvas shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-canvas px-5 py-4 z-10">
          <h2 className="text-sm font-semibold text-ink">Create Campaign</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink"><X size={16} /></button>
        </div>

        <form onSubmit={e => void handleSubmit(e)} className="space-y-4 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={12} className="shrink-0"/>{error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Campaign Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Birthday Wishes August"
              className="h-9 w-full rounded-lg border border-border bg-mist px-3 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Channel</label>
              <div className="relative">
                <select value={channel} onChange={e => setChannel(e.target.value as 'whatsapp' | 'sms')}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-mist px-3 pr-8 text-sm text-ink outline-none focus:border-brand/50">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Audience</label>
              <div className="relative">
                <select value={audience} onChange={e => setAudience(e.target.value as CampaignAudience)}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-mist px-3 pr-8 text-sm text-ink outline-none focus:border-brand/50">
                  {(Object.entries(AUDIENCE_LABELS) as [CampaignAudience, string][])
                    .filter(([k]) => k !== 'custom')
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
              </div>
            </div>
          </div>

          {/* Audience counts (shown after create returns data) */}
          {countLoading && <div className="flex items-center gap-2 text-xs text-ink/40"><Spinner size="sm" />Computing audience…</div>}
          {audienceCounts && <AudienceCount total={audienceCounts.total} eligible={audienceCounts.eligible} />}

          {/* Scheduling */}
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Send Timing</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setScheduleNow(true)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${scheduleNow ? 'border-brand bg-brand/5 text-brand' : 'border-border text-ink/50 hover:bg-mist'}`}>
                Send Now (Draft)
              </button>
              <button type="button" onClick={() => setScheduleNow(false)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${!scheduleNow ? 'border-brand bg-brand/5 text-brand' : 'border-border text-ink/50 hover:bg-mist'}`}>
                Schedule
              </button>
            </div>
            {!scheduleNow && (
              <div className="mt-2">
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  min={minScheduleValue()}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-mist px-3 text-xs text-ink outline-none focus:border-brand/50"
                />
                <p className="mt-1 text-[10px] text-ink/40 flex items-center gap-1">
                  <Info size={9} />Campaign fires automatically at this time via the server scheduler.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Message Template</label>
            <div className="mb-1.5 flex flex-wrap gap-1">
              {TEMPLATE_VARS.map(v => (
                <button key={v} type="button" onClick={() => insertVar(v)}
                  className="rounded-full border border-border bg-mist px-2 py-0.5 text-[10px] font-medium text-ink/60 hover:bg-ink/10">
                  {v}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={5}
              placeholder="Hi {name}, we have a special offer for you! Visit {hotel} to redeem your {points} points."
              className="w-full rounded-lg border border-border bg-mist px-3 py-2.5 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-none"
            />
            <p className="mt-1 text-[10px] text-ink/30">{message.length} / 4000 characters</p>
          </div>

          {/* Live preview */}
          {message && (
            <div className="rounded-lg border border-brand/20 bg-brand/5 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-brand/60">Preview (sample data)</p>
              <p className="text-xs text-ink/80 whitespace-pre-wrap">
                {message
                  .replace(/\{name\}/g,   'Ramesh Kumar')
                  .replace(/\{hotel\}/g,  'Your Restaurant')
                  .replace(/\{points\}/g, '250')}
              </p>
            </div>
          )}

          {/* WhatsApp template fields */}
          {channel === 'whatsapp' && (
            <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                WhatsApp Template (required at dispatch — can add later)
              </p>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                  Template Name
                </label>
                <input
                  type="text"
                  value={waTemplateName}
                  onChange={e => setWaTemplateName(e.target.value)}
                  placeholder="e.g. restaurant_promo_v1"
                  className="h-9 w-full rounded-lg border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand/50 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">Language</label>
                  <input
                    type="text"
                    value={waTemplateLanguage}
                    onChange={e => setWaTemplateLanguage(e.target.value)}
                    placeholder="en"
                    className="h-9 w-full rounded-lg border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">Namespace (optional)</label>
                  <input
                    type="text"
                    value={waTemplateNamespace}
                    onChange={e => setWaTemplateNamespace(e.target.value)}
                    placeholder="Leave blank for Cloud API"
                    className="h-9 w-full rounded-lg border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand/50 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                  Template Variables (body_1, body_2, body_3 — pick in order)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['body_1', 'body_2', 'body_3'] as const).map((slot, i) => (
                    <div key={slot}>
                      <p className="mb-0.5 text-[10px] text-ink/40">{slot}</p>
                      <select
                        value={waTemplateVars[i]}
                        onChange={e => {
                          const next = [...waTemplateVars];
                          next[i] = e.target.value;
                          setWaTemplateVars(next);
                        }}
                        className="h-8 w-full rounded border border-border bg-canvas px-2 text-xs text-ink focus:border-brand/50 focus:outline-none"
                      >
                        <option value="">— none —</option>
                        <option value="name">name</option>
                        <option value="hotel">hotel</option>
                        <option value="points">points</option>
                      </select>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-ink/40">
                  Map your MSG91 template placeholder positions to DinePOS variables.
                </p>
              </div>
            </div>
          )}

          {/* Provider notice — only shown when provider is missing for selected channel */}
          {!providerStatus[channel] && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-[11px] text-amber-800">
                <span className="font-semibold">No {channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} provider configured.</span>{' '}
                Campaign can be saved and scheduled but delivery requires MSG91 credentials in Settings → Integrations.
                Only opted-in customers with a phone number will receive messages.
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-ink/60 hover:bg-mist">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              {saving ? <Spinner size="sm" /> : <Plus size={13} />}
              {saving ? 'Saving…' : scheduleNow ? 'Save Draft' : 'Schedule Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Send Result modal ─────────────────────────────────────────────────────────

interface SendResultProps {
  result: { status: string; message: string; campaign?: { name: string; channel: string; recipientCount: number } };
  onClose: () => void;
}

function SendResultModal({ result, onClose }: SendResultProps) {
  const isDispatching  = result.status === 'dispatching';
  const isNoProvider   = result.status === 'no_provider';
  const isNoWaTemplate = result.status === 'no_wa_template';
  const isWarning      = isNoProvider || isNoWaTemplate;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas p-6 shadow-2xl text-center">
        {isWarning ? (
          <AlertTriangle size={36} className="mx-auto mb-4 text-amber-500" />
        ) : (
          <CheckCircle2 size={36} className="mx-auto mb-4 text-green-500" />
        )}
        <h2 className="mb-2 text-sm font-bold text-ink">
          {isDispatching  ? 'Campaign Dispatching'        :
           isNoProvider   ? 'Provider Not Configured'     :
           isNoWaTemplate ? 'WhatsApp Template Required'  :
                            'Campaign Sent'}
        </h2>
        <p className="mb-3 text-xs text-ink/60">{result.message}</p>
        {isNoProvider && (
          <p className="text-xs text-ink/40">Add MSG91 credentials in Settings → Integrations to enable delivery.</p>
        )}
        {isNoWaTemplate && (
          <p className="text-xs text-ink/40">Edit the campaign and add a pre-approved MSG91 template name, then try sending again.</p>
        )}
        {isDispatching && (
          <p className="text-xs text-ink/40">The campaign status will update to Sent or Partial once delivery completes. Refresh the list to see the result.</p>
        )}
        <button onClick={onClose}
          className="mt-5 w-full rounded-lg bg-brand py-2 text-sm font-medium text-white hover:bg-brand/90">
          OK
        </button>
      </div>
    </div>
  );
}

// ── Delivery Report Modal ─────────────────────────────────────────────────────

const MSG_STATUS_CFG: Record<string, { label: string; cls: string }> = {
  queued:    { label: 'Queued',    cls: 'text-ink/50 bg-mist border-border' },
  sent:      { label: 'Sent',      cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  delivered: { label: 'Delivered', cls: 'text-green-700 bg-green-50 border-green-200' },
  read:      { label: 'Read',      cls: 'text-violet-700 bg-violet-50 border-violet-200' },
  failed:    { label: 'Failed',    cls: 'text-red-700 bg-red-50 border-red-200' },
};

interface DeliveryReportProps {
  campaign: Campaign;
  onClose:  () => void;
}

function DeliveryReportModal({ campaign, onClose }: DeliveryReportProps) {
  const [stats,    setStats]    = useState<CampaignMessageStats | null>(null);
  const [messages, setMessages] = useState<CampaignMessageRecord[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(false);

  const load = useCallback(async (pg: number, append: boolean) => {
    setLoading(true);
    try {
      const res = await fetchCampaignMessages(campaign._id, { page: pg, limit: 50 });
      if (!append || pg === 1) setStats(res.stats);
      setTotal(res.total);
      setMessages(prev => append ? [...prev, ...res.messages] : res.messages);
      setPage(pg);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [campaign._id]);

  useEffect(() => { void load(1, false); }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl border border-border bg-canvas shadow-2xl max-h-[90vh]">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-canvas px-5 py-4 z-10">
          <div>
            <h2 className="text-sm font-semibold text-ink">Delivery Report</h2>
            <p className="text-[11px] text-ink/40">{campaign.name}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink"><X size={16} /></button>
        </div>

        {stats && (
          <div className="grid grid-cols-5 border-b border-border">
            {(['total', 'sent', 'delivered', 'read', 'failed'] as const).map(key => (
              <div key={key} className="px-4 py-3 text-center">
                <p className="text-lg font-bold tabular-nums text-ink">
                  {(stats as any)[key] ?? 0}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40 capitalize">{key}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && messages.length === 0 ? (
            <div className="flex h-32 items-center justify-center"><Spinner size="lg" /></div>
          ) : messages.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink/30">No delivery records yet</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-canvas">
                <tr className="border-b border-border">
                  {['Phone', 'Status', 'Sent', 'Delivered', 'Read / Failed'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {messages.map(msg => {
                  const sc = MSG_STATUS_CFG[msg.status] ?? MSG_STATUS_CFG.queued;
                  return (
                    <tr key={msg._id} className="border-b border-border/50 hover:bg-mist/30 last:border-0">
                      <td className="px-4 py-2.5 font-mono text-ink">{msg.phone}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sc.cls}`}>{sc.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-ink/50">{msg.sentAt ? formatDateTime(msg.sentAt) : '—'}</td>
                      <td className="px-4 py-2.5 text-ink/50">{msg.deliveredAt ? formatDateTime(msg.deliveredAt) : '—'}</td>
                      <td className="px-4 py-2.5">
                        {msg.readAt ? (
                          <span className="text-violet-600">{formatDateTime(msg.readAt)}</span>
                        ) : msg.failedAt ? (
                          <span className="text-red-500" title={msg.failureReason}>{formatDateTime(msg.failedAt)}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {messages.length < total && (
            <div className="p-4 text-center">
              <button
                onClick={() => void load(page + 1, true)}
                disabled={loading}
                className="rounded-lg border border-border px-4 py-2 text-xs text-ink/50 hover:bg-mist disabled:opacity-40"
              >
                {loading ? 'Loading…' : `Load more (${total - messages.length} remaining)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Test Send Modal ───────────────────────────────────────────────────────────

interface TestSendModalProps {
  campaign: Campaign;
  onClose:  () => void;
}

function TestSendModal({ campaign, onClose }: TestSendModalProps) {
  const [phone,   setPhone]   = useState('');
  const [sending, setSending] = useState(false);
  const [result,  setResult]  = useState<{ status: string; message: string } | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setSending(true);
    try {
      const res = await testSendCampaign(campaign._id, { phone: phone.trim() });
      setResult(res);
    } catch (err) {
      setResult({ status: 'failed', message: err instanceof Error ? err.message : 'Failed to send' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Test Send</h2>
            <p className="text-[11px] text-ink/40">{campaign.name}</p>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink"><X size={16} /></button>
        </div>

        {result ? (
          <div className={`rounded-lg border p-4 text-center ${result.status === 'sent' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            {result.status === 'sent'
              ? <CheckCircle2 size={24} className="mx-auto mb-2 text-green-500" />
              : <XCircle size={24} className="mx-auto mb-2 text-red-500" />}
            <p className="text-xs font-medium text-ink">{result.message}</p>
            {result.status !== 'sent' && (
              <p className="mt-1 text-[11px] text-ink/50">{
                result.status === 'no_provider'   ? 'Configure MSG91 in Settings → Integrations.' :
                result.status === 'no_wa_template' ? 'Add a WhatsApp template name to this campaign.' :
                'Check MSG91 credentials and try again.'
              }</p>
            )}
          </div>
        ) : (
          <form onSubmit={e => void handleSend(e)} className="space-y-4">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">
                Phone Number (test recipient)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="e.g. 919876543210"
                className="h-9 w-full rounded-lg border border-border bg-mist px-3 text-sm text-ink outline-none focus:border-brand/50"
                autoFocus
              />
              <p className="mt-1 text-[10px] text-ink/40">
                Sends with placeholder data (name=Test Customer, points=100). Does not affect campaign status.
                Limited to 5 sends per campaign per 10 minutes.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose}
                className="flex-1 rounded-lg border border-border py-2 text-sm text-ink/60 hover:bg-mist">
                Cancel
              </button>
              <button type="submit" disabled={sending || !phone.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
                {sending ? <Spinner size="sm" /> : <FlaskConical size={13} />}
                {sending ? 'Sending…' : 'Send Test'}
              </button>
            </div>
          </form>
        )}

        {result && (
          <button onClick={onClose}
            className="mt-4 w-full rounded-lg border border-border py-2 text-sm text-ink/60 hover:bg-mist">
            Close
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const CAMPAIGNS_LIMIT = 20;

type StatusFilter = 'all' | CampaignStatus;

export function CampaignsPage() {
  const [campaigns, setCampaigns]       = useState<Campaign[]>([]);
  const [total, setTotal]               = useState(0);
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showCreate, setShowCreate]     = useState(false);
  const [sending, setSending]           = useState<string | null>(null);
  const [cancelling, setCancelling]     = useState<string | null>(null);
  const [sendResult, setSendResult]     = useState<SendResultProps['result'] | null>(null);
  const [providerStatus, setProviderStatus] = useState<{ whatsapp: boolean; sms: boolean }>({ whatsapp: false, sms: false });
  const [editCampaign,   setEditCampaign]   = useState<Campaign | null>(null);
  const [reportCampaign, setReportCampaign] = useState<Campaign | null>(null);
  const [duplicating,    setDuplicating]    = useState<string | null>(null);
  const [testSendTarget, setTestSendTarget] = useState<Campaign | null>(null);
  const [currentPage,    setCurrentPage]    = useState(1);
  const [hasMore,        setHasMore]        = useState(false);
  const [loadingMore,    setLoadingMore]    = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCampaigns({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page:   1,
        limit:  CAMPAIGNS_LIMIT,
      });
      setCampaigns(res.campaigns);
      setTotal(res.total);
      setCurrentPage(1);
      setHasMore(CAMPAIGNS_LIMIT < res.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    fetchProviderStatus()
      .then(r => setProviderStatus(r.configured))
      .catch(() => {}); // fail-silent: assume no provider if unreachable
  }, []);

  // Auto-poll every 5 s while any campaign is actively sending
  useEffect(() => {
    const hasSending = campaigns.some(c => c.status === 'sending');
    if (hasSending && !pollRef.current) {
      pollRef.current = setInterval(() => { void loadRef.current(); }, 5000);
    } else if (!hasSending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [campaigns]);

  const loadMore = useCallback(async () => {
    const nextPage = currentPage + 1;
    setLoadingMore(true);
    try {
      const res = await fetchCampaigns({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page:   nextPage,
        limit:  CAMPAIGNS_LIMIT,
      });
      setCampaigns(prev => {
        const existingIds = new Set(prev.map(c => c._id));
        const fresh = res.campaigns.filter(c => !existingIds.has(c._id));
        return [...prev, ...fresh];
      });
      setCurrentPage(nextPage);
      setHasMore(nextPage * CAMPAIGNS_LIMIT < res.total);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [currentPage, statusFilter]);

  const handleSend = useCallback(async (id: string, campaign: Campaign) => {
    const eligible = campaign.eligibleCount ?? 0;
    const confirmMsg = eligible > 0
      ? `Send "${campaign.name}" to ${eligible.toLocaleString()} eligible customer${eligible !== 1 ? 's' : ''}?\n\nOnly opted-in customers with a phone number will receive the message.`
      : `"${campaign.name}" currently has no eligible opted-in recipients. Send anyway?`;
    if (!confirm(confirmMsg)) return;
    setSending(id);
    try {
      const res = await sendCampaign(id);
      setSendResult(res);
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(null);
    }
  }, [load]);

  const handleCancel = useCallback(async (id: string) => {
    if (!confirm('Cancel this campaign? This cannot be undone.')) return;
    setCancelling(id);
    try {
      await cancelCampaign(id);
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setCancelling(null);
    }
  }, [load]);

  const handleDuplicate = useCallback(async (id: string) => {
    setDuplicating(id);
    try {
      const res = await duplicateCampaign(id);
      void load();
      setEditCampaign(res.campaign); // open the clone for editing immediately
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to duplicate');
    } finally {
      setDuplicating(null);
    }
  }, [load]);

  const handleCampaignSaved = useCallback((updated: Campaign) => {
    setCampaigns(prev => prev.map(c => c._id === updated._id ? updated : c));
  }, []);

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all',       label: 'All'       },
    { key: 'draft',     label: 'Drafts'    },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'sent',      label: 'Sent'      },
    { key: 'failed',    label: 'Failed'    },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            <MessageCircle size={16} className="text-brand" />
            <h1 className="text-sm font-bold text-ink">Campaigns</h1>
            {total > 0 && <span className="text-[10px] text-ink/30">{total} total</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} disabled={loading}
              className="rounded-lg p-1.5 text-ink/30 hover:bg-ink/5 disabled:opacity-40">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
              <Plus size={12} />New Campaign
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-0.5">
          {tabs.map(({ key, label }) => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[11px] font-semibold transition-colors ${
                statusFilter === key ? 'border-brand text-brand' : 'border-transparent text-ink/40 hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Provider warning — shown only when no provider is configured */}
      {!providerStatus.whatsapp && !providerStatus.sms && (
        <div className="shrink-0 flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2">
          <AlertTriangle size={11} className="shrink-0 text-amber-600" />
          <p className="text-[11px] text-amber-800">
            <span className="font-semibold">WhatsApp / SMS provider not configured.</span>{' '}
            Campaigns can be created and scheduled but actual delivery requires a provider in Settings → Integrations.
            Send buttons are disabled until a provider is connected.
          </p>
        </div>
      )}

      {/* Campaign list */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex h-48 items-center justify-center"><Spinner size="lg" /></div>
        ) : campaigns.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <MessageCircle size={36} className="mb-3 text-ink/10" />
            <p className="text-sm font-medium text-ink/30">
              {statusFilter === 'all' ? 'No campaigns yet' : `No ${statusFilter} campaigns`}
            </p>
            <p className="mt-1 text-xs text-ink/20">Create a campaign to send WhatsApp or SMS messages to your customers</p>
            <button onClick={() => setShowCreate(true)}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90">
              <Plus size={12} />Create your first campaign
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map(camp => {
              const sc = STATUS_CONFIG[camp.status];
              const optedOut = (camp.recipientCount ?? 0) - (camp.eligibleCount ?? 0);
              return (
                <div key={camp._id} className="rounded-xl border border-border bg-canvas p-5 hover:border-brand/20 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Name + badges */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold text-ink truncate">{camp.name}</h3>
                        <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sc.cls}`}>
                          <sc.Icon size={9} />{sc.label}
                        </span>
                        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-ink/50 capitalize">
                          {camp.channel}
                        </span>
                      </div>

                      {/* Meta */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink/40">
                        <span className="flex items-center gap-1">
                          <Users size={10} />
                          {AUDIENCE_LABELS[camp.audience]}
                          {' · '}
                          <span className="text-brand font-medium">{(camp.eligibleCount ?? 0).toLocaleString()} eligible</span>
                          {optedOut > 0 && (
                            <span className="text-ink/30"> ({optedOut} opted-out excluded)</span>
                          )}
                        </span>
                        {camp.scheduledAt && camp.status === 'scheduled' && (
                          <span className="flex items-center gap-1 text-amber-700">
                            <Clock size={10} />Fires at {formatDateTime(camp.scheduledAt)}
                          </span>
                        )}
                        {camp.sentAt && (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={10} />Sent {formatDate(camp.sentAt)}
                          </span>
                        )}
                        {(camp.status === 'sent' || camp.status === 'partial') && (camp.sentCount > 0 || camp.failedCount > 0) && (
                          <span className="flex items-center gap-1">
                            <span className="text-green-600 font-medium">{camp.sentCount.toLocaleString()} sent</span>
                            {camp.failedCount > 0 && (
                              <span className="text-red-500">, {camp.failedCount.toLocaleString()} failed</span>
                            )}
                          </span>
                        )}
                        <span>Created {formatDate(camp.createdAt)}</span>
                      </div>

                      {/* Message preview */}
                      <p className="mt-2 text-xs text-ink/50 line-clamp-2 leading-relaxed font-mono bg-mist rounded px-2 py-1">
                        {camp.messageTemplate}
                      </p>

                      {/* Failure reason */}
                      {camp.failureReason && (
                        <div className="mt-2 flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5">
                          <XCircle size={10} className="shrink-0 text-red-500 mt-0.5" />
                          <p className="text-[11px] text-red-700">{camp.failureReason}</p>
                        </div>
                      )}

                      {/* Status explanation */}
                      <p className="mt-1.5 text-[10px] text-ink/30 italic">{sc.desc}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 flex-col gap-1.5">
                      {/* Send / Retry button — available for draft, failed, partial campaigns */}
                      {(['draft', 'failed', 'partial'] as CampaignStatus[]).includes(camp.status) && (
                        providerStatus[camp.channel as 'whatsapp' | 'sms'] ? (
                          <button
                            onClick={() => void handleSend(camp._id, camp)}
                            disabled={sending === camp._id}
                            className="flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/5 px-3 py-1.5 text-[11px] font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
                          >
                            {sending === camp._id ? <Spinner size="sm" /> : <Send size={10} />}
                            {camp.status === 'draft' ? 'Send Now' : 'Retry'}
                          </button>
                        ) : (
                          <div
                            title="Connect MSG91 in Settings → Integrations to enable delivery"
                            className="flex cursor-not-allowed items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-ink/25"
                          >
                            <Send size={10} />No Provider
                          </div>
                        )
                      )}
                      {/* Sending indicator — non-interactive */}
                      {camp.status === 'sending' && (
                        <div className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-600">
                          <RefreshCw size={10} className="animate-spin" />
                          Sending…
                        </div>
                      )}
                      {/* Edit — available for draft, scheduled, failed, partial */}
                      {(['draft', 'scheduled', 'failed', 'partial'] as CampaignStatus[]).includes(camp.status) && (
                        <button
                          onClick={() => setEditCampaign(camp)}
                          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-ink/50 hover:bg-mist hover:text-ink"
                        >
                          <Edit2 size={10} />Edit
                        </button>
                      )}
                      {/* Test Send — available for draft, scheduled, failed, partial when provider configured */}
                      {(['draft', 'scheduled', 'failed', 'partial'] as CampaignStatus[]).includes(camp.status) &&
                        providerStatus[camp.channel as 'whatsapp' | 'sms'] && (
                        <button
                          onClick={() => setTestSendTarget(camp)}
                          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-ink/50 hover:bg-mist hover:text-ink"
                        >
                          <FlaskConical size={10} />Test Send
                        </button>
                      )}
                      {/* Delivery report — available for sent, partial */}
                      {(['sent', 'partial'] as CampaignStatus[]).includes(camp.status) && (
                        <button
                          onClick={() => setReportCampaign(camp)}
                          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-ink/50 hover:bg-mist hover:text-ink"
                        >
                          <BarChart2 size={10} />Report
                        </button>
                      )}
                      {/* Duplicate — available for all statuses */}
                      <button
                        onClick={() => void handleDuplicate(camp._id)}
                        disabled={duplicating === camp._id}
                        className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-ink/40 hover:bg-mist hover:text-ink disabled:opacity-50"
                      >
                        {duplicating === camp._id ? <Spinner size="sm" /> : <Copy size={10} />}
                        Duplicate
                      </button>
                      {/* Cancel — available for draft, scheduled, failed, partial */}
                      {(['draft', 'scheduled', 'failed', 'partial'] as CampaignStatus[]).includes(camp.status) && (
                        <button
                          onClick={() => void handleCancel(camp._id)}
                          disabled={cancelling === camp._id}
                          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-ink/40 hover:bg-mist hover:text-ink disabled:opacity-50"
                        >
                          {cancelling === camp._id ? <Spinner size="sm" /> : <X size={10} />}
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-ink/50 hover:bg-mist disabled:opacity-50"
            >
              {loadingMore ? <Spinner size="sm" /> : <ChevronDown size={12} />}
              {loadingMore ? 'Loading…' : `Load More (${total - campaigns.length} remaining)`}
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => void load()}
          providerStatus={providerStatus}
        />
      )}

      {editCampaign && (
        <EditModal
          campaign={editCampaign}
          onClose={() => setEditCampaign(null)}
          onSaved={c => { handleCampaignSaved(c); setEditCampaign(null); }}
          providerStatus={providerStatus}
        />
      )}

      {sendResult && (
        <SendResultModal result={sendResult} onClose={() => setSendResult(null)} />
      )}

      {reportCampaign && (
        <DeliveryReportModal
          campaign={reportCampaign}
          onClose={() => setReportCampaign(null)}
        />
      )}

      {testSendTarget && (
        <TestSendModal
          campaign={testSendTarget}
          onClose={() => setTestSendTarget(null)}
        />
      )}
    </div>
  );
}
