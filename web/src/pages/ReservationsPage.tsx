import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, RefreshCw, CalendarDays, Users, Phone, Clock, X, Check,
  Edit2, ChevronDown, AlertCircle, Bell, UserCheck, Ban, LogIn,
  CheckCircle2, List, ListChecks,
} from 'lucide-react';
import type { Reservation, ReservationStatus, WaitlistEntry } from '../types';
import {
  fetchReservations, fetchReservationStats, createReservation,
  updateReservation, updateReservationStatus, deleteReservation,
  fetchWaitlist, addToWaitlist, updateWaitlistStatus, removeFromWaitlist,
  type CreateReservationInput,
} from '../api/reservations';
import { Spinner } from '../components/ui/Spinner';

// ── Constants ─────────────────────────────────────────────────────────────────

const TIME_SLOTS = [
  '08:00 AM','08:30 AM','09:00 AM','09:30 AM','10:00 AM','10:30 AM',
  '11:00 AM','11:30 AM','12:00 PM','12:30 PM',
  '01:00 PM','01:30 PM','02:00 PM','02:30 PM','03:00 PM','03:30 PM',
  '04:00 PM','04:30 PM','05:00 PM','05:30 PM',
  '06:00 PM','06:30 PM','07:00 PM','07:30 PM',
  '08:00 PM','08:30 PM','09:00 PM','09:30 PM','10:00 PM',
];

const SOURCES = [
  { value: 'phone',     label: 'Phone call' },
  { value: 'walk_in',   label: 'Walk-in' },
  { value: 'website',   label: 'Website' },
  { value: 'whatsapp',  label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'other',     label: 'Other' },
];

const STATUS_STYLE: Record<ReservationStatus, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  arrived:   'bg-indigo-50 text-indigo-700 border-indigo-200',
  seated:    'bg-green-50 text-green-700 border-green-200',
  completed: 'bg-ink/5 text-ink/50 border-ink/10',
  cancelled: 'bg-ink/5 text-ink/30 border-ink/10',
  no_show:   'bg-red-50 text-red-600 border-red-200',
};

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending:   'Pending',
  confirmed: 'Confirmed',
  arrived:   'Arrived',
  seated:    'Seated',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show:   'No-show',
};

