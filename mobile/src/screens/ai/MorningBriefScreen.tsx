import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, FlatList,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, MorningBrief, BriefHistoryItem } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getLatestMorningBrief, getMorningBriefByDate, getMorningBriefHistory } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'MorningBrief'>;

function fmt(n: number, cur: string) {
  return `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtHour(h: number) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function pct(n: number | null) {
  if (n === null) return '';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

interface Section { key: string; label: string; icon: keyof typeof MaterialIcons.glyphMap; color: string }
const SECTIONS: Section[] = [
  { key: 'summary',      label: 'Executive Summary',  icon: 'summarize',      color: '#6366F1' },
  { key: 'business',     label: 'Business Metrics',   icon: 'show-chart',     color: Colors.primary },
  { key: 'menu',         label: 'Menu Performance',   icon: 'restaurant-menu',color: '#F59E0B' },
  { key: 'inventory',    label: 'Inventory',          icon: 'inventory',      color: Colors.warning },
  { key: 'forecast',     label: 'Forecast',           icon: 'trending-up',    color: Colors.success },
  { key: 'recommend',    label: 'Recommendations',    icon: 'lightbulb',      color: '#F97316' },
];

const MorningBriefScreen: React.FC<Props> = () => {
  const { settings } = useSettings();
  const { top } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';

  const [brief, setBrief]           = useState<MorningBrief | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set(['summary']));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory]       = useState<BriefHistoryItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const load = useCallback(async (date?: string) => {
    try {
      setError(null);
      const data = date ? await getMorningBriefByDate(date) : await getLatestMorningBrief();
      setBrief(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load Morning Brief');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const toggleSection = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    if (history.length === 0) {
      setHistLoading(true);
      try {
        const res = await getMorningBriefHistory(30);
        setHistory(res.briefs);
      } catch (e) { console.warn('[MorningBriefScreen] history load error:', e); } finally {
        setHistLoading(false);
      }
    }
  };

  const selectHistory = (item: BriefHistoryItem) => {
    setHistoryOpen(false);
    setLoading(true);
    setBrief(null);
    load(item.date);
  };

  const b = brief?.business;

  return (
    <View style={styles.root}>
      <OfflineIndicator />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="wb-sunny" size={20} color="#F59E0B" />
          <View style={{ marginLeft: Spacing.sm }}>
            <Text style={styles.headerTitle}>Morning Brief</Text>
            {brief && <Text style={styles.headerDate}>{brief.date}</Text>}
          </View>
        </View>
        <TouchableOpacity style={styles.historyBtn} onPress={openHistory}>
          <MaterialIcons name="history" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading && !refreshing && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading Morning Brief…</Text>
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

      {!loading && brief && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Warning banner */}
          {brief.warning && (
            <View style={styles.warningBanner}>
              <MaterialIcons name="warning" size={16} color="#92400E" />
              <Text style={styles.warningText}>{brief.warning}</Text>
            </View>
          )}

          {/* Health KPI row */}
          {b && (
            <View style={styles.kpiRow}>
              <View style={[styles.kpi, { borderColor: Colors.border }]}>
                <Text style={styles.kpiVal}>{fmt(b.revenue, cur)}</Text>
                <Text style={styles.kpiLbl}>Revenue</Text>
                {b.revenueVs7DayAvgPct !== null && (
                  <Text style={[styles.kpiPct, { color: b.revenueVs7DayAvgPct >= 0 ? Colors.success : Colors.danger }]}>
                    {pct(b.revenueVs7DayAvgPct)} vs 7d avg
                  </Text>
                )}
              </View>
              <View style={[styles.kpi, { borderColor: Colors.border }]}>
                <Text style={styles.kpiVal}>{b.orders}</Text>
                <Text style={styles.kpiLbl}>Orders</Text>
                {b.ordersVs7DayAvgPct !== null && (
                  <Text style={[styles.kpiPct, { color: b.ordersVs7DayAvgPct >= 0 ? Colors.success : Colors.danger }]}>
                    {pct(b.ordersVs7DayAvgPct)} vs 7d avg
                  </Text>
                )}
              </View>
              <View style={styles.kpi}>
                <Text style={[styles.kpiVal, { color: b.healthGrade === 'A' ? Colors.success : b.healthGrade === 'B' ? '#22C55E' : b.healthGrade === 'C' ? Colors.warning : Colors.danger }]}>
                  {b.healthScore}
                </Text>
                <Text style={styles.kpiLbl}>Health Score</Text>
                <Text style={[styles.kpiGrade, { color: b.healthGrade === 'A' ? Colors.success : b.healthGrade === 'B' ? '#22C55E' : b.healthGrade === 'C' ? Colors.warning : Colors.danger }]}>
                  Grade {b.healthGrade}
                </Text>
              </View>
            </View>
          )}

          {/* Collapsible sections */}
          {SECTIONS.map(sec => (
            <View key={sec.key} style={styles.section}>
              <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(sec.key)} activeOpacity={0.7}>
                <View style={[styles.sectionIcon, { backgroundColor: sec.color + '18' }]}>
                  <MaterialIcons name={sec.icon} size={16} color={sec.color} />
                </View>
                <Text style={styles.sectionTitle}>{sec.label}</Text>
                <MaterialIcons name={expanded.has(sec.key) ? 'expand-less' : 'expand-more'} size={20} color={Colors.textMuted} />
              </TouchableOpacity>

              {expanded.has(sec.key) && (
                <View style={styles.sectionBody}>
                  {sec.key === 'summary' && (
                    <>
                      <Text style={styles.narrative}>{brief.executiveSummary}</Text>
                      {brief.opportunity && (
                        <View style={styles.opportunityBox}>
                          <MaterialIcons name="star" size={14} color="#F59E0B" />
                          <Text style={styles.opportunityText}>{brief.opportunity}</Text>
                        </View>
                      )}
                    </>
                  )}

                  {sec.key === 'business' && b && (
                    <View style={styles.metricGrid}>
                      {[
                        ['Avg Bill', fmt(b.avgBill, cur)],
                        ['Profit', fmt(b.estimatedProfit, cur)],
                        ['Margin', `${b.estimatedProfitMarginPct.toFixed(1)}%`],
                        ['Peak Hour', fmtHour(b.peakHour)],
                        ['Top Payment', b.topPaymentMethod],
                        ['Cancelled', `${b.cancelledOrders} (${b.cancelRate.toFixed(1)}%)`],
                      ].map(([lbl, val]) => (
                        <View key={lbl} style={styles.metricItem}>
                          <Text style={styles.metricLbl}>{lbl}</Text>
                          <Text style={styles.metricVal}>{val}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {sec.key === 'menu' && brief.menu && (
                    <>
                      {brief.menu.topMenuItems.length > 0 && (
                        <>
                          <Text style={styles.subLabel}>Top Menu Items</Text>
                          {brief.menu.topMenuItems.map((item, i) => (
                            <View key={i} style={styles.menuRow}>
                              <Text style={styles.menuRank}>#{i + 1}</Text>
                              <Text style={styles.menuName} numberOfLines={1}>{item.name}</Text>
                              <Text style={styles.menuQty}>{item.qty} sold</Text>
                              <Text style={styles.menuRev}>{fmt(item.revenue, cur)}</Text>
                            </View>
                          ))}
                        </>
                      )}
                      {brief.menu.slowMovers.length > 0 && (
                        <>
                          <Text style={[styles.subLabel, { marginTop: Spacing.sm }]}>Slow Movers</Text>
                          <Text style={styles.slowMovers}>{brief.menu.slowMovers.join(' · ')}</Text>
                        </>
                      )}
                    </>
                  )}

                  {sec.key === 'inventory' && brief.inventory && (
                    <View style={styles.metricGrid}>
                      {[
                        ['Critical Items', `${brief.inventory.criticalCount}`],
                        ['Warning Items', `${brief.inventory.warningCount}`],
                        ['Reorder Cost', fmt(brief.inventory.totalReorderCost, cur)],
                      ].map(([lbl, val]) => (
                        <View key={lbl} style={styles.metricItem}>
                          <Text style={styles.metricLbl}>{lbl}</Text>
                          <Text style={[styles.metricVal, { color: lbl === 'Critical Items' && parseInt(val) > 0 ? Colors.danger : Colors.text }]}>{val}</Text>
                        </View>
                      ))}
                      {brief.inventory.criticalItems.length > 0 && (
                        <View style={{ width: '100%', marginTop: Spacing.sm }}>
                          <Text style={styles.subLabel}>Critical Stock</Text>
                          <Text style={[styles.slowMovers, { color: Colors.danger }]}>{brief.inventory.criticalItems.join(' · ')}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {sec.key === 'forecast' && brief.forecast && (
                    <View style={styles.metricGrid}>
                      {[
                        ['Expected Revenue', fmt(brief.forecast.expectedRevenue, cur)],
                        ['Expected Orders', `${brief.forecast.expectedOrders}`],
                        ['Expected AOV', fmt(brief.forecast.expectedAov, cur)],
                        ['Confidence', `${(brief.forecast.forecastConfidence * 100).toFixed(0)}%`],
                        ['Method', brief.forecast.method],
                        ['Busy Hours', brief.forecast.topBusyHours.map(h => fmtHour(h)).join(', ')],
                      ].map(([lbl, val]) => (
                        <View key={lbl} style={styles.metricItem}>
                          <Text style={styles.metricLbl}>{lbl}</Text>
                          <Text style={styles.metricVal}>{val}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {sec.key === 'recommend' && brief.recommendations.length > 0 && (
                    <View style={styles.recList}>
                      {brief.recommendations.map((r, i) => (
                        <View key={i} style={styles.recItem}>
                          <MaterialIcons name="check-circle" size={14} color={Colors.success} style={{ marginTop: 2 }} />
                          <Text style={styles.recText}>{r}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          ))}

          <Text style={styles.footer}>
            Generated {new Date(brief.generatedAt).toLocaleString('en-IN')}
          </Text>
        </ScrollView>
      )}

      {/* History Modal */}
      <Modal visible={historyOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setHistoryOpen(false)}>
        <View style={[styles.modalRoot, { paddingTop: top }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Brief History</Text>
            <TouchableOpacity onPress={() => setHistoryOpen(false)}>
              <MaterialIcons name="close" size={22} color={Colors.text} />
            </TouchableOpacity>
          </View>
          {histLoading && <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xxxl }} />}
          <FlatList
            data={history}
            keyExtractor={i => i._id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.histItem} onPress={() => selectHistory(item)}>
                <View style={styles.histLeft}>
                  <Text style={styles.histDate}>{item.date}</Text>
                  <Text style={styles.histSummary} numberOfLines={2}>{item.executiveSummary}</Text>
                </View>
                <View style={styles.histRight}>
                  <Text style={styles.histRev}>{fmt(item.business.revenue, cur)}</Text>
                  <Text style={[styles.histGrade, { color: item.business.healthGrade === 'A' ? Colors.success : item.business.healthGrade === 'B' ? '#22C55E' : Colors.warning }]}>
                    Grade {item.business.healthGrade}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={{ paddingBottom: Spacing.xxxl }}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerLeft:    { flexDirection: 'row', alignItems: 'center' },
  headerTitle:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  headerDate:    { fontSize: FontSize.xs, color: Colors.textMuted },
  historyBtn:    { padding: Spacing.sm },
  scroll:        { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxxl },
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:   { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  errorBox:      { margin: Spacing.lg, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  errorText:     { fontSize: FontSize.sm, color: Colors.danger, textAlign: 'center' },
  retryBtn:      { backgroundColor: Colors.danger, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText:     { fontSize: FontSize.sm, fontWeight: '600', color: Colors.surface },
  warningBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: '#FEF3C7', borderRadius: BorderRadius.md, padding: Spacing.md },
  warningText:   { flex: 1, fontSize: FontSize.sm, color: '#92400E' },
  kpiRow:        { flexDirection: 'row', gap: Spacing.sm },
  kpi:           { flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center', borderWidth: 1, ...Shadows.sm },
  kpiVal:        { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  kpiLbl:        { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  kpiPct:        { fontSize: FontSize.xs, fontWeight: '500', marginTop: 2 },
  kpiGrade:      { fontSize: FontSize.sm, fontWeight: '600', marginTop: 2 },
  section:       { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, overflow: 'hidden', ...Shadows.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.sm },
  sectionIcon:   { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sectionTitle:  { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sectionBody:   { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  narrative:     { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22, marginTop: Spacing.sm },
  opportunityBox:{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, marginTop: Spacing.sm, backgroundColor: '#FEF3C7', borderRadius: BorderRadius.sm, padding: Spacing.sm },
  opportunityText:{ flex: 1, fontSize: FontSize.sm, color: '#92400E' },
  metricGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  metricItem:    { width: '47%', flexGrow: 1 },
  metricLbl:     { fontSize: FontSize.xs, color: Colors.textMuted },
  metricVal:     { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, marginTop: 2 },
  subLabel:      { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.xs },
  menuRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  menuRank:      { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted, width: 24 },
  menuName:      { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  menuQty:       { fontSize: FontSize.xs, color: Colors.textMuted, marginRight: Spacing.sm },
  menuRev:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  slowMovers:    { fontSize: FontSize.sm, color: Colors.textSecondary },
  recList:       { gap: Spacing.sm, marginTop: Spacing.sm },
  recItem:       { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  recText:       { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  footer:        { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing.sm },
  modalRoot:     { flex: 1, backgroundColor: Colors.background },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.lg, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle:    { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  histItem:      { flexDirection: 'row', alignItems: 'flex-start', padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, backgroundColor: Colors.surface, marginHorizontal: Spacing.md, marginTop: Spacing.sm, borderRadius: BorderRadius.md },
  histLeft:      { flex: 1, marginRight: Spacing.md },
  histDate:      { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  histSummary:   { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  histRight:     { alignItems: 'flex-end' },
  histRev:       { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  histGrade:     { fontSize: FontSize.sm, fontWeight: '600', marginTop: 2 },
});

export default MorningBriefScreen;
