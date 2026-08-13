import { useState, useEffect, useCallback } from 'react';
import {
  MessageCircle, Plus, Send, Clock, CheckCircle2, XCircle,
  ChevronDown, AlertTriangle, Users, RefreshCw, X,
} from 'lucide-react';
import type { Campaign, CampaignAudience, CampaignStatus } from '../types/customers';
import {
  fetchCampaigns, createCampaign, sendCampaign, cancelCampaign,
} from '../api/campaigns';
import { Spinner } from '../components/ui/Spinner';

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  all:        'All Customers',
  new:        'New Customers',
  repeat:     'Repeat Customers',
  vip:        'VIP / Top Spenders',
  inactive30: 'Inactive 30+ Days',
  inactive60: 'Inactive 60+ Days',
  inactive90: 'Inactive 90+ Days',
  birthday:   'Birthday This Month',
  anniversary:'Anniversary This Month',
  loyalty:    'Loyalty Members',
  noloyalty:  'Without Loyalty',
  custom:     'Custom List',
};

const STATUS_CONFIG: Record<CampaignStatus, { label: string; cls: string; Icon: React.ElementType }> = {
  draft:     { label: 'Draft',     cls: 'text-ink/50 bg-mist',                  Icon: Clock         },
  scheduled: { label: 'Scheduled', cls: 'text-amber-700 bg-amber-100',           Icon: Clock         },
  sent:      { label: 'Sent',      cls: 'text-green-700 bg-green-100',           Icon: CheckCircle2  },
  failed:    { label: 'Failed',    cls: 'text-red-700 bg-red-100',               Icon: XCircle       },
  cancelled: { label: 'Cancelled', cls: 'text-ink/30 bg-ink/5',                  Icon: XCircle       },
};

const TEMPLATE_VARS = ['{name}', '{hotel}', '{lastOrderDate}', '{points}', '{pointsBalance}'];

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Create Campaign Modal ──────────────────────────────────────────────────────

interface CreateModalProps {
  onClose:   () => void;
  onCreated: (c: Campaign) => void;
}

