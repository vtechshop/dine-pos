import { useState, useEffect, useCallback } from 'react';
import {
  User, Building2, Users, Printer, Heart, Flag, Shield,
  Plus, Pencil, Trash2, RefreshCw, LogOut, Wifi, WifiOff, Check,
  type LucideIcon,
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { updateSettings, fetchSubscription } from '../api/settings';
import type { SubscriptionInfo } from '../api/settings';
import {
  fetchCashiers, toggleCashier, deleteCashier,
  fetchWaiters, toggleWaiter, deleteWaiter,
} from '../api/staff';
import type { StaffMember } from '../api/staff';
import { fetchSessionDevices, logoutDevice, logoutAllDevices } from '../api/devices';
import type { SessionDevice } from '../api/devices';
import { fetchPrinterDevices } from '../api/dashboard';
import { StaffDrawer } from '../components/settings/StaffDrawer';
import type { Settings, PrinterDeviceStatus, LoyaltySettings } from '../types';

// ── Shared UI helpers ─────────────────────────────────────────────────────────

const inp =
  'h-9 w-full rounded-lg border border-[#E8D5C0] bg-white px-3 text-sm text-[#1C0800] outline-none focus:border-[#E8380D]/50 focus:ring-1 focus:ring-[#E8380D]/20';

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#1C0800]/40">
        {label}
      </label>
      {children}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#E8D5C0] bg-white p-6">
      <h3 className="mb-5 text-sm font-semibold text-[#1C0800]">{title}</h3>
      {children}
    </div>
  );
}

