import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, X, AlertCircle, Download, RefreshCw, Loader2,
  Package, Check, Ban, FileText, TrendingUp, Eye, ChevronRight,
  AlertTriangle, Truck,
} from 'lucide-react';
import {
  fetchGRNs, createGRN, cancelGRN, fetchGRNReport,
  type GRN, type GRNInput, type GRNItemInput, type GRNReport,
} from '../api/grn';
import { fetchPurchaseOrders, type PurchaseOrder } from '../api/purchaseOrders';
import type { GRNStatus } from '../types';
import { useSettings } from '../context/SettingsContext';

// ── Constants ──────────────────────────────────────────────────────────────────

type Tab = 'receive' | 'list' | 'reports';

const STATUS_META: Record<GRNStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: '#64748b', bg: '#f1f5f9' },
  partial:   { label: 'Partial',   color: '#d97706', bg: '#fef3c7' },
  completed: { label: 'Completed', color: '#059669', bg: '#d1fae5' },
  cancelled: { label: 'Cancelled', color: '#dc2626', bg: '#fee2e2' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const all = [headers, ...rows];
  const csv = all.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: GRNStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: m.color, backgroundColor: m.bg }}>
      {m.label}
    </span>
  );
}

function KPICard({ label, value, sub, warn = false }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${warn ? 'text-amber-500' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

// ── Receive Drawer ────────────────────────────────────────────────────────────

interface ReceiveItem extends GRNItemInput {
  _key: string;
}

function ReceiveDrawer({
  open, onClose, onCreated,
}: {
  open:      boolean;
  onClose:   () => void;
  onCreated: (grn: GRN) => void;
}) {
  const [step, setStep]               = useState<'select-po' | 'enter-items'>('select-po');
  const [pos, setPOs]                 = useState<PurchaseOrder[]>([]);
  const [posLoading, setPOsLoading]   = useState(false);
  const [poSearch, setPOSearch]       = useState('');
  const [selectedPO, setSelectedPO]   = useState<PurchaseOrder | null>(null);
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [notes, setNotes]             = useState('');
  const [items, setItems]             = useState<ReceiveItem[]>([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setStep('select-po'); setSelectedPO(null); setError(null); return; }
    setPOsLoading(true);
    fetchPurchaseOrders({ status: 'approved', limit: 100 }).then(r => {
      setPOs(r.purchaseOrders);
    }).catch(() => {}).finally(() => setPOsLoading(false));
    // also load sent + partially_received
    fetchPurchaseOrders({ status: 'sent', limit: 100 }).then(r =>
      setPOs(prev => {
        const ids = new Set(prev.map(p => p._id));
        return [...prev, ...r.purchaseOrders.filter(p => !ids.has(p._id))];
      }),
    ).catch(() => {});
    fetchPurchaseOrders({ status: 'partially_received', limit: 100 }).then(r =>
      setPOs(prev => {
        const ids = new Set(prev.map(p => p._id));
        return [...prev, ...r.purchaseOrders.filter(p => !ids.has(p._id))];
      }),
    ).catch(() => {});
  }, [open]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saving, onClose]);

  function selectPO(po: PurchaseOrder) {
    setSelectedPO(po);
    setItems(po.items.map((pi, idx) => ({
      _key:          `${idx}`,
      poItemIndex:   idx,
      productId:     pi.productId,
      productName:   pi.productName,
      variantId:     pi.variantId,
      variantName:   pi.variantName,
      orderedQty:    pi.orderedQty,
      receivedQty:   Math.max(0, pi.orderedQty - (pi.receivedQty || 0)),
      damagedQty:    0,
      rejectedQty:   0,
      unit:          pi.unit,
      purchasePrice: pi.unitPrice,
      batchNumber:   '',
      expiryDate:    '',
      warehouse:     '',
      notes:         '',
    })));
    setStep('enter-items');
  }

  function setItemField(key: string, field: keyof ReceiveItem, val: unknown) {
    setItems(prev => prev.map(i => i._key === key ? { ...i, [field]: val } : i));
  }

  async function submit() {
    if (!selectedPO) return;
    if (items.every(i => (Number(i.receivedQty) || 0) === 0)) {
      setError('Enter at least one received quantity');
      return;
    }
    setSaving(true); setError(null);
    try {
      const payload: GRNInput = {
        poId:        selectedPO._id,
        receiveDate: receiveDate || undefined,
        notes,
        items: items.map(i => ({
          poItemIndex:   i.poItemIndex,
          productId:     i.productId,
          productName:   i.productName,
          variantId:     i.variantId,
          variantName:   i.variantName,
          orderedQty:    Number(i.orderedQty) || 0,
          receivedQty:   Number(i.receivedQty) || 0,
          damagedQty:    Number(i.damagedQty) || 0,
          rejectedQty:   Number(i.rejectedQty) || 0,
          unit:          i.unit,
          purchasePrice: Number(i.purchasePrice) || 0,
          batchNumber:   i.batchNumber || undefined,
          expiryDate:    i.expiryDate || undefined,
          warehouse:     i.warehouse || undefined,
          notes:         i.notes || undefined,
        })),
      };
      const grn = await createGRN(payload);
      onCreated(grn);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const filteredPOs = pos.filter(p =>
    !poSearch || p.poNumber.toLowerCase().includes(poSearch.toLowerCase()) ||
    p.vendorSnapshot.businessName.toLowerCase().includes(poSearch.toLowerCase()),
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={() => !saving && onClose()} />
      <div className="flex w-full max-w-2xl flex-col border-l border-border bg-canvas shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">
            {step === 'select-po' ? 'Select Purchase Order' : `Receive Against ${selectedPO?.poNumber}`}
          </h2>
          <div className="flex items-center gap-2">
            {step === 'enter-items' && (
              <button onClick={() => setStep('select-po')} className="text-xs text-ink/40 hover:text-ink">← Back</button>
            )}
            <button onClick={onClose} disabled={saving} className="rounded-lg p-1 text-ink/40 hover:bg-ink/5">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Step 1: Select PO */}
        {step === 'select-po' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="shrink-0 border-b border-border px-5 py-3">
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
                <input type="search" value={poSearch} onChange={e => setPOSearch(e.target.value)}
                  placeholder="Search PO number or vendor…"
                  className="w-full rounded-lg border border-border bg-mist py-2 pl-8 pr-3 text-xs text-ink outline-none focus:border-brand/50" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {posLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="animate-spin text-ink/20" />
                </div>
              ) : filteredPOs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Truck size={36} className="mb-2 text-ink/10" />
                  <p className="text-sm text-ink/40">No receivable POs</p>
                  <p className="mt-1 text-xs text-ink/30">Approve POs first before receiving</p>
                </div>
              ) : (
                filteredPOs.map(po => {
                  const pending = po.items.reduce((s, i) => s + Math.max(0, i.orderedQty - (i.receivedQty || 0)), 0);
                  return (
                    <button key={po._id} onClick={() => selectPO(po)}
                      className="flex w-full items-center gap-3 border-b border-border px-5 py-4 text-left hover:bg-mist">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-brand">{po.poNumber}</span>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
                            style={{ color: po.status === 'partially_received' ? '#d97706' : '#059669', backgroundColor: po.status === 'partially_received' ? '#fef3c7' : '#d1fae5' }}>
                            {po.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm font-medium text-ink">{po.vendorSnapshot.businessName}</p>
                        <p className="mt-0.5 text-xs text-ink/40">{po.items.length} items · {pending.toFixed(2)} units pending</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-ink/40">{fmtDate(po.expectedDeliveryDate)}</p>
                        <ChevronRight size={14} className="ml-auto mt-1 text-ink/20" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Step 2: Enter item quantities */}
        {step === 'enter-items' && selectedPO && (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              {/* Header fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Receive Date</label>
                  <input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)}
                    className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Notes</label>
                  <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="Optional notes…"
                    className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50" />
                </div>
              </div>

              {/* Items */}
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/40">Items to Receive</p>
                <div className="space-y-3">
                  {items.map(item => {
                    const poItem = selectedPO.items[item.poItemIndex ?? 0];
                    const alreadyReceived = poItem ? (poItem.receivedQty || 0) : 0;
                    const stillPending = Math.max(0, (item.orderedQty || 0) - alreadyReceived);
                    return (
                      <div key={item._key} className="rounded-xl border border-border bg-mist p-3">
                        <div className="mb-2 flex items-start justify-between">
                          <div>
                            <p className="text-sm font-semibold text-ink">{item.productName}</p>
                            {item.variantName && <p className="text-xs text-ink/40">{item.variantName}</p>}
                            <p className="mt-0.5 text-xs text-ink/40">
                              Ordered: {item.orderedQty} {item.unit}
                              {alreadyReceived > 0 && <span className="ml-2 text-emerald-600">Already received: {alreadyReceived}</span>}
                              {' · '}Pending: {stillPending.toFixed(2)}
                            </p>
                          </div>
                        </div>

                        {/* Qty row */}
                        <div className="grid grid-cols-4 gap-2">
                          {[
                            { label: 'Received',  field: 'receivedQty'  as const },
                            { label: 'Damaged',   field: 'damagedQty'   as const },
                            { label: 'Rejected',  field: 'rejectedQty'  as const },
                            { label: 'Price',     field: 'purchasePrice' as const },
                          ].map(col => (
                            <div key={col.field}>
                              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink/30">{col.label}</p>
                              <input type="number" min={0} step="any"
                                value={item[col.field] as number}
                                onChange={e => setItemField(item._key, col.field, parseFloat(e.target.value) || 0)}
                                className="w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                            </div>
                          ))}
                        </div>

                        {/* Batch / Expiry / Warehouse row */}
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <div>
                            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink/30">Batch No.</p>
                            <input type="text" value={item.batchNumber || ''} placeholder="Optional"
                              onChange={e => setItemField(item._key, 'batchNumber', e.target.value)}
                              className="w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                          </div>
                          <div>
                            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink/30">Expiry Date</p>
                            <input type="date" value={item.expiryDate || ''}
                              onChange={e => setItemField(item._key, 'expiryDate', e.target.value)}
                              className="w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                          </div>
                          <div>
                            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-ink/30">Warehouse</p>
                            <input type="text" value={item.warehouse || ''} placeholder="e.g. Store A"
                              onChange={e => setItemField(item._key, 'warehouse', e.target.value)}
                              className="w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 gap-2 border-t border-border px-5 py-4">
              <button onClick={onClose} disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm text-ink/50 hover:bg-mist disabled:opacity-40">
                Cancel
              </button>
              <button onClick={() => void submit()} disabled={saving}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40">
                {saving ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                Confirm Receipt
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── GRN Detail Panel ──────────────────────────────────────────────────────────

function GRNDetail({ grn, onClose, onChange }: { grn: GRN; onClose: () => void; onChange: (g: GRN) => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason]         = useState('');

  async function doCancel() {
    setCancelling(true);
    try {
      const updated = await cancelGRN(grn._id, reason);
      onChange(updated);
      setShowCancel(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }

  function printGRN() {
    window.print();
  }

  function exportCSV() {
    downloadCSV(`${grn.grnNumber}.csv`,
      ['Product', 'Variant', 'Ordered', 'Received', 'Damaged', 'Rejected', 'Pending', 'Unit', 'Price', 'Batch', 'Expiry', 'Warehouse'],
      grn.items.map(i => [
        i.productName, i.variantName ?? '', i.orderedQty, i.receivedQty,
        i.damagedQty, i.rejectedQty, i.pendingQty, i.unit, i.purchasePrice,
        i.batchNumber ?? '', i.expiryDate ? fmtDate(i.expiryDate) : '', i.warehouse ?? '',
      ]),
    );
  }

  const totalReceived  = grn.items.reduce((s, i) => s + i.receivedQty, 0);
  const totalDamaged   = grn.items.reduce((s, i) => s + i.damagedQty, 0);
  const totalRejected  = grn.items.reduce((s, i) => s + i.rejectedQty, 0);
  const totalAccepted  = Math.max(0, totalReceived - totalDamaged - totalRejected);

  return (
    <div className="flex w-full max-w-sm flex-col border-l border-border bg-canvas shadow-xl">
      <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{grn.grnNumber}</p>
          <h2 className="mt-0.5 truncate text-sm font-semibold text-ink">{grn.vendorSnapshot.businessName}</h2>
          <p className="mt-0.5 text-xs text-ink/40">Against {grn.poNumber}</p>
          <div className="mt-1"><StatusBadge status={grn.status} /></div>
        </div>
        <button onClick={onClose} className="ml-2 shrink-0 rounded-lg p-1 text-ink/40 hover:bg-ink/5">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-mist p-3">
            <p className="text-[10px] text-ink/40">Received</p>
            <p className="mt-0.5 text-lg font-bold text-ink">{totalReceived.toFixed(2)}</p>
          </div>
          <div className="rounded-xl border border-border bg-mist p-3">
            <p className="text-[10px] text-ink/40">Accepted</p>
            <p className="mt-0.5 text-lg font-bold text-emerald-600">{totalAccepted.toFixed(2)}</p>
          </div>
          {totalDamaged > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[10px] text-amber-600">Damaged</p>
              <p className="mt-0.5 text-lg font-bold text-amber-700">{totalDamaged.toFixed(2)}</p>
            </div>
          )}
          {totalRejected > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-[10px] text-red-600">Rejected</p>
              <p className="mt-0.5 text-lg font-bold text-red-700">{totalRejected.toFixed(2)}</p>
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-ink/40">Receive Date</span>
            <span className="text-ink">{fmtDate(grn.receiveDate)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink/40">Items</span>
            <span className="text-ink">{grn.items.length}</span>
          </div>
          {grn.receivedBy && (
            <div className="flex justify-between">
              <span className="text-ink/40">Received By</span>
              <span className="text-ink">{grn.receivedBy}</span>
            </div>
          )}
        </div>

        {/* Items */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/30">Items</p>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-mist">
                  <th className="px-3 py-1.5 text-left font-semibold text-ink/40">Product</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-ink/40">Rcv</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-ink/40">Dmg</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-ink/40">Rej</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {grn.items.map((item, i) => (
                  <tr key={i} className="hover:bg-mist/50">
                    <td className="px-3 py-2">
                      <p className="font-medium text-ink leading-tight">{item.productName}</p>
                      {item.variantName && <p className="text-ink/40">{item.variantName}</p>}
                      {item.batchNumber && <p className="text-ink/30">Batch: {item.batchNumber}</p>}
                      {item.expiryDate  && (
                        <p className={`text-[10px] ${new Date(item.expiryDate) < new Date() ? 'text-red-500' : 'text-ink/30'}`}>
                          Exp: {fmtDate(item.expiryDate)}
                        </p>
                      )}
                      {item.warehouse   && <p className="text-[10px] text-ink/30">{item.warehouse}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-semibold">
                      {item.receivedQty}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-600">
                      {item.damagedQty > 0 ? item.damagedQty : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600">
                      {item.rejectedQty > 0 ? item.rejectedQty : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Notes */}
        {grn.notes && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/30">Notes</p>
            <p className="text-xs text-ink/60">{grn.notes}</p>
          </div>
        )}

        {/* Cancel */}
        {grn.cancelReason && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-[10px] font-semibold text-red-600">Cancellation Reason</p>
            <p className="mt-0.5 text-xs text-red-700">{grn.cancelReason}</p>
          </div>
        )}

        {showCancel && (
          <div className="space-y-2">
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Reason for cancellation…" rows={2}
              className="w-full resize-none rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 outline-none focus:border-red-400" />
            <div className="flex gap-2">
              <button onClick={() => setShowCancel(false)}
                className="flex-1 rounded-lg border border-border py-1.5 text-xs text-ink/50 hover:bg-mist">
                Back
              </button>
              <button onClick={() => void doCancel()} disabled={cancelling}
                className="flex-1 rounded-lg bg-red-500 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-40">
                Confirm Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {!showCancel && (
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-5 py-4">
          <button onClick={exportCSV}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-mist">
            <Download size={11} /> CSV
          </button>
          <button onClick={printGRN}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-mist">
            <FileText size={11} /> Print
          </button>
          {grn.status !== 'cancelled' && grn.status !== 'completed' && (
            <button onClick={() => setShowCancel(true)} disabled={cancelling}
              className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-30">
              <Ban size={11} /> Cancel GRN
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function GRNPage() {
  useSettings();

  const [tab, setTab]             = useState<Tab>('receive');
  const [grns, setGRNs]           = useState<GRN[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [debouncedSearch, setDebSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate]   = useState('');
  const [toDate, setToDate]       = useState('');
  const [detailGRN, setDetailGRN] = useState<GRN | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [report, setReport]       = useState<GRNReport | null>(null);
  const [rptLoading, setRptLoad]  = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (tab === 'reports') return;
    setLoading(true); setError(null);
    try {
      const params: Parameters<typeof fetchGRNs>[0] = { limit: 100 };
      if (debouncedSearch) params.search   = debouncedSearch;
      if (statusFilter)    params.status   = statusFilter;
      if (fromDate)        params.from     = fromDate;
      if (toDate)          params.to       = toDate;
      const { grns: g, total: t } = await fetchGRNs(params);
      setGRNs(g); setTotal(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab, debouncedSearch, statusFilter, fromDate, toDate]);

  useEffect(() => { if (tab !== 'reports') void load(); }, [tab, load]);

  const loadReport = useCallback(async () => {
    setRptLoad(true);
    try {
      setReport(await fetchGRNReport({ from: fromDate || undefined, to: toDate || undefined }));
    } catch { setReport(null); }
    finally { setRptLoad(false); }
  }, [fromDate, toDate]);

  useEffect(() => { if (tab === 'reports') void loadReport(); }, [tab, loadReport]);

  function onCreated(grn: GRN) {
    setGRNs(prev => [grn, ...prev]);
    setTotal(t => t + 1);
    setDrawerOpen(false);
    setDetailGRN(grn);
    setTab('list');
  }

  function onChanged(grn: GRN) {
    setGRNs(prev => prev.map(g => g._id === grn._id ? grn : g));
    setDetailGRN(grn);
  }

  function handleExportCSV() {
    downloadCSV('grns.csv',
      ['GRN#', 'PO#', 'Vendor', 'Receive Date', 'Status', 'Items', 'Total Received', 'Damaged', 'Rejected'],
      grns.map(g => [
        g.grnNumber, g.poNumber, g.vendorSnapshot.businessName,
        fmtDate(g.receiveDate), g.status, g.items.length,
        g.items.reduce((s, i) => s + i.receivedQty, 0),
        g.items.reduce((s, i) => s + i.damagedQty, 0),
        g.items.reduce((s, i) => s + i.rejectedQty, 0),
      ]),
    );
  }

  const maxVendor = Math.max(...(report?.byVendor.map(v => v.grnCount) ?? [1]), 1);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="shrink-0 border-b border-border bg-canvas">
        <div className="flex items-center border-b border-border px-5">
          {([
            { id: 'receive' as Tab, label: 'Receive Goods', icon: Truck },
            { id: 'list'    as Tab, label: 'GRN History',   icon: Package },
            { id: 'reports' as Tab, label: 'Reports',        icon: TrendingUp },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                tab === t.id ? 'border-brand text-brand' : 'border-transparent text-ink/40 hover:text-ink'
              }`}>
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 py-2">
            {tab !== 'reports' && (
              <button onClick={handleExportCSV}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5">
                <Download size={11} /> CSV
              </button>
            )}
            {tab === 'receive' && (
              <button onClick={() => setDrawerOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
                <Plus size={11} /> New GRN
              </button>
            )}
          </div>
        </div>

        {/* Filters (list tab) */}
        {tab === 'list' && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-2">
            <div className="relative flex-1 min-w-40 max-w-xs">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search GRNs…"
                className="w-full rounded-lg border border-border bg-mist py-1.5 pl-8 pr-3 text-xs text-ink outline-none focus:border-brand/50" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none">
              <option value="">All Status</option>
              <option value="partial">Partial</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none" />
            <span className="text-xs text-ink/30">to</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none" />
            {loading && <Loader2 size={12} className="animate-spin text-ink/30" />}
            <span className="ml-auto text-xs text-ink/30">{total} GRN{total !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto bg-mist">

          {/* ══ RECEIVE TAB ══ */}
          {tab === 'receive' && (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-5 py-10 text-center">
              <div className="rounded-full bg-brand/10 p-6">
                <Truck size={40} className="text-brand" />
              </div>
              <h2 className="text-lg font-semibold text-ink">Receive Goods from Vendor</h2>
              <p className="max-w-sm text-sm text-ink/50">
                Select an approved Purchase Order to create a GRN, capture received quantities,
                flag damaged or rejected items, and update inventory automatically.
              </p>
              <button onClick={() => setDrawerOpen(true)}
                className="flex items-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand/90">
                <Plus size={16} /> Start Receiving
              </button>
            </div>
          )}

          {/* ══ LIST TAB ══ */}
          {tab === 'list' && (
            <div className="p-5 space-y-4">
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
                  <AlertCircle size={14} className="shrink-0" />{error}
                </div>
              )}
              {loading && grns.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 size={24} className="animate-spin text-ink/20" />
                </div>
              ) : grns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Package size={40} className="mb-3 text-ink/10" />
                  <p className="text-sm text-ink/40">No GRNs found</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-canvas overflow-hidden">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-mist">
                        {['GRN #', 'PO #', 'Vendor', 'Receive Date', 'Items', 'Received', 'Damaged', 'Status', ''].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {grns.map(grn => {
                        const rcv = grn.items.reduce((s, i) => s + i.receivedQty, 0);
                        const dmg = grn.items.reduce((s, i) => s + i.damagedQty, 0);
                        return (
                          <tr key={grn._id}
                            className={`cursor-pointer hover:bg-mist ${detailGRN?._id === grn._id ? 'bg-brand/5' : ''}`}
                            onClick={() => setDetailGRN(p => p?._id === grn._id ? null : grn)}
                          >
                            <td className="px-4 py-3 font-mono text-xs font-semibold text-brand">{grn.grnNumber}</td>
                            <td className="px-4 py-3 font-mono text-xs text-ink/60">{grn.poNumber}</td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-ink">{grn.vendorSnapshot.businessName}</p>
                            </td>
                            <td className="px-4 py-3 text-xs text-ink/60">{fmtDate(grn.receiveDate)}</td>
                            <td className="px-4 py-3 text-center text-sm text-ink/60">{grn.items.length}</td>
                            <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-emerald-700">{rcv.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-sm tabular-nums text-amber-600">
                              {dmg > 0 ? <><AlertTriangle size={11} className="inline mr-1" />{dmg.toFixed(2)}</> : '—'}
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={grn.status} /></td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end" onClick={e => e.stopPropagation()}>
                                <button onClick={() => setDetailGRN(p => p?._id === grn._id ? null : grn)}
                                  className="rounded-lg p-1.5 text-ink/30 hover:bg-ink/5 hover:text-ink">
                                  <Eye size={13} />
                                </button>
                              </div>
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

          {/* ══ REPORTS TAB ══ */}
          {tab === 'reports' && (
            <div className="p-5 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                  className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink outline-none" />
                <span className="text-xs text-ink/30">to</span>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                  className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink outline-none" />
                <button onClick={() => void loadReport()}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5">
                  <RefreshCw size={11} /> Refresh
                </button>
              </div>

              {rptLoading ? (
                <div className="flex justify-center py-20">
                  <Loader2 size={24} className="animate-spin text-ink/20" />
                </div>
              ) : report ? (
                <>
                  {/* KPIs */}
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <KPICard label="Total GRNs"      value={String(report.totalGRNs)}   sub={`${report.completedCount} completed`} />
                    <KPICard label="Pending POs"     value={String(report.pendingPOs)}  sub="Awaiting receipt" warn={report.pendingPOs > 0} />
                    <KPICard label="Total Received"  value={report.totalReceived.toFixed(2)} sub="Accepted units" />
                    <KPICard label="Damaged / Rejected" value={(report.totalDamaged + report.totalRejected).toFixed(2)} sub={`${report.totalDamaged.toFixed(2)} dmg · ${report.totalRejected.toFixed(2)} rej`} warn={(report.totalDamaged + report.totalRejected) > 0} />
                  </div>

                  {/* Status breakdown */}
                  <div className="rounded-xl border border-border bg-canvas p-5">
                    <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">Status Breakdown</h3>
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'Partial',   count: report.partialCount },
                        { label: 'Completed', count: report.completedCount },
                        { label: 'Cancelled', count: report.cancelledCount },
                        { label: 'Pending',   count: report.pendingCount },
                      ].map(s => (
                        <div key={s.label} className="rounded-lg border border-border bg-mist p-3 text-center">
                          <p className="text-xl font-bold text-ink">{s.count}</p>
                          <p className="text-[10px] text-ink/40">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Vendor performance */}
                  {report.byVendor.length > 0 && (
                    <div className="rounded-xl border border-border bg-canvas p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Vendor Delivery Performance</h3>
                        <button onClick={() => downloadCSV('vendor-grn.csv',
                          ['Vendor', 'GRN Count', 'Total Received', 'Total Damaged'],
                          report.byVendor.map(v => [v.businessName, v.grnCount, v.totalReceived, v.totalDamaged]))}
                          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-ink/50 hover:bg-ink/5">
                          <Download size={11} /> CSV
                        </button>
                      </div>
                      <div className="space-y-3">
                        {report.byVendor.map(v => (
                          <div key={v._id} className="flex items-center gap-3">
                            <span className="w-36 shrink-0 truncate text-right text-xs text-ink/50">{v.businessName}</span>
                            <div className="flex-1 space-y-0.5">
                              <div className="h-2 overflow-hidden rounded-full bg-ink/5">
                                <div className="h-2 rounded-full bg-brand"
                                  style={{ width: `${(v.grnCount / maxVendor) * 100}%` }} />
                              </div>
                              {v.totalDamaged > 0 && (
                                <div className="h-1 overflow-hidden rounded-full bg-ink/5">
                                  <div className="h-1 rounded-full bg-amber-400"
                                    style={{ width: `${Math.min(100, (v.totalDamaged / Math.max(v.totalReceived, 1)) * 100)}%` }} />
                                </div>
                              )}
                            </div>
                            <div className="w-20 shrink-0 text-right">
                              <p className="text-xs font-semibold text-ink tabular-nums">{v.grnCount} GRNs</p>
                              {v.totalDamaged > 0 && (
                                <p className="text-[10px] text-amber-600">{v.totalDamaged.toFixed(1)} dmg</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Monthly trend */}
                  {report.byMonth.length > 0 && (
                    <div className="rounded-xl border border-border bg-canvas p-5">
                      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">Monthly Goods Received</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="bg-mist">
                              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink/40">Month</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink/40">GRNs</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink/40">Units Received</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {report.byMonth.map(m => (
                              <tr key={m._id} className="hover:bg-mist">
                                <td className="px-4 py-2 text-xs text-ink">{m._id}</td>
                                <td className="px-4 py-2 text-right text-xs text-ink/70">{m.grnCount}</td>
                                <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-ink">{m.totalReceived.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {detailGRN && tab === 'list' && (
          <GRNDetail grn={detailGRN} onClose={() => setDetailGRN(null)} onChange={onChanged} />
        )}
      </div>

      {/* Drawer */}
      <ReceiveDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onCreated={onCreated} />
    </div>
  );
}