function CreateModal({ onClose, onCreated }: CreateModalProps) {
  const [name,     setName]     = useState('');
  const [channel,  setChannel]  = useState<'whatsapp' | 'sms'>('whatsapp');
  const [audience, setAudience] = useState<CampaignAudience>('all');
  const [message,  setMessage]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const insertVar = (v: string) => setMessage(prev => prev + v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim())    { setError('Campaign name is required'); return; }
    if (!message.trim()) { setError('Message template is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await createCampaign({ name: name.trim(), channel, audience, messageTemplate: message });
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
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-canvas shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Create Campaign</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink"><X size={16} /></button>
        </div>

        <form onSubmit={e => void handleSubmit(e)} className="space-y-4 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={12} />{error}
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
                <select
                  value={channel}
                  onChange={e => setChannel(e.target.value as 'whatsapp' | 'sms')}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-mist px-3 pr-8 text-sm text-ink outline-none focus:border-brand/50"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/40">Audience</label>
              <div className="relative">
                <select
                  value={audience}
                  onChange={e => setAudience(e.target.value as CampaignAudience)}
                  className="h-9 w-full appearance-none rounded-lg border border-border bg-mist px-3 pr-8 text-sm text-ink outline-none focus:border-brand/50"
                >
                  {(Object.entries(AUDIENCE_LABELS) as [CampaignAudience, string][])
                    .filter(([k]) => k !== 'custom')
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)
                  }
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40" />
              </div>
            </div>
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
            <p className="mt-1 text-[10px] text-ink/30">{message.length} characters</p>
          </div>

          {/* Preview */}
          {message && (
            <div className="rounded-lg border border-brand/20 bg-brand/5 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-brand/60">Preview</p>
              <p className="text-xs text-ink/80 whitespace-pre-wrap">
                {message
                  .replace(/{name}/g,          'Ramesh Kumar')
                  .replace(/{hotel}/g,         'Your Restaurant')
                  .replace(/{lastOrderDate}/g, '10 Aug 2026')
                  .replace(/{points}/g,        '120')
                  .replace(/{pointsBalance}/g, '450')
                }
              </p>
            </div>
          )}

          {/* Provider note */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-[11px] text-amber-800">
              <span className="font-semibold">No {channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} provider configured.</span>{' '}
              You can create and save this campaign as a draft. Actual sending requires a provider integration.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-ink/60 hover:bg-mist">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
              {saving ? <Spinner size="sm" /> : <Plus size={13} />}
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Send Result modal ─────────────────────────────────────────────────────────

interface SendResultProps {
  result: { status: string; message: string; campaign: { name: string; channel: string; recipientCount: number } };
  onClose: () => void;
}

function SendResultModal({ result, onClose }: SendResultProps) {
  const isNoProvider = result.status === 'no_provider';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas p-6 shadow-2xl text-center">
        {isNoProvider ? (
          <AlertTriangle size={36} className="mx-auto mb-4 text-amber-500" />
        ) : (
          <CheckCircle2 size={36} className="mx-auto mb-4 text-green-500" />
        )}
        <h2 className="mb-2 text-sm font-bold text-ink">
          {isNoProvider ? 'Provider Not Configured' : 'Campaign Sent!'}
        </h2>
        <p className="mb-1 text-xs text-ink/60">{result.message}</p>
        {!isNoProvider && (
          <p className="text-xs text-ink/40">
            {result.campaign.recipientCount} recipients via {result.campaign.channel}
          </p>
        )}
        <button onClick={onClose}
          className="mt-5 w-full rounded-lg bg-brand py-2 text-sm font-medium text-white hover:bg-brand/90">
          OK
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | CampaignStatus;

export function CampaignsPage() {
  const [campaigns, setCampaigns]     = useState<Campaign[]>([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showCreate, setShowCreate]   = useState(false);
  const [sending, setSending]         = useState<string | null>(null);
  const [cancelling, setCancelling]   = useState<string | null>(null);
  const [sendResult, setSendResult]   = useState<SendResultProps['result'] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCampaigns({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 50,
      });
      setCampaigns(res.campaigns);
      setTotal(res.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const handleSend = useCallback(async (id: string) => {
    if (!confirm('Send this campaign now?')) return;
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
    if (!confirm('Cancel this campaign?')) return;
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
        {/* Title row */}
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
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
            >
              <Plus size={12} />New Campaign
            </button>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-0.5">
          {tabs.map(({ key, label }) => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[11px] font-semibold transition-colors ${
                statusFilter === key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink/40 hover:text-ink'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Provider warning banner */}
      <div className="shrink-0 flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
        <AlertTriangle size={12} className="shrink-0 text-amber-600" />
        <p className="text-[11px] text-amber-800">
          <span className="font-semibold">WhatsApp / SMS provider not configured.</span>{' '}
          Campaigns can be created and saved as drafts. To actually send messages, configure a provider in Settings → Integrations.
        </p>
      </div>

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
            <p className="mt-1 text-xs text-ink/20">
              Create a campaign to send WhatsApp or SMS messages to your customers
            </p>
            <button onClick={() => setShowCreate(true)}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90">
              <Plus size={12} />Create your first campaign
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map(camp => {
              const sc = STATUS_CONFIG[camp.status];
              return (
                <div key={camp._id} className="rounded-xl border border-border bg-canvas p-5 hover:border-brand/30 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold text-ink truncate">{camp.name}</h3>
                        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sc.cls}`}>
                          <sc.Icon size={9} />{sc.label}
                        </span>
                        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-ink/50 capitalize">
                          {camp.channel}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink/40">
                        <span className="flex items-center gap-1">
                          <Users size={10} />
                          {AUDIENCE_LABELS[camp.audience]} · {camp.recipientCount} recipients
                        </span>
                        {camp.scheduledAt && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />Scheduled {formatDate(camp.scheduledAt)}
                          </span>
                        )}
                        {camp.sentAt && (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={10} />Sent {formatDate(camp.sentAt)}
                          </span>
                        )}
                        <span>Created {formatDate(camp.createdAt)}</span>
                      </div>

                      {/* Message preview */}
                      <p className="mt-2 text-xs text-ink/50 line-clamp-2 leading-relaxed">
                        {camp.messageTemplate}
                      </p>

                      {camp.failureReason && (
                        <p className="mt-1 text-[11px] text-red-600">
                          <span className="font-semibold">Error:</span> {camp.failureReason}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 flex-col gap-1.5">
                      {(camp.status === 'draft' || camp.status === 'scheduled') && (
                        <button
                          onClick={() => void handleSend(camp._id)}
                          disabled={sending === camp._id}
                          className="flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/5 px-3 py-1.5 text-[11px] font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
                        >
                          {sending === camp._id ? <Spinner size="sm" /> : <Send size={10} />}
                          Send Now
                        </button>
                      )}
                      {camp.status !== 'sent' && camp.status !== 'cancelled' && (
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
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { void load(); }}
        />
      )}

      {sendResult && (
        <SendResultModal
          result={sendResult}
          onClose={() => setSendResult(null)}
        />
      )}
    </div>
  );
}
