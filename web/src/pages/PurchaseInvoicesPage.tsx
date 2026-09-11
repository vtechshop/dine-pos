import { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react';
import {
  Plus, X, RefreshCw, Loader2, ChevronRight,
  CheckCircle, Clock, XCircle, Banknote, FileText,
  Eye, Paperclip, Upload, Trash2,
} from 'lucide-react';
import {
  fetchPurchaseInvoices, fetchPurchaseInvoice,
  createPurchaseInvoice, updatePurchaseInvoice,
  verifyPurchaseInvoice, markPurchaseInvoicePaid,
  cancelPurchaseInvoice, addPurchaseInvoiceAttachment,
} from '../api/purchaseInvoices';
import { fetchVendors } from '../api/vendors';
import type { PurchaseInvoice, InvoiceStatus, InvoiceAttachment, InvoiceTaxBreakupItem } from '../types';
import type { Vendor } from '../api/vendors';
import { useSettings } from '../context/SettingsContext';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number, sym = '₹') {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function computeTotal(
  subtotal: number, taxTotal: number, freight: number, otherCharges: number, discount: number,
): number {
  return subtotal + taxTotal + freight + otherCharges - discount;
}

const LIMIT = 30;

// ── Status meta ────────────────────────────────────────────────────────────────

const STATUS_META: Record<InvoiceStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  draft:     { label: 'Draft',    icon: <Clock size={11} />,       cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  verified:  { label: 'Verified', icon: <CheckCircle size={11} />, cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  paid:      { label: 'Paid',     icon: <Banknote size={11} />,    cls: 'bg-green-50 text-green-700 border-green-200' },
  cancelled: { label: 'Cancelled',icon: <XCircle size={11} />,     cls: 'bg-red-50 text-red-700 border-red-200' },
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const m = STATUS_META[status] ?? { label: status, icon: null, cls: 'bg-ink/5 text-ink/60' };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>
      {m.icon}{m.label}
    </span>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

function DetailPanel({
  invoice, onClose, sym, onRefreshAttachments,
}: {
  invoice: PurchaseInvoice;
  onClose: () => void;
  sym: string;
  onRefreshAttachments: (id: string) => void;
}) {
  const [full, setFull] = useState<PurchaseInvoice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPurchaseInvoice(invoice._id).then(r => setFull(r.invoice)).catch(() => {});
  }, [invoice._id]);

  const displayed = full ?? invoice;

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr('');
    try {
      const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';
      const token = localStorage.getItem('pos_token');
      const form = new FormData();
      form.append('image', file);
      const res = await fetch(`${API_BASE}/uploads/image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message || 'Upload failed');
      }
      const { url } = await res.json() as { url: string };
      await addPurchaseInvoiceAttachment(invoice._id, {
        filename: file.name,
        url,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
      });
      const refreshed = await fetchPurchaseInvoice(invoice._id);
      setFull(refreshed.invoice);
      onRefreshAttachments(invoice._id);
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const attachments: InvoiceAttachment[] = displayed.attachments ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h3 className="font-semibold text-ink">{displayed.invoiceNumber}</h3>
          <p className="text-xs text-ink/50">{displayed.vendorSnapshot?.businessName}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-ink/5 text-ink/40 hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Core fields */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-ink/40 text-xs">Status</p><StatusBadge status={displayed.status} /></div>
          <div><p className="text-ink/40 text-xs">Grand Total</p><p className="font-semibold text-ink">{fmt(displayed.grandTotal, sym)}</p></div>
          <div><p className="text-ink/40 text-xs">Invoice Date</p><p className="text-ink">{fmtDate(displayed.invoiceDate)}</p></div>
          <div><p className="text-ink/40 text-xs">Vendor Invoice #</p><p className="font-medium text-ink">{displayed.vendorInvoiceNo || '—'}</p></div>
          <div><p className="text-ink/40 text-xs">Vendor</p><p className="font-medium text-ink truncate">{displayed.vendorSnapshot?.businessName}</p></div>
          <div><p className="text-ink/40 text-xs">Vendor Code</p><p className="text-ink">{displayed.vendorSnapshot?.vendorCode || '—'}</p></div>
          {displayed.grnNumbers?.length > 0 && (
            <div className="col-span-2">
              <p className="text-ink/40 text-xs">Linked GRNs</p>
              <p className="text-ink">{displayed.grnNumbers.join(', ')}</p>
            </div>
          )}
          <div><p className="text-ink/40 text-xs">Created</p><p className="text-ink">{fmtDate(displayed.createdAt)}</p></div>
          <div><p className="text-ink/40 text-xs">By</p><p className="text-ink truncate">{displayed.createdBy || '—'}</p></div>
          {displayed.verifiedBy && (
            <div><p className="text-ink/40 text-xs">Verified by</p><p className="text-ink">{displayed.verifiedBy}</p></div>
          )}
          {displayed.verifiedAt && (
            <div><p className="text-ink/40 text-xs">Verified at</p><p className="text-ink">{fmtDate(displayed.verifiedAt)}</p></div>
          )}
          {displayed.paidAt && (
            <div><p className="text-ink/40 text-xs">Paid at</p><p className="text-ink">{fmtDate(displayed.paidAt)}</p></div>
          )}
          {displayed.paymentRef && (
            <div className="col-span-2"><p className="text-ink/40 text-xs">Payment Ref</p><p className="text-ink">{displayed.paymentRef}</p></div>
          )}
          {displayed.cancelReason && (
            <div className="col-span-2"><p className="text-ink/40 text-xs">Cancel Reason</p><p className="text-ink">{displayed.cancelReason}</p></div>
          )}
          {displayed.notes && (
            <div className="col-span-2"><p className="text-ink/40 text-xs">Notes</p><p className="text-ink">{displayed.notes}</p></div>
          )}
        </div>

        {/* Financials */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-ink/40 mb-2">Financials</h4>
          <div className="rounded-lg border border-border overflow-hidden text-sm">
            <div className="flex justify-between px-3 py-2 bg-surface"><span className="text-ink/60">Subtotal</span><span className="font-medium tabular-nums">{fmt(displayed.subtotal, sym)}</span></div>
            {(displayed.taxBreakup ?? []).map((t, i) => (
              <div key={i} className="flex justify-between px-3 py-2 border-t border-border/50">
                <span className="text-ink/60">{t.label} ({t.rate}%)</span>
                <span className="tabular-nums">{fmt(t.amount, sym)}</span>
              </div>
            ))}
            {displayed.taxTotal > 0 && (
              <div className="flex justify-between px-3 py-2 border-t border-border/50"><span className="text-ink/60">Tax Total</span><span className="tabular-nums">{fmt(displayed.taxTotal, sym)}</span></div>
            )}
            {displayed.freight > 0 && (
              <div className="flex justify-between px-3 py-2 border-t border-border/50"><span className="text-ink/60">Freight</span><span className="tabular-nums">{fmt(displayed.freight, sym)}</span></div>
            )}
            {displayed.otherCharges > 0 && (
              <div className="flex justify-between px-3 py-2 border-t border-border/50"><span className="text-ink/60">Other Charges</span><span className="tabular-nums">{fmt(displayed.otherCharges, sym)}</span></div>
            )}
            {displayed.discount > 0 && (
              <div className="flex justify-between px-3 py-2 border-t border-border/50"><span className="text-ink/60">Discount</span><span className="tabular-nums text-green-700">-{fmt(displayed.discount, sym)}</span></div>
            )}
            <div className="flex justify-between px-3 py-2.5 border-t border-border bg-surface font-bold">
              <span>Grand Total</span><span className="tabular-nums">{fmt(displayed.grandTotal, sym)}</span>
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-ink/40 mb-2">Attachments</h4>
          {attachments.length === 0 && <p className="text-sm text-ink/40">No attachments</p>}
          <div className="space-y-1">
            {attachments.map((a, i) => (
              <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface transition-colors">
                <Paperclip size={12} className="text-ink/40 shrink-0" />
                <span className="truncate text-brand">{a.filename}</span>
                <span className="ml-auto shrink-0 text-[10px] text-ink/30">{(a.fileSize / 1024).toFixed(0)} KB</span>
              </a>
            ))}
          </div>
          {displayed.status !== 'cancelled' && (
            <div className="mt-2">
              <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 text-xs text-brand hover:text-brand/80 disabled:opacity-50"
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {uploading ? 'Uploading…' : 'Add attachment'}
              </button>
              {uploadErr && <p className="mt-1 text-xs text-red-600">{uploadErr}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Confirm Dialog (Verify) ────────────────────────────────────────────────────

function ConfirmDialog({
  title, body, confirmLabel, confirmCls = 'bg-brand text-white hover:bg-brand/90',
  onConfirm, onCancel, busy, error,
}: {
  title: string; body: string; confirmLabel: string; confirmCls?: string;
  onConfirm: () => void; onCancel: () => void; busy: boolean; error?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-xl">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-ink/60">{body}</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-surface disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${confirmCls}`}>
            {busy && <Loader2 size={14} className="animate-spin" />}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mark Paid Dialog ───────────────────────────────────────────────────────────

function MarkPaidDialog({
  invoice, onDone, onCancel,
}: {
  invoice: PurchaseInvoice; onDone: (updated: PurchaseInvoice) => void; onCancel: () => void;
}) {
  const [paymentRef, setPaymentRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit() {
    setBusy(true); setErr('');
    try {
      const { invoice: updated } = await markPurchaseInvoicePaid(invoice._id, paymentRef);
      onDone(updated);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to mark paid');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-xl">
        <h3 className="text-base font-semibold text-ink">Mark as Paid</h3>
        <p className="mt-1 text-sm text-ink/60">{invoice.invoiceNumber} — {invoice.vendorSnapshot?.businessName}</p>
        <div className="mt-4">
          <label className="block text-xs font-medium text-ink/60 mb-1">Payment Reference (optional)</label>
          <input
            value={paymentRef}
            onChange={e => setPaymentRef(e.target.value)}
            placeholder="e.g. UTR number, cheque no."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-surface disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}Mark Paid
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cancel Dialog ──────────────────────────────────────────────────────────────

function CancelDialog({
  invoice, onDone, onCancel,
}: {
  invoice: PurchaseInvoice; onDone: () => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit() {
    setBusy(true); setErr('');
    try {
      await cancelPurchaseInvoice(invoice._id, reason);
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-xl">
        <h3 className="text-base font-semibold text-ink">Cancel Invoice</h3>
        <p className="mt-1 text-sm text-ink/60">{invoice.invoiceNumber} — {invoice.vendorSnapshot?.businessName}</p>
        <div className="mt-4">
          <label className="block text-xs font-medium text-ink/60 mb-1">Reason (optional)</label>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason for cancellation"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-surface disabled:opacity-50">
            Back
          </button>
          <button onClick={handleSubmit} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}Cancel Invoice
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invoice Form Drawer ────────────────────────────────────────────────────────

interface TaxRow { label: string; rate: string; amount: string }
const EMPTY_TAX_ROW: TaxRow = { label: '', rate: '', amount: '' };

function InvoiceFormDrawer({
  editing, onDone, onClose,
}: {
  editing: PurchaseInvoice | null;
  onDone: (inv: PurchaseInvoice) => void;
  onClose: () => void;
}) {
  const isEdit = !!editing;

  // Vendor typeahead
  const [vendorSearch, setVendorSearch] = useState(editing?.vendorSnapshot?.businessName ?? '');
  const [vendorResults, setVendorResults] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const vendorTimer = useRef<ReturnType<typeof setTimeout>>();
  // Monotonic counter: stale responses (from slower earlier requests) are ignored
  const vendorReqId = useRef(0);

  // Form fields
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState(editing?.vendorInvoiceNo ?? '');
  const [invoiceDate, setInvoiceDate] = useState(
    editing?.invoiceDate
      ? editing.invoiceDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  );
  const [subtotal, setSubtotal] = useState(editing ? String(editing.subtotal) : '');
  const [taxRows, setTaxRows] = useState<TaxRow[]>(
    editing?.taxBreakup?.length
      ? editing.taxBreakup.map(t => ({ label: t.label, rate: String(t.rate), amount: String(t.amount) }))
      : [{ ...EMPTY_TAX_ROW }],
  );
  const [taxTotal, setTaxTotal] = useState(editing ? String(editing.taxTotal) : '');
  const [freight, setFreight] = useState(editing ? String(editing.freight) : '0');
  const [otherCharges, setOtherCharges] = useState(editing ? String(editing.otherCharges) : '0');
  const [discount, setDiscount] = useState(editing ? String(editing.discount) : '0');
  const [grandTotal, setGrandTotal] = useState(editing ? String(editing.grandTotal) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Auto-compute grandTotal whenever inputs change.
  // Guard is `>= 0` (not `> 0`) so that clearing all fields also resets grandTotal to "0.00"
  // instead of leaving a stale value that will fail the server's ±₹1 tolerance check.
  useEffect(() => {
    const s = parseFloat(subtotal) || 0;
    const tt = parseFloat(taxTotal) || 0;
    const f = parseFloat(freight) || 0;
    const oc = parseFloat(otherCharges) || 0;
    const d = parseFloat(discount) || 0;
    const computed = computeTotal(s, tt, f, oc, d);
    if (computed >= 0) setGrandTotal(computed.toFixed(2));
  }, [subtotal, taxTotal, freight, otherCharges, discount]);

  // Auto-sum tax rows into taxTotal
  useEffect(() => {
    const sum = taxRows.reduce((acc, r) => acc + (parseFloat(r.amount) || 0), 0);
    if (sum > 0) setTaxTotal(sum.toFixed(2));
  }, [taxRows]);

  function searchVendors(q: string) {
    setVendorSearch(q);
    setSelectedVendor(null);
    clearTimeout(vendorTimer.current);
    if (!q.trim()) { setVendorResults([]); return; }
    const reqId = ++vendorReqId.current;
    vendorTimer.current = setTimeout(async () => {
      try {
        const { vendors } = await fetchVendors({ search: q, active: 'true', limit: 8 });
        // Ignore if a newer search was already started (stale response guard)
        if (reqId === vendorReqId.current) setVendorResults(vendors);
      } catch {
        if (reqId === vendorReqId.current) setVendorResults([]);
      }
    }, 250);
  }

  function selectVendor(v: Vendor) {
    setSelectedVendor(v);
    setVendorSearch(v.businessName);
    setVendorResults([]);
  }

  function updateTaxRow(i: number, field: keyof TaxRow, val: string) {
    setTaxRows(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }

  async function handleSubmit() {
    const vendorId = selectedVendor?._id ?? editing?.vendorId ?? '';
    if (!vendorId) { setErr('Please select a vendor'); return; }
    const sub = parseFloat(subtotal);
    if (isNaN(sub) || sub < 0) { setErr('Enter a valid subtotal'); return; }
    const gt = parseFloat(grandTotal);
    if (isNaN(gt) || gt < 0) { setErr('Enter a valid grand total'); return; }

    const payload = {
      vendorId,
      vendorInvoiceNo,
      invoiceDate,
      subtotal: sub,
      taxBreakup: taxRows
        .filter(r => r.label || r.amount)
        .map(r => ({ label: r.label, rate: parseFloat(r.rate) || 0, amount: parseFloat(r.amount) || 0 })) as InvoiceTaxBreakupItem[],
      taxTotal: parseFloat(taxTotal) || 0,
      freight: parseFloat(freight) || 0,
      otherCharges: parseFloat(otherCharges) || 0,
      discount: parseFloat(discount) || 0,
      grandTotal: gt,
      notes,
    };

    setBusy(true); setErr('');
    try {
      const result = isEdit
        ? await updatePurchaseInvoice(editing!._id, payload)
        : await createPurchaseInvoice(payload);
      onDone(result.invoice);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />
      {/* Panel */}
      <div className="w-[520px] shrink-0 bg-canvas border-l border-border flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-ink">
            {isEdit ? `Edit ${editing!.invoiceNumber}` : 'New Purchase Invoice'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-ink/5 text-ink/40 hover:text-ink"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Vendor */}
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">Vendor *</label>
            <div className="relative">
              <input
                value={vendorSearch}
                onChange={e => searchVendors(e.target.value)}
                placeholder="Search vendor…"
                disabled={isEdit}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              />
              {vendorResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-xl border border-border bg-canvas shadow-xl overflow-hidden">
                  {vendorResults.map(v => (
                    <button key={v._id} onClick={() => selectVendor(v)}
                      className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-surface transition-colors">
                      <div>
                        <p className="text-sm font-medium text-ink">{v.businessName}</p>
                        <p className="text-xs text-ink/40">{v.vendorCode} · {v.gstNumber || 'No GST'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Vendor Invoice # + Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">Vendor Invoice #</label>
              <input
                value={vendorInvoiceNo}
                onChange={e => setVendorInvoiceNo(e.target.value)}
                placeholder="e.g. INV-2024-001"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">Invoice Date</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>

          {/* Subtotal */}
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">Subtotal *</label>
            <input
              type="number" min="0" step="0.01"
              value={subtotal}
              onChange={e => setSubtotal(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          {/* Tax Breakup */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-ink/60">Tax Breakup</label>
              <button
                onClick={() => setTaxRows(r => [...r, { ...EMPTY_TAX_ROW }])}
                className="text-xs text-brand hover:underline"
              >+ Add row</button>
            </div>
            <div className="space-y-2">
              {taxRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.label}
                    onChange={e => updateTaxRow(i, 'label', e.target.value)}
                    placeholder="Label (e.g. GST 18%)"
                    className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-1 focus:ring-brand/30"
                  />
                  <input
                    type="number" min="0" step="0.01"
                    value={row.rate}
                    onChange={e => updateTaxRow(i, 'rate', e.target.value)}
                    placeholder="Rate %"
                    className="w-20 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-1 focus:ring-brand/30"
                  />
                  <input
                    type="number" min="0" step="0.01"
                    value={row.amount}
                    onChange={e => updateTaxRow(i, 'amount', e.target.value)}
                    placeholder="Amount"
                    className="w-24 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-1 focus:ring-brand/30"
                  />
                  {taxRows.length > 1 && (
                    <button onClick={() => setTaxRows(r => r.filter((_, idx) => idx !== i))} className="text-ink/30 hover:text-red-500">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Charges row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">Tax Total</label>
              <input type="number" min="0" step="0.01" value={taxTotal} onChange={e => setTaxTotal(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">Freight</label>
              <input type="number" min="0" step="0.01" value={freight} onChange={e => setFreight(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">Other Charges</label>
              <input type="number" min="0" step="0.01" value={otherCharges} onChange={e => setOtherCharges(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">Discount</label>
              <input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
          </div>

          {/* Grand Total */}
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">Grand Total *</label>
            <input type="number" min="0" step="0.01" value={grandTotal} onChange={e => setGrandTotal(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30" />
            <p className="mt-0.5 text-[10px] text-ink/40">
              Computed: {fmt(computeTotal(
                parseFloat(subtotal) || 0,
                parseFloat(taxTotal) || 0,
                parseFloat(freight) || 0,
                parseFloat(otherCharges) || 0,
                parseFloat(discount) || 0,
              ))} · Server validates within ₹1
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Internal notes…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none" />
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <div className="border-t border-border px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-surface disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PurchaseInvoicesPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // UI state
  const [showCreate, setShowCreate] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<PurchaseInvoice | null>(null);
  const [detailInvoice, setDetailInvoice] = useState<PurchaseInvoice | null>(null);
  const [verifyingInvoice, setVerifyingInvoice] = useState<PurchaseInvoice | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [payingInvoice, setPayingInvoice] = useState<PurchaseInvoice | null>(null);
  const [cancellingInvoice, setCancellingInvoice] = useState<PurchaseInvoice | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const data = await fetchPurchaseInvoices({
        page,
        limit: LIMIT,
        status: statusFilter || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      setInvoices(data.invoices);
      setTotal(data.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load invoices');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, statusFilter, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  // KPI counts from current page
  const kpiDraft    = invoices.filter(i => i.status === 'draft').length;
  const kpiVerified = invoices.filter(i => i.status === 'verified').length;
  const kpiPaid     = invoices.filter(i => i.status === 'paid').length;

  function updateInvoiceInList(updated: PurchaseInvoice) {
    setInvoices(prev => prev.map(i => i._id === updated._id ? updated : i));
    if (detailInvoice?._id === updated._id) setDetailInvoice(updated);
  }

  async function handleVerifyConfirm() {
    if (!verifyingInvoice) return;
    setVerifyBusy(true);
    setVerifyError('');
    try {
      const { invoice } = await verifyPurchaseInvoice(verifyingInvoice._id);
      updateInvoiceInList(invoice);
      setVerifyingInvoice(null);
    } catch (e: unknown) {
      // Show error inside the dialog so the user sees it without having to close first
      setVerifyError(e instanceof Error ? e.message : 'Failed to verify invoice');
    } finally {
      setVerifyBusy(false);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-ink">Purchase Invoices</h1>
          <p className="text-xs text-ink/40">{total.toLocaleString()} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink hover:bg-surface disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
          >
            <Plus size={14} />New Invoice
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-4 px-6 py-4 shrink-0">
        <KPICard label="Total" value={total.toLocaleString()} sub="all invoices" />
        <KPICard label="Draft" value={String(kpiDraft)} sub="this page" />
        <KPICard label="Verified" value={String(kpiVerified)} sub="this page" />
        <KPICard label="Paid" value={String(kpiPaid)} sub="this page" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 pb-3 shrink-0 flex-wrap">
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="verified">Verified</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30" />
        <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30" />
        {(statusFilter || fromDate || toDate) && (
          <button onClick={() => { setStatusFilter(''); setFromDate(''); setToDate(''); setPage(1); }}
            className="text-sm text-ink/40 hover:text-ink">
            Clear filters
          </button>
        )}
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-ink/30" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <p className="text-sm text-red-600">{error}</p>
              <button onClick={() => load()} className="text-sm text-brand underline">Retry</button>
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <FileText size={32} className="text-ink/20" />
              <p className="text-sm text-ink/40">No invoices found</p>
              <button onClick={() => setShowCreate(true)} className="mt-1 text-sm text-brand underline">
                Create first invoice
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-canvas border-b border-border">
                <tr>
                  {['Invoice #', 'Vendor Invoice #', 'Vendor', 'Date', 'Grand Total', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-ink/40 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr
                    key={inv._id}
                    className="border-b border-border/50 hover:bg-ink/[0.02] group cursor-pointer"
                    onClick={() => setDetailInvoice(inv)}
                  >
                    <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-ink/60 whitespace-nowrap">{inv.vendorInvoiceNo || '—'}</td>
                    <td className="px-4 py-3 text-ink max-w-[180px] truncate">{inv.vendorSnapshot?.businessName}</td>
                    <td className="px-4 py-3 text-ink/60 whitespace-nowrap">{fmtDate(inv.invoiceDate)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-ink whitespace-nowrap">{fmt(inv.grandTotal, sym)}</td>
                    <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setDetailInvoice(inv)}
                          className="rounded p-1 text-ink/40 hover:text-ink hover:bg-ink/5"
                          title="View details"
                        ><Eye size={14} /></button>
                        {inv.status === 'draft' && (
                          <>
                            <button
                              onClick={() => setEditingInvoice(inv)}
                              className="rounded px-2 py-1 text-xs text-ink/60 hover:text-ink hover:bg-ink/5"
                            >Edit</button>
                            <button
                              onClick={() => setVerifyingInvoice(inv)}
                              className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                            >Verify</button>
                            <button
                              onClick={() => setCancellingInvoice(inv)}
                              className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            >Cancel</button>
                          </>
                        )}
                        {inv.status === 'verified' && (
                          <>
                            <button
                              onClick={() => setPayingInvoice(inv)}
                              className="rounded px-2 py-1 text-xs text-green-700 hover:bg-green-50"
                            >Mark Paid</button>
                            <button
                              onClick={() => setCancellingInvoice(inv)}
                              className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            >Cancel</button>
                          </>
                        )}
                        <ChevronRight size={14} className="text-ink/20" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <p className="text-xs text-ink/40">
                Page {page} of {totalPages} · {total} invoices
              </p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-surface">
                  Previous
                </button>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-surface">
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {detailInvoice && (
          <div className="w-80 shrink-0 border-l border-border overflow-hidden flex flex-col">
            <DetailPanel
              invoice={detailInvoice}
              onClose={() => setDetailInvoice(null)}
              sym={sym}
              onRefreshAttachments={() => load(true)}
            />
          </div>
        )}
      </div>

      {/* Drawers & Dialogs */}
      {(showCreate || editingInvoice) && (
        <InvoiceFormDrawer
          editing={editingInvoice}
          onClose={() => { setShowCreate(false); setEditingInvoice(null); }}
          onDone={inv => {
            if (editingInvoice) {
              updateInvoiceInList(inv);
            } else {
              load(true);
            }
            setShowCreate(false);
            setEditingInvoice(null);
          }}
        />
      )}

      {verifyingInvoice && (
        <ConfirmDialog
          title="Verify Invoice"
          body={`Verify ${verifyingInvoice.invoiceNumber} from ${verifyingInvoice.vendorSnapshot?.businessName}? Status will change to Verified.`}
          confirmLabel="Verify"
          confirmCls="bg-blue-600 text-white hover:bg-blue-700"
          busy={verifyBusy}
          error={verifyError}
          onConfirm={handleVerifyConfirm}
          onCancel={() => { setVerifyingInvoice(null); setVerifyError(''); }}
        />
      )}

      {payingInvoice && (
        <MarkPaidDialog
          invoice={payingInvoice}
          onDone={updated => { updateInvoiceInList(updated); setPayingInvoice(null); }}
          onCancel={() => setPayingInvoice(null)}
        />
      )}

      {cancellingInvoice && (
        <CancelDialog
          invoice={cancellingInvoice}
          onDone={() => {
            const cancelledId = cancellingInvoice._id;
            setCancellingInvoice(null);
            // Close the detail panel if it was showing the now-cancelled invoice
            setDetailInvoice(d => (d?._id === cancelledId ? null : d));
            load(true);
          }}
          onCancel={() => setCancellingInvoice(null)}
        />
      )}
    </div>
  );
}
