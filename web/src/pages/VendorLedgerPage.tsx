import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Plus, X, Download, RefreshCw, Loader2, FileText,
  CreditCard, AlertCircle, ChevronRight, RotateCcw,
  Phone, Wallet, Building2, CheckCircle, Eye,
} from 'lucide-react';
import {
  fetchPayments, createPayment, reversePayment,
  fetchLedgerReport, fetchLedger, fetchStatement,
  type PaymentInput, type LedgerResponse, type StatementResponse,
} from '../api/vendorLedger';
import { fetchVendors } from '../api/vendors';
import type { VendorPayment, VendorLedgerReport, Vendor, VendorPaymentMethod, LedgerEntryType } from '../types';
import { useSettings } from '../context/SettingsContext';

// ── Constants ─────────────────────────────────────────────────────────────────

type Tab = 'outstanding' | 'payments' | 'ledger' | 'reports';

const METHOD_META: Record<VendorPaymentMethod, { label: string; icon: React.ReactNode }> = {
  cash:          { label: 'Cash',          icon: <Wallet size={12} /> },
  upi:           { label: 'UPI',           icon: <Phone size={12} /> },
  bank_transfer: { label: 'Bank Transfer', icon: <Building2 size={12} /> },
  cheque:        { label: 'Cheque',        icon: <FileText size={12} /> },
  card:          { label: 'Card',          icon: <CreditCard size={12} /> },
};

const ENTRY_META: Record<LedgerEntryType, { label: string; color: string }> = {
  grn:             { label: 'GRN Received',    color: '#dc2626' },
  payment:         { label: 'Payment Made',    color: '#059669' },
  opening_balance: { label: 'Opening Balance', color: '#2563eb' },
  adjustment:      { label: 'Adjustment',      color: '#d97706' },
  debit_note:      { label: 'Debit Note',      color: '#dc2626' },
  credit_note:     { label: 'Credit Note',     color: '#059669' },
  purchase:        { label: 'Purchase',        color: '#7c3aed' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, sym = '₹') { return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][][]) {
  const flat: (string | number)[][] = [headers, ...rows.flat()];
  const csv = flat.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
    download: filename,
  });
  a.click();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-brand' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

function MethodBadge({ method }: { method: VendorPaymentMethod }) {
  const m = METHOD_META[method] ?? { label: method, icon: null };
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-ink/60">
      {m.icon}{m.label}
    </span>
  );
}

// ── Payment Drawer ────────────────────────────────────────────────────────────

