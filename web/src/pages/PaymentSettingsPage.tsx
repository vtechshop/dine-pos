import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, Settings, RefreshCw, CheckCircle, XCircle, AlertCircle,
  Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Wifi, Download,
  ChevronLeft, ChevronRight, Copy, Check, Link2, Unlink, ExternalLink,
} from 'lucide-react';
import {
  fetchGatewayConfigs, createGatewayConfig, updateGatewayConfig,
  deleteGatewayConfig, toggleGateway, testGatewayConnection,
  fetchPayments, fetchPaymentReport, initiateRefund,
  getRazorpayOAuthConnectUrl, disconnectRazorpayOAuth,
  type GatewayConfig, type GatewayType, type PaymentRecord, type PaymentReport,
} from '../api/payments';

// ── Helpers ───────────────────────────────────────────────────────────────────

const GATEWAY_LABELS: Record<string, string> = {
  razorpay: 'Razorpay', cashfree: 'Cashfree', phonepe: 'PhonePe PG',
  payu: 'PayU', paytm: 'Paytm', bharatpe: 'BharatPe',
};
const SUPPORTED: GatewayType[] = ['razorpay', 'cashfree', 'phonepe', 'payu', 'paytm', 'bharatpe'];
const STATUS_COLORS: Record<string, string> = {
  success:          'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-400',
  failed:           'bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400',
  pending:          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  processing:       'bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-400',
  cancelled:        'bg-gray-100   text-gray-600   dark:bg-gray-800      dark:text-gray-400',
  refunded:         'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  partial_refunded: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
};
const fmtRs  = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtDt  = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const today  = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

