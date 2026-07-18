import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, CalendarDays, Users, Phone, Clock, ChevronDown, X, Check } from 'lucide-react';
import type { Reservation } from '../types';
import {
  fetchReservations,
  createReservation,
  updateReservationStatus,
  deleteReservation,
} from '../api/reservations';
import { Spinner } from '../components/ui/Spinner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short',
  });
}

const STATUS_STYLE: Record<Reservation['status'], string> = {
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  seated:    'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-50 text-gray-400 border-gray-200',
  'no-show': 'bg-red-50 text-red-600 border-red-200',
};

const STATUS_LABELS: Record<Reservation['status'], string> = {
  confirmed: 'Confirmed',
  seated:    'Seated',
  cancelled: 'Cancelled',
  'no-show': 'No-show',
};

const TIME_SLOTS = [
  '11:00 AM','11:30 AM','12:00 PM','12:30 PM',
  '01:00 PM','01:30 PM','02:00 PM','02:30 PM',
  '06:00 PM','06:30 PM','07:00 PM','07:30 PM',
  '08:00 PM','08:30 PM','09:00 PM','09:30 PM',
];

// ── Add form ──────────────────────────────────────────────────────────────────

interface AddFormState {
  customerName: string;
  phone: string;
  partySize: string;
  date: string;
  time: string;
  notes: string;
  tableNumber: string;
}

const BLANK_FORM: AddFormState = {
  customerName: '',
  phone: '',
  partySize: '2',
  date: todayStr(),
  time: '07:00 PM',
  notes: '',
  tableNumber: '',
};

interface AddFormProps {
  onSave(form: AddFormState): void;
  onCancel(): void;
  saving: boolean;
  error: string | null;
}

