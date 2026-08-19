import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, AIDailyReport } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getAIReport } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'AIReports'>;

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
  if (n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const AIReportsScreen: React.FC<Props> = () => {
  const { settings } = useSettings();
  const { top } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';

  const [date, setDate]       = useState<string>(today());
  const [report, setReport]   = useState<AIDailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [datePicker, setDatePicker] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setReport(null);
    try {
      const data = await getAIReport(d);
      setReport(data);
    } catch (e: any) {
      if (e?.status === 404 || e?.message?.includes('404')) setNotFound(true);
      else setError(e.message || 'Failed to load AI report');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on first render
  React.useEffect(() => { load(today()); }, []);

  const r = report?.snapshot;
  const health = report?.health;

  const healthColor = !health ? Colors.textMuted
    : health.grade === 'A' ? Colors.success
    : health.grade === 'B' ? '#22C55E'
    : health.grade === 'C' ? Colors.warning
    : Colors.danger;

  const LAST_14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });

  return (
    <View style={styles.root}>
      <OfflineIndicator />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>AI Daily Report</Text>
          <Text style={styles.headerSub}>Health score · Payment · Performance</Text>
        </View>
        <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePicker(true)}>
          <MaterialIcons name="calendar-today" size={14} color={Colors.primary} />
          <Text style={styles.dateBtnText}>{date}</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading report…</Text>
        </View>
      )}

      {!loading && notFound && (
        <View style={styles.emptyBox}>
          <MaterialIcons name="inbox" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No report for {date}</Text>
          <Text style={styles.emptySub}>Reports are generated after daily close. Try a previous date.</Text>
        </View>
      )}

      {!loading && error && (
        <View style={styles.errorBox}>
          <MaterialIcons name="error-outline" size={20} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(date)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && report && r && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Health */}
          <View style={styles.healthCard}>
            <View style={[styles.healthCircle, { borderColor: healthColor }]}>
              <Text style={[styles.healthScore, { color: healthColor }]}>{health?.score ?? '—'}</Text>
              <Text style={[styles.healthGrade, { color: healthColor }]}>{health?.grade ?? '—'}</Text>
            </View>
            <View style={styles.healthRight}>
              <Text style={styles.healthLabel}>Health Score</Text>
              <Text style={styles.healthSub}>Report for {report.date}</Text>
              {report.narrative && (
                <Text style={styles.narrative} numberOfLines={4}>{report.narrative}</Text>
              )}
              {report.narrativeSource !== 'unavailable' && (
                <Text style={styles.sourceTag}>AI: {report.narrativeSource}</Text>
              )}
            </View>
          </View>

          {/* Revenue KPIs */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Revenue Overview</Text>
            <View style={styles.kpiRow}>
              {[
                ['Total Revenue', fmt(r.totalRevenue, cur)],
                ['Orders', `${r.totalOrders}`],
                ['Avg Order', fmt(r.avgOrderValue, cur)],
              ].map(([l, v]) => (
                <View key={l} style={styles.kpi}>
                  <Text style={styles.kpiVal}>{v}</Text>
                  <Text style={styles.kpiLbl}>{l}</Text>
                </View>
              ))}
            </View>
            <View style={styles.divider} />
            <View style={styles.kpiRow}>
              <View style={styles.kpi}>
                <Text style={[styles.kpiVal, { color: r.revenueVs7DayAvgPct !== null && r.revenueVs7DayAvgPct >= 0 ? Colors.success : Colors.danger }]}>
                  {pct(r.revenueVs7DayAvgPct)}
                </Text>
                <Text style={styles.kpiLbl}>vs 7-day avg</Text>
              </View>
              <View style={styles.kpi}>
                <Text style={[styles.kpiVal, { color: r.ordersVs7DayAvgPct !== null && r.ordersVs7DayAvgPct >= 0 ? Colors.success : Colors.danger }]}>
                  {pct(r.ordersVs7DayAvgPct)}
                </Text>
                <Text style={styles.kpiLbl}>Orders vs 7d avg</Text>
              </View>
              <View style={styles.kpi}>
                <Text style={styles.kpiVal}>{r.uniqueTables}</Text>
                <Text style={styles.kpiLbl}>Tables served</Text>
              </View>
            </View>
          </View>

          {/* Payment Breakdown */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Payment Breakdown</Text>
            {Object.entries(r.paymentBreakdown).map(([k, v]) => {
              const total = Object.values(r.paymentBreakdown).reduce((a, b) => a + b, 0);
              const share = total > 0 ? v / total : 0;
              const color = k === 'cash' ? Colors.cash : k === 'upi' ? Colors.upi : k === 'card' ? Colors.cardPayment : Colors.split;
              return (
                <View key={k} style={styles.payRow}>
                  <Text style={styles.payLabel}>{k.toUpperCase()}</Text>
                  <View style={styles.payBarWrap}>
                    <View style={[styles.payBar, { width: `${share * 100}%`, backgroundColor: color }]} />
                  </View>
                  <Text style={styles.payAmt}>{fmt(v, cur)}</Text>
                </View>
              );
            })}
          </View>

          {/* Peak Hours */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Peak Hour: {fmtHour(r.peakHour)}</Text>
            <Text style={styles.peakRev}>{fmt(r.peakHourRevenue, cur)} peak revenue</Text>
            <View style={styles.hourGrid}>
              {r.hourlyRevenue.slice(10, 23).map((rev, i) => {
                const hour = i + 10;
                const max = Math.max(...r.hourlyRevenue);
                const h = max > 0 ? Math.max(4, (rev / max) * 48) : 4;
                return (
                  <View key={hour} style={styles.hourCol}>
                    <View style={[styles.hourBar, { height: h, backgroundColor: hour === r.peakHour ? Colors.primary : Colors.primaryLight + '60' }]} />
                    <Text style={styles.hourLabel}>{hour % 12 || 12}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Top Items */}
          {r.topItems.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Menu Items</Text>
              {r.topItems.map((item, i) => (
                <View key={i} style={styles.topRow}>
                  <Text style={styles.topRank}>#{i + 1}</Text>
                  <Text style={styles.topName} numberOfLines={1}>{item.productName}</Text>
                  <Text style={styles.topQty}>{item.qty}x</Text>
                  <Text style={styles.topRev}>{fmt(item.revenue, cur)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Cancelled */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Cancellations</Text>
            <View style={styles.kpiRow}>
              <View style={styles.kpi}>
                <Text style={[styles.kpiVal, { color: r.cancelledOrders > 0 ? Colors.danger : Colors.success }]}>{r.cancelledOrders}</Text>
                <Text style={styles.kpiLbl}>Cancelled Orders</Text>
              </View>
              <View style={styles.kpi}>
                <Text style={[styles.kpiVal, { color: r.cancelledRevenue > 0 ? Colors.danger : Colors.success }]}>{fmt(r.cancelledRevenue, cur)}</Text>
                <Text style={styles.kpiLbl}>Lost Revenue</Text>
              </View>
            </View>
          </View>

          <Text style={styles.footer}>Generated {new Date(report.generatedAt).toLocaleString('en-IN')}</Text>
        </ScrollView>
      )}

      {/* Date Picker Modal */}
      <Modal visible={datePicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDatePicker(false)}>
        <View style={[styles.modalRoot, { paddingTop: top }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Date</Text>
            <TouchableOpacity onPress={() => setDatePicker(false)}>
              <MaterialIcons name="close" size={22} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {LAST_14.map(d => (
              <TouchableOpacity
                key={d}
                style={[styles.dateItem, d === date && styles.dateItemActive]}
                onPress={() => { setDate(d); setDatePicker(false); load(d); }}
              >
                <Text style={[styles.dateItemText, d === date && styles.dateItemTextActive]}>{d}</Text>
                {d === today() && <Text style={styles.dateToday}>Today</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  headerSub:     { fontSize: FontSize.xs, color: Colors.textMuted },
  dateBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  dateBtnText:   { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },
  scroll:        { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxxl },
  centered:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:   { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  emptyBox:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, gap: Spacing.md },
  emptyTitle:    { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub:      { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  errorBox:      { margin: Spacing.lg, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  errorText:     { fontSize: FontSize.sm, color: Colors.danger, textAlign: 'center' },
  retryBtn:      { backgroundColor: Colors.danger, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText:     { fontSize: FontSize.sm, fontWeight: '600', color: Colors.surface },
  healthCard:    { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, ...Shadows.sm },
  healthCircle:  { width: 80, height: 80, borderRadius: 40, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  healthScore:   { fontSize: FontSize.xl, fontWeight: '800' },
  healthGrade:   { fontSize: FontSize.sm, fontWeight: '600' },
  healthRight:   { flex: 1 },
  healthLabel:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  healthSub:     { fontSize: FontSize.xs, color: Colors.textMuted },
  narrative:     { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs, lineHeight: 20 },
  sourceTag:     { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  card:          { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Shadows.sm },
  cardTitle:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  kpiRow:        { flexDirection: 'row', gap: Spacing.sm },
  kpi:           { flex: 1, alignItems: 'center' },
  kpiVal:        { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  kpiLbl:        { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2, textAlign: 'center' },
  divider:       { height: 1, backgroundColor: Colors.borderLight, marginVertical: Spacing.sm },
  payRow:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  payLabel:      { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, width: 40 },
  payBarWrap:    { flex: 1, height: 10, backgroundColor: Colors.borderLight, borderRadius: 5, overflow: 'hidden' },
  payBar:        { height: 10, borderRadius: 5 },
  payAmt:        { fontSize: FontSize.xs, fontWeight: '600', color: Colors.text, width: 70, textAlign: 'right' },
  peakRev:       { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  hourGrid:      { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 60 },
  hourCol:       { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  hourBar:       { width: '100%', borderRadius: 2 },
  hourLabel:     { fontSize: 8, color: Colors.textMuted, marginTop: 2 },
  topRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  topRank:       { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted, width: 24 },
  topName:       { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  topQty:        { fontSize: FontSize.xs, color: Colors.textMuted, marginRight: Spacing.sm },
  topRev:        { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  footer:        { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  modalRoot:     { flex: 1, backgroundColor: Colors.background },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.lg, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle:    { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  dateItem:      { padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dateItemActive:{ backgroundColor: Colors.primaryBg },
  dateItemText:  { fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  dateItemTextActive: { color: Colors.primary, fontWeight: '700' },
  dateToday:     { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
});

export default AIReportsScreen;
