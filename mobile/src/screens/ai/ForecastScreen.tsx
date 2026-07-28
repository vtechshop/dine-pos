import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, SalesForecast, InventoryForecast } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getAISalesForecast, getAIInventoryForecast } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'AIForecast'>;

function fmt(n: number, cur: string) {
  return `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function fmtHour(h: number) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}
function shortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

const TABS = ['Sales Forecast', 'Inventory'] as const;
type Tab = typeof TABS[number];

const ForecastScreen: React.FC<Props> = () => {
  const { settings } = useSettings();
  const { top } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';

  const [activeTab, setActiveTab] = useState<Tab>('Sales Forecast');
  const [sales, setSales]           = useState<SalesForecast | null>(null);
  const [inventory, setInventory]   = useState<InventoryForecast | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [sr, ir] = await Promise.allSettled([getAISalesForecast(), getAIInventoryForecast()]);
      if (sr.status === 'fulfilled') setSales(sr.value);
      if (ir.status === 'fulfilled') setInventory(ir.value);
      if (sr.status === 'rejected' && ir.status === 'rejected') {
        throw new Error(sr.reason instanceof Error ? sr.reason.message : 'Failed to load forecast');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load forecast');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const statusColor = (s: string) =>
    s === 'critical' ? Colors.danger : s === 'warning' ? Colors.warning : s === 'overstock' ? Colors.info : Colors.success;

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <OfflineIndicator />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI Forecast</Text>
        <Text style={styles.headerSub}>Revenue · Orders · Inventory</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !refreshing && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading forecast…</Text>
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

      {!loading && activeTab === 'Sales Forecast' && sales && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Summary KPIs */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Next 7 Days Forecast</Text>
            <View style={styles.kpiRow}>
              {[
                ['Revenue', fmt(sales.forecastWeekRevenue, cur)],
                ['Orders', `${sales.forecastWeekOrders}`],
                ['Avg AOV', fmt(sales.avgForecastAOV, cur)],
              ].map(([l, v]) => (
                <View key={l} style={styles.kpi}>
                  <Text style={styles.kpiVal}>{v}</Text>
                  <Text style={styles.kpiLbl}>{l}</Text>
                </View>
              ))}
            </View>
            <View style={styles.confRow}>
              <MaterialIcons name="verified" size={14} color={Colors.success} />
              <Text style={styles.confText}>
                Confidence: {(sales.revenueForecastMeta.confidence * 100).toFixed(0)}% · Method: {sales.revenueForecastMeta.method}
              </Text>
            </View>
          </View>

          {/* Revenue Chart (bar) */}
          {sales.revenueNext7d.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Revenue Next 7 Days</Text>
              <View style={styles.barChart}>
                {sales.revenueNext7d.map((p, i) => {
                  const max = Math.max(...sales.revenueNext7d.map(x => x.value));
                  const h = max > 0 ? Math.max(6, (p.value / max) * 80) : 6;
                  return (
                    <View key={i} style={styles.barCol}>
                      <Text style={styles.barValLabel}>{fmt(p.value, cur).replace(cur, '')}</Text>
                      <View style={[styles.bar, { height: h }]} />
                      <Text style={styles.barDateLabel}>{shortDate(p.date)}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Orders Chart */}
          {sales.ordersNext7d.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Orders Next 7 Days</Text>
              <View style={styles.barChart}>
                {sales.ordersNext7d.map((p, i) => {
                  const max = Math.max(...sales.ordersNext7d.map(x => x.value));
                  const h = max > 0 ? Math.max(6, (p.value / max) * 60) : 6;
                  return (
                    <View key={i} style={styles.barCol}>
                      <Text style={styles.barValLabel}>{Math.round(p.value)}</Text>
                      <View style={[styles.bar, { height: h, backgroundColor: Colors.info + 'CC' }]} />
                      <Text style={styles.barDateLabel}>{shortDate(p.date)}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Peak Hours */}
          {sales.topPeakHours.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Predicted Peak Hours</Text>
              <View style={styles.peakHours}>
                {sales.topPeakHours.map(h => (
                  <View key={h} style={styles.peakChip}>
                    <MaterialIcons name="access-time" size={12} color={Colors.primary} />
                    <Text style={styles.peakText}>{fmtHour(h)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Item Demand */}
          {sales.itemDemand.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Item Demand Forecast</Text>
              {sales.itemDemand.slice(0, 10).map((item, i) => (
                <View key={i} style={styles.demandRow}>
                  <View style={[styles.trendDot, { backgroundColor: item.trend === 'rising' ? Colors.success : item.trend === 'falling' ? Colors.danger : Colors.textMuted }]} />
                  <Text style={styles.demandName} numberOfLines={1}>{item.productName}</Text>
                  <Text style={styles.demandQty}>{item.forecastQty} predicted</Text>
                  <MaterialIcons
                    name={item.trend === 'rising' ? 'trending-up' : item.trend === 'falling' ? 'trending-down' : 'trending-flat'}
                    size={16}
                    color={item.trend === 'rising' ? Colors.success : item.trend === 'falling' ? Colors.danger : Colors.textMuted}
                  />
                </View>
              ))}
            </View>
          )}

          {/* Narrative */}
          {sales.narrative && (
            <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: Colors.primary }]}>
              <View style={styles.aiRow}>
                <MaterialIcons name="auto-awesome" size={14} color={Colors.primary} />
                <Text style={styles.aiLabel}>AI Insight · {sales.narrativeSource}</Text>
              </View>
              <Text style={styles.aiText}>{sales.narrative}</Text>
            </View>
          )}

          <Text style={styles.footer}>Generated {new Date(sales.generatedAt).toLocaleString('en-IN')}</Text>
        </ScrollView>
      )}

      {!loading && activeTab === 'Inventory' && inventory && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Coverage summary */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Inventory Coverage</Text>
            <View style={styles.kpiRow}>
              {[
                ['Critical', `${inventory.coverageSummary.criticalCount}`, Colors.danger],
                ['Warning', `${inventory.coverageSummary.warningCount}`, Colors.warning],
                ['Healthy', `${inventory.coverageSummary.okCount}`, Colors.success],
                ['Overstock', `${inventory.coverageSummary.overstockCount}`, Colors.info],
              ].map(([l, v, c]) => (
                <View key={l} style={styles.kpi}>
                  <Text style={[styles.kpiVal, { color: c as string }]}>{v}</Text>
                  <Text style={styles.kpiLbl}>{l}</Text>
                </View>
              ))}
            </View>
            <View style={styles.divider} />
            <Text style={styles.reorderCost}>
              Total Reorder Cost: <Text style={{ color: Colors.danger, fontWeight: '700' }}>{fmt(inventory.totalReorderCost, cur)}</Text>
            </Text>
          </View>

          {/* Critical Items */}
          {inventory.criticalItems.length > 0 && (
            <View style={styles.card}>
              <Text style={[styles.cardTitle, { color: Colors.danger }]}>Critical — Reorder Now</Text>
              {inventory.criticalItems.map((item, i) => (
                <View key={i} style={[styles.invRow, { borderLeftColor: Colors.danger }]}>
                  <View style={styles.invLeft}>
                    <Text style={styles.invName}>{item.name}</Text>
                    <Text style={styles.invSub}>{item.daysRemaining.toFixed(1)} days left · {item.currentStock} {item.unit}</Text>
                  </View>
                  <View style={styles.invRight}>
                    <Text style={[styles.invStatus, { color: Colors.danger }]}>CRITICAL</Text>
                    <Text style={styles.invCost}>{fmt(item.reorderCost, cur)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Warning Items */}
          {inventory.warningItems.length > 0 && (
            <View style={styles.card}>
              <Text style={[styles.cardTitle, { color: Colors.warning }]}>Warning — Low Stock</Text>
              {inventory.warningItems.map((item, i) => (
                <View key={i} style={[styles.invRow, { borderLeftColor: Colors.warning }]}>
                  <View style={styles.invLeft}>
                    <Text style={styles.invName}>{item.name}</Text>
                    <Text style={styles.invSub}>{item.daysRemaining.toFixed(1)} days left · {item.currentStock} {item.unit}</Text>
                  </View>
                  <View style={styles.invRight}>
                    <Text style={[styles.invStatus, { color: Colors.warning }]}>WARNING</Text>
                    <Text style={styles.invCost}>{fmt(item.reorderCost, cur)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Top Reorder */}
          {inventory.topReorderItems.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Reorder Priority</Text>
              {inventory.topReorderItems.map((item, i) => (
                <View key={i} style={[styles.invRow, { borderLeftColor: statusColor(item.status) }]}>
                  <View style={styles.invLeft}>
                    <Text style={styles.invName}>{item.name}</Text>
                    <Text style={styles.invSub}>Reorder {item.reorderQty} {item.unit} · {item.daysRemaining.toFixed(1)}d remaining</Text>
                  </View>
                  <View style={styles.invRight}>
                    <Text style={[styles.invStatus, { color: statusColor(item.status) }]}>{item.status.toUpperCase()}</Text>
                    <Text style={styles.invCost}>{fmt(item.reorderCost, cur)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.footer}>Generated {new Date(inventory.generatedAt).toLocaleString('en-IN')}</Text>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: Colors.background },
  header:       { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle:  { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  headerSub:    { fontSize: FontSize.xs, color: Colors.textMuted },
  tabBar:       { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab:          { flex: 1, paddingVertical: Spacing.md, alignItems: 'center' },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText:      { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textMuted },
  tabTextActive:{ color: Colors.primary, fontWeight: '700' },
  scroll:       { flex: 1 },
  scrollContent:{ padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:  { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  errorBox:     { margin: Spacing.lg, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  errorText:    { fontSize: FontSize.sm, color: Colors.danger, textAlign: 'center' },
  retryBtn:     { backgroundColor: Colors.danger, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.surface },
  card:         { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Shadows.sm },
  cardTitle:    { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  kpiRow:       { flexDirection: 'row', gap: Spacing.sm },
  kpi:          { flex: 1, alignItems: 'center' },
  kpiVal:       { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  kpiLbl:       { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2, textAlign: 'center' },
  confRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.sm },
  confText:     { fontSize: FontSize.xs, color: Colors.textMuted },
  barChart:     { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110 },
  barCol:       { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barValLabel:  { fontSize: 8, color: Colors.textMuted, marginBottom: 2 },
  bar:          { width: '90%', borderRadius: 3, backgroundColor: Colors.primary + 'CC' },
  barDateLabel: { fontSize: 8, color: Colors.textMuted, marginTop: 2 },
  peakHours:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  peakChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primaryBg, borderRadius: 14, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  peakText:     { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  demandRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  trendDot:     { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  demandName:   { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  demandQty:    { fontSize: FontSize.xs, color: Colors.textMuted, marginRight: 4 },
  aiRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  aiLabel:      { fontSize: FontSize.xs, fontWeight: '600', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  aiText:       { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  divider:      { height: 1, backgroundColor: Colors.borderLight, marginVertical: Spacing.sm },
  reorderCost:  { fontSize: FontSize.sm, color: Colors.textSecondary },
  invRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, borderLeftWidth: 3, paddingLeft: Spacing.sm, marginBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  invLeft:      { flex: 1 },
  invName:      { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  invSub:       { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  invRight:     { alignItems: 'flex-end' },
  invStatus:    { fontSize: FontSize.xs, fontWeight: '700' },
  invCost:      { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginTop: 2 },
  footer:       { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
});

export default ForecastScreen;
