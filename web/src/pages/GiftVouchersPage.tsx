import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, ToggleLeft, ToggleRight, X, Gift, RefreshCw, Minus } from 'lucide-react';
import {
  fetchGiftVouchers, issueGiftVoucher, topupGiftVoucher, redeemGiftVoucher,
  deactivateGiftVoucher,
  type GiftVoucher, type IssueVoucherInput,
} from '../api/giftVouchers';

const BLANK_ISSUE: IssueVoucherInput = {
  amount: 0,
  issuedToName: '',
  issuedToPhone: '',
  expiresAt: '',
};

export function GiftVouchersPage() {
  const [items, setItems]     = useState<GiftVoucher[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [issueOpen, setIssueOpen]     = useState(false);
  const [issueForm, setIssueForm]     = useState<IssueVoucherInput>(BLANK_ISSUE);
  const [issueSaving, setIssueSaving] = useState(false);
  const [issueError, setIssueError]   = useState<string | null>(null);

  const [topupTarget, setTopupTarget]   = useState<GiftVoucher | null>(null);
  const [topupAmount, setTopupAmount]   = useState('');
  const [topupSaving, setTopupSaving]   = useState(false);
  const [topupError, setTopupError]     = useState<string | null>(null);

  const [redeemTarget, setRedeemTarget] = useState<GiftVoucher | null>(null);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemSaving, setRedeemSaving] = useState(false);
  const [redeemError, setRedeemError]   = useState<string | null>(null);

  const LIMIT = 25;

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const activeParam = activeFilter === 'active' ? 'true' : activeFilter === 'inactive' ? 'false' : '';
      const res = await fetchGiftVouchers({ page: p, limit: LIMIT, active: activeParam as 'true' | 'false' | '' });
      setItems(res.vouchers);
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => { load(1); }, [load]);

  const handleIssue = async () => {
    if (!issueForm.amount || issueForm.amount <= 0) { setIssueError('Amount must be greater than 0.'); return; }
    setIssueSaving(true);
    setIssueError(null);
    try {
      await issueGiftVoucher({
        ...issueForm,
        issuedToName:  issueForm.issuedToName  || undefined,
        issuedToPhone: issueForm.issuedToPhone || undefined,
        expiresAt:     issueForm.expiresAt     || undefined,
      });
      setIssueOpen(false);
      setIssueForm(BLANK_ISSUE);
      load(1);
    } catch (e) {
      setIssueError((e as Error).message);
    } finally {
      setIssueSaving(false);
    }
  };

  const handleTopup = async () => {
    if (!topupTarget) return;
    const amt = Number(topupAmount);
    if (!amt || amt <= 0) { setTopupError('Enter a valid amount.'); return; }
    setTopupSaving(true);
    setTopupError(null);
    try {
      await topupGiftVoucher(topupTarget.code, amt);
      setTopupTarget(null);
      setTopupAmount('');
      load(page);
    } catch (e) {
      setTopupError((e as Error).message);
    } finally {
      setTopupSaving(false);
    }
  };

  const handleRedeem = async () => {
    if (!redeemTarget) return;
    const amt = Number(redeemAmount);
    if (!amt || amt <= 0) { setRedeemError('Enter a valid amount.'); return; }
    if (amt > redeemTarget.balance) { setRedeemError(`Amount exceeds balance of ₹${redeemTarget.balance}.`); return; }
    setRedeemSaving(true);
    setRedeemError(null);
    try {
      await redeemGiftVoucher(redeemTarget.code, amt);
      setRedeemTarget(null);
      setRedeemAmount('');
      load(page);
    } catch (e) {
      setRedeemError((e as Error).message);
    } finally {
      setRedeemSaving(false);
    }
  };

  const toggleActive = async (v: GiftVoucher) => {
    if (!v.isActive) return;
    try {
      await deactivateGiftVoucher(v._id);
      load(page);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const filtered = search
    ? items.filter(v =>
        v.code.toLowerCase().includes(search.toLowerCase()) ||
        (v.issuedToName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (v.issuedToPhone ?? '').includes(search)
      )
    : items;

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Gift size={18} className="text-brand" />
          <h1 className="text-sm font-bold text-ink">Gift Vouchers</h1>
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">{total}</span>
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                activeFilter === f ? 'bg-brand text-white' : 'bg-ink/5 text-ink/60 hover:bg-ink/10'
              }`}
            >
              {f}
            </button>
          ))}
          <button
            onClick={() => { setIssueForm(BLANK_ISSUE); setIssueError(null); setIssueOpen(true); }}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
          >
            <Plus size={13} /> Issue Voucher
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-2.5">
        <div className="relative max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by code, name, or phone…"
            className="w-full rounded-lg border border-border bg-canvas py-1.5 pl-8 pr-3 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-mist px-5 py-4">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-ink/40">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-ink/40">
            <Gift size={28} className="opacity-30" />
            <p>{search ? 'No vouchers match your search.' : 'No gift vouchers issued yet.'}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-canvas overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-mist text-left text-xs font-semibold uppercase tracking-wide text-ink/50">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Issued To</th>
                  <th className="px-4 py-3">Balance</th>
                  <th className="px-4 py-3">Original</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(v => (
                  <tr key={v._id} className="hover:bg-mist/50">
                    <td className="px-4 py-3 font-mono font-bold text-ink">{v.code}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{v.issuedToName || '—'}</p>
                      {v.issuedToPhone && <p className="text-xs text-ink/50">{v.issuedToPhone}</p>}
                    </td>
                    <td className="px-4 py-3 font-bold text-brand">₹{v.balance}</td>
                    <td className="px-4 py-3 text-ink/60">₹{v.amount}</td>
                    <td className="px-4 py-3 text-ink/60">
                      {v.expiresAt ? new Date(v.expiresAt).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        v.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {v.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {v.isActive && (
                          <>
                            <button
                              onClick={() => { setTopupTarget(v); setTopupAmount(''); setTopupError(null); }}
                              title="Top-up"
                              className="rounded-lg p-1.5 text-ink/40 hover:bg-green-50 hover:text-green-700"
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              onClick={() => { setRedeemTarget(v); setRedeemAmount(''); setRedeemError(null); }}
                              title="Redeem"
                              className="rounded-lg p-1.5 text-ink/40 hover:bg-orange-50 hover:text-brand"
                            >
                              <Minus size={14} />
                            </button>
                            <button
                              onClick={() => toggleActive(v)}
                              title="Deactivate"
                              className="rounded-lg p-1.5 text-ink/40 hover:bg-ink/5"
                            >
                              <ToggleRight size={16} className="text-green-600" />
                            </button>
                          </>
                        )}
                        {!v.isActive && (
                          <button disabled title="Deactivated" className="rounded-lg p-1.5 text-ink/30">
                            <ToggleLeft size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => load(page - 1)}
              className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-ink/60">Page {page} of {pages}</span>
            <button
              disabled={page >= pages}
              onClick={() => load(page + 1)}
              className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Issue Voucher Drawer */}
      {issueOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => !issueSaving && setIssueOpen(false)} />
          <div className="flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-bold text-ink">Issue Gift Voucher</h2>
              <button onClick={() => !issueSaving && setIssueOpen(false)} className="rounded-lg p-1.5 text-ink/40 hover:bg-ink/5">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {issueError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{issueError}</div>
              )}
              <Field label="Amount ₹ *">
                <input
                  type="number" min={1}
                  value={issueForm.amount || ''}
                  onChange={e => setIssueForm(f => ({ ...f, amount: Number(e.target.value) }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Issued To (Name)">
                <input
                  value={issueForm.issuedToName ?? ''}
                  onChange={e => setIssueForm(f => ({ ...f, issuedToName: e.target.value }))}
                  placeholder="Customer name"
                  className={inputCls}
                />
              </Field>
              <Field label="Phone Number">
                <input
                  value={issueForm.issuedToPhone ?? ''}
                  onChange={e => setIssueForm(f => ({ ...f, issuedToPhone: e.target.value }))}
                  placeholder="10-digit mobile"
                  className={inputCls}
                />
              </Field>
              <Field label="Expiry Date">
                <input
                  type="date"
                  value={issueForm.expiresAt ?? ''}
                  onChange={e => setIssueForm(f => ({ ...f, expiresAt: e.target.value }))}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="shrink-0 border-t border-border px-5 py-4 flex gap-3">
              <button
                onClick={() => setIssueOpen(false)}
                disabled={issueSaving}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleIssue}
                disabled={issueSaving}
                className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {issueSaving ? 'Issuing…' : 'Issue Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top-up Modal */}
      {topupTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <RefreshCw size={16} className="text-brand" />
              <h3 className="text-base font-bold text-ink">Top-up Voucher</h3>
            </div>
            <p className="mb-4 text-xs text-ink/60">
              {topupTarget.code} · Current balance: <strong>₹{topupTarget.balance}</strong>
            </p>
            {topupError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{topupError}</div>
            )}
            <input
              type="number" min={1}
              value={topupAmount}
              onChange={e => setTopupAmount(e.target.value)}
              placeholder="Amount to add ₹"
              className={`${inputCls} mb-4`}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setTopupTarget(null)}
                disabled={topupSaving}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleTopup}
                disabled={topupSaving}
                className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {topupSaving ? 'Processing…' : 'Top-up'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Redeem Modal */}
      {redeemTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <Minus size={16} className="text-brand" />
              <h3 className="text-base font-bold text-ink">Manual Redemption</h3>
            </div>
            <p className="mb-4 text-xs text-ink/60">
              {redeemTarget.code} · Available balance: <strong>₹{redeemTarget.balance}</strong>
            </p>
            {redeemError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{redeemError}</div>
            )}
            <input
              type="number" min={1} max={redeemTarget.balance}
              value={redeemAmount}
              onChange={e => setRedeemAmount(e.target.value)}
              placeholder="Amount to redeem ₹"
              className={`${inputCls} mb-4`}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setRedeemTarget(null)}
                disabled={redeemSaving}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRedeem}
                disabled={redeemSaving}
                className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {redeemSaving ? 'Processing…' : 'Redeem'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-ink/60">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand/30';
