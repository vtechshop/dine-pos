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
import { TallySyncJob, TallySyncStatus, TallyLedgerMap } from '../services/api';
import { PremiumGate } from '../components/PremiumGate';
import { RootStackParamList } from '../types';

type Tab       = 'config' | 'jobs';
type JobFilter = TallySyncStatus | 'all';

// ── Colour maps ───────────────────────────────────────────────────────────────
const JOB_COLOR: Record<TallySyncStatus, string> = {
  pending: Colors.textMuted,
  syncing: Colors.info,
  synced:  Colors.success,
  failed:  Colors.danger,
  skipped: Colors.warning,
};

const JOB_BG: Record<TallySyncStatus, string> = {
  pending: 'rgba(196,160,144,0.18)',
  syncing: Colors.infoBg,
  synced:  Colors.successBg,
  failed:  Colors.dangerBg,
  skipped: Colors.warningBg,
};

const STATS_ORDER: TallySyncStatus[] = ['pending', 'syncing', 'synced', 'failed', 'skipped'];

const JOB_FILTERS: { label: string; value: JobFilter }[] = [
  { label: 'All',     value: 'all'     },
  { label: 'Pending', value: 'pending' },
  { label: 'Failed',  value: 'failed'  },
  { label: 'Synced',  value: 'synced'  },
];

const LEDGER_FIELDS: { key: keyof TallyLedgerMap; label: string }[] = [
  { key: 'salesLedger',       label: 'Sales'         },
  { key: 'cgstLedger',        label: 'CGST'          },
  { key: 'sgstLedger',        label: 'SGST'          },
  { key: 'cashLedger',        label: 'Cash'          },
  { key: 'bankLedger',        label: 'Bank'          },
  { key: 'discountLedger',    label: 'Discount'      },
  { key: 'roundOffLedger',    label: 'Round Off'     },
  { key: 'expenseLedger',     label: 'Expense'       },
  { key: 'purchaseLedger',    label: 'Purchase'      },
  { key: 'stockInHandLedger', label: 'Stock in Hand' },
  { key: 'walletLedger',      label: 'Wallet'        },
];

type LedgerForm = { [K in keyof TallyLedgerMap]: string };

const emptyLedgers = (): LedgerForm => ({
  salesLedger: '', cgstLedger: '', sgstLedger: '', cashLedger: '',
  bankLedger: '', discountLedger: '', roundOffLedger: '', expenseLedger: '',
  purchaseLedger: '', stockInHandLedger: '', walletLedger: '',
});