function SaveRow({ onSave, saving, msg }: { onSave: () => void; saving: boolean; msg: string | null }) {
  const isOk = msg?.startsWith('Saved');
  return (
    <div className="mt-5 flex items-center justify-between border-t border-[#E8D5C0] pt-5">
      <p className={`text-xs font-medium ${isOk ? 'text-green-600' : msg ? 'text-red-500' : 'opacity-0'}`}>
        {msg ?? '-'}
      </p>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-1.5 rounded-lg bg-[#E8380D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#E8380D]/90 disabled:opacity-40"
      >
        {saving ? 'Saving…' : isOk ? <><Check size={12} /> Saved</> : 'Save Changes'}
      </button>
    </div>
  );
}

// ── useSave — shared save + feedback logic ─────────────────────────────────────

function useSave(refresh: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = useCallback(
    async (data: Partial<Settings> & { kitchenPin?: string }) => {
      setSaving(true);
      setMsg(null);
      try {
        await updateSettings(data);
        await refresh();
        setMsg('Saved ✓');
        setTimeout(() => setMsg(null), 2500);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  return { save, saving, msg };
}

// ── ProfileSection ────────────────────────────────────────────────────────────

type ProfileDraft = {
  hotelName: string;
  ownerName: string;
  businessType: Settings['businessType'];
  phone: string;
  email: string;
  address: string;
  upiId: string;
  defaultTaxPercent: number;
  currencySymbol: string;
  footerText: string;
  qrGuestTimeoutMinutes: number;
  roleImageAdmin: string;
};

function toProfileDraft(s: Settings): ProfileDraft {
  return {
    hotelName: s.hotelName ?? '',
    ownerName: s.ownerName ?? '',
    businessType: s.businessType,
    phone: s.phone ?? '',
    email: s.email ?? '',
    address: s.address ?? '',
    upiId: s.upiId ?? '',
    defaultTaxPercent: s.defaultTaxPercent ?? 5,
    currencySymbol: s.currencySymbol ?? '₹',
    footerText: s.footerText ?? '',
    qrGuestTimeoutMinutes: s.qrGuestTimeoutMinutes ?? 15,
    roleImageAdmin: s.roleImageAdmin ?? '',
  };
}

function ProfileSection({ settings, refresh }: { settings: Settings; refresh: () => Promise<void> }) {
  const [d, setD] = useState<ProfileDraft>(toProfileDraft(settings));
  const { save, saving, msg } = useSave(refresh);

  useEffect(() => setD(toProfileDraft(settings)), [settings]);

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => setD(p => ({ ...p, roleImageAdmin: reader.result as string }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-5">
      <SectionCard title="Hotel Identity">
        <div className="grid grid-cols-2 gap-4">
          <F label="Hotel Name *">
            <input value={d.hotelName} onChange={e => setD(p => ({ ...p, hotelName: e.target.value }))} className={inp} />
          </F>
          <F label="Owner Name">
            <input value={d.ownerName} onChange={e => setD(p => ({ ...p, ownerName: e.target.value }))} className={inp} />
          </F>
          <F label="Business Type">
            <select
              value={d.businessType ?? ''}
              onChange={e => setD(p => ({ ...p, businessType: (e.target.value || undefined) as Settings['businessType'] }))}
              className={inp}
            >
              <option value="">Select…</option>
              <option value="veg">Vegetarian Only</option>
              <option value="non-veg">Non-Vegetarian</option>
              <option value="both">Veg &amp; Non-Veg</option>
            </select>
          </F>
          <F label="Currency Symbol">
            <input value={d.currencySymbol} onChange={e => setD(p => ({ ...p, currencySymbol: e.target.value }))} maxLength={3} className={inp} />
          </F>
          <F label="Default Tax %">
            <input type="number" min={0} max={28} step={0.5} value={d.defaultTaxPercent} onChange={e => setD(p => ({ ...p, defaultTaxPercent: Number(e.target.value) }))} className={inp} />
          </F>
          <F label="QR Session Timeout (min)">
            <input type="number" min={1} max={180} value={d.qrGuestTimeoutMinutes} onChange={e => setD(p => ({ ...p, qrGuestTimeoutMinutes: Number(e.target.value) }))} className={inp} />
          </F>
        </div>
      </SectionCard>

      <SectionCard title="Contact">
        <div className="grid grid-cols-2 gap-4">
          <F label="Phone">
            <input type="tel" value={d.phone} onChange={e => setD(p => ({ ...p, phone: e.target.value }))} className={inp} />
          </F>
          <F label="Email">
            <input type="email" value={d.email} onChange={e => setD(p => ({ ...p, email: e.target.value }))} className={inp} />
          </F>
          <F label="UPI ID">
            <input value={d.upiId} onChange={e => setD(p => ({ ...p, upiId: e.target.value }))} placeholder="hotel@upi" className={inp} />
          </F>
        </div>
        <div className="mt-4">
          <F label="Address">
            <textarea
              value={d.address}
              onChange={e => setD(p => ({ ...p, address: e.target.value }))}
              rows={3}
              className="w-full resize-none rounded-lg border border-[#E8D5C0] bg-white px-3 py-2 text-sm text-[#1C0800] outline-none focus:border-[#E8380D]/50 focus:ring-1 focus:ring-[#E8380D]/20"
            />
          </F>
        </div>
        <div className="mt-4">
          <F label="Receipt Footer Text">
            <input value={d.footerText} onChange={e => setD(p => ({ ...p, footerText: e.target.value }))} placeholder="Thank you for dining with us!" className={inp} />
          </F>
        </div>
      </SectionCard>

      <SectionCard title="Hotel Logo">
        <div className="flex items-center gap-5">
          {d.roleImageAdmin ? (
            <img src={d.roleImageAdmin} alt="Hotel logo" className="h-16 w-16 rounded-xl border border-[#E8D5C0] object-contain" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-dashed border-[#E8D5C0] text-[#1C0800]/20">
              <Building2 size={24} />
            </div>
          )}
          <div>
            <label className="cursor-pointer rounded-lg border border-[#E8D5C0] bg-white px-3 py-2 text-xs text-[#1C0800]/60 hover:bg-[#1C0800]/5">
              Choose Image
              <input type="file" accept="image/*" className="hidden" onChange={handleLogo} />
            </label>
            <p className="mt-1.5 text-[10px] text-[#1C0800]/30">PNG or JPG · Max 256 KB</p>
            {d.roleImageAdmin && (
              <button
                onClick={() => setD(p => ({ ...p, roleImageAdmin: '' }))}
                className="mt-1 text-[10px] text-red-400 hover:text-red-500"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </SectionCard>

      <SaveRow onSave={() => void save(d)} saving={saving} msg={msg} />
    </div>
  );
}

// ── LegalSection ──────────────────────────────────────────────────────────────

type LegalDraft = {
  gstNumber: string;
  fssaiNumber: string;
  panNumber: string;
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankIfscCode: string;
};

function toLegalDraft(s: Settings): LegalDraft {
  return {
    gstNumber: s.gstNumber ?? '',
    fssaiNumber: s.fssaiNumber ?? '',
    panNumber: s.panNumber ?? '',
    bankName: s.bankName ?? '',
    bankAccountHolder: s.bankAccountHolder ?? '',
    bankAccountNumber: s.bankAccountNumber ?? '',
    bankIfscCode: s.bankIfscCode ?? '',
  };
}

function LegalSection({ settings, refresh }: { settings: Settings; refresh: () => Promise<void> }) {
  const [d, setD] = useState<LegalDraft>(toLegalDraft(settings));
  const { save, saving, msg } = useSave(refresh);
  useEffect(() => setD(toLegalDraft(settings)), [settings]);

  return (
    <div className="space-y-5">
      <SectionCard title="Tax & Compliance">
        <div className="grid grid-cols-2 gap-4">
          <F label="GST Number">
            <input value={d.gstNumber} onChange={e => setD(p => ({ ...p, gstNumber: e.target.value.toUpperCase() }))} placeholder="27AABCU9603R1ZX" className={`${inp} font-mono`} />
          </F>
          <F label="FSSAI License No.">
            <input value={d.fssaiNumber} onChange={e => setD(p => ({ ...p, fssaiNumber: e.target.value }))} placeholder="10022021000123" className={`${inp} font-mono`} />
          </F>
          <div className="col-span-1">
            <F label="PAN Number">
              <input value={d.panNumber} onChange={e => setD(p => ({ ...p, panNumber: e.target.value.toUpperCase() }))} placeholder="AABCU9603R" className={`${inp} font-mono`} />
            </F>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Bank Details">
        <div className="grid grid-cols-2 gap-4">
          <F label="Bank Name">
            <input value={d.bankName} onChange={e => setD(p => ({ ...p, bankName: e.target.value }))} placeholder="HDFC Bank" className={inp} />
          </F>
          <F label="Account Holder Name">
            <input value={d.bankAccountHolder} onChange={e => setD(p => ({ ...p, bankAccountHolder: e.target.value }))} className={inp} />
          </F>
          <F label="Account Number">
            <input value={d.bankAccountNumber} onChange={e => setD(p => ({ ...p, bankAccountNumber: e.target.value }))} className={`${inp} font-mono`} />
          </F>
          <F label="IFSC Code">
            <input value={d.bankIfscCode} onChange={e => setD(p => ({ ...p, bankIfscCode: e.target.value.toUpperCase() }))} placeholder="HDFC0001234" className={`${inp} font-mono`} />
          </F>
        </div>
      </SectionCard>

      <SaveRow onSave={() => void save(d)} saving={saving} msg={msg} />
    </div>
  );
}

// ── StaffTable (extracted to top level to avoid component-during-render) ──────

interface StaffTableProps {
  members: StaffMember[];
  role: 'cashier' | 'waiter';
  confirmDelId: string | null;
  onAdd: () => void;
  onEdit: (m: StaffMember) => void;
  onToggle: (id: string) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}

function StaffTable({ members, role, confirmDelId, onAdd, onEdit, onToggle, onDeleteRequest, onDeleteConfirm, onDeleteCancel }: StaffTableProps) {
  return (
    <div className="rounded-xl border border-[#E8D5C0] bg-white">
      <div className="flex items-center justify-between border-b border-[#E8D5C0] px-4 py-3">
        <h4 className="text-xs font-semibold text-[#1C0800]">
          {role === 'cashier' ? 'Cashiers' : 'Waiters'}
          <span className="ml-2 rounded-full bg-[#E8D5C0]/60 px-1.5 py-0.5 text-[10px] text-[#1C0800]/50">
            {members.length}
          </span>
        </h4>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 rounded-lg bg-[#E8380D]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#E8380D] hover:bg-[#E8380D]/20"
        >
          <Plus size={12} /> Add {role === 'cashier' ? 'Cashier' : 'Waiter'}
        </button>
      </div>
      {members.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-[#1C0800]/30">No {role}s added yet.</p>
      ) : (
        <div className="divide-y divide-[#E8D5C0]/60">
          {members.map(m => (
            <div key={m._id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-14 shrink-0 rounded-md bg-[#1C0800]/5 px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-[#1C0800]/60">
                {m.employeeCode}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#1C0800]">{m.name}</p>
                {m.mobile && <p className="text-[10px] text-[#1C0800]/40">{m.mobile}</p>}
              </div>
              <button
                onClick={() => onToggle(m._id)}
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  m.isActive
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-red-100 text-red-600 hover:bg-red-200'
                }`}
              >
                {m.isActive ? 'Active' : 'Inactive'}
              </button>
              {confirmDelId === m._id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-[10px] text-red-500">Delete?</span>
                  <button onClick={onDeleteConfirm} className="rounded bg-red-500 px-2 py-0.5 text-[10px] text-white">
                    Yes
                  </button>
                  <button onClick={onDeleteCancel} className="rounded border border-[#E8D5C0] px-2 py-0.5 text-[10px] text-[#1C0800]/50">
                    No
                  </button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => onEdit(m)} className="rounded-lg p-1.5 text-[#1C0800]/40 hover:bg-[#1C0800]/5">
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => onDeleteRequest(m._id)} className="rounded-lg p-1.5 text-red-400 hover:bg-red-50">
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── StaffSection ──────────────────────────────────────────────────────────────

function StaffSection() {
  const [cashiers, setCashiers] = useState<StaffMember[]>([]);
  const [waiters, setWaiters] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ role: 'cashier' | 'waiter'; staff: StaffMember | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ role: 'cashier' | 'waiter'; id: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, w] = await Promise.all([fetchCashiers(), fetchWaiters()]);
      setCashiers(c);
      setWaiters(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (role: 'cashier' | 'waiter', id: string) => {
    setError(null);
    try {
      const res = role === 'cashier' ? await toggleCashier(id) : await toggleWaiter(id);
      const setter = role === 'cashier' ? setCashiers : setWaiters;
      setter(prev => prev.map(m => (m._id === id ? { ...m, isActive: res.isActive } : m)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle staff status');
    }
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    setError(null);
    try {
      if (confirmDel.role === 'cashier') {
        await deleteCashier(confirmDel.id);
        setCashiers(prev => prev.filter(m => m._id !== confirmDel.id));
      } else {
        await deleteWaiter(confirmDel.id);
        setWaiters(prev => prev.filter(m => m._id !== confirmDel.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete staff member');
    }
    setConfirmDel(null);
  };

  const handleSave = (saved: StaffMember, role: 'cashier' | 'waiter') => {
    const setter = role === 'cashier' ? setCashiers : setWaiters;
    setter(prev => {
      const idx = prev.findIndex(m => m._id === saved._id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setDrawer(null);
  };

  if (loading) {
    return <div className="flex h-40 items-center justify-center text-sm text-[#1C0800]/30">Loading staff…</div>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-[#E8380D]/20 bg-[#E8380D]/10 px-4 py-2.5 text-xs text-[#E8380D]">
          {error}
        </div>
      )}
      <StaffTable
        members={cashiers}
        role="cashier"
        confirmDelId={confirmDel?.role === 'cashier' ? confirmDel.id : null}
        onAdd={() => setDrawer({ role: 'cashier', staff: null })}
        onEdit={m => setDrawer({ role: 'cashier', staff: m })}
        onToggle={id => void handleToggle('cashier', id)}
        onDeleteRequest={id => setConfirmDel({ role: 'cashier', id })}
        onDeleteConfirm={() => void handleDelete()}
        onDeleteCancel={() => setConfirmDel(null)}
      />
      <StaffTable
        members={waiters}
        role="waiter"
        confirmDelId={confirmDel?.role === 'waiter' ? confirmDel.id : null}
        onAdd={() => setDrawer({ role: 'waiter', staff: null })}
        onEdit={m => setDrawer({ role: 'waiter', staff: m })}
        onToggle={id => void handleToggle('waiter', id)}
        onDeleteRequest={id => setConfirmDel({ role: 'waiter', id })}
        onDeleteConfirm={() => void handleDelete()}
        onDeleteCancel={() => setConfirmDel(null)}
      />
      {drawer && (
        <StaffDrawer
          role={drawer.role}
          staff={drawer.staff}
          onSave={saved => handleSave(saved, drawer.role)}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

// ── PrintersSection ───────────────────────────────────────────────────────────

type PrinterDraft = {
  printerWidth: '58mm' | '80mm';
  printerMode: 'single' | 'dual';
  cashierPrinterAddress: string;
  kitchenPrinterAddress: string;
  kotAutoPrint: boolean;
};

function toPrinterDraft(s: Settings): PrinterDraft {
  return {
    printerWidth: s.printerWidth ?? '80mm',
    printerMode: s.printerMode ?? 'single',
    cashierPrinterAddress: s.cashierPrinterAddress ?? '',
    kitchenPrinterAddress: s.kitchenPrinterAddress ?? '',
    kotAutoPrint: s.kotAutoPrint ?? true,
  };
}

function PrintersSection({ settings, refresh }: { settings: Settings; refresh: () => Promise<void> }) {
  const [d, setD] = useState<PrinterDraft>(toPrinterDraft(settings));
  const { save, saving, msg } = useSave(refresh);
  const [kitchenPin, setKitchenPin] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [devices, setDevices] = useState<PrinterDeviceStatus[]>([]);

  useEffect(() => setD(toPrinterDraft(settings)), [settings]);

  useEffect(() => {
    fetchPrinterDevices()
      .then(setDevices)
      .catch(() => {});
  }, []);

  const handlePinSave = async () => {
    if (!/^\d{4,6}$/.test(kitchenPin)) {
      setPinMsg('Must be 4–6 digits');
      return;
    }
    setPinSaving(true);
    setPinMsg(null);
    try {
      await updateSettings({ kitchenPin });
      setKitchenPin('');
      setPinMsg('Saved ✓');
      setTimeout(() => setPinMsg(null), 2500);
    } catch (e) {
      setPinMsg(e instanceof Error ? e.message : 'Failed');
    } finally {
      setPinSaving(false);
    }
  };

  const modeBtn = (field: 'printerWidth' | 'printerMode', val: string, label: string) => {
    const current = d[field];
    return (
      <button
        onClick={() => setD(p => ({ ...p, [field]: val }))}
        className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
          current === val ? 'bg-[#E8380D] text-white' : 'text-[#1C0800]/50 hover:bg-[#1C0800]/5'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <SectionCard title="Printer Configuration">
        <div className="grid grid-cols-2 gap-4">
          <F label="Paper Width">
            <div className="flex rounded-lg border border-[#E8D5C0] p-0.5">
              {modeBtn('printerWidth', '58mm', '58 mm')}
              {modeBtn('printerWidth', '80mm', '80 mm')}
            </div>
          </F>
          <F label="Printer Mode">
            <div className="flex rounded-lg border border-[#E8D5C0] p-0.5">
              {modeBtn('printerMode', 'single', 'Single')}
              {modeBtn('printerMode', 'dual', 'Dual')}
            </div>
          </F>
          <F label="Cashier Printer (BT MAC)">
            <input
              value={d.cashierPrinterAddress}
              onChange={e => setD(p => ({ ...p, cashierPrinterAddress: e.target.value }))}
              placeholder="00:11:22:33:44:55"
              className={`${inp} font-mono`}
            />
          </F>
          <F label="Kitchen Printer (BT MAC)">
            <input
              value={d.kitchenPrinterAddress}
              onChange={e => setD(p => ({ ...p, kitchenPrinterAddress: e.target.value }))}
              placeholder="00:11:22:33:44:55"
              className={`${inp} font-mono`}
            />
          </F>
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={d.kotAutoPrint}
            onChange={e => setD(p => ({ ...p, kotAutoPrint: e.target.checked }))}
            className="h-4 w-4 accent-[#E8380D]"
          />
          <span className="text-xs text-[#1C0800]/70">Auto-print KOT on new order</span>
        </label>
        <SaveRow onSave={() => void save(d)} saving={saving} msg={msg} />
      </SectionCard>

      <SectionCard title="Kitchen Display PIN">
        <p className="mb-4 text-xs text-[#1C0800]/50">
          4–6 digit PIN used to unlock the Kitchen Display screen.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <F label="New PIN">
              <input
                type="password"
                value={kitchenPin}
                onChange={e => setKitchenPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter new PIN"
                autoComplete="new-password"
                className={inp}
              />
            </F>
          </div>
          <div className="flex flex-col items-end gap-1 pb-0.5">
            <button
              onClick={() => void handlePinSave()}
              disabled={pinSaving || !kitchenPin}
              className="rounded-lg bg-[#E8380D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#E8380D]/90 disabled:opacity-40"
            >
              {pinSaving ? 'Saving…' : 'Set PIN'}
            </button>
            {pinMsg && (
              <p className={`text-[10px] font-semibold ${pinMsg.startsWith('Saved') ? 'text-green-600' : 'text-red-500'}`}>
                {pinMsg}
              </p>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Live Printer Status">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-[#1C0800]/50">Registered printer devices and their current connection status.</p>
          <button
            onClick={() => fetchPrinterDevices().then(setDevices).catch(() => {})}
            className="flex items-center gap-1.5 text-[11px] text-[#1C0800]/40 hover:text-[#1C0800]/70"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        {devices.length === 0 ? (
          <p className="py-6 text-center text-xs text-[#1C0800]/30">No printer devices registered yet.</p>
        ) : (
          <div className="space-y-2">
            {devices.map(dev => (
              <div key={dev._id} className="flex items-center gap-4 rounded-lg border border-[#E8D5C0] px-4 py-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dev.online ? 'bg-green-500' : 'bg-red-400'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-[#1C0800]">
                    {dev.printerName ?? dev.deviceId ?? 'Unknown device'}
                  </p>
                  <p className="text-[10px] capitalize text-[#1C0800]/40">{dev.printerRole} printer</p>
                </div>
                {dev.online ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                    <Wifi size={10} /> Online
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                    <WifiOff size={10} /> Offline
                  </span>
                )}
                {dev.lastHeartbeat && (
                  <span className="shrink-0 text-[10px] text-[#1C0800]/30">
                    {new Date(dev.lastHeartbeat).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── LoyaltySection ────────────────────────────────────────────────────────────

const LOYALTY_DEFAULTS: LoyaltySettings = {
  rewardName: 'Points',
  pointsPerHundredRupees: 10,
  minimumRedeemPoints: 50,
  maximumRedeemPercent: 20,
  pointValueInPaisa: 100,
  expiryDays: 365,
  roundingRule: 'floor',
  calculationBase: 'before_gst',
};

function LoyaltySection({ settings, refresh }: { settings: Settings; refresh: () => Promise<void> }) {
  const [d, setD] = useState<LoyaltySettings>({ ...LOYALTY_DEFAULTS, ...(settings.loyaltySettings ?? {}) });
  const { save, saving, msg } = useSave(refresh);

  useEffect(() => setD({ ...LOYALTY_DEFAULTS, ...(settings.loyaltySettings ?? {}) }), [settings]);

  const enabled = settings.features?.loyaltyProgram;

  return (
    <div className="space-y-5">
      {!enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          Loyalty Program is not enabled. Contact your Super Admin to activate it. You can pre-configure settings below.
        </div>
      )}
      <SectionCard title="Loyalty Program Settings">
        <div className="grid grid-cols-2 gap-4">
          <F label="Reward Name">
            <input value={d.rewardName} onChange={e => setD(p => ({ ...p, rewardName: e.target.value }))} placeholder="Points" className={inp} />
          </F>
          <F label="Points per ₹100 Spent">
            <input type="number" min={1} value={d.pointsPerHundredRupees} onChange={e => setD(p => ({ ...p, pointsPerHundredRupees: Number(e.target.value) }))} className={inp} />
          </F>
          <F label="Minimum Redeem Points">
            <input type="number" min={0} value={d.minimumRedeemPoints} onChange={e => setD(p => ({ ...p, minimumRedeemPoints: Number(e.target.value) }))} className={inp} />
          </F>
          <F label="Max Redeem % of Bill">
            <input type="number" min={0} max={100} value={d.maximumRedeemPercent} onChange={e => setD(p => ({ ...p, maximumRedeemPercent: Number(e.target.value) }))} className={inp} />
          </F>
          <F label="Point Value (paise per point)">
            <input type="number" min={1} value={d.pointValueInPaisa} onChange={e => setD(p => ({ ...p, pointValueInPaisa: Number(e.target.value) }))} className={inp} />
          </F>
          <F label="Expiry Days (0 = never expire)">
            <input type="number" min={0} value={d.expiryDays} onChange={e => setD(p => ({ ...p, expiryDays: Number(e.target.value) }))} className={inp} />
          </F>
          <F label="Rounding Rule">
            <select value={d.roundingRule} onChange={e => setD(p => ({ ...p, roundingRule: e.target.value as LoyaltySettings['roundingRule'] }))} className={inp}>
              <option value="floor">Floor (round down)</option>
              <option value="round">Round (nearest)</option>
              <option value="ceil">Ceil (round up)</option>
            </select>
          </F>
          <F label="Points Calculated On">
            <select value={d.calculationBase} onChange={e => setD(p => ({ ...p, calculationBase: e.target.value as LoyaltySettings['calculationBase'] }))} className={inp}>
              <option value="before_gst">Bill before GST</option>
              <option value="after_gst">Bill after GST</option>
            </select>
          </F>
        </div>
        <SaveRow onSave={() => void save({ loyaltySettings: d })} saving={saving} msg={msg} />
      </SectionCard>
    </div>
  );
}

// ── FeaturesSection ───────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  payment: 'Payment Processing',
  reservations: 'Reservations',
  customerChat: 'Customer Chat',
  qrOrdering: 'QR Ordering',
  expenses: 'Expenses Tracking',
  reports: 'Reports & Analytics',
  tables: 'Table Management',
  ingredients: 'Ingredients',
  waste: 'Waste Tracking',
  aggregator: 'Aggregator Integration',
  tableSessions: 'Table Sessions',
  customerIdentification: 'Customer Identification',
  customerDatabase: 'Customer Database',
  loyaltyProgram: 'Loyalty Program',
  birthdayOffers: 'Birthday Offers',
  whatsappNotifications: 'WhatsApp Alerts',
  smsNotifications: 'SMS Alerts',
  digitalReceipts: 'Digital Receipts',
  customerOrderHistory: 'Order History',
  marketingCampaigns: 'Marketing Campaigns',
};

const PLAN_LABELS: Record<string, string> = {
  trial: 'Free Trial',
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

function FeaturesSection({ settings }: { settings: Settings }) {
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);

  useEffect(() => {
    fetchSubscription().then(setSub).catch(() => {});
  }, []);

  const flags = settings.features;

  return (
    <div className="space-y-5">
      <SectionCard title="Subscription">
        {sub ? (
          <div className="flex items-start gap-6">
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#1C0800]/40">Current Plan</p>
              <p className="mt-1 text-xl font-bold text-[#1C0800]">
                {PLAN_LABELS[sub.subscriptionType] ?? sub.subscriptionType}
              </p>
              <p className={`mt-1 text-xs font-semibold ${sub.isExpired ? 'text-red-500' : 'text-green-600'}`}>
                {sub.isExpired ? 'Subscription expired' : `${sub.daysRemaining} days remaining`}
              </p>
            </div>
            {(sub.trialEndDate ?? sub.subscriptionEndDate) && (
              <div className="text-right">
                <p className="text-[10px] text-[#1C0800]/40">{sub.trialEndDate ? 'Trial ends' : 'Renews'}</p>
                <p className="mt-0.5 text-sm font-semibold text-[#1C0800]">
                  {new Date((sub.trialEndDate ?? sub.subscriptionEndDate) as string).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-[#1C0800]/30">Loading subscription…</p>
        )}
      </SectionCard>

      <SectionCard title="Feature Flags">
        <p className="mb-4 text-xs text-[#1C0800]/40">
          These features are enabled or disabled by the Super Admin. Contact support to request changes.
        </p>
        {flags ? (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(FEATURE_LABELS).map(([key, label]) => {
              const raw = (flags as Record<string, unknown>)[key];
              const isEnum = key === 'customerIdentification';
              const enabled = typeof raw === 'boolean' ? raw : (raw !== undefined && raw !== 'disabled');
              return (
                <div key={key} className="flex items-center gap-2.5 rounded-lg border border-[#E8D5C0] px-3 py-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${enabled ? 'bg-green-500' : 'bg-[#1C0800]/15'}`} />
                  <span className="min-w-0 flex-1 truncate text-xs text-[#1C0800]/70">{label}</span>
                  {isEnum && raw ? (
                    <span className="shrink-0 font-mono text-[9px] text-[#1C0800]/40">{String(raw)}</span>
                  ) : (
                    <span className={`shrink-0 text-[10px] font-bold ${enabled ? 'text-green-600' : 'text-[#1C0800]/25'}`}>
                      {enabled ? 'ON' : 'OFF'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg bg-[#1C0800]/[0.03] py-8 text-center">
            <p className="text-xs text-[#1C0800]/40">
              Feature flag details are managed by the Super Admin<br />and are not exposed in this panel.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── SecuritySection ───────────────────────────────────────────────────────────

function SecuritySection({ settings }: { settings: Settings }) {
  const [devices, setDevices] = useState<SessionDevice[]>([]);
  const [devLoading, setDevLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setDevLoading(true);
    try {
      const d = await fetchSessionDevices();
      setDevices(d);
    } catch {
      setDevices([]);
    } finally {
      setDevLoading(false);
    }
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const handleLogoutOne = async (id: string) => {
    try {
      await logoutDevice(id);
      setDevices(prev => prev.filter(d => d._id !== id));
    } catch {
      setNotice('Failed to log out device. Please try again.');
      setTimeout(() => setNotice(null), 3000);
    }
  };

  const handleLogoutAll = async () => {
    try {
      await logoutAllDevices();
      setDevices([]);
      setNotice('All sessions have been logged out.');
      setTimeout(() => setNotice(null), 4000);
    } catch {
      setNotice('Failed to log out all sessions. Please try again.');
      setTimeout(() => setNotice(null), 3000);
    }
  };

  const handleResetRequest = async () => {
    if (!settings.phone) return;
    try {
      const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5000/api';
      const res = await fetch(`${base}/hotels/reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: settings.phone }),
      });
      if (!res.ok) throw new Error('Failed');
      setNotice('Reset request sent. The Super Admin team will contact you shortly.');
      setTimeout(() => setNotice(null), 6000);
    } catch {
      setNotice('Could not send request. Please try again.');
      setTimeout(() => setNotice(null), 3000);
    }
  };

  const fmtTime = (ts: string | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{notice}</div>
      )}

      <SectionCard title="Active Sessions">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-[#1C0800]/50">Devices connected to this hotel account.</p>
          <div className="flex items-center gap-2">
            <button onClick={() => void loadDevices()} className="flex items-center gap-1.5 text-[11px] text-[#1C0800]/40 hover:text-[#1C0800]/70">
              <RefreshCw size={11} /> Refresh
            </button>
            {devices.length > 0 && (
              <button
                onClick={() => void handleLogoutAll()}
                className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-100"
              >
                <LogOut size={11} /> Logout All
              </button>
            )}
          </div>
        </div>
        {devLoading ? (
          <p className="py-6 text-center text-xs text-[#1C0800]/30">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="py-6 text-center text-xs text-[#1C0800]/30">No active sessions.</p>
        ) : (
          <div className="divide-y divide-[#E8D5C0]/60 rounded-lg border border-[#E8D5C0]">
            {devices.map(dev => (
              <div key={dev._id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-semibold text-[#1C0800]">
                    {dev.deviceId ? (dev.deviceId.length > 16 ? `${dev.deviceId.slice(0, 16)}…` : dev.deviceId) : 'Unknown device'}
                  </p>
                  <p className="text-[10px] text-[#1C0800]/40">Last seen: {fmtTime(dev.lastSeen)}</p>
                </div>
                {dev.online && (
                  <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                    Online
                  </span>
                )}
                <button
                  onClick={() => void handleLogoutOne(dev._id)}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-[11px] text-red-500 hover:bg-red-50"
                >
                  <LogOut size={10} /> Logout
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Admin Password">
        <p className="mb-4 text-xs text-[#1C0800]/60">
          Admin credentials are managed by the Super Admin. To change your password, submit a reset request and the team will assist you.
        </p>
        {settings.phone ? (
          <div className="flex items-center gap-4">
            <div className="flex-1 rounded-lg border border-[#E8D5C0] px-4 py-3">
              <p className="text-[10px] text-[#1C0800]/40">Registered Phone</p>
              <p className="mt-0.5 text-sm font-semibold text-[#1C0800]">{settings.phone}</p>
            </div>
            <button
              onClick={() => void handleResetRequest()}
              className="shrink-0 rounded-lg border border-[#E8D5C0] bg-white px-4 py-2.5 text-xs font-semibold text-[#1C0800]/60 hover:bg-[#1C0800]/5"
            >
              Request Reset
            </button>
          </div>
        ) : (
          <p className="text-xs text-[#1C0800]/40">
            Add a phone number in the Profile tab to enable password reset requests.
          </p>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab configuration ─────────────────────────────────────────────────────────

type Tab = 'profile' | 'legal' | 'staff' | 'printers' | 'loyalty' | 'features' | 'security';

interface TabDef {
  id: Tab;
  label: string;
  Icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: 'profile',  label: 'Profile',   Icon: User },
  { id: 'legal',    label: 'Legal',     Icon: Building2 },
  { id: 'staff',    label: 'Staff',     Icon: Users },
  { id: 'printers', label: 'Printers',  Icon: Printer },
  { id: 'loyalty',  label: 'Loyalty',   Icon: Heart },
  { id: 'features', label: 'Features',  Icon: Flag },
  { id: 'security', label: 'Security',  Icon: Shield },
];

// ── SettingsPage ──────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { settings, loading, refresh } = useSettings();
  const [tab, setTab] = useState<Tab>('profile');

  if (loading || !settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#1C0800]/30">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#FFF6EE]">
      {/* Left nav */}
      <nav className="flex w-44 shrink-0 flex-col border-r border-[#E8D5C0] bg-[#FFF6EE] pt-5">
        <p className="px-4 pb-3 text-[9px] font-bold uppercase tracking-widest text-[#1C0800]/30">
          Settings
        </p>
        <ul className="space-y-0.5 px-2">
          {TABS.map(({ id, label, Icon }) => (
            <li key={id}>
              <button
                onClick={() => setTab(id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors ${
                  tab === id
                    ? 'bg-[#E8380D] text-white'
                    : 'text-[#1C0800]/50 hover:bg-[#1C0800]/5 hover:text-[#1C0800]'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content pane */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          {tab === 'profile'  && <ProfileSection  settings={settings} refresh={refresh} />}
          {tab === 'legal'    && <LegalSection    settings={settings} refresh={refresh} />}
          {tab === 'staff'    && <StaffSection />}
          {tab === 'printers' && <PrintersSection settings={settings} refresh={refresh} />}
          {tab === 'loyalty'  && <LoyaltySection  settings={settings} refresh={refresh} />}
          {tab === 'features' && <FeaturesSection settings={settings} />}
          {tab === 'security' && <SecuritySection settings={settings} />}
        </div>
      </div>
    </div>
  );
}
