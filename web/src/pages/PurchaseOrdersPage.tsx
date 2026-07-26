import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Plus, X, AlertCircle, Download, RefreshCw, Loader2,
  ShoppingBag, Check, Truck, Ban, Copy, ChevronRight, Clock,
  FileText, TrendingUp, Eye, Send, Trash2,
} from 'lucide-react';
import {
  fetchPurchaseOrders, createPurchaseOrder, updatePurchaseOrder,
  deletePurchaseOrder, submitPurchaseOrder, approvePurchaseOrder,
  sendPurchaseOrder, cancelPurchaseOrder, duplicatePurchaseOrder,
  fetchPOReport,
  type PurchaseOrder, type POInput, type POReport,
} from '../api/purchaseOrders';
import { fetchVendors, type Vendor } from '../api/vendors';
import { fetchProducts } from '../api/products';
import type { Product, POItem, POStatus } from '../types';
import { useSettings } from '../context/SettingsContext';

// ── Constants ─────────────────────────────────────────────────────────────────

type Tab = 'all' | 'draft' | 'pending_approval' | 'approved' | 'sent' | 'received' | 'cancelled' | 'reports';

const STATUS_META: Record<POStatus, { label: string; color: string; bg: string }> = {
  draft:              { label: 'Draft',             color: '#64748b', bg: '#f1f5f9' },
  pending_approval:   { label: 'Pending',           color: '#d97706', bg: '#fef3c7' },
  approved:           { label: 'Approved',          color: '#059669', bg: '#d1fae5' },
  sent:               { label: 'Sent',              color: '#0284c7', bg: '#e0f2fe' },
  partially_received: { label: 'Part. Received',   color: '#7c3aed', bg: '#ede9fe' },
  received:           { label: 'Received',          color: '#16a34a', bg: '#dcfce7' },
  cancelled:          { label: 'Cancelled',         color: '#dc2626', bg: '#fee2e2' },
};

const TABS: Array<{ id: Tab; label: string; statusFilter?: POStatus }> = [
  { id: 'all',              label: 'All' },
  { id: 'draft',            label: 'Draft',     statusFilter: 'draft' },
  { id: 'pending_approval', label: 'Pending',   statusFilter: 'pending_approval' },
  { id: 'approved',         label: 'Approved',  statusFilter: 'approved' },
  { id: 'sent',             label: 'Sent',      statusFilter: 'sent' },
  { id: 'received',         label: 'Received',  statusFilter: 'received' },
  { id: 'cancelled',        label: 'Cancelled', statusFilter: 'cancelled' },
  { id: 'reports',          label: 'Reports' },
];

const BLANK_ITEM: Omit<POItem, '_id' | 'lineTotal'> = {
  productId:   undefined,
  productName: '',
  variantId:   '',
  variantName: '',
  orderedQty:  1,
  receivedQty: 0,
  unit:        'pcs',
  unitPrice:   0,
  discount:    0,
  taxPercent:  0,
  notes:       '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCur(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function computeItemTotal(item: Omit<POItem, '_id' | 'lineTotal'>): number {
  const base     = (item.unitPrice || 0) * (item.orderedQty || 0);
  const net      = Math.max(0, base - (item.discount || 0));
  const taxAmt   = net * (item.taxPercent || 0) / 100;
  return Math.round((net + taxAmt) * 100) / 100;
}

function computeTotals(items: Omit<POItem, '_id' | 'lineTotal'>[], discount: number, tax: number, shipping: number) {
  let subtotal = 0, taxTotal = 0;
  for (const item of items) {
    const base  = (item.unitPrice || 0) * (item.orderedQty || 0);
    const net   = Math.max(0, base - (item.discount || 0));
    subtotal += net;
    taxTotal += net * (item.taxPercent || 0) / 100;
  }
  subtotal = Math.round(subtotal * 100) / 100;
  taxTotal = Math.round(taxTotal * 100) / 100;
  const total = Math.max(0, Math.round((subtotal + taxTotal - (discount || 0) + (tax || 0) + (shipping || 0)) * 100) / 100);
  return { subtotal, taxTotal, total };
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const all = [headers, ...rows];
  const csv = all.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: POStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ color: m.color, backgroundColor: m.bg }}
    >
      {m.label}
    </span>
  );
}

function KPICard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-brand' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

