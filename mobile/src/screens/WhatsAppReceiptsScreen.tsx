import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Switch, RefreshControl, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { WARStatus, WhatsAppReceiptRecord } from '../services/api';
import { PremiumGate } from '../components/PremiumGate';
import { RootStackParamList } from '../types';

type Tab           = 'settings' | 'history';
type HistoryFilter = WARStatus | 'all';

// ── Status colour maps ────────────────────────────────────────────────────────
const STATUS_COLOR: Record<WARStatus, string> = {
  queued:    Colors.textMuted,
  sending:   Colors.info,
  sent:      Colors.info,
  delivered: Colors.success,
  read:      Colors.success,
  failed:    Colors.danger,
  skipped:   Colors.warning,
};

const STATUS_BG: Record<WARStatus, string> = {
  queued:    'rgba(196,160,144,0.18)',
  sending:   Colors.infoBg,
  sent:      Colors.infoBg,
  delivered: Colors.successBg,
  read:      Colors.successBg,
  failed:    Colors.dangerBg,
  skipped:   Colors.warningBg,
};

const FILTERS: { label: string; value: HistoryFilter }[] = [
  { label: 'All',       value: 'all'       },
  { label: 'Queued',    value: 'queued'    },
  { label: 'Sent',      value: 'sent'      },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Failed',    value: 'failed'    },
];

