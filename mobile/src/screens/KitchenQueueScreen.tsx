import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, RefreshControl, StatusBar, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  getCashierOrders, markOrderCompleteCashier, CashierOrder,
} from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'KitchenQueue'>;

const KitchenQueueScreen: React.FC<Props> = ({ navigation }) => {
  const { bottom } = useSafeAreaInsets();

  const [orders,      setOrders]      = useState<CashierOrder[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [marking,     setMarking]     = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [tick,        setTick]        = useState(0);
  const [error,       setError]       = useState<string | null>(null);

  const mountedRef = useRef(true);

  // 1-second ticker keeps elapsed time strings live
  useEffect(() => {
    const t = setInterval(() => setTick(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getCashierOrders();
      if (mountedRef.current) {
        setOrders(data.filter(o => o.status === 'preparing' || o.status === 'ready'));
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (e: any) {
      // Only surface errors on the initial / manual load; background ticks fail silently
      if (!silent && mountedRef.current) {
        setError(e?.message || 'Failed to load kitchen orders.');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Re-fetch on every screen focus
  useFocusEffect(useCallback(() => {
    loadOrders();
  }, [loadOrders]));

  // 30-second auto-refresh
  useEffect(() => {
    mountedRef.current = true;
    const interval = setInterval(() => loadOrders(true), 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [loadOrders]);

  const onRefresh = () => {
    setRefreshing(true);
    loadOrders(true);
  };

  const handleMarkComplete = async (order: CashierOrder) => {
    setMarking(order._id);
    try {
      await markOrderCompleteCashier(order._id);
      if (mountedRef.current) {
        setOrders(prev => prev.filter(o => o._id !== order._id));
      }
    } catch (e: any) {
      Alert.alert('Error', (e as Error).message || 'Could not mark order as complete. Try again.');
    } finally {
      if (mountedRef.current) setMarking(null);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const elapsed = (createdAt: string) => {
    void tick; // subscribe to 1-second ticker
    const secs = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const timerColor = (createdAt: string) => {
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000);
    if (mins < 5)  return Colors.success;
    if (mins < 10) return Colors.warning;
    return Colors.danger;
  };

  const orderLabel = (order: CashierOrder) => {
    if (order.tableNumber) return `Table ${order.tableNumber}`;
    if (order.isParcel)    return 'Takeaway';
    return 'Delivery';
  };

  const formatUpdated = () =>
    lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // ── Derived data ──────────────────────────────────────────────────────────────

  const readyOrders     = orders.filter(o => o.status === 'ready');
  const preparingOrders = orders.filter(o => o.status === 'preparing');
  const isEmpty         = readyOrders.length === 0 && preparingOrders.length === 0;

  // ── Order card ────────────────────────────────────────────────────────────────

  const renderOrderCard = (order: CashierOrder, isReady: boolean) => {
    const token        = order.orderNumber.split('-').pop() || '?';
    const isMarking    = marking === order._id;
    const accent       = isReady ? Colors.success : Colors.warning;
    const accentBg     = isReady ? Colors.statusReadyBg : Colors.warningBg;

    return (
      <View key={order._id} style={[styles.card, { borderLeftColor: accent }]}>
        {/* Card header row */}
        <View style={styles.cardHeader}>
          <View style={[styles.tokenBadge, { backgroundColor: accentBg }]}>
            <Text style={[styles.tokenText, { color: accent }]}>#{token}</Text>
          </View>

          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            <Text style={styles.tableText}>{orderLabel(order)}</Text>
            {!!order.customerName && (
              <Text style={styles.customerText} numberOfLines={1}>{order.customerName}</Text>
            )}
            <View style={[styles.statusPill, { backgroundColor: accent + '22' }]}>
              <View style={[styles.statusDot, { backgroundColor: accent }]} />
              <Text style={[styles.statusLabel, { color: accent }]}>
                {isReady ? 'Ready' : 'Preparing'}
              </Text>
            </View>
          </View>

          <Text style={[styles.timeText, { color: timerColor(order.createdAt) }]}>
            {elapsed(order.createdAt)}
          </Text>
        </View>

        {/* Items summary */}
        <View style={styles.itemsList}>
          {order.items.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemQty}>{item.quantity}×</Text>
              <Text style={styles.itemName} numberOfLines={1}>{item.productName}</Text>
            </View>
          ))}
        </View>

        {/* Notes */}
        {!!order.notes && (
          <View style={styles.notesRow}>
            <MaterialIcons name="notes" size={14} color={Colors.warning} />
            <Text style={styles.notesText} numberOfLines={2}>{order.notes}</Text>
          </View>
        )}

        {/* Mark Complete — only on ready orders */}
        {isReady && (
          <TouchableOpacity
            style={[styles.serveBtn, isMarking && styles.serveBtnDisabled]}
            onPress={() => handleMarkComplete(order)}
            disabled={isMarking}
            activeOpacity={0.85}
          >
            {isMarking ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <MaterialIcons name="check-circle" size={18} color={Colors.white} />
                <Text style={styles.serveBtnText}>Mark Complete</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ── Loading state ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.warning} />
        <Text style={styles.loadingText}>Loading kitchen queue…</Text>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, marginLeft: Spacing.md }}>
          <Text style={styles.headerTitle}>Kitchen Queue</Text>
          <Text style={styles.headerSub}>
            {readyOrders.length} ready · {preparingOrders.length} preparing
          </Text>
        </View>

        <TouchableOpacity
          style={styles.iconBtn}
          onPress={onRefresh}
          activeOpacity={0.8}
        >
          <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Last-updated banner */}
      <View style={styles.updatedBanner}>
        <MaterialIcons name="access-time" size={12} color={Colors.textMuted} />
        <Text style={styles.updatedText}>
          Updated {formatUpdated()} · auto-refreshes every 30s
        </Text>
      </View>

      {/* Stats summary */}
      <View style={styles.statsRow}>
        <View style={[styles.statChip, { borderColor: Colors.success + '60', backgroundColor: Colors.statusReadyBg }]}>
          <Text style={[styles.statValue, { color: Colors.success }]}>{readyOrders.length}</Text>
          <Text style={styles.statLabel}>READY</Text>
        </View>
        <View style={[styles.statChip, { borderColor: Colors.warning + '60', backgroundColor: Colors.warningBg }]}>
          <Text style={[styles.statValue, { color: Colors.warning }]}>{preparingOrders.length}</Text>
          <Text style={styles.statLabel}>PREPARING</Text>
        </View>
        <View style={[styles.statChip, { borderColor: Colors.border }]}>
          <Text style={[styles.statValue, { color: Colors.text }]}>{orders.length}</Text>
          <Text style={styles.statLabel}>TOTAL</Text>
        </View>
      </View>

      {/* Scrollable content with pull-to-refresh */}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottom + 32 },
          isEmpty && styles.scrollContentEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Colors.warning]}
            tintColor={Colors.warning}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {isEmpty ? (
          <View style={styles.emptyWrap}>
            {error ? (
              <>
                <MaterialIcons name="error-outline" size={48} color={Colors.danger} />
                <Text style={styles.emptyTitle}>Failed to load orders</Text>
                <Text style={[styles.emptyText, { color: Colors.danger }]}>{error}</Text>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 52 }}>🍳</Text>
                <Text style={styles.emptyTitle}>Kitchen is clear</Text>
                <Text style={styles.emptyText}>
                  No orders are currently being prepared or ready to serve.
                </Text>
              </>
            )}
          </View>
        ) : (
          <>
            {/* Ready section (shown first — needs action) */}
            {readyOrders.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionDot, { backgroundColor: Colors.success }]} />
                  <Text style={[styles.sectionTitle, { color: Colors.success }]}>READY</Text>
                  <View style={[styles.sectionBadge, { backgroundColor: Colors.success }]}>
                    <Text style={styles.sectionBadgeText}>{readyOrders.length}</Text>
                  </View>
                </View>
                {readyOrders.map(order => renderOrderCard(order, true))}
              </>
            )}

            {/* Preparing section */}
            {preparingOrders.length > 0 && (
              <>
                <View style={[styles.sectionHeader, readyOrders.length > 0 && { marginTop: Spacing.lg }]}>
                  <View style={[styles.sectionDot, { backgroundColor: Colors.warning }]} />
                  <Text style={[styles.sectionTitle, { color: Colors.warning }]}>PREPARING</Text>
                  <View style={[styles.sectionBadge, { backgroundColor: Colors.warning }]}>
                    <Text style={styles.sectionBadgeText}>{preparingOrders.length}</Text>
                  </View>
                </View>
                {preparingOrders.map(order => renderOrderCard(order, false))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  headerSub:   { fontSize: FontSize.sm, color: Colors.textSecondary },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // Updated banner
  updatedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.lg, paddingVertical: 5,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  updatedText: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },

  // Stats row
  statsRow: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  statChip: {
    flex: 1, alignItems: 'center',
    paddingVertical: Spacing.sm, borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  statValue: { fontSize: FontSize.xxl, fontWeight: '900' },
  statLabel: { fontSize: 9, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.4 },

  // Scroll content
  scrollContent:      { padding: Spacing.lg },
  scrollContentEmpty: { flex: 1 },

  // Section headers
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  sectionDot:  { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { flex: 1, fontSize: FontSize.xs, fontWeight: '900', letterSpacing: 0.8 },
  sectionBadge: {
    borderRadius: BorderRadius.round,
    minWidth: 22, height: 22,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
  },
  sectionBadgeText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '900' },

  // Order card
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4, ...Shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  tokenBadge: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  tokenText:    { fontSize: FontSize.sm, fontWeight: '800' },
  tableText:    { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  customerText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  timeText:     { fontSize: FontSize.md, fontWeight: '800', textAlign: 'right' },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 100, alignSelf: 'flex-start', marginTop: 4,
  },
  statusDot:   { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: FontSize.xs, fontWeight: '700' },

  // Items list
  itemsList: { gap: 4, marginBottom: Spacing.sm },
  itemRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemQty:   { fontSize: FontSize.sm, fontWeight: '800', color: Colors.info, width: 28 },
  itemName:  { flex: 1, fontSize: FontSize.sm, color: Colors.text },

  // Notes
  notesRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: 8, padding: 8,
  },
  notesText: { flex: 1, fontSize: FontSize.sm, color: Colors.warning },

  // Serve button
  serveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.success, borderRadius: BorderRadius.lg,
    paddingVertical: 12, marginTop: Spacing.sm,
  },
  serveBtnDisabled: { opacity: 0.6 },
  serveBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Loading / empty
  loadingText: { marginTop: 16, color: Colors.textSecondary, fontSize: FontSize.md },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingTop: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  emptyText:  { fontSize: FontSize.md, color: Colors.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xl },
});

export default KitchenQueueScreen;
