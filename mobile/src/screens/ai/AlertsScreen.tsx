import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, AIAlertItem, AIAlertResult } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../../utils/constants';
import { getAIAlerts, getAIAlertsByDate } from '../../services/api';
import { OfflineIndicator } from '../../components/OfflineIndicator';

type Props = NativeStackScreenProps<RootStackParamList, 'AIAlerts'>;

function getToday() { return new Date().toISOString().slice(0, 10); }
function fmtPct(n: number) { return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`; }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const SEVERITY_ORDER: Record<AIAlertItem['severity'], number> = { critical: 0, warning: 1, info: 2 };

interface AlertStyle { bg: string; border: string; text: string; icon: keyof typeof MaterialIcons.glyphMap; iconColor: string }
const SEVERITY_STYLES: Record<AIAlertItem['severity'], AlertStyle> = {
  critical: { bg: '#FEF2F2', border: Colors.danger,  text: Colors.danger,  icon: 'error',          iconColor: Colors.danger  },
  warning:  { bg: '#FFFBEB', border: Colors.warning, text: Colors.warning, icon: 'warning',        iconColor: Colors.warning },
  info:     { bg: '#EFF6FF', border: Colors.info,    text: Colors.info,    icon: 'info',           iconColor: Colors.info    },
};

const AlertsScreen: React.FC<Props> = () => {
  const { top } = useSafeAreaInsets();

  const [result, setResult]       = useState<AIAlertResult | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [notFound, setNotFound]   = useState(false);
  const [date, setDate]           = useState(getToday());
  const [isToday, setIsToday]     = useState(true);
  const [datePicker, setDatePicker] = useState(false);

  const load = useCallback(async (d: string, todayFlag: boolean) => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setResult(null);
    try {
      const data = todayFlag ? await getAIAlerts() : await getAIAlertsByDate(d);
      setResult(data);
    } catch (e: any) {
      if (e?.status === 404 || e?.message?.includes('404')) setNotFound(true);
      else setError('Failed to load alerts. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(date, isToday); }, [load]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(date, isToday); }, [load, date, isToday]);

  const selectDate = (d: string) => {
    setDatePicker(false);
    const today = d === getToday();
    setDate(d);
    setIsToday(today);
    load(d, today);
  };

  const sorted = result
    ? [...result.alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    : [];

  const critical = sorted.filter(a => a.severity === 'critical').length;
  const warning  = sorted.filter(a => a.severity === 'warning').length;

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
        <View style={styles.headerLeft}>
          <View>
            <Text style={styles.headerTitle}>Smart Alerts</Text>
            {!loading && result && (
              <Text style={styles.headerSub}>{critical} critical · {warning} warnings</Text>
            )}
          </View>
          {result && !loading && (
            <View style={[styles.liveBadge, { backgroundColor: isToday ? Colors.successBg : Colors.borderLight }]}>
              <Text style={[styles.liveBadgeText, { color: isToday ? Colors.success : Colors.textMuted }]}>
                {isToday ? `Live · ${fmtTime(result.checkedAt)}` : 'Snapshot'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.todayBtn, isToday && styles.todayBtnActive]}
            onPress={() => selectDate(getToday())}
          >
            <Text style={[styles.todayBtnText, isToday && styles.todayBtnTextActive]}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.calBtn} onPress={() => setDatePicker(true)}>
            <MaterialIcons name="calendar-today" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.calBtn} onPress={() => { setRefreshing(true); load(date, isToday); }}>
            <MaterialIcons name="refresh" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading && !refreshing && (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Checking for alerts…</Text>
        </View>
      )}

      {!loading && notFound && (
        <View style={styles.emptyBox}>
          <MaterialIcons name="inbox" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No data for {date}</Text>
          <Text style={styles.emptySub}>Historical alerts require a completed daily snapshot.</Text>
        </View>
      )}

      {!loading && error && (
        <View style={styles.errorBox}>
          <MaterialIcons name="error-outline" size={20} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(date, isToday)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && result && sorted.length === 0 && (
        <View style={styles.allClearBox}>
          <MaterialIcons name="check-circle" size={56} color={Colors.success} />
          <Text style={styles.allClearTitle}>All Clear</Text>
          <Text style={styles.allClearSub}>No anomalies detected for {result.date}</Text>
          <View style={[styles.liveBadge, { backgroundColor: isToday ? Colors.successBg : Colors.borderLight, marginTop: Spacing.sm }]}>
            <Text style={[styles.liveBadgeText, { color: isToday ? Colors.success : Colors.textMuted }]}>
              {result.dataSource === 'realtime' ? 'Realtime' : 'Snapshot'}
            </Text>
          </View>
        </View>
      )}

      {!loading && sorted.length > 0 && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {sorted.map((alert, i) => {
            const s = SEVERITY_STYLES[alert.severity];
            const pctColor = alert.changePct >= 0 ? Colors.success : Colors.danger;
            return (
              <View key={`${alert.type}-${i}`} style={[styles.alertCard, { backgroundColor: s.bg, borderLeftColor: s.border }]}>
                <View style={styles.alertHeader}>
                  <MaterialIcons name={s.icon} size={18} color={s.iconColor} />
                  <Text style={[styles.alertTitle, { color: s.text }]}>{alert.title}</Text>
                </View>
                <Text style={[styles.alertMessage, { color: s.text }]}>{alert.message}</Text>
                <View style={styles.alertMeta}>
                  <Text style={styles.alertMetaItem}>Value: <Text style={styles.alertMetaVal}>{alert.value.toLocaleString('en-IN')}</Text></Text>
                  <Text style={styles.alertMetaItem}>Baseline: <Text style={styles.alertMetaVal}>{alert.baseline.toLocaleString('en-IN')}</Text></Text>
                  <Text style={styles.alertMetaItem}>Change: <Text style={[styles.alertMetaVal, { color: pctColor }]}>{fmtPct(alert.changePct)}</Text></Text>
                </View>
              </View>
            );
          })}
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
  root:            { flex: 1, backgroundColor: Colors.background },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerLeft:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerTitle:     { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  headerSub:       { fontSize: FontSize.xs, color: Colors.textMuted },
  headerRight:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveBadge:       { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  liveBadgeText:   { fontSize: FontSize.xs, fontWeight: '600' },
  todayBtn:        { borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: Colors.border },
  todayBtnActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  todayBtnText:    { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  todayBtnTextActive:{ color: Colors.surface },
  calBtn:          { padding: 6 },
  scroll:          { flex: 1 },
  scrollContent:   { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxxl },
  centered:        { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:     { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  emptyBox:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, gap: Spacing.md },
  emptyTitle:      { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub:        { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  errorBox:        { margin: Spacing.lg, backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.md, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  errorText:       { fontSize: FontSize.sm, color: Colors.danger, textAlign: 'center' },
  retryBtn:        { backgroundColor: Colors.danger, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.surface },
  allClearBox:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl, gap: Spacing.sm },
  allClearTitle:   { fontSize: 24, fontWeight: '800', color: Colors.text },
  allClearSub:     { fontSize: FontSize.sm, color: Colors.textMuted },
  alertCard:       { borderRadius: BorderRadius.md, borderLeftWidth: 4, padding: Spacing.md, gap: Spacing.sm },
  alertHeader:     { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  alertTitle:      { flex: 1, fontSize: FontSize.md, fontWeight: '700' },
  alertMessage:    { fontSize: FontSize.sm, opacity: 0.85, lineHeight: 18 },
  alertMeta:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: 4 },
  alertMetaItem:   { fontSize: FontSize.xs, color: Colors.textSecondary },
  alertMetaVal:    { fontWeight: '700', color: Colors.text },
  modalRoot:       { flex: 1, backgroundColor: Colors.background },
  modalHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.lg, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle:      { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  dateItem:        { padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dateItemActive:  { backgroundColor: Colors.primaryBg },
  dateItemText:    { fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  dateItemTextActive:{ color: Colors.primary, fontWeight: '700' },
  dateTodayTag:    { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
});

export default AlertsScreen;
