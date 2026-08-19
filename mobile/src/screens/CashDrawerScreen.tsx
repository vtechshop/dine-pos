import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  FlatList, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  getActiveShift, getActiveShiftStats, addCashMovement, getSettings,
  Shift, ShiftMovement, ShiftStats,
} from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'CashDrawerScreen'>;

const CashDrawerScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();

  const [shift, setShift] = useState<Shift | null>(null);
  const [stats, setStats] = useState<ShiftStats | null>(null); // M-02
  const [settings, setSettings] = useState<any>(null);         // L-04
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Cash In form
  const [inAmount, setInAmount]  = useState('');
  const [inReason, setInReason]  = useState('');
  const [addingIn, setAddingIn]  = useState(false);

  // Cash Out form
  const [outAmount, setOutAmount]  = useState('');
  const [outReason, setOutReason]  = useState('');
  const [addingOut, setAddingOut]  = useState(false);

  const mountedRef = useRef(true);

  const loadShift = useCallback(async () => {
    try {
      const [s, settingsData] = await Promise.all([
        getActiveShift(),
        getSettings().catch(() => null), // L-04: load currency symbol; non-fatal
      ]);
      let st: ShiftStats | null = null;
      if (s) {
        st = await getActiveShiftStats().catch(() => null); // M-02
      }
      if (mountedRef.current) {
        setShift(s);
        setStats(st);
        setSettings(settingsData);
        setError('');
      }
    } catch (e: any) {
      if (mountedRef.current) setError(e.message || 'Failed to load shift');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadShift();
    return () => { mountedRef.current = false; };
  }, [loadShift]);

  // ── currency formatting (L-04) ─────────────────────────────────────────
  const sym = settings?.currencySymbol || '₹';
  const fmt = (n: number) => `${sym}${(n ?? 0).toFixed(2)}`;

  // ── computed balance (M-02: includes cash sales + split-payment cash portions) ──
  const currentBalance = shift
    ? shift.openingCash + (stats?.cashSales ?? 0) + (stats?.splitCashSales ?? 0) + shift.cashIn - shift.cashOut
    : 0;

  // ── Cash In ────────────────────────────────────────────────────────────
  const handleCashIn = async () => {
    const amt = parseFloat(inAmount);
    if (!shift) return;
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Enter a positive amount.');
      return;
    }
    setAddingIn(true);
    try {
      await addCashMovement(shift._id, 'cash_in', amt, inReason.trim());
      // L-05: re-fetch from server so balance and movements are authoritative
      const [updatedShift, statsData] = await Promise.all([
        getActiveShift(),
        getActiveShiftStats(),
      ]);
      if (mountedRef.current) {
        setShift(updatedShift);
        setStats(statsData);
      }
      setInAmount('');
      setInReason('');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not add cash');
    } finally {
      setAddingIn(false);
    }
  };

  // ── Cash Out ───────────────────────────────────────────────────────────
  const handleCashOut = async () => {
    const amt = parseFloat(outAmount);
    if (!shift) return;
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Enter a positive amount.');
      return;
    }
    setAddingOut(true);
    try {
      await addCashMovement(shift._id, 'cash_out', amt, outReason.trim());
      // L-05: re-fetch from server so balance and movements are authoritative
      const [updatedShift, statsData] = await Promise.all([
        getActiveShift(),
        getActiveShiftStats(),
      ]);
      if (mountedRef.current) {
        setShift(updatedShift);
        setStats(statsData);
      }
      setOutAmount('');
      setOutReason('');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not withdraw cash');
    } finally {
      setAddingOut(false);
    }
  };

  // ── render movement item ───────────────────────────────────────────────
  const renderMovement = ({ item }: { item: ShiftMovement }) => {
    const isCashIn = item.type === 'cash_in';
    const color    = isCashIn ? Colors.success : Colors.danger;
    const icon: keyof typeof MaterialIcons.glyphMap = isCashIn ? 'add-circle' : 'remove-circle';
    return (
      <View style={styles.movementCard}>
        <MaterialIcons name={icon} size={28} color={color} />
        <View style={{ flex: 1, marginLeft: Spacing.md }}>
          <Text style={styles.movementType}>{isCashIn ? 'Cash In' : 'Cash Out'}</Text>
          {item.reason ? <Text style={styles.movementReason}>{item.reason}</Text> : null}
          <Text style={styles.movementTime}>
            {new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            {' · '}{item.cashierName}
          </Text>
        </View>
        <Text style={[styles.movementAmount, { color }]}>
          {isCashIn ? '+' : '-'}{fmt(item.amount)}
        </Text>
      </View>
    );
  };

  // ── loading / error states ─────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: top }]}>
        <ActivityIndicator size="large" color={Colors.info} />
        <Text style={styles.loadingText}>Loading drawer…</Text>
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
          <Text style={styles.headerTitle}>Cash Drawer</Text>
          {shift && <Text style={styles.headerSub}>{shift.cashierName}</Text>}
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={() => { setLoading(true); loadShift(); }}>
          <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <MaterialIcons name="error-outline" size={18} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!shift ? (
        /* ── No active shift ── */
        <View style={styles.centered}>
          <Text style={{ fontSize: 48, marginBottom: Spacing.md }}>💳</Text>
          <Text style={styles.noShiftTitle}>No Active Shift</Text>
          <Text style={styles.noShiftText}>Open a shift first to manage the cash drawer.</Text>
          <TouchableOpacity
            style={styles.goShiftBtn}
            onPress={() => navigation.navigate('ShiftScreen')}
            activeOpacity={0.85}
          >
            <Text style={styles.goShiftBtnText}>Go to Shift Management</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={(shift.movements ?? []).slice().reverse()}
          keyExtractor={item => item._id ?? String(item.timestamp)}
          renderItem={renderMovement}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottom + 32 }]}
          ListHeaderComponent={
            <>
              {/* Balance Banner */}
              <View style={styles.balanceBanner}>
                <Text style={styles.balanceLabel}>Current Balance</Text>
                <Text style={styles.balanceValue}>{fmt(currentBalance)}</Text>
                <View style={styles.balanceMeta}>
                  <Text style={styles.balanceMetaText}>Opening: {fmt(shift.openingCash)}</Text>
                  <Text style={styles.balanceMetaText}>In: +{fmt(shift.cashIn)}</Text>
                  <Text style={styles.balanceMetaText}>Out: -{fmt(shift.cashOut)}</Text>
                </View>
              </View>

              {/* Cash In form */}
              <View style={styles.card}>
                <View style={styles.cardTitleRow}>
                  <MaterialIcons name="add-circle" size={22} color={Colors.success} />
                  <Text style={[styles.cardTitle, { color: Colors.success }]}>Add Cash</Text>
                </View>

                <Text style={styles.label}>Amount</Text>
                <TextInput
                  style={styles.input}
                  value={inAmount}
                  onChangeText={setInAmount}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                />

                <Text style={styles.label}>Reason</Text>
                <TextInput
                  style={styles.input}
                  value={inReason}
                  onChangeText={setInReason}
                  placeholder="e.g. Float top-up"
                  placeholderTextColor={Colors.textMuted}
                  returnKeyType="done"
                />

                <TouchableOpacity
                  style={[styles.cashInBtn, addingIn && styles.btnDisabled]}
                  onPress={handleCashIn}
                  disabled={addingIn}
                  activeOpacity={0.85}
                >
                  {addingIn
                    ? <ActivityIndicator color={Colors.white} size="small" />
                    : <MaterialIcons name="add" size={18} color={Colors.white} />}
                  <Text style={styles.btnText}>{addingIn ? 'Adding…' : 'Add Cash'}</Text>
                </TouchableOpacity>
              </View>

              {/* Cash Out form */}
              <View style={[styles.card, { marginBottom: Spacing.lg }]}>
                <View style={styles.cardTitleRow}>
                  <MaterialIcons name="remove-circle" size={22} color={Colors.danger} />
                  <Text style={[styles.cardTitle, { color: Colors.danger }]}>Withdraw Cash</Text>
                </View>

                <Text style={styles.label}>Amount</Text>
                <TextInput
                  style={styles.input}
                  value={outAmount}
                  onChangeText={setOutAmount}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                />

                <Text style={styles.label}>Reason</Text>
                <TextInput
                  style={styles.input}
                  value={outReason}
                  onChangeText={setOutReason}
                  placeholder="e.g. Petty cash expense"
                  placeholderTextColor={Colors.textMuted}
                  returnKeyType="done"
                />

                <TouchableOpacity
                  style={[styles.cashOutBtn, addingOut && styles.btnDisabled]}
                  onPress={handleCashOut}
                  disabled={addingOut}
                  activeOpacity={0.85}
                >
                  {addingOut
                    ? <ActivityIndicator color={Colors.white} size="small" />
                    : <MaterialIcons name="remove" size={18} color={Colors.white} />}
                  <Text style={styles.btnText}>{addingOut ? 'Withdrawing…' : 'Withdraw'}</Text>
                </TouchableOpacity>
              </View>

              {/* Movements heading */}
              {(shift.movements ?? []).length > 0 && (
                <Text style={styles.sectionTitle}>Movement History</Text>
              )}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 36 }}>💸</Text>
              <Text style={styles.emptyText}>No cash movements recorded yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
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

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerBg, padding: Spacing.md,
    marginHorizontal: Spacing.lg, marginTop: Spacing.md, borderRadius: BorderRadius.md,
  },
  errorText: { flex: 1, color: Colors.danger, fontSize: FontSize.sm, fontWeight: '600' },

  noShiftTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, marginBottom: Spacing.sm },
  noShiftText:  { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xl },
  goShiftBtn: {
    backgroundColor: Colors.info, borderRadius: BorderRadius.lg,
    paddingVertical: 12, paddingHorizontal: 24,
  },
  goShiftBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  listContent: { padding: Spacing.lg },

  balanceBanner: {
    backgroundColor: Colors.info, borderRadius: BorderRadius.xl,
    padding: Spacing.xl, alignItems: 'center', marginBottom: Spacing.lg,
    ...Shadows.md,
  },
  balanceLabel: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)', fontWeight: '700', letterSpacing: 0.5 },
  balanceValue: { fontSize: FontSize.title, fontWeight: '900', color: Colors.white, marginVertical: 6 },
  balanceMeta:  { flexDirection: 'row', gap: Spacing.lg, marginTop: 4 },
  balanceMetaText: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, ...Shadows.sm,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  cardTitle:    { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },

  label: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.background,
    marginBottom: Spacing.md,
  },

  cashInBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.success, borderRadius: BorderRadius.lg, paddingVertical: 12,
  },
  cashOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.danger, borderRadius: BorderRadius.lg, paddingVertical: 12,
  },
  btnText:    { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },
  btnDisabled: { opacity: 0.55 },

  sectionTitle: {
    fontSize: FontSize.sm, fontWeight: '800', color: Colors.textSecondary,
    letterSpacing: 0.5, marginBottom: Spacing.sm, textTransform: 'uppercase',
  },

  movementCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, marginBottom: Spacing.sm,
    ...Shadows.sm, borderWidth: 1, borderColor: Colors.border,
  },
  movementType:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  movementReason: { fontSize: FontSize.sm, color: Colors.textSecondary },
  movementTime:   { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  movementAmount: { fontSize: FontSize.lg, fontWeight: '900' },

  emptyWrap: { alignItems: 'center', paddingTop: 24, gap: Spacing.sm },
  emptyText: { fontSize: FontSize.md, color: Colors.textMuted },
});

export default CashDrawerScreen;