function AddForm({ onSave, onCancel, saving, error }: AddFormProps) {
  const [form, setForm] = useState<AddFormState>(BLANK_FORM);
  function set<K extends keyof AddFormState>(k: K, v: string) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  const inputCls =
    'block w-full rounded-lg border border-[#E8D5C0] bg-white px-3 py-2 text-sm text-[#1C0800] outline-none focus:border-[#E8380D]/50 focus:ring-1 focus:ring-[#E8380D]/20';

  const valid = form.customerName.trim() && form.phone.trim() && form.partySize && form.date && form.time;

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg bg-[#E8380D]/10 px-3 py-2 text-xs text-[#E8380D]">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-[#1C0800]/50">Name *</label>
          <input className={inputCls} value={form.customerName} onChange={e => set('customerName', e.target.value)} placeholder="Guest name" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[#1C0800]/50">Phone *</label>
          <input className={inputCls} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="10-digit number" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[#1C0800]/50">Date *</label>
          <input className={inputCls} type="date" value={form.date} min={todayStr()} onChange={e => set('date', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[#1C0800]/50">Time *</label>
          <select className={inputCls} value={form.time} onChange={e => set('time', e.target.value)}>
            {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[#1C0800]/50">Party size *</label>
          <input className={inputCls} type="number" min={1} max={50} value={form.partySize} onChange={e => set('partySize', e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[#1C0800]/50">Table # (optional)</label>
          <input className={inputCls} type="number" value={form.tableNumber} onChange={e => set('tableNumber', e.target.value)} placeholder="—" />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-semibold text-[#1C0800]/50">Notes</label>
          <input className={inputCls} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Occasion, dietary requirements…" />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !valid}
          className="flex items-center gap-1.5 rounded-lg bg-[#E8380D] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#C93008] disabled:opacity-50"
        >
          <Check size={13} />
          {saving ? 'Saving…' : 'Book reservation'}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg border border-[#E8D5C0] px-4 py-2 text-xs font-semibold text-[#1C0800]/50 transition-colors hover:bg-[#1C0800]/5"
        >
          <X size={13} />
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Reservation row ───────────────────────────────────────────────────────────

interface ResRowProps {
  res: Reservation;
  onStatusChange(id: string, status: Reservation['status']): void;
  onDelete(id: string): void;
  acting: boolean;
}

function ResRow({ res, onStatusChange, onDelete, acting }: ResRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isActive = res.status === 'confirmed';

  return (
    <div className="rounded-xl border border-[#E8D5C0] bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-[#1C0800]">{res.customerName}</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[res.status]}`}>
              {STATUS_LABELS[res.status]}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex items-center gap-1 text-xs text-[#1C0800]/50">
              <CalendarDays size={11} />
              {fmtDate(res.date.slice(0, 10))}
            </span>
            <span className="flex items-center gap-1 text-xs text-[#1C0800]/50">
              <Clock size={11} />
              {res.time}
            </span>
            <span className="flex items-center gap-1 text-xs text-[#1C0800]/50">
              <Users size={11} />
              {res.partySize} guests
            </span>
            <span className="flex items-center gap-1 text-xs text-[#1C0800]/50">
              <Phone size={11} />
              {res.phone}
            </span>
            {res.tableNumber && (
              <span className="text-xs text-[#1C0800]/50">Table {res.tableNumber}</span>
            )}
          </div>

          {res.notes && (
            <p className="mt-1.5 text-xs italic text-[#1C0800]/40">{res.notes}</p>
          )}
        </div>

        {/* Actions */}
        {isActive && (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-1 rounded-lg border border-[#E8D5C0] px-2.5 py-1.5 text-xs text-[#1C0800]/50 transition-colors hover:bg-[#1C0800]/5"
            >
              Actions <ChevronDown size={11} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-xl border border-[#E8D5C0] bg-white shadow-lg">
                {(['seated', 'cancelled', 'no-show'] as Reservation['status'][]).map(s => (
                  <button
                    key={s}
                    disabled={acting}
                    onClick={() => { onStatusChange(res._id, s); setMenuOpen(false); }}
                    className="block w-full px-4 py-2.5 text-left text-xs text-[#1C0800]/70 transition-colors hover:bg-[#FFF6EE] first:rounded-t-xl last:rounded-b-xl capitalize disabled:opacity-50"
                  >
                    Mark as {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {confirmDelete ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-[#E8380D]">Delete?</span>
            <button onClick={() => onDelete(res._id)} className="text-xs font-semibold text-[#E8380D] hover:underline">Yes</button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#1C0800]/40 hover:underline">No</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="shrink-0 text-xs text-[#1C0800]/20 transition-colors hover:text-[#E8380D]"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReservationsPage() {
  const [date,         setDate]         = useState(todayStr());
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [addOpen,      setAddOpen]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [formError,    setFormError]    = useState<string | null>(null);
  const [acting,       setActing]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchReservations(date);
      setReservations(res.reservations);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reservations');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  async function handleAdd(form: AddFormState) {
    setFormError(null);
    setSaving(true);
    try {
      await createReservation({
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        partySize: parseInt(form.partySize),
        date: form.date,
        time: form.time,
        notes: form.notes.trim() || undefined,
        tableNumber: form.tableNumber ? parseInt(form.tableNumber) : null,
      });
      setAddOpen(false);
      void load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create reservation');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: Reservation['status']) {
    setActing(true);
    try {
      await updateReservationStatus(id, status);
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
      await deleteReservation(id);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete reservation');
    } finally {
      setActing(false);
    }
  }

  const confirmed = reservations.filter(r => r.status === 'confirmed');
  const others    = reservations.filter(r => r.status !== 'confirmed');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#E8D5C0] bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-[#1C0800]">Reservations</h1>
          <span className="text-xs text-[#1C0800]/40">{total} for {fmtDate(date)}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-8 rounded-lg border border-[#E8D5C0] bg-[#FFF6EE] px-3 text-xs text-[#1C0800] outline-none focus:border-[#E8380D]/50"
          />
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[#1C0800]/40 transition-colors hover:bg-[#1C0800]/5 hover:text-[#1C0800]/70 disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {!addOpen && (
            <button
              onClick={() => { setAddOpen(true); setFormError(null); }}
              className="flex items-center gap-1.5 rounded-lg bg-[#E8380D] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#C93008]"
            >
              <Plus size={13} />
              New reservation
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <div className="mb-4 rounded-lg border border-[#E8380D]/20 bg-[#E8380D]/10 px-4 py-3 text-sm text-[#E8380D]">
            {error}
          </div>
        )}

        {/* Add form */}
        {addOpen && (
          <div className="mb-5 rounded-xl border border-[#E8D5C0] bg-[#FFF6EE] p-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#1C0800]/40">New Reservation</p>
            <AddForm
              onSave={handleAdd}
              onCancel={() => { setAddOpen(false); setFormError(null); }}
              saving={saving}
              error={formError}
            />
          </div>
        )}

        {loading && reservations.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : reservations.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-[#1C0800]/30">
            <CalendarDays size={40} className="mb-3 opacity-15" />
            <p className="text-sm">No reservations for {fmtDate(date)}</p>
            <button
              onClick={() => setAddOpen(true)}
              className="mt-3 text-xs font-semibold text-[#E8380D] hover:underline"
            >
              Book one now
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {confirmed.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#1C0800]/40">
                  Upcoming ({confirmed.length})
                </h2>
                <div className="space-y-3">
                  {confirmed.map(r => (
                    <ResRow
                      key={r._id}
                      res={r}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                      acting={acting}
                    />
                  ))}
                </div>
              </section>
            )}
            {others.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#1C0800]/40">
                  Completed / Other ({others.length})
                </h2>
                <div className="space-y-3">
                  {others.map(r => (
                    <ResRow
                      key={r._id}
                      res={r}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                      acting={acting}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