const ALL_STATUSES: ReservationStatus[] = [
  'pending', 'confirmed', 'arrived', 'seated', 'completed', 'cancelled', 'no_show',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function fmtDate(iso: string) {
  return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short',
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ── Reservation Form ──────────────────────────────────────────────────────────

interface ResFormState {
  customerName: string;
  phone: string;
  email: string;
  partySize: string;
  date: string;
  time: string;
  occasion: string;
  source: string;
  notes: string;
  tableNumber: string;
  durationMinutes: string;
  depositAmount: string;
  depositStatus: string;
}

const BLANK_FORM: ResFormState = {
  customerName: '',
  phone: '',
  email: '',
  partySize: '2',
  date: todayStr(),
  time: '07:00 PM',
  occasion: '',
  source: 'phone',
  notes: '',
  tableNumber: '',
  durationMinutes: '90',
  depositAmount: '0',
  depositStatus: 'none',
};

function formFromReservation(r: Reservation): ResFormState {
  return {
    customerName:    r.customerName,
    phone:           r.phone,
    email:           r.email || '',
    partySize:       String(r.partySize),
    date:            r.date.slice(0, 10),
    time:            r.time,
    occasion:        r.occasion || '',
    source:          r.source || 'phone',
    notes:           r.notes || '',
    tableNumber:     r.tableNumber ? String(r.tableNumber) : '',
    durationMinutes: String(r.durationMinutes ?? 90),
    depositAmount:   String(r.depositAmount ?? 0),
    depositStatus:   r.depositStatus || 'none',
  };
}

interface ResFormProps {
  initial?: ResFormState;
  onSave(f: ResFormState): void;
  onCancel(): void;
  saving: boolean;
  error: string | null;
  title: string;
}

function ResForm({ initial, onSave, onCancel, saving, error, title }: ResFormProps) {
  const [form, setForm] = useState<ResFormState>(initial ?? BLANK_FORM);
  const set = <K extends keyof ResFormState>(k: K, v: string) =>
    setForm(p => ({ ...p, [k]: v }));

  const inputCls =
    'block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20';

  const valid = form.customerName.trim() && form.phone.trim() && form.partySize && form.date && form.time;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-ink/40">{title}</p>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Name *</label>
          <input className={inputCls} value={form.customerName} onChange={e => set('customerName', e.target.value)} placeholder="Guest name" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Phone *</label>
          <input className={inputCls} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="Mobile number" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Email</label>
          <input className={inputCls} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Party size *</label>
          <input className={inputCls} type="number" min={1} max={200} value={form.partySize} onChange={e => set('partySize', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Date *</label>
          <input className={inputCls} type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Time *</label>
          <select className={inputCls} value={form.time} onChange={e => set('time', e.target.value)}>
            {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Duration (min)</label>
          <select className={inputCls} value={form.durationMinutes} onChange={e => set('durationMinutes', e.target.value)}>
            {[60,90,120,150,180].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Table #</label>
          <input className={inputCls} type="number" value={form.tableNumber} onChange={e => set('tableNumber', e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Source</label>
          <select className={inputCls} value={form.source} onChange={e => set('source', e.target.value)}>
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink/50">Occasion</label>
          <input className={inputCls} value={form.occasion} onChange={e => set('occasion', e.target.value)} placeholder="Birthday, anniversary…" />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-semibold text-ink/50">Notes</label>
          <input className={inputCls} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Dietary requirements, preferences…" />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !valid}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          <Check size={13} />
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-ink/50 hover:bg-ink/5"
        >
          <X size={13} />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Status action buttons per lifecycle ───────────────────────────────────────

interface ActionsProps {
  res: Reservation;
  acting: boolean;
  onStatus(id: string, status: ReservationStatus, extra?: { cancellationReason?: string }): void;
  onEdit(res: Reservation): void;
  onDelete(id: string): void;
}

function ResActions({ res, acting, onStatus, onEdit, onDelete }: ActionsProps) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const { status } = res;

  if (status === 'completed' || status === 'cancelled' || status === 'no_show') {
    return (
      <div className="flex items-center gap-1 shrink-0">
        {confirmDel ? (
          <>
            <span className="text-xs text-brand">Delete?</span>
            <button onClick={() => onDelete(res._id)} className="text-xs font-semibold text-brand hover:underline">Yes</button>
            <button onClick={() => setConfirmDel(false)} className="text-xs text-ink/40 hover:underline">No</button>
          </>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="text-xs text-ink/20 hover:text-brand">
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {/* Edit */}
      <button
        onClick={() => onEdit(res)}
        title="Edit reservation"
        className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink/70"
      >
        <Edit2 size={12} />
      </button>

      {/* Status-specific primary actions */}
      {status === 'pending' && (
        <button
          disabled={acting}
          onClick={() => onStatus(res._id, 'confirmed')}
          className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Check size={11} /> Confirm
        </button>
      )}

      {status === 'confirmed' && (
        <button
          disabled={acting}
          onClick={() => onStatus(res._id, 'arrived')}
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <LogIn size={11} /> Arrived
        </button>
      )}

      {status === 'arrived' && (
        <button
          disabled={acting}
          onClick={() => onStatus(res._id, 'seated')}
          className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          <UserCheck size={11} /> Seat
        </button>
      )}

      {status === 'seated' && (
        <button
          disabled={acting}
          onClick={() => onStatus(res._id, 'completed')}
          className="flex items-center gap-1 rounded-lg bg-ink/80 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-ink disabled:opacity-50"
        >
          <CheckCircle2 size={11} /> Complete
        </button>
      )}

      {/* Secondary: no-show (confirmed only) */}
      {status === 'confirmed' && (
        <button
          disabled={acting}
          onClick={() => onStatus(res._id, 'no_show')}
          className="rounded-lg border border-red-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
          title="Mark no-show"
        >
          <AlertCircle size={12} />
        </button>
      )}

      {/* Cancel: inline with reason input */}
      {!cancelOpen ? (
        <button
          disabled={acting}
          onClick={() => setCancelOpen(true)}
          className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink/40 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          title="Cancel"
        >
          <Ban size={12} />
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-36 rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-brand/50"
            onKeyDown={e => {
              if (e.key === 'Enter') { onStatus(res._id, 'cancelled', { cancellationReason: cancelReason }); setCancelOpen(false); }
              if (e.key === 'Escape') { setCancelOpen(false); }
            }}
          />
          <button
            onClick={() => { onStatus(res._id, 'cancelled', { cancellationReason: cancelReason }); setCancelOpen(false); }}
            className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
          >
            Cancel booking
          </button>
          <button onClick={() => setCancelOpen(false)} className="text-xs text-ink/30 hover:text-ink/60">Esc</button>
        </div>
      )}

      {/* Hard delete (always accessible) */}
      {confirmDel ? (
        <>
          <span className="text-xs text-brand">Delete?</span>
          <button onClick={() => onDelete(res._id)} className="text-xs font-semibold text-brand hover:underline">Yes</button>
          <button onClick={() => setConfirmDel(false)} className="text-xs text-ink/40 hover:underline">No</button>
        </>
      ) : (
        <button onClick={() => setConfirmDel(true)} className="text-xs text-ink/20 hover:text-brand" title="Delete permanently">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ── Reservation card ──────────────────────────────────────────────────────────

interface ResCardProps {
  res: Reservation;
  acting: boolean;
  onStatus(id: string, status: ReservationStatus, extra?: { cancellationReason?: string }): void;
  onEdit(res: Reservation): void;
  onDelete(id: string): void;
}

function ResCard({ res, acting, onStatus, onEdit, onDelete }: ResCardProps) {
  return (
    <div className="rounded-xl border border-border bg-canvas p-4 transition-shadow hover:shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <p className="font-semibold text-ink">{res.customerName}</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[res.status]}`}>
              {STATUS_LABELS[res.status]}
            </span>
            {res.occasion && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                {res.occasion}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1 text-xs text-ink/50">
              <CalendarDays size={11} />
              {fmtDate(res.date)}
            </span>
            <span className="flex items-center gap-1 text-xs text-ink/50">
              <Clock size={11} />
              {res.time}
              {res.durationMinutes && res.durationMinutes !== 90 && (
                <span className="text-ink/30">· {res.durationMinutes}min</span>
              )}
            </span>
            <span className="flex items-center gap-1 text-xs text-ink/50">
              <Users size={11} />
              {res.partySize} guests
            </span>
            <span className="flex items-center gap-1 text-xs text-ink/50">
              <Phone size={11} />
              {res.phone}
            </span>
            {res.tableNumber && (
              <span className="text-xs text-ink/50">Table {res.tableNumber}</span>
            )}
          </div>

          {res.notes && (
            <p className="mt-1.5 text-xs italic text-ink/40">{res.notes}</p>
          )}
          {res.cancellationReason && (
            <p className="mt-1 text-xs text-red-500">Reason: {res.cancellationReason}</p>
          )}
          {res.arrivedAt && (
            <p className="mt-1 text-xs text-indigo-500">Arrived at {fmtTime(res.arrivedAt)}</p>
          )}
        </div>

        {/* Actions */}
        <ResActions res={res} acting={acting} onStatus={onStatus} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

// ── Waitlist tab ──────────────────────────────────────────────────────────────

interface WaitlistTabProps {
  hotelId?: string;
}

function WaitlistTab(_props: WaitlistTabProps) {
  const [entries, setEntries]   = useState<WaitlistEntry[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [addOpen, setAddOpen]   = useState(false);
  const [acting, setActing]     = useState(false);
  const [form, setForm]         = useState({ guestName: '', phone: '', partySize: '2', seatingPreference: '', notes: '', estimatedWaitMinutes: '15' });
  const [formErr, setFormErr]   = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);

  const loadWaitlist = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetchWaitlist();
      setEntries(r.entries); setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWaitlist(); }, [loadWaitlist]);

  async function handleAdd() {
    setFormErr(null); setSaving(true);
    try {
      await addToWaitlist({
        guestName:            form.guestName.trim(),
        phone:                form.phone.trim(),
        partySize:            parseInt(form.partySize),
        seatingPreference:    form.seatingPreference.trim() || undefined,
        notes:                form.notes.trim() || undefined,
        estimatedWaitMinutes: parseInt(form.estimatedWaitMinutes) || 0,
      });
      setAddOpen(false);
      setForm({ guestName: '', phone: '', partySize: '2', seatingPreference: '', notes: '', estimatedWaitMinutes: '15' });
      void loadWaitlist();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: WaitlistEntry['status']) {
    setActing(true);
    try { await updateWaitlistStatus(id, status); void loadWaitlist(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to update'); }
    finally { setActing(false); }
  }

  async function handleRemove(id: string) {
    setActing(true);
    try { await removeFromWaitlist(id); void loadWaitlist(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to remove'); }
    finally { setActing(false); }
  }

  const inputCls = 'block w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20';

  const WAITLIST_STATUS_STYLE: Record<WaitlistEntry['status'], string> = {
    waiting:   'bg-amber-50 text-amber-700 border-amber-200',
    notified:  'bg-blue-50 text-blue-700 border-blue-200',
    seated:    'bg-green-50 text-green-700 border-green-200',
    cancelled: 'bg-ink/5 text-ink/30 border-ink/10',
    expired:   'bg-ink/5 text-ink/30 border-ink/10',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink/70">{total} waiting</p>
        <div className="flex gap-2">
          <button onClick={() => void loadWaitlist()} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-ink/40 hover:bg-ink/5">
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => setAddOpen(o => !o)}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
          >
            <Plus size={13} /> Add to waitlist
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {addOpen && (
        <div className="rounded-xl border border-border bg-mist p-4 space-y-3">
          {formErr && <div className="text-xs text-red-600">{formErr}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink/50">Name *</label>
              <input className={inputCls} value={form.guestName} onChange={e => setForm(p => ({...p, guestName: e.target.value}))} placeholder="Guest name" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink/50">Phone *</label>
              <input className={inputCls} value={form.phone} onChange={e => setForm(p => ({...p, phone: e.target.value}))} placeholder="Mobile number" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink/50">Party size *</label>
              <input className={inputCls} type="number" min={1} value={form.partySize} onChange={e => setForm(p => ({...p, partySize: e.target.value}))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink/50">Est. wait (min)</label>
              <input className={inputCls} type="number" min={0} value={form.estimatedWaitMinutes} onChange={e => setForm(p => ({...p, estimatedWaitMinutes: e.target.value}))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink/50">Seating preference</label>
              <input className={inputCls} value={form.seatingPreference} onChange={e => setForm(p => ({...p, seatingPreference: e.target.value}))} placeholder="Window, outdoor, booth…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink/50">Notes</label>
              <input className={inputCls} value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))} placeholder="Optional" />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !form.guestName.trim() || !form.phone.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              <Check size={13} /> {saving ? 'Adding…' : 'Add'}
            </button>
            <button onClick={() => setAddOpen(false)} className="rounded-lg border border-border px-4 py-2 text-xs text-ink/50 hover:bg-ink/5">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center"><Spinner size="lg" /></div>
      ) : entries.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center text-ink/30">
          <ListChecks size={32} className="mb-2 opacity-20" />
          <p className="text-sm">Waitlist is empty</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e, idx) => (
            <div key={e._id} className="flex items-center gap-3 rounded-xl border border-border bg-canvas p-3">
              <span className="w-5 text-center text-xs font-bold text-ink/30">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-ink">{e.guestName}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${WAITLIST_STATUS_STYLE[e.status]}`}>
                    {e.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink/50">
                  <span><Phone size={10} className="inline mr-0.5" />{e.phone}</span>
                  <span><Users size={10} className="inline mr-0.5" />{e.partySize} guests</span>
                  {e.estimatedWaitMinutes ? <span><Clock size={10} className="inline mr-0.5" />~{e.estimatedWaitMinutes}min</span> : null}
                  {e.seatingPreference ? <span>{e.seatingPreference}</span> : null}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {e.status === 'waiting' && (
                  <button
                    disabled={acting}
                    onClick={() => handleStatusChange(e._id, 'notified')}
                    className="flex items-center gap-1 rounded-lg border border-blue-200 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  >
                    <Bell size={11} /> Notify
                  </button>
                )}
                {(e.status === 'waiting' || e.status === 'notified') && (
                  <button
                    disabled={acting}
                    onClick={() => handleStatusChange(e._id, 'seated')}
                    className="flex items-center gap-1 rounded-lg border border-green-200 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                  >
                    <UserCheck size={11} /> Seat
                  </button>
                )}
                {e.status !== 'seated' && e.status !== 'cancelled' && (
                  <button
                    disabled={acting}
                    onClick={() => handleStatusChange(e._id, 'cancelled')}
                    className="rounded-lg border border-border px-2 py-1 text-xs text-ink/40 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <X size={11} />
                  </button>
                )}
                <button onClick={() => handleRemove(e._id)} className="text-xs text-ink/20 hover:text-brand">
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReservationsPage() {
  const [tab,          setTab]          = useState<'reservations' | 'waitlist'>('reservations');
  const [date,         setDate]         = useState(todayStr());
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | 'all'>('all');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [stats,        setStats]        = useState<Record<string, number>>({});
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [addOpen,      setAddOpen]      = useState(false);
  const [editTarget,   setEditTarget]   = useState<Reservation | null>(null);
  const [saving,       setSaving]       = useState(false);
  const [formError,    setFormError]    = useState<string | null>(null);
  const [acting,       setActing]       = useState(false);

  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const id = ++loadRef.current;
    setLoading(true); setError(null);
    try {
      const [res, st] = await Promise.all([
        fetchReservations({
          date,
          status: statusFilter === 'all' ? undefined : statusFilter,
        }),
        fetchReservationStats(date),
      ]);
      if (id !== loadRef.current) return;
      setReservations(res.reservations);
      setTotal(res.total);
      setStats(st as unknown as Record<string, number>);
    } catch (e) {
      if (id !== loadRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load reservations');
    } finally {
      if (id === loadRef.current) setLoading(false);
    }
  }, [date, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  function formToBody(form: ResFormState): CreateReservationInput {
    return {
      customerName:    form.customerName.trim(),
      phone:           form.phone.trim(),
      email:           form.email.trim() || undefined,
      partySize:       parseInt(form.partySize),
      date:            form.date,
      time:            form.time,
      occasion:        form.occasion.trim() || undefined,
      source:          form.source,
      notes:           form.notes.trim() || undefined,
      tableNumber:     form.tableNumber ? parseInt(form.tableNumber) : null,
      durationMinutes: parseInt(form.durationMinutes) || 90,
      depositAmount:   parseFloat(form.depositAmount) || 0,
      depositStatus:   form.depositStatus,
    };
  }

  async function handleCreate(form: ResFormState) {
    setFormError(null); setSaving(true);
    try {
      await createReservation(formToBody(form));
      setAddOpen(false);
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create reservation');
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(form: ResFormState) {
    if (!editTarget) return;
    setFormError(null); setSaving(true);
    try {
      await updateReservation(editTarget._id, formToBody(form));
      setEditTarget(null);
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to update reservation');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(id: string, status: ReservationStatus, extra?: { cancellationReason?: string }) {
    setActing(true);
    try {
      await updateReservationStatus(id, status, extra);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setActing(false);
    }
  }

  async function handleDelete(id: string) {
    setActing(true);
    try {
      await deleteReservation(id, true);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete reservation');
    } finally {
      setActing(false);
    }
  }

  // Group by section
  const active    = reservations.filter(r => ['pending','confirmed','arrived','seated'].includes(r.status));
  const completed = reservations.filter(r => !['pending','confirmed','arrived','seated'].includes(r.status));

  const FILTER_TABS: Array<{ key: ReservationStatus | 'all'; label: string }> = [
    { key: 'all',       label: 'All' },
    { key: 'pending',   label: 'Pending' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'arrived',   label: 'Arrived' },
    { key: 'seated',    label: 'Seated' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
    { key: 'no_show',   label: 'No-show' },
  ];

  const totalActive = ['pending','confirmed','arrived','seated']
    .reduce((s, k) => s + (stats[k] ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-ink">Reservations</h1>
            {totalActive > 0 && (
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                {totalActive} active
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Tab switcher */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setTab('reservations')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'reservations' ? 'bg-brand text-white' : 'text-ink/50 hover:bg-ink/5'}`}
              >
                <List size={12} /> Reservations
              </button>
              <button
                onClick={() => setTab('waitlist')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'waitlist' ? 'bg-brand text-white' : 'text-ink/50 hover:bg-ink/5'}`}
              >
                <ListChecks size={12} /> Waitlist
              </button>
            </div>
            {tab === 'reservations' && (
              <>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="h-8 rounded-lg border border-border bg-mist px-3 text-xs text-ink outline-none focus:border-brand/50"
                />
                <button
                  onClick={() => void load()}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70 disabled:opacity-40"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => { setAddOpen(true); setFormError(null); }}
                  className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
                >
                  <Plus size={13} /> New reservation
                </button>
              </>
            )}
          </div>
        </div>

        {/* Status filter tabs (reservations only) */}
        {tab === 'reservations' && (
          <div className="mt-3 flex flex-wrap gap-1">
            {FILTER_TABS.map(ft => {
              const cnt = ft.key === 'all'
                ? ALL_STATUSES.reduce((s, k) => s + (stats[k] ?? 0), 0)
                : (stats[ft.key] ?? 0);
              return (
                <button
                  key={ft.key}
                  onClick={() => setStatusFilter(ft.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === ft.key
                      ? 'border-brand/30 bg-brand/10 text-brand'
                      : 'border-border text-ink/50 hover:border-brand/20 hover:text-ink/70'
                  }`}
                >
                  {ft.label} {cnt > 0 && <span className="ml-0.5 opacity-60">{cnt}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'waitlist' ? (
          <WaitlistTab />
        ) : (
          <>
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            {/* Create form */}
            {addOpen && (
              <div className="mb-5 rounded-xl border border-border bg-mist p-5">
                <ResForm
                  title="New Reservation"
                  onSave={handleCreate}
                  onCancel={() => { setAddOpen(false); setFormError(null); }}
                  saving={saving}
                  error={formError}
                />
              </div>
            )}

            {/* Edit modal */}
            {editTarget && (
              <div className="mb-5 rounded-xl border border-brand/20 bg-mist p-5">
                <ResForm
                  title={`Edit — ${editTarget.customerName}`}
                  initial={formFromReservation(editTarget)}
                  onSave={handleEdit}
                  onCancel={() => { setEditTarget(null); setFormError(null); }}
                  saving={saving}
                  error={formError}
                />
              </div>
            )}

            {loading && reservations.length === 0 ? (
              <div className="flex h-48 items-center justify-center"><Spinner size="lg" /></div>
            ) : reservations.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center text-center text-ink/30">
                <CalendarDays size={40} className="mb-3 opacity-15" />
                <p className="text-sm">No reservations for {fmtDate(date)}</p>
                <button
                  onClick={() => { setAddOpen(true); setFormError(null); }}
                  className="mt-3 text-xs font-semibold text-brand hover:underline"
                >
                  Book one now
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {active.length > 0 && (
                  <section>
                    <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">
                      Active ({active.length})
                    </h2>
                    <div className="space-y-3">
                      {active.map(r => (
                        <ResCard
                          key={r._id}
                          res={r}
                          acting={acting}
                          onStatus={handleStatus}
                          onEdit={r => { setEditTarget(r); setFormError(null); setAddOpen(false); }}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </section>
                )}
                {completed.length > 0 && (
                  <section>
                    <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-ink/40">
                      Completed / Other ({completed.length})
                    </h2>
                    <div className="space-y-3">
                      {completed.map(r => (
                        <ResCard
                          key={r._id}
                          res={r}
                          acting={acting}
                          onStatus={handleStatus}
                          onEdit={r => { setEditTarget(r); setFormError(null); setAddOpen(false); }}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
