// M11 — Global Aggregator Settings
// Requires: GET /PUT /superadmin/aggregator/settings

import { useEffect, useState, useCallback } from 'react';
import { Save } from 'lucide-react';
import {
  ApiRequired, SAPageHeader, SASpin, SAError,
} from '../../components/ui/SAShared';
import { getAggSettings, updateAggSettings, type AggGlobalSettings } from '../../api/saAggregator';

const SETTINGS_ENDPOINTS = [
  'GET /superadmin/aggregator/settings — fetch global aggregator settings',
  'PUT /superadmin/aggregator/settings — update global aggregator settings',
];

function FieldRow({
  label, help, children,
}: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        {help && <p className="text-xs text-ink/40 mt-0.5">{help}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumInput({
  value, onChange, min, max, unit,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; unit?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number" value={value} min={min} max={max}
        onChange={e => onChange(Number(e.target.value))}
        className="w-24 rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm text-right font-mono text-ink focus:outline-none focus:border-brand/50"
      />
      {unit && <span className="text-xs text-ink/40">{unit}</span>}
    </div>
  );
}

const DEFAULTS: AggGlobalSettings = {
  webhookTimeoutMs:  5000,
  retryCount:        3,
  retryDelayMs:      2000,
  syncIntervalMins:  15,
  queueSizeLimit:    1000,
  swiggyRateLimit:   100,
  zomatoRateLimit:   100,
  maintenanceMode:   false,
};

export function AggregatorSettingsPage() {
  const [settings,  setSettings]  = useState<AggGlobalSettings>(DEFAULTS);
  const [dirty,     setDirty]     = useState<Partial<AggGlobalSettings>>({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [saved,     setSaved]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const s = await getAggSettings();
      setSettings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const merged = { ...settings, ...dirty };

  const update = <K extends keyof AggGlobalSettings>(key: K, value: AggGlobalSettings[K]) => {
    setDirty(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    if (Object.keys(dirty).length === 0) return;
    setSaving(true); setError('');
    try {
      const res = await updateAggSettings(dirty);
      setSettings(res.settings);
      setDirty({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const hasDirty = Object.keys(dirty).length > 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Global Settings"
        sub="Webhook, retry, sync, rate-limit and maintenance settings"
        onRefresh={() => void load()}
        refreshing={loading}
        action={
          hasDirty ? (
            <button
              onClick={() => void save()} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-brand text-canvas px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {saving ? <Save size={14} className="animate-bounce" /> : <Save size={14} />}
              Save Changes
            </button>
          ) : saved ? (
            <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              Saved
            </span>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <ApiRequired endpoints={SETTINGS_ENDPOINTS} />

        {error && <SAError message={error} onRetry={() => void load()} />}
        {loading ? <SASpin /> : (
          <div className="max-w-2xl space-y-6">
            {/* Webhook */}
            <section className="rounded-xl border border-border bg-canvas px-5">
              <p className="py-3 text-xs font-bold uppercase tracking-wide text-ink/40">Webhook</p>
              <FieldRow label="Timeout" help="Max time to wait for a webhook delivery response">
                <NumInput value={merged.webhookTimeoutMs} onChange={v => update('webhookTimeoutMs', v)} min={1000} max={30000} unit="ms" />
              </FieldRow>
              <FieldRow label="Retry Count" help="Number of times to retry a failed webhook">
                <NumInput value={merged.retryCount} onChange={v => update('retryCount', v)} min={0} max={10} />
              </FieldRow>
              <FieldRow label="Retry Delay" help="Delay between webhook retry attempts">
                <NumInput value={merged.retryDelayMs} onChange={v => update('retryDelayMs', v)} min={500} max={60000} unit="ms" />
              </FieldRow>
              <FieldRow label="Queue Size Limit" help="Max items in the webhook retry queue">
                <NumInput value={merged.queueSizeLimit} onChange={v => update('queueSizeLimit', v)} min={100} max={10000} />
              </FieldRow>
            </section>

            {/* Sync */}
            <section className="rounded-xl border border-border bg-canvas px-5">
              <p className="py-3 text-xs font-bold uppercase tracking-wide text-ink/40">Menu Sync</p>
              <FieldRow label="Sync Interval" help="How often to auto-sync menu with aggregator platforms">
                <NumInput value={merged.syncIntervalMins} onChange={v => update('syncIntervalMins', v)} min={5} max={1440} unit="min" />
              </FieldRow>
            </section>

            {/* Rate limits */}
            <section className="rounded-xl border border-border bg-canvas px-5">
              <p className="py-3 text-xs font-bold uppercase tracking-wide text-ink/40">Rate Limits</p>
              <FieldRow label="Swiggy Rate Limit" help="Max API calls per minute to Swiggy">
                <NumInput value={merged.swiggyRateLimit} onChange={v => update('swiggyRateLimit', v)} min={10} max={1000} unit="req/min" />
              </FieldRow>
              <FieldRow label="Zomato Rate Limit" help="Max API calls per minute to Zomato">
                <NumInput value={merged.zomatoRateLimit} onChange={v => update('zomatoRateLimit', v)} min={10} max={1000} unit="req/min" />
              </FieldRow>
            </section>

            {/* Maintenance */}
            <section className="rounded-xl border border-border bg-canvas px-5">
              <p className="py-3 text-xs font-bold uppercase tracking-wide text-ink/40">Maintenance</p>
              <FieldRow label="Maintenance Mode" help="Pause all aggregator processing globally. New orders will not be accepted.">
                <button
                  onClick={() => update('maintenanceMode', !merged.maintenanceMode)}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                    merged.maintenanceMode
                      ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                      : 'border-border bg-canvas text-ink/60 hover:bg-mist'
                  }`}
                >
                  <span className={`h-3 w-3 rounded-full ${merged.maintenanceMode ? 'bg-red-500' : 'bg-gray-300'}`} />
                  {merged.maintenanceMode ? 'ON — Aggregator Paused' : 'OFF — Normal Operation'}
                </button>
              </FieldRow>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
