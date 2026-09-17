import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { WasteLog } from '../types';
import { PremiumGate } from '../components/PremiumGate';

// ─── constants ────────────────────────────────────────────────────────────────
type WasteReason = WasteLog['reason'];
type Tab = 'log' | 'history';

const REASONS: { id: WasteReason; label: string; color: string; bg: string }[] = [
  { id: 'expired',    label: 'Expired',    color: '#E65100', bg: 'rgba(230,81,0,0.12)' },
  { id: 'damaged',    label: 'Damaged',    color: Colors.danger,  bg: Colors.dangerBg  },
  { id: 'overcooked', label: 'Overcooked', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  { id: 'returned',   label: 'Returned',   color: Colors.info,    bg: Colors.infoBg    },
  { id: 'other',      label: 'Other',      color: '#616161', bg: 'rgba(97,97,97,0.12)' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const emptyForm = {
  productName:   '',
  quantity:      '',
  unit:          '',
  reason:        'damaged' as WasteReason,
  estimatedLoss: '',
  date:          todayStr(),
  notes:         '',
};

// ─── inner component ──────────────────────────────────────────────────────────
const WasteLogScreen: React.FC = () => {
  const { bottom } = useSafeAreaInsets();

  const [tab, setTab]           = useState<Tab>('log');
  const [historyDate, setHistoryDate] = useState(todayStr());
  const [logs, setLogs]         = useState<WasteLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [form, setForm]         = useState(emptyForm);
  const [saving, setSaving]     = useState(false);

  // ── history data loading ─────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await api.getWasteLogs(historyDate);
      setLogs(data);
    } catch {
      Alert.alert('Error', 'Failed to load waste history');
    } finally {
      setLoadingHistory(false);
    }
  }, [historyDate]);

  useFocusEffect(useCallback(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]));

  // reload history when switching to history tab
  const handleTabChange = (t: Tab) => {
    setTab(t);
    if (t === 'history') loadHistory();
  };

  // ── date navigation helpers ──────────────────────────────────────────────────
  const shiftDate = (dateStr: string, delta: number): string => {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  };

  const shiftFormDate = (delta: number) =>
    setForm(p => ({ ...p, date: shiftDate(p.date, delta) }));

  const prevHistoryDay = () => setHistoryDate(d => shiftDate(d, -1));
  const nextHistoryDay = () => setHistoryDate(d => shiftDate(d, +1));

  // ── log waste ────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!form.productName.trim() || !form.quantity || !form.unit.trim() || !form.estimatedLoss) {
      Alert.alert('Required', 'Product name, quantity, unit, and estimated loss are required');
      return;
    }
    setSaving(true);
    try {
      await api.createWasteLog({
        productName:   form.productName.trim(),
        quantity:      parseFloat(form.quantity) || 0,
        unit:          form.unit.trim(),
        reason:        form.reason,
        estimatedLoss: parseFloat(form.estimatedLoss) || 0,
        date:          form.date,
        notes:         form.notes.trim(),
      });
      setForm({ ...emptyForm, date: form.date });
      Alert.alert('Logged', 'Waste entry saved');
      // refresh history if visible next visit
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save waste log');
    } finally {
      setSaving(false);
    }
  };

  // ── delete waste log ─────────────────────────────────────────────────────────
  const deleteLog = (log: WasteLog) => {
    Alert.alert(
      'Delete Entry',
      `Remove waste log for "${log.productName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await api.deleteWasteLog(log._id);
              setLogs(prev => prev.filter(l => l._id !== log._id));
            } catch {
              Alert.alert('Error', 'Failed to delete');
            }
          },
        },
      ]
    );
  };

  // ── reason helper ────────────────────────────────────────────────────────────
  const getReason = (id: WasteReason) => REASONS.find(r => r.id === id) ?? REASONS[4];

  // ── total loss for history day ───────────────────────────────────────────────
  const totalLoss = logs.reduce((s, l) => s + l.estimatedLoss, 0);

  // ── render history item ──────────────────────────────────────────────────────
  const renderLog = ({ item }: { item: WasteLog }) => {
    const reason = getReason(item.reason);
    return (
      <View style={styles.logCard}>
        <View style={{ flex: 1 }}>
          <View style={styles.logTitleRow}>
            <Text style={styles.logProduct} numberOfLines={1}>{item.productName}</Text>
            <View style={[styles.reasonBadge, { backgroundColor: reason.bg }]}>
              <Text style={[styles.reasonBadgeTxt, { color: reason.color }]}>{reason.label}</Text>
            </View>
          </View>
          <Text style={styles.logQty}>{item.quantity} {item.unit}</Text>
          {item.notes ? <Text style={styles.logNotes} numberOfLines={1}>{item.notes}</Text> : null}
        </View>
        <View style={styles.logRight}>
          <Text style={styles.logLoss}>−₹{item.estimatedLoss.toLocaleString('en-IN')}</Text>
          <TouchableOpacity
            onPress={() => deleteLog(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginTop: 4 }}
          >
            <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ─── main render ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Waste Log</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['log', 'history'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => handleTabChange(t)}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {t === 'log' ? 'Log Waste' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Log Waste tab ──────────────────────────────────────────────────── */}
      {tab === 'log' && (
        <ScrollView
          contentContainerStyle={[styles.formContainer, { paddingBottom: 60 + bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Product Name *</Text>
          <TextInput
            style={styles.input}
            value={form.productName}
            onChangeText={v => setForm(p => ({ ...p, productName: v }))}
            placeholder="e.g. Chicken, Bread, Milk"
            placeholderTextColor={Colors.textMuted}
          />

          <View style={styles.row2}>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Quantity *</Text>
              <TextInput
                style={styles.input}
                value={form.quantity}
                onChangeText={v => setForm(p => ({ ...p, quantity: v }))}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1.5, marginLeft: Spacing.md }}>
              <Text style={styles.label}>Unit *</Text>
              <TextInput
                style={styles.input}
                value={form.unit}
                onChangeText={v => setForm(p => ({ ...p, unit: v }))}
                placeholder="kg"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          </View>

          <Text style={styles.label}>Reason</Text>
          <View style={styles.reasonRow}>
            {REASONS.map(r => (
              <TouchableOpacity
                key={r.id}
                style={[
                  styles.reasonChip,
                  form.reason === r.id && { backgroundColor: r.bg, borderColor: r.color },
                ]}
                onPress={() => setForm(p => ({ ...p, reason: r.id }))}
              >
                <Text style={[
                  styles.reasonChipTxt,
                  form.reason === r.id && { color: r.color, fontWeight: '800' },
                ]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Estimated Loss *</Text>
          <View style={styles.prefixInput}>
            <Text style={styles.inputPrefix}>₹</Text>
            <TextInput
              style={[styles.input, styles.inputWithPrefix]}
              value={form.estimatedLoss}
              onChangeText={v => setForm(p => ({ ...p, estimatedLoss: v }))}
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>

          <Text style={styles.label}>Date</Text>
          <View style={styles.datePicker}>
            <TouchableOpacity style={styles.dateArrow} onPress={() => shiftFormDate(-1)}>
              <MaterialIcons name="chevron-left" size={26} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.dateText}>{fmtDate(form.date)}</Text>
            <TouchableOpacity style={styles.dateArrow} onPress={() => shiftFormDate(+1)}>
              <MaterialIcons name="chevron-right" size={26} color={Colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.todayBtn}
              onPress={() => setForm(p => ({ ...p, date: todayStr() }))}
            >
              <Text style={styles.todayTxt}>Today</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={form.notes}
            onChangeText={v => setForm(p => ({ ...p, notes: v }))}
            placeholder="Any additional details..."
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <TouchableOpacity
            style={[styles.logBtn, saving && { opacity: 0.7 }]}
            onPress={submit}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <>
                  <MaterialIcons name="delete-forever" size={20} color={Colors.white} />
                  <Text style={styles.logBtnTxt}>Log Waste</Text>
                </>
            }
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── History tab ────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <View style={{ flex: 1 }}>
          {/* Date navigation */}
          <View style={styles.historyDateNav}>
            <TouchableOpacity style={styles.dateArrow} onPress={prevHistoryDay}>
              <MaterialIcons name="chevron-left" size={26} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.dateText}>{fmtDate(historyDate)}</Text>
            <TouchableOpacity style={styles.dateArrow} onPress={nextHistoryDay}>
              <MaterialIcons name="chevron-right" size={26} color={Colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.todayBtn}
              onPress={() => setHistoryDate(todayStr())}
            >
              <Text style={styles.todayTxt}>Today</Text>
            </TouchableOpacity>
          </View>

          {loadingHistory ? (
            <View style={styles.loader}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : (
            <FlatList
              data={logs}
              renderItem={renderLog}
              keyExtractor={l => l._id}
              contentContainerStyle={styles.historyList}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                logs.length > 0 ? (
                  <View style={styles.totalBanner}>
                    <MaterialIcons name="delete-forever" size={20} color={Colors.danger} />
                    <Text style={styles.totalBannerLabel}>Total Loss for Day</Text>
                    <Text style={styles.totalBannerValue}>
                      −₹{totalLoss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <MaterialIcons name="check-circle-outline" size={56} color={Colors.textMuted} />
                  <Text style={styles.emptyTitle}>No waste logged</Text>
                  <Text style={styles.emptyText}>No waste entries for this date</Text>
                </View>
              }
            />
          )}
        </View>
      )}
    </View>
  );
};

// ─── styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },

  tabs: { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: Spacing.md, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabTxt:       { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.md },
  tabTxtActive: { color: Colors.primary, fontWeight: '800' },

  // Form
  formContainer: { padding: Spacing.lg },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },
  textArea: { minHeight: 80, paddingTop: 12 },
  row2: { flexDirection: 'row', alignItems: 'flex-end' },

  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  reasonChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.round,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  reasonChipTxt: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },

  prefixInput: { flexDirection: 'row', alignItems: 'center' },
  inputPrefix: {
    fontSize: FontSize.lg, fontWeight: '700', color: Colors.textSecondary,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.card, borderTopLeftRadius: BorderRadius.lg, borderBottomLeftRadius: BorderRadius.lg,
    borderWidth: 1, borderRightWidth: 0, borderColor: Colors.border,
  },
  inputWithPrefix: {
    flex: 1,
    borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
  },

  datePicker: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 4, paddingHorizontal: Spacing.sm, gap: Spacing.xs,
  },
  dateArrow: { padding: Spacing.sm },
  dateText: {
    flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text,
    textAlign: 'center',
  },
  todayBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.round,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  todayTxt: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },

  logBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.xl,
    paddingVertical: 16, marginTop: Spacing.xl,
    ...Shadows.primary,
  },
  logBtnTxt: { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },

  // History
  historyDateNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.md, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border, gap: Spacing.xs,
  },
  historyList: { padding: Spacing.lg, paddingBottom: 100 },

  totalBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.danger + '30',
  },
  totalBannerLabel: { flex: 1, fontSize: FontSize.md, color: Colors.danger, fontWeight: '600' },
  totalBannerValue: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.danger },

  logCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  logTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: 4 },
  logProduct:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  reasonBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.round,
  },
  reasonBadgeTxt: { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'capitalize' },
  logQty:    { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' },
  logNotes:  { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  logRight:  { alignItems: 'flex-end', marginLeft: Spacing.sm },
  logLoss:   { fontSize: FontSize.lg, fontWeight: '800', color: Colors.danger },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm },
});

// ─── gated export ─────────────────────────────────────────────────────────────
const WasteLogScreenGated: React.FC = () => (
  <PremiumGate
    feature="Waste Log"
    description="Track food waste, log estimated losses, and review daily waste history."
  >
    <WasteLogScreen />
  </PremiumGate>
);

export default WasteLogScreenGated;
