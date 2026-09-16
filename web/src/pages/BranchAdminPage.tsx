import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Plus, Building2, MapPin, Phone, CheckCircle2, XCircle, AlertCircle, Pencil, Loader2, X } from 'lucide-react';
import {
  fetchBranches, createBranch, updateBranch, deactivateBranch, reactivateBranch,
  fetchBranchCount,
  type Branch, type CreateBranchPayload, type UpdateBranchPayload,
} from '../api/branches';

// ── Toast helper ─────────────────────────────────────────────────────────────

type ToastMsg = { id: number; type: 'success' | 'error'; text: string };

let toastId = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const add = useCallback((type: 'success' | 'error', text: string) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, type, text }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  return { toasts, add };
}

// ── Shared field helpers ──────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-1.5 text-sm text-gray-500">
      <span className="text-xs text-gray-400">{label}:</span>
      <span className="text-gray-700 dark:text-gray-300">{value}</span>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Branch['status'] }) {
  const map: Record<string, string> = {
    active:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    trial:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    suspended: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    expired:   'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    pending:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    rejected:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${map[status] || map.expired}`}>
      {status}
    </span>
  );
}

// ── Create modal ──────────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose(): void;
  onCreated(): void;
  onToast(type: 'success' | 'error', text: string): void;
  remaining: number;
  max: number;
}