const fmtDate = (s: string) => {
  const d = new Date(s);
  return (
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '  ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
};

// ── Inner screen (rendered only when isPremium) ───────────────────────────────
const Inner: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bottom } = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<Tab>('settings');

  // ── Settings state ────────────────────────────────────────────────────────
  const [configLoading, setConfigLoading]       = useState(true);
  const [saving, setSaving]                     = useState(false);
  const [autoSend, setAutoSend]                 = useState(false);
  const [templateName, setTemplateName]         = useState('');
  const [templateLanguage, setTemplateLanguage] = useState('');
  const [provider, setProvider] = useState<{
    configured: boolean; providerType?: string; integratedNumber?: string;
  } | null>(null);

  // ── History state ─────────────────────────────────────────────────────────
  const [historyFilter, setHistoryFilter]   = useState<HistoryFilter>('all');
  const [receipts, setReceipts]             = useState<WhatsAppReceiptRecord[]>([]);
  const [historyPage, setHistoryPage]       = useState(1);
  const [historyPages, setHistoryPages]     = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshing, setRefreshing]         = useState(false);
  const [loadingMore, setLoadingMore]       = useState(false);
  const [retryingId, setRetryingId]         = useState<string | null>(null);

  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    setConfigLoading(true);
    try {
      const { config, provider: p } = await api.fetchWhatsAppReceiptSettings();
      setAutoSend(config.autoSend);
      setTemplateName(config.templateName);
      setTemplateLanguage(config.templateLanguage);
      setProvider(p);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load settings');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (
    filter: HistoryFilter,
    page = 1,
    replace = true,
  ) => {
    if (replace) setHistoryLoading(true);
    else         setLoadingMore(true);
    try {
      const { receipts: items, pages } = await api.fetchWhatsAppReceipts({
        page,
        limit: 20,
        status: filter === 'all' ? undefined : filter,
      });
      setReceipts(prev => replace ? items : [...prev, ...items]);
      setHistoryPage(page);
      setHistoryPages(pages);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load receipts');
    } finally {
      setHistoryLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadSettings();
    loadHistory('all', 1, true);
    setHistoryFilter('all');
  }, [loadSettings, loadHistory]));

  // ── Event handlers ────────────────────────────────────────────────────────
  const handleFilterChange = (f: HistoryFilter) => {
    setHistoryFilter(f);
    loadHistory(f, 1, true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveWhatsAppReceiptSettings({ autoSend, templateName, templateLanguage });
      Alert.alert('Saved', 'WhatsApp receipt settings updated');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      await api.retryWhatsAppReceipt(id);
      Alert.alert('Retried', 'Receipt queued for retry');
      loadHistory(historyFilter, 1, true);
    } catch (e: any) {
      Alert.alert('Retry Failed', e.message || 'Could not retry');
    } finally {
      setRetryingId(null);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadHistory(historyFilter, 1, true);
  };

  const handleLoadMore = () => {
    if (historyPage < historyPages && !loadingMore && !historyLoading) {
      loadHistory(historyFilter, historyPage + 1, false);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderProviderBanner = () => {
    if (!provider) return null;
    const ok = provider.configured;
    return (
      <View style={[styles.banner, ok ? styles.bannerSuccess : styles.bannerWarning]}>
        <MaterialIcons
          name={ok ? 'check-circle' : 'warning'}
          size={20}
          color={ok ? Colors.success : Colors.warning}
        />
        <View style={{ flex: 1, marginLeft: Spacing.sm }}>
          <Text style={[styles.bannerTitle, { color: ok ? Colors.success : Colors.warning }]}>
            {ok ? 'MSG91 Connected' : 'Provider not configured'}
          </Text>
          <Text style={[styles.bannerSub, { color: ok ? Colors.success : Colors.warning }]}>
            {ok
              ? (provider.integratedNumber ?? provider.providerType ?? 'Active')
              : 'Contact support to set up MSG91'}
          </Text>
        </View>
      </View>
    );
  };

  const renderSettingsTab = () => {
    if (configLoading) {
      return <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />;
    }
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderProviderBanner()}

        {/* Auto-send toggle */}
        <View style={styles.section}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Auto-send WhatsApp receipts</Text>
              <Text style={styles.switchSub}>Automatically send receipt after each order</Text>
            </View>
            <Switch
              value={autoSend}
              onValueChange={setAutoSend}
              trackColor={{ false: Colors.border, true: Colors.whatsApp + '60' }}
              thumbColor={autoSend ? Colors.whatsApp : Colors.textMuted}
            />
          </View>
        </View>

        {/* Template settings */}
        <Text style={styles.sectionHeader}>Template Settings</Text>
        <View style={styles.section}>
          <Text style={styles.label}>Template Name</Text>
          <TextInput
            style={styles.input}
            value={templateName}
            onChangeText={setTemplateName}
            placeholder="e.g. order_receipt_v1"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.label}>Template Language</Text>
          <TextInput
            style={[styles.input, { marginBottom: 0 }]}
            value={templateLanguage}
            onChangeText={setTemplateLanguage}
            placeholder="en"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <>
              <MaterialIcons name="save" size={18} color={Colors.white} />
              <Text style={styles.saveBtnText}>Save Settings</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    );
  };

  const renderHistoryCard = ({ item }: { item: WhatsAppReceiptRecord }) => {
    const color    = STATUS_COLOR[item.status];
    const bg       = STATUS_BG[item.status];
    const canRetry = item.status === 'failed' && item.attemptCount < item.maxAttempts;
    return (
      <View style={styles.card}>
        <View style={styles.cardTopRow}>
          <View style={{ flex: 1, marginRight: Spacing.sm }}>
            <Text style={styles.cardPhone}>{item.maskedPhone}</Text>
            <Text style={styles.cardPurpose} numberOfLines={1}>{item.purpose}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: bg, borderColor: color + '40' }]}>
            <Text style={[styles.statusText, { color }]}>{item.status}</Text>
          </View>
        </View>

        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>{fmtDate(item.createdAt)}</Text>
          <Text style={styles.cardMetaText}>
            {item.attemptCount}/{item.maxAttempts} attempts
          </Text>
        </View>

        {item.status === 'failed' && item.failureReason ? (
          <Text style={styles.failureReason} numberOfLines={1}>{item.failureReason}</Text>
        ) : null}

        {canRetry ? (
          <TouchableOpacity
            style={[styles.retryRowBtn, retryingId === item._id && { opacity: 0.5 }]}
            onPress={() => handleRetry(item._id)}
            disabled={retryingId === item._id}
            activeOpacity={0.8}
          >
            {retryingId === item._id ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <MaterialIcons name="refresh" size={16} color={Colors.primary} />
            )}
            <Text style={styles.retryRowBtnText}>
              {retryingId === item._id ? 'Retrying…' : 'Retry'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const renderHistoryTab = () => (
    <View style={{ flex: 1 }}>
      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.value}
            style={[styles.chip, historyFilter === f.value && styles.chipActive]}
            onPress={() => handleFilterChange(f.value)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, historyFilter === f.value && styles.chipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {historyLoading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={receipts}
          renderItem={renderHistoryCard}
          keyExtractor={r => r._id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <MaterialIcons name="chat-bubble-outline" size={52} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No receipt records yet</Text>
              <Text style={styles.emptySub}>WhatsApp receipts will appear here once sent</Text>
            </View>
          }
          ListFooterComponent={
            historyPage < historyPages ? (
              <TouchableOpacity
                style={[styles.loadMoreBtn, loadingMore && { opacity: 0.6 }]}
                onPress={handleLoadMore}
                disabled={loadingMore}
                activeOpacity={0.85}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Text style={styles.loadMoreText}>Load More</Text>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  );

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Spacing.sm }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={28} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>WhatsApp Receipts</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['settings', 'history'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, activeTab === t && styles.tabActive]}
            onPress={() => setActiveTab(t)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t === 'settings' ? 'Settings' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'settings' ? renderSettingsTab() : renderHistoryTab()}
    </View>
  );
};

// ── Screen export wrapped in PremiumGate ──────────────────────────────────────
const WhatsAppReceiptsScreen: React.FC = () => (
  <PremiumGate feature="WhatsApp Receipts">
    <Inner />
  </PremiumGate>
);

export default WhatsAppReceiptsScreen;

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn:     { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },

  tabRow: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab:          { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText:      { fontSize: FontSize.md, fontWeight: '600', color: Colors.textMuted },
  tabTextActive:{ color: Colors.primary, fontWeight: '800' },

  // Settings tab
  content:       { padding: Spacing.lg },
  sectionHeader: {
    fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: Spacing.lg, marginBottom: Spacing.sm,
  },
  section: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  switchRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  switchLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  switchSub:   { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  label: {
    fontSize: FontSize.sm, fontWeight: '700', color: Colors.text,
    marginBottom: Spacing.xs, marginTop: Spacing.md,
  },
  input: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    fontSize: FontSize.md, color: Colors.text,
    borderWidth: 1.5, borderColor: Colors.border, marginBottom: Spacing.sm,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
    paddingVertical: 14, marginTop: Spacing.md, ...Shadows.primary,
  },
  saveBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  banner: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: BorderRadius.lg, padding: Spacing.md,
    marginBottom: Spacing.md, borderWidth: 1,
  },
  bannerSuccess: { backgroundColor: Colors.successBg, borderColor: Colors.success + '50' },
  bannerWarning: { backgroundColor: Colors.warningBg, borderColor: Colors.warning + '50' },
  bannerTitle:   { fontSize: FontSize.md, fontWeight: '700' },
  bannerSub:     { fontSize: FontSize.xs, marginTop: 2 },

  // History tab
  filterScroll: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  filterRow:     { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.round, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive:     { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  chipText:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  chipTextActive: { color: Colors.primary, fontWeight: '700' },

  listContent: { padding: Spacing.lg, paddingBottom: 32 },
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  cardTopRow:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.xs },
  cardPhone:    { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  cardPurpose:  { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderRadius: BorderRadius.md, borderWidth: 1,
  },
  statusText:   { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'capitalize' },
  cardMeta:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
  cardMetaText: { fontSize: FontSize.xs, color: Colors.textMuted },
  failureReason: {
    fontSize: FontSize.xs, color: Colors.danger,
    marginTop: Spacing.xs, fontStyle: 'italic',
  },
  retryRowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: Colors.primary + '50',
    backgroundColor: Colors.primaryBg,
  },
  retryRowBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },

  emptyWrap:  { alignItems: 'center', paddingTop: 60, gap: Spacing.md },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub:   {
    fontSize: FontSize.sm, color: Colors.textMuted,
    textAlign: 'center', paddingHorizontal: Spacing.xxl,
  },
  loadMoreBtn: {
    alignItems: 'center', paddingVertical: 13,
    borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.xl,
  },
  loadMoreText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textSecondary },
});
