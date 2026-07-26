import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Plus, Pencil, Trash2, X, Phone, Mail, MapPin,
  AlertCircle, Download, RefreshCw, Loader2, Store,
  CreditCard, Users, TrendingUp, Building2, ChevronRight,
  ExternalLink, Clock, CheckCircle, XCircle,
} from 'lucide-react';
import {
  fetchVendors, createVendor, updateVendor, deleteVendor,
  fetchVendorReport,
  type Vendor, type VendorInput, type VendorReport,
} from '../api/vendors';
import { useSettings } from '../context/SettingsContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab          = 'list' | 'reports';
type ActiveFilter = 'all' | 'active' | 'inactive';

const PAYMENT_TERMS: Array<{ id: VendorInput['paymentTerms']; label: string }> = [
  { id: 'immediate', label: 'Immediate' },
  { id: 'net15',     label: 'Net 15 days' },
  { id: 'net30',     label: 'Net 30 days' },
  { id: 'net45',     label: 'Net 45 days' },
  { id: 'net60',     label: 'Net 60 days' },
  { id: 'custom',    label: 'Custom' },
];

const BLANK_FORM: VendorInput = {
  businessName:       '',
  contactPerson:      '',
  mobile:             '',
  alternateMobile:    '',
  email:              '',
  gstNumber:          '',
  pan:                '',
  address:            '',
  city:               '',
  state:              '',
  pincode:            '',
  paymentTerms:       'immediate',
  creditLimit:        0,
  openingBalance:     0,
  currentOutstanding: 0,
  notes:              '',
  isActive:           true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCur(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const all = [headers, ...rows];
  const csv = all
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, accent = false,
}: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-canvas px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-brand' : 'text-ink'}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

function OutstandingBar({
  outstanding, limit, sym,
}: { outstanding: number; limit: number; sym: string }) {
  const pct = limit > 0 ? Math.min((outstanding / limit) * 100, 100) : 0;
  const danger = pct >= 90;
  const warn   = pct >= 70;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] tabular-nums text-ink/50">
        <span>{fmtCur(outstanding, sym)} used</span>
        <span>of {fmtCur(limit, sym)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/8">
        <div
          className={`h-1.5 rounded-full transition-all ${danger ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-brand'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-0.5 text-right text-[10px] text-ink/40">{pct.toFixed(0)}% utilized</p>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{label}</label>
      <div>{children}</div>
    </div>
  );
}

function FormInput({
  value, onChange, placeholder = '', type = 'text', className = '',
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 ${className}`}
    />
  );
}

// ── Vendor Drawer ─────────────────────────────────────────────────────────────

