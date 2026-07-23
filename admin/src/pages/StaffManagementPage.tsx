import { useEffect, useState, useCallback } from 'react';
import {
  Users, Plus, Search, Key, ToggleLeft, ToggleRight,
  Trash2, Phone, Hash, Calendar, CheckCircle2, XCircle,
} from 'lucide-react';
import {
  SectionHeader, PageLoader, ErrorState, EmptyState, Badge,
  Btn, Modal, Input, Select, ApiRequired,
} from '../components/ui';
import {
  fetchCashiers, fetchWaiters, createCashier, createWaiter,
  updateCashierPin, updateWaiterPin, toggleCashier, toggleWaiter,
  deleteCashier, deleteWaiter,
} from '../api/staff';
import type { StaffMember, StaffInput } from '../api/staff';

const HR_ENDPOINTS = [
  'GET  /staff/:id/attendance       — attendance records per staff',
  'GET  /staff/:id/leave            — leave requests',
  'GET  /staff/:id/shift            — shift schedule',
  'GET  /staff/:id/salary           — salary history',
  'GET  /staff/:id/login-history    — login / logout events',
  'GET  /staff/:id/devices          — trusted device list',
  'POST /staff/:id/reset-password   — admin-initiated password reset',
  'POST /staff/:id/suspend          — suspend account',
  'POST /staff/:id/transfer         — transfer to another branch',
];

type StaffTab = 'cashier' | 'waiter';

interface Combined extends StaffMember { role: StaffTab }

const initForm = (): StaffInput & { role: StaffTab } => ({
  name: '', employeeCode: '', pin: '', mobile: '', role: 'cashier',
});

