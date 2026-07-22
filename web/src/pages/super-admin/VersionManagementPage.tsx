import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Tag, AlertCircle, Check, Smartphone, Globe, GitBranch, Megaphone } from 'lucide-react';
import {
  getDashboard,
  getRemoteConfig,
  updateRemoteConfig,
  type DashboardData,
  type RemoteConfig,
  type RemoteConfigPatch,
} from '../../api/superAdmin';

// ── form types ─────────────────────────────────────────────────────────────────

interface ConfigForm {
  minimumAppVersion:    string;
  minimumAppVersionIos: string;
  forceUpdate:          boolean;
  forceUpdateMessage:   string;
  maintenanceMode:      boolean;
  maintenanceMessage:   string;
  broadcastMessage:     string;
  broadcastMessageType: 'info' | 'warning' | 'success';
}

function configToForm(c: RemoteConfig): ConfigForm {
  return {
    minimumAppVersion:    c.minimumAppVersion,
    minimumAppVersionIos: c.minimumAppVersionIos,
    forceUpdate:          c.forceUpdate,
    forceUpdateMessage:   c.forceUpdateMessage,
    maintenanceMode:      c.maintenanceMode,
    maintenanceMessage:   c.maintenanceMessage,
    broadcastMessage:     c.broadcastMessage,
    broadcastMessageType: c.broadcastMessageType,
  };
}

function formDelta(form: ConfigForm, orig: ConfigForm): RemoteConfigPatch {
  const d: RemoteConfigPatch = {};
  if (form.minimumAppVersion    !== orig.minimumAppVersion)    d.minimumAppVersion    = form.minimumAppVersion;
  if (form.minimumAppVersionIos !== orig.minimumAppVersionIos) d.minimumAppVersionIos = form.minimumAppVersionIos;
  if (form.forceUpdate          !== orig.forceUpdate)          d.forceUpdate          = form.forceUpdate;
  if (form.forceUpdateMessage   !== orig.forceUpdateMessage)   d.forceUpdateMessage   = form.forceUpdateMessage;
  if (form.maintenanceMode      !== orig.maintenanceMode)      d.maintenanceMode      = form.maintenanceMode;
  if (form.maintenanceMessage   !== orig.maintenanceMessage)   d.maintenanceMessage   = form.maintenanceMessage;
  if (form.broadcastMessage     !== orig.broadcastMessage)     d.broadcastMessage     = form.broadcastMessage;
  if (form.broadcastMessageType !== orig.broadcastMessageType) d.broadcastMessageType = form.broadcastMessageType;
  return d;
}

