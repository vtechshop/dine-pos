import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Trash2, ToggleLeft, ToggleRight, Edit2, X, Tag } from 'lucide-react';
import {
  fetchCoupons, createCoupon, updateCoupon, deleteCoupon,
  deactivateCoupon, activateCoupon,
  type Coupon, type CouponInput,
} from '../api/coupons';

const BLANK: CouponInput = {
  code: '',
  description: '',
  type: 'percent',
  value: 0,
  minOrderValue: 0,
  maxDiscount: undefined,
  validFrom: '',
  validUntil: '',
  usageLimit: undefined,
  perCustomerLimit: undefined,
};

function toDateInput(iso?: string): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function CouponsPage() {
  const [items, setItems]           = useState<Coupon[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<Coupon | null>(null);
  const [form, setForm]             = useState<CouponInput>(BLANK);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Coupon | null>(null);
  const [deleting, setDeleting]         = useState(false);

  const LIMIT = 25;

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const activeParam = activeFilter === 'active' ? 'true' : activeFilter === 'inactive' ? 'false' : '';
      const res = await fetchCoupons({ page: p, limit: LIMIT, active: activeParam as 'true' | 'false' | '' });
      setItems(res.coupons);
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => { load(1); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(BLANK);
    setFormError(null);
    setDrawerOpen(true);
  };

  const openEdit = (c: Coupon) => {
    setEditing(c);
    setForm({
      code: c.code,
      description: c.description ?? '',
      type: c.type,
      value: c.value,
      minOrderValue: c.minOrderValue,
      maxDiscount: c.maxDiscount,
      validFrom: toDateInput(c.validFrom),
      validUntil: toDateInput(c.validUntil),
      usageLimit: c.usageLimit,
      perCustomerLimit: c.perCustomerLimit,
    });
    setFormError(null);
    setDrawerOpen(true);
  };

  const saveForm = async () => {
    if (!form.code.trim()) { setFormError('Coupon code is required.'); return; }
    if (form.value <= 0)   { setFormError('Value must be greater than 0.'); return; }
    setSaving(true);
    setFormError(null);
    try {
      const payload: CouponInput = {
        ...form,
        code: form.code.trim().toUpperCase(),
        validFrom:  form.validFrom  || undefined,
        validUntil: form.validUntil || undefined,
      };
      if (editing) {
        await updateCoupon(editing._id, payload);
      } else {
        await createCoupon(payload);
      }
      setDrawerOpen(false);
      load(1);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: Coupon) => {
    try {
      if (c.isActive) {
        await deactivateCoupon(c._id);
      } else {
        await activateCoupon(c._id);
      }
      load(page);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCoupon(deleteTarget._id);
      setDeleteTarget(null);
      load(1);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const filtered = search
    ? items.filter(c =>
        c.code.toLowerCase().includes(search.toLowerCase()) ||
        (c.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Tag size={18} className="text-brand" />
          <h1 className="text-sm font-bold text-ink">Coupons</h1>
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
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
          >
            <Plus size={13} /> New Coupon
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
            placeholder="Search by code or description…"
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
            <Tag size={28} className="opacity-30" />
            <p>{search ? 'No coupons match your search.' : 'No coupons yet. Create one above.'}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-canvas overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-mist text-left text-xs font-semibold uppercase tracking-wide text-ink/50">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Min Order</th>
                  <th className="px-4 py-3">Used</th>
                  <th className="px-4 py-3">Valid Until</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(c => (
                  <tr key={c._id} className="hover:bg-mist/50">
                    <td className="px-4 py-3">
                      <p className="font-mono font-bold text-ink">{c.code}</p>
                      {c.description && <p className="mt-0.5 text-xs text-ink/50">{c.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-ink/70 capitalize">{c.type}</td>
                    <td className="px-4 py-3 font-semibold text-ink">
                      {c.type === 'percent' ? `${c.value}%` : `₹${c.value}`}
                      {c.maxDiscount ? <span className="ml-1 text-xs text-ink/40">(max ₹{c.maxDiscount})</span> : null}
                    </td>
                    <td className="px-4 py-3 text-ink/70">
                      {c.minOrderValue > 0 ? `₹${c.minOrderValue}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-ink/70">
                      {c.usageCount}
                      {c.usageLimit ? ` / ${c.usageLimit}` : ''}
                    </td>
                    <td className="px-4 py-3 text-ink/70">
                      {c.validUntil ? new Date(c.validUntil).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        c.isActive ? 'bg-brand/10 text-brand' : 'bg-ink/5 text-ink/40'
                      }`}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(c)}
                          title="Edit"
                          className="rounded-lg p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => toggleActive(c)}
                          title={c.isActive ? 'Deactivate' : 'Activate'}
                          className="rounded-lg p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink"
                        >
                          {c.isActive ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} />}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          title="Delete"
                          className="rounded-lg p-1.5 text-ink/40 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
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

      {/* Create / Edit Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => !saving && setDrawerOpen(false)} />
          <div className="flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-bold text-ink">{editing ? 'Edit Coupon' : 'New Coupon'}</h2>
              <button onClick={() => !saving && setDrawerOpen(false)} className="rounded-lg p-1.5 text-ink/40 hover:bg-ink/5">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</div>
              )}

              <Field label="Coupon Code *">
                <input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. WELCOME20"
                  className={inputCls}
                />
              </Field>

              <Field label="Description">
                <input
                  value={form.description ?? ''}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional note for your team"
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Type *">
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as 'percent' | 'flat' }))}
                    className={inputCls}
                  >
                    <option value="percent">Percent (%)</option>
                    <option value="flat">Flat (₹)</option>
                  </select>
                </Field>
                <Field label={form.type === 'percent' ? 'Discount % *' : 'Discount Amount ₹ *'}>
                  <input
                    type="number" min={0}
                    value={form.value || ''}
                    onChange={e => setForm(f => ({ ...f, value: Number(e.target.value) }))}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Min Order Value ₹">
                  <input
                    type="number" min={0}
                    value={form.minOrderValue || ''}
                    onChange={e => setForm(f => ({ ...f, minOrderValue: Number(e.target.value) }))}
                    className={inputCls}
                  />
                </Field>
                {form.type === 'percent' && (
                  <Field label="Max Discount ₹">
                    <input
                      type="number" min={0}
                      value={form.maxDiscount ?? ''}
                      onChange={e => setForm(f => ({ ...f, maxDiscount: e.target.value ? Number(e.target.value) : undefined }))}
                      className={inputCls}
                    />
                  </Field>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Valid From">
                  <input
                    type="date"
                    value={form.validFrom ?? ''}
                    onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Valid Until">
                  <input
                    type="date"
                    value={form.validUntil ?? ''}
                    onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Total Usage Limit">
                  <input
                    type="number" min={1}
                    value={form.usageLimit ?? ''}
                    onChange={e => setForm(f => ({ ...f, usageLimit: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="Unlimited"
                    className={inputCls}
                  />
                </Field>
                <Field label="Per Customer Limit">
                  <input
                    type="number" min={1}
                    value={form.perCustomerLimit ?? ''}
                    onChange={e => setForm(f => ({ ...f, perCustomerLimit: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="Unlimited"
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>

            <div className="shrink-0 border-t border-border px-5 py-4 flex gap-3">
              <button
                onClick={() => setDrawerOpen(false)}
                disabled={saving}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveForm}
                disabled={saving}
                className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Coupon'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-canvas p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-bold text-ink">Delete coupon?</h3>
            <p className="mb-6 text-sm text-ink/60">
              Coupon <span className="font-mono font-bold">{deleteTarget.code}</span> will be permanently deleted.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
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
