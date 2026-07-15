import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, StatusBar, Vibration, Modal, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootStackParamList, Settings, Order } from '../types';
import {
  getCashierOrders, completeOrderPayment, clearCashierToken,
  getCashierToken, getBaseUrl, getStoredHotelId, getSocketUrl, CashierOrder,
} from '../services/api';
import { CASHIER_PROFILE_KEY } from './CashierLoginScreen';
import { setupNotifications } from '../utils/notifications';
import * as Notifications from 'expo-notifications';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';
import { useBadgeCount, BADGE_KEYS } from '../hooks/useBadgeCount';
import UnreadBadge from '../components/UnreadBadge';
import { printReceipt } from '../utils/receipt';

type Props = NativeStackScreenProps<RootStackParamList, 'CashierDashboard'>;
type PaymentMethod = 'cash' | 'upi' | 'card';

const ACTIVE_STATUSES = ['pending', 'preparing', 'ready', 'served'];

const CashierDashboardScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();
  const [orders, setOrders] = useState<CashierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [cashierName, setCashierName] = useState('');
  const [payModal, setPayModal] = useState<{ order: CashierOrder } | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('cash');
  const [completing, setCompleting] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mountedRef = useRef(true);
  const [tick, setTick] = useState(0);
  const { count: cashierBadge, increment: incCashierBadge, reset: resetCashierBadge } = useBadgeCount(BADGE_KEYS.cashierPending);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const ok = await loadOrders();
      if (ok && active) resetCashierBadge();
    })();
    return () => { active = false; };
  }, [loadOrders, resetCashierBadge]));

  // Counter instead of boolean — every new order triggers a re-render
  const [newOrderCount, setNewOrderCount] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-dismiss popup after 5 seconds
  useEffect(() => {
    if (!newOrderCount) return;
    const t = setTimeout(() => setNewOrderCount(0), 5000);
    return () => clearTimeout(t);
  }, [newOrderCount]);

  const elapsed = (createdAt: string) => {
    const secs = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const timerColor = (createdAt: string) => {
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 5)  return Colors.success;
    if (mins < 10) return Colors.warning;
    return Colors.danger;
  };

  const activeOrders    = orders.filter(o => ACTIVE_STATUSES.includes(o.status));
  const completedOrders = orders.filter(o => o.status === 'completed');
  const todayRevenue    = completedOrders.reduce((sum, o) => sum + o.grandTotal, 0);

  const loadOrders = useCallback(async () => {
    try {
      const data = await getCashierOrders();
      if (mountedRef.current) setOrders(data);
      return true;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setupNotifications();
    loadOrders();

    AsyncStorage.getItem(CASHIER_PROFILE_KEY).then(raw => {
      if (raw && mountedRef.current) setCashierName((JSON.parse(raw) as { name?: string }).name || '');
    });

    (async () => {
      try {
        const [base, token] = await Promise.all([getBaseUrl(), getCashierToken()]);
        const res = await fetch(`${base}/settings`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok && mountedRef.current) setSettings(await res.json());
      } catch { /* no print without settings */ }
    })();

    let socket: Socket;
    (async () => {
      const [hotelId, url, token] = await Promise.all([
        getStoredHotelId(), getSocketUrl(), getCashierToken(),
      ]);
      console.log(`[SOCKET][Cashier] hotelId=${hotelId} | url=${url} | hasToken=${!!token}`);
      if (!hotelId || !mountedRef.current) {
        console.log('[SOCKET][Cashier] ABORT — hotelId missing, socket will not connect');
        return;
      }

      socket = io(url, {
        transports: ['websocket'],
        auth: { token: token || '' },
        reconnectionAttempts: 20,
        reconnectionDelay: 2000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        console.log(`[SOCKET][Cashier] Connected | socketId=${socket.id}`);
        socket.emit('join_hotel', hotelId);
        console.log(`[SOCKET][Cashier] join_hotel emitted | hotelId=${hotelId}`);
        loadOrders();
      });

      socket.on('connect_error', (err) => {
        console.log(`[SOCKET][Cashier] connect_error: ${err.message}`);
        if (!mountedRef.current) return;
        if (err.message?.includes('authentication')) {
          clearCashierToken().then(() => {
            if (mountedRef.current) navigation.replace('RoleSelect');
          });
        }
      });

      socket.on('disconnect', (reason) => {
        console.log(`[SOCKET][Cashier] Disconnected | reason=${reason}`);
      });

      socket.on('new_order', (data: { _id?: string; orderNumber?: string }) => {
        console.log(`[SOCKET][Cashier] new_order received | data=${JSON.stringify(data)}`);
        if (!mountedRef.current) return;
        Vibration.vibrate([0, 200, 100, 200]);
        Notifications.scheduleNotificationAsync({
          content: {
            title: '🆕 New Order!',
            body: `Order ${data.orderNumber || ''} placed`,
            data: { type: 'cashier_new' },
          },
          trigger: { channelId: 'order_alerts_v2' },
        }).catch(() => {});
        setNewOrderCount(c => c + 1);
        loadOrders();
      });

      socket.on('order_completed',    () => { if (mountedRef.current) loadOrders(); });
      socket.on('order_served',       (data: any) => {
        console.log(`[SOCKET][Cashier] order_served received | data=${JSON.stringify(data)}`);
        if (!mountedRef.current) return;
        incCashierBadge();
        loadOrders();
      });
      socket.on('order_status_update',(data: any) => {
        console.log(`[SOCKET][Cashier] order_status_update received | status=${data?.status}`);
        if (mountedRef.current) loadOrders();
      });
    })();

    return () => {
      mountedRef.current = false;
      if (socketRef.current) {
        socketRef.current.off();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [loadOrders]);

  const handleCollectPayment = async () => {
    if (!payModal) return;
    setCompleting(true);
    try {
      await completeOrderPayment(payModal.order._id, selectedMethod);
      const paid = { ...payModal.order, status: 'completed' as const, paymentMethod: selectedMethod };
      setOrders(prev => prev.map(o => o._id === paid._id ? paid : o));
      setPayModal(null);
      if (settings) {
        Alert.alert(
          'Payment Collected ✓',
          `₹${paid.grandTotal.toFixed(0)} via ${selectedMethod.toUpperCase()}`,
          [
            { text: 'Print Receipt', onPress: () => printReceipt(paid as unknown as Order, settings) },
            { text: 'Done', style: 'cancel' },
          ]
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to collect payment');
    } finally {
      setCompleting(false);
    }
  };

  const handleLogout = async () => {
    await clearCashierToken();
    await AsyncStorage.removeItem(CASHIER_PROFILE_KEY);
    navigation.replace('RoleSelect');
  };

  const statusColor = (status: string) => {
    if (status === 'pending')   return Colors.warning;
    if (status === 'preparing') return Colors.info;
    if (status === 'ready')     return Colors.success;
    if (status === 'served')    return Colors.accent;
    return Colors.textMuted;
  };

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: 'Pending', preparing: 'Preparing',
      ready: 'Ready', served: 'Served', completed: 'Completed',
    };
    return map[status] || status;
  };

  const renderActiveOrder = ({ item }: { item: CashierOrder }) => {
    void tick;
    const token = item.orderNumber.split('-').pop() || '?';
    return (
      <View style={styles.card}>
        {/* Order type banner */}
        <View style={[styles.orderTypeBanner, item.isParcel ? styles.orderTypeBannerTakeaway : styles.orderTypeBannerDineIn]}>
          <MaterialIcons name={item.isParcel ? 'shopping-bag' : 'restaurant'} size={14} color={item.isParcel ? Colors.warning : Colors.primary} />
          <Text style={[styles.orderTypeBannerText, { color: item.isParcel ? Colors.warning : Colors.primary }]}>
            {item.isParcel ? '🛍 TAKEAWAY' : '🍽 DINE IN'}
          </Text>
        </View>
        <View style={styles.cardHeader}>
          <View style={styles.tokenBadge}>
            <Text style={styles.tokenText}>#{token}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            {item.tableNumber ? <Text style={styles.tableText}>Table {item.tableNumber}</Text> : null}
            {item.customerName ? <Text style={styles.customerText} numberOfLines={1}>{item.customerName}</Text> : null}
            <View style={[styles.statusPill, { backgroundColor: statusColor(item.status) + '22' }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} />
              <Text style={[styles.statusLabel, { color: statusColor(item.status) }]}>{statusLabel(item.status)}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.timeText, { color: timerColor(item.createdAt) }]}>{elapsed(item.createdAt)}</Text>
            <Text style={styles.totalText}>₹{item.grandTotal.toFixed(0)}</Text>
          </View>
        </View>

        <View style={styles.items}>
          {item.items.map((it, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemQty}>{it.quantity}×</Text>
              <Text style={styles.itemName} numberOfLines={1}>{it.productName}</Text>
              <Text style={styles.itemPrice}>₹{it.total.toFixed(0)}</Text>
            </View>
          ))}
        </View>

        {!!item.notes && (
          <View style={styles.notesRow}>
            <MaterialIcons name="notes" size={14} color={Colors.warning} />
            <Text style={styles.notesText} numberOfLines={2}>{item.notes}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.payBtn}
          onPress={() => { setSelectedMethod('cash'); setPayModal({ order: item }); }}
          activeOpacity={0.85}
        >
          <MaterialIcons name="point-of-sale" size={18} color={Colors.white} />
          <Text style={styles.payBtnText}>Collect Payment · ₹{item.grandTotal.toFixed(0)}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderCompletedOrder = ({ item }: { item: CashierOrder }) => {
    const token = item.orderNumber.split('-').pop() || '?';
    const pmColors: Record<string, string> = { cash: Colors.success, upi: Colors.info, card: Colors.accent };
    const pmColor = pmColors[item.paymentMethod] || Colors.textMuted;
    return (
      <View style={[styles.card, { opacity: 0.88 }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.tokenBadge, { backgroundColor: Colors.background }]}>
            <Text style={[styles.tokenText, { color: Colors.textSecondary }]}>#{token}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            {item.tableNumber ? <Text style={styles.tableText}>Table {item.tableNumber}</Text> : null}
            {item.customerName ? <Text style={styles.customerText} numberOfLines={1}>{item.customerName}</Text> : null}
            {item.completedBy ? <Text style={[styles.customerText, { fontSize: FontSize.xs }]}>By {item.completedBy}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[styles.methodBadge, { backgroundColor: pmColor + '22' }]}>
              <Text style={[styles.methodBadgeText, { color: pmColor }]}>{item.paymentMethod.toUpperCase()}</Text>
            </View>
            <Text style={styles.totalText}>₹{item.grandTotal.toFixed(0)}</Text>
          </View>
        </View>

        {settings && (
          <TouchableOpacity
            style={styles.reprintBtn}
            onPress={() => printReceipt(item as unknown as Order, settings)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="print" size={16} color={Colors.info} />
            <Text style={styles.reprintBtnText}>Reprint Receipt</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingTop: top }]}>
        <ActivityIndicator size="large" color={Colors.info} />
        <Text style={{ marginTop: 16, color: Colors.textSecondary, fontSize: FontSize.md }}>Loading orders…</Text>
      </View>
    );
  }

  const listData = tab === 'active' ? activeOrders : completedOrders;

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ position: 'relative' }}>
            <Text style={{ fontSize: 22 }}>💰</Text>
            {cashierBadge > 0 && (
              <View style={{ position: 'absolute', top: -6, right: -8 }}>
                <UnreadBadge count={cashierBadge} />
              </View>
            )}
          </View>
          <View>
            <Text style={styles.headerTitle}>Cashier Screen</Text>
            <Text style={styles.headerSub}>
              {cashierName ? `${cashierName} · ` : ''}{activeOrders.length} active
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={loadOrders}>
            <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={handleLogout}>
            <MaterialIcons name="logout" size={20} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.info }]}>{activeOrders.length}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={[styles.statCard, { borderLeftWidth: 1, borderLeftColor: Colors.border }]}>
          <Text style={[styles.statValue, { color: Colors.success }]}>₹{todayRevenue.toFixed(0)}</Text>
          <Text style={styles.statLabel}>Collected Today</Text>
        </View>
        <View style={[styles.statCard, { borderLeftWidth: 1, borderLeftColor: Colors.border }]}>
          <Text style={[styles.statValue, { color: Colors.textSecondary }]}>{completedOrders.length}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(['active', 'completed'] as const).map(t => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'active' ? `Active${activeOrders.length > 0 ? ` (${activeOrders.length})` : ''}` : `Completed${completedOrders.length > 0 ? ` (${completedOrders.length})` : ''}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={listData}
        keyExtractor={item => item._id}
        renderItem={tab === 'active' ? renderActiveOrder : renderCompletedOrder}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: bottom + 32 }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={{ fontSize: 40 }}>{tab === 'active' ? '✅' : '📋'}</Text>
            <Text style={styles.emptyText}>
              {tab === 'active' ? 'No active orders' : 'No completed orders today'}
            </Text>
          </View>
        }
      />

      <Modal visible={!!payModal} transparent animationType="slide" onRequestClose={() => setPayModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottom + Spacing.xl }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Collect Payment</Text>

            {payModal && (
              <>
                <View style={styles.modalOrderInfo}>
                  <Text style={styles.modalOrderNum}>{payModal.order.orderNumber}</Text>
                  {payModal.order.tableNumber ? <Text style={styles.modalOrderSub}>Table {payModal.order.tableNumber}</Text> : null}
                  {payModal.order.customerName ? <Text style={styles.modalOrderSub}>{payModal.order.customerName}</Text> : null}
                </View>

                <Text style={styles.modalTotal}>₹{payModal.order.grandTotal.toFixed(0)}</Text>

                <Text style={styles.modalMethodLabel}>Payment Method</Text>
                <View style={styles.methodRow}>
                  {(['cash', 'upi', 'card'] as PaymentMethod[]).map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.methodBtn, selectedMethod === m && styles.methodBtnActive]}
                      onPress={() => setSelectedMethod(m)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.methodBtnIcon}>{m === 'cash' ? '💵' : m === 'upi' ? '📱' : '💳'}</Text>
                      <Text style={[styles.methodBtnText, selectedMethod === m && styles.methodBtnTextActive]}>
                        {m.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.confirmBtn, completing && styles.confirmBtnDisabled]}
                  onPress={handleCollectPayment}
                  disabled={completing}
                  activeOpacity={0.88}
                >
                  {completing
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <>
                        <MaterialIcons name="check-circle" size={20} color={Colors.white} />
                        <Text style={styles.confirmBtnText}>Confirm Payment</Text>
                      </>
                  }
                </TouchableOpacity>

                <TouchableOpacity style={styles.cancelBtn} onPress={() => setPayModal(null)}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── New Order Popup (floats over screen) ── */}
      <Modal
        visible={newOrderCount > 0}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setNewOrderCount(0)}
      >
        <TouchableOpacity
          style={{ marginTop: top + 8, marginHorizontal: 16 }}
          onPress={() => setNewOrderCount(0)}
          activeOpacity={1}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.success, borderRadius: 14, padding: 16, gap: 12, overflow: 'hidden' }}>
            <MaterialIcons name="notifications-active" size={24} color={Colors.white} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: Colors.white, fontWeight: '700', fontSize: 16 }}>
                {newOrderCount > 1 ? `${newOrderCount} New Orders!` : 'New Order!'}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 2 }}>New order has been placed</Text>
            </View>
            {newOrderCount > 1 && (
              <View style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, minWidth: 26, height: 26, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 }}>
                <Text style={{ color: Colors.white, fontWeight: '800', fontSize: 13 }}>{newOrderCount}</Text>
              </View>
            )}
            <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.8)" />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  headerSub:   { fontSize: FontSize.sm, color: Colors.textSecondary },
  headerRight: { flexDirection: 'row', gap: Spacing.sm },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  statsRow: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  statCard:  { flex: 1, alignItems: 'center', paddingVertical: Spacing.md },
  statValue: { fontSize: FontSize.xxl, fontWeight: '900' },
  statLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  tabs: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab:           { flex: 1, alignItems: 'center', paddingVertical: Spacing.md },
  tabActive:     { borderBottomWidth: 2.5, borderBottomColor: Colors.info },
  tabText:       { fontSize: FontSize.md, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.info },
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md, ...Shadows.sm,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  orderTypeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: -Spacing.lg, marginTop: -Spacing.lg,
    paddingHorizontal: Spacing.lg, paddingVertical: 6, marginBottom: Spacing.md,
  },
  orderTypeBannerDineIn:   { backgroundColor: Colors.primaryBg },
  orderTypeBannerTakeaway: { backgroundColor: Colors.warningBg },
  orderTypeBannerText: { fontSize: FontSize.sm, fontWeight: '800', letterSpacing: 0.3 },
  cardHeader:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  tokenBadge: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: Colors.infoBg, alignItems: 'center', justifyContent: 'center',
  },
  tokenText:   { fontSize: FontSize.sm, fontWeight: '800', color: Colors.info },
  tableText:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  customerText:{ fontSize: FontSize.sm, color: Colors.textSecondary },
  timeText:    { fontSize: FontSize.sm, fontWeight: '700', textAlign: 'right' },
  totalText:   { fontSize: FontSize.lg, fontWeight: '900', color: Colors.text, textAlign: 'right' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 100, alignSelf: 'flex-start', marginTop: 4,
  },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },
  statusLabel:{ fontSize: FontSize.xs, fontWeight: '700' },
  items:      { gap: 4, marginBottom: Spacing.sm },
  itemRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemQty:    { fontSize: FontSize.sm, fontWeight: '800', color: Colors.info, width: 28 },
  itemName:   { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  itemPrice:  { fontSize: FontSize.sm, color: Colors.textSecondary },
  notesRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: 8, padding: 8,
  },
  notesText: { flex: 1, fontSize: FontSize.sm, color: Colors.warning },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.info, borderRadius: BorderRadius.lg, paddingVertical: 12, marginTop: Spacing.sm,
  },
  payBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },
  reprintBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    borderWidth: 1.5, borderColor: Colors.info, borderRadius: BorderRadius.lg,
    paddingVertical: 8, marginTop: Spacing.sm,
  },
  reprintBtnText: { color: Colors.info, fontSize: FontSize.sm, fontWeight: '700' },
  methodBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  methodBadgeText: { fontSize: FontSize.xs, fontWeight: '800' },
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  emptyText: { fontSize: FontSize.lg, color: Colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, ...Shadows.lg,
  },
  modalHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  modalTitle:   { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.md },
  modalOrderInfo: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.lg, padding: Spacing.md,
    marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  modalOrderNum: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  modalOrderSub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  modalTotal:    { fontSize: 40, fontWeight: '900', color: Colors.info, textAlign: 'center', marginBottom: Spacing.xl },
  modalMethodLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  methodRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.xl },
  methodBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.background, borderWidth: 1.5, borderColor: Colors.border,
  },
  methodBtnActive:    { borderColor: Colors.info, backgroundColor: Colors.infoBg },
  methodBtnIcon:      { fontSize: 24, marginBottom: 4 },
  methodBtnText:      { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  methodBtnTextActive:{ color: Colors.info },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.info, borderRadius: BorderRadius.xl, paddingVertical: 16, marginBottom: Spacing.md,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  cancelBtn:     { alignItems: 'center', paddingVertical: Spacing.md },
  cancelBtnText: { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: '600' },
});

export default CashierDashboardScreen;