function VendorDrawer({
  open, editing, form, saving, error,
  onClose, onSave, onChange,
}: {
  open:    boolean;
  editing: Vendor | null;
  form:    VendorInput;
  saving:  boolean;
  error:   string | null;
  onClose: () => void;
  onSave:  () => void;
  onChange: (k: keyof VendorInput, v: unknown) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saving, onClose]);

  if (!open) return null;

  const field = (k: keyof VendorInput) => (
    (form[k] as string | number) ?? ''
  );

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        ref={overlayRef}
        className="flex-1 bg-black/30"
        onClick={e => e.target === overlayRef.current && !saving && onClose()}
      />
      <div className="flex w-full max-w-lg flex-col border-l border-border bg-canvas shadow-2xl sm:w-[480px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">
            {editing ? 'Edit Vendor' : 'New Vendor'}
          </h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1 text-ink/40 hover:bg-ink/5 hover:text-ink disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/30">Business Info</p>

          <FieldRow label="Business Name *">
            <FormInput
              value={field('businessName') as string}
              onChange={v => onChange('businessName', v)}
              placeholder="e.g. Fresh Vegetables Co."
            />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Contact Person">
              <FormInput
                value={field('contactPerson') as string}
                onChange={v => onChange('contactPerson', v)}
                placeholder="Name"
              />
            </FieldRow>
            <FieldRow label="Status">
              <select
                value={form.isActive ? 'true' : 'false'}
                onChange={e => onChange('isActive', e.target.value === 'true')}
                className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </FieldRow>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Mobile *">
              <FormInput
                value={field('mobile') as string}
                onChange={v => onChange('mobile', v)}
                placeholder="10-digit mobile"
                type="tel"
              />
            </FieldRow>
            <FieldRow label="Alternate Mobile">
              <FormInput
                value={field('alternateMobile') as string}
                onChange={v => onChange('alternateMobile', v)}
                placeholder="Optional"
                type="tel"
              />
            </FieldRow>
          </div>

          <FieldRow label="Email">
            <FormInput
              value={field('email') as string}
              onChange={v => onChange('email', v)}
              placeholder="vendor@example.com"
              type="email"
            />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="GST Number">
              <FormInput
                value={field('gstNumber') as string}
                onChange={v => onChange('gstNumber', v.toUpperCase())}
                placeholder="22AAAAA0000A1Z5"
              />
            </FieldRow>
            <FieldRow label="PAN">
              <FormInput
                value={field('pan') as string}
                onChange={v => onChange('pan', v.toUpperCase())}
                placeholder="ABCDE1234F"
              />
            </FieldRow>
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/30 pt-2">Address</p>

          <FieldRow label="Address">
            <FormInput
              value={field('address') as string}
              onChange={v => onChange('address', v)}
              placeholder="Street address"
            />
          </FieldRow>

          <div className="grid grid-cols-3 gap-3">
            <FieldRow label="City">
              <FormInput
                value={field('city') as string}
                onChange={v => onChange('city', v)}
                placeholder="City"
              />
            </FieldRow>
            <FieldRow label="State">
              <FormInput
                value={field('state') as string}
                onChange={v => onChange('state', v)}
                placeholder="State"
              />
            </FieldRow>
            <FieldRow label="Pincode">
              <FormInput
                value={field('pincode') as string}
                onChange={v => onChange('pincode', v)}
                placeholder="6 digits"
              />
            </FieldRow>
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/30 pt-2">Financial</p>

          <FieldRow label="Payment Terms">
            <select
              value={form.paymentTerms ?? 'immediate'}
              onChange={e => onChange('paymentTerms', e.target.value)}
              className="w-full rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
            >
              {PAYMENT_TERMS.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Credit Limit">
              <FormInput
                value={form.creditLimit ?? 0}
                onChange={v => onChange('creditLimit', parseFloat(v) || 0)}
                placeholder="0"
                type="number"
              />
            </FieldRow>
            <FieldRow label="Opening Balance">
              <FormInput
                value={form.openingBalance ?? 0}
                onChange={v => onChange('openingBalance', parseFloat(v) || 0)}
                placeholder="0"
                type="number"
              />
            </FieldRow>
          </div>

          {editing && (
            <FieldRow label="Current Outstanding">
              <FormInput
                value={form.currentOutstanding ?? 0}
                onChange={v => onChange('currentOutstanding', parseFloat(v) || 0)}
                placeholder="0"
                type="number"
              />
            </FieldRow>
          )}

          <FieldRow label="Notes">
            <textarea
              value={form.notes ?? ''}
              onChange={e => onChange('notes', e.target.value)}
              placeholder="Internal notes about this vendor…"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-mist px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
            />
          </FieldRow>
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-border px-5 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-border py-2 text-sm text-ink/50 hover:bg-mist disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-1.5">
                <RefreshCw size={12} className="animate-spin" />
                Saving…
              </span>
            ) : editing ? 'Save Changes' : 'Create Vendor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Vendor Detail Panel ───────────────────────────────────────────────────────

