import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, ExecutiveDashboard } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getAIDashboard, getLatestMorningBrief, getAIAlerts } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'AIHome'>;

interface QuickStat { label: string; value: string; icon: keyof typeof MaterialIcons.glyphMap; color: string }

function fmt(n: number, cur: string) {
  return `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function pctArrow(n: number | null) {
  if (n === null) return null;
  return { text: `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`, color: n >= 0 ? Colors.success : Colors.danger };
}

const QUICK_NAV: Array<{ label: string; screen: keyof RootStackParamList; icon: keyof typeof MaterialIcons.glyphMap; color: string }> = [
  { label: 'Morning Brief',    screen: 'MorningBrief',      icon: 'wb-sunny',         color: '#F59E0B' },
  { label: 'AI Reports',       screen: 'AIReports',         icon: 'bar-chart',        color: Colors.primary },
  { label: 'AI Chat',          screen: 'AIChat',            icon: 'chat',             color: '#6366F1' },
  { label: 'Forecast',         screen: 'AIForecast',        icon: 'trending-up',      color: Colors.success },
  { label: 'Alerts',           screen: 'AIAlerts',          icon: 'notifications',    color: Colors.danger },
  { label: 'Recommendations',  screen: 'AIRecommendations', icon: 'lightbulb',        color: '#F97316' },
  { label: 'Staff & Kitchen',  screen: 'StaffKitchen',      icon: 'people',           color: '#0891B2' },
  { label: 'OCR Assistant',    screen: 'PurchaseAssistant', icon: 'document-scanner', color: '#7C3AED' },
];

const AIHomeScreen: React.FC<Props> = ({ navigation }) => {
  const { settings } = useSettings();
  const { top } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';

  const [dashboard, setDashboard] = useState<ExecutiveDashboard | null>(null);
  const [briefSummary, setBriefSummary] = useState<string | null>(null);
  const [criticalCount, setCriticalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [dash, alerts] = await Promise.allSettled([
        getAIDashboard(),
        getAIAlerts(),
      ]);
      if (dash.status === 'fulfilled') setDashboard(dash.value);
      if (alerts.status === 'fulfilled') {
        const crit = alerts.value.alerts.filter(a => a.severity === 'critical').length;
        setCriticalCount(crit);
      }
      try {
        const brief = await getLatestMorningBrief();
        setBriefSummary(brief.executiveSummary);
      } catch (e) { console.warn('[AIHomeScreen] brief load error:', e); }
    } catch (e: any) {
      setError(e.message || 'Failed to load AI dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const health = dashboard?.latestHealthScore;
  const today  = dashboard?.today;
  const wc     = dashboard?.weekComparison;

  const healthColor = !health ? Colors.textMuted
    : health.grade === 'A' ? Colors.success
    : health.grade === 'B' ? '#22C55E'
    : health.grade === 'C' ? Colors.warning
    : Colors.danger;

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <OfflineIndicator />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>AI Intelligence</Text>
          <Text style={styles.headerSub}>Powered by DineOS AI</Text>
        </View>
        {criticalCount > 0 && (
          <TouchableOpacity
            style={styles.alertBadge}
            onPress={() => navigation.navigate('AIAlerts')}
          >
            <MaterialIcons name="warning" size={14} color={Colors.surface} />
            <Text style={styles.alertBadgeText}>{criticalCount} critical</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {loading && !refreshing && (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.loadingText}>Loading AI insights…</Text>
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

        {!loading && (
          <>
            {/* Health Score */}
            <View style={styles.healthCard}>
              <View style={styles.healthLeft}>
                <Text style={styles.healthLabel}>Health Score</Text>
                <Text style={[styles.healthScore, { color: healthColor }]}>
                  {health ? `${health.score}` : '—'}
                </Text>
                {health && <Text style={[styles.healthGrade, { color: healthColor }]}>Grade {health.grade}</Text>}
              </View>
              <View style={styles.healthRight}>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Revenue Today</Text>
                  <Text style={styles.statValue}>{today ? fmt(today.revenue, cur) : '—'}</Text>
                  {wc && (() => { const p = pctArrow(wc.changePct); return p ? <Text style={[styles.statPct, { color: p.color }]}>{p.text} vs last week</Text> : null; })()}
                </View>
                <View style={[styles.statRow, { marginTop: Spacing.sm }]}>
                  <Text style={styles.statLabel}>Orders Today</Text>
                  <Text style={styles.statValue}>{today ? `${today.orders}` : '—'}</Text>
                </View>
              </View>
            </View>

            {/* Morning Brief Preview */}
            {briefSummary && (
              <TouchableOpacity style={styles.briefCard} onPress={() => navigation.navigate('MorningBrief')}>
                <View style={styles.briefHeader}>
                  <MaterialIcons name="wb-sunny" size={16} color="#F59E0B" />
                  <Text style={styles.briefTitle}>Morning Brief</Text>
                  <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} />
                </View>
                <Text style={styles.briefText} numberOfLines={3}>{briefSummary}</Text>
              </TouchableOpacity>
            )}

            {/* Quick Nav Grid */}
            <Text style={styles.sectionTitle}>Quick Access</Text>
            <View style={styles.navGrid}>
              {QUICK_NAV.map(item => (
                <TouchableOpacity
                  key={item.screen}
                  style={styles.navItem}
                  onPress={() => navigation.navigate(item.screen as any)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.navIcon, { backgroundColor: item.color + '18' }]}>
                    <MaterialIcons name={item.icon} size={22} color={item.color} />
                    {item.screen === 'AIAlerts' && criticalCount > 0 && (
                      <View style={styles.navBadge}>
                        <Text style={styles.navBadgeText}>{criticalCount}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.navLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Top Items */}
            {today && today.topItems.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Today's Top Items</Text>
                {today.topItems.slice(0, 5).map((item, i) => (
                  <View key={item.productId} style={styles.topItemRow}>
                    <Text style={styles.topItemRank}>#{i + 1}</Text>
                    <Text style={styles.topItemName} numberOfLines={1}>{item.productName}</Text>
                    <Text style={styles.topItemRev}>{fmt(item.revenue, cur)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Data source badge */}
            {today && (
              <Text style={styles.sourceBadge}>
                Data source: {today.source === 'cache' ? 'Cached' : 'Live'} · Updated {new Date(today.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  headerSub:     { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
  alertBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.danger, borderRadius: 12, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  alertBadgeText:{ fontSize: FontSize.xs, fontWeight: '700', color: Colors.surface },
  scroll:        { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  centered:      { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xxxl },
  loadingText:   { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  errorBox:      { backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  errorText:     { fontSize: FontSize.sm, color: Colors.danger, textAlign: 'center' },
  retryBtn:      { backgroundColor: Colors.danger, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText:     { fontSize: FontSize.sm, fontWeight: '600', color: Colors.surface },
  healthCard:    { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', ...Shadows.sm },
  healthLeft:    { flex: 1, alignItems: 'center', borderRightWidth: 1, borderRightColor: Colors.border, paddingRight: Spacing.lg },
  healthLabel:   { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 4 },
  healthScore:   { fontSize: 40, fontWeight: '800' },
  healthGrade:   { fontSize: FontSize.sm, fontWeight: '600', marginTop: 2 },
  healthRight:   { flex: 2, paddingLeft: Spacing.lg },
  statRow:       {},
  statLabel:     { fontSize: FontSize.xs, color: Colors.textMuted },
  statValue:     { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  statPct:       { fontSize: FontSize.xs, fontWeight: '500', marginTop: 1 },
  briefCard:     { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderLeftWidth: 3, borderLeftColor: '#F59E0B', ...Shadows.sm },
  briefHeader:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  briefTitle:    { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  briefText:     { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  sectionTitle:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  navGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  navItem:       { width: '22%', flexGrow: 1, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, ...Shadows.sm },
  navIcon:       { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs, position: 'relative' },
  navBadge:      { position: 'absolute', top: -4, right: -4, backgroundColor: Colors.danger, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  navBadgeText:  { fontSize: 9, fontWeight: '800', color: Colors.surface },
  navLabel:      { fontSize: 10, fontWeight: '500', color: Colors.textSecondary, textAlign: 'center' },
  card:          { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Shadows.sm },
  cardTitle:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  topItemRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  topItemRank:   { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted, width: 28 },
  topItemName:   { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  topItemRev:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  sourceBadge:   { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
});

export default AIHomeScreen;
