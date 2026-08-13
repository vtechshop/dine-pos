import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Phone, Mail, Calendar, Heart, Star, Plus, Edit2, Check, X,
  MessageCircle, ShieldOff, ShieldCheck, Gift, Tag,
} from 'lucide-react';
import {
  fetchCustomer, adjustPoints as apiAdjust,
  updateCustomer, setCustomerStatus,
} from '../../api/loyalty';
import { ApiError } from '../../api/client';
import type { CustomerProfile } from '../../types/customers';
import { TransactionHistory } from './TransactionHistory';
import { Spinner } from '../ui/Spinner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
}

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  return phone;
}

function waPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.startsWith('91') && digits.length >= 12) return digits;
  return null;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatMonthDay(mmdd: string | null, label: string): string {
  if (!mmdd) return '—';
  const [mm, dd] = mmdd.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[(parseInt(mm ?? '0', 10) - 1)] ?? '';
  return `${dd ?? ''} ${month} (${label})`;
}

function formatCurrency(amount: number, sym: string): string {
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const TAG_COLORS: Record<string, string> = {
  VIP:            'bg-amber-50 text-amber-700 border-amber-200',
  Regular:        'bg-blue-50 text-blue-700 border-blue-200',
  'New Customer': 'bg-green-50 text-green-700 border-green-200',
};

function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const cls = TAG_COLORS[tag] ?? 'bg-ink/5 text-ink/60 border-border';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="opacity-60 hover:opacity-100">
          <X size={9} />
        </button>
      )}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  customerId: string;
  rewardName: string;
  isAdmin: boolean;
  currencySymbol: string;
  onAdjusted: () => void;
}

