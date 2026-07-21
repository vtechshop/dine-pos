import { useState, useEffect, useCallback, useRef } from 'react';
import { Phone, Mail, Calendar, Heart, Star, Plus } from 'lucide-react';
import { fetchCustomer, adjustPoints as apiAdjust } from '../../api/loyalty';
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatBirthday(mmdd: string | null): string {
  if (!mmdd) return '—';
  const [mm, dd] = mmdd.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dd ?? ''} ${months[(parseInt(mm ?? '0', 10) - 1)] ?? ''}`.trim();
}

function formatCurrency(amount: number, sym: string): string {
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const TAG_COLORS: Record<string, string> = {
  VIP:            'bg-amber-50 text-amber-700 border-amber-200',
  Regular:        'bg-blue-50 text-blue-700 border-blue-200',
  'New Customer': 'bg-green-50 text-green-700 border-green-200',
};

function TagChip({ tag }: { tag: string }) {
  const cls = TAG_COLORS[tag] ?? 'bg-ink/5 text-ink/60 border-border';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {tag}
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

export function CustomerDetail({
  customerId,
  rewardName,
  isAdmin,
  currencySymbol,
  onAdjusted,
}: Props) {
  const [customer, setCustomer]   = useState<CustomerProfile | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [txRefresh, setTxRefresh] = useState(0);

  // Adjust form
  const [showAdjust, setShowAdjust]     = useState(false);
  const [adjustPts, setAdjustPts]       = useState('');
  const [adjustRemarks, setAdjustRemarks] = useState('');
  const [adjusting, setAdjusting]       = useState(false);
  const [adjustError, setAdjustError]   = useState<string | null>(null);
  const ptsRef = useRef<HTMLInputElement>(null);

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
    setAdjustPts('');
    setAdjustRemarks('');
    setAdjustError(null);
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

  const cancelAdjust = () => {
    setShowAdjust(false);
    setAdjustPts('');
    setAdjustRemarks('');
    setAdjustError(null);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-500">{error ?? 'Customer not found'}</p>
      </div>
    );
  }

  const avgBill = customer.visitCount > 0
    ? customer.lifetimeSpend / customer.visitCount
    : 0;

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border bg-canvas px-6 py-5">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
              customer.status === 'blocked'
                ? 'bg-red-100 text-red-600'
                : 'bg-brand/15 text-brand'
            }`}
          >
            {initials(customer.name)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-ink">{customer.name}</h2>
              {customer.status === 'blocked' && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-500">
                  Blocked
                </span>
              )}
              {customer.status === 'merged' && (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                  Merged
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[10px] text-ink/40">{customer.customerId}</p>

            {customer.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {customer.tags.map(tag => <TagChip key={tag} tag={tag} />)}
              </div>
            )}
          </div>
        </div>

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
              {formatBirthday(customer.birthday)}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-ink/60">
            <Heart
              size={11}
              className={`shrink-0 ${customer.marketingOptIn ? 'text-brand' : 'text-ink/20'}`}
            />
            {customer.marketingOptIn ? 'Marketing opt-in' : 'No marketing'}
          </div>
        </div>
      </div>

      {/* Stats strip */}
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

      {/* Loyalty section */}
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

        <p className="text-[10px] text-ink/30">
          Member since {formatDate(customer.firstVisitAt)}
        </p>

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
                  onKeyDown={e => e.key === 'Escape' && cancelAdjust()}
                />
                <input
                  type="text"
                  value={adjustRemarks}
                  onChange={e => setAdjustRemarks(e.target.value)}
                  placeholder="Remarks (required)"
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                  onKeyDown={e => {
                    if (e.key === 'Enter')  void handleAdjust();
                    if (e.key === 'Escape') cancelAdjust();
                  }}
                />
                {adjustError && (
                  <p className="text-[10px] text-red-500">{adjustError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleAdjust()}
                    disabled={adjusting || !adjustPts || !adjustRemarks}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
                  >
                    {adjusting ? 'Saving…' : 'Apply'}
                  </button>
                  <button
                    onClick={cancelAdjust}
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

      {/* Transaction history */}
      <div className="px-6 py-5">
        <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-ink/40">
          Transaction History
        </h3>
        <TransactionHistory
          key={`${customerId}-${txRefresh}`}
          customerId={customerId}
          rewardName={rewardName}
        />
      </div>

      {customer.notes ? (
        <div className="px-6 pb-6">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/40">
            Notes
          </h3>
          <p className="whitespace-pre-wrap text-xs text-ink/60">{customer.notes}</p>
        </div>
      ) : null}
    </div>
  );
}
