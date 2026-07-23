// M9 — Lead Timeline + M10 Audit + status/priority/assignee editing + notes

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Trash2, Plus, RefreshCw } from 'lucide-react';
import {
  SAPageHeader, SABadge, SASpin, SAError, fmtDateTime,
} from '../../components/ui/SAShared';
import {
  getLead, updateLead, addTimelineEntry, deleteLead,
  type Lead, STATUS_LABELS, SOURCE_LABELS, STATUS_ORDER,
} from '../../api/saLeads';

const PRIORITY_VARIANT = { high: 'red', medium: 'amber', low: 'gray' } as const;
const STATUS_VARIANT: Record<string, 'green' | 'blue' | 'red' | 'amber' | 'gray'> = {
  new:            'blue',
  contacted:      'amber',
  demo_scheduled: 'amber',
  proposal_sent:  'blue',
  won:            'green',
  lost:           'red',
};

export function LeadDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();

  const [lead,    setLead]    = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);

  // Editable fields
  const [status,     setStatus]     = useState('');
  const [priority,   setPriority]   = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [notes,      setNotes]      = useState('');
  const [dirty,      setDirty]      = useState(false);

  // Add timeline entry
  const [tlEvent,  setTlEvent]  = useState('');
  const [tlNote,   setTlNote]   = useState('');
  const [tlSaving, setTlSaving] = useState(false);
  const [tlError,  setTlError]  = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const { lead: l } = await getLead(id);
      setLead(l);
      setStatus(l.status);
      setPriority(l.priority);
      setAssignedTo(l.assignedTo ?? '');
      setNotes(l.notes ?? '');
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lead');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!id || !dirty) return;
    setSaving(true);
    try {
      const { lead: l } = await updateLead(id, { status: status as Lead['status'], priority: priority as Lead['priority'], assignedTo, notes });
      setLead(l);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async () => {
    if (!id || !tlEvent.trim()) return;
    setTlSaving(true); setTlError('');
    try {
      const { lead: l } = await addTimelineEntry(id, tlEvent.trim(), tlNote.trim() || undefined);
      setLead(l);
      setTlEvent(''); setTlNote('');
    } catch (e) {
      setTlError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setTlSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!id) return;
    if (!window.confirm(`Delete lead "${lead?.companyName}"? This cannot be undone.`)) return;
    try {
      await deleteLead(id);
      navigate('/super-admin/leads');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  if (loading) return <div className="flex h-full items-center justify-center"><SASpin /></div>;
  if (error && !lead) return (
    <div className="p-8">
      <SAError message={error} onRetry={() => void load()} />
    </div>
  );
  if (!lead) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title={lead.companyName}
        sub={`${lead.ownerName} · ${lead.phone} · ${SOURCE_LABELS[lead.source]}`}
        onRefresh={() => void load()}
        refreshing={loading}
        action={
          <div className="flex gap-2">
            <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-xs text-ink/50 hover:text-ink px-3 py-1.5 rounded-lg border border-border">
              <ArrowLeft size={14} /> Back
            </button>
            <button onClick={() => void confirmDelete()} className="flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
              <Trash2 size={14} /> Delete
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {error && <SAError message={error} onRetry={() => void load()} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left — Edit panel */}
          <div className="lg:col-span-1 space-y-5">
            <div className="rounded-xl border border-border bg-canvas p-5 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-ink/40">Lead Details</p>

              <div className="space-y-1">
                <p className="text-xs text-ink/50">Email</p>
                <p className="text-sm font-medium text-ink">{lead.email}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-ink/50">City / State</p>
                <p className="text-sm text-ink">{[lead.city, lead.state, lead.country].filter(Boolean).join(', ') || '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-ink/50">Restaurant Type</p>
                <p className="text-sm text-ink">{lead.restaurantType || '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-ink/50">Business Type</p>
                <p className="text-sm text-ink">{lead.businessType || '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-ink/50">Source</p>
                <SABadge label={SOURCE_LABELS[lead.source]} variant="gray" />
              </div>
            </div>

            {/* Editable fields */}
            <div className="rounded-xl border border-border bg-canvas p-5 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-ink/40">CRM Actions</p>

              <div>
                <label className="block text-xs text-ink/50 mb-1">Status</label>
                <select
                  value={status}
                  onChange={e => { setStatus(e.target.value); setDirty(true); }}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none"
                >
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-ink/50 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={e => { setPriority(e.target.value); setDirty(true); }}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none"
                >
                  {['high', 'medium', 'low'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-ink/50 mb-1">Assigned To</label>
                <input
                  value={assignedTo}
                  onChange={e => { setAssignedTo(e.target.value); setDirty(true); }}
                  placeholder="Team member name"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-ink/50 mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={e => { setNotes(e.target.value); setDirty(true); }}
                  rows={4}
                  placeholder="Internal notes…"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none resize-none"
                />
              </div>

              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand text-canvas py-2.5 text-sm font-semibold hover:bg-brand/90 disabled:opacity-40 transition"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </div>

            {/* Status badge summary */}
            <div className="flex gap-2 flex-wrap">
              <SABadge label={STATUS_LABELS[lead.status]} variant={STATUS_VARIANT[lead.status] ?? 'gray'} />
              <SABadge label={lead.priority} variant={PRIORITY_VARIANT[lead.priority] ?? 'gray'} />
            </div>
          </div>

          {/* Right — Timeline */}
          <div className="lg:col-span-2 space-y-5">
            {/* Add entry */}
            <div className="rounded-xl border border-border bg-canvas p-5 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-ink/40">Add Timeline Entry</p>
              <input
                value={tlEvent}
                onChange={e => setTlEvent(e.target.value)}
                placeholder="Event (e.g. Called, Sent proposal, Follow-up scheduled)"
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none"
              />
              <input
                value={tlNote}
                onChange={e => setTlNote(e.target.value)}
                placeholder="Note (optional)"
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none"
              />
              {tlError && <p className="text-xs text-red-600">{tlError}</p>}
              <button
                onClick={() => void addEntry()}
                disabled={!tlEvent.trim() || tlSaving}
                className="flex items-center gap-1.5 rounded-lg border border-brand bg-brand/5 text-brand px-4 py-2 text-sm font-semibold hover:bg-brand/10 disabled:opacity-40 transition"
              >
                {tlSaving ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                Add Entry
              </button>
            </div>

            {/* M9 — Timeline */}
            <div className="rounded-xl border border-border bg-canvas p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-ink/40 mb-4">
                Timeline ({lead.timeline.length})
              </p>
              {lead.timeline.length === 0 ? (
                <p className="text-sm text-ink/40">No timeline entries yet.</p>
              ) : (
                <ol className="relative border-l border-border ml-3 space-y-6">
                  {[...lead.timeline].reverse().map((entry, i) => (
                    <li key={i} className="ml-4">
                      <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-canvas bg-brand/60" />
                      <p className="text-sm font-semibold text-ink">{entry.event}</p>
                      {entry.note && <p className="text-xs text-ink/60 mt-0.5">{entry.note}</p>}
                      <p className="text-[10px] text-ink/30 mt-1">
                        {entry.actor ? `${entry.actor} · ` : ''}{fmtDateTime(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
