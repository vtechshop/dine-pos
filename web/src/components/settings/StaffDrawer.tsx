import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import {
  createCashier, updateCashier, updateCashierPin,
  createWaiter, updateWaiter, updateWaiterPin,
} from '../../api/staff';
import type { StaffMember, StaffInput } from '../../api/staff';

interface Props {
  role: 'cashier' | 'waiter';
  staff: StaffMember | null;
  onSave(staff: StaffMember): void;
  onClose(): void;
}

const inp =
  'h-9 w-full rounded-lg border border-[#E8D5C0] bg-white px-3 text-sm text-[#1C0800] outline-none focus:border-[#E8380D]/50 focus:ring-1 focus:ring-[#E8380D]/20';

export function StaffDrawer({ role, staff, onSave, onClose }: Props) {
  const [name, setName] = useState(staff?.name ?? '');
  const [code, setCode] = useState(staff?.employeeCode ?? '');
  const [pin, setPin] = useState('');
  const [mobile, setMobile] = useState(staff?.mobile ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const isEdit = staff !== null;
  const roleLabel = role === 'cashier' ? 'Cashier' : 'Waiter';

  useEffect(() => { nameRef.current?.focus(); }, []);

  useEffect(() => {
    setName(staff?.name ?? '');
    setCode(staff?.employeeCode ?? '');
    setMobile(staff?.mobile ?? '');
    setPin('');
    setError(null);
  }, [staff]);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!code.trim()) { setError('Employee code is required'); return; }
    if (!isEdit && !pin) { setError('PIN is required for new staff'); return; }
    if (pin && !/^\d{4,6}$/.test(pin)) { setError('PIN must be 4–6 digits'); return; }

    setSaving(true);
    setError(null);
    try {
      let result: StaffMember;
      const data: StaffUpdateInput = {
        name: name.trim(),
        employeeCode: code.trim().toUpperCase(),
        mobile: mobile.trim() || undefined,
      };

      if (isEdit) {
        result = role === 'cashier'
          ? await updateCashier(staff._id, data)
          : await updateWaiter(staff._id, data);
        if (pin) {
          if (role === 'cashier') {
            await updateCashierPin(staff._id, pin);
          } else {
            await updateWaiterPin(staff._id, pin);
          }
        }
      } else {
        const createData: StaffInput = { ...data as Required<typeof data>, pin };
        result = role === 'cashier'
          ? await createCashier(createData)
          : await createWaiter(createData);
      }
      onSave(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <aside className="flex w-80 flex-col bg-[#FFF6EE]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E8D5C0] px-5 py-4">
          <h2 className="text-sm font-semibold text-[#1C0800]">
            {isEdit ? `Edit ${roleLabel}` : `Add ${roleLabel}`}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#1C0800]/40 hover:bg-[#1C0800]/5"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
          )}

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#1C0800]/40">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`${roleLabel} full name`}
              className={inp}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#1C0800]/40">
              Employee Code <span className="text-red-400">*</span>
            </label>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. C001"
              maxLength={10}
              className={`${inp} font-mono`}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#1C0800]/40">
              PIN{!isEdit && <span className="ml-1 text-red-400">*</span>}
              {isEdit && (
                <span className="ml-2 normal-case tracking-normal text-[#1C0800]/30">
                  leave blank to keep existing
                </span>
              )}
            </label>
            <input
              type="password"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="4–6 digit PIN"
              autoComplete="new-password"
              className={inp}
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#1C0800]/40">
              Mobile <span className="text-[#1C0800]/30 normal-case tracking-normal">(optional)</span>
            </label>
            <input
              type="tel"
              value={mobile}
              onChange={e => setMobile(e.target.value)}
              placeholder="+91 98765 43210"
              className={inp}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#E8D5C0] px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#E8D5C0] px-4 py-2 text-xs text-[#1C0800]/60 hover:bg-[#1C0800]/5"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="rounded-lg bg-[#E8380D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#E8380D]/90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : isEdit ? 'Update' : `Add ${roleLabel}`}
          </button>
        </div>
      </aside>
    </div>
  );
}

// Type helper used in handleSubmit above
type StaffUpdateInput = {
  name: string;
  employeeCode: string;
  mobile?: string;
};
