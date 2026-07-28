import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, AIStaffAnalyticsReport, AIKitchenAnalyticsReport } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getAIStaffAnalytics, getAIKitchenAnalytics } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'StaffKitchen'>;

function fmt(n: number, cur: string) {
  return `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function fmtHour(h: number | null) {
  if (h === null) return '—';
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}
function scoreColor(score: number) {
  return score >= 80 ? Colors.success : score >= 60 ? Colors.warning : Colors.danger;
}

const TABS = ['Staff', 'Kitchen'] as const;
type Tab = typeof TABS[number];

const StaffKitchenScreen: React.FC<Props> = () => {
  const { settings } = useSettings();
  const { top } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';

  const [activeTab, setActiveTab] = useState<Tab>('Staff');
  const [staff, setStaff]           = useState<AIStaffAnalyticsReport | null>(null);
  const [kitchen, setKitchen]       = useState<AIKitchenAnalyticsReport | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [sr, kr] = await Promise.allSettled([getAIStaffAnalytics(), getAIKitchenAnalytics()]);
      if (sr.status === 'fulfilled') setStaff(sr.value);
      if (kr.status === 'fulfilled') setKitchen(kr.value);
      if (sr.status === 'rejected' && kr.status === 'rejected') {
        throw new Error(sr.reason instanceof Error ? sr.reason.message : 'Failed to load analytics');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <OfflineIndicator />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Staff & Kitchen</Text>
        <Text style={styles.headerSub}>Performance analytics</Text>
      </View>

      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <MaterialIcons
              name={tab === 'Staff' ? 'people' : 'restaurant'}
              size={16}
              color={activeTab === tab ? Colors.primary : Colors.textMuted}
            />
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !refreshing && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading analytics…</Text>
        </View>
      )}

      {error && !loading && (
        <View style={styles.errorBox}>
          <MaterialIcons name="error-outline" size={20} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Staff Tab */}
      {!loading && activeTab === 'Staff' && staff && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Hotel Averages */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Hotel Average ({staff.windowDays}d)</Text>
            <View style={styles.kpiGrid}>
              {[
                ['Orders/Staff', `${staff.hotelAvg.ordersPerStaff.toFixed(1)}`],
                ['Revenue/Staff', fmt(staff.hotelAvg.revenuePerStaff, cur)],
                ['AOV', fmt(staff.hotelAvg.aov, cur)],
                ['Cancel Rate', `${staff.hotelAvg.cancelRate.toFixed(1)}%`],
                ['Discount%', `${staff.hotelAvg.discountPct.toFixed(1)}%`],
                ['Active Staff', `${staff.activeStaff}`],
              ].map(([l, v]) => (
                <View key={l} style={styles.kpiItem}>
                  <Text style={styles.kpiVal}>{v}</Text>
                  <Text style={styles.kpiLbl}>{l}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Top Performer */}
          {staff.topPerformer && (
            <View style={styles.topPerformerCard}>
              <MaterialIcons name="emoji-events" size={20} color="#F59E0B" />
              <Text style={styles.topPerformerText}>Top Performer: <Text style={{ fontWeight: '700', color: Colors.text }}>{staff.topPerformer}</Text></Text>
            </View>
          )}

          {/* Staff Ranking */}
          {staff.staff.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Staff Ranking</Text>
              {staff.staff.map((s, i) => (
                <View key={s.cashierId} style={[styles.staffRow, i === 0 && styles.staffRowTop]}>
                  <View style={[styles.rankBadge, { backgroundColor: i === 0 ? '#F59E0B' : i === 1 ? '#9CA3AF' : i === 2 ? '#D97706' : Colors.border }]}>
                    <Text style={styles.rankText}>#{s.rank}</Text>
                  </View>
                  <View style={styles.staffLeft}>
                    <Text style={styles.staffId}>{s.cashierId}</Text>
                    <Text style={styles.staffMeta}>
                      {s.totalOrders} orders · Cancel: {s.cancelRate.toFixed(1)}% · Disc: {s.avgDiscountPct.toFixed(1)}%
                    </Text>
                  </View>
                  <View style={styles.staffRight}>
                    <Text style={[styles.staffScore, { color: scoreColor(s.performanceScore) }]}>{s.performanceScore.toFixed(0)}</Text>
                    <Text style={styles.staffRev}>{fmt(s.totalRevenue, cur)}</Text>
                    <Text style={styles.staffShare}>{(s.revenueShare * 100).toFixed(1)}% share</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* AI Summary */}
          {staff.summary && (
            <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: Colors.primary }]}>
              <View style={styles.aiRow}>
                <MaterialIcons name="auto-awesome" size={14} color={Colors.primary} />
                <Text style={styles.aiLabel}>AI Summary</Text>
              </View>
              <Text style={styles.aiText}>{staff.summary}</Text>
            </View>
          )}

          <Text style={styles.footer}>Generated {new Date(staff.generatedAt).toLocaleString('en-IN')}</Text>
        </ScrollView>
      )}

      {/* Kitchen Tab */}
      {!loading && activeTab === 'Kitchen' && kitchen && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {/* SLA Metrics */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fulfillment Performance ({kitchen.windowDays}d)</Text>
            <View style={styles.kpiGrid}>
              {[
                ['Avg Time', `${kitchen.avgFulfillmentMin.toFixed(1)} min`],
                ['Median', `${kitchen.medianFulfillmentMin.toFixed(1)} min`],
                ['P90', `${kitchen.p90FulfillmentMin.toFixed(1)} min`],
                ['Orders', `${kitchen.totalOrdersAnalyzed}`],
              ].map(([l, v]) => (
                <View key={l} style={styles.kpiItem}>
                  <Text style={styles.kpiVal}>{v}</Text>
                  <Text style={styles.kpiLbl}>{l}</Text>
                </View>
              ))}
            </View>
            <View style={styles.divider} />
            {/* SLA */}
            <View style={styles.slaRow}>
              <View style={styles.slaLeft}>
                <Text style={styles.slaLabel}>SLA Target: {kitchen.slaDurationMin} min</Text>
                <Text style={styles.slaSub}>Breach rate</Text>
              </View>
              <Text style={[styles.slaValue, { color: kitchen.slaBreachPct > 20 ? Colors.danger : kitchen.slaBreachPct > 10 ? Colors.warning : Colors.success }]}>
                {kitchen.slaBreachPct.toFixed(1)}%
              </Text>
            </View>
          </View>

          {/* Peak Hours */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Key Hours</Text>
            <View style={styles.kpiGrid}>
              {[
                ['Fastest', fmtHour(kitchen.fastestHour)],
                ['Slowest', fmtHour(kitchen.slowestHour)],
                ['Peak Load', fmtHour(kitchen.peakLoadHour)],
              ].map(([l, v]) => (
                <View key={l} style={styles.kpiItem}>
                  <Text style={styles.kpiVal}>{v}</Text>
                  <Text style={styles.kpiLbl}>{l}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Hourly Chart */}
          {kitchen.hourly.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Hourly Fulfillment</Text>
              <View style={styles.barChart}>
                {kitchen.hourly.slice(0, 14).map((h, i) => {
                  const max = Math.max(...kitchen.hourly.map(x => x.avgFulfillmentMin));
                  const barH = max > 0 ? Math.max(4, (h.avgFulfillmentMin / max) * 60) : 4;
                  const isPeak = h.hour === kitchen.peakLoadHour;
                  return (
                    <View key={i} style={styles.barCol}>
                      <Text style={styles.barVal}>{Math.round(h.avgFulfillmentMin)}</Text>
                      <View style={[styles.bar, { height: barH, backgroundColor: isPeak ? Colors.warning : Colors.info + '80' }]} />
                      <Text style={styles.barLbl}>{h.hour % 12 || 12}{h.hour < 12 ? 'a' : 'p'}</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.chartNote}>Minutes per hour (lower is better)</Text>
            </View>
          )}

          {/* Top Items */}
          {kitchen.topItems.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Items by Volume</Text>
              {kitchen.topItems.slice(0, 10).map((item, i) => (
                <View key={i} style={styles.throughputRow}>
                  <Text style={styles.throughputName} numberOfLines={1}>{item.productName}</Text>
                  <View style={styles.throughputBar}>
                    <View style={[styles.throughputFill, { width: `${item.share * 100}%` }]} />
                  </View>
                  <Text style={styles.throughputShare}>{(item.share * 100).toFixed(1)}%</Text>
                  <Text style={styles.throughputCount}>{item.orderCount}</Text>
                </View>
              ))}
            </View>
          )}

          {/* AI Summary */}
          {kitchen.summary && (
            <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: Colors.primary }]}>
              <View style={styles.aiRow}>
                <MaterialIcons name="auto-awesome" size={14} color={Colors.primary} />
                <Text style={styles.aiLabel}>AI Summary</Text>
              </View>
              <Text style={styles.aiText}>{kitchen.summary}</Text>
            </View>
          )}

          <Text style={styles.footer}>Generated {new Date(kitchen.generatedAt).toLocaleString('en-IN')}</Text>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root:              { flex: 1, backgroundColor: Colors.background },
  header:            { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle:       { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  headerSub:         { fontSize: FontSize.xs, color: Colors.textMuted },
  tabBar:            { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab:               { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.md },
  tabActive:         { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText:           { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textMuted },
  tabTextActive:     { color: Colors.primary, fontWeight: '700' },
  scroll:            { flex: 1 },
  scrollContent:     { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  centered:          { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:       { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  errorBox:          { margin: Spacing.lg, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  errorText:         { fontSize: FontSize.sm, color: Colors.danger, textAlign: 'center' },
  retryBtn:          { backgroundColor: Colors.danger, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText:         { fontSize: FontSize.sm, fontWeight: '600', color: Colors.surface },
  card:              { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Shadows.sm },
  cardTitle:         { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  kpiGrid:           { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  kpiItem:           { width: '30%', flexGrow: 1, alignItems: 'center', paddingVertical: Spacing.sm },
  kpiVal:            { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  kpiLbl:            { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2, textAlign: 'center' },
  topPerformerCard:  { backgroundColor: '#FEF3C7', borderRadius: BorderRadius.md, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topPerformerText:  { fontSize: FontSize.sm, color: '#92400E' },
  staffRow:          { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  staffRowTop:       { backgroundColor: '#FFFBEB', borderRadius: BorderRadius.sm, padding: Spacing.sm },
  rankBadge:         { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankText:          { fontSize: FontSize.xs, fontWeight: '800', color: Colors.surface },
  staffLeft:         { flex: 1 },
  staffId:           { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  staffMeta:         { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  staffRight:        { alignItems: 'flex-end' },
  staffScore:        { fontSize: FontSize.lg, fontWeight: '800' },
  staffRev:          { fontSize: FontSize.xs, fontWeight: '600', color: Colors.text, marginTop: 2 },
  staffShare:        { fontSize: FontSize.xs, color: Colors.textMuted },
  divider:           { height: 1, backgroundColor: Colors.borderLight, marginVertical: Spacing.sm },
  slaRow:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slaLeft:           {},
  slaLabel:          { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  slaSub:            { fontSize: FontSize.xs, color: Colors.textMuted },
  slaValue:          { fontSize: 28, fontWeight: '800' },
  barChart:          { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 80 },
  barCol:            { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barVal:            { fontSize: 8, color: Colors.textMuted, marginBottom: 2 },
  bar:               { width: '100%', borderRadius: 2 },
  barLbl:            { fontSize: 8, color: Colors.textMuted, marginTop: 2 },
  chartNote:         { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.sm },
  throughputRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  throughputName:    { width: 100, fontSize: FontSize.xs, color: Colors.text },
  throughputBar:     { flex: 1, height: 8, backgroundColor: Colors.borderLight, borderRadius: 4, overflow: 'hidden' },
  throughputFill:    { height: 8, backgroundColor: Colors.info, borderRadius: 4 },
  throughputShare:   { fontSize: FontSize.xs, color: Colors.textMuted, width: 36, textAlign: 'right' },
  throughputCount:   { fontSize: FontSize.xs, fontWeight: '600', color: Colors.text, width: 32, textAlign: 'right' },
  aiRow:             { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  aiLabel:           { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  aiText:            { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  footer:            { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
});

export default StaffKitchenScreen;
