import { useState, useCallback } from 'react';
import { Search, User, Star, ShoppingBag, Calendar, Phone, AlertCircle, X, Plus, Check, Loader2 } from 'lucide-react';
import { searchCustomers, fetchCustomer, fetchCustomerTransactions, createCustomer } from '../../api/loyalty';
import { useSettings } from '../../context/SettingsContext';
import { Spinner } from '../ui/Spinner';
import type { CustomerSummary, CustomerProfile, LoyaltyTransaction } from '../../types/customers';

// ── Quick Create Form ─────────────────────────────────────────────────────────

function QuickCreateForm({ onSuccess, onCancel }: {
  onSuccess: (c: CustomerProfile) => void;
  onCancel: () => void;
}) {
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [email, setEmail]     = useState('');
  const [birthday, setBirthday] = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await createCustomer({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        birthday: birthday || undefined,
      });
      onSuccess(res.customer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create customer');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/20';

  return (
    <div className="rounded-xl border border-border bg-canvas p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">New Customer</p>
        <button type="button" onClick={onCancel} className="text-ink/40 hover:text-ink/70"><X size={14} /></button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block mb-0.5 text-[11px] font-medium text-ink/60">Name *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Customer name" className={inputCls} />
        </div>
        <div>
          <label className="block mb-0.5 text-[11px] font-medium text-ink/60">Phone *</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="Mobile number" className={inputCls} />
        </div>
        <div>
          <label className="block mb-0.5 text-[11px] font-medium text-ink/60">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Optional" className={inputCls} />
        </div>
        <div>
          <label className="block mb-0.5 text-[11px] font-medium text-ink/60">Birthday</label>
          <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)}
            className={inputCls} />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertCircle size={12} className="text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-lg border border-border py-2 text-sm text-ink/60 hover:bg-mist">
          Cancel
        </button>
        <button type="button" onClick={() => void handleCreate()}
          disabled={saving || !name.trim() || !phone.trim()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-60 hover:bg-brand/90">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {saving ? 'Creating…' : 'Create Customer'}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(sym: string, n: number) {
  return `${sym}${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Customer detail view ──────────────────────────────────────────────────────

function CustomerDetail({ summary, sym, onBack }: { summary: CustomerSummary; sym: string; onBack: () => void }) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [txns, setTxns] = useState<LoyaltyTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    const [profRes, txnRes] = await Promise.allSettled([
      fetchCustomer(summary.customerId),
      fetchCustomerTransactions(summary.customerId, { limit: 10 }),
    ]);
    if (!cancelled) {
      if (profRes.status === 'fulfilled') setProfile(profRes.value as unknown as CustomerProfile);
      if (txnRes.status === 'fulfilled') setTxns(txnRes.value.transactions);
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [summary.customerId]);

  useState(() => { void load(); });

  const data = profile ?? summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="rounded-lg border border-border p-1.5 text-ink/40 hover:bg-mist">
          <X size={14} />
        </button>
        <h3 className="text-sm font-semibold text-ink">{data.name}</h3>
      </div>

      {/* Profile card */}
      <div className="rounded-xl border border-border bg-canvas p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand">
            <User size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">{data.name}</p>
            <p className="text-xs text-ink/50">{data.customerId}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {data.phone && (
            <InfoRow icon={<Phone size={11} />} label="Phone" value={data.phone} />
          )}
          <InfoRow icon={<ShoppingBag size={11} />} label="Visits" value={String(data.visitCount)} />
          <InfoRow icon={<Star size={11} />} label="Points" value={String(data.loyaltyBalance ?? 0)} />
          <InfoRow icon={<ShoppingBag size={11} />} label="Lifetime" value={fmtINR(sym, data.lifetimeSpend)} />
          <InfoRow
            icon={<Calendar size={11} />}
            label="Last Visit"
            value={fmtDate(data.lastVisitAt)}
          />
          {profile?.birthday && (
            <InfoRow icon={<Calendar size={11} />} label="Birthday" value={profile.birthday} />
          )}
          {profile?.email && (
            <InfoRow icon={<User size={11} />} label="Email" value={profile.email} span />
          )}
        </div>
      </div>

      {/* Loyalty transactions */}
      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : txns.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">Recent Loyalty Activity</p>
          {txns.map(t => (
            <div key={t._id} className="flex items-center justify-between rounded-lg border border-border bg-canvas px-3 py-2">
              <div>
                <p className="text-xs font-medium capitalize text-ink">{t.transactionType.replace('_', ' ')}</p>
                <p className="text-[10px] text-ink/45">{fmtDate(t.createdAt)} · {t.remarks}</p>
              </div>
              <span className={`text-sm font-bold ${t.points >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {t.points >= 0 ? '+' : ''}{t.points}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InfoRow({ icon, label, value, span }: { icon: React.ReactNode; label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <div className="flex items-center gap-1 text-ink/40">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-xs font-medium text-ink">{value}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CustomerPanel() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [query, setQuery]   = useState('');
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    try {
      const isPhone = /^\d{6,}$/.test(query.trim());
      const params = isPhone
        ? { phone: query.trim(), limit: 20 }
        : { name: query.trim(), limit: 20 };
      const res = await searchCustomers(params);
      if (!cancelled) {
        setResults(res.customers ?? []);
        setSearched(true);
      }
    } catch {
      if (!cancelled) setError('Customer lookup failed');
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, [query]);

  if (selected) {
    return <CustomerDetail summary={selected} sym={sym} onBack={() => setSelected(null)} />;
  }

  if (showCreate) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Customer Lookup</h2>
        <QuickCreateForm
          onSuccess={c => {
            setShowCreate(false);
            // Show the newly created customer immediately
            const summary: CustomerSummary = {
              _id: c._id ?? c.customerId,
              customerId: c.customerId,
              name: c.name,
              phone: c.phone,
              loyaltyBalance: c.loyaltyBalance ?? 0,
              lifetimeSpend: c.lifetimeSpend ?? 0,
              visitCount: c.visitCount ?? 0,
              lastVisitAt: c.lastVisitAt ?? null,
              status: c.status ?? 'active',
            };
            setSelected(summary);
          }}
          onCancel={() => setShowCreate(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/40">Customer Lookup</h2>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
        >
          <Plus size={12} />
          New Customer
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleSearch(); }}
            placeholder="Name or phone number…"
            className="w-full rounded-lg border border-border py-2 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-brand/50 focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={loading || !query.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
        >
          {loading ? <Spinner size="sm" /> : 'Search'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertCircle size={13} className="text-red-500" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Empty */}
      {!searched && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <User size={22} className="mx-auto mb-2 text-ink/20" />
          <p className="text-sm text-ink/40">Search by name or phone</p>
        </div>
      )}

      {/* Results */}
      {searched && !loading && results.length === 0 && (
        <p className="text-center text-sm text-ink/40">No customers found</p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map(c => (
            <button
              key={c._id}
              type="button"
              onClick={() => setSelected(c)}
              className="w-full rounded-xl border border-border bg-canvas p-3 text-left transition hover:border-brand/30 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink">{c.name}</p>
                  <p className="text-xs text-ink/50">{c.phone ?? c.customerId}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-brand">{c.loyaltyBalance ?? 0} pts</p>
                  <p className="text-[10px] text-ink/40">{c.visitCount} visits</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
