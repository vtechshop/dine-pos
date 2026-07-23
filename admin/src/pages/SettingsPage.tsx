import { useEffect, useState, useCallback } from 'react';
import { Settings, Save } from 'lucide-react';
import { SectionHeader, PageLoader, ErrorState, Btn } from '../components/ui';
import { apiFetch } from '../api/client';

interface HotelSettings {
  name?:            string;
  address?:         string;
  phone?:           string;
  gstNumber?:       string;
  currencySymbol?:  string;
  timezone?:        string;
  enableQRMenu?:    boolean;
  enableOnlineOrders?: boolean;
  autoAcceptOnlineOrders?: boolean;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<HotelSettings>({});
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<HotelSettings>('/settings')
      .then(d => { setSettings(d); setLoading(false); })
      .catch(() => { setError('Failed to load settings'); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/settings', { method: 'PATCH', body: JSON.stringify(settings) });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof HotelSettings, label: string, type = 'text') => (
    <div key={key}>
      <label className="block text-xs font-bold text-[#92745E] uppercase tracking-wide mb-1">{label}</label>
      <input
        type={type}
        value={(settings[key] as string | undefined) ?? ''}
        onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
        className="w-full rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm text-[#1C0800] placeholder-[#C4A090] focus:outline-none focus:border-[#E8380D] focus:ring-1 focus:ring-[#E8380D]"
      />
    </div>
  );

  const toggle = (key: keyof HotelSettings, label: string, desc: string) => (
    <div key={key} className="flex items-center justify-between rounded-lg bg-[#FFF6EE] px-4 py-3">
      <div>
        <p className="font-semibold text-sm text-[#1C0800]">{label}</p>
        <p className="text-xs text-[#92745E]">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => setSettings(s => ({ ...s, [key]: !s[key as keyof HotelSettings] }))}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings[key] ? 'bg-[#E8380D]' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${settings[key] ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );

  if (loading) return <PageLoader />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6 max-w-2xl">
      <SectionHeader
        title="Settings"
        sub="Restaurant profile and feature toggles"
        action={
          <Btn variant="primary" onClick={handleSave} loading={saving}>
            <Save size={14} /> {saved ? 'Saved!' : 'Save'}
          </Btn>
        }
      />

      <div className="bg-white rounded-xl border border-[#E8D5C0] p-6 space-y-4">
        <p className="font-bold text-sm text-[#1C0800] flex items-center gap-2"><Settings size={16} className="text-[#E8380D]" /> Restaurant Profile</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('name',           'Restaurant Name')}
          {field('phone',          'Phone Number', 'tel')}
          {field('address',        'Address')}
          {field('gstNumber',      'GST Number')}
          {field('currencySymbol', 'Currency Symbol')}
          {field('timezone',       'Timezone')}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#E8D5C0] p-6 space-y-3">
        <p className="font-bold text-sm text-[#1C0800]">Feature Toggles</p>
        {toggle('enableQRMenu',            'QR Menu',             'Enable customer-facing QR menu')}
        {toggle('enableOnlineOrders',      'Online Orders',       'Accept Swiggy / Zomato orders')}
        {toggle('autoAcceptOnlineOrders',  'Auto-accept Orders',  'Automatically accept incoming delivery orders')}
      </div>
    </div>
  );
}
