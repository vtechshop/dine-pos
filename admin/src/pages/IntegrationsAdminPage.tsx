import { useEffect, useState, useCallback } from 'react';
import {
  Truck, RefreshCw, WifiOff, List, RotateCcw,
} from 'lucide-react';
import {
  SectionHeader, PageLoader, ErrorState, Badge, Btn,
  Modal, Toggle, ApiRequired, EmptyState,
} from '../components/ui';
import {
  fetchIntegrations, fetchWebhookLogs, syncMenu, retryWebhook,
  saveIntegration, disconnectIntegration,
} from '../api/aggregator';
import type { AggregatorIntegration, WebhookLog, AggregatorPlatform } from '../api/aggregator';

const STORE_ENDPOINTS = [
  'POST /aggregator/integrations/:platform/store-status  { status: "open"|"closed"|"busy"|"holiday" }',
  'POST /aggregator/integrations/:platform/pause-orders',
  'POST /aggregator/integrations/:platform/resume-orders',
  'GET  /aggregator/integrations/:platform/validate      — credential health check',
];

type MainTab = 'overview' | 'webhooks' | 'sync-logs';
const PLATFORM_COLOR: Record<string, string> = { swiggy: '#FC8019', zomato: '#E23744' };
const PLATFORM_EMOJI: Record<string, string> = { swiggy: '🛵', zomato: '🍕' };

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function IntegrationsAdminPage() {
  const [integrations, setIntegrations] = useState<AggregatorIntegration[]>([]);
  const [webhooks,     setWebhooks]     = useState<WebhookLog[]>([]);
  const [tab,          setTab]          = useState<MainTab>('overview');
  const [loading,      setLoading]      = useState(true);
  const [whLoading,    setWhLoading]    = useState(false);
  const [error,        setError]        = useState('');
  const [syncing,      setSyncing]      = useState<string | null>(null);
  const [syncResult,   setSyncResult]   = useState<{ platform: string; syncedCount: number; failedCount: number } | null>(null);
  const [editPlatform, setEditPlatform] = useState<AggregatorIntegration | null>(null);
  const [saving,       setSaving]       = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchIntegrations()
      .then(d => { setIntegrations(d); setLoading(false); })
      .catch(() => { setError('Failed to load integrations'); setLoading(false); });
  }, []);

  const loadWebhooks = useCallback(() => {
    setWhLoading(true);
    fetchWebhookLogs({ limit: 100 })
      .then(d => { setWebhooks(d); setWhLoading(false); })
      .catch(() => setWhLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'webhooks') loadWebhooks(); }, [tab, loadWebhooks]);

  const handleSync = async (platform: AggregatorPlatform) => {
    setSyncing(platform);
    try {
      const res = await syncMenu(platform);
      setSyncResult({ platform, syncedCount: res.syncedCount, failedCount: res.failedCount });
      load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(null);
    }
  };

  const handleToggleEnabled = async (integration: AggregatorIntegration) => {
    try {
      if (integration.enabled) {
        await disconnectIntegration(integration.platform);
      } else {
        await saveIntegration(integration.platform, { enabled: true });
      }
      load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Toggle failed');
    }
  };

  const handleSaveCredentials = async () => {
    if (!editPlatform) return;
    setSaving(true);
    try {
      await saveIntegration(editPlatform.platform, {
        storeId:       editPlatform.storeId,
        apiKey:        editPlatform.apiKey,
        apiSecret:     editPlatform.apiSecret,
        webhookSecret: editPlatform.webhookSecret,
        autoAccept:    editPlatform.autoAccept,
      });
      load();
      setEditPlatform(null);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRetryWebhook = async (id: string) => {
    try {
      await retryWebhook(id);
      loadWebhooks();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Retry failed');
    }
  };

  if (loading) return <PageLoader />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Swiggy & Zomato"
        sub="Aggregator integrations, menu sync, webhook management"
        action={
          <div className="flex gap-2">
            <Btn size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Btn>
          </div>
        }
      />

      {/* Store status banner */}
      <ApiRequired endpoints={STORE_ENDPOINTS} />

      {/* Tabs */}
      <div className="flex border-b border-[#E8D5C0]">
        {(['overview', 'webhooks', 'sync-logs'] as MainTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-[#E8380D] text-[#E8380D]' : 'border-transparent text-[#92745E] hover:text-[#1C0800]'
            }`}
          >
            {t === 'overview' ? 'Overview' : t === 'webhooks' ? 'Webhook Logs' : 'Sync Logs'}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {integrations.length === 0 ? (
            <EmptyState
              icon={<Truck className="h-10 w-10" />}
              title="No integrations configured"
              sub="Connect Swiggy or Zomato from Settings → Integrations in the POS app."
            />
          ) : (
            integrations.map(intg => {
              const color = PLATFORM_COLOR[intg.platform] ?? '#92745E';
              const emoji = PLATFORM_EMOJI[intg.platform] ?? '📦';
              return (
                <div key={intg._id} className="bg-white rounded-xl border border-[#E8D5C0] p-5 space-y-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: color + '18' }}>
                        {emoji}
                      </div>
                      <div>
                        <p className="font-black text-lg text-[#1C0800]">{intg.platform.toUpperCase()}</p>
                        <p className="text-xs text-[#92745E]">Store ID: {intg.storeId || 'Not configured'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Connection status */}
                      {intg.connectionStatus === 'connected'
                        ? <Badge label="Connected" variant="green" />
                        : intg.connectionStatus === 'error'
                          ? <Badge label="Error" variant="red" />
                          : <Badge label="Disconnected" variant="gray" />
                      }
                      {/* Enabled toggle */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#92745E] font-semibold">{intg.enabled ? 'Enabled' : 'Disabled'}</span>
                        <Toggle checked={intg.enabled} onChange={() => handleToggleEnabled(intg)} />
                      </div>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-[#FFF6EE] rounded-lg p-3">
                      <p className="text-xs text-[#92745E]">Last Order</p>
                      <p className="font-bold text-[#1C0800] text-sm mt-1">{fmtDate(intg.lastOrderAt)}</p>
                    </div>
                    <div className="bg-[#FFF6EE] rounded-lg p-3">
                      <p className="text-xs text-[#92745E]">Menu Sync</p>
                      <p className="font-bold text-[#1C0800] text-sm mt-1 capitalize">{intg.menuSyncStatus}</p>
                    </div>
                    <div className="bg-[#FFF6EE] rounded-lg p-3">
                      <p className="text-xs text-[#92745E]">Synced Items</p>
                      <p className="font-bold text-[#1C0800] text-sm mt-1">{intg.syncedItemCount}</p>
                    </div>
                    <div className="bg-[#FFF6EE] rounded-lg p-3">
                      <p className="text-xs text-[#92745E]">Failed Items</p>
                      <p className="font-bold text-[intg.failedItemCount > 0 ? '#DC2626' : '#1C0800'] text-sm mt-1">{intg.failedItemCount}</p>
                    </div>
                  </div>

                  {/* Sync status */}
                  {intg.lastSyncAt && (
                    <p className="text-xs text-[#92745E]">
                      Last synced: {fmtDate(intg.lastSyncAt)}
                      {intg.lastSyncError && <span className="text-red-600 ml-2">Error: {intg.lastSyncError}</span>}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-[#F5E8DB]">
                    <Btn size="sm" onClick={() => handleSync(intg.platform)} loading={syncing === intg.platform}>
                      <RefreshCw size={12} /> Sync Menu
                    </Btn>
                    <Btn size="sm" onClick={() => setEditPlatform({ ...intg })}>
                      Edit Credentials
                    </Btn>
                    {/* Store open/close — backend required */}
                    <Btn size="sm" disabled title="Requires POST /aggregator/integrations/:platform/store-status">
                      <WifiOff size={12} /> Close Store
                    </Btn>
                    <Btn size="sm" disabled title="Requires POST /aggregator/integrations/:platform/pause-orders">
                      Pause Orders
                    </Btn>
                    <Btn size="sm" disabled title="Requires GET /aggregator/integrations/:platform/validate">
                      Validate API
                    </Btn>
                  </div>

                  {/* Auto-accept toggle */}
                  <div className="flex items-center justify-between rounded-lg bg-[#FFF6EE] px-4 py-3">
                    <div>
                      <p className="font-semibold text-sm text-[#1C0800]">Auto-accept orders</p>
                      <p className="text-xs text-[#92745E]">Automatically accept incoming orders without manual review</p>
                    </div>
                    <Toggle
                      checked={intg.autoAccept}
                      onChange={async v => {
                        try {
                          await saveIntegration(intg.platform, { autoAccept: v });
                          load();
                        } catch { /* ignore */ }
                      }}
                    />
                  </div>
                </div>
              );
            })
          )}

          {/* Sync result */}
          {syncResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="font-bold text-green-800">
                {syncResult.platform.toUpperCase()} menu sync complete
              </p>
              <p className="text-sm text-green-700 mt-1">
                {syncResult.syncedCount} items synced · {syncResult.failedCount} failed
              </p>
              <Btn size="sm" onClick={() => setSyncResult(null)} className="mt-2">Dismiss</Btn>
            </div>
          )}
        </div>
      )}

      {/* Webhook logs */}
      {tab === 'webhooks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#92745E]">{webhooks.length} webhook events</p>
            <Btn size="sm" onClick={loadWebhooks} loading={whLoading}><RefreshCw size={12} /> Refresh</Btn>
          </div>
          {whLoading ? <PageLoader /> : webhooks.length === 0 ? (
            <EmptyState icon={<List className="h-8 w-8" />} title="No webhook logs" sub="Webhook events will appear here." />
          ) : (
            <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
                    {['Platform', 'Event', 'Order ID', 'Status', 'Retries', 'Time', 'Action'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map(wh => (
                    <tr key={wh._id} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                      <td className="px-4 py-3">
                        <span className="font-semibold" style={{ color: PLATFORM_COLOR[wh.platform] ?? '#92745E' }}>
                          {PLATFORM_EMOJI[wh.platform]} {wh.platform.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{wh.event}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[#92745E]">{wh.platformOrderId}</td>
                      <td className="px-4 py-3">
                        <Badge
                          label={wh.status}
                          variant={wh.status === 'success' ? 'green' : wh.status === 'retrying' ? 'amber' : 'red'}
                        />
                      </td>
                      <td className="px-4 py-3 text-[#92745E]">{wh.retryCount}</td>
                      <td className="px-4 py-3 text-[#92745E] text-xs whitespace-nowrap">{fmtDate(wh.createdAt)}</td>
                      <td className="px-4 py-3">
                        {wh.status !== 'success' && (
                          <Btn size="sm" onClick={() => handleRetryWebhook(wh._id)}>
                            <RotateCcw size={12} /> Retry
                          </Btn>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sync logs tab — backend required */}
      {tab === 'sync-logs' && (
        <ApiRequired endpoints={[
          'GET /aggregator/sync-logs?platform=&from=&to=   — detailed per-item sync history',
        ]} />
      )}

      {/* Edit credentials modal */}
      <Modal open={!!editPlatform} onClose={() => setEditPlatform(null)} title={`Edit ${editPlatform?.platform.toUpperCase()} Credentials`}>
        {editPlatform && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-[#92745E] uppercase tracking-wide">Store ID</label>
              <input
                className="mt-1 w-full rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm focus:outline-none focus:border-[#E8380D]"
                value={editPlatform.storeId}
                onChange={e => setEditPlatform(p => p && ({ ...p, storeId: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#92745E] uppercase tracking-wide">API Key</label>
              <input
                className="mt-1 w-full rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm focus:outline-none focus:border-[#E8380D]"
                value={editPlatform.apiKey}
                onChange={e => setEditPlatform(p => p && ({ ...p, apiKey: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#92745E] uppercase tracking-wide">API Secret</label>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm focus:outline-none focus:border-[#E8380D]"
                value={editPlatform.apiSecret}
                onChange={e => setEditPlatform(p => p && ({ ...p, apiSecret: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#92745E] uppercase tracking-wide">Webhook Secret</label>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm focus:outline-none focus:border-[#E8380D]"
                value={editPlatform.webhookSecret}
                onChange={e => setEditPlatform(p => p && ({ ...p, webhookSecret: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setEditPlatform(null)}>Cancel</Btn>
              <Btn variant="primary" loading={saving} onClick={handleSaveCredentials}>Save</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