function VendorDetail({
  vendor, sym, onEdit, onDelete, onClose,
}: {
  vendor:   Vendor;
  sym:      string;
  onEdit:   () => void;
  onDelete: () => void;
  onClose:  () => void;
}) {
  const ptLabel = PAYMENT_TERMS.find(t => t.id === vendor.paymentTerms)?.label ?? vendor.paymentTerms;

  return (
    <div className="flex w-full max-w-sm flex-col border-l border-border bg-canvas shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-5 py-4">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">{vendor.vendorCode}</p>
          <h2 className="mt-0.5 truncate text-sm font-semibold text-ink">{vendor.businessName}</h2>
          <div className="mt-1 flex items-center gap-1.5">
            {vendor.isActive ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                <CheckCircle size={10} /> Active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-ink/40">
                <XCircle size={10} /> Inactive
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="ml-2 shrink-0 rounded-lg p-1 text-ink/40 hover:bg-ink/5">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Outstanding card */}
        {vendor.creditLimit > 0 && (
          <div className="rounded-xl border border-border bg-mist p-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink/40">
              Credit Utilization
            </p>
            <OutstandingBar outstanding={vendor.currentOutstanding} limit={vendor.creditLimit} sym={sym} />
          </div>
        )}
        {vendor.currentOutstanding > 0 && vendor.creditLimit === 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Outstanding</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-700">
              {fmtCur(vendor.currentOutstanding, sym)}
            </p>
          </div>
        )}

        {/* Contact info */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/30">Contact</p>
          {vendor.contactPerson && (
            <div className="flex items-center gap-2 text-sm text-ink">
              <Users size={13} className="shrink-0 text-ink/30" />
              {vendor.contactPerson}
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-ink">
            <Phone size={13} className="shrink-0 text-ink/30" />
            <a href={`tel:${vendor.mobile}`} className="hover:text-brand">{vendor.mobile}</a>
            {vendor.alternateMobile && (
              <span className="text-ink/40"> / {vendor.alternateMobile}</span>
            )}
          </div>
          {vendor.email && (
            <div className="flex items-center gap-2 text-sm text-ink">
              <Mail size={13} className="shrink-0 text-ink/30" />
              <a href={`mailto:${vendor.email}`} className="hover:text-brand truncate">
                {vendor.email}
              </a>
            </div>
          )}
          {vendor.mobile && (
            <a
              href={`https://wa.me/91${vendor.mobile.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              <ExternalLink size={11} />
              WhatsApp
            </a>
          )}
        </div>

        {/* GST / PAN */}
        {(vendor.gstNumber || vendor.pan) && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/30">Tax IDs</p>
            {vendor.gstNumber && (
              <div className="flex items-center gap-2 text-sm text-ink">
                <Building2 size={13} className="shrink-0 text-ink/30" />
                GST: <span className="font-mono text-xs">{vendor.gstNumber}</span>
              </div>
            )}
            {vendor.pan && (
              <div className="flex items-center gap-2 text-sm text-ink">
                <CreditCard size={13} className="shrink-0 text-ink/30" />
                PAN: <span className="font-mono text-xs">{vendor.pan}</span>
              </div>
            )}
          </div>
        )}

        {/* Address */}
        {(vendor.address || vendor.city || vendor.state) && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/30">Address</p>
            <div className="flex items-start gap-2 text-sm text-ink/70">
              <MapPin size={13} className="mt-0.5 shrink-0 text-ink/30" />
              <span>
                {[vendor.address, vendor.city, vendor.state, vendor.pincode]
                  .filter(Boolean).join(', ')}
              </span>
            </div>
          </div>
        )}

        {/* Financial */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/30">Financial</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-mist p-3">
              <p className="text-[10px] text-ink/40">Outstanding</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                {fmtCur(vendor.currentOutstanding, sym)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-mist p-3">
              <p className="text-[10px] text-ink/40">Credit Limit</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                {vendor.creditLimit > 0 ? fmtCur(vendor.creditLimit, sym) : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-mist p-3">
              <p className="text-[10px] text-ink/40">Opening Bal.</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                {fmtCur(vendor.openingBalance, sym)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-mist p-3">
              <p className="text-[10px] text-ink/40">Payment Terms</p>
              <p className="mt-0.5 text-sm font-semibold text-ink">{ptLabel}</p>
            </div>
          </div>
        </div>

        {/* Notes */}
        {vendor.notes && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink/30">Notes</p>
            <p className="text-xs text-ink/60 leading-relaxed">{vendor.notes}</p>
          </div>
        )}

        {/* Activity timeline */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/30">Activity</p>
          <div className="flex items-center gap-2 text-xs text-ink/50">
            <Clock size={11} />
            Created {fmtDate(vendor.createdAt)}
          </div>
          {vendor.updatedAt !== vendor.createdAt && (
            <div className="flex items-center gap-2 text-xs text-ink/40">
              <RefreshCw size={11} />
              Updated {fmtDate(vendor.updatedAt)}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t border-border px-5 py-4">
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-red-500 hover:border-red-300 hover:bg-red-50"
        >
          <Trash2 size={13} />
          Delete
        </button>
        <button
          onClick={onEdit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand/90"
        >
          <Pencil size={13} />
          Edit Vendor
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function VendorsPage() {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [tab, setTab]               = useState<Tab>('list');
  const [vendors, setVendors]       = useState<Vendor[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [debouncedSearch, setDebSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [form, setForm]             = useState<VendorInput>(BLANK_FORM);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);
  const [deleting, setDeleting]     = useState(false);

  const [report, setReport]         = useState<VendorReport | null>(null);
  const [reportLoading, setRptLoading] = useState(false);
  const [reportError, setRptError]  = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { limit: 100 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (activeFilter === 'active')   params.active = 'true';
      if (activeFilter === 'inactive') params.active = 'false';
      const { vendors: vs, total: t } = await fetchVendors(params as any);
      setVendors(vs);
      setTotal(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, activeFilter]);

  useEffect(() => { void load(); }, [load]);

  const loadReport = useCallback(async () => {
    setRptLoading(true);
    setRptError(null);
    try {
      const r = await fetchVendorReport();
      setReport(r);
    } catch (e) {
      setRptError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setRptLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'reports') void loadReport();
  }, [tab, loadReport]);

  function openCreate() {
    setEditingVendor(null);
    setForm(BLANK_FORM);
    setFormError(null);
    setDrawerOpen(true);
  }

  function openEdit(v: Vendor) {
    setEditingVendor(v);
    setForm({
      businessName:       v.businessName,
      contactPerson:      v.contactPerson,
      mobile:             v.mobile,
      alternateMobile:    v.alternateMobile,
      email:              v.email,
      gstNumber:          v.gstNumber,
      pan:                v.pan,
      address:            v.address,
      city:               v.city,
      state:              v.state,
      pincode:            v.pincode,
      paymentTerms:       v.paymentTerms,
      creditLimit:        v.creditLimit,
      openingBalance:     v.openingBalance,
      currentOutstanding: v.currentOutstanding,
      notes:              v.notes,
      isActive:           v.isActive,
    });
    setFormError(null);
    setDrawerOpen(true);
    setDetailVendor(null);
  }

  async function handleSave() {
    if (!form.businessName.trim()) { setFormError('Business name is required'); return; }
    if (!form.mobile.trim())       { setFormError('Mobile number is required'); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (editingVendor) {
        const updated = await updateVendor(editingVendor._id, form);
        setVendors(vs => vs.map(v => v._id === updated._id ? updated : v));
        if (detailVendor?._id === updated._id) setDetailVendor(updated);
      } else {
        const created = await createVendor(form);
        setVendors(vs => [created, ...vs]);
        setTotal(t => t + 1);
      }
      setDrawerOpen(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteVendor(deleteTarget._id);
      setVendors(vs => vs.filter(v => v._id !== deleteTarget._id));
      setTotal(t => t - 1);
      if (detailVendor?._id === deleteTarget._id) setDetailVendor(null);
      setDeleteTarget(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  function handleCSV() {
    downloadCSV('vendors.csv',
      ['Code', 'Business Name', 'Contact Person', 'Mobile', 'Alt Mobile', 'Email',
       'GST', 'PAN', 'City', 'State', 'Payment Terms', 'Credit Limit', 'Outstanding', 'Status'],
      vendors.map(v => [
        v.vendorCode, v.businessName, v.contactPerson, v.mobile, v.alternateMobile,
        v.email, v.gstNumber, v.pan, v.city, v.state,
        PAYMENT_TERMS.find(t => t.id === v.paymentTerms)?.label ?? v.paymentTerms,
        v.creditLimit, v.currentOutstanding, v.isActive ? 'Active' : 'Inactive',
      ]),
    );
  }

  function handleReportCSV() {
    if (!report) return;
    downloadCSV('vendor-report.csv',
      ['Vendor Code', 'Business Name', 'Outstanding', 'Credit Limit', 'Mobile'],
      report.topVendors.map(v => [
        v.vendorCode, v.businessName, v.currentOutstanding, v.creditLimit, v.mobile,
      ]),
    );
  }

  const setField = (k: keyof VendorInput, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }));

  const maxOutstanding = Math.max(...(report?.topVendors.map(v => v.currentOutstanding) ?? [1]), 1);

  return (
    <div className="flex h-full flex-col">
      {/* ── Top bar ── */}
      <div className="shrink-0 border-b border-border bg-canvas">
        <div className="flex items-center border-b border-border px-5">
          {(['list', 'reports'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold transition-colors capitalize ${
                tab === t
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink/40 hover:text-ink'
              }`}
            >
              {t === 'list' ? <Store size={12} /> : <TrendingUp size={12} />}
              {t === 'list' ? 'Vendors' : 'Reports'}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2 py-2">
            <button
              onClick={tab === 'list' ? handleCSV : handleReportCSV}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink"
            >
              <Download size={12} />
              CSV
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink"
            >
              PDF / Print
            </button>
            {tab === 'list' && (
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
              >
                <Plus size={12} />
                Add Vendor
              </button>
            )}
          </div>
        </div>

        {/* Search + filter — list tab only */}
        {tab === 'list' && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-2.5">
            <div className="relative flex-1 min-w-48 max-w-xs">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search vendors…"
                className="w-full rounded-lg border border-border bg-mist py-1.5 pl-8 pr-3 text-xs text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
              />
            </div>
            {(['all', 'active', 'inactive'] as const).map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  activeFilter === f
                    ? 'bg-brand text-white'
                    : 'bg-ink/5 text-ink/50 hover:bg-ink/10'
                }`}
              >
                {f}
              </button>
            ))}
            {loading && <Loader2 size={13} className="animate-spin text-ink/30" />}
            <span className="ml-auto text-xs text-ink/30">{total} vendor{total !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto bg-mist">

          {/* ════════ VENDORS LIST ════════ */}
          {tab === 'list' && (
            <div className="p-5 space-y-4">
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              )}

              {loading && vendors.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 size={24} className="animate-spin text-ink/20" />
                </div>
              ) : vendors.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Store size={40} className="mb-3 text-ink/10" />
                  <p className="text-sm text-ink/40">
                    {debouncedSearch ? 'No vendors match your search' : 'No vendors yet'}
                  </p>
                  {!debouncedSearch && (
                    <button
                      onClick={openCreate}
                      className="mt-3 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90"
                    >
                      <Plus size={12} />
                      Add First Vendor
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-canvas overflow-hidden">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-mist">
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Vendor</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40 hidden md:table-cell">Contact</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40 hidden lg:table-cell">Location</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Outstanding</th>
                        <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-ink/40">Status</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {vendors.map(v => (
                        <tr
                          key={v._id}
                          className={`cursor-pointer hover:bg-mist ${detailVendor?._id === v._id ? 'bg-brand/5' : ''}`}
                          onClick={() => setDetailVendor(prev => prev?._id === v._id ? null : v)}
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium text-ink">{v.businessName}</p>
                            <p className="text-[10px] font-mono text-ink/30">{v.vendorCode}</p>
                          </td>
                          <td className="hidden px-4 py-3 md:table-cell">
                            <p className="text-xs text-ink/70">{v.mobile}</p>
                            {v.contactPerson && (
                              <p className="text-[10px] text-ink/40">{v.contactPerson}</p>
                            )}
                          </td>
                          <td className="hidden px-4 py-3 lg:table-cell">
                            {(v.city || v.state) ? (
                              <p className="text-xs text-ink/60">
                                {[v.city, v.state].filter(Boolean).join(', ')}
                              </p>
                            ) : (
                              <span className="text-xs text-ink/20">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <p className={`text-sm font-semibold tabular-nums ${v.currentOutstanding > 0 ? 'text-amber-600' : 'text-ink/40'}`}>
                              {v.currentOutstanding > 0 ? fmtCur(v.currentOutstanding, sym) : '—'}
                            </p>
                            {v.creditLimit > 0 && (
                              <p className="text-[10px] tabular-nums text-ink/30">
                                of {fmtCur(v.creditLimit, sym)}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              v.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-ink/5 text-ink/40'
                            }`}>
                              {v.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => openEdit(v)}
                                className="rounded-lg p-1.5 text-ink/30 hover:bg-ink/5 hover:text-ink"
                                title="Edit"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(v)}
                                className="rounded-lg p-1.5 text-ink/30 hover:bg-red-50 hover:text-red-500"
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                              <ChevronRight size={13} className={`text-ink/20 transition-transform ${detailVendor?._id === v._id ? 'rotate-90' : ''}`} />
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

          {/* ════════ REPORTS ════════ */}
          {tab === 'reports' && (
            <div className="p-5 space-y-5">
              {reportError && (
                <div className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-3 text-sm text-brand">
                  {reportError}
                </div>
              )}

              {reportLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 size={24} className="animate-spin text-ink/20" />
                </div>
              ) : report ? (
                <>
                  {/* KPIs */}
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <KPICard
                      label="Total Vendors"
                      value={String(report.totalVendors)}
                      sub={`${report.activeVendors} active, ${report.inactiveVendors} inactive`}
                    />
                    <KPICard
                      label="Active Vendors"
                      value={String(report.activeVendors)}
                      sub="Enabled for purchasing"
                    />
                    <KPICard
                      label="Total Outstanding"
                      value={fmtCur(report.totalOutstanding, sym)}
                      sub="Across all vendors"
                      accent
                    />
                    <KPICard
                      label="Total Credit Limit"
                      value={fmtCur(report.totalCreditLimit, sym)}
                      sub="Aggregate credit line"
                    />
                  </div>

                  {/* Top vendors by outstanding */}
                  {report.topVendors.length > 0 && (
                    <div className="rounded-xl border border-border bg-canvas p-5">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/40">
                          Top Vendors by Outstanding
                        </h3>
                        <button
                          onClick={handleReportCSV}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink/50 hover:bg-ink/5"
                        >
                          <Download size={11} />
                          CSV
                        </button>
                      </div>
                      <div className="space-y-3">
                        {report.topVendors.map(v => (
                          <div key={v._id} className="flex items-center gap-3">
                            <span className="w-40 shrink-0 truncate text-right text-xs text-ink/50">
                              {v.businessName}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/5">
                              <div
                                className="h-2 rounded-full bg-brand transition-all"
                                style={{ width: `${maxOutstanding > 0 ? (v.currentOutstanding / maxOutstanding) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">
                              {fmtCur(v.currentOutstanding, sym)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Vendor table */}
                  <div className="rounded-xl border border-border bg-canvas overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border px-5 py-3">
                      <h3 className="text-sm font-semibold text-ink">Pending Payments</h3>
                      <span className="text-xs text-ink/40">
                        {report.topVendors.filter(v => v.currentOutstanding > 0).length} vendors with outstanding
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-mist">
                            <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Vendor</th>
                            <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Mobile</th>
                            <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Outstanding</th>
                            <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Credit Limit</th>
                            <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Utilization</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {report.topVendors.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-5 py-8 text-center text-xs text-ink/30">
                                No vendors with outstanding amounts
                              </td>
                            </tr>
                          ) : (
                            report.topVendors.map(v => {
                              const util = v.creditLimit > 0 ? (v.currentOutstanding / v.creditLimit) * 100 : null;
                              return (
                                <tr key={v._id} className="hover:bg-mist">
                                  <td className="px-5 py-2.5">
                                    <p className="font-medium text-ink">{v.businessName}</p>
                                    <p className="text-[10px] font-mono text-ink/30">{v.vendorCode}</p>
                                  </td>
                                  <td className="px-5 py-2.5 text-xs text-ink/60">{v.mobile}</td>
                                  <td className={`px-5 py-2.5 text-right font-semibold tabular-nums ${v.currentOutstanding > 0 ? 'text-amber-600' : 'text-ink/30'}`}>
                                    {v.currentOutstanding > 0 ? fmtCur(v.currentOutstanding, sym) : '—'}
                                  </td>
                                  <td className="px-5 py-2.5 text-right tabular-nums text-ink/60">
                                    {v.creditLimit > 0 ? fmtCur(v.creditLimit, sym) : '—'}
                                  </td>
                                  <td className={`px-5 py-2.5 text-right text-xs tabular-nums ${util !== null && util >= 90 ? 'font-semibold text-red-600' : 'text-ink/40'}`}>
                                    {util !== null ? `${util.toFixed(0)}%` : '—'}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* ── Detail panel (right side) ── */}
        {detailVendor && tab === 'list' && (
          <VendorDetail
            vendor={detailVendor}
            sym={sym}
            onEdit={() => openEdit(detailVendor)}
            onDelete={() => setDeleteTarget(detailVendor)}
            onClose={() => setDetailVendor(null)}
          />
        )}
      </div>

      {/* ── Vendor Drawer (create/edit) ── */}
      <VendorDrawer
        open={drawerOpen}
        editing={editingVendor}
        form={form}
        saving={saving}
        error={formError}
        onClose={() => setDrawerOpen(false)}
        onSave={() => { void handleSave(); }}
        onChange={setField}
      />

      {/* ── Delete confirm ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-canvas p-6 shadow-xl">
            <h2 className="mb-1 text-sm font-semibold text-ink">Delete Vendor?</h2>
            <p className="text-xs text-ink/50">
              <span className="font-medium text-ink">{deleteTarget.businessName}</span> will be removed.
              This action cannot be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 rounded-lg border border-border py-2 text-sm text-ink/50 hover:bg-mist disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleDelete(); }}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
