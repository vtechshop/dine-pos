import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, AIRecommendationSet, AIMenuItemScore } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getAIRecommendations, getAIRecommendationsByDate } from '../../services/api';
import { useSettings } from '../../context/SettingsContext';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'AIRecommendations'>;

function getToday() { return new Date().toISOString().slice(0, 10); }
function fmt(n: number, cur: string) {
  return `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

interface Quadrant { key: 'stars' | 'plowHorses' | 'puzzles' | 'dogs'; label: string; emoji: string; sub: string; border: string; bg: string }
const QUADRANTS: Quadrant[] = [
  { key: 'stars',     label: 'Stars',       emoji: '⭐', sub: 'High vol · High profit — PROMOTE',        border: '#86EFAC', bg: '#F0FDF4' },
  { key: 'puzzles',   label: 'Puzzles',     emoji: '❓', sub: 'Low vol · High profit — MARKET MORE',     border: '#FCD34D', bg: '#FFFBEB' },
  { key: 'plowHorses',label: 'Plow Horses', emoji: '🐴', sub: 'High vol · Low profit — OPTIMIZE COST',   border: '#93C5FD', bg: '#EFF6FF' },
  { key: 'dogs',      label: 'Dogs',        emoji: '🐕', sub: 'Low vol · Low profit — REVIEW',           border: '#FCA5A5', bg: '#FEF2F2' },
];

function QuadrantCard({ q, items, cur }: { q: Quadrant; items: AIMenuItemScore[]; cur: string }) {
  return (
    <View style={[styles.quadrant, { borderColor: q.border, backgroundColor: q.bg }]}>
      <Text style={styles.quadLabel}>{q.emoji} {q.label}</Text>
      <Text style={styles.quadSub}>{q.sub}</Text>
      {items.length === 0
        ? <Text style={styles.quadEmpty}>No items</Text>
        : items.slice(0, 5).map(it => (
          <View key={it.productId} style={styles.quadRow}>
            <Text style={styles.quadName} numberOfLines={1}>{it.productName}</Text>
            <Text style={styles.quadMeta}>{fmt(it.revenuePerUnit, cur)} · {it.qty} sold</Text>
          </View>
        ))
      }
    </View>
  );
}

const RecommendationsScreen: React.FC<Props> = () => {
  const { settings } = useSettings();
  const { top } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';

  const [data, setData]           = useState<AIRecommendationSet | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [notFound, setNotFound]   = useState(false);
  const [date, setDate]           = useState(getToday());
  const [datePicker, setDatePicker] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setData(null);
    try {
      const result = d === getToday() ? await getAIRecommendations() : await getAIRecommendationsByDate(d);
      setData(result);
    } catch (e: any) {
      if (e?.status === 404 || e?.message?.includes('404')) setNotFound(true);
      else setError(e.message || 'Failed to load recommendations');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(date); }, [load]));
  const onRefresh = useCallback(() => { setRefreshing(true); load(date); }, [load, date]);

  const selectDate = (d: string) => { setDatePicker(false); setDate(d); load(d); };

  const LAST_14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <OfflineIndicator />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>AI Recommendations</Text>
          <Text style={styles.headerSub}>Menu engineering · Upsell intelligence</Text>
        </View>
        <View style={styles.headerRight}>
          {date !== getToday() && (
            <TouchableOpacity style={styles.todayBtn} onPress={() => selectDate(getToday())}>
              <Text style={styles.todayBtnText}>Today</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.calBtn} onPress={() => setDatePicker(true)}>
            <MaterialIcons name="calendar-today" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.calBtn} onPress={() => { setRefreshing(true); load(date); }}>
            <MaterialIcons name="refresh" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading && !refreshing && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading recommendations…</Text>
        </View>
      )}

      {!loading && notFound && (
        <View style={styles.emptyBox}>
          <MaterialIcons name="inbox" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No snapshot for {date}</Text>
          <Text style={styles.emptySub}>Recommendations require a completed daily snapshot.</Text>
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

      {!loading && data && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {/* AI Insight */}
          {data.insightSource !== 'unavailable' && data.insight && (
            <View style={styles.insightCard}>
              <View style={styles.insightHeader}>
                <MaterialIcons name="auto-awesome" size={16} color={Colors.primary} />
                <Text style={styles.insightLabel}>AI Insight · {data.insightSource === 'cache' ? 'Cached' : 'Gemini'}</Text>
              </View>
              <Text style={styles.insightText}>{data.insight}</Text>
            </View>
          )}

          {/* Menu Engineering Matrix */}
          <Text style={styles.sectionTitle}>Menu Engineering Matrix</Text>
          <View style={styles.quadGrid}>
            {QUADRANTS.map(q => (
              <QuadrantCard key={q.key} q={q} items={data[q.key]} cur={cur} />
            ))}
          </View>

          {/* Upsell Targets */}
          {data.upsellTargets.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Upsell Targets</Text>
              {data.upsellTargets.map((t, i) => (
                <View key={i} style={styles.upsellRow}>
                  <View style={styles.upsellLeft}>
                    <MaterialIcons name="arrow-upward" size={14} color={Colors.success} style={{ marginTop: 1 }} />
                    <View>
                      <Text style={styles.upsellName}>{t.productName}</Text>
                      <Text style={styles.upsellReason}>{t.reason}</Text>
                    </View>
                  </View>
                  <View style={styles.upsellRight}>
                    <Text style={styles.upsellRev}>{fmt(t.revenuePerUnit, cur)}</Text>
                    <Text style={styles.upsellOrders}>{t.currentOrders} orders</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Cross-Sell */}
          {data.crossSell.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Cross-Sell Suggestions</Text>
              {data.crossSell.map((cs, i) => (
                <View key={i} style={styles.crossRow}>
                  <Text style={styles.crossItems}>
                    <Text style={styles.crossTrigger}>{cs.triggerItem}</Text>
                    <Text style={styles.crossArrow}> → </Text>
                    <Text style={styles.crossSuggest}>{cs.suggestItem}</Text>
                  </Text>
                  <Text style={styles.crossReason}>{cs.reason}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Combos */}
          {data.combos.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Combo Suggestions</Text>
              {data.combos.map((c, i) => (
                <View key={i} style={styles.comboRow}>
                  <Text style={styles.comboItems}>{c.items.join(' + ')}</Text>
                  <Text style={styles.comboReason}>{c.reason}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Slow Movers */}
          {data.slowMovers.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Slow Movers</Text>
              {data.slowMovers.map((sm, i) => (
                <View key={i} style={styles.slowRow}>
                  <View style={styles.slowLeft}>
                    <Text style={styles.slowName}>{sm.productName}</Text>
                    <Text style={styles.slowSug}>{sm.suggestion}</Text>
                  </View>
                  <View style={styles.slowRight}>
                    <Text style={styles.slowQty}>{sm.qty} sold</Text>
                    <Text style={styles.slowRev}>{fmt(sm.revenue, cur)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.footer}>
            Generated {new Date(data.generatedAt).toLocaleString('en-IN')} · {data.insightSource}
          </Text>
        </ScrollView>
      )}

      {/* Date Picker */}
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
                onPress={() => selectDate(d)}
              >
                <Text style={[styles.dateItemText, d === date && styles.dateItemTextActive]}>{d}</Text>
                {d === getToday() && <Text style={styles.dateTodayTag}>Today</Text>}
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
  headerRight:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  todayBtn:      { borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: Colors.border },
  todayBtnText:  { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  calBtn:        { padding: 6 },
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
  insightCard:   { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderLeftWidth: 3, borderLeftColor: Colors.primary, ...Shadows.sm },
  insightHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  insightLabel:  { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  insightText:   { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  sectionTitle:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  quadGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quadrant:      { width: '48%', flexGrow: 1, borderRadius: BorderRadius.md, borderWidth: 1, padding: Spacing.md },
  quadLabel:     { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  quadSub:       { fontSize: 9, color: Colors.textMuted, marginTop: 2, marginBottom: Spacing.sm },
  quadEmpty:     { fontSize: FontSize.xs, color: Colors.textMuted, fontStyle: 'italic' },
  quadRow:       { paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: Colors.borderLight + '80' },
  quadName:      { fontSize: FontSize.xs, fontWeight: '500', color: Colors.text },
  quadMeta:      { fontSize: 9, color: Colors.textMuted, marginTop: 1 },
  card:          { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Shadows.sm },
  cardTitle:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  upsellRow:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  upsellLeft:    { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, flex: 1, marginRight: Spacing.md },
  upsellName:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  upsellReason:  { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  upsellRight:   { alignItems: 'flex-end' },
  upsellRev:     { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  upsellOrders:  { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  crossRow:      { paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  crossItems:    { fontSize: FontSize.sm, color: Colors.text },
  crossTrigger:  { fontWeight: '600' },
  crossArrow:    { color: Colors.primary, fontWeight: '700' },
  crossSuggest:  { fontWeight: '600' },
  crossReason:   { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  comboRow:      { paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  comboItems:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  comboReason:   { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  slowRow:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  slowLeft:      { flex: 1, marginRight: Spacing.md },
  slowName:      { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  slowSug:       { fontSize: FontSize.xs, color: Colors.warning, marginTop: 2 },
  slowRight:     { alignItems: 'flex-end' },
  slowQty:       { fontSize: FontSize.xs, color: Colors.textMuted },
  slowRev:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  footer:        { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  modalRoot:     { flex: 1, backgroundColor: Colors.background },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.lg, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle:    { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  dateItem:      { padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dateItemActive:{ backgroundColor: Colors.primaryBg },
  dateItemText:  { fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  dateItemTextActive:{ color: Colors.primary, fontWeight: '700' },
  dateTodayTag:  { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
});

export default RecommendationsScreen;
