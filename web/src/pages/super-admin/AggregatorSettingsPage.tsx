// Global Aggregator Settings — read-only view of the server's current values
// Data: GET /superadmin/aggregator/settings (editing is not available in this release)

import { useEffect, useState, useCallback } from 'react';
import { Lock } from 'lucide-react';
import {
  SAPageHeader, SASpin, SAError,
} from '../../components/ui/SAShared';
import { getAggSettings, type AggGlobalSettings } from '../../api/saAggregator';

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

function NumValue({ value, unit }: { value: number; unit?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number" value={value} disabled readOnly
        className="w-24 rounded-lg border border-border bg-mist px-3 py-1.5 text-sm text-right font-mono text-ink/70 cursor-not-allowed"
      />
      {unit && <span className="text-xs text-ink/40">{unit}</span>}
    </div>
  );
}

export function AggregatorSettingsPage() {
  const [settings,  setSettings]  = useState<AggGlobalSettings | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setSettings(await getAggSettings());
    } catch {
      setError("Couldn't load settings. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Global Settings"
        sub="Webhook, retry, sync, rate-limit and maintenance settings"
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {loading ? <SASpin /> : error || !settings ? (
          <SAError message={error || "Couldn't load settings. Please try again."} onRetry={() => void load()} />
        ) : (
          <div className="max-w-2xl space-y-6">
            <p className="flex items-center gap-2 text-xs text-ink/60 bg-mist border border-border rounded-lg px-3 py-2">
              <Lock size={12} className="shrink-0" />
              Read-only — these are the server's current settings.
            </p>

            {/* Webhook */}
            <section className="rounded-xl border border-border bg-canvas px-5">
              <p className="py-3 text-xs font-bold uppercase tracking-wide text-ink/40">Webhook</p>
              <FieldRow label="Timeout" help="Max time to wait for a webhook delivery response">
                <NumValue value={settings.webhookTimeoutMs} unit="ms" />
              </FieldRow>
              <FieldRow label="Retry Count" help="Number of times to retry a failed webhook">
                <NumValue value={settings.retryCount} />
              </FieldRow>
              <FieldRow label="Retry Delay" help="Delay between webhook retry attempts">
                <NumValue value={settings.retryDelayMs} unit="ms" />
              </FieldRow>
              <FieldRow label="Queue Size Limit" help="Max items in the webhook retry queue">
                <NumValue value={settings.queueSizeLimit} />
              </FieldRow>
            </section>

            {/* Sync */}
            <section className="rounded-xl border border-border bg-canvas px-5">
              <p className="py-3 text-xs font-bold uppercase tracking-wide text-ink/40">Menu Sync</p>
              <FieldRow label="Sync Interval" help="How often the menu is synced with Swiggy and Zomato">
                <NumValue value={settings.syncIntervalMins} unit="min" />
              </FieldRow>
            </section>

            {/* Rate limits */}
            <section className="rounded-xl border border-border bg-canvas px-5">
              <p className="py-3 text-xs font-bold uppercase tracking-wide text-ink/40">Rate Limits</p>
              <FieldRow label="Swiggy Rate Limit" help="Max calls per minute to Swiggy">
                <NumValue value={settings.swiggyRateLimit} unit="per min" />
              </FieldRow>
              <FieldRow label="Zomato Rate Limit" help="Max calls per minute to Zomato">
                <NumValue value={settings.zomatoRateLimit} unit="per min" />
              </FieldRow>
            </section>

            {/* Maintenance */}
            <section className="rounded-xl border border-border bg-canvas px-5">
              <p className="py-3 text-xs font-bold uppercase tracking-wide text-ink/40">Maintenance</p>
              <FieldRow label="Maintenance Mode" help="When on, all Swiggy/Zomato processing is paused and new orders are not accepted.">
                <span
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold ${
                    settings.maintenanceMode
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-border bg-mist text-ink/60'
                  }`}
                >
                  <span className={`h-3 w-3 rounded-full ${settings.maintenanceMode ? 'bg-red-500' : 'bg-gray-300'}`} />
                  {settings.maintenanceMode ? 'ON — Paused' : 'OFF — Normal'}
                </span>
              </FieldRow>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
