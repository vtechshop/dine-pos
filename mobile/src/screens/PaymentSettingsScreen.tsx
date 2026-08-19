import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, BorderRadius, Spacing } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import {
  getGatewayConfigs, getPayments, getPaymentStats,
  type MobileGatewayConfig, type MobilePaymentRecord, type MobilePaymentReport,
} from '../services/api';
import type { RootStackParamList } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'gateways' | 'transactions' | 'reports';

const TABS: { key: Tab; label: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[] = [
  { key: 'gateways',     label: 'Gateways',     icon: 'settings'         },
  { key: 'transactions', label: 'Transactions',  icon: 'receipt-long'     },
  { key: 'reports',      label: 'Reports',       icon: 'bar-chart'        },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const GATEWAY_LABELS: Record<string, string> = {
  razorpay: 'Razorpay', cashfree: 'Cashfree', phonepe: 'PhonePe',
  payu: 'PayU', paytm: 'Paytm', bharatpe: 'BharatPe',
};

const STATUS_COLORS: Record<string, string> = {
  success:          Colors.success ?? '#2E7D32',
  failed:           Colors.danger,
  pending:          Colors.warning ?? '#F57C00',
  processing:       Colors.primary,
  cancelled:        Colors.textSecondary,
  refunded:         '#6A1B9A',
  partial_refunded: Colors.accent,
};

function fmtRs(n: number, sym = '₹') {
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDt(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtPct(n: number) { return `${n.toFixed(1)}%`; }

function defaultFrom() {
  const d = new Date(Date.now() - 29 * 86_400_000);
  return d.toLocaleDateString('en-CA');
}
function defaultTo() {
  return new Date().toLocaleDateString('en-CA');
}

// ── KPI Row ───────────────────────────────────────────────────────────────────

function KPIRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={s.kpiRow}>
      {items.map(it => (
        <View key={it.label} style={s.kpiCard}>
          <Text style={s.kpiLabel}>{it.label}</Text>
          <Text style={s.kpiValue}>{it.value}</Text>
        </View>
      ))}
    </View>
  );
}

function SectionHead({ title }: { title: string }) {
  return <Text style={s.sectionHead}>{title}</Text>;
}

// ── Tab: Gateways ─────────────────────────────────────────────────────────────

function GatewaysTab() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data,    setData]    = useState<MobileGatewayConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setErr('');
    try { setData(await getGatewayConfigs()); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <ActivityIndicator style={s.center} color={Colors.primary} />;

  // Find the Razorpay gateway config if one is returned by the list endpoint
  const razorpayConfig = data.find(c => c.gatewayType === 'razorpay');

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      showsVerticalScrollIndicator={false}
    >
      {err ? <Text style={s.errText}>{err}</Text> : null}

      {/* Razorpay OAuth banner — always visible so the admin can manage the connection */}
      <TouchableOpacity
        style={[s.oauthBanner, razorpayConfig?.isOAuthConnected ? s.oauthBannerConnected : s.oauthBannerDisconnected]}
        onPress={() => nav.navigate('RazorpayOAuth')}
        activeOpacity={0.8}
      >
        <View style={s.oauthBannerLeft}>
          <MaterialIcons
            name={razorpayConfig?.isOAuthConnected ? 'verified' : 'link'}
            size={20}
            color={razorpayConfig?.isOAuthConnected ? Colors.success ?? '#2E7D32' : Colors.primary}
          />
          <View>
            <Text style={s.oauthBannerTitle}>Razorpay OAuth</Text>
            <Text style={s.oauthBannerSub}>
              {razorpayConfig?.isOAuthConnected
                ? `Connected · ${razorpayConfig.oauthConnectedAccountId ?? 'account linked'}`
                : 'Connect via Technology Partner OAuth'}
            </Text>
          </View>
        </View>
        <MaterialIcons name="chevron-right" size={20} color={Colors.textSecondary} />
      </TouchableOpacity>

      {data.length === 0 && !err && (
        <Text style={s.empty}>No gateways configured.{'\n'}Add one from the web admin panel.</Text>
      )}

      {data.map(c => (
        <View key={c._id} style={[s.card, c.isActive && s.cardActive]}>
          <View style={s.cardRow}>
            <View style={[s.gwIcon, c.isActive && s.gwIconActive]}>
              <MaterialIcons name="credit-card" size={20} color={c.isActive ? '#fff' : Colors.textSecondary} />
            </View>
            <View style={s.cardInfo}>
              <Text style={s.cardTitle}>{c.displayName}</Text>
              <Text style={s.cardSub}>{GATEWAY_LABELS[c.gatewayType] ?? c.gatewayType} · {c.environment}</Text>
              {c.merchantId ? <Text style={s.cardMuted}>Merchant: {c.merchantId}</Text> : null}
            </View>
            <View style={[s.statusBadge, c.isActive ? s.statusActive : s.statusInactive]}>
              <Text style={[s.statusText, { color: c.isActive ? Colors.success ?? '#2E7D32' : Colors.textSecondary }]}>
                {c.isActive ? 'ACTIVE' : 'OFF'}
              </Text>
            </View>
          </View>

          <View style={s.pillRow}>
            {!c.isIntegrated && (
              <View style={s.pill}>
                <Text style={s.pillText}>SDK Pending</Text>
              </View>
            )}
            {c.testResult?.lastTestedAt && (
              <View style={[s.pill, c.testResult.success ? s.pillGreen : s.pillRed]}>
                <Text style={[s.pillText, { color: c.testResult.success ? Colors.success ?? '#2E7D32' : Colors.danger }]}>
                  {c.testResult.success ? '✓ Test OK' : '✗ Test Failed'}
                </Text>
              </View>
            )}
            {c.gatewayType === 'razorpay' && c.isOAuthConnected && (
              <View style={[s.pill, s.pillGreen]}>
                <Text style={[s.pillText, { color: Colors.success ?? '#2E7D32' }]}>OAuth</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Tab: Transactions ─────────────────────────────────────────────────────────

function TransactionsTab() {
  const { settings } = useSettings();
  const sym = settings.currencySymbol || '₹';
  const [data,    setData]    = useState<MobilePaymentRecord[]>([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [page,    setPage]    = useState(1);
  const [filter,  setFilter]  = useState<'all' | 'success' | 'failed' | 'pending'>('all');

  const load = useCallback(async (pg = 1, refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(pg === 1);
    setErr('');
    try {
      const res = await getPayments({
        from: defaultFrom(), to: defaultTo(),
        status: filter === 'all' ? undefined : filter,
        page: pg, limit: 20,
      });
      setData(pg === 1 ? res.payments : prev => [...prev, ...res.payments]);
      setTotal(res.total);
      setPage(pg);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [filter]);

  useEffect(() => { load(1); }, [load]);

  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all',     label: 'All'     },
    { key: 'success', label: 'Success' },
    { key: 'failed',  label: 'Failed'  },
    { key: 'pending', label: 'Pending' },
  ];

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, true)} />}
      showsVerticalScrollIndicator={false}
    >
      {/* Filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
        {filters.map(f => (
          <TouchableOpacity
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[s.filterPill, filter === f.key && s.filterPillActive]}
          >
            <Text style={[s.filterPillText, filter === f.key && s.filterPillTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {err ? <Text style={s.errText}>{err}</Text> : null}
      {loading ? <ActivityIndicator style={s.center} color={Colors.primary} /> : null}

      {!loading && data.length === 0 && !err && (
        <Text style={s.empty}>No transactions found for this period.</Text>
      )}

      {data.map(p => (
        <View key={p._id} style={s.card}>
          <View style={s.cardRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.txId} numberOfLines={1}>{p.internalTransactionId}</Text>
              <Text style={s.cardSub}>{GATEWAY_LABELS[p.gatewayType] ?? p.gatewayType} · {p.paymentMethod?.toUpperCase()}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.txAmount}>{fmtRs(p.amount, sym)}</Text>
              <View style={[s.statusBadge, { borderColor: STATUS_COLORS[p.status] + '40', backgroundColor: STATUS_COLORS[p.status] + '15' }]}>
                <Text style={[s.statusText, { color: STATUS_COLORS[p.status] }]}>
                  {p.status.replace(/_/g, ' ').toUpperCase()}
                </Text>
              </View>
            </View>
          </View>
          <Text style={s.cardMuted}>{fmtDt(p.createdAt)}</Text>
          {p.refundedAmount > 0 && (
            <Text style={s.refundBadge}>Refunded: {fmtRs(p.refundedAmount, sym)}</Text>
          )}
        </View>
      ))}

      {!loading && data.length < total && (
        <TouchableOpacity onPress={() => load(page + 1)} style={s.loadMore}>
          <Text style={s.loadMoreText}>Load More ({total - data.length} remaining)</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ── Tab: Reports ──────────────────────────────────────────────────────────────

function ReportsTab() {
  const { settings } = useSettings();
  const sym = settings.currencySymbol || '₹';
  const [report,  setReport]  = useState<MobilePaymentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setErr('');
    try { setReport(await getPaymentStats({ from: defaultFrom(), to: defaultTo() })); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <ActivityIndicator style={s.center} color={Colors.primary} />;

  const maxBar = report ? Math.max(...report.dailyTrend.map(d => d.amount), 1) : 1;

  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      showsVerticalScrollIndicator={false}
    >
      {err ? <Text style={s.errText}>{err}</Text> : null}

      {report && (
        <>
          <KPIRow items={[
            { label: 'Total Txns',   value: String(report.summary.total) },
            { label: 'Collection',   value: fmtRs(report.summary.totalAmount, sym) },
          ]} />
          <KPIRow items={[
            { label: 'Success Rate', value: fmtPct(report.summary.successRate) },
            { label: 'Refunded',     value: fmtRs(report.summary.refundedAmount, sym) },
          ]} />
          <KPIRow items={[
            { label: 'Success',      value: String(report.summary.successCount) },
            { label: 'Failed',       value: String(report.summary.failedCount) },
          ]} />

          {report.byGateway.length > 0 && (
            <>
              <SectionHead title="Gateway Breakdown" />
              {report.byGateway.map(g => {
                const pct = report.summary.totalAmount > 0 ? (g.amount / report.summary.totalAmount) * 100 : 0;
                return (
                  <View key={g.gatewayType} style={s.barRow}>
                    <Text style={s.barLabel}>{GATEWAY_LABELS[g.gatewayType] ?? g.gatewayType}</Text>
                    <View style={s.barTrack}>
                      <View style={[s.barFill, { width: `${pct}%` as `${number}%` }]} />
                    </View>
                    <Text style={s.barValue}>{fmtRs(g.amount, sym)}</Text>
                  </View>
                );
              })}
            </>
          )}

          {report.byMethod.length > 0 && (
            <>
              <SectionHead title="Payment Methods" />
              {report.byMethod.map(m => (
                <View key={m.method} style={s.methodRow}>
                  <Text style={s.methodLabel}>{m.method.toUpperCase()}</Text>
                  <Text style={s.methodCount}>{m.count} txns</Text>
                  <Text style={s.methodAmount}>{fmtRs(m.amount, sym)}</Text>
                </View>
              ))}
            </>
          )}

          {report.dailyTrend.length > 0 && (
            <>
              <SectionHead title="30-Day Trend" />
              <View style={s.trendWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={s.trendInner}>
                    {report.dailyTrend.map(d => {
                      const h = Math.max((d.amount / maxBar) * 60, 2);
                      return (
                        <View key={d.date} style={s.trendBar}>
                          <View style={{ height: 60, justifyContent: 'flex-end' }}>
                            <View style={[s.trendFill, { height: h }]} />
                          </View>
                          <Text style={s.trendLabel}>{d.date.slice(5)}</Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function PaymentSettingsScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('gateways');

  return (
    <View style={[s.container, { paddingBottom: insets.bottom }]}>
      {/* Tab bar */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tabItem, tab === t.key && s.tabItemActive]}
            onPress={() => setTab(t.key)}
          >
            <MaterialIcons
              name={t.icon}
              size={18}
              color={tab === t.key ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <View style={s.content}>
        {tab === 'gateways'     && <GatewaysTab />}
        {tab === 'transactions' && <TransactionsTab />}
        {tab === 'reports'      && <ReportsTab />}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: Colors.background },
  tabBar:         { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabItem:        { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, gap: 2 },
  tabItemActive:  { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabLabel:       { fontSize: FontSize.xs, color: Colors.textSecondary },
  tabLabelActive: { color: Colors.primary, fontWeight: '600' },
  content:        { flex: 1, padding: Spacing.md },

  center:  { marginTop: Spacing.xl },
  errText: { color: Colors.danger, textAlign: 'center', fontSize: FontSize.sm, marginVertical: Spacing.md },
  empty:   { color: Colors.textSecondary, textAlign: 'center', fontSize: FontSize.sm, marginTop: Spacing.xl, lineHeight: 22 },

  card:       { backgroundColor: Colors.card ?? '#fff', borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  cardActive: { borderColor: Colors.primary + '60' },
  cardRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  cardInfo:   { flex: 1 },
  cardTitle:  { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  cardSub:    { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  cardMuted:  { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4 },

  gwIcon:       { width: 40, height: 40, borderRadius: BorderRadius.md, backgroundColor: Colors.surface ?? '#f5f5f5', alignItems: 'center', justifyContent: 'center' },
  gwIconActive: { backgroundColor: Colors.primary },

  statusBadge:    { borderWidth: 1, borderRadius: BorderRadius.round, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderColor: Colors.border, alignSelf: 'flex-start' },
  statusActive:   { borderColor: (Colors.success ?? '#2E7D32') + '40', backgroundColor: (Colors.success ?? '#2E7D32') + '15' },
  statusInactive: { borderColor: Colors.border },
  statusText:     { fontSize: FontSize.xs, fontWeight: '700' },

  pillRow:  { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  pill:     { backgroundColor: Colors.surface ?? '#f5f5f5', borderRadius: BorderRadius.round, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  pillGreen:{ backgroundColor: (Colors.success ?? '#2E7D32') + '20' },
  pillRed:  { backgroundColor: Colors.danger + '20' },
  pillText: { fontSize: FontSize.xs, color: Colors.textSecondary },

  kpiRow:   { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  kpiCard:  { flex: 1, backgroundColor: Colors.card ?? '#fff', borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  kpiLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiValue: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginTop: 4 },

  sectionHead: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginTop: Spacing.md, marginBottom: Spacing.xs },

  barRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xs, gap: Spacing.xs },
  barLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, width: 72 },
  barTrack: { flex: 1, height: 6, borderRadius: BorderRadius.round, backgroundColor: Colors.border, overflow: 'hidden' },
  barFill:  { height: '100%', borderRadius: BorderRadius.round, backgroundColor: Colors.primary },
  barValue: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.text, width: 72, textAlign: 'right' },

  methodRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.border },
  methodLabel:  { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  methodCount:  { fontSize: FontSize.xs, color: Colors.textSecondary, marginRight: Spacing.sm },
  methodAmount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, width: 88, textAlign: 'right' },

  trendWrap:  { borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm, backgroundColor: Colors.card ?? '#fff', marginBottom: Spacing.md },
  trendInner: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  trendBar:   { alignItems: 'center', width: 24 },
  trendFill:  { width: 14, borderRadius: 2, backgroundColor: Colors.primary + 'B0' },
  trendLabel: { fontSize: 8, color: Colors.textSecondary, marginTop: 2, transform: [{ rotate: '45deg' }] },

  filterRow:     { marginBottom: Spacing.sm },
  filterPill:    { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.border, marginRight: Spacing.xs, backgroundColor: Colors.card ?? '#fff' },
  filterPillActive:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterPillText:      { fontSize: FontSize.xs, color: Colors.textSecondary },
  filterPillTextActive:{ color: '#fff', fontWeight: '600' },

  txId:     { fontSize: FontSize.xs, fontFamily: 'monospace', color: Colors.textSecondary, flexShrink: 1 },
  txAmount: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  refundBadge: { fontSize: FontSize.xs, color: '#6A1B9A', marginTop: 2 },

  loadMore:     { alignItems: 'center', paddingVertical: Spacing.md },
  loadMoreText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },

  oauthBanner:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1 },
  oauthBannerConnected:   { backgroundColor: (Colors.success ?? '#2E7D32') + '12', borderColor: (Colors.success ?? '#2E7D32') + '40' },
  oauthBannerDisconnected:{ backgroundColor: Colors.primary + '10', borderColor: Colors.primary + '40' },
  oauthBannerLeft:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  oauthBannerTitle:       { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  oauthBannerSub:         { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
});
