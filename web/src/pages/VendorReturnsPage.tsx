import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Plus, X, RefreshCw, Loader2, ChevronDown,
  CheckCircle, Clock, XCircle, AlertCircle, PackageX,
  RotateCcw, Eye, ChevronRight,
} from 'lucide-react';
import {
  fetchVendorReturns, createVendorReturn, approveVendorReturn,
  completeVendorReturn, cancelVendorReturn,
} from '../api/vendorReturns';
import { fetchVendors } from '../api/vendors';
import { fetchGRNs } from '../api/grn';
import type { VendorReturn, VendorReturnStatus, GRN, GRNItem } from '../types';
import type { Vendor } from '../api/vendors';
import { useSettings } from '../context/SettingsContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, sym = '₹') {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_META: Record<VendorReturnStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  draft:     { label: 'Draft',     icon: <Clock size={11} />,        cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved:  { label: 'Approved',  icon: <CheckCircle size={11} />,  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: 'Completed', icon: <CheckCircle size={11} />,  cls: 'bg-green-50 text-green-700 border-green-200' },
  cancelled: { label: 'Cancelled', icon: <XCircle size={11} />,      cls: 'bg-red-50 text-red-700 border-red-200' },
};

function StatusBadge({ status }: { status: VendorReturnStatus }) {
  const m = STATUS_META[status] ?? { label: status, icon: null, cls: 'bg-ink/5 text-ink/60' };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>
      {m.icon}{m.label}
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ vr, onClose, sym }: { vr: VendorReturn; onClose: () => void; sym: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h3 className="font-semibold text-ink">{vr.returnNumber}</h3>
          <p className="text-xs text-ink/50">{vr.vendorSnapshot.businessName}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-ink/5 text-ink/40 hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-ink/40 text-xs">Status</p><StatusBadge status={vr.status} /></div>
          <div><p className="text-ink/40 text-xs">Return Value</p><p className="font-semibold text-ink">{fmt(vr.returnValue, sym)}</p></div>
          <div><p className="text-ink/40 text-xs">GRN</p><p className="font-medium text-ink">{vr.grnNumber}</p></div>
          <div><p className="text-ink/40 text-xs">PO</p><p className="font-medium text-ink">{vr.poNumber}</p></div>
          <div><p className="text-ink/40 text-xs">Created</p><p className="text-ink">{fmtDate(vr.createdAt)}</p></div>
          <div><p className="text-ink/40 text-xs">By</p><p className="text-ink truncate">{vr.createdBy || '—'}</p></div>
          {vr.approvedBy && (
            <div><p className="text-ink/40 text-xs">Approved by</p><p className="text-ink">{vr.approvedBy}</p></div>
          )}
          {vr.completedAt && (
            <div><p className="text-ink/40 text-xs">Completed</p><p className="text-ink">{fmtDate(vr.completedAt)}</p></div>
          )}
          {vr.cancelReason && (
            <div className="col-span-2">
              <p className="text-ink/40 text-xs">Cancel Reason</p>
              <p className="text-ink">{vr.cancelReason}</p>
            </div>
          )}
          {vr.notes && (
            <div className="col-span-2">
              <p className="text-ink/40 text-xs">Notes</p>
              <p className="text-ink">{vr.notes}</p>
            </div>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-ink/40 mb-2">Items</h4>
          <div className="space-y-2">
            {vr.items.map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-3 text-sm">
                <p className="font-medium text-ink">{item.productName}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink/50">
                  <span>Qty: <span className="font-semibold text-ink">{item.returnQty} {item.unit}</span></span>
                  <span>Price: {fmt(item.purchasePrice, sym)}</span>
                  <span>Value: {fmt(item.returnQty * item.purchasePrice, sym)}</span>
                </div>
                {item.reason && <p className="mt-1 text-xs text-ink/50">Reason: {item.reason}</p>}
                {item.notes  && <p className="text-xs text-ink/40">{item.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create Return Drawer ───────────────────────────────────────────────────────

interface ReturnItemDraft {
  grnItemIndex: number;
  grnItem: GRNItem;
  returnQty: number;
  reason: string;
  notes: string;
  enabled: boolean;
}

function CreateDrawer({
  onClose,
  onCreated,
  sym,
}: {
  onClose: () => void;
  onCreated: () => void;
  sym: string;
}) {
  const [vendorSearch, setVendorSearch]   = useState('');
  const [vendorResults, setVendorResults] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [showVendorDrop, setShowVendorDrop] = useState(false);

  const [grns, setGrns]             = useState<GRN[]>([]);
  const [selectedGRN, setSelectedGRN] = useState<GRN | null>(null);
  const [grnsLoading, setGrnsLoading] = useState(false);

  const [items, setItems] = useState<ReturnItemDraft[]>([]);
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const vendorTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Vendor search
  useEffect(() => {
    clearTimeout(vendorTimerRef.current);
    if (!vendorSearch.trim() || selectedVendor) return;
    vendorTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetchVendors({ search: vendorSearch, active: 'true', limit: 8 });
        setVendorResults(r.vendors);
        setShowVendorDrop(true);
      } catch { /* ignore */ }
    }, 250);
  }, [vendorSearch, selectedVendor]);

  function pickVendor(v: Vendor) {
    setSelectedVendor(v);
    setVendorSearch(v.businessName);
    setShowVendorDrop(false);
    setSelectedGRN(null);
    setItems([]);
    // Load GRNs for this vendor
    setGrnsLoading(true);
    fetchGRNs({ vendorId: v._id, limit: 100 })
      .then(r => {
        setGrns(r.grns.filter(g => g.status !== 'cancelled'));
      })
      .catch(() => setGrns([]))
      .finally(() => setGrnsLoading(false));
  }

  function clearVendor() {
    setSelectedVendor(null);
    setVendorSearch('');
    setVendorResults([]);
    setGrns([]);
    setSelectedGRN(null);
    setItems([]);
  }

  function pickGRN(grnId: string) {
    const grn = grns.find(g => g._id === grnId) || null;
    setSelectedGRN(grn);
    if (!grn) { setItems([]); return; }

    // Build item drafts from GRN items, only those with availableToReturn > 0
    const drafts: ReturnItemDraft[] = grn.items.map((gi, idx) => {
      const accepted  = Math.max(0, gi.receivedQty - (gi.damagedQty || 0) - (gi.rejectedQty || 0));
      const returned  = (gi as any).returnedQty || 0;
      const available = Math.max(0, accepted - returned);
      return {
        grnItemIndex: idx,
        grnItem:      gi,
        returnQty:    0,
        reason:       '',
        notes:        '',
        enabled:      false,
        _available:   available,
      } as ReturnItemDraft & { _available: number };
    });
    setItems(drafts);
  }

  function updateItem(idx: number, patch: Partial<ReturnItemDraft>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!selectedVendor) { setError('Select a vendor.'); return; }
    if (!selectedGRN)    { setError('Select a GRN.'); return; }

    const activeItems = (items as Array<ReturnItemDraft & { _available: number }>)
      .filter(it => it.enabled && it.returnQty > 0);
    if (activeItems.length === 0) { setError('Select at least one item with a return quantity > 0.'); return; }

    for (const it of activeItems) {
      if (it.returnQty > (it._available ?? 0)) {
        setError(`"${it.grnItem.productName}": return qty ${it.returnQty} exceeds available ${it._available}.`);
        return;
      }
    }

    setSaving(true);
    try {
      await createVendorReturn({
        vendorId: selectedVendor._id,
        grnId:    selectedGRN._id,
        items: activeItems.map(it => ({
          grnItemIndex: it.grnItemIndex,
          returnQty:    it.returnQty,
          reason:       it.reason,
          notes:        it.notes,
        })),
        notes,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create return');
    } finally {
      setSaving(false);
    }
  }

  const REASONS = ['Damaged goods', 'Wrong item delivered', 'Quality issue', 'Excess supply', 'Expiry concern', 'Other'];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="font-semibold text-ink">New Return to Vendor</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-ink/5 text-ink/40 hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Vendor search */}
          <div className="relative">
            <label className="block text-xs font-medium text-ink/60 mb-1">Vendor *</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
              <input
                type="text"
                placeholder="Search vendor…"
                value={vendorSearch}
                onChange={e => { setVendorSearch(e.target.value); if (selectedVendor) clearVendor(); }}
                onFocus={() => vendorResults.length > 0 && setShowVendorDrop(true)}
                className="w-full rounded-lg border border-border bg-canvas py-2 pl-9 pr-9 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
              />
              {selectedVendor && (
                <button type="button" onClick={clearVendor} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/30 hover:text-ink">
                  <X size={13} />
                </button>
              )}
            </div>
            {showVendorDrop && vendorResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-canvas shadow-xl overflow-hidden">
                {vendorResults.map(v => (
                  <button
                    key={v._id}
                    type="button"
                    onClick={() => pickVendor(v)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink/5 text-sm"
                  >
                    <span className="flex-1 font-medium text-ink">{v.businessName}</span>
                    <span className="text-xs text-ink/40">{v.vendorCode}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* GRN select */}
          {selectedVendor && (
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">GRN *</label>
              {grnsLoading ? (
                <div className="flex items-center gap-2 text-sm text-ink/50"><Loader2 size={14} className="animate-spin" /> Loading GRNs…</div>
              ) : grns.length === 0 ? (
                <p className="text-sm text-ink/40">No GRNs found for this vendor.</p>
              ) : (
                <select
                  value={selectedGRN?._id || ''}
                  onChange={e => pickGRN(e.target.value)}
                  className="w-full rounded-lg border border-border bg-canvas py-2 px-3 text-sm text-ink focus:border-brand focus:outline-none"
                >
                  <option value="">— select GRN —</option>
                  {grns.map(g => (
                    <option key={g._id} value={g._id}>
                      {g.grnNumber} · {g.poNumber} · {fmtDate(g.receiveDate)} [{g.status}]
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Items */}
          {selectedGRN && items.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-2">Select Items to Return</label>
              <div className="space-y-3">
                {(items as Array<ReturnItemDraft & { _available: number }>).map((it, idx) => {
                  const available = it._available ?? 0;
                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border p-4 transition-all ${it.enabled ? 'border-brand/30 bg-brand/5' : 'border-border bg-canvas'} ${available === 0 ? 'opacity-40' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={it.enabled}
                          disabled={available === 0}
                          onChange={e => updateItem(idx, { enabled: e.target.checked, returnQty: e.target.checked ? Math.min(1, available) : 0 })}
                          className="mt-0.5 h-4 w-4 rounded border-border accent-brand"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-ink">{it.grnItem.productName}</p>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0 text-xs text-ink/50">
                            <span>Received: {Math.max(0, it.grnItem.receivedQty - (it.grnItem.damagedQty||0) - (it.grnItem.rejectedQty||0))} {it.grnItem.unit}</span>
                            <span>Available: <span className={available > 0 ? 'text-green-600 font-semibold' : 'text-red-500'}>{available}</span></span>
                            <span>Price: {fmt(it.grnItem.purchasePrice, sym)}</span>
                          </div>

                          {it.enabled && (
                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] text-ink/40 mb-0.5">Return Qty *</label>
                                <input
                                  type="number"
                                  min="0.001"
                                  max={available}
                                  step="any"
                                  value={it.returnQty || ''}
                                  onChange={e => updateItem(idx, { returnQty: parseFloat(e.target.value) || 0 })}
                                  className="w-full rounded-lg border border-border bg-canvas py-1.5 px-2.5 text-sm text-ink focus:border-brand focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-ink/40 mb-0.5">Reason</label>
                                <select
                                  value={it.reason}
                                  onChange={e => updateItem(idx, { reason: e.target.value })}
                                  className="w-full rounded-lg border border-border bg-canvas py-1.5 px-2.5 text-sm text-ink focus:border-brand focus:outline-none"
                                >
                                  <option value="">— select —</option>
                                  {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                              <div className="col-span-2">
                                <label className="block text-[10px] text-ink/40 mb-0.5">Notes</label>
                                <input
                                  type="text"
                                  value={it.notes}
                                  onChange={e => updateItem(idx, { notes: e.target.value })}
                                  placeholder="Optional notes for this item"
                                  className="w-full rounded-lg border border-border bg-canvas py-1.5 px-2.5 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
                                />
                              </div>
                              <div className="col-span-2 text-xs text-ink/40">
                                Value: {fmt((it.returnQty || 0) * it.grnItem.purchasePrice, sym)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          {selectedGRN && (
            <div>
              <label className="block text-xs font-medium text-ink/60 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Return notes…"
                className="w-full rounded-lg border border-border bg-canvas py-2 px-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none resize-none"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="border-t border-border p-4 flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-ink hover:bg-ink/5">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-60"
          >
            {saving ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : 'Create Draft Return'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Cancel Dialog ─────────────────────────────────────────────────────────────

function CancelDialog({
  vr,
  onClose,
  onDone,
}: {
  vr: VendorReturn;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function handleCancel() {
    setSaving(true);
    setError('');
    try {
      await cancelVendorReturn(vr._id, reason);
      onDone();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel return');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-canvas p-6 shadow-xl">
        <h3 className="font-semibold text-ink">Cancel Return</h3>
        <p className="mt-1 text-sm text-ink/50">Cancel <strong>{vr.returnNumber}</strong>?</p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          placeholder="Cancellation reason (optional)"
          className="mt-4 w-full rounded-lg border border-border bg-canvas py-2 px-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none resize-none"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex gap-3 justify-end">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-ink/5">Keep</button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            Cancel Return
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm Dialog (for approve / complete) ───────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmClass,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function handle() {
    setSaving(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Action failed');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-xl">
        <h3 className="font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-sm text-ink/50">{message}</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex gap-3 justify-end">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-ink/5">Back</button>
          <button
            onClick={handle}
            disabled={saving}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${confirmClass}`}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function VendorReturnsPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol || '₹';

  const [returns, setReturns]   = useState<VendorReturn[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]     = useState(0);
  const LIMIT = 30;

  // Panels / dialogs
  const [showCreate, setShowCreate]             = useState(false);
  const [selectedReturn, setSelectedReturn]     = useState<VendorReturn | null>(null);
  const [approvingReturn, setApprovingReturn]   = useState<VendorReturn | null>(null);
  const [completingReturn, setCompletingReturn] = useState<VendorReturn | null>(null);
  const [cancellingReturn, setCancellingReturn] = useState<VendorReturn | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const r = await fetchVendorReturns({
        search:  search || undefined,
        status:  statusFilter || undefined,
        limit:   LIMIT,
        skip:    page * LIMIT,
        sort:    'createdAt',
        dir:     'desc',
      });
      setReturns(r.returns);
      setTotal(r.total);
    } catch (err: any) {
      setError(err?.message || 'Failed to load returns');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  // KPI counts from visible list (simple local aggregation)
  const draftCount     = returns.filter(r => r.status === 'draft').length;
  const approvedCount  = returns.filter(r => r.status === 'approved').length;
  const completedCount = returns.filter(r => r.status === 'completed').length;
  const totalValue     = returns.reduce((s, r) => s + r.returnValue, 0);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-ink">Return to Vendor</h1>
            <p className="text-xs text-ink/40">{total} return{total !== 1 ? 's' : ''} total</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink hover:bg-ink/5 disabled:opacity-50"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
            >
              <Plus size={14} />
              New Return
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-4 p-6 pb-0">
          <KPICard label="Total Returns" value={String(total)} sub="all time" />
          <KPICard label="Draft" value={String(draftCount)} sub="pending approval" />
          <KPICard label="Approved" value={String(approvedCount)} sub="ready to complete" />
          <KPICard label="Return Value" value={fmt(totalValue, sym)} sub="current page" />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-6 py-4">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              type="text"
              placeholder="Search by return #, vendor, GRN…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="w-full rounded-lg border border-border bg-canvas py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink/30 focus:border-brand focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
            className="rounded-lg border border-border bg-canvas py-2 px-3 text-sm text-ink focus:border-brand focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 size={24} className="animate-spin text-brand" />
            </div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-red-600">
              <AlertCircle size={20} />
              <p className="text-sm">{error}</p>
            </div>
          ) : returns.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-ink/40">
              <PackageX size={32} />
              <p className="text-sm">No returns found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-canvas">
                <tr className="border-b border-border">
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-ink/40">Return #</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-ink/40">Vendor</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-ink/40">GRN</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-ink/40">Date</th>
                  <th className="py-3 pr-4 text-right text-xs font-semibold uppercase tracking-wider text-ink/40">Items</th>
                  <th className="py-3 pr-4 text-right text-xs font-semibold uppercase tracking-wider text-ink/40">Value</th>
                  <th className="py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-ink/40">Status</th>
                  <th className="py-3 text-right text-xs font-semibold uppercase tracking-wider text-ink/40">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {returns.map(vr => (
                  <tr key={vr._id} className="hover:bg-ink/[0.02] group">
                    <td className="py-3 pr-4 font-medium text-ink">{vr.returnNumber}</td>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-ink">{vr.vendorSnapshot.businessName}</p>
                      <p className="text-xs text-ink/40">{vr.vendorSnapshot.vendorCode}</p>
                    </td>
                    <td className="py-3 pr-4 text-ink/70">{vr.grnNumber}</td>
                    <td className="py-3 pr-4 text-ink/60">{fmtDate(vr.createdAt)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-ink/70">{vr.items.length}</td>
                    <td className="py-3 pr-4 text-right tabular-nums font-semibold text-ink">{fmt(vr.returnValue, sym)}</td>
                    <td className="py-3 pr-4"><StatusBadge status={vr.status} /></td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setSelectedReturn(vr)}
                          title="View details"
                          className="rounded-lg p-1.5 hover:bg-ink/5 text-ink/40 hover:text-ink"
                        >
                          <Eye size={13} />
                        </button>
                        {vr.status === 'draft' && (
                          <button
                            onClick={() => setApprovingReturn(vr)}
                            title="Approve"
                            className="rounded-lg p-1.5 hover:bg-blue-50 text-blue-400 hover:text-blue-600"
                          >
                            <CheckCircle size={13} />
                          </button>
                        )}
                        {vr.status === 'approved' && (
                          <button
                            onClick={() => setCompletingReturn(vr)}
                            title="Complete return"
                            className="rounded-lg p-1.5 hover:bg-green-50 text-green-500 hover:text-green-700"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )}
                        {(vr.status === 'draft' || vr.status === 'approved') && (
                          <button
                            onClick={() => setCancellingReturn(vr)}
                            title="Cancel"
                            className="rounded-lg p-1.5 hover:bg-red-50 text-red-400 hover:text-red-600"
                          >
                            <XCircle size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-6 py-3">
            <p className="text-sm text-ink/40">
              Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail side panel */}
      {selectedReturn && (
        <div className="w-80 shrink-0 border-l border-border overflow-hidden">
          <DetailPanel vr={selectedReturn} onClose={() => setSelectedReturn(null)} sym={sym} />
        </div>
      )}

      {/* Create drawer (overlay) */}
      {showCreate && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/40" onClick={() => setShowCreate(false)} />
          <div className="w-[520px] shrink-0 bg-canvas border-l border-border shadow-2xl overflow-hidden">
            <CreateDrawer
              onClose={() => setShowCreate(false)}
              onCreated={() => { load(); }}
              sym={sym}
            />
          </div>
        </div>
      )}

      {/* Approve confirm */}
      {approvingReturn && (
        <ConfirmDialog
          title="Approve Return"
          message={`Approve return ${approvingReturn.returnNumber} (${fmt(approvingReturn.returnValue, sym)})?`}
          confirmLabel="Approve"
          confirmClass="bg-blue-600 hover:bg-blue-700"
          onClose={() => setApprovingReturn(null)}
          onConfirm={async () => {
            await approveVendorReturn(approvingReturn._id);
            await load();
            setApprovingReturn(null);
          }}
        />
      )}

      {/* Complete confirm */}
      {completingReturn && (
        <ConfirmDialog
          title="Complete Return"
          message={`Complete return ${completingReturn.returnNumber}? This will decrement inventory and reduce vendor outstanding by ${fmt(completingReturn.returnValue, sym)}.`}
          confirmLabel="Complete"
          confirmClass="bg-green-600 hover:bg-green-700"
          onClose={() => setCompletingReturn(null)}
          onConfirm={async () => {
            await completeVendorReturn(completingReturn._id);
            await load();
            setCompletingReturn(null);
          }}
        />
      )}

      {/* Cancel dialog */}
      {cancellingReturn && (
        <CancelDialog
          vr={cancellingReturn}
          onClose={() => setCancellingReturn(null)}
          onDone={() => { load(); setCancellingReturn(null); }}
        />
      )}
    </div>
  );
}
