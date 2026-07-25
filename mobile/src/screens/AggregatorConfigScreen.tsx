import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Switch, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { AggregatorIntegration, WebhookLog } from '../types';

type Platform = 'swiggy' | 'zomato';

const PLATFORM_META: Record<Platform, { label: string; color: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  swiggy: { label: 'Swiggy', color: '#FC8019', icon: 'delivery-dining' },
  zomato: { label: 'Zomato', color: '#CB202D', icon: 'delivery-dining' },
};

const LOG_STATUS_COLOR: Record<string, string> = {
  success:  Colors.success,
  failed:   Colors.danger,
  retrying: Colors.warning,
  pending:  Colors.textMuted,
};

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

type FormState = {
  enabled: boolean;
  storeId: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  autoAccept: boolean;
};

const emptyForm = (): FormState => ({
  enabled: false, storeId: '', apiKey: '', apiSecret: '', webhookSecret: '', autoAccept: false,
});

const integrationToForm = (i: AggregatorIntegration): FormState => ({
  enabled:       i.enabled,
  storeId:       i.storeId       || '',
  apiKey:        i.apiKey        || '',
  apiSecret:     i.apiSecret     || '',
  webhookSecret: i.webhookSecret || '',
  autoAccept:    i.autoAccept,
});

const AggregatorConfigScreen: React.FC = () => {
  const navigation = useNavigation();
  const { bottom, top } = useSafeAreaInsets();

  const [activePlatform, setActivePlatform] = useState<Platform>('swiggy');
  const [integrations, setIntegrations] = useState<Record<Platform, AggregatorIntegration | null>>({
    swiggy: null, zomato: null,
  });
  const [forms, setForms] = useState<Record<Platform, FormState>>({
    swiggy: emptyForm(), zomato: emptyForm(),
  });
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [retryingId, setRetryingId]   = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const { integrations: list } = await api.getAggregatorIntegrations();
      const map: Record<Platform, AggregatorIntegration | null> = { swiggy: null, zomato: null };
      const formMap: Record<Platform, FormState> = { swiggy: emptyForm(), zomato: emptyForm() };
      for (const itg of list) {
        const p = itg.platform as Platform;
        map[p]    = itg;
        formMap[p] = integrationToForm(itg);
      }
      setIntegrations(map);
      setForms(formMap);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load integrations');
    } finally { setLoading(false); }
  }, []);

  const loadWebhookLogs = useCallback(async (platform: Platform) => {
    setLogsLoading(true);
    try {
      const { logs } = await api.getWebhookLogs({ platform, limit: '20' });
      setWebhookLogs(logs);
    } catch { setWebhookLogs([]); }
    finally { setLogsLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    loadAll();
    loadWebhookLogs(activePlatform);
  }, [loadAll, loadWebhookLogs, activePlatform]));

  const handleSave = async () => {
    setSaving(true);
    try {
      const f = forms[activePlatform];
      const { integration } = await api.updateAggregatorIntegration(activePlatform, {
        enabled:       f.enabled,
        storeId:       f.storeId.trim(),
        apiKey:        f.apiKey.trim(),
        apiSecret:     f.apiSecret.trim(),
        webhookSecret: f.webhookSecret.trim(),
        autoAccept:    f.autoAccept,
      });
      setIntegrations(prev => ({ ...prev, [activePlatform]: integration }));
      Alert.alert('Saved', `${PLATFORM_META[activePlatform].label} configuration updated`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.syncAggregatorMenu(activePlatform);

      // Poll sync status until complete or 30 s timeout
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise<void>(r => setTimeout(r, 2_000));
        try {
          const { status } = await api.getAggregatorSyncStatus(activePlatform);
          setIntegrations(prev => {
            const cur = prev[activePlatform];
            if (!cur) return prev;
            return {
              ...prev,
              [activePlatform]: {
                ...cur,
                menuSyncStatus: status.menuSyncStatus as AggregatorIntegration['menuSyncStatus'],
                lastSyncAt: status.lastSyncAt,
                lastSyncError: status.lastSyncError,
                syncedItemCount: status.syncedItemCount,
                failedItemCount: status.failedItemCount,
              },
            };
          });
          if (status.menuSyncStatus === 'success' || status.menuSyncStatus === 'failed') break;
        } catch { /* poll error — keep trying until deadline */ }
      }
    } catch (e: any) {
      Alert.alert('Sync Error', e.message || 'Menu sync failed');
    } finally { setSyncing(false); }
  };

  const handleRetry = async (logId: string) => {
    setRetryingId(logId);
    try {
      await api.retryWebhook(logId);
      Alert.alert('Retried', 'Webhook re-processed successfully');
      loadWebhookLogs(activePlatform);
    } catch (e: any) {
      Alert.alert('Retry Failed', e.message || 'Could not retry webhook');
    } finally { setRetryingId(null); }
  };

  const setField = (field: keyof FormState, value: string | boolean) => {
    setForms(prev => ({
      ...prev,
      [activePlatform]: { ...prev[activePlatform], [field]: value },
    }));
  };

  const integration = integrations[activePlatform];
  const form        = forms[activePlatform];
  const meta        = PLATFORM_META[activePlatform];

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: top + Spacing.sm }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => (navigation as any).goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delivery Integration</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Platform tabs */}
      <View style={styles.tabRow}>
        {(['swiggy', 'zomato'] as Platform[]).map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.tab, activePlatform === p && styles.tabActive]}
            onPress={() => { setActivePlatform(p); loadWebhookLogs(p); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activePlatform === p && { color: PLATFORM_META[p].color, fontWeight: '800' }]}>
              {PLATFORM_META[p].label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Enabled + Auto Accept */}
          <View style={styles.section}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Enable {meta.label} Integration</Text>
                <Text style={styles.switchSub}>Receive and manage {meta.label} orders</Text>
              </View>
              <Switch
                value={form.enabled}
                onValueChange={v => setField('enabled', v)}
                trackColor={{ false: Colors.border, true: meta.color + '60' }}
                thumbColor={form.enabled ? meta.color : Colors.textMuted}
              />
            </View>
            <View style={[styles.switchRow, { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.md }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Auto-Accept Orders</Text>
                <Text style={styles.switchSub}>Automatically accept incoming orders</Text>
              </View>
              <Switch
                value={form.autoAccept}
                onValueChange={v => setField('autoAccept', v)}
                trackColor={{ false: Colors.border, true: Colors.success + '60' }}
                thumbColor={form.autoAccept ? Colors.success : Colors.textMuted}
              />
            </View>
          </View>

          {/* Credentials */}
          <Text style={styles.sectionHeader}>Credentials</Text>
          <View style={styles.section}>
            <Text style={styles.label}>Store ID</Text>
            <TextInput
              style={styles.input}
              value={form.storeId}
              onChangeText={v => setField('storeId', v)}
              placeholder={`Your ${meta.label} store ID`}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>API Key</Text>
            <TextInput
              style={styles.input}
              value={form.apiKey}
              onChangeText={v => setField('apiKey', v)}
              placeholder="API Key"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>API Secret</Text>
            <TextInput
              style={styles.input}
              value={form.apiSecret}
              onChangeText={v => setField('apiSecret', v)}
              placeholder="API Secret"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Text style={styles.label}>Webhook Secret</Text>
            <TextInput
              style={[styles.input, { marginBottom: 0 }]}
              value={form.webhookSecret}
              onChangeText={v => setField('webhookSecret', v)}
              placeholder="Webhook signing secret"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </View>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Text style={styles.saveBtnText}>Save {meta.label} Settings</Text>}
          </TouchableOpacity>

          {/* Sync */}
          <Text style={styles.sectionHeader}>Menu Sync</Text>
          <View style={styles.section}>
            {integration && (
              <View style={styles.syncStatus}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.syncStatusLabel}>
                    Status: <Text style={{ fontWeight: '800', color: integration.menuSyncStatus === 'success' ? Colors.success : integration.menuSyncStatus === 'failed' ? Colors.danger : Colors.textMuted }}>
                      {integration.menuSyncStatus}
                    </Text>
                  </Text>
                  {integration.lastSyncAt && (
                    <Text style={styles.syncDate}>Last sync: {fmtDate(integration.lastSyncAt)}</Text>
                  )}
                  {integration.lastSyncError && (
                    <Text style={[styles.syncDate, { color: Colors.danger }]} numberOfLines={2}>
                      {integration.lastSyncError}
                    </Text>
                  )}
                  <Text style={styles.syncDate}>
                    {integration.syncedItemCount} synced · {integration.failedItemCount} failed
                  </Text>
                </View>
              </View>
            )}
            <TouchableOpacity
              style={[styles.syncBtn, (!form.enabled || syncing) && { opacity: 0.5 }]}
              onPress={handleSync}
              disabled={!form.enabled || syncing}
              activeOpacity={0.85}
            >
              {syncing
                ? <ActivityIndicator size="small" color={Colors.white} />
                : (
                  <>
                    <MaterialIcons name="sync" size={18} color={Colors.white} />
                    <Text style={styles.syncBtnText}>Sync Menu Now</Text>
                  </>
                )}
            </TouchableOpacity>
          </View>

          {/* Webhook Logs */}
          <Text style={styles.sectionHeader}>Webhook Logs</Text>
          {logsLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
          ) : webhookLogs.length === 0 ? (
            <View style={[styles.section, { alignItems: 'center', paddingVertical: Spacing.xl }]}>
              <MaterialIcons name="check-circle-outline" size={32} color={Colors.success} />
              <Text style={{ color: Colors.textMuted, marginTop: Spacing.sm, fontSize: FontSize.sm }}>
                No webhook logs
              </Text>
            </View>
          ) : (
            <View style={styles.section}>
              {webhookLogs.map(log => (
                <View key={log._id} style={styles.logRow}>
                  <View style={[styles.logStatusDot, { backgroundColor: LOG_STATUS_COLOR[log.status] ?? Colors.textMuted }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.logStatus}>{log.status}</Text>
                    {log.orderId && <Text style={styles.logSub}>Order: {log.orderId}</Text>}
                    {log.errorMessage && (
                      <Text style={[styles.logSub, { color: Colors.danger }]} numberOfLines={2}>{log.errorMessage}</Text>
                    )}
                    <Text style={styles.logDate}>{fmtDate(log.createdAt)}</Text>
                  </View>
                  {log.status === 'failed' && (
                    <TouchableOpacity
                      style={[styles.retryBtn, retryingId === log._id && { opacity: 0.5 }]}
                      onPress={() => handleRetry(log._id)}
                      disabled={retryingId === log._id}
                    >
                      {retryingId === log._id
                        ? <ActivityIndicator size="small" color={Colors.primary} />
                        : <MaterialIcons name="replay" size={18} color={Colors.primary} />}
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn:       { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle:   { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },

  tabRow: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textMuted },

  content:       { padding: Spacing.lg },
  sectionHeader: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: Spacing.lg, marginBottom: Spacing.sm },

  section: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  switchRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  switchLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  switchSub:   { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  label: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xs, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    fontSize: FontSize.md, color: Colors.text,
    borderWidth: 1.5, borderColor: Colors.border, marginBottom: Spacing.sm,
  },

  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
    paddingVertical: 14, alignItems: 'center', marginVertical: Spacing.md,
    ...Shadows.primary,
  },
  saveBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  syncStatus:     { marginBottom: Spacing.md },
  syncStatusLabel: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  syncDate:       { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  syncBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.info, borderRadius: BorderRadius.lg, paddingVertical: 12,
  },
  syncBtnText:    { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  logRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  logStatusDot:  { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  logStatus:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, textTransform: 'capitalize' },
  logSub:        { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  logDate:       { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  retryBtn:      { padding: 6 },
});

export default AggregatorConfigScreen;
