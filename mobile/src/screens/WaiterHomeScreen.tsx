import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, StatusBar, Vibration, Modal, Alert,
  RefreshControl, ScrollView, Dimensions, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { RootStackParamList, Table } from '../types';
import {
  getWaiterOrders, markOrderServed, clearWaiterToken,
  getWaiterToken, getStoredHotelId, getSocketUrl, WaiterOrder,
  getWaiterTables, getWaiterTableSummary, WaiterTableSummary,
} from '../services/api';
import { WAITER_PROFILE_KEY } from './WaiterLoginScreen';
import { setupNotifications } from '../utils/notifications';
import { useBadgeCount, BADGE_KEYS } from '../hooks/useBadgeCount';
import UnreadBadge from '../components/UnreadBadge';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'WaiterHome'>;
type Tab = 'tables' | 'serving';

const { width: SW } = Dimensions.get('window');
const COLS = 3;
const CELL_W = Math.floor((SW - 32 - (COLS - 1) * 10) / COLS);

export default function WaiterHomeScreen({ navigation }: Props) {
  const { top, bottom } = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('tables');
  const [waiterName, setWaiterName] = useState('');

  // ── Tables tab state ──────────────────────────────────────────────────────
  const [tables, setTables] = useState<Table[]>([]);
  const [summary, setSummary] = useState<WaiterTableSummary[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [manualTable, setManualTable] = useState('');

  // ── Serving tab state ─────────────────────────────────────────────────────
  const [orders, setOrders] = useState<WaiterOrder[]>([]);
  const [servingLoading, setServingLoading] = useState(true);
  const [servingId, setServingId] = useState<string | null>(null);
  const [socketLost, setSocketLost] = useState(false);
  const [readyPopup, setReadyPopup] = useState<{ orderNumber: string; tableNumber: string } | null>(null);
  const [tick, setTick] = useState(0);

  const socketRef   = useRef<Socket | null>(null);
  const mountedRef  = useRef(true);
  const seenIds     = useRef<Set<string>>(new Set());
  const { count: badge, increment: incBadge, reset: resetBadge } = useBadgeCount(BADGE_KEYS.waiterReady);

  useEffect(() => {
    const t = setInterval(() => setTick(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Data loaders ───────────────────────────────────────────────────────────
  const loadTables = useCallback(async () => {
    try {
      const [tbls, sum] = await Promise.all([getWaiterTables(), getWaiterTableSummary()]);
      if (mountedRef.current) { setTables(tbls); setSummary(sum); }
    } catch { /* ignore — tables are optional */ }
    finally { if (mountedRef.current) setTablesLoading(false); }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const data = await getWaiterOrders();
      if (mountedRef.current) setOrders(data);
      return true;
    } catch { return false; }
    finally { if (mountedRef.current) setServingLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    loadTables();
    (async () => {
      const ok = await loadOrders();
      if (ok && active) resetBadge();
    })();
    return () => { active = false; };
  }, [loadTables, loadOrders, resetBadge]));

  // ── Socket (for food-ready notifications) ─────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setupNotifications();

    AsyncStorage.getItem(WAITER_PROFILE_KEY).then(raw => {
      if (raw && mountedRef.current) setWaiterName(JSON.parse(raw)?.name || '');
    });

    let socket: Socket;
    (async () => {
      const [hotelId, url, token] = await Promise.all([getStoredHotelId(), getSocketUrl(), getWaiterToken()]);
      if (cancelled || !hotelId) return;

      socket = io(url, { transports: ['websocket'], auth: { token: token || '' }, reconnectionAttempts: 20, reconnectionDelay: 2000 });
      socketRef.current = socket;

      socket.on('connect', () => { socket.emit('join_hotel', hotelId); loadOrders(); loadTables(); });

      socket.on('connect_error', (err) => {
        if (!mountedRef.current) return;
        if (err.message?.includes('authentication')) {
          clearWaiterToken().then(() => { if (mountedRef.current) navigation.replace('RoleSelect'); });
        }
      });

      socket.on('reconnect_failed', () => { if (mountedRef.current) setSocketLost(true); });

      socket.on('waiter_order_ready', (data: { orderId?: string; _id?: string; orderNumber: string; tableNumber: string }) => {
        if (!mountedRef.current) return;
        const id = data.orderId || data._id || '';
        if (id && seenIds.current.has(id)) return;
        if (id) {
          if (seenIds.current.size >= 500) seenIds.current.delete(seenIds.current.values().next().value!);
          seenIds.current.add(id);
        }
        incBadge();
        Vibration.vibrate([0, 300, 150, 300, 150, 500]);
        Notifications.scheduleNotificationAsync({
          content: { title: '🛎️ Order Ready!', body: `Table ${data.tableNumber || '—'} · ${data.orderNumber}`, data: { type: 'waiter_ready' } },
          trigger: { channelId: 'order_alerts_v2' },
        }).catch(() => {});
        setReadyPopup({ orderNumber: data.orderNumber, tableNumber: data.tableNumber || '' });
        loadOrders();
        loadTables();
      });

      socket.on('order_served', (data: { orderId: string }) => {
        if (!mountedRef.current) return;
        setOrders(prev => prev.filter(o => o._id !== data.orderId));
      });
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (socketRef.current) { socketRef.current.off(); socketRef.current.disconnect(); socketRef.current = null; }
    };
  }, [loadOrders, loadTables]);

  const handleServe = async (order: WaiterOrder) => {
    setServingId(order._id);
    try {
      await markOrderServed(order._id);
      setOrders(prev => prev.filter(o => o._id !== order._id));
    } catch (e: any) {
      Alert.alert('Update Failed', e?.message || 'Could not mark order as served. Please try again.');
    } finally { setServingId(null); }
  };

  const handleLogout = async () => {
    await clearWaiterToken();
    await AsyncStorage.removeItem(WAITER_PROFILE_KEY);
    navigation.replace('RoleSelect');
  };

  const handleManualTakeOrder = () => {
    const t = manualTable.trim();
    if (!t) { Alert.alert('Enter Table Number', 'Please type a table number first.'); return; }
    navigation.navigate('WaiterTakeOrder', { tableNumber: t });
    setManualTable('');
  };

  // ── Table helpers ──────────────────────────────────────────────────────────
  const getStatus = (num: number): 'available' | 'occupied' | 'ready' => {
    const e = summary.find(s => s.tableNumber === String(num));
    if (!e) return 'available';
    return e.hasReady ? 'ready' : 'occupied';
  };

  const elapsed = (createdAt: string) => {
    const secs = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  };

  const dineInOrders = orders.filter(o => !o.isParcel);
  const freeCount    = tables.filter(t => getStatus(t.number) === 'available').length;
  const busyCount    = tables.length - freeCount;

  // ── Table cell ─────────────────────────────────────────────────────────────
  const renderTableCell = (table: Table) => {
    const status = getStatus(table.number);
    const color  = status === 'ready' ? Colors.warning : status === 'occupied' ? Colors.danger : Colors.success;
    const label  = status === 'ready' ? 'Ready' : status === 'occupied' ? 'Busy' : 'Free';
    return (
      <TouchableOpacity
        key={table._id}
        style={[styles.tableCell, { width: CELL_W, backgroundColor: color + '14', borderColor: color + '60' }]}
        onPress={() => navigation.navigate('WaiterTakeOrder', { tableNumber: String(table.number), tableName: table.name || '' })}
        activeOpacity={0.75}
      >
        <Text style={[styles.cellNum, { color }]}>{table.number}</Text>
        {table.name ? <Text style={styles.cellName} numberOfLines={1}>{table.name}</Text> : null}
        <View style={[styles.statusPill, { backgroundColor: color + '22' }]}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={[styles.statusText, { color }]}>{label}</Text>
        </View>
        {table.capacity > 0 ? <Text style={styles.capacityText}>{table.capacity} seats</Text> : null}
      </TouchableOpacity>
    );
  };

  // ── Serving order card ────────────────────────────────────────────────────
  const renderOrder = ({ item }: { item: WaiterOrder }) => {
    void tick;
    const busy = servingId === item._id;
    const token = item.orderNumber.split('-').pop() || '?';
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.tokenBadge}><Text style={styles.tokenText}>#{token}</Text></View>
          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            {item.tableNumber ? <Text style={styles.tableText}>Table {item.tableNumber}</Text> : null}
            {item.customerName ? <Text style={styles.custText} numberOfLines={1}>{item.customerName}</Text> : null}
          </View>
          <View style={styles.timePill}>
            <MaterialIcons name="schedule" size={11} color={Colors.success} />
            <Text style={styles.timeText}>{elapsed(item.createdAt)}</Text>
          </View>
        </View>
        <View style={styles.itemList}>
          {item.items.map((it, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemQty}>{it.quantity}×</Text>
              <Text style={styles.itemName} numberOfLines={1}>{it.productName}</Text>
            </View>
          ))}
        </View>
        {item.notes ? (
          <View style={styles.notesRow}>
            <MaterialIcons name="notes" size={13} color={Colors.warning} />
            <Text style={styles.notesText} numberOfLines={2}>{item.notes}</Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.serveBtn, busy && { opacity: 0.5 }]}
          onPress={() => handleServe(item)}
          disabled={!!busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <><MaterialIcons name="room-service" size={17} color={Colors.white} /><Text style={styles.serveBtnText}>Mark Served</Text></>
          }
        </TouchableOpacity>
      </View>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.hLeft}>
          <View>
            <Text style={{ fontSize: 20 }}>🛎️</Text>
            {badge > 0 && <View style={{ position: 'absolute', top: -6, right: -8 }}><UnreadBadge count={badge} /></View>}
          </View>
          <View>
            <Text style={styles.hTitle}>Waiter{waiterName ? ` · ${waiterName}` : ''}</Text>
            {tables.length > 0 && <Text style={styles.hSub}>{freeCount} free · {busyCount} busy</Text>}
          </View>
        </View>
        <View style={styles.hRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => { loadTables(); loadOrders(); }}>
            <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={handleLogout}>
            <MaterialIcons name="logout" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['tables', 'serving'] as Tab[]).map(tab => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)} activeOpacity={0.8}>
            <MaterialIcons
              name={tab === 'tables' ? 'table-restaurant' : 'room-service'}
              size={17}
              color={activeTab === tab ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
              {tab === 'tables' ? 'Tables' : 'Serving'}
            </Text>
            {tab === 'serving' && badge > 0 && <View style={{ marginLeft: 4 }}><UnreadBadge count={badge} /></View>}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Tables tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'tables' && (
        tablesLoading ? (
          <View style={styles.centered}><ActivityIndicator size="large" color={Colors.primary} /></View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.tabContent, { paddingBottom: bottom + 24 }]}
            refreshControl={<RefreshControl refreshing={tablesLoading} onRefresh={() => { setTablesLoading(true); loadTables(); }} />}
          >
            {/* Manual table entry — always shown */}
            <View style={styles.manualBox}>
              <Text style={styles.manualLabel}>Quick Order</Text>
              <View style={styles.manualRow}>
                <TextInput
                  style={styles.manualInput}
                  placeholder="Table number"
                  placeholderTextColor={Colors.textMuted}
                  value={manualTable}
                  onChangeText={setManualTable}
                  keyboardType="numeric"
                  maxLength={4}
                  returnKeyType="go"
                  onSubmitEditing={handleManualTakeOrder}
                />
                <TouchableOpacity style={styles.manualBtn} onPress={handleManualTakeOrder} activeOpacity={0.85}>
                  <MaterialIcons name="add-shopping-cart" size={18} color={Colors.white} />
                  <Text style={styles.manualBtnText}>Take Order</Text>
                </TouchableOpacity>
              </View>
            </View>

            {tables.length > 0 ? (
              <>
                {/* Stats row */}
                <View style={styles.statsRow}>
                  <View style={styles.statChip}>
                    <View style={[styles.statDot, { backgroundColor: Colors.success }]} />
                    <Text style={styles.statLabel}>{freeCount} Free</Text>
                  </View>
                  <View style={styles.statChip}>
                    <View style={[styles.statDot, { backgroundColor: Colors.danger }]} />
                    <Text style={styles.statLabel}>{busyCount} Occupied</Text>
                  </View>
                </View>
                {/* Table grid */}
                <View style={styles.grid}>
                  {tables.filter(t => t.status !== 'inactive').map(renderTableCell)}
                </View>
              </>
            ) : (
              <View style={styles.noTablesTip}>
                <MaterialIcons name="info-outline" size={20} color={Colors.textMuted} />
                <Text style={styles.noTablesTipText}>No tables configured. Use Quick Order above or ask admin to set up tables in Settings.</Text>
              </View>
            )}
          </ScrollView>
        )
      )}

      {/* ── Serving tab ────────────────────────────────────────────────────── */}
      {activeTab === 'serving' && (
        servingLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={{ marginTop: 14, color: Colors.textSecondary, fontSize: FontSize.md }}>Loading orders…</Text>
          </View>
        ) : dineInOrders.length === 0 ? (
          <View style={styles.centered}>
            <Text style={{ fontSize: 52, marginBottom: Spacing.lg }}>✅</Text>
            <Text style={styles.emptyTitle}>Nothing to serve</Text>
            <Text style={styles.emptySub}>Dine-in orders marked Ready will appear here</Text>
          </View>
        ) : (
          <FlatList
            data={dineInOrders}
            keyExtractor={o => o._id}
            renderItem={renderOrder}
            contentContainerStyle={{ padding: Spacing.md, paddingBottom: bottom + 20 }}
            showsVerticalScrollIndicator={false}
          />
        )
      )}

      {/* ── Order Ready popup ─────────────────────────────────────────────── */}
      <Modal visible={!!readyPopup} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setReadyPopup(null)}>
        <TouchableOpacity
          style={{ marginTop: top + 8, marginHorizontal: 16 }}
          onPress={() => { setReadyPopup(null); setActiveTab('serving'); }}
          activeOpacity={1}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.success, borderRadius: 14, padding: 16, gap: 12 }}>
            <MaterialIcons name="room-service" size={24} color={Colors.white} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: Colors.white, fontWeight: '700', fontSize: 16 }}>Order Ready — {readyPopup?.orderNumber}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 2 }}>
                {readyPopup?.tableNumber ? `Table ${readyPopup.tableNumber} · ` : ''}Ready to serve
              </Text>
            </View>
            <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.8)" />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Connection lost overlay ─────────────────────────────────────── */}
      {socketLost && (
        <View style={styles.lostOverlay}>
          <MaterialIcons name="wifi-off" size={52} color={Colors.danger} />
          <Text style={styles.lostTitle}>Connection Lost</Text>
          <Text style={styles.lostText}>Could not reconnect to server. Check your connection.</Text>
          <TouchableOpacity style={styles.lostBtn} onPress={() => { setSocketLost(false); socketRef.current?.connect(); }}>
            <MaterialIcons name="refresh" size={18} color={Colors.white} />
            <Text style={styles.lostBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, padding: 24 },

  // Header
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1.5, borderBottomColor: Colors.border, ...Shadows.sm },
  hLeft:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  hTitle:  { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  hSub:    { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  hRight:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },

  // Tab bar
  tabBar:      { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:   { borderBottomColor: Colors.primary },
  tabLabel:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  tabLabelActive: { color: Colors.primary },

  // Tables tab
  tabContent:  { padding: 16, gap: 16 },
  manualBox:   { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border },
  manualLabel: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  manualRow:   { flexDirection: 'row', gap: 10 },
  manualInput: { flex: 1, height: 44, backgroundColor: Colors.background, borderRadius: BorderRadius.md, paddingHorizontal: 14, fontSize: FontSize.md, color: Colors.text, borderWidth: 1, borderColor: Colors.border },
  manualBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingHorizontal: 16, height: 44 },
  manualBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  statsRow:    { flexDirection: 'row', gap: 10 },
  statChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: BorderRadius.round, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border },
  statDot:     { width: 8, height: 8, borderRadius: 4 },
  statLabel:   { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  grid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tableCell:   { borderRadius: BorderRadius.lg, borderWidth: 1.5, padding: 12, alignItems: 'center', gap: 4 },
  cellNum:     { fontSize: 22, fontWeight: '900' },
  cellName:    { fontSize: FontSize.xs, color: Colors.textSecondary, maxWidth: CELL_W - 24 },
  statusPill:  { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  statusDot:   { width: 6, height: 6, borderRadius: 3 },
  statusText:  { fontSize: 10, fontWeight: '700' },
  capacityText:{ fontSize: 9, color: Colors.textMuted, marginTop: 1 },
  noTablesTip: { flexDirection: 'row', gap: 8, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: 14, borderWidth: 1, borderColor: Colors.border },
  noTablesTipText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },

  // Serving tab — order cards
  card:       { backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, padding: Spacing.lg, marginBottom: Spacing.md, borderWidth: 1.5, borderColor: Colors.success + '50', borderLeftWidth: 4, borderLeftColor: Colors.success, ...Shadows.sm },
  cardRow:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  tokenBadge: { backgroundColor: Colors.successBg ?? '#E6F9EE', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, minWidth: 46, alignItems: 'center' },
  tokenText:  { fontSize: FontSize.lg, fontWeight: '900', color: Colors.success },
  tableText:  { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  custText:   { fontSize: FontSize.sm, color: Colors.textSecondary },
  timePill:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  timeText:   { fontSize: FontSize.xs, fontWeight: '600', color: Colors.success, fontVariant: ['tabular-nums'] },
  itemList:   { borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: Spacing.sm, gap: 3 },
  itemRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemQty:    { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary, minWidth: 24 },
  itemName:   { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  notesRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6, backgroundColor: Colors.accentBg, borderRadius: BorderRadius.sm, padding: 8 },
  notesText:  { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  serveBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: Spacing.md, backgroundColor: Colors.success, borderRadius: BorderRadius.lg, paddingVertical: 12 },
  serveBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },

  // Empty states
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 },

  // Connection lost
  lostOverlay:{ ...StyleSheet.absoluteFillObject, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  lostTitle:  { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  lostText:   { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  lostBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  lostBtnText:{ color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
});