export default function StaffManagementPage() {
  const [cashiers, setCashiers] = useState<StaffMember[]>([]);
  const [waiters,  setWaiters]  = useState<StaffMember[]>([]);
  const [tab,      setTab]      = useState<StaffTab>('cashier');
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const [showAdd,  setShowAdd]  = useState(false);
  const [form,     setForm]     = useState(initForm());
  const [saving,   setSaving]   = useState(false);
  const [formErr,  setFormErr]  = useState('');

  const [resetId,  setResetId]  = useState<string | null>(null);
  const [newPin,   setNewPin]   = useState('');
  const [pinErr,   setPinErr]   = useState('');
  const [pinSaving,setPinSaving]= useState(false);

  const [selected, setSelected] = useState<Combined | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([fetchCashiers(), fetchWaiters()]).then(([c, w]) => {
      if (c.status === 'fulfilled') setCashiers(c.value);
      if (w.status === 'fulfilled') setWaiters(w.value);
      if (c.status === 'rejected' && w.status === 'rejected') setError('Failed to load staff');
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const list: Combined[] = (tab === 'cashier' ? cashiers : waiters)
    .map(m => ({ ...m, role: tab }))
    .filter(m =>
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.employeeCode.toLowerCase().includes(search.toLowerCase()) ||
      m.mobile.includes(search),
    );

  const handleAdd = async () => {
    if (!form.name.trim() || !form.employeeCode.trim() || !form.pin.trim()) {
      setFormErr('Name, employee code and PIN are required.'); return;
    }
    if (form.pin.length < 4) { setFormErr('PIN must be at least 4 digits.'); return; }
    setSaving(true); setFormErr('');
    try {
      const input: StaffInput = { name: form.name.trim(), employeeCode: form.employeeCode.trim(), pin: form.pin, mobile: form.mobile };
      if (form.role === 'cashier') {
        const created = await createCashier(input);
        setCashiers(prev => [created, ...prev]);
      } else {
        const created = await createWaiter(input);
        setWaiters(prev => [created, ...prev]);
      }
      setShowAdd(false);
      setForm(initForm());
    } catch (e: unknown) {
      setFormErr(e instanceof Error ? e.message : 'Failed to create staff member');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (m: Combined) => {
    try {
      if (m.role === 'cashier') {
        await toggleCashier(m._id);
        setCashiers(prev => prev.map(c => c._id === m._id ? { ...c, isActive: !c.isActive } : c));
      } else {
        await toggleWaiter(m._id);
        setWaiters(prev => prev.map(w => w._id === m._id ? { ...w, isActive: !w.isActive } : w));
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Toggle failed');
    }
  };

  const handleDelete = async (m: Combined) => {
    if (!confirm(`Delete ${m.name}? This cannot be undone.`)) return;
    try {
      if (m.role === 'cashier') {
        await deleteCashier(m._id);
        setCashiers(prev => prev.filter(c => c._id !== m._id));
      } else {
        await deleteWaiter(m._id);
        setWaiters(prev => prev.filter(w => w._id !== m._id));
      }
      if (selected?._id === m._id) setSelected(null);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handlePinReset = async () => {
    if (!resetId) return;
    if (newPin.length < 4) { setPinErr('PIN must be at least 4 digits'); return; }
    setPinSaving(true); setPinErr('');
    try {
      if (tab === 'cashier') await updateCashierPin(resetId, newPin);
      else                   await updateWaiterPin(resetId, newPin);
      setResetId(null); setNewPin('');
    } catch (e: unknown) {
      setPinErr(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setPinSaving(false);
    }
  };

  const exportCSV = () => {
    const rows = list.map(m => [m.name, m.employeeCode, m.mobile, m.role, m.isActive ? 'Active' : 'Inactive', new Date(m.createdAt).toLocaleDateString('en-IN')]);
    const csv  = [['Name','Code','Mobile','Role','Status','Joined'], ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `staff_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  if (loading) return <PageLoader />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Staff Management"
        sub={`${cashiers.length} cashiers · ${waiters.length} waiters`}
        action={
          <div className="flex gap-2">
            <Btn size="sm" onClick={exportCSV}>Export CSV</Btn>
            <Btn variant="primary" size="sm" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add Staff
            </Btn>
          </div>
        }
      />

      {/* HR features banner */}
      <ApiRequired endpoints={HR_ENDPOINTS} />

      {/* Tabs */}
      <div className="flex border-b border-[#E8D5C0]">
        {(['cashier', 'waiter'] as StaffTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-[#E8380D] text-[#E8380D]' : 'border-transparent text-[#92745E] hover:text-[#1C0800]'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}s
            <span className="ml-2 text-xs text-[#92745E]">
              ({t === 'cashier' ? cashiers.length : waiters.length})
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#C4A090]" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, code or phone…"
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#E8D5C0] text-sm text-[#1C0800] placeholder-[#C4A090] focus:outline-none focus:border-[#E8380D] focus:ring-1 focus:ring-[#E8380D] bg-white"
        />
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Users className="h-10 w-10" />} title={`No ${tab}s found`} sub="Add your first team member." />
      ) : (
        <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
                {['Employee', 'Code', 'Mobile', 'Status', 'Joined', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(m => (
                <tr key={m._id} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE] cursor-pointer" onClick={() => setSelected(m)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-[#E8380D] text-white flex items-center justify-center text-xs font-black shrink-0">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-semibold text-[#1C0800]">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[#92745E]">{m.employeeCode}</td>
                  <td className="px-4 py-3 text-[#92745E]">{m.mobile || '—'}</td>
                  <td className="px-4 py-3">
                    {m.isActive
                      ? <span className="flex items-center gap-1 text-green-700 text-xs font-semibold"><CheckCircle2 size={12} /> Active</span>
                      : <span className="flex items-center gap-1 text-gray-400 text-xs font-semibold"><XCircle size={12} /> Inactive</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-[#92745E] text-xs">{new Date(m.createdAt).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <Btn size="sm" title="Reset PIN" onClick={() => { setResetId(m._id); setNewPin(''); setPinErr(''); }}>
                        <Key size={12} />
                      </Btn>
                      <Btn size="sm" onClick={() => handleToggle(m)} title={m.isActive ? 'Disable' : 'Enable'}>
                        {m.isActive ? <ToggleRight size={12} className="text-green-600" /> : <ToggleLeft size={12} className="text-gray-400" />}
                      </Btn>
                      <Btn size="sm" variant="danger" onClick={() => handleDelete(m)} title="Delete">
                        <Trash2 size={12} />
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Staff Profile modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? 'Staff Profile'}>
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-[#E8380D] text-white flex items-center justify-center text-2xl font-black">
                {selected.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xl font-black text-[#1C0800]">{selected.name}</p>
                <Badge label={selected.role.toUpperCase()} variant="blue" />
                <Badge label={selected.isActive ? 'Active' : 'Inactive'} variant={selected.isActive ? 'green' : 'gray'} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-[#FFF6EE] rounded-lg p-3">
                <p className="text-xs text-[#92745E] flex items-center gap-1"><Hash size={10}/> Employee Code</p>
                <p className="font-bold text-[#1C0800] mt-1 font-mono">{selected.employeeCode}</p>
              </div>
              <div className="bg-[#FFF6EE] rounded-lg p-3">
                <p className="text-xs text-[#92745E] flex items-center gap-1"><Phone size={10}/> Mobile</p>
                <p className="font-bold text-[#1C0800] mt-1">{selected.mobile || 'Not set'}</p>
              </div>
              <div className="bg-[#FFF6EE] rounded-lg p-3">
                <p className="text-xs text-[#92745E] flex items-center gap-1"><Calendar size={10}/> Joined</p>
                <p className="font-bold text-[#1C0800] mt-1">{new Date(selected.createdAt).toLocaleDateString('en-IN')}</p>
              </div>
              <div className="bg-[#FFF6EE] rounded-lg p-3">
                <p className="text-xs text-[#92745E]">Last Updated</p>
                <p className="font-bold text-[#1C0800] mt-1">{new Date(selected.updatedAt).toLocaleDateString('en-IN')}</p>
              </div>
            </div>

            {/* HR data — backend required */}
            {[
              { label: 'Attendance', key: 'attendance' },
              { label: 'Leave',      key: 'leave' },
              { label: 'Shift',      key: 'shift' },
              { label: 'Salary',     key: 'salary' },
              { label: 'Login History', key: 'login-history' },
              { label: 'Device History', key: 'devices' },
            ].map(item => (
              <div key={item.key} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                <span className="font-bold">{item.label}:</span>
                {' '}Requires <span className="font-mono">GET /staff/:id/{item.key}</span>
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <Btn size="sm" onClick={() => { setResetId(selected._id); setSelected(null); setNewPin(''); setPinErr(''); }}>
                <Key size={12} /> Reset PIN
              </Btn>
              <Btn size="sm" onClick={() => handleToggle(selected)}>
                {selected.isActive ? <><ToggleRight size={12}/> Disable</> : <><ToggleLeft size={12}/> Enable</>}
              </Btn>
              <Btn size="sm" variant="danger" onClick={() => handleDelete(selected)}>
                <Trash2 size={12} /> Delete
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Add staff modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setForm(initForm()); setFormErr(''); }} title="Add Staff Member">
        <div className="space-y-4">
          {formErr && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{formErr}</div>}
          <Select label="Role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as StaffTab }))}>
            <option value="cashier">Cashier</option>
            <option value="waiter">Waiter</option>
          </Select>
          <Input label="Full Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ravi Kumar" />
          <Input label="Employee Code" value={form.employeeCode} onChange={e => setForm(f => ({ ...f, employeeCode: e.target.value }))} placeholder="EMP001" />
          <Input label="PIN (min 4 digits)" type="password" value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value }))} placeholder="••••" />
          <Input label="Mobile (optional)" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} placeholder="9876543210" />
          <div className="flex justify-end gap-2 mt-2">
            <Btn onClick={() => { setShowAdd(false); setForm(initForm()); setFormErr(''); }}>Cancel</Btn>
            <Btn variant="primary" loading={saving} onClick={handleAdd}>Add Staff</Btn>
          </div>
        </div>
      </Modal>

      {/* PIN reset modal */}
      <Modal open={!!resetId} onClose={() => { setResetId(null); setNewPin(''); setPinErr(''); }} title="Reset PIN">
        <div className="space-y-4">
          {pinErr && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{pinErr}</div>}
          <Input label="New PIN (min 4 digits)" type="password" value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="••••" />
          <div className="flex justify-end gap-2">
            <Btn onClick={() => { setResetId(null); setNewPin(''); setPinErr(''); }}>Cancel</Btn>
            <Btn variant="primary" loading={pinSaving} onClick={handlePinReset}>Reset PIN</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