function csv(rows: string[][], name: string) {
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

// ── Local sub-components ──────────────────────────────────────────────────────

function Badge({ text, color }: { text: string; color?: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${color ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
      {text.replace(/_/g, ' ')}
    </span>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink/50">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/50">{sub}</p>}
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
      <XCircle size={16} /> {msg}
    </div>
  );
}

function maskAccountId(id: string): string {
  if (!id || id.length <= 9) return id;
  return id.slice(0, 5) + '•••' + id.slice(-4);
}

function WebhookUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border bg-mist/60 px-3 py-2">
      <span className="text-xs font-semibold text-ink/50 shrink-0">Webhook URL</span>
      <span className="flex-1 truncate font-mono text-xs text-ink/70">{url}</span>
      <button
        onClick={copy}
        title="Copy webhook URL"
        className="shrink-0 rounded p-1 text-ink/40 hover:bg-canvas hover:text-brand"
      >
        {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

// ── Razorpay OAuth Connection Banner ─────────────────────────────────────────

function RazorpayOAuthBanner({ rzpConfig, onRefresh }: {
  rzpConfig?: GatewayConfig;
  onRefresh:  () => void;
}) {
  const [connecting,    setConnecting]    = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [err,           setErr]           = useState('');

  const isConnected = rzpConfig?.isOAuthConnected === true;

  // Warn when access token expires within 7 days (auto-refresh fires, but let admin know).
  const accessTokenWarning = isConnected && rzpConfig?.oauthExpiresAt
    ? (new Date(rzpConfig.oauthExpiresAt).getTime() - Date.now()) < 7 * 24 * 60 * 60 * 1000
    : false;

  // Warn when refresh token expires within 30 days — no auto-renewal, reconnect required.
  const refreshWarning = isConnected && rzpConfig?.oauthRefreshExpiresAt
    ? (new Date(rzpConfig.oauthRefreshExpiresAt).getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000
    : false;

  async function handleConnect() {
    setConnecting(true); setErr('');
    try {
      const { authorizeUrl } = await getRazorpayOAuthConnectUrl();
      window.location.href = authorizeUrl;
    } catch (e) { setErr((e as Error).message); setConnecting(false); }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Razorpay OAuth? Payments via OAuth will stop until you reconnect.')) return;
    setDisconnecting(true); setErr('');
    try { await disconnectRazorpayOAuth(); onRefresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setDisconnecting(false); }
  }

  return (
    <div className={`rounded-xl border p-4 ${isConnected ? 'border-brand/30 bg-brand/5' : 'border-dashed border-border bg-canvas'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isConnected ? 'bg-brand text-white' : 'bg-mist text-ink/50'}`}>
            <Link2 size={16} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">Razorpay Technology Partner</span>
              <Badge text="OAuth" color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
              {isConnected
                ? <Badge text="Connected" color="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" />
                : <Badge text="Not Connected" color="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" />
              }
            </div>
            {isConnected && rzpConfig ? (
              <div className="mt-0.5 space-y-0.5 text-xs text-ink/50">
                <p>
                  Connected account:{' '}
                  <span className="font-mono text-ink/70">{maskAccountId(rzpConfig.oauthConnectedAccountId)}</span>
                </p>
                <p>
                  Connected {rzpConfig.oauthConnectedAt ? fmtDt(rzpConfig.oauthConnectedAt) : '—'}
                  {rzpConfig.oauthExpiresAt && (
                    <>{' · '}Access token expires {fmtDt(rzpConfig.oauthExpiresAt)}</>
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-ink/50">
                Connect your hotel's own Razorpay account to receive customer payments directly.
                Payments flow directly to the hotel — no platform wallet.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isConnected ? (
            <>
              <button
                onClick={handleConnect}
                disabled={connecting}
                title="Start a new OAuth authorization to refresh your connection"
                className="flex items-center gap-1.5 rounded-lg border border-brand/40 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
              >
                <RefreshCw size={12} />{connecting ? ' Redirecting…' : ' Reconnect'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Unlink size={12} />{disconnecting ? ' Disconnecting…' : ' Disconnect'}
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              <ExternalLink size={12} />{connecting ? ' Redirecting…' : ' Connect Razorpay'}
            </button>
          )}
        </div>
      </div>

      {accessTokenWarning && !refreshWarning && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
          <AlertCircle size={13} />
          Access token expires {rzpConfig?.oauthExpiresAt ? fmtDt(rzpConfig.oauthExpiresAt) : 'soon'}.
          It will auto-refresh on the next payment — or click Reconnect to rotate it now.
        </div>
      )}
      {refreshWarning && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
          <AlertCircle size={13} />
          Refresh token expires {rzpConfig?.oauthRefreshExpiresAt ? fmtDt(rzpConfig.oauthRefreshExpiresAt) : 'soon'}.
          Click <strong>Reconnect</strong> before that date — once it expires, OAuth access is permanently lost until you reconnect manually.
        </div>
      )}
      {err && <div className="mt-3"><Err msg={err} /></div>}
    </div>
  );
}

// ── Gateway Config Modal ──────────────────────────────────────────────────────

interface GWForm {
  gatewayType: string; displayName: string; merchantId: string;
  apiKey: string; apiSecret: string; webhookSecret: string; environment: string;
}
const EMPTY_FORM: GWForm = { gatewayType: 'razorpay', displayName: '', merchantId: '', apiKey: '', apiSecret: '', webhookSecret: '', environment: 'sandbox' };

function GatewayModal({ existing, onSave, onClose }: {
  existing?: GatewayConfig;
  onSave: (data: GWForm) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<GWForm>(
    existing
      ? { gatewayType: existing.gatewayType, displayName: existing.displayName, merchantId: existing.merchantId, apiKey: existing.apiKey, apiSecret: '', webhookSecret: '', environment: existing.environment }
      : { ...EMPTY_FORM, displayName: GATEWAY_LABELS['razorpay'] },
  );
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  function set<K extends keyof GWForm>(k: K, v: GWForm[K]) {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === 'gatewayType' && !existing) next.displayName = GATEWAY_LABELS[v as string] ?? String(v);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.displayName.trim()) { setErr('Display name is required'); return; }
    setBusy(true); setErr('');
    try { await onSave(form); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  const lbl = 'block text-xs font-semibold text-ink/60 mb-1';
  const inp = 'w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-brand/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-canvas shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-ink">{existing ? 'Edit Gateway' : 'Add Gateway'}</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink"><XCircle size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-6">
          {!existing && (
            <div>
              <label className={lbl}>Gateway</label>
              <select value={form.gatewayType} onChange={e => set('gatewayType', e.target.value)} className={inp}>
                {SUPPORTED.map(g => <option key={g} value={g}>{GATEWAY_LABELS[g]}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className={lbl}>Display Name</label>
            <input value={form.displayName} onChange={e => set('displayName', e.target.value)} className={inp} placeholder="e.g. Razorpay Live" />
          </div>
          <div>
            <label className={lbl}>Merchant ID</label>
            <input value={form.merchantId} onChange={e => set('merchantId', e.target.value)} className={inp} placeholder="Merchant / account ID" />
          </div>
          <div>
            <label className={lbl}>API Key</label>
            <input value={form.apiKey} onChange={e => set('apiKey', e.target.value)} className={inp} placeholder="Public API key" />
          </div>
          <div>
            <label className={lbl}>API Secret {existing && <span className="font-normal text-ink/40">(leave blank to keep existing)</span>}</label>
            <input type="password" value={form.apiSecret} onChange={e => set('apiSecret', e.target.value)} className={inp} placeholder={existing ? '••••••••' : 'Secret key'} />
          </div>
          <div>
            <label className={lbl}>Webhook Secret {existing && <span className="font-normal text-ink/40">(leave blank to keep existing)</span>}</label>
            <input type="password" value={form.webhookSecret} onChange={e => set('webhookSecret', e.target.value)} className={inp} placeholder={existing ? '••••••••' : 'Webhook signing secret'} />
          </div>
          <div>
            <label className={lbl}>Environment</label>
            <select value={form.environment} onChange={e => set('environment', e.target.value)} className={inp}>
              <option value="sandbox">Sandbox (Test)</option>
              <option value="live">Live (Production)</option>
            </select>
          </div>
          {err && <Err msg={err} />}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-ink/60 hover:bg-mist">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Refund Modal ──────────────────────────────────────────────────────────────

function RefundModal({ payment, onDone, onClose }: {
  payment: PaymentRecord;
  onDone:  () => void;
  onClose: () => void;
}) {
  const maxRefund = payment.amount - payment.refundedAmount;
  const [amount, setAmount] = useState(String(maxRefund));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0 || amt > maxRefund) { setErr(`Amount must be between ₹0.01 and ₹${maxRefund}`); return; }
    setBusy(true); setErr('');
    try {
      await initiateRefund(payment._id, amt, reason || undefined);
      setDone(true); onDone();
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  const lbl = 'block text-xs font-semibold text-ink/60 mb-1';
  const inp = 'w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-canvas shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-ink">Initiate Refund</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink"><XCircle size={18} /></button>
        </div>
        {done ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <CheckCircle size={40} className="text-green-500" />
            <p className="font-semibold text-ink">Refund Queued</p>
            <p className="text-sm text-ink/60">The refund has been recorded and will be processed once the gateway SDK is integrated.</p>
            <button onClick={onClose} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-6">
            <div className="rounded-lg bg-mist px-4 py-3 text-sm text-ink/70">
              <span className="font-semibold text-ink">{payment.internalTransactionId}</span>
              <span className="mx-2">·</span>Paid: {fmtRs(payment.amount)}
              {payment.refundedAmount > 0 && <> · Already refunded: {fmtRs(payment.refundedAmount)}</>}
            </div>
            <div>
              <label className={lbl}>Refund Amount (₹) — max {fmtRs(maxRefund)}</label>
              <input type="number" step="0.01" min="0.01" max={maxRefund} value={amount} onChange={e => setAmount(e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Reason (optional)</label>
              <input value={reason} onChange={e => setReason(e.target.value)} className={inp} placeholder="Customer request, duplicate order, etc." />
            </div>
            {err && <Err msg={err} />}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-ink/60 hover:bg-mist">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? 'Processing…' : 'Refund'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Tab: Gateways ─────────────────────────────────────────────────────────────

function GatewaysTab() {
  const [configs, setConfigs] = useState<GatewayConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [modal,   setModal]   = useState<'add' | GatewayConfig | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setConfigs(await fetchGatewayConfigs()); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Handle OAuth redirect callback (?razorpay_connected=1 or ?razorpay_error=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('razorpay_connected') === '1') {
      setSuccessMsg('Razorpay account connected successfully.');
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => setSuccessMsg(''), 6000);
    } else if (params.get('razorpay_error')) {
      setErr('Razorpay connection failed: ' + params.get('razorpay_error'));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function handleSave(form: GWForm) {
    if (modal === 'add') {
      await createGatewayConfig(form);
    } else if (modal && typeof modal === 'object') {
      await updateGatewayConfig(modal._id, { displayName: form.displayName, merchantId: form.merchantId, apiKey: form.apiKey, apiSecret: form.apiSecret || undefined, webhookSecret: form.webhookSecret || undefined, environment: form.environment });
    }
    setModal(null);
    await load();
  }

  async function handleToggle(id: string) {
    await toggleGateway(id);
    setConfigs(cs => cs.map(c => c._id === id ? { ...c, isActive: !c.isActive } : { ...c, isActive: c._id === id ? true : (c.isActive && c._id !== id ? false : c.isActive) }));
    await load();
  }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const r = await testGatewayConnection(id);
      setTestMsg(m => ({ ...m, [id]: { ok: r.success, msg: r.message } }));
    } catch (e) {
      setTestMsg(m => ({ ...m, [id]: { ok: false, msg: (e as Error).message } }));
    } finally {
      setTesting(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try { await deleteGatewayConfig(id); await load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setDeleting(null); }
  }

  return (
    <div className="space-y-4">
      <RazorpayOAuthBanner rzpConfig={configs.find(c => c.gatewayType === 'razorpay')} onRefresh={load} />

      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          <CheckCircle size={16} /> {successMsg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-ink/60">Configure payment gateways. Only one can be active at a time.</p>
        <button onClick={() => setModal('add')} className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
          <Plus size={14} /> Add Gateway
        </button>
      </div>

      {loading && <p className="text-sm text-ink/40">Loading…</p>}
      {err && <Err msg={err} />}

      {!loading && configs.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink/40">
          No gateways configured yet. Click "Add Gateway" to get started.
        </div>
      )}

      <div className="space-y-3">
        {configs.map(c => (
          <div key={c._id} className={`rounded-xl border p-4 ${c.isActive ? 'border-brand/40 bg-brand/5' : 'border-border bg-canvas'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.isActive ? 'bg-brand text-white' : 'bg-mist text-ink/50'}`}>
                  <CreditCard size={16} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{c.displayName}</span>
                    <Badge text={c.gatewayType} />
                    <Badge text={c.environment} color={c.environment === 'live' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-800'} />
                    {c.isOAuthConnected && <Badge text="OAuth" color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />}
                    {!c.isIntegrated && <Badge text="SDK pending" color="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" />}
                  </div>
                  {c.merchantId && <p className="mt-0.5 text-xs text-ink/50">Merchant: {c.merchantId}</p>}
                  {c.testResult?.lastTestedAt && (
                    <p className="mt-0.5 text-xs text-ink/40">
                      Last tested: {fmtDt(c.testResult.lastTestedAt)} ·{' '}
                      {c.testResult.success ? <span className="text-green-600">OK</span> : <span className="text-red-500">{c.testResult.message}</span>}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTest(c._id)}
                  disabled={testing === c._id}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist disabled:opacity-50"
                >
                  <Wifi size={12} /> {testing === c._id ? 'Testing…' : 'Test'}
                </button>
                <button onClick={() => setModal(c)} className="rounded-lg border border-border p-1.5 text-ink/50 hover:bg-mist"><Edit2 size={14} /></button>
                <button onClick={() => handleDelete(c._id, c.displayName)} disabled={deleting === c._id} className="rounded-lg border border-border p-1.5 text-red-400 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} /></button>
                <button
                  onClick={() => handleToggle(c._id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${c.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}
                >
                  {c.isActive ? <><ToggleRight size={14} /> Active</> : <><ToggleLeft size={14} /> Inactive</>}
                </button>
              </div>
            </div>
            {testMsg[c._id] && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${testMsg[c._id].ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                {testMsg[c._id].ok ? <CheckCircle size={12} className="mr-1 inline" /> : <XCircle size={12} className="mr-1 inline" />}
                {testMsg[c._id].msg}
              </div>
            )}
            {c.hotelId && (
              <WebhookUrlRow
                url={`${import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'}/payment-webhooks/${c.gatewayType}/${c.hotelId}`}
              />
            )}
          </div>
        ))}
      </div>

      {modal && (
        <GatewayModal
          existing={modal === 'add' ? undefined : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Tab: Transactions ─────────────────────────────────────────────────────────

function TransactionsTab() {
  const [data,    setData]    = useState<{ payments: PaymentRecord[]; total: number; page: number; limit: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [from,    setFrom]    = useState(daysAgo(30));
  const [to,      setTo]      = useState(today());
  const [status,  setStatus]  = useState('');
  const [gateway, setGateway] = useState('');
  const [method,  setMethod]  = useState('');
  const [page,    setPage]    = useState(1);
  const [refundTarget, setRefundTarget] = useState<PaymentRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await fetchPayments({ from, to, status: status || undefined, gateway: gateway || undefined, method: method || undefined, page, limit: 20 })); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [from, to, status, gateway, method, page]);

  useEffect(() => { load(); }, [load]);

  function exportCSV() {
    if (!data) return;
    const rows = [
      ['TX ID', 'Gateway TX', 'Gateway', 'Status', 'Amount', 'Method', 'Refund Status', 'Settlement', 'Date'],
      ...data.payments.map(p => [p.internalTransactionId, p.gatewayTransactionId, p.gatewayType, p.status, String(p.amount), p.paymentMethod, p.refundStatus, p.settlementStatus, fmtDt(p.createdAt)]),
    ];
    csv(rows, `transactions-${from}-${to}.csv`);
  }

  const totalPages = data ? Math.ceil(data.total / 20) : 1;
  const sel = 'rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand/50';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">From</label><input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} className={sel} /></div>
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">To</label><input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} className={sel} /></div>
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">Status</label>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className={sel}>
            <option value="">All</option>
            {['pending','processing','success','failed','cancelled','refunded','partial_refunded'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
        </div>
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">Gateway</label>
          <select value={gateway} onChange={e => { setGateway(e.target.value); setPage(1); }} className={sel}>
            <option value="">All</option>
            {SUPPORTED.map(g => <option key={g} value={g}>{GATEWAY_LABELS[g]}</option>)}
          </select>
        </div>
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">Method</label>
          <select value={method} onChange={e => { setMethod(e.target.value); setPage(1); }} className={sel}>
            <option value="">All</option>
            {['upi','card','netbanking','wallet','emi','qr','other'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
        </div>
        <button onClick={load} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist"><RefreshCw size={12} />Refresh</button>
        <button onClick={exportCSV} disabled={!data} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist disabled:opacity-50"><Download size={12} />CSV</button>
      </div>

      {err && <Err msg={err} />}
      {loading && <p className="text-sm text-ink/40">Loading…</p>}

      {!loading && data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-mist text-xs font-semibold uppercase tracking-wide text-ink/50">
                <tr>
                  {['TX ID', 'Gateway', 'Amount', 'Status', 'Method', 'Refund', 'Date', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.payments.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-ink/40">No transactions found</td></tr>
                )}
                {data.payments.map(p => (
                  <tr key={p._id} className="hover:bg-mist/50">
                    <td className="px-4 py-3 font-mono text-xs text-ink/70">{p.internalTransactionId}</td>
                    <td className="px-4 py-3"><Badge text={p.gatewayType} /></td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-ink">{fmtRs(p.amount)}</td>
                    <td className="px-4 py-3"><Badge text={p.status} color={STATUS_COLORS[p.status]} /></td>
                    <td className="px-4 py-3 text-ink/60">{p.paymentMethod.toUpperCase()}</td>
                    <td className="px-4 py-3">
                      {p.refundedAmount > 0 ? (
                        <span className="text-xs text-purple-600 dark:text-purple-400">{fmtRs(p.refundedAmount)}</span>
                      ) : <span className="text-ink/30">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/50 whitespace-nowrap">{fmtDt(p.createdAt)}</td>
                    <td className="px-4 py-3">
                      {(p.status === 'success' || p.status === 'partial_refunded') && p.refundStatus !== 'full' && (
                        <button onClick={() => setRefundTarget(p)} className="text-xs font-medium text-brand hover:underline">Refund</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-ink/60">
            <span>{data.total} total transaction{data.total !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded p-1 hover:bg-mist disabled:opacity-30"><ChevronLeft size={16} /></button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded p-1 hover:bg-mist disabled:opacity-30"><ChevronRight size={16} /></button>
            </div>
          </div>
        </>
      )}

      {refundTarget && (
        <RefundModal
          payment={refundTarget}
          onDone={() => { setRefundTarget(null); load(); }}
          onClose={() => setRefundTarget(null)}
        />
      )}
    </div>
  );
}

// ── Tab: Refunds ──────────────────────────────────────────────────────────────

function RefundsTab() {
  const [data,       setData]       = useState<PaymentRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState('');
  const [from,       setFrom]       = useState(daysAgo(30));
  const [to,         setTo]         = useState(today());

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [res, partial] = await Promise.all([
        fetchPayments({ from, to, status: 'refunded',         limit: 2000 }),
        fetchPayments({ from, to, status: 'partial_refunded', limit: 2000 }),
      ]);
      setTotalCount(res.total + partial.total);
      setData([...res.payments, ...partial.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  function exportCSV() {
    const rows = [
      ['TX ID', 'Gateway', 'Original Amount', 'Refunded', 'Refund Status', 'Date'],
      ...data.map(p => [p.internalTransactionId, p.gatewayType, String(p.amount), String(p.refundedAmount), p.refundStatus, fmtDt(p.createdAt)]),
    ];
    csv(rows, `refunds-${from}-${to}.csv`);
  }

  const inp = 'rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand/50';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} /></div>
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} /></div>
        <button onClick={load} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist"><RefreshCw size={12} />Refresh</button>
        <button onClick={exportCSV} disabled={data.length === 0} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist disabled:opacity-50"><Download size={12} />CSV</button>
      </div>

      {err && <Err msg={err} />}
      {loading && <p className="text-sm text-ink/40">Loading…</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <KPI label="Total Refunds" value={String(totalCount)} />
            <KPI label="Amount Refunded" value={fmtRs(data.reduce((s, p) => s + p.refundedAmount, 0))} />
            <KPI label="Partial Refunds" value={String(data.filter(p => p.refundStatus === 'partial').length)} />
          </div>
          {totalCount > data.length && (
            <p className="text-xs text-amber-600">Showing {data.length} of {totalCount} refund records. Amount shown reflects fetched records only.</p>
          )}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-mist text-xs font-semibold uppercase tracking-wide text-ink/50">
                <tr>
                  {['TX ID', 'Gateway', 'Original', 'Refunded', 'Refund Status', 'Date'].map(h => (
                    <th key={h} className="px-4 py-3 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/40">No refunds in this period</td></tr>
                )}
                {data.map(p => (
                  <tr key={p._id} className="hover:bg-mist/50">
                    <td className="px-4 py-3 font-mono text-xs text-ink/70">{p.internalTransactionId}</td>
                    <td className="px-4 py-3"><Badge text={p.gatewayType} /></td>
                    <td className="px-4 py-3 tabular-nums text-ink">{fmtRs(p.amount)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-purple-600 dark:text-purple-400">{fmtRs(p.refundedAmount)}</td>
                    <td className="px-4 py-3"><Badge text={p.refundStatus} color={STATUS_COLORS[p.status]} /></td>
                    <td className="px-4 py-3 text-xs text-ink/50">{fmtDt(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab: Reports ──────────────────────────────────────────────────────────────

function ReportsTab() {
  const [report,  setReport]  = useState<PaymentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [from,    setFrom]    = useState(daysAgo(30));
  const [to,      setTo]      = useState(today());

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setReport(await fetchPaymentReport(from, to)); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  function exportCSV() {
    if (!report) return;
    const rows = [
      ['Metric', 'Value'],
      ['Total Transactions', String(report.summary.total)],
      ['Total Amount', String(report.summary.totalAmount)],
      ['Success Amount', String(report.summary.successAmount)],
      ['Success Count', String(report.summary.successCount)],
      ['Failed Count', String(report.summary.failedCount)],
      ['Pending Count', String(report.summary.pendingCount)],
      ['Refunded Amount', String(report.summary.refundedAmount)],
      ['Success Rate %', fmtPct(report.summary.successRate)],
    ];
    csv(rows, `payment-report-${from}-${to}.csv`);
  }

  const inp = 'rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand/50';

  const maxAmount = report ? Math.max(...report.dailyTrend.map(d => d.amount), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} /></div>
        <div><label className="mb-1 block text-xs font-semibold text-ink/50">To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} /></div>
        <button onClick={load} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist"><RefreshCw size={12} />Refresh</button>
        <button onClick={exportCSV} disabled={!report} className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-mist disabled:opacity-50"><Download size={12} />CSV</button>
      </div>

      {err && <Err msg={err} />}
      {loading && <p className="text-sm text-ink/40">Loading…</p>}

      {!loading && report && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KPI label="Total Transactions"  value={String(report.summary.total)} />
            <KPI label="Total Collection"    value={fmtRs(report.summary.totalAmount)} />
            <KPI label="Success Rate"        value={fmtPct(report.summary.successRate)} sub={`${report.summary.successCount} successful`} />
            <KPI label="Refunded"            value={fmtRs(report.summary.refundedAmount)} sub={`${report.summary.failedCount} failed`} />
          </div>

          {/* By Gateway */}
          {report.byGateway.length > 0 && (
            <div className="rounded-xl border border-border p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">Gateway-wise Collection</h3>
              <div className="space-y-3">
                {report.byGateway.map(g => {
                  const pct = report.summary.totalAmount > 0 ? (g.amount / report.summary.totalAmount) * 100 : 0;
                  return (
                    <div key={g.gatewayType} className="flex items-center gap-3 text-sm">
                      <span className="w-24 shrink-0 text-xs font-medium text-ink">{GATEWAY_LABELS[g.gatewayType] ?? g.gatewayType}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-mist">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-ink">{fmtRs(g.amount)}</span>
                      <span className="w-14 shrink-0 text-right text-xs text-ink/50">{fmtPct(g.successRate)}✓</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* By Method */}
          {report.byMethod.length > 0 && (
            <div className="rounded-xl border border-border p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">Payment Method Breakdown</h3>
              <div className="flex flex-wrap gap-3">
                {report.byMethod.map(m => (
                  <div key={m.method} className="flex-1 min-w-[120px] rounded-lg bg-mist p-3 text-center">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{m.method.toUpperCase()}</p>
                    <p className="mt-1 text-base font-bold text-ink tabular-nums">{fmtRs(m.amount)}</p>
                    <p className="text-xs text-ink/40">{m.count} txn{m.count !== 1 ? 's' : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status Breakdown */}
          {report.byStatus.length > 0 && (
            <div className="rounded-xl border border-border p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">Status Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                    <tr>{['Status', 'Count', 'Amount'].map(h => <th key={h} className="pb-2 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.byStatus.map(s => (
                      <tr key={s.status}>
                        <td className="py-2"><Badge text={s.status} color={STATUS_COLORS[s.status]} /></td>
                        <td className="py-2 tabular-nums text-ink">{s.count}</td>
                        <td className="py-2 font-semibold tabular-nums text-ink">{fmtRs(s.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily Trend */}
          {report.dailyTrend.length > 0 && (
            <div className="rounded-xl border border-border p-5">
              <h3 className="mb-4 text-sm font-semibold text-ink">Daily Collection Trend</h3>
              <div className="flex h-40 items-end gap-1 overflow-x-auto">
                {report.dailyTrend.map(d => {
                  const h = maxAmount > 0 ? Math.max((d.amount / maxAmount) * 100, 2) : 2;
                  return (
                    <div key={d.date} className="group relative flex shrink-0 flex-col items-center gap-1" style={{ minWidth: '28px' }}>
                      <div className="absolute bottom-full mb-1 hidden rounded bg-ink px-2 py-1 text-xs text-canvas group-hover:block whitespace-nowrap z-10">
                        {d.date}<br />{fmtRs(d.amount)} · {d.count} txn
                      </div>
                      <div className="w-5 rounded-t bg-brand/70 hover:bg-brand" style={{ height: `${h}%` }} />
                      <span className="text-[9px] text-ink/40 rotate-45 origin-left">{d.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = 'gateways' | 'transactions' | 'refunds' | 'reports';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'gateways',     label: 'Gateways',     icon: Settings     },
  { id: 'transactions', label: 'Transactions',  icon: CreditCard   },
  { id: 'refunds',      label: 'Refunds',       icon: AlertCircle  },
  { id: 'reports',      label: 'Reports',       icon: CheckCircle  },
];

export function PaymentSettingsPage() {
  const [tab, setTab] = useState<Tab>('gateways');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <CreditCard size={20} className="text-brand" />
        <div>
          <h1 className="text-base font-semibold text-ink">Payment Settings</h1>
          <p className="text-xs text-ink/50">Manage gateways, track transactions, handle refunds</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-border px-6 pt-2">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-brand text-brand'
                  : 'text-ink/50 hover:text-ink'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'gateways'     && <GatewaysTab />}
        {tab === 'transactions' && <TransactionsTab />}
        {tab === 'refunds'      && <RefundsTab />}
        {tab === 'reports'      && <ReportsTab />}
      </div>
    </div>
  );
}