function CreateModal({ onClose, onCreated, onToast, remaining, max }: CreateModalProps) {
  const [form, setForm] = useState<CreateBranchPayload>({
    branchName: '', adminId: '', adminPassword: '',
    branchCode: '', address: '', phone: '', city: '', state: '', pincode: '', gstNumber: '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof CreateBranchPayload) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.branchName.trim())  errs.branchName    = 'Branch name is required';
    if (!form.adminId.trim())     errs.adminId        = 'Admin ID is required';
    if (form.adminPassword.length < 6) errs.adminPassword = 'Password must be at least 6 characters';
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      await createBranch(form);
      onToast('success', `Branch "${form.branchName}" created successfully`);
      onCreated();
      onClose();
    } catch (err: any) {
      onToast('error', err?.message || 'Failed to create branch');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">Create Branch</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[70vh] px-5 py-4 space-y-3">
          {remaining <= 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle size={14} />
              Branch limit reached ({max}/{max}). Contact support to increase.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Branch Name *</label>
              <input className={inputCls} placeholder="e.g. North Branch" value={form.branchName} onChange={set('branchName')} />
              {errors.branchName && <p className="mt-1 text-xs text-red-500">{errors.branchName}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Branch Code</label>
              <input className={inputCls} placeholder="e.g. NORTH" value={form.branchCode} onChange={set('branchCode')} />
              <p className="mt-0.5 text-[10px] text-gray-400">Short code, unique in your org</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Phone</label>
              <input className={inputCls} placeholder="10-digit mobile" value={form.phone} onChange={set('phone')} />
            </div>
          </div>

          <hr className="border-gray-100 dark:border-gray-800" />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Branch Admin Credentials</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Admin ID *</label>
              <input className={inputCls} placeholder="Unique login ID" value={form.adminId} onChange={set('adminId')} />
              {errors.adminId && <p className="mt-1 text-xs text-red-500">{errors.adminId}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Admin Password *</label>
              <input type="password" className={inputCls} placeholder="Min. 6 characters" value={form.adminPassword} onChange={set('adminPassword')} />
              {errors.adminPassword && <p className="mt-1 text-xs text-red-500">{errors.adminPassword}</p>}
            </div>
          </div>

          <hr className="border-gray-100 dark:border-gray-800" />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Location (optional)</p>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Address</label>
            <input className={inputCls} placeholder="Street address" value={form.address} onChange={set('address')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">City</label>
              <input className={inputCls} value={form.city} onChange={set('city')} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">State</label>
              <input className={inputCls} value={form.state} onChange={set('state')} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Pincode</label>
              <input className={inputCls} value={form.pincode} onChange={set('pincode')} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">GSTIN</label>
            <input className={inputCls} placeholder="15-character GSTIN" value={form.gstNumber} onChange={set('gstNumber')} />
          </div>
        </form>

        <div className="flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button
            type="submit"
            form=""
            onClick={handleSubmit as any}
            disabled={saving || remaining <= 0}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            Create Branch
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Branch card ───────────────────────────────────────────────────────────────

interface BranchCardProps {
  branch: Branch;
  onRefresh(): void;
  onToast(type: 'success' | 'error', text: string): void;
}

function BranchCard({ branch, onRefresh, onToast }: BranchCardProps) {
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateBranchPayload>({
    branchName: branch.branchName || branch.hotelName,
    address: branch.address, phone: branch.phone,
    city: branch.city, state: branch.state, pincode: branch.pincode, gstNumber: branch.gstNumber,
  });

  const action = async (fn: () => Promise<unknown>, successMsg: string) => {
    setWorking(true);
    try { await fn(); onToast('success', successMsg); onRefresh(); }
    catch (e: any) { onToast('error', e?.message || 'Action failed'); }
    finally { setWorking(false); }
  };

  const handleSave = async () => {
    await action(() => updateBranch(branch._id, editForm), 'Branch updated');
    setEditing(false);
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="shrink-0 text-gray-400" />
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {branch.branchName || branch.hotelName}
            </h3>
            {branch.branchCode && (
              <span className="text-[10px] font-mono uppercase text-gray-400">{branch.branchCode}</span>
            )}
          </div>
        </div>
        <StatusBadge status={branch.status} />
      </div>

      {!editing ? (
        <div className="space-y-1 text-sm">
          <Field label="Address" value={[branch.address, branch.city, branch.state, branch.pincode].filter(Boolean).join(', ')} />
          <Field label="Phone" value={branch.phone} />
          <Field label="GSTIN" value={branch.gstNumber} />
          <p className="mt-2 text-[10px] text-gray-400">
            Created {new Date(branch.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {[
            { k: 'branchName', label: 'Branch Name' },
            { k: 'phone',      label: 'Phone' },
            { k: 'address',    label: 'Address' },
            { k: 'city',       label: 'City' },
            { k: 'state',      label: 'State' },
            { k: 'pincode',    label: 'Pincode' },
            { k: 'gstNumber',  label: 'GSTIN' },
          ].map(({ k, label }) => (
            <div key={k}>
              <label className="mb-0.5 block text-[10px] font-medium text-gray-500">{label}</label>
              <input
                className={inputCls}
                value={(editForm as any)[k] || ''}
                onChange={e => setEditForm(prev => ({ ...prev, [k]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!editing ? (
          <>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <Pencil size={11} /> Edit
            </button>
            {branch.status === 'active' || branch.status === 'trial' ? (
              <button
                disabled={working}
                onClick={() => action(() => deactivateBranch(branch._id), 'Branch deactivated')}
                className="flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-800/50 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                <XCircle size={11} /> Deactivate
              </button>
            ) : branch.status === 'suspended' ? (
              <button
                disabled={working}
                onClick={() => action(() => reactivateBranch(branch._id), 'Branch reactivated')}
                className="flex items-center gap-1 rounded-lg border border-green-200 dark:border-green-800/50 px-3 py-1.5 text-xs text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
              >
                <CheckCircle2 size={11} /> Reactivate
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              disabled={working}
              onClick={handleSave}
              className="flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {working && <Loader2 size={11} className="animate-spin" />}
              Save
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BranchAdminPage() {
  const { toasts, add: addToast } = useToast();
  const [branches, setBranches]   = useState<Branch[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [maxBranches, setMaxBranches] = useState(1);
  const [multiBranchEnabled, setMultiBranchEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, count] = await Promise.all([fetchBranches(), fetchBranchCount()]);
      setBranches(list.branches);
      setMaxBranches(count.maxBranches);
      setMultiBranchEnabled(count.multiBranchEnabled);
    } catch {
      addToast('error', 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const remaining = maxBranches - branches.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Toast */}
      <div className="fixed right-4 top-4 z-50 space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${t.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
            {t.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {t.text}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 size={20} /> Branch Management
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {branches.length} of {maxBranches} branch{maxBranches !== 1 ? 'es' : ''} used
          </p>
        </div>
        {multiBranchEnabled && (
          <button
            onClick={() => setShowCreate(true)}
            disabled={remaining <= 0}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={14} /> Add Branch
          </button>
        )}
      </div>

      {/* Feature not enabled */}
      {!loading && !multiBranchEnabled && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
          <GitBranch size={32} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <h3 className="font-semibold text-gray-700 dark:text-gray-300">Multi-Branch not enabled</h3>
          <p className="mt-1 text-sm text-gray-500">Contact support to upgrade your plan and enable multi-branch management.</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {/* Branch grid */}
      {!loading && multiBranchEnabled && (
        <>
          {branches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
              <GitBranch size={32} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">No branches yet</h3>
              <p className="mt-1 text-sm text-gray-500">Add your first branch to get started.</p>
              <button
                onClick={() => setShowCreate(true)}
                disabled={remaining <= 0}
                className="mt-4 flex items-center gap-1.5 mx-auto rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
              >
                <Plus size={14} /> Add Branch
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {branches.map(branch => (
                <BranchCard key={branch._id} branch={branch} onRefresh={load} onToast={addToast} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
          onToast={addToast}
          remaining={remaining}
          max={maxBranches}
        />
      )}
    </div>
  );
}