// ── Product Search Combobox (per item row) ────────────────────────────────────

function ProductComboBox({
  value, onChange, onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (p: Product) => void;
}) {
  const [results, setResults]     = useState<Product[]>([]);
  const [open, setOpen]           = useState(false);
  const [fetching, setFetching]   = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    setFetching(true);
    try {
      const ps = await fetchProducts({ search: q });
      setResults(ps.slice(0, 8));
    } catch {
      setResults([]);
    } finally {
      setFetching(false);
    }
  }, []);

  function handleChange(v: string) {
    onChange(v);
    setOpen(true);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(v), 300);
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => value.length >= 2 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Product name…"
        className="w-full rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
      />
      {open && (results.length > 0 || fetching) && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-56 rounded-lg border border-border bg-canvas shadow-lg">
          {fetching ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink/40">
              <Loader2 size={11} className="animate-spin" /> Searching…
            </div>
          ) : (
            results.map(p => (
              <button
                key={p._id}
                type="button"
                onMouseDown={() => { onSelect(p); setOpen(false); setResults([]); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-mist"
              >
                <span className="flex-1 truncate font-medium text-ink">{p.name}</span>
                <span className="shrink-0 text-ink/40">₹{p.price}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── PO Form Drawer ────────────────────────────────────────────────────────────

type FormItem = Omit<POItem, '_id' | 'lineTotal'>;

interface POFormState {
  vendorId:             string;
  orderDate:            string;
  expectedDeliveryDate: string;
  currency:             string;
  notes:                string;
  items:                FormItem[];
  discount:             number;
  tax:                  number;
  shipping:             number;
}

function PODrawer({
  open, editing, onClose, onSaved, sym,
}: {
  open:    boolean;
  editing: PurchaseOrder | null;
  onClose: () => void;
  onSaved: (po: PurchaseOrder) => void;
  sym:     string;
}) {
  const [vendors, setVendors]   = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorOpen, setVendorOpen]     = useState(false);

  const blankForm = useCallback((): POFormState => ({
    vendorId:             '',
    orderDate:            todayISO(),
    expectedDeliveryDate: '',
    currency:             'INR',
    notes:                '',
    items:                [{ ...BLANK_ITEM }],
    discount:             0,
    tax:                  0,
    shipping:             0,
  }), []);

  const [form, setForm]       = useState<POFormState>(blankForm);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

  // Load vendors for dropdown
  useEffect(() => {
    if (!open) return;
    fetchVendors({ limit: 200 }).then(r => setVendors(r.vendors)).catch(() => {});
  }, [open]);

  // Populate form when editing
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        vendorId:             editing.vendorId,
        orderDate:            editing.orderDate?.slice(0, 10) ?? todayISO(),
        expectedDeliveryDate: editing.expectedDeliveryDate?.slice(0, 10) ?? '',
        currency:             editing.currency || 'INR',
        notes:                editing.notes,
        items:                editing.items.map(i => ({
          productId:   i.productId,
          productName: i.productName,
          variantId:   i.variantId ?? '',
          variantName: i.variantName ?? '',
          orderedQty:  i.orderedQty,
          receivedQty: i.receivedQty,
          unit:        i.unit,
          unitPrice:   i.unitPrice,
          discount:    i.discount,
          taxPercent:  i.taxPercent,
          notes:       i.notes ?? '',
        })),
        discount: editing.discount,
        tax:      editing.tax,
        shipping: editing.shipping,
      });
      setSelectedVendor({ _id: editing.vendorId, ...editing.vendorSnapshot } as any);
      setVendorSearch(editing.vendorSnapshot.businessName);
    } else {
      setForm(blankForm());
      setSelectedVendor(null);
      setVendorSearch('');
    }
    setError(null);
  }, [open, editing, blankForm]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saving, onClose]);

  const filteredVendors = vendors.filter(v =>
    v.businessName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    v.vendorCode.toLowerCase().includes(vendorSearch.toLowerCase()),
  );

  function setItemField(idx: number, key: keyof FormItem, val: unknown) {
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, items };
    });
  }

  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, { ...BLANK_ITEM }] }));
  }

  function removeItem(idx: number) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  function onProductSelect(idx: number, p: Product) {
    setItemField(idx, 'productId', p._id);
    setItemField(idx, 'productName', p.name);
    setItemField(idx, 'unitPrice', p.price);
    setItemField(idx, 'taxPercent', (p as any).taxPercent ?? 0);
  }

  async function save(status: 'draft' | 'pending_approval') {
    if (!form.vendorId) { setError('Please select a vendor'); return; }
    if (form.items.length === 0) { setError('Add at least one item'); return; }
    if (form.items.some(i => !i.productName.trim())) { setError('All items must have a product name'); return; }

    setSaving(true); setError(null);
    try {
      const payload: POInput = {
        vendorId:             form.vendorId,
        status,
        orderDate:            form.orderDate || undefined,
        expectedDeliveryDate: form.expectedDeliveryDate || undefined,
        currency:             form.currency,
        notes:                form.notes,
        items:                form.items,
        discount:             form.discount,
        tax:                  form.tax,
        shipping:             form.shipping,
      };
      const po = editing
        ? await updatePurchaseOrder(editing._id, payload)
        : await createPurchaseOrder(payload);
      onSaved(po);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const { subtotal, taxTotal, total } = computeTotals(form.items, form.discount, form.tax, form.shipping);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={() => !saving && onClose()} />
      <div className="flex w-full max-w-2xl flex-col border-l border-border bg-canvas shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">
            {editing ? `Edit ${editing.poNumber}` : 'New Purchase Order'}
          </h2>
          <button onClick={onClose} disabled={saving} className="rounded-lg p-1 text-ink/40 hover:bg-ink/5 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          {/* Vendor */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Vendor *</label>
            <div className="relative">
              <input
                type="text"
                value={vendorSearch}
                onChange={e => { setVendorSearch(e.target.value); setVendorOpen(true); if (!e.target.value) { setForm(f => ({ ...f, vendorId: '' })); setSelectedVendor(null); } }}
                onFocus={() => setVendorOpen(true)}
                onBlur={() => setTimeout(() => setVendorOpen(false), 150)}
                placeholder="Search vendor…"
                className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
              />
              {selectedVendor && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink/40">{selectedVendor.vendorCode}</span>
              )}
              {vendorOpen && filteredVendors.length > 0 && (
                <div className="absolute left-0 top-full z-50 mt-0.5 w-full rounded-lg border border-border bg-canvas shadow-lg max-h-48 overflow-y-auto">
                  {filteredVendors.map(v => (
                    <button
                      key={v._id}
                      type="button"
                      onMouseDown={() => {
                        setSelectedVendor(v);
                        setVendorSearch(v.businessName);
                        setForm(f => ({ ...f, vendorId: v._id }));
                        setVendorOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-mist"
                    >
                      <span className="flex-1 truncate font-medium text-ink">{v.businessName}</span>
                      <span className="shrink-0 text-xs text-ink/40">{v.vendorCode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Dates + currency */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Order Date</label>
              <input type="date" value={form.orderDate} onChange={e => setForm(f => ({ ...f, orderDate: e.target.value }))}
                className="w-full rounded-lg border border-border bg-mist px-2.5 py-2 text-sm text-ink outline-none focus:border-brand/50" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Expected Delivery</label>
              <input type="date" value={form.expectedDeliveryDate} onChange={e => setForm(f => ({ ...f, expectedDeliveryDate: e.target.value }))}
                className="w-full rounded-lg border border-border bg-mist px-2.5 py-2 text-sm text-ink outline-none focus:border-brand/50" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Currency</label>
              <input type="text" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="w-full rounded-lg border border-border bg-mist px-2.5 py-2 text-sm text-ink outline-none focus:border-brand/50" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink/40">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full resize-none rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
              placeholder="Notes to vendor…" />
          </div>

          {/* Items */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Items</p>
              <button onClick={addItem}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink">
                <Plus size={11} /> Add Item
              </button>
            </div>
            <div className="rounded-xl border border-border overflow-hidden">
              {/* Column headers */}
              <div className="grid bg-mist px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-ink/40"
                style={{ gridTemplateColumns: '3fr 1fr 1.5fr 1.5fr 1fr 1fr 1.5fr auto' }}>
                <span>Product</span>
                <span>Unit</span>
                <span>Qty</span>
                <span>Price</span>
                <span>Disc</span>
                <span>Tax%</span>
                <span className="text-right">Total</span>
                <span />
              </div>
              <div className="divide-y divide-border">
                {form.items.map((item, idx) => {
                  const lineTotal = computeItemTotal(item);
                  return (
                    <div key={idx} className="grid items-center gap-1 px-2 py-2"
                      style={{ gridTemplateColumns: '3fr 1fr 1.5fr 1.5fr 1fr 1fr 1.5fr auto' }}>
                      <ProductComboBox
                        value={item.productName}
                        onChange={v => setItemField(idx, 'productName', v)}
                        onSelect={p => onProductSelect(idx, p)}
                      />
                      <input type="text" value={item.unit} onChange={e => setItemField(idx, 'unit', e.target.value)}
                        className="w-full rounded-md border border-border bg-mist px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                      <input type="number" value={item.orderedQty} min={0.001} step="any"
                        onChange={e => setItemField(idx, 'orderedQty', parseFloat(e.target.value) || 0)}
                        className="w-full rounded-md border border-border bg-mist px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                      <input type="number" value={item.unitPrice} min={0} step="any"
                        onChange={e => setItemField(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-full rounded-md border border-border bg-mist px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                      <input type="number" value={item.discount} min={0} step="any"
                        onChange={e => setItemField(idx, 'discount', parseFloat(e.target.value) || 0)}
                        className="w-full rounded-md border border-border bg-mist px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                      <input type="number" value={item.taxPercent} min={0} max={100} step="any"
                        onChange={e => setItemField(idx, 'taxPercent', parseFloat(e.target.value) || 0)}
                        className="w-full rounded-md border border-border bg-mist px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/50" />
                      <p className="text-right text-xs font-semibold tabular-nums text-ink">
                        {fmtCur(lineTotal, sym)}
                      </p>
                      <button onClick={() => removeItem(idx)} disabled={form.items.length === 1}
                        className="rounded p-0.5 text-ink/20 hover:text-red-500 disabled:opacity-20">
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-xl border border-border bg-mist p-4 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">Order Summary</p>
            <div className="flex justify-between text-xs text-ink/60">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium">{fmtCur(subtotal, sym)}</span>
            </div>
            <div className="flex justify-between text-xs text-ink/60">
              <span>Tax Total</span>
              <span className="tabular-nums font-medium">{fmtCur(taxTotal, sym)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-ink/60">
              <span>PO Discount</span>
              <input type="number" value={form.discount} min={0} step="any"
                onChange={e => setForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))}
                className="w-24 rounded-md border border-border bg-canvas px-2 py-0.5 text-right text-xs text-ink outline-none" />
            </div>
            <div className="flex items-center justify-between text-xs text-ink/60">
              <span>Additional Tax</span>
              <input type="number" value={form.tax} min={0} step="any"
                onChange={e => setForm(f => ({ ...f, tax: parseFloat(e.target.value) || 0 }))}
                className="w-24 rounded-md border border-border bg-canvas px-2 py-0.5 text-right text-xs text-ink outline-none" />
            </div>
            <div className="flex items-center justify-between text-xs text-ink/60">
              <span>Shipping</span>
              <input type="number" value={form.shipping} min={0} step="any"
                onChange={e => setForm(f => ({ ...f, shipping: parseFloat(e.target.value) || 0 }))}
                className="w-24 rounded-md border border-border bg-canvas px-2 py-0.5 text-right text-xs text-ink outline-none" />
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-ink">
              <span>Total</span>
              <span className="tabular-nums">{fmtCur(total, sym)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-sm text-ink/50 hover:bg-mist disabled:opacity-40">
            Cancel
          </button>
          <button onClick={() => void save('draft')} disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-ink/60 hover:bg-mist disabled:opacity-40">
            {saving ? <RefreshCw size={12} className="animate-spin" /> : <FileText size={12} />}
            Save Draft
          </button>
          <button onClick={() => void save('pending_approval')} disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40">
            {saving ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
            Submit for Approval
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PO Detail Panel ───────────────────────────────────────────────────────────

function PODetail({
  po, sym, onEdit, onClose, onAction,
}: {
  po:       PurchaseOrder;
  sym:      string;
  onEdit:   () => void;
  onClose:  () => void;
  onAction: (po: PurchaseOrder) => void;
}) {
  const [acting, setActing]           = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel]   = useState(false);

  async function doAction(fn: () => Promise<PurchaseOrder>) {
    setActing(true);
    try { onAction(await fn()); } catch (e) { alert(e instanceof Error ? e.message : 'Action failed'); }
    finally { setActing(false); }
  }

  const canEdit     = po.status === 'draft' || po.status === 'pending_approval';
  const canSubmit   = po.status === 'draft';
  const canApprove  = po.status === 'draft' || po.status === 'pending_approval';
  const canSend     = po.status === 'approved';
  const canCancel   = ['draft', 'pending_approval', 'approved', 'sent'].includes(po.status);
  const canDuplicate = true;

  return (
    <div className="flex w-full max-w-sm flex-col border-l border-border bg-canvas shadow-xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{po.poNumber}</p>
          <h2 className="mt-0.5 truncate text-sm font-semibold text-ink">{po.vendorSnapshot.businessName}</h2>
          <div className="mt-1"><StatusBadge status={po.status} /></div>
        </div>
        <button onClick={onClose} className="ml-2 shrink-0 rounded-lg p-1 text-ink/40 hover:bg-ink/5">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Financials */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-mist p-3">
            <p className="text-[10px] text-ink/40">Total</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-ink">{fmtCur(po.total, sym)}</p>
          </div>
          <div className="rounded-xl border border-border bg-mist p-3">
            <p className="text-[10px] text-ink/40">Items</p>
            <p className="mt-0.5 text-lg font-bold text-ink">{po.items.length}</p>
          </div>
        </div>

        {/* Meta */}
        <div className="space-y-1.5 text-xs text-ink/60">
          <div className="flex justify-between">
            <span className="text-ink/40">Order Date</span>
            <span>{fmtDate(po.orderDate)}</span>
          </div>
          {po.expectedDeliveryDate && (
            <div className="flex justify-between">
              <span className="text-ink/40">Expected</span>
              <span>{fmtDate(po.expectedDeliveryDate)}</span>
            </div>
          )}
          {po.approvedAt && (
            <div className="flex justify-between">
              <span className="text-ink/40">Approved</span>
              <span>{fmtDate(po.approvedAt)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-ink/40">Subtotal</span>
            <span className="tabular-nums">{fmtCur(po.subtotal, sym)}</span>
          </div>
          {po.taxTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-ink/40">Tax</span>
              <span className="tabular-nums">{fmtCur(po.taxTotal, sym)}</span>
            </div>
          )}
          {po.discount > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Discount</span>
              <span className="tabular-nums">-{fmtCur(po.discount, sym)}</span>
            </div>
          )}
          {po.shipping > 0 && (
            <div className="flex justify-between">
              <span className="text-ink/40">Shipping</span>
              <span className="tabular-nums">{fmtCur(po.shipping, sym)}</span>
            </div>
          )}
        </div>

        {/* Items table */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/30">Items</p>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-mist">
                  <th className="px-3 py-1.5 text-left font-semibold text-ink/40">Product</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-ink/40">Qty</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-ink/40">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {po.items.map((item, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-ink">{item.productName}</p>
                      {item.variantName && <p className="text-ink/40">{item.variantName}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink/70">
                      {item.orderedQty} {item.unit}
                      {item.receivedQty > 0 && (
                        <p className="text-emerald-600">✓ {item.receivedQty}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">
                      {fmtCur(item.lineTotal, sym)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Notes */}
        {po.notes && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/30">Notes</p>
            <p className="text-xs text-ink/60">{po.notes}</p>
          </div>
        )}

        {/* Cancel reason */}
        {po.cancelReason && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-[10px] font-semibold text-red-600">Cancellation Reason</p>
            <p className="mt-0.5 text-xs text-red-700">{po.cancelReason}</p>
          </div>
        )}

        {/* Cancel form */}
        {showCancel && (
          <div className="space-y-2">
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation…"
              rows={2}
              className="w-full resize-none rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 outline-none focus:border-red-400"
            />
            <div className="flex gap-2">
              <button onClick={() => setShowCancel(false)}
                className="flex-1 rounded-lg border border-border py-1.5 text-xs text-ink/50 hover:bg-mist">
                Back
              </button>
              <button
                onClick={() => void doAction(() => cancelPurchaseOrder(po._id, cancelReason)).then(() => setShowCancel(false))}
                disabled={acting}
                className="flex-1 rounded-lg bg-red-500 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-40">
                Confirm Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!showCancel && (
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-5 py-4">
          <button
            onClick={() => void doAction(() => duplicatePurchaseOrder(po._id))}
            disabled={acting || !canDuplicate}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-mist disabled:opacity-30"
            title="Duplicate"
          >
            <Copy size={12} /> Copy
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-mist"
            title="Print"
          >
            <FileText size={12} /> Print
          </button>
          {canCancel && !showCancel && (
            <button
              onClick={() => setShowCancel(true)}
              disabled={acting}
              className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-30"
            >
              <Ban size={12} /> Cancel PO
            </button>
          )}
          {canEdit && (
            <button
              onClick={onEdit}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink/60 hover:bg-mist"
            >
              Edit Draft
            </button>
          )}
          {canSubmit && (
            <button
              onClick={() => void doAction(() => submitPurchaseOrder(po._id))}
              disabled={acting}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40"
            >
              <Send size={12} /> Submit
            </button>
          )}
          {canApprove && (
            <button
              onClick={() => void doAction(() => approvePurchaseOrder(po._id))}
              disabled={acting}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              <Check size={12} /> Approve
            </button>
          )}
          {canSend && (
            <button
              onClick={() => void doAction(() => sendPurchaseOrder(po._id))}
              disabled={acting}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
            >
              <Truck size={12} /> Mark Sent
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PurchaseOrdersPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [tab, setTab]             = useState<Tab>('all');
  const [pos, setPOs]             = useState<PurchaseOrder[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [debouncedSearch, setDebSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [fromDate, setFromDate]   = useState('');
  const [toDate, setToDate]       = useState('');

  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [editingPO, setEditingPO]       = useState<PurchaseOrder | null>(null);
  const [detailPO, setDetailPO]         = useState<PurchaseOrder | null>(null);

  const [report, setReport]         = useState<POReport | null>(null);
  const [reportLoading, setRptLoad] = useState(false);
  const [reportError, setRptError]  = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const currentTab = TABS.find(t => t.id === tab);
      const params: Parameters<typeof fetchPurchaseOrders>[0] = { limit: 100 };
      if (debouncedSearch)             params.search   = debouncedSearch;
      if (currentTab?.statusFilter)    params.status   = currentTab.statusFilter;
      if (vendorFilter)                params.vendorId = vendorFilter;
      if (fromDate)                    params.from     = fromDate;
      if (toDate)                      params.to       = toDate;
      const { purchaseOrders: p, total: t } = await fetchPurchaseOrders(params);
      setPOs(p); setTotal(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab, debouncedSearch, vendorFilter, fromDate, toDate]);

  useEffect(() => { if (tab !== 'reports') void load(); }, [tab, load]);

  const loadReport = useCallback(async () => {
    setRptLoad(true); setRptError(null);
    try {
      const r = await fetchPOReport({ from: fromDate || undefined, to: toDate || undefined });
      setReport(r);
    } catch (e) {
      setRptError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setRptLoad(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { if (tab === 'reports') void loadReport(); }, [tab, loadReport]);

  function onSaved(po: PurchaseOrder) {
    setPOs(prev => {
      const idx = prev.findIndex(p => p._id === po._id);
      return idx >= 0 ? prev.map(p => p._id === po._id ? po : p) : [po, ...prev];
    });
    if (editingPO) { } else setTotal(t => t + 1);
    setDrawerOpen(false);
    setDetailPO(po);
  }

  function onAction(po: PurchaseOrder) {
    setPOs(prev => prev.map(p => p._id === po._id ? po : p));
    setDetailPO(po);
  }

  async function handleDelete(po: PurchaseOrder) {
    if (!window.confirm(`Delete ${po.poNumber}? This cannot be undone.`)) return;
    try {
      await deletePurchaseOrder(po._id);
      setPOs(prev => prev.filter(p => p._id !== po._id));
      setTotal(t => t - 1);
      if (detailPO?._id === po._id) setDetailPO(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  function handleExportCSV() {
    downloadCSV('purchase-orders.csv',
      ['PO#', 'Vendor', 'Status', 'Order Date', 'Expected Delivery', 'Subtotal', 'Tax', 'Discount', 'Shipping', 'Total', 'Items'],
      pos.map(p => [
        p.poNumber, p.vendorSnapshot.businessName, p.status,
        fmtDate(p.orderDate), fmtDate(p.expectedDeliveryDate),
        p.subtotal, p.taxTotal, p.discount, p.shipping, p.total, p.items.length,
      ]),
    );
  }

  const maxVendorValue = Math.max(...(report?.byVendor.map(v => v.totalValue) ?? [1]), 1);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="shrink-0 border-b border-border bg-canvas">
        <div className="flex items-center border-b border-border px-5">
          <div className="flex overflow-x-auto">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`-mb-px flex shrink-0 items-center gap-1 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                  tab === t.id ? 'border-brand text-brand' : 'border-transparent text-ink/40 hover:text-ink'
                }`}>
                {t.id === 'reports' ? <TrendingUp size={11} /> : <ShoppingBag size={11} />}
                {t.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 py-2">
            <button onClick={tab === 'reports' ? () => window.print() : handleExportCSV}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5">
              <Download size={11} /> CSV
            </button>
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5">
              <FileText size={11} /> Print
            </button>
            {tab !== 'reports' && (
              <button onClick={() => { setEditingPO(null); setDrawerOpen(true); }}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90">
                <Plus size={11} /> New PO
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        {tab !== 'reports' && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-2">
            <div className="relative flex-1 min-w-44 max-w-xs">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
              <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search POs…"
                className="w-full rounded-lg border border-border bg-mist py-1.5 pl-8 pr-3 text-xs text-ink outline-none focus:border-brand/50" />
            </div>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none" />
            <span className="text-xs text-ink/30">to</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="rounded-lg border border-border bg-mist px-2.5 py-1.5 text-xs text-ink outline-none" />
            {loading && <Loader2 size={12} className="animate-spin text-ink/30" />}
            <span className="ml-auto text-xs text-ink/30">{total} PO{total !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto bg-mist">
          {/* ══ PO LIST ══ */}
          {tab !== 'reports' && (
            <div className="p-5 space-y-4">
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
                  <AlertCircle size={14} className="shrink-0" />{error}
                </div>
              )}
              {loading && pos.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 size={24} className="animate-spin text-ink/20" />
                </div>
              ) : pos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <ShoppingBag size={40} className="mb-3 text-ink/10" />
                  <p className="text-sm text-ink/40">
                    {debouncedSearch ? 'No purchase orders match' : 'No purchase orders yet'}
                  </p>
                  {!debouncedSearch && (
                    <button onClick={() => { setEditingPO(null); setDrawerOpen(true); }}
                      className="mt-3 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90">
                      <Plus size={12} /> Create First PO
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-canvas overflow-hidden">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-mist">
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">PO #</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Vendor</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40 hidden md:table-cell">Order Date</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40 hidden lg:table-cell">Expected</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-ink/40 hidden sm:table-cell">Items</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Total</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-ink/40">Status</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pos.map(po => (
                        <tr key={po._id}
                          className={`cursor-pointer hover:bg-mist ${detailPO?._id === po._id ? 'bg-brand/5' : ''}`}
                          onClick={() => setDetailPO(prev => prev?._id === po._id ? null : po)}
                        >
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-semibold text-brand">{po.poNumber}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-ink">{po.vendorSnapshot.businessName}</p>
                            <p className="text-[10px] text-ink/40">{po.vendorSnapshot.vendorCode}</p>
                          </td>
                          <td className="hidden px-4 py-3 text-xs text-ink/60 md:table-cell">{fmtDate(po.orderDate)}</td>
                          <td className="hidden px-4 py-3 text-xs text-ink/60 lg:table-cell">{fmtDate(po.expectedDeliveryDate)}</td>
                          <td className="hidden px-4 py-3 text-center text-sm text-ink/60 sm:table-cell">{po.items.length}</td>
                          <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-ink">
                            {fmtCur(po.total, sym)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <StatusBadge status={po.status} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                              <button onClick={() => setDetailPO(p => p?._id === po._id ? null : po)}
                                className="rounded-lg p-1.5 text-ink/30 hover:bg-ink/5 hover:text-ink" title="View">
                                <Eye size={13} />
                              </button>
                              {po.status === 'draft' && (
                                <button onClick={() => { setEditingPO(po); setDrawerOpen(true); setDetailPO(null); }}
                                  className="rounded-lg p-1.5 text-ink/30 hover:bg-ink/5 hover:text-ink" title="Edit">
                                  <FileText size={13} />
                                </button>
                              )}
                              {po.status === 'draft' && (
                                <button onClick={() => void handleDelete(po)}
                                  className="rounded-lg p-1.5 text-ink/30 hover:bg-red-50 hover:text-red-500" title="Delete">
                                  <Trash2 size={13} />
                                </button>
                              )}
                              <ChevronRight size={12} className={`text-ink/20 transition-transform ${detailPO?._id === po._id ? 'rotate-90' : ''}`} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ══ REPORTS ══ */}
          {tab === 'reports' && (
            <div className="p-5 space-y-5">
              {/* Date filters for reports */}
              <div className="flex items-center gap-2">
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

              {reportError && (
                <div className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">{reportError}</div>
              )}
              {reportLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 size={24} className="animate-spin text-ink/20" />
                </div>
              ) : report ? (
                <>
                  {/* KPIs */}
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <KPICard label="Total POs" value={String(report.totalPOs)} sub={`${report.draftCount} draft, ${report.pendingCount} pending`} />
                    <KPICard label="Total Value" value={fmtCur(report.totalValue, sym)} sub="All non-cancelled POs" accent />
                    <KPICard label="Pending Value" value={fmtCur(report.pendingValue, sym)} sub="Pending + approved + sent" />
                    <KPICard label="Received" value={String(report.receivedCount)} sub={`${report.partialCount} partially received`} />
                  </div>

                  {/* Status breakdown */}
                  <div className="rounded-xl border border-border bg-canvas p-5">
                    <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">Status Breakdown</h3>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                      {([
                        { label: 'Draft',    count: report.draftCount },
                        { label: 'Pending',  count: report.pendingCount },
                        { label: 'Approved', count: report.approvedCount },
                        { label: 'Sent',     count: report.sentCount },
                        { label: 'Received', count: report.receivedCount },
                        { label: 'Cancelled',count: report.cancelledCount },
                      ] as const).map(s => (
                        <div key={s.label} className="rounded-lg border border-border bg-mist p-3 text-center">
                          <p className="text-xl font-bold text-ink">{s.count}</p>
                          <p className="text-[10px] text-ink/40">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* By vendor */}
                  {report.byVendor.length > 0 && (
                    <div className="rounded-xl border border-border bg-canvas p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Purchase by Vendor</h3>
                        <button onClick={() => downloadCSV('po-by-vendor.csv',
                          ['Vendor', 'PO Count', 'Total Value'],
                          report.byVendor.map(v => [v.businessName, v.poCount, v.totalValue]))}
                          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-ink/50 hover:bg-ink/5">
                          <Download size={11} /> CSV
                        </button>
                      </div>
                      <div className="space-y-3">
                        {report.byVendor.map(v => (
                          <div key={v._id} className="flex items-center gap-3">
                            <span className="w-36 shrink-0 truncate text-right text-xs text-ink/50">{v.businessName}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/5">
                              <div className="h-2 rounded-full bg-brand transition-all"
                                style={{ width: `${(v.totalValue / maxVendorValue) * 100}%` }} />
                            </div>
                            <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">
                              {fmtCur(v.totalValue, sym)}
                            </span>
                            <span className="w-10 shrink-0 text-right text-xs text-ink/40">{v.poCount} POs</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Purchase trend by month */}
                  {report.byMonth.length > 0 && (
                    <div className="rounded-xl border border-border bg-canvas p-5">
                      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink/40">Monthly Purchase Trend</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="bg-mist">
                              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink/40">Month</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink/40">POs</th>
                              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink/40">Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {report.byMonth.map(m => (
                              <tr key={m._id} className="hover:bg-mist">
                                <td className="px-4 py-2 text-xs text-ink">{m._id}</td>
                                <td className="px-4 py-2 text-right text-xs text-ink/70">{m.poCount}</td>
                                <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-ink">{fmtCur(m.totalValue, sym)}</td>
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
        {detailPO && tab !== 'reports' && (
          <PODetail
            po={detailPO}
            sym={sym}
            onEdit={() => { setEditingPO(detailPO); setDrawerOpen(true); }}
            onClose={() => setDetailPO(null)}
            onAction={onAction}
          />
        )}
      </div>

      {/* Drawer */}
      <PODrawer
        open={drawerOpen}
        editing={editingPO}
        onClose={() => setDrawerOpen(false)}
        onSaved={onSaved}
        sym={sym}
      />
    </div>
  );
}