const fmtDate = (s: string) => {
  const d = new Date(s);
  return (
    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '  ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
};

// ── Inner screen ──────────────────────────────────────────────────────────────
const Inner: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bottom } = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<Tab>('config');

  // ── Configuration state ───────────────────────────────────────────────────
  const [configLoading, setConfigLoading]       = useState(true);
  const [saving, setSaving]                     = useState(false);
  const [enabled, setEnabled]                   = useState(false);
  const [companyName, setCompanyName]           = useState('');
  const [syncSales, setSyncSales]               = useState(true);
  const [syncPurchases, setSyncPurchases]       = useState(true);
  const [syncExpenses, setSyncExpenses]         = useState(true);
  const [syncCancellations, setSyncCancellations] = useState(true);
  const [ledgers, setLedgers]                   = useState<LedgerForm>(emptyLedgers);
  const [ledgersExpanded, setLedgersExpanded]   = useState(false);
  const [connectorTokenSet, setConnectorTokenSet]       = useState(false);
  const [connectorLastSeenAt, setConnectorLastSeenAt]   = useState<string | null>(null);

  // ── Sync Jobs state ───────────────────────────────────────────────────────
  const [stats, setStats]             = useState<Partial<Record<TallySyncStatus, number>>>({});
  const [jobFilter, setJobFilter]     = useState<JobFilter>('all');
  const [jobs, setJobs]               = useState<TallySyncJob[]>([]);
  const [jobPage, setJobPage]         = useState(1);
  const [jobPages, setJobPages]       = useState(1);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryingId, setRetryingId]   = useState<string | null>(null);

  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const cfg = await api.fetchTallyConfig();
      setEnabled(cfg.enabled);
      setCompanyName(cfg.companyName || '');
      setSyncSales(cfg.syncSales);
      setSyncPurchases(cfg.syncPurchases);
      setSyncExpenses(cfg.syncExpenses);
      setSyncCancellations(cfg.syncCancellations);
      setConnectorTokenSet(cfg.connectorTokenSet);
      setConnectorLastSeenAt(cfg.connectorLastSeenAt);
      const m = cfg.ledgerMap ?? {};
      setLedgers({
        salesLedger:       m.salesLedger       ?? '',
        cgstLedger:        m.cgstLedger        ?? '',
        sgstLedger:        m.sgstLedger        ?? '',
        cashLedger:        m.cashLedger        ?? '',
        bankLedger:        m.bankLedger        ?? '',
        discountLedger:    m.discountLedger    ?? '',
        roundOffLedger:    m.roundOffLedger    ?? '',
        expenseLedger:     m.expenseLedger     ?? '',
        purchaseLedger:    m.purchaseLedger    ?? '',
        stockInHandLedger: m.stockInHandLedger ?? '',
        walletLedger:      m.walletLedger      ?? '',
      });
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load Tally configuration');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const s = await api.fetchTallyStats();
      setStats(s);
    } catch { /* stats are non-critical */ }
  }, []);

  const loadJobs = useCallback(async (
    filter: JobFilter,
    page = 1,
    replace = true,
  ) => {
    if (replace) setJobsLoading(true);
    else         setLoadingMore(true);
    try {
      const { jobs: items, pages } = await api.fetchTallyJobs({
        status: filter === 'all' ? undefined : filter,
        page,
        limit: 20,
      });
      setJobs(prev => replace ? items : [...prev, ...items]);
      setJobPage(page);
      setJobPages(pages);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load sync jobs');
    } finally {
      setJobsLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadConfig();
    loadStats();
    loadJobs('all', 1, true);
    setJobFilter('all');
  }, [loadConfig, loadStats, loadJobs]));

  // ── Event handlers ────────────────────────────────────────────────────────
  const handleJobFilterChange = (f: JobFilter) => {
    setJobFilter(f);
    loadJobs(f, 1, true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveTallyConfig({
        enabled,
        companyName: companyName.trim(),
        syncSales,
        syncPurchases,
        syncExpenses,
        syncCancellations,
        ledgerMap: ledgers,
      });
      Alert.alert('Saved', 'Tally configuration updated');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setRetryingId(jobId);
    try {
      await api.retryTallyJob(jobId);
      Alert.alert('Retried', 'Job queued for retry');
      loadJobs(jobFilter, 1, true);
      loadStats();
    } catch (e: any) {
      Alert.alert('Retry Failed', e.message || 'Could not retry job');
    } finally {
      setRetryingId(null);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadStats();
    loadJobs(jobFilter, 1, true);
  };

  const handleLoadMore = () => {
    if (jobPage < jobPages && !loadingMore && !jobsLoading) {
      loadJobs(jobFilter, jobPage + 1, false);
    }
  };

  const setLedger = (key: keyof TallyLedgerMap, value: string) =>
    setLedgers(prev => ({ ...prev, [key]: value }));

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderConnectorBanner = () => {
    if (connectorTokenSet && connectorLastSeenAt) {
      return (
        <View style={[styles.banner, styles.bannerSuccess]}>
          <MaterialIcons name="check-circle" size={20} color={Colors.success} />
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <Text style={[styles.bannerTitle, { color: Colors.success }]}>Connector Active</Text>
            <Text style={[styles.bannerSub, { color: Colors.success }]}>
              Last seen {fmtDate(connectorLastSeenAt)}
            </Text>
          </View>
        </View>
      );
    }
    if (connectorTokenSet && !connectorLastSeenAt) {
      return (
        <View style={[styles.banner, styles.bannerWarning]}>
          <MaterialIcons name="warning" size={20} color={Colors.warning} />
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <Text style={[styles.bannerTitle, { color: Colors.warning }]}>
              Connector configured, not yet seen
            </Text>
            <Text style={[styles.bannerSub, { color: Colors.warning }]}>
              Start the Tally Connector app on the server
            </Text>
          </View>
        </View>
      );
    }
    return (
      <View style={[styles.banner, styles.bannerDanger]}>
        <MaterialIcons name="error-outline" size={20} color={Colors.danger} />
        <View style={{ flex: 1, marginLeft: Spacing.sm }}>
          <Text style={[styles.bannerTitle, { color: Colors.danger }]}>No connector configured</Text>
          <Text style={[styles.bannerSub, { color: Colors.danger }]}>
            Contact support to set up the Tally Connector
          </Text>
        </View>
      </View>
    );
  };

  const renderConfigTab = () => {
    if (configLoading) {
      return <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />;
    }

    const syncItems: Array<{
      label: string; sub: string;
      value: boolean; set: React.Dispatch<React.SetStateAction<boolean>>;
    }> = [
      { label: 'Sync Sales',        sub: 'Orders and invoices',      value: syncSales,         set: setSyncSales         },
      { label: 'Sync Purchases',    sub: 'Purchase invoices / GRN',  value: syncPurchases,     set: setSyncPurchases     },
      { label: 'Sync Expenses',     sub: 'Daily expense entries',    value: syncExpenses,      set: setSyncExpenses      },
      { label: 'Sync Cancellations',sub: 'Cancelled order vouchers', value: syncCancellations, set: setSyncCancellations },
    ];

    return (
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderConnectorBanner()}

        {/* Enable toggle */}
        <View style={styles.section}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Enable Tally Sync</Text>
              <Text style={styles.switchSub}>Sync transactions to Tally automatically</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ false: Colors.border, true: Colors.primary + '60' }}
              thumbColor={enabled ? Colors.primary : Colors.textMuted}
            />
          </View>
        </View>

        {/* Company name */}
        <Text style={styles.sectionHeader}>Company</Text>
        <View style={styles.section}>
          <Text style={styles.label}>Company Name</Text>
          <TextInput
            style={[styles.input, { marginBottom: 0 }]}
            value={companyName}
            onChangeText={setCompanyName}
            placeholder="Tally company name (exact match)"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Sync toggles */}
        <Text style={styles.sectionHeader}>What to Sync</Text>
        <View style={styles.section}>
          {syncItems.map((item, idx) => (
            <View
              key={item.label}
              style={[
                styles.switchRow,
                idx < syncItems.length - 1 && styles.switchRowDivider,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>{item.label}</Text>
                <Text style={styles.switchSub}>{item.sub}</Text>
              </View>
              <Switch
                value={item.value}
                onValueChange={item.set}
                trackColor={{ false: Colors.border, true: Colors.primary + '60' }}
                thumbColor={item.value ? Colors.primary : Colors.textMuted}
              />
            </View>
          ))}
        </View>

        {/* Ledger map (collapsible) */}
        <TouchableOpacity
          style={styles.collapsibleHeader}
          onPress={() => setLedgersExpanded(v => !v)}
          activeOpacity={0.8}
        >
          <Text style={styles.sectionHeader}>Ledger Mapping</Text>
          <MaterialIcons
            name={ledgersExpanded ? 'expand-less' : 'expand-more'}
            size={22}
            color={Colors.textMuted}
          />
        </TouchableOpacity>

        {ledgersExpanded && (
          <View style={styles.section}>
            {LEDGER_FIELDS.map((f, idx) => (
              <View key={f.key}>
                <Text style={styles.label}>{f.label} Ledger</Text>
                <TextInput
                  style={[
                    styles.input,
                    idx === LEDGER_FIELDS.length - 1 && { marginBottom: 0 },
                  ]}
                  value={ledgers[f.key]}
                  onChangeText={v => setLedger(f.key, v)}
                  placeholder={`${f.label} ledger name in Tally`}
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ))}
          </View>
        )}

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
              <Text style={styles.saveBtnText}>Save Configuration</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    );
  };

  const renderJobCard = ({ item }: { item: TallySyncJob }) => {
    const color    = JOB_COLOR[item.status];
    const bg       = JOB_BG[item.status];
    const canRetry = item.status === 'failed';
    return (
      <View style={styles.card}>
        <View style={styles.cardTopRow}>
          <View style={{ flex: 1, marginRight: Spacing.sm }}>
            <View style={styles.entityRow}>
              <View style={[styles.entityBadge, { backgroundColor: Colors.infoBg, borderColor: Colors.info + '40' }]}>
                <Text style={[styles.entityBadgeText, { color: Colors.info }]}>
                  {item.entityType.replace(/_/g, ' ')}
                </Text>
              </View>
              <Text style={styles.entityId} numberOfLines={1}>{item.entityId}</Text>
            </View>
            {item.voucherNumber ? (
              <Text style={styles.voucherText}>Voucher: {item.voucherNumber}</Text>
            ) : null}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: bg, borderColor: color + '40' }]}>
            <Text style={[styles.statusText, { color }]}>{item.status}</Text>
          </View>
        </View>

        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>
            {item.attemptCount} attempt{item.attemptCount !== 1 ? 's' : ''}
          </Text>
          <Text style={styles.cardMetaText}>
            {item.lastAttemptAt ? fmtDate(item.lastAttemptAt) : fmtDate(item.createdAt)}
          </Text>
        </View>

        {item.status === 'failed' && item.errorReason ? (
          <Text style={styles.failureReason} numberOfLines={1}>{item.errorReason}</Text>
        ) : null}

        {canRetry ? (
          <TouchableOpacity
            style={[styles.retryRowBtn, retryingId === item._id && { opacity: 0.5 }]}
            onPress={() => handleRetryJob(item._id)}
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

  const renderJobsTab = () => (
    <View style={{ flex: 1 }}>
      {/* Stats row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statsRow}
        style={styles.statsScroll}
      >
        {STATS_ORDER.map(s => {
          const count = stats[s] ?? 0;
          const color = JOB_COLOR[s];
          const bg    = JOB_BG[s];
          return (
            <View key={s} style={[styles.statsPill, { backgroundColor: bg, borderColor: color + '40' }]}>
              <Text style={[styles.statsCount, { color }]}>{count}</Text>
              <Text style={[styles.statsLabel, { color }]}>{s}</Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {JOB_FILTERS.map(f => (
          <TouchableOpacity
            key={f.value}
            style={[styles.chip, jobFilter === f.value && styles.chipActive]}
            onPress={() => handleJobFilterChange(f.value)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, jobFilter === f.value && styles.chipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {jobsLoading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={jobs}
          renderItem={renderJobCard}
          keyExtractor={j => j._id}
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
              <MaterialIcons name="sync" size={52} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No sync jobs</Text>
              <Text style={styles.emptySub}>Tally sync jobs will appear here</Text>
            </View>
          }
          ListFooterComponent={
            jobPage < jobPages ? (
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
        <Text style={styles.headerTitle}>Tally Direct Sync</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['config', 'jobs'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, activeTab === t && styles.tabActive]}
            onPress={() => setActiveTab(t)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t === 'config' ? 'Configuration' : 'Sync Jobs'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'config' ? renderConfigTab() : renderJobsTab()}
    </View>
  );
};

// ── Screen export wrapped in PremiumGate ──────────────────────────────────────
const TallyConfigScreen: React.FC = () => (
  <PremiumGate feature="Tally Direct Sync">
    <Inner />
  </PremiumGate>
);

export default TallyConfigScreen;

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

  // Config tab
  content:       { padding: Spacing.lg },
  sectionHeader: {
    fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: Spacing.lg, marginBottom: Spacing.sm,
  },
  collapsibleHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: Spacing.lg, marginBottom: Spacing.sm,
  },
  section: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  switchRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  switchRowDivider: {
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingBottom: Spacing.md, marginBottom: Spacing.md,
  },
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
  bannerDanger:  { backgroundColor: Colors.dangerBg,  borderColor: Colors.danger  + '50' },
  bannerTitle:   { fontSize: FontSize.md, fontWeight: '700' },
  bannerSub:     { fontSize: FontSize.xs, marginTop: 2 },

  // Jobs tab
  statsScroll: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  statsRow:  { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  statsPill: {
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: BorderRadius.md, borderWidth: 1,
    alignItems: 'center', minWidth: 72,
  },
  statsCount: { fontSize: FontSize.xl, fontWeight: '900', lineHeight: 26 },
  statsLabel: { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'capitalize', marginTop: 1 },

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
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.xs },
  entityRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 4 },
  entityBadge: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius: BorderRadius.md, borderWidth: 1,
  },
  entityBadgeText: { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'capitalize' },
  entityId:        { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  voucherText:     { fontSize: FontSize.xs, color: Colors.textMuted },
  statusBadge: {
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderRadius: BorderRadius.md, borderWidth: 1,
  },
  statusText:    { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'capitalize' },
  cardMeta:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
  cardMetaText:  { fontSize: FontSize.xs, color: Colors.textMuted },
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