export function CustomerDetail({ customerId, rewardName, isAdmin, currencySymbol, onAdjusted }: Props) {
  const [customer, setCustomer]     = useState<CustomerProfile | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [txRefresh, setTxRefresh]   = useState(0);

  // Adjust form
  const [showAdjust, setShowAdjust]       = useState(false);
  const [adjustPts, setAdjustPts]         = useState('');
  const [adjustRemarks, setAdjustRemarks] = useState('');
  const [adjusting, setAdjusting]         = useState(false);
  const [adjustError, setAdjustError]     = useState<string | null>(null);
  const ptsRef = useRef<HTMLInputElement>(null);

  // Edit form
  const [showEdit, setShowEdit]       = useState(false);
  const [editName, setEditName]       = useState('');
  const [editEmail, setEditEmail]     = useState('');
  const [editBday, setEditBday]       = useState('');
  const [editNotes, setEditNotes]     = useState('');
  const [editTags, setEditTags]       = useState('');
  const [editAnniv, setEditAnniv]     = useState('');
  const [editOptIn, setEditOptIn]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);

  // Block/Unblock
  const [blocking, setBlocking]       = useState(false);
  const [blockError, setBlockError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { customer: c } = await fetchCustomer(customerId);
      setCustomer(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    setCustomer(null);
    setShowAdjust(false);
    setShowEdit(false);
    setAdjustPts('');
    setAdjustRemarks('');
    setAdjustError(null);
    setBlockError(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (showAdjust) ptsRef.current?.focus();
  }, [showAdjust]);

  const handleAdjust = async () => {
    const pts = parseInt(adjustPts, 10);
    if (!pts || isNaN(pts)) { setAdjustError('Enter a non-zero number'); return; }
    if (!adjustRemarks.trim()) { setAdjustError('Remarks are required'); return; }
    setAdjusting(true);
    setAdjustError(null);
    try {
      await apiAdjust(customerId, { points: pts, remarks: adjustRemarks.trim() });
      await load();
      setTxRefresh(r => r + 1);
      onAdjusted();
      setShowAdjust(false);
      setAdjustPts('');
      setAdjustRemarks('');
    } catch (e) {
      setAdjustError(e instanceof ApiError ? e.message : 'Adjustment failed');
    } finally {
      setAdjusting(false);
    }
  };

  const openEdit = () => {
    if (!customer) return;
    setEditName(customer.name ?? '');
    setEditEmail(customer.email ?? '');
    setEditBday(customer.birthday ?? '');
    setEditNotes(customer.notes ?? '');
    setEditTags((customer.tags ?? []).join(', '));
    setEditAnniv(customer.anniversary ?? '');
    setEditOptIn(customer.marketingOptIn ?? false);
    setSaveError(null);
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!customer) return;
    const trimmedName = editName.trim();
    if (!trimmedName) { setSaveError('Name is required'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const newTags = editTags.split(',').map(t => t.trim()).filter(Boolean);
      const body: Parameters<typeof updateCustomer>[1] = {
        name:           trimmedName,
        email:          editEmail.trim() || undefined,
        notes:          editNotes.trim(),
        tags:           newTags,
        marketingOptIn: editOptIn,
      };
      // birthday: validate MM-DD format before sending
      if (editBday) {
        if (/^\d{2}-\d{2}$/.test(editBday)) body.birthday = editBday;
        else { setSaveError('Birthday must be in MM-DD format (e.g. 07-15)'); setSaving(false); return; }
      } else {
        body.birthday = '';
      }
      // anniversary: validate MM-DD format
      if (editAnniv) {
        if (/^\d{2}-\d{2}$/.test(editAnniv)) body.anniversary = editAnniv;
        else { setSaveError('Anniversary must be in MM-DD format (e.g. 07-15)'); setSaving(false); return; }
      } else {
        body.anniversary = '';
      }
      const { customer: updated } = await updateCustomer(customerId, body);
      setCustomer(updated);
      setShowEdit(false);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleBlockToggle = async () => {
    if (!customer || !isAdmin) return;
    const newStatus = customer.status === 'blocked' ? 'active' : 'blocked';
    setBlocking(true);
    setBlockError(null);
    try {
      await setCustomerStatus(customerId, newStatus);
      await load();
      onAdjusted();
    } catch (e) {
      setBlockError(e instanceof ApiError ? e.message : 'Failed to update status');
    } finally {
      setBlocking(false);
    }
  };

  if (loading) return <div className="flex h-full items-center justify-center"><Spinner size="lg" /></div>;
  if (error || !customer) return <div className="flex h-full items-center justify-center"><p className="text-sm text-red-500">{error ?? 'Customer not found'}</p></div>;

  const avgBill   = customer.visitCount > 0 ? customer.lifetimeSpend / customer.visitCount : 0;
  const waNum     = waPhone(customer.phone);
  const isBlocked = customer.status === 'blocked';

  return (
    <div className="h-full overflow-y-auto">
      {/* ── Header ── */}
      <div className="border-b border-border bg-canvas px-6 py-5">
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            isBlocked ? 'bg-red-100 text-red-600' : 'bg-brand/15 text-brand'
          }`}>
            {initials(customer.name)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-ink">{customer.name}</h2>
              {isBlocked && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-500">Blocked</span>
              )}
              {customer.status === 'merged' && (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500">Merged</span>
              )}
            </div>
            <p className="mt-0.5 text-[10px] text-ink/40">{customer.customerId}</p>

            {(customer.tags ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {customer.tags.map(tag => <TagChip key={tag} tag={tag} />)}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {waNum && (
              <a
                href={`https://wa.me/${waNum}`}
                target="_blank" rel="noopener noreferrer"
                title="Open WhatsApp"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
              >
                <MessageCircle size={14} />
              </a>
            )}
            {isAdmin && customer.status !== 'merged' && (
              <button
                onClick={() => void handleBlockToggle()}
                disabled={blocking}
                title={isBlocked ? 'Unblock customer' : 'Block customer'}
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors disabled:opacity-40 ${
                  isBlocked
                    ? 'bg-green-50 text-green-700 hover:bg-green-100'
                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
              >
                {isBlocked ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={openEdit}
                title="Edit profile"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-mist border border-border text-ink/50 hover:bg-ink/5 transition-colors"
              >
                <Edit2 size={13} />
              </button>
            )}
          </div>
        </div>

        {blockError && <p className="mt-2 text-[10px] text-red-500">{blockError}</p>}

        {/* Contact grid */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
          <div className="flex items-center gap-1.5 text-xs text-ink/60">
            <Phone size={11} className="shrink-0 text-ink/30" />
            {formatPhone(customer.phone)}
          </div>
          {customer.email && (
            <div className="flex items-center gap-1.5 text-xs text-ink/60">
              <Mail size={11} className="shrink-0 text-ink/30" />
              <span className="truncate">{customer.email}</span>
            </div>
          )}
          {customer.birthday && (
            <div className="flex items-center gap-1.5 text-xs text-ink/60">
              <Calendar size={11} className="shrink-0 text-ink/30" />
              {formatMonthDay(customer.birthday, 'Birthday')}
            </div>
          )}
          {customer.anniversary && (
            <div className="flex items-center gap-1.5 text-xs text-ink/60">
              <Gift size={11} className="shrink-0 text-ink/30" />
              {formatMonthDay(customer.anniversary, 'Anniversary')}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-ink/60">
            <Heart size={11} className={`shrink-0 ${customer.marketingOptIn ? 'text-brand' : 'text-ink/20'}`} />
            {customer.marketingOptIn ? 'Marketing opt-in' : 'No marketing'}
          </div>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-mist">
        {[
          { label: 'Visits',    value: customer.visitCount.toString() },
          { label: 'Lifetime',  value: formatCurrency(customer.lifetimeSpend, currencySymbol) },
          { label: 'Avg Bill',  value: formatCurrency(avgBill, currencySymbol) },
          { label: 'Last Visit', value: formatDate(customer.lastVisitAt) },
        ].map(({ label, value }) => (
          <div key={label} className="px-3 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-ink/40">{label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Favourite items ── */}
      {(customer.favouriteItems ?? []).length > 0 && (
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Tag size={11} className="text-ink/30" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Favourite Orders</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {customer.favouriteItems.slice(0, 8).map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-mist border border-border px-2 py-1 text-[11px] text-ink/70">
                {f.productName}
                <span className="text-[9px] text-ink/40">×{f.orderCount}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Loyalty section ── */}
      <div className="border-b border-border px-6 py-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star size={13} className="text-brand" />
            <span className="text-sm font-semibold text-ink">{rewardName} Balance</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tabular-nums text-brand">
              {customer.loyaltyBalance.toLocaleString()}
            </span>
            <span className="text-xs text-ink/40">{rewardName}</span>
          </div>
        </div>

        <p className="text-[10px] text-ink/30">Member since {formatDate(customer.firstVisitAt)}</p>

        {isAdmin && (
          <div className="mt-3">
            {!showAdjust ? (
              <button
                onClick={() => setShowAdjust(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink"
              >
                <Plus size={11} />
                Adjust {rewardName}
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-border bg-mist p-3">
                <input
                  ref={ptsRef}
                  type="number"
                  value={adjustPts}
                  onChange={e => setAdjustPts(e.target.value)}
                  placeholder="Points (positive or negative)"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  onKeyDown={e => e.key === 'Escape' && (setShowAdjust(false), setAdjustPts(''), setAdjustRemarks(''), setAdjustError(null))}
                />
                <input
                  type="text"
                  value={adjustRemarks}
                  onChange={e => setAdjustRemarks(e.target.value)}
                  placeholder="Remarks (required)"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  onKeyDown={e => {
                    if (e.key === 'Enter')  void handleAdjust();
                    if (e.key === 'Escape') { setShowAdjust(false); setAdjustPts(''); setAdjustRemarks(''); setAdjustError(null); }
                  }}
                />
                {adjustError && <p className="text-[10px] text-red-500">{adjustError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleAdjust()}
                    disabled={adjusting || !adjustPts || !adjustRemarks}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
                  >
                    {adjusting ? 'Saving…' : 'Apply'}
                  </button>
                  <button
                    onClick={() => { setShowAdjust(false); setAdjustPts(''); setAdjustRemarks(''); setAdjustError(null); }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Edit Profile panel (inline) ── */}
      {showEdit && (
        <div className="border-b border-border bg-mist px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/50">Edit Profile</span>
            <button onClick={() => setShowEdit(false)} className="text-ink/30 hover:text-ink"><X size={13}/></button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-ink/40 block mb-0.5">Name <span className="text-red-400">*</span></label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="Customer name"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50" />
              </div>
              <div>
                <label className="text-[10px] text-ink/40 block mb-0.5">Email</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)}
                  placeholder="optional@email.com"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-ink/40 block mb-0.5">Birthday (MM-DD)</label>
                <input type="text" value={editBday} onChange={e => setEditBday(e.target.value)}
                  placeholder="07-15 for July 15"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50" />
              </div>
              <div>
                <label className="text-[10px] text-ink/40 block mb-0.5">Anniversary (MM-DD)</label>
                <input type="text" value={editAnniv} onChange={e => setEditAnniv(e.target.value)}
                  placeholder="07-15 for July 15"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-ink/40 block mb-0.5">Tags (comma-separated)</label>
              <input type="text" value={editTags} onChange={e => setEditTags(e.target.value)}
                placeholder="VIP, Regular, New Customer"
                className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50" />
            </div>
            <div>
              <label className="text-[10px] text-ink/40 block mb-0.5">Notes</label>
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink resize-none outline-none focus:border-brand/50" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editOptIn} onChange={e => setEditOptIn(e.target.checked)} className="accent-brand" />
              <span className="text-xs text-ink/70">Marketing opt-in (WhatsApp / SMS campaigns)</span>
            </label>
          </div>
          {saveError && <p className="mt-2 text-[10px] text-red-500">{saveError}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => void handleSave()} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-40">
              <Check size={11}/>{saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setShowEdit(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Transaction history ── */}
      <div className="px-6 py-5">
        <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-ink/40">
          {rewardName} Transaction History
        </h3>
        <TransactionHistory
          key={`${customerId}-${txRefresh}`}
          customerId={customerId}
          rewardName={rewardName}
        />
      </div>

      {/* ── Notes ── */}
      {customer.notes && !showEdit && (
        <div className="px-6 pb-6">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/40">Notes</h3>
          <p className="whitespace-pre-wrap text-xs text-ink/60">{customer.notes}</p>
        </div>
      )}
    </div>
  );
}