function PaymentDrawer({
  open, onClose, onCreated, initialVendorId,
}: {
  open:            boolean;
  onClose:         () => void;
  onCreated:       (p: VendorPayment) => void;
  initialVendorId?: string;
}) {
  const [vendors, setVendors]             = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch]   = useState('');
  const [vendorId, setVendorId]           = useState(initialVendorId ?? '');
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [showDropdown, setShowDropdown]   = useState(false);
  const [paymentDate, setPaymentDate]     = useState(todayISO());
  const [paymentMethod, setVendorPaymentMethod] = useState<VendorPaymentMethod>('cash');
  const [amount, setAmount]               = useState('');
  const [referenceNumber, setRef]         = useState('');
  const [notes, setNotes]                 = useState('');
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setError(null); setAmount(''); setRef(''); setNotes(''); return; }
    fetchVendors({ active: 'true', limit: 200 }).then(r => setVendors(r.vendors)).catch(() => {});
    if (initialVendorId) setVendorId(initialVendorId);
  }, [open, initialVendorId]);

  useEffect(() => {
    if (initialVendorId) {
      const v = vendors.find(v => v._id === initialVendorId);
      if (v) { setSelectedVendor(v); setVendorSearch(v.businessName); }
    }
  }, [vendors, initialVendorId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saving, onClose]);

  const filteredVendors = vendors.filter(v =>
    !vendorSearch.trim() ||
    v.businessName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    v.vendorCode.toLowerCase().includes(vendorSearch.toLowerCase()),
  );

  function selectVendor(v: Vendor) {
    setSelectedVendor(v);
    setVendorId(v._id);
    setVendorSearch(v.businessName);
    setShowDropdown(false);
  }

  async function submit() {
    if (!vendorId)   return setError('Select a vendor');
    if (!amount || Number(amount) <= 0) return setError('Enter a valid amount');
    setSaving(true); setError(null);
    try {
      const p = await createPayment({
        vendorId, paymentDate, paymentMethod, amount: Number(amount),
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
      } as PaymentInput);
      onCreated(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create payment');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-ink/30" onClick={onClose} />
      <div className="flex w-full max-w-md flex-col border-l border-border bg-canvas shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">New Payment</h2>
          <button onClick={onClose} disabled={saving} className="rounded-lg p-1 text-ink/40 hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle size={13} />{error}
            </div>
          )}

          {/* Vendor */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Vendor *</label>
            <div className="relative" ref={dropRef}>
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
              <input
                value={vendorSearch}
                onChange={e => { setVendorSearch(e.target.value); setShowDropdown(true); setVendorId(''); setSelectedVendor(null); }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search vendor…"
                className="w-full rounded-lg border border-border bg-mist py-2 pl-8 pr-3 text-xs text-ink outline-none focus:border-brand/50"
              />
              {showDropdown && filteredVendors.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-border bg-canvas shadow-lg">
                  {filteredVendors.map(v => (
                    <button key={v._id} onClick={() => selectVendor(v)}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-mist">
                      <span className="font-medium text-ink">{v.businessName}</span>
                      <span className="text-ink/40">{fmt(v.currentOutstanding)} outstanding</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedVendor && (
              <p className="mt-1 text-[10px] text-ink/50">
                Outstanding: <span className="font-semibold text-red-600">{fmt(selectedVendor.currentOutstanding)}</span>
              </p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Payment Date</label>
            <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-xs text-ink outline-none focus:border-brand/50" />
          </div>

          {/* Method */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Payment Method</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(METHOD_META) as VendorPaymentMethod[]).map(m => (
                <button key={m} onClick={() => setVendorPaymentMethod(m)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    paymentMethod === m
                      ? 'border-brand bg-brand text-white'
                      : 'border-border bg-canvas text-ink/60 hover:border-brand/30 hover:text-ink'
                  }`}>
                  {METHOD_META[m].label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Amount *</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00" min="0.01" step="0.01"
              className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-xs text-ink outline-none focus:border-brand/50" />
          </div>

          {/* Reference */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Reference / Cheque No.</label>
            <input value={referenceNumber} onChange={e => setRef(e.target.value)} placeholder="Optional"
              className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-xs text-ink outline-none focus:border-brand/50" />
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional"
              className="w-full resize-none rounded-lg border border-border bg-mist px-3 py-2 text-xs text-ink outline-none focus:border-brand/50" />
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-canvas px-5 py-4">
          <button onClick={() => void submit()} disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Vendor Statement Panel ────────────────────────────────────────────────────

function VendorStatementPanel({
  vendorId, onClose, onPayNow,
}: {
  vendorId: string;
  onClose:  () => void;
  onPayNow: (vendorId: string) => void;
}) {
  const { settings }              = useSettings();
  const [data, setData]           = useState<StatementResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [from, setFrom]           = useState('');
  const [to, setTo]               = useState('');
  const load = useCallback((f?: string, t?: string) => {
    setLoading(true);
    fetchStatement(vendorId, { from: f, to: t })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [vendorId]);

  useEffect(() => { load(); }, [load]);

  function applyFilter() { load(from || undefined, to || undefined); }

  function exportCSV() {
    if (!data) return;
    const sym = settings?.currencySymbol ?? '₹';
    downloadCSV(`statement-${data.vendor.businessName}-${todayISO()}.csv`,
      ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
      data.entries.map(e => [[
        fmtDate(e.createdAt), ENTRY_META[e.entryType]?.label ?? e.entryType,
        e.referenceNumber, e.description,
        e.debit > 0 ? `${sym}${e.debit.toFixed(2)}` : '',
        e.credit > 0 ? `${sym}${e.credit.toFixed(2)}` : '',
        `${sym}${e.runningBalance.toFixed(2)}`,
      ]]),
    );
  }

  const sym = settings?.currencySymbol ?? '₹';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
        <div>
          {loading || !data ? (
            <div className="h-5 w-32 animate-pulse rounded bg-ink/10" />
          ) : (
            <>
              <h2 className="text-sm font-bold text-ink">{data.vendor.businessName}</h2>
              <p className="text-xs text-ink/50">{data.vendor.mobile}</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-red-600">
                {sym}{(data.currentOutstanding).toLocaleString('en-IN', { minimumFractionDigits: 2 })} outstanding
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <>
              <button onClick={exportCSV} className="rounded-lg border border-border p-1.5 text-ink/40 hover:text-ink">
                <Download size={13} />
              </button>
              <button onClick={() => onPayNow(vendorId)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
                Pay Now
              </button>
            </>
          )}
          <button onClick={onClose} className="rounded-lg p-1 text-ink/40 hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Date filter */}
      <div className="shrink-0 flex items-center gap-2 border-b border-border px-5 py-2">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="rounded border border-border bg-mist px-2 py-1 text-xs text-ink outline-none" />
        <span className="text-xs text-ink/40">to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="rounded border border-border bg-mist px-2 py-1 text-xs text-ink outline-none" />
        <button onClick={applyFilter} className="rounded bg-ink/5 px-2 py-1 text-xs text-ink hover:bg-ink/10">Filter</button>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); load(); }} className="text-xs text-ink/40 hover:text-ink">Clear</button>
        )}
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 size={20} className="animate-spin text-ink/20" />
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2">
            <FileText size={32} className="text-ink/10" />
            <p className="text-sm text-ink/40">No ledger entries yet</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 border-b border-border bg-canvas">
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                <th className="px-4 py-2.5 text-left">Date</th>
                <th className="px-4 py-2.5 text-left">Type / Ref</th>
                <th className="px-4 py-2.5 text-right">Debit</th>
                <th className="px-4 py-2.5 text-right">Credit</th>
                <th className="px-4 py-2.5 text-right">Balance</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.entries.map(e => {
                const meta = ENTRY_META[e.entryType];
                return (
                  <tr key={e._id} className="hover:bg-mist/50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink/60">{fmtDate(e.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium" style={{ color: meta?.color ?? '#64748b' }}>{meta?.label ?? e.entryType}</span>
                      {e.referenceNumber && <span className="ml-1 text-ink/40">· {e.referenceNumber}</span>}
                      {e.description && <p className="mt-0.5 text-[10px] text-ink/30 truncate max-w-[200px]">{e.description}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-red-600">
                      {e.debit > 0 ? `${sym}${e.debit.toFixed(2)}` : ''}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-emerald-600">
                      {e.credit > 0 ? `${sym}${e.credit.toFixed(2)}` : ''}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-semibold text-ink">
                      {sym}{e.runningBalance.toFixed(2)}
                    </td>
                    <td className="px-2 py-2.5" />
                  </tr>
                );
              })}
            </tbody>
            {data.entries.length > 0 && (
              <tfoot className="border-t-2 border-border bg-canvas">
                <tr className="font-semibold text-ink">
                  <td className="px-4 py-2.5 text-[10px] uppercase tracking-wider" colSpan={2}>Total</td>
                  <td className="px-4 py-2.5 text-right font-mono text-red-600">{sym}{data.totalDebit.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-600">{sym}{data.totalCredit.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{sym}{data.currentOutstanding.toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function VendorLedgerPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [tab, setTab]                   = useState<Tab>('outstanding');
  const [report, setReport]             = useState<VendorLedgerReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [payments, setPayments]         = useState<VendorPayment[]>([]);
  const [payTotal, setPayTotal]         = useState(0);
  const [payLoading, setPayLoading]     = useState(false);
  const [ledgerVendorId, setLedgerVendorId] = useState('');
  const [ledgerData, setLedgerData]     = useState<LedgerResponse | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [vendors, setVendors]           = useState<Vendor[]>([]);

  // Filters — payments tab
  const [payVendorSearch, setPayVendorSearch] = useState('');
  const [payFrom, setPayFrom]           = useState('');
  const [payTo, setPayTo]               = useState('');
  const [payMethod, setPayMethod]       = useState('');

  // Ledger tab filters
  const [ledFrom, setLedFrom]           = useState('');
  const [ledTo, setLedTo]               = useState('');

  // Drawers / panels
  const [payDrawerOpen, setPayDrawerOpen]     = useState(false);
  const [payInitVendor, setPayInitVendor]     = useState<string | undefined>();
  const [statVendorId, setStatVendorId]       = useState<string | null>(null);

  // Payment reversal / delete
  const [actionLoading, setActionLoading]     = useState<string | null>(null);

  const loadReport = useCallback(() => {
    setReportLoading(true);
    fetchLedgerReport().then(setReport).catch(() => {}).finally(() => setReportLoading(false));
  }, []);

  const loadPayments = useCallback(() => {
    setPayLoading(true);
    fetchPayments({
      search: payVendorSearch || undefined,
      from:   payFrom || undefined,
      to:     payTo || undefined,
      method: payMethod || undefined,
      limit:  100,
    }).then(r => { setPayments(r.payments); setPayTotal(r.total); })
      .catch(() => {})
      .finally(() => setPayLoading(false));
  }, [payVendorSearch, payFrom, payTo, payMethod]);

  const loadLedger = useCallback(() => {
    if (!ledgerVendorId) return;
    setLedgerLoading(true);
    fetchLedger(ledgerVendorId, { from: ledFrom || undefined, to: ledTo || undefined, limit: 200 })
      .then(setLedgerData)
      .catch(() => {})
      .finally(() => setLedgerLoading(false));
  }, [ledgerVendorId, ledFrom, ledTo]);

  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => { if (tab === 'payments') loadPayments(); }, [tab, loadPayments]);
  useEffect(() => { if (tab === 'ledger' && ledgerVendorId) loadLedger(); }, [tab, ledgerVendorId, loadLedger]);
  useEffect(() => {
    fetchVendors({ active: 'true', limit: 200 }).then(r => setVendors(r.vendors)).catch(() => {});
  }, []);

  async function handleReverse(p: VendorPayment) {
    const reason = window.prompt(`Reason for reversing ${p.paymentNumber}?`);
    if (reason === null) return;
    setActionLoading(p._id);
    try {
      await reversePayment(p._id, reason);
      loadPayments(); loadReport();
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setActionLoading(null); }
  }

  function openPayNow(vendorId: string) {
    setStatVendorId(null);
    setPayInitVendor(vendorId);
    setPayDrawerOpen(true);
  }

  function exportPaymentsCSV() {
    downloadCSV(`payments-${todayISO()}.csv`,
      ['Payment No', 'Vendor', 'Date', 'Method', 'Amount', 'Reference', 'Notes', 'Status'],
      payments.map(p => [[
        p.paymentNumber, p.vendorSnapshot.businessName, fmtDate(p.paymentDate),
        METHOD_META[p.paymentMethod]?.label ?? p.paymentMethod,
        p.amount.toFixed(2), p.referenceNumber, p.notes,
        p.isReversed ? 'Reversed' : 'Active',
      ]]),
    );
  }

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'outstanding', label: 'Outstanding' },
    { id: 'payments',    label: 'Payments' },
    { id: 'ledger',      label: 'Ledger' },
    { id: 'reports',     label: 'Reports' },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-mist">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-1 border-b border-border bg-canvas px-6 pt-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-b-2 border-brand text-brand'
                : 'text-ink/50 hover:text-ink'
            }`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto pb-2">
          <button onClick={() => { setPayInitVendor(undefined); setPayDrawerOpen(true); }}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
            <Plus size={13} />New Payment
          </button>
        </div>
      </div>

      {/* ── Outstanding Tab ── */}
      {tab === 'outstanding' && (
        <div className="flex flex-1 overflow-hidden">
          {/* Vendor list */}
          <div className={`flex flex-col ${statVendorId ? 'w-1/2' : 'w-full'} overflow-hidden border-r border-border`}>
            <div className="shrink-0 px-5 py-4">
              <div className="mb-4 grid grid-cols-3 gap-3">
                <KPICard label="Total Outstanding" value={fmt(report?.totalOutstanding ?? 0, sym)} accent />
                <KPICard label="Vendors Owing" value={String(report?.vendorsWithOutstanding ?? 0)} sub="have pending dues" />
                <KPICard label="Paid This Month" value={fmt(report?.paymentThisMonth ?? 0, sym)} sub={`${report?.paymentCountThisMonth ?? 0} payments`} />
              </div>
            </div>

            {reportLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Loader2 size={24} className="animate-spin text-ink/20" />
              </div>
            ) : (report?.outstandingVendors ?? []).length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2">
                <CheckCircle size={40} className="text-emerald-400" />
                <p className="text-sm font-medium text-ink/60">All clear! No outstanding dues</p>
              </div>
            ) : (
              <div className="flex-1 overflow-x-auto overflow-y-auto">
                <table className="w-full text-xs min-w-[480px]">
                  <thead className="sticky top-0 border-b border-border bg-canvas">
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                      <th className="px-5 py-2.5 text-left">Vendor</th>
                      <th className="px-5 py-2.5 text-right">Outstanding</th>
                      <th className="px-5 py-2.5 text-right">Credit Limit</th>
                      <th className="px-5 py-2.5 text-right">Terms</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(report?.outstandingVendors ?? []).map(v => (
                      <tr key={v._id}
                        className={`cursor-pointer hover:bg-mist/70 ${statVendorId === v._id ? 'bg-brand/5' : ''}`}
                        onClick={() => setStatVendorId(v._id === statVendorId ? null : v._id)}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink">{v.businessName}</p>
                          <p className="text-ink/40">{v.mobile}</p>
                        </td>
                        <td className="px-5 py-3 text-right font-mono font-semibold text-red-600">
                          {sym}{v.currentOutstanding.toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-ink/50">
                          {sym}{v.creditLimit.toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right text-ink/50 capitalize">
                          {v.paymentTerms?.replace('net', 'Net ') ?? '—'}
                        </td>
                        <td className="px-5 py-3">
                          <ChevronRight size={14} className="text-ink/30" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Statement panel */}
          {statVendorId && (
            <div className="flex w-1/2 flex-col overflow-hidden bg-canvas">
              <VendorStatementPanel
                vendorId={statVendorId}
                onClose={() => setStatVendorId(null)}
                onPayNow={openPayNow}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Payments Tab ── */}
      {tab === 'payments' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Filters */}
          <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border bg-canvas px-5 py-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
              <input value={payVendorSearch} onChange={e => setPayVendorSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadPayments()}
                placeholder="Search vendor, ref…"
                className="w-full rounded-lg border border-border bg-mist py-1.5 pl-8 pr-3 text-xs text-ink outline-none focus:border-brand/50" />
            </div>
            <input type="date" value={payFrom} onChange={e => setPayFrom(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none" />
            <input type="date" value={payTo} onChange={e => setPayTo(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none" />
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none">
              <option value="">All Methods</option>
              {(Object.keys(METHOD_META) as VendorPaymentMethod[]).map(m => (
                <option key={m} value={m}>{METHOD_META[m].label}</option>
              ))}
            </select>
            <button onClick={loadPayments} className="rounded-lg border border-border bg-canvas p-1.5 text-ink/50 hover:text-ink">
              <RefreshCw size={12} />
            </button>
            <button onClick={exportPaymentsCSV} className="rounded-lg border border-border bg-canvas p-1.5 text-ink/50 hover:text-ink">
              <Download size={12} />
            </button>
            <span className="text-xs text-ink/40 ml-auto">{payTotal} payment{payTotal !== 1 ? 's' : ''}</span>
          </div>

          {payLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 size={24} className="animate-spin text-ink/20" />
            </div>
          ) : payments.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <CreditCard size={40} className="text-ink/10" />
              <p className="text-sm text-ink/40">No payments found</p>
              <button onClick={() => { setPayInitVendor(undefined); setPayDrawerOpen(true); }}
                className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white">
                Record First Payment
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b border-border bg-canvas">
                  <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                    <th className="px-5 py-2.5 text-left">Payment #</th>
                    <th className="px-5 py-2.5 text-left">Vendor</th>
                    <th className="px-5 py-2.5 text-left">Date</th>
                    <th className="px-5 py-2.5 text-left">Method</th>
                    <th className="px-5 py-2.5 text-right">Amount</th>
                    <th className="px-5 py-2.5 text-left">Ref</th>
                    <th className="px-5 py-2.5 text-left">Status</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payments.map(p => (
                    <tr key={p._id} className={`hover:bg-mist/50 ${p.isReversed ? 'opacity-50' : ''}`}>
                      <td className="px-5 py-3 font-mono font-semibold text-brand">{p.paymentNumber}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-ink">{p.vendorSnapshot.businessName}</p>
                        <p className="text-ink/40">{p.vendorSnapshot.mobile}</p>
                      </td>
                      <td className="px-5 py-3 text-ink/60">{fmtDate(p.paymentDate)}</td>
                      <td className="px-5 py-3"><MethodBadge method={p.paymentMethod} /></td>
                      <td className="px-5 py-3 text-right font-mono font-semibold text-emerald-600">
                        {sym}{p.amount.toFixed(2)}
                      </td>
                      <td className="px-5 py-3 text-ink/50">{p.referenceNumber || '—'}</td>
                      <td className="px-5 py-3">
                        {p.isReversed ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">Reversed</span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Active</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {!p.isReversed && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => void handleReverse(p)} disabled={actionLoading === p._id}
                              className="rounded p-1 text-ink/30 hover:text-amber-600" title="Reverse">
                              {actionLoading === p._id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Ledger Tab ── */}
      {tab === 'ledger' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Vendor + date selector */}
          <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border bg-canvas px-5 py-3">
            <select value={ledgerVendorId} onChange={e => setLedgerVendorId(e.target.value)}
              className="rounded-lg border border-border bg-mist px-3 py-1.5 text-xs text-ink outline-none min-w-[200px]">
              <option value="">Select Vendor…</option>
              {vendors.map(v => (
                <option key={v._id} value={v._id}>{v.businessName} — {sym}{v.currentOutstanding.toFixed(2)}</option>
              ))}
            </select>
            <input type="date" value={ledFrom} onChange={e => setLedFrom(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none" />
            <input type="date" value={ledTo} onChange={e => setLedTo(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none" />
            <button onClick={loadLedger} disabled={!ledgerVendorId}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              Load
            </button>
            {ledgerData && (
              <>
                <button onClick={() => {
                  if (!ledgerData) return;
                  const s = ledgerData.vendor;
                  downloadCSV(`ledger-${s.businessName}-${todayISO()}.csv`,
                    ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'],
                    ledgerData.entries.map(e => [[
                      fmtDate(e.createdAt), ENTRY_META[e.entryType]?.label ?? e.entryType,
                      e.referenceNumber, e.description,
                      e.debit > 0 ? e.debit.toFixed(2) : '',
                      e.credit > 0 ? e.credit.toFixed(2) : '',
                      e.runningBalance.toFixed(2),
                    ]]),
                  );
                }} className="rounded-lg border border-border p-1.5 text-ink/50 hover:text-ink">
                  <Download size={13} />
                </button>
                <span className="ml-auto text-xs font-semibold text-red-600">
                  Outstanding: {sym}{ledgerData.currentOutstanding.toFixed(2)}
                </span>
              </>
            )}
          </div>

          {!ledgerVendorId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2">
              <Eye size={36} className="text-ink/10" />
              <p className="text-sm text-ink/40">Select a vendor to view their ledger</p>
            </div>
          ) : ledgerLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 size={24} className="animate-spin text-ink/20" />
            </div>
          ) : !ledgerData || ledgerData.entries.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2">
              <FileText size={36} className="text-ink/10" />
              <p className="text-sm text-ink/40">No ledger entries for this vendor</p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b border-border bg-canvas">
                  <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">
                    <th className="px-5 py-2.5 text-left">Date</th>
                    <th className="px-5 py-2.5 text-left">Type</th>
                    <th className="px-5 py-2.5 text-left">Reference</th>
                    <th className="px-5 py-2.5 text-left">Description</th>
                    <th className="px-5 py-2.5 text-right">Debit</th>
                    <th className="px-5 py-2.5 text-right">Credit</th>
                    <th className="px-5 py-2.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...ledgerData.entries].reverse().map(e => {
                    const meta = ENTRY_META[e.entryType];
                    return (
                      <tr key={e._id} className="hover:bg-mist/50">
                        <td className="whitespace-nowrap px-5 py-2.5 text-ink/60">{fmtDate(e.createdAt)}</td>
                        <td className="px-5 py-2.5">
                          <span className="font-semibold" style={{ color: meta?.color ?? '#64748b' }}>
                            {meta?.label ?? e.entryType}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 font-mono text-ink/50">{e.referenceNumber || '—'}</td>
                        <td className="max-w-[200px] truncate px-5 py-2.5 text-ink/50">{e.description || '—'}</td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right font-mono text-red-600">
                          {e.debit > 0 ? `${sym}${e.debit.toFixed(2)}` : ''}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right font-mono text-emerald-600">
                          {e.credit > 0 ? `${sym}${e.credit.toFixed(2)}` : ''}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right font-mono font-semibold text-ink">
                          {sym}{e.runningBalance.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Reports Tab ── */}
      {tab === 'reports' && (
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {reportLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 size={24} className="animate-spin text-ink/20" />
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KPICard label="Total Outstanding" value={fmt(report?.totalOutstanding ?? 0, sym)} accent />
                <KPICard label="Vendors with Dues" value={String(report?.vendorsWithOutstanding ?? 0)} />
                <KPICard label="Paid This Month" value={fmt(report?.paymentThisMonth ?? 0, sym)} sub={`${report?.paymentCountThisMonth ?? 0} payments`} />
                <KPICard label="Total Vendors" value={String(report?.totalVendors ?? 0)} />
              </div>

              {/* Aging */}
              <div className="rounded-xl border border-border bg-canvas p-5">
                <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">GRN Aging</h3>
                <div className="grid grid-cols-4 gap-3">
                  {([
                    { label: '0 – 30 days',  key: 'current' as const,   color: 'emerald' },
                    { label: '31 – 60 days', key: 'days31_60' as const, color: 'yellow' },
                    { label: '61 – 90 days', key: 'days61_90' as const, color: 'orange' },
                    { label: '> 90 days',    key: 'over90' as const,    color: 'red' },
                  ]).map(bucket => (
                    <div key={bucket.key} className="rounded-lg border border-border bg-mist p-3 text-center">
                      <p className="text-[10px] font-semibold uppercase text-ink/40">{bucket.label}</p>
                      <p className={`mt-1 text-lg font-bold tabular-nums text-${bucket.color}-600`}>
                        {sym}{(report?.aging?.[bucket.key] ?? 0).toFixed(0)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent payments */}
              {(report?.recentPayments?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-border bg-canvas p-5">
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">Recent Payments</h3>
                  <div className="space-y-2">
                    {report!.recentPayments.map(p => (
                      <div key={p._id} className="flex items-center justify-between rounded-lg bg-mist px-3 py-2.5">
                        <div>
                          <span className="font-mono text-xs font-semibold text-brand">{p.paymentNumber}</span>
                          <span className="ml-2 text-xs text-ink">{p.vendorSnapshot.businessName}</span>
                          <MethodBadge method={p.paymentMethod} />
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-sm font-semibold text-emerald-600">{sym}{p.amount.toFixed(2)}</p>
                          <p className="text-[10px] text-ink/40">{fmtDate(p.paymentDate)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Outstanding vendors */}
              {(report?.outstandingVendors?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-border bg-canvas p-5">
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">Top Outstanding Vendors</h3>
                  <div className="space-y-2">
                    {report!.outstandingVendors.map(v => {
                      const utilization = v.creditLimit > 0 ? Math.min(1, v.currentOutstanding / v.creditLimit) : 0;
                      return (
                        <div key={v._id} className="rounded-lg border border-border bg-mist p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-semibold text-ink">{v.businessName}</p>
                              <p className="text-[10px] text-ink/40">{v.mobile}</p>
                            </div>
                            <p className="font-mono text-sm font-bold text-red-600">{sym}{v.currentOutstanding.toFixed(2)}</p>
                          </div>
                          {v.creditLimit > 0 && (
                            <div className="mt-2">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                                <div
                                  className="h-full rounded-full bg-red-500"
                                  style={{ width: `${(utilization * 100).toFixed(0)}%` }}
                                />
                              </div>
                              <p className="mt-0.5 text-[10px] text-ink/40">
                                {(utilization * 100).toFixed(0)}% of {sym}{v.creditLimit.toFixed(0)} credit limit
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Payment drawer */}
      <PaymentDrawer
        open={payDrawerOpen}
        onClose={() => { setPayDrawerOpen(false); setPayInitVendor(undefined); }}
        initialVendorId={payInitVendor}
        onCreated={p => {
          setPayDrawerOpen(false);
          setPayInitVendor(undefined);
          loadReport();
          if (tab === 'payments') loadPayments();
          if (tab === 'outstanding') {
            setStatVendorId(p.vendorId);
          }
        }}
      />
    </div>
  );
}