function isDirty(form: ConfigForm, orig: ConfigForm): boolean {
  return Object.keys(formDelta(form, orig)).length > 0;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

// ── sub-components ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
        checked ? 'bg-brand' : 'bg-ink/20'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-canvas shadow transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function VersionCard({ label, icon: Icon, value, sub, available }: {
  label: string; icon: React.ElementType; value: string; sub?: string; available: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${available ? 'border-border bg-canvas' : 'border-border bg-mist/40'}`}>
      <div className="mb-2 flex items-center gap-2">
        <Icon size={14} className={available ? 'text-ink/40' : 'text-ink/20'} />
        <p className={`text-xs font-medium ${available ? 'text-ink/50' : 'text-ink/30'}`}>{label}</p>
      </div>
      <p className={`font-bold tabular-nums ${available ? 'text-xl text-ink' : 'text-xl text-ink/20'}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-[10px] ${available ? 'text-ink/40' : 'text-ink/25'}`}>{sub}</p>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink/40">{children}</h2>
  );
}

function FieldLabel({ htmlFor, children, sub }: { htmlFor?: string; children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {children}
      </label>
      {sub && <p className="mt-0.5 text-xs text-ink/40">{sub}</p>}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder-ink/30 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50';
const textareaCls = `${inputCls} resize-none`;

// ── VersionManagementPage ──────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

export function VersionManagementPage() {
  const [config,       setConfig]       = useState<RemoteConfig | null>(null);
  const [_dash,        _setDash]        = useState<DashboardData | null>(null);
  const [configError,  setConfigError]  = useState(false);
  const [dashError,    setDashError]    = useState(false);
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null);

  const [form,     setForm]     = useState<ConfigForm | null>(null);
  const [origForm, setOrigForm] = useState<ConfigForm | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError,  setSaveError]  = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [cfgRes, dashRes] = await Promise.allSettled([getRemoteConfig(), getDashboard()]);

    if (cfgRes.status === 'fulfilled') {
      setConfig(cfgRes.value);
      setConfigError(false);
      // Only init form on first load (don't overwrite user's edits on refresh)
      setForm(prev => prev ?? configToForm(cfgRes.value));
      setOrigForm(configToForm(cfgRes.value));
    } else {
      setConfigError(true);
    }

    if (dashRes.status === 'fulfilled') {
      _setDash(dashRes.value);
      setDashError(false);
    } else {
      setDashError(true);
    }

    setLastUpdated(new Date());
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-dismiss save success banner after 4s
  useEffect(() => {
    if (saveStatus !== 'success') return;
    const t = setTimeout(() => setSaveStatus('idle'), 4_000);
    return () => clearTimeout(t);
  }, [saveStatus]);

  // ── handlers ────────────────────────────────────────────────────────────────

  function setField<K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) {
    setForm(prev => prev ? { ...prev, [key]: value } : prev);
  }

  async function handleSave() {
    if (!form || !origForm) return;
    const delta = formDelta(form, origForm);
    if (Object.keys(delta).length === 0) return;

    setSaving(true);
    setSaveStatus('idle');
    setSaveError(null);

    try {
      const res = await updateRemoteConfig(delta);
      setConfig(res.config);
      const updated = configToForm(res.config);
      setForm(updated);
      setOrigForm(updated);
      setSaveStatus('success');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (origForm) setForm({ ...origForm });
    setSaveStatus('idle');
    setSaveError(null);
  }

  async function handleRefresh() {
    await loadData();
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const dirty = form && origForm ? isDirty(form, origForm) : false;
  const anyError = configError || dashError;

  const broadcastBadge = {
    info:    'bg-blue-100 text-blue-700',
    warning: 'bg-amber-100 text-amber-700',
    success: 'bg-green-100 text-green-700',
  } as const;

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Tag size={18} className="text-brand" />
            <h1 className="text-xl font-bold text-ink">Version Management</h1>
          </div>
          <p className="mt-1 text-sm text-ink/40">
            App version requirements and release configuration
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs text-ink/50">
          {lastUpdated && (
            <span>
              Loaded{' '}
              {lastUpdated.toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </span>
          )}
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-ink/60 transition hover:bg-mist"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {/* Endpoint error banners */}
      {anyError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertCircle size={14} />
          {configError && dashError
            ? 'Both endpoints unavailable — data may be incomplete'
            : configError
            ? '/remote-config unavailable — config cannot be loaded or saved'
            : '/dashboard unavailable — platform stats unavailable'}
        </div>
      )}

      {/* Save status banners */}
      {saveStatus === 'success' && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
          <Check size={14} />
          Configuration saved successfully
        </div>
      )}
      {saveStatus === 'error' && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertCircle size={14} />
          {saveError ?? 'Failed to save — please try again'}
        </div>
      )}

      {/* ── Version Overview cards ── */}
      <section>
        <SectionLabel>Version Overview</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <VersionCard icon={Globe}      label="Current Web Version"    value="—"                          sub="Coming Soon"                  available={false} />
          <VersionCard icon={Smartphone} label="Current Mobile Version" value="—"                          sub="Coming Soon"                  available={false} />
          <VersionCard icon={GitBranch}  label="Min Android Version"    value={config?.minimumAppVersion    ?? '—'} sub="minimum required"     available={config !== null} />
          <VersionCard icon={GitBranch}  label="Min iOS Version"        value={config?.minimumAppVersionIos ?? '—'} sub="minimum required"     available={config !== null} />
        </div>
      </section>

      {/* ── App Version Settings (form) ── */}
      <section className="rounded-xl border border-border bg-canvas p-5">
        <SectionLabel>App Version Settings</SectionLabel>

        {/* Min versions */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="minAndroid" sub="Android — minimum supported build">
              Minimum Android Version
            </FieldLabel>
            <input
              id="minAndroid"
              type="text"
              placeholder="e.g. 1.2.0"
              value={form?.minimumAppVersion ?? ''}
              onChange={e => setField('minimumAppVersion', e.target.value)}
              disabled={!form || saving}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="minIos" sub="iOS — minimum supported build">
              Minimum iOS Version
            </FieldLabel>
            <input
              id="minIos"
              type="text"
              placeholder="e.g. 1.2.0"
              value={form?.minimumAppVersionIos ?? ''}
              onChange={e => setField('minimumAppVersionIos', e.target.value)}
              disabled={!form || saving}
              className={inputCls}
            />
          </div>
        </div>

        {/* Force Update */}
        <div className="mt-5 border-t border-border pt-5">
          <div className="flex items-center justify-between">
            <FieldLabel sub="Prevents access until app is updated to minimum version">
              Force Update
            </FieldLabel>
            <Toggle
              checked={form?.forceUpdate ?? false}
              onChange={v => setField('forceUpdate', v)}
              disabled={!form || saving}
            />
          </div>
          {form?.forceUpdate && (
            <div className="mt-3 space-y-1.5">
              <FieldLabel htmlFor="forceMsg" sub="Shown to users on outdated builds">
                Force Update Message
              </FieldLabel>
              <textarea
                id="forceMsg"
                rows={2}
                value={form.forceUpdateMessage}
                onChange={e => setField('forceUpdateMessage', e.target.value)}
                disabled={saving}
                className={textareaCls}
              />
            </div>
          )}
        </div>
      </section>

      {/* ── Release Configuration (form continued) ── */}
      <section className="rounded-xl border border-border bg-canvas p-5">
        <SectionLabel>Release Configuration</SectionLabel>

        {/* Maintenance Mode */}
        <div className="flex items-center justify-between">
          <FieldLabel sub="Blocks all hotel logins while maintenance is in progress">
            Maintenance Mode
          </FieldLabel>
          <Toggle
            checked={form?.maintenanceMode ?? false}
            onChange={v => setField('maintenanceMode', v)}
            disabled={!form || saving}
          />
        </div>
        {form?.maintenanceMode && (
          <div className="mt-3 space-y-1.5">
            <FieldLabel htmlFor="maintMsg" sub="Shown to hotels during maintenance">
              Maintenance Message
            </FieldLabel>
            <input
              id="maintMsg"
              type="text"
              value={form.maintenanceMessage}
              onChange={e => setField('maintenanceMessage', e.target.value)}
              disabled={saving}
              className={inputCls}
            />
          </div>
        )}

        {/* Broadcast */}
        <div className="mt-5 border-t border-border pt-5 space-y-3">
          <div className="flex items-center gap-2">
            <Megaphone size={14} className="text-ink/40" />
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">Broadcast</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2 space-y-1.5">
              <FieldLabel htmlFor="broadcastMsg" sub="Shown as a platform-wide banner">
                Broadcast Message
              </FieldLabel>
              <textarea
                id="broadcastMsg"
                rows={2}
                placeholder="Leave blank to hide"
                value={form?.broadcastMessage ?? ''}
                onChange={e => setField('broadcastMessage', e.target.value)}
                disabled={!form || saving}
                className={textareaCls}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="broadcastType" sub="Controls banner colour">
                Message Type
              </FieldLabel>
              <select
                id="broadcastType"
                value={form?.broadcastMessageType ?? 'info'}
                onChange={e => setField('broadcastMessageType', e.target.value as ConfigForm['broadcastMessageType'])}
                disabled={!form || saving}
                className={inputCls}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="success">Success</option>
              </select>
              {form?.broadcastMessageType && (
                <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${broadcastBadge[form.broadcastMessageType]}`}>
                  {form.broadcastMessageType}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Save / Reset ── */}
      {dirty && (
        <div className="flex items-center justify-between rounded-xl border border-brand/30 bg-brand/5 px-5 py-3">
          <p className="text-sm text-ink/60">You have unsaved changes</p>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-1.5 text-sm text-ink/60 transition hover:bg-mist disabled:opacity-50"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-canvas transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* ── Config metadata ── */}
      {config && (
        <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-mist/30 px-5 py-3 text-xs text-ink/40">
          <span>Config ID: <span className="font-mono text-ink/50">{config._id}</span></span>
          <span>Last modified: <span className="text-ink/50">{fmtDate(config.updatedAt)}</span></span>
          <span>Created: <span className="text-ink/50">{fmtDate(config.createdAt)}</span></span>
        </div>
      )}

      {/* ── Version Distribution (Coming Soon) ── */}
      <section>
        <SectionLabel>Version Distribution</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-border bg-canvas">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-mist/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">App Version</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Devices</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Hotels</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">% Share</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-ink/30">Coming Soon</p>
                    <p className="mt-1 text-xs text-ink/25">
                      Requires device app version reporting via heartbeat endpoint
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Hotels by Version (Coming Soon) ── */}
      <section>
        <SectionLabel>Hotels by Version</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-border bg-canvas">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-mist/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">Hotel</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">App Version</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink/40">Platform</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Last Seen</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-ink/40">Update Required</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-ink/30">Coming Soon</p>
                    <p className="mt-1 text-xs text-ink/25">
                      Requires version field in device heartbeat records
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Footer */}
      <p className="text-center text-[11px] text-ink/30">
        Version distribution and hotel grouping require additional backend version tracking · Config changes apply immediately
      </p>

    </div>
  );
}
