import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, StatusBar, Vibration, ScrollView, Modal, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  getKitchenOrders, updateKitchenOrderStatus, clearKitchenToken,
  getKitchenToken, getStoredHotelId, getSocketUrl,
  KitchenOrder,
} from '../services/api';
import { setupNotifications, notifyNewKitchenOrder } from '../utils/notifications';
import { useBadgeCount, BADGE_KEYS } from '../hooks/useBadgeCount';
import UnreadBadge from '../components/UnreadBadge';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'KitchenDisplay'>;

const KitchenDisplayScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [socketLost, setSocketLost] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const mountedRef = useRef(true);
  const { count: kitchenBadge, increment: incKitchenBadge, reset: resetKitchenBadge } = useBadgeCount(BADGE_KEYS.kitchenOrders);
  const seenOrderIds = useRef<Set<string>>(new Set());

  // Counter instead of boolean — ensures every new order triggers a re-render
  // even if the popup is already visible (boolean setTrue on true = no re-render)
  const [newOrderCount, setNewOrderCount] = useState(0);

  const pending   = orders.filter(o => o.status === 'pending');
  const preparing = orders.filter(o => o.status === 'preparing');

  // ── Load active orders ──────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    try {
      const data = await getKitchenOrders();
      if (mountedRef.current) setOrders(data);
      return true;
    } catch {
      return false;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const ok = await loadOrders();
      if (ok && active) resetKitchenBadge();
    })();
    return () => { active = false; };
  }, [loadOrders, resetKitchenBadge]));

  // Auto-dismiss popup after 5 seconds
  useEffect(() => {
    if (!newOrderCount) return;
    const t = setTimeout(() => setNewOrderCount(0), 5000);
    return () => clearTimeout(t);
  }, [newOrderCount]);

  // ── Socket: real-time new orders + status changes ───────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    // Per-effect cancellation flag — guards against fast unmount/remount races
    // where mountedRef.current is reset to true by the new effect before the
    // old async IIFE checks it, which would create a duplicate socket.
    let cancelled = false;
    setupNotifications();
    loadOrders();

    let socket: Socket;
    (async () => {
      const [hotelId, url, token] = await Promise.all([
        getStoredHotelId(), getSocketUrl(), getKitchenToken(),
      ]);
      console.log(`[SOCKET][Kitchen] hotelId=${hotelId} | url=${url} | hasToken=${!!token}`);
      if (cancelled || !hotelId) {
        console.log('[SOCKET][Kitchen] ABORT — cancelled or hotelId missing');
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
        console.log(`[SOCKET][Kitchen] Connected | socketId=${socket.id}`);
        socket.emit('join_hotel', hotelId);
        console.log(`[SOCKET][Kitchen] join_hotel emitted | hotelId=${hotelId}`);
        loadOrders();
      });

      socket.on('connect_error', (err) => {
        console.log(`[SOCKET][Kitchen] connect_error: ${err.message}`);
        if (!mountedRef.current) return;
        if (err.message?.includes('authentication')) {
          clearKitchenToken().then(() => {
            if (mountedRef.current) navigation.replace('RoleSelect');
          });
        }
      });

      socket.on('disconnect', (reason) => {
        console.log(`[SOCKET][Kitchen] Disconnected | reason=${reason}`);
      });

      socket.on('reconnect_failed', () => {
        console.log('[SOCKET][Kitchen] reconnect_failed — showing connection lost overlay');
        if (mountedRef.current) setSocketLost(true);
      });

      // New order arrives — dedup, vibrate, play sound, reload
      socket.on('new_order', (data: { orderId?: string; _id?: string }) => {
        console.log(`[SOCKET][Kitchen] new_order received | data=${JSON.stringify(data)}`);
        if (!mountedRef.current) return;
        const id = data.orderId || data._id || '';
        if (id && seenOrderIds.current.has(id)) return; // dedup
        if (id) seenOrderIds.current.add(id);
        incKitchenBadge();
        Vibration.vibrate([0, 300, 150, 300, 150, 500]);
        notifyNewKitchenOrder();
        setNewOrderCount(c => c + 1);
        loadOrders();
      });

      // Status updated by admin or another KDS instance
      socket.on('order_status_update', (data: { orderId: string; status: string }) => {
        if (!mountedRef.current) return;
        if (data.status === 'ready' || data.status === 'served' ||
            data.status === 'completed' || data.status === 'cancelled') {
          setOrders(prev => prev.filter(o => o._id !== data.orderId));
        } else {
          setOrders(prev => prev.map(o =>
            o._id === data.orderId ? { ...o, status: data.status as KitchenOrder['status'] } : o
          ));
        }
      });
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (socketRef.current) {
        socketRef.current.off();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [loadOrders]);

  // ── Update order status ─────────────────────────────────────────────────────
  const handleStatus = async (order: KitchenOrder, newStatus: string) => {
    setUpdatingId(order._id);
    try {
      await updateKitchenOrderStatus(order._id, newStatus);
      if (newStatus === 'ready') {
        setOrders(prev => prev.filter(o => o._id !== order._id));
      } else {
        setOrders(prev => prev.map(o =>
          o._id === order._id ? { ...o, status: newStatus as KitchenOrder['status'] } : o
        ));
      }
    } catch (e: any) {
      Alert.alert('Update Failed', e?.message || 'Could not update order status. Please try again.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleLogout = async () => {
    await clearKitchenToken();
    navigation.replace('RoleSelect');
  };

  // ── Elapsed time label ──────────────────────────────────────────────────────
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000); // every second for live timer
    return () => clearInterval(interval);
  }, []);

  const elapsed = (createdAt: string): { label: string; mins: number } => {
    const totalSecs = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return {
      label: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
      mins,
    };
  };

  const timerColor = (mins: number) => {
    if (mins < 5)  return Colors.success;
    if (mins < 10) return Colors.warning;
    return Colors.danger;
  };

  // ── Order card ──────────────────────────────────────────────────────────────
  const renderCard = (order: KitchenOrder) => {
    void tick; // trigger re-render every second
    const isPending = order.status === 'pending';
    const isUpdating = updatingId === order._id;
    const token = order.orderNumber.split('-').pop() || '?';
    const { label: elapsedLabel, mins: elapsedMins } = elapsed(order.createdAt);
    const color = timerColor(elapsedMins);
    const urgent = elapsedMins >= 10;

    return (
      <View key={order._id} style={[styles.card, isPending ? styles.cardPending : styles.cardPreparing, urgent && styles.cardUrgent]}>
        {/* Card header */}
        <View style={styles.cardHeader}>
          <View style={[styles.tokenBadge, isPending ? styles.tokenBadgePending : styles.tokenBadgePreparing]}>
            <Text style={styles.tokenText}>#{token}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            {order.tableNumber ? <Text style={styles.tableLabel}>Table {order.tableNumber}</Text> : null}
            {order.customerName ? <Text style={styles.customerLabel} numberOfLines={1}>{order.customerName}</Text> : null}
          </View>
          <View style={[styles.timeBadge, urgent && styles.timeBadgeUrgent]}>
            <MaterialIcons name="schedule" size={12} color={color} />
            <Text style={[styles.timeText, { color }]}>{elapsedLabel}</Text>
          </View>
        </View>

        {/* Order type pill */}
        <View style={[styles.orderTypePill, order.isParcel ? styles.orderTypePillTakeaway : styles.orderTypePillDineIn]}>
          <MaterialIcons name={order.isParcel ? 'shopping-bag' : 'restaurant'} size={12} color={order.isParcel ? Colors.warning : Colors.primary} />
          <Text style={[styles.orderTypePillText, { color: order.isParcel ? Colors.warning : Colors.primary }]}>
            {order.isParcel ? 'TAKEAWAY' : 'DINE IN'}
          </Text>
        </View>

        {/* Items */}
        <View style={styles.itemsWrap}>
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

        {/* Action button */}
        <TouchableOpacity
          style={[styles.actionBtn, isPending ? styles.actionBtnStart : styles.actionBtnReady, isUpdating && styles.actionBtnDisabled]}
          onPress={() => handleStatus(order, isPending ? 'preparing' : 'ready')}
          disabled={isUpdating}
          activeOpacity={0.8}
        >
          {isUpdating
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <>
                <MaterialIcons
                  name={isPending ? 'local-fire-department' : 'check-circle'}
                  size={18}
                  color={Colors.white}
                />
                <Text style={styles.actionBtnText}>
                  {isPending ? 'Start Cooking' : 'Mark Ready'}
                </Text>
              </>
          }
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingTop: top }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ marginTop: 16, color: Colors.textSecondary, fontSize: FontSize.md }}>Loading orders…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ position: 'relative' }}>
            <Text style={{ fontSize: 22 }}>👨‍🍳</Text>
            {kitchenBadge > 0 && (
              <View style={{ position: 'absolute', top: -6, right: -8 }}>
                <UnreadBadge count={kitchenBadge} />
              </View>
            )}
          </View>
          <View>
            <Text style={styles.headerTitle}>Kitchen Display</Text>
            <Text style={styles.headerSub}>
              {pending.length} pending · {preparing.length} in kitchen
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.refreshBtn} onPress={loadOrders}>
            <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <MaterialIcons name="logout" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {orders.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={{ fontSize: 64, marginBottom: Spacing.lg }}>✅</Text>
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptySubtitle}>No pending or in-progress orders</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.columns, { paddingBottom: bottom + 20 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* PENDING column */}
          <View style={styles.column}>
            <View style={styles.colHeader}>
              <View style={[styles.colDot, { backgroundColor: Colors.warning }]} />
              <Text style={styles.colTitle}>PENDING</Text>
              <View style={styles.colBadge}>
                <Text style={styles.colBadgeText}>{pending.length}</Text>
              </View>
            </View>
            {pending.length === 0
              ? <Text style={styles.colEmpty}>No pending orders</Text>
              : pending.map(renderCard)
            }
          </View>

          {/* IN KITCHEN column */}
          <View style={styles.column}>
            <View style={styles.colHeader}>
              <View style={[styles.colDot, { backgroundColor: Colors.info }]} />
              <Text style={styles.colTitle}>IN KITCHEN</Text>
              <View style={[styles.colBadge, { backgroundColor: Colors.infoBg }]}>
                <Text style={[styles.colBadgeText, { color: Colors.info }]}>{preparing.length}</Text>
              </View>
            </View>
            {preparing.length === 0
              ? <Text style={styles.colEmpty}>Nothing cooking yet</Text>
              : preparing.map(renderCard)
            }
          </View>
        </ScrollView>
      )}

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
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.warning, borderRadius: 14, padding: 16, gap: 12, overflow: 'hidden' }}>
            <MaterialIcons name="restaurant" size={24} color={Colors.white} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: Colors.white, fontWeight: '700', fontSize: 16 }}>
                {newOrderCount > 1 ? `${newOrderCount} New Orders!` : 'New Order in Kitchen!'}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 2 }}>Tap to dismiss</Text>
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

      {/* Connection lost overlay — shown after socket.io exhausts reconnection attempts */}
      {socketLost && (
        <View style={styles.connectionLostOverlay}>
          <MaterialIcons name="wifi-off" size={52} color={Colors.danger} />
          <Text style={styles.connectionLostTitle}>Connection Lost</Text>
          <Text style={styles.connectionLostText}>Could not reconnect to server. Check your internet connection.</Text>
          <TouchableOpacity
            style={styles.connectionLostBtn}
            onPress={() => { setSocketLost(false); socketRef.current?.connect(); }}
          >
            <MaterialIcons name="refresh" size={18} color={Colors.white} />
            <Text style={styles.connectionLostBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1.5, borderBottomColor: Colors.border, ...Shadows.sm,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text },
  headerSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  logoutBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // Columns
  columns: { flexDirection: 'row', padding: Spacing.md, gap: Spacing.md, alignItems: 'flex-start' },
  column: { flex: 1 },
  colHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginBottom: Spacing.md, paddingHorizontal: Spacing.sm,
  },
  colDot: { width: 8, height: 8, borderRadius: 4 },
  colTitle: { flex: 1, fontSize: FontSize.xs, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 1 },
  colBadge: {
    backgroundColor: Colors.warningBg, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  colBadgeText: { fontSize: FontSize.xs, fontWeight: '800', color: Colors.warning },
  colEmpty: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing.xl, fontStyle: 'italic' },

  // Order card
  card: {
    borderRadius: BorderRadius.xl, padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1.5, ...Shadows.sm,
  },
  cardPending: {
    backgroundColor: Colors.surface,
    borderColor: Colors.warning + '50',
    borderLeftWidth: 4, borderLeftColor: Colors.warning,
  },
  cardPreparing: {
    backgroundColor: Colors.surface,
    borderColor: Colors.info + '50',
    borderLeftWidth: 4, borderLeftColor: Colors.info,
  },
  cardUrgent: { borderTopWidth: 2, borderTopColor: Colors.danger },

  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  tokenBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  tokenBadgePending:  { backgroundColor: Colors.warningBg },
  tokenBadgePreparing: { backgroundColor: Colors.infoBg },
  tokenText: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.text },
  tableLabel: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  customerLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  timeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: Colors.background },
  timeBadgeUrgent: { backgroundColor: Colors.dangerBg },
  timeText: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  timeTextUrgent: { color: Colors.danger },

  orderTypePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, marginBottom: Spacing.sm, borderWidth: 1,
  },
  orderTypePillDineIn:    { backgroundColor: Colors.primaryBg, borderColor: Colors.primary + '40' },
  orderTypePillTakeaway:  { backgroundColor: Colors.warningBg, borderColor: Colors.warning + '40' },
  orderTypePillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  itemsWrap: { marginBottom: Spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, paddingVertical: 3 },
  itemQty: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.primary, minWidth: 28, textAlign: 'right' },
  itemName: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  notesRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.md,
    padding: Spacing.sm, marginBottom: Spacing.sm,
  },
  notesText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontStyle: 'italic' },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    borderRadius: BorderRadius.lg, paddingVertical: 11, marginTop: Spacing.sm,
  },
  actionBtnStart: { backgroundColor: Colors.warning },
  actionBtnReady: { backgroundColor: Colors.success },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Empty state
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.sm },
  emptySubtitle: { fontSize: FontSize.md, color: Colors.textMuted, textAlign: 'center' },

  // Connection lost overlay
  connectionLostOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl,
  },
  connectionLostTitle: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.white, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  connectionLostText: { fontSize: FontSize.md, color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginBottom: Spacing.xl },
  connectionLostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
    paddingVertical: 12, paddingHorizontal: 28,
  },
  connectionLostBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },
});

export default KitchenDisplayScreen;
