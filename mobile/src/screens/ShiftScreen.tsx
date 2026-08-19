import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  openShift, getActiveShift, getActiveShiftStats, closeShift, getShiftHistory, getSettings,
  Shift, ShiftStats,
} from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'ShiftScreen'>;

const ShiftScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();

  // ── open-shift form ────────────────────────────────────────────────────
  const [openingCash, setOpeningCash] = useState('');
  const [openingNote, setOpeningNote] = useState('');
  const [opening, setOpening] = useState(false);

  // ── active shift ───────────────────────────────────────────────────────
  const [shift, setShift] = useState<Shift | null>(null);
  const [stats, setStats] = useState<ShiftStats | null>(null);

  // ── close-shift form ───────────────────────────────────────────────────
  const [actualCash, setActualCash] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [closing, setClosing] = useState(false);

  // ── history tab ────────────────────────────────────────────────────────
  const [history, setHistory] = useState<Shift[]>([]);

  // ── tabs ───────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'shift' | 'history'>('shift');

  // ── loading / error ────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── hotel settings (currency symbol) ──────────────────────────────────
  const [settings, setSettings] = useState<any>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef  = useRef(true);

  const loadActiveShift = useCallback(async () => {
    try {
      const s = await getActiveShift();
      if (!mountedRef.current) return;
      setError(''); // L-01: clear stale error after successful reload
      setShift(s);
      if (s) {
        const st = await getActiveShiftStats();
        if (mountedRef.current) setStats(st);
      } else {
        setStats(null);
      }
    } catch (e: any) {
      if (mountedRef.current) setError(e.message || 'Failed to load shift');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const { shifts } = await getShiftHistory(1);
      if (mountedRef.current) setHistory(shifts);
    } catch { /* history is optional */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadActiveShift();
    loadHistory();
    // L-04: load hotel settings for currency symbol
    getSettings().then(s => { if (mountedRef.current) setSettings(s); }).catch(() => {});

    // Poll stats every 30 seconds while component is mounted
    intervalRef.current = setInterval(() => {
      if (mountedRef.current) loadActiveShift();
    }, 30000);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadActiveShift, loadHistory]);

  // ── handlers ───────────────────────────────────────────────────────────

  const handleOpenShift = async () => {
    const cash = parseFloat(openingCash);
    if (isNaN(cash) || cash < 0) {
      Alert.alert('Invalid Amount', 'Enter a valid opening cash amount (0 or more).');
      return;
    }
    setOpening(true);
    try {
      const s = await openShift(cash, openingNote.trim());
      setShift(s);
      setStats({ totalOrders: 0, totalSales: 0, cashSales: 0, upiSales: 0, cardSales: 0 });
      setOpeningCash('');
      setOpeningNote('');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not open shift');
    } finally {
      setOpening(false);
    }
  };

  const handleCloseShift = () => {
    const cash = parseFloat(actualCash);
    if (isNaN(cash) || cash < 0) {
      Alert.alert('Invalid Amount', 'Enter the actual cash in drawer.');
      return;
    }
    Alert.alert(
      'Close Shift',
      `Confirm closing shift with ₹${cash.toFixed(2)} actual cash?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Shift',
          style: 'destructive',
          onPress: async () => {
            if (closing || !shift) return;
            setClosing(true);
            try {
              const closed = await closeShift(shift._id, cash, closingNote.trim());
              setShift(null);
              setStats(null);
              setActualCash('');
              setClosingNote('');
              Alert.alert(
                'Shift Closed',
                `Difference: ${fmt(closed.difference ?? 0)}`,
              );
              loadHistory();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Could not close shift');
            } finally {
              setClosing(false);
            }
          },
        },
      ],
    );
  };

  // ── currency formatting (L-04) ─────────────────────────────────────────
  const sym = settings?.currencySymbol || '₹';
  const fmt = (n: number) => `${sym}${(n ?? 0).toFixed(2)}`;

  // ── computed ───────────────────────────────────────────────────────────

  // M-01: include split-payment cash portions in expected cash
  const expectedCash = shift
    ? shift.openingCash + (stats?.cashSales ?? 0) + (stats?.splitCashSales ?? 0) + shift.cashIn - shift.cashOut
    : 0;

  // ── render helpers ─────────────────────────────────────────────────────

  const renderHistoryItem = ({ item }: { item: Shift }) => {
    const diff = item.difference ?? 0;
    const diffColor = diff < 0 ? Colors.danger : diff > 0 ? Colors.warning : Colors.success;
    return (
      <View style={styles.histCard}>
        <View style={styles.histRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.histCashier}>{item.cashierName}</Text>
            <Text style={styles.histDate}>
              {new Date(item.openedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              {item.closedAt
                ? ` — ${new Date(item.closedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                : ' (Open)'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.histSales}>{fmt(item.totalSales ?? 0)}</Text>
            <Text style={[styles.histDiff, { color: diffColor }]}>
              {diff >= 0 ? '+' : ''}{fmt(diff)}
            </Text>
          </View>
        </View>
        <View style={styles.histMeta}>
          <Text style={styles.histMetaText}>{item.totalOrders ?? 0} orders</Text>
          <Text style={styles.histMetaText}>Cash {fmt(item.cashSales ?? 0)}</Text>
          <Text style={styles.histMetaText}>UPI {fmt(item.upiSales ?? 0)}</Text>
        </View>
      </View>
    );
  };

  // ── screens ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: top }]}>
        <ActivityIndicator size="large" color={Colors.info} />
        <Text style={styles.loadingText}>Loading shift…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Shift Management</Text>
          {shift && (
            <Text style={styles.headerSub}>
              {shift.cashierName} · Open
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => { setLoading(true); loadActiveShift(); loadHistory(); }}
        >
          <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['shift', 'history'] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'shift' ? 'Current Shift' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <MaterialIcons name="error-outline" size={18} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {tab === 'shift' ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          {!shift ? (
            /* ── No active shift — Open Shift form ── */
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <MaterialIcons name="play-circle-filled" size={24} color={Colors.success} />
                <Text style={styles.cardTitle}>Open New Shift</Text>
              </View>

              <Text style={styles.label}>Opening Cash</Text>
              <TextInput
                style={styles.input}
                value={openingCash}
                onChangeText={setOpeningCash}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                returnKeyType="next"
              />

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={openingNote}
                onChangeText={setOpeningNote}
                placeholder="Add a note…"
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={3}
                returnKeyType="done"
              />

              <TouchableOpacity
                style={[styles.primaryBtn, opening && styles.btnDisabled]}
                onPress={handleOpenShift}
                disabled={opening}
                activeOpacity={0.85}
              >
                {opening
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <MaterialIcons name="play-arrow" size={20} color={Colors.white} />}
                <Text style={styles.primaryBtnText}>{opening ? 'Opening…' : 'Open Shift'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* ── Active shift stats + close form ── */
            <>
              {/* Shift Info */}
              <View style={styles.card}>
                <View style={styles.cardTitleRow}>
                  <View style={styles.activeDot} />
                  <Text style={styles.cardTitle}>Active Shift</Text>
                </View>

                <View style={styles.statGrid}>
                  <View style={styles.statCell}>
                    <Text style={styles.statVal}>{shift.cashierName}</Text>
                    <Text style={styles.statLbl}>Cashier</Text>
                  </View>
                  <View style={[styles.statCell, styles.statCellBorder]}>
                    <Text style={styles.statVal}>
                      {new Date(shift.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <Text style={styles.statLbl}>Opened At</Text>
                  </View>
                </View>

                <View style={styles.statGrid}>
                  <View style={styles.statCell}>
                    <Text style={[styles.statVal, { color: Colors.success }]}>{fmt(shift.openingCash)}</Text>
                    <Text style={styles.statLbl}>Opening Cash</Text>
                  </View>
                  <View style={[styles.statCell, styles.statCellBorder]}>
                    <Text style={[styles.statVal, { color: Colors.info }]}>{fmt(expectedCash)}</Text>
                    <Text style={styles.statLbl}>Expected Cash</Text>
                  </View>
                </View>
              </View>

              {/* Sales Stats */}
              <View style={styles.card}>
                <View style={styles.cardTitleRow}>
                  <MaterialIcons name="bar-chart" size={22} color={Colors.info} />
                  <Text style={styles.cardTitle}>Sales Summary</Text>
                </View>

                <View style={styles.statGrid}>
                  <View style={styles.statCell}>
                    <Text style={[styles.statVal, { color: Colors.text }]}>{stats?.totalOrders ?? 0}</Text>
                    <Text style={styles.statLbl}>Orders</Text>
                  </View>
                  <View style={[styles.statCell, styles.statCellBorder]}>
                    <Text style={[styles.statVal, { color: Colors.success }]}>{fmt(stats?.totalSales ?? 0)}</Text>
                    <Text style={styles.statLbl}>Total Sales</Text>
                  </View>
                </View>

                <View style={styles.breakdownRow}>
                  <View style={styles.breakdownItem}>
                    <Text style={[styles.breakdownVal, { color: Colors.success }]}>{fmt(stats?.cashSales ?? 0)}</Text>
                    <Text style={styles.breakdownLbl}>Cash</Text>
                  </View>
                  <View style={styles.breakdownItem}>
                    <Text style={[styles.breakdownVal, { color: Colors.info }]}>{fmt(stats?.upiSales ?? 0)}</Text>
                    <Text style={styles.breakdownLbl}>UPI</Text>
                  </View>
                  <View style={styles.breakdownItem}>
                    <Text style={[styles.breakdownVal, { color: Colors.accent }]}>{fmt(stats?.cardSales ?? 0)}</Text>
                    <Text style={styles.breakdownLbl}>Card</Text>
                  </View>
                </View>
              </View>

              {/* Cash Movements summary */}
              {(shift.cashIn > 0 || shift.cashOut > 0) && (
                <View style={styles.card}>
                  <View style={styles.cardTitleRow}>
                    <MaterialIcons name="swap-horiz" size={22} color={Colors.warning} />
                    <Text style={styles.cardTitle}>Cash Movements</Text>
                  </View>
                  <View style={styles.statGrid}>
                    <View style={styles.statCell}>
                      <Text style={[styles.statVal, { color: Colors.success }]}>+{fmt(shift.cashIn)}</Text>
                      <Text style={styles.statLbl}>Cash In</Text>
                    </View>
                    <View style={[styles.statCell, styles.statCellBorder]}>
                      <Text style={[styles.statVal, { color: Colors.danger }]}>-{fmt(shift.cashOut)}</Text>
                      <Text style={styles.statLbl}>Cash Out</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Close Shift form */}
              <View style={styles.card}>
                <View style={styles.cardTitleRow}>
                  <MaterialIcons name="stop-circle" size={24} color={Colors.danger} />
                  <Text style={styles.cardTitle}>Close Shift</Text>
                </View>

                <Text style={styles.label}>Actual Cash in Drawer</Text>
                <TextInput
                  style={styles.input}
                  value={actualCash}
                  onChangeText={setActualCash}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                />

                <Text style={styles.label}>Closing Note (optional)</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={closingNote}
                  onChangeText={setClosingNote}
                  placeholder="Add a closing note…"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  numberOfLines={3}
                  returnKeyType="done"
                />

                {actualCash.length > 0 && !isNaN(parseFloat(actualCash)) && (
                  <View style={styles.diffPreview}>
                    <Text style={styles.diffLabel}>Estimated Difference</Text>
                    <Text style={[
                      styles.diffValue,
                      { color: (parseFloat(actualCash) - expectedCash) < 0 ? Colors.danger : Colors.success },
                    ]}>
                      {(parseFloat(actualCash) - expectedCash) >= 0 ? '+' : ''}
                      {fmt(parseFloat(actualCash) - expectedCash)}
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.dangerBtn, closing && styles.btnDisabled]}
                  onPress={handleCloseShift}
                  disabled={closing}
                  activeOpacity={0.85}
                >
                  {closing
                    ? <ActivityIndicator color={Colors.white} size="small" />
                    : <MaterialIcons name="stop" size={20} color={Colors.white} />}
                  <Text style={styles.primaryBtnText}>{closing ? 'Closing…' : 'Close Shift'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      ) : (
        /* ── History tab ── */
        <FlatList
          data={history}
          keyExtractor={item => item._id}
          renderItem={renderHistoryItem}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottom + 32 }]}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyText}>No shift history yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  centered:    { justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: Spacing.md, color: Colors.textSecondary, fontSize: FontSize.md },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  backBtn:     { padding: 6, borderRadius: BorderRadius.sm },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  headerSub:   { fontSize: FontSize.sm, color: Colors.textSecondary },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  tabs: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab:           { flex: 1, alignItems: 'center', paddingVertical: Spacing.md },
  tabActive:     { borderBottomWidth: 2.5, borderBottomColor: Colors.info },
  tabText:       { fontSize: FontSize.md, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.info },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerBg, padding: Spacing.md,
    marginHorizontal: Spacing.lg, marginTop: Spacing.md, borderRadius: BorderRadius.md,
  },
  errorText: { flex: 1, color: Colors.danger, fontSize: FontSize.sm, fontWeight: '600' },

  scrollContent: { padding: Spacing.lg, gap: Spacing.md },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, ...Shadows.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  cardTitle:    { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },

  activeDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.success,
  },

  statGrid: { flexDirection: 'row', marginBottom: Spacing.md },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm },
  statCellBorder: { borderLeftWidth: 1, borderLeftColor: Colors.border },
  statVal:  { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  statLbl:  { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  breakdownRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.md,
  },
  breakdownItem: { alignItems: 'center' },
  breakdownVal:  { fontSize: FontSize.md, fontWeight: '800' },
  breakdownLbl:  { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  label: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.background,
    marginBottom: Spacing.md,
  },
  inputMultiline: { height: 80, textAlignVertical: 'top' },

  diffPreview: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.background, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  diffLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  diffValue: { fontSize: FontSize.lg, fontWeight: '900' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.success, borderRadius: BorderRadius.lg, paddingVertical: 14,
  },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.danger, borderRadius: BorderRadius.lg, paddingVertical: 14,
  },
  primaryBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },
  btnDisabled: { opacity: 0.55 },

  histCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, ...Shadows.sm, borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  histRow:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.sm },
  histCashier:{ fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  histDate:   { fontSize: FontSize.sm, color: Colors.textSecondary },
  histSales:  { fontSize: FontSize.lg, fontWeight: '900', color: Colors.text },
  histDiff:   { fontSize: FontSize.sm, fontWeight: '700' },
  histMeta:   { flexDirection: 'row', gap: Spacing.md },
  histMetaText: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' },

  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: FontSize.lg, color: Colors.textMuted },
});

export default ShiftScreen;
