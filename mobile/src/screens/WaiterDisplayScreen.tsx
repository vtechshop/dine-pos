import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  ActivityIndicator, StatusBar, Vibration, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootStackParamList } from '../types';
import {
  getWaiterOrders, markOrderServed, clearWaiterToken,
  getWaiterToken, getStoredHotelId, getSocketUrl, WaiterOrder,
} from '../services/api';
import { WAITER_PROFILE_KEY } from './WaiterLoginScreen';
import { setupNotifications } from '../utils/notifications';
import { useBadgeCount, BADGE_KEYS } from '../hooks/useBadgeCount';
import UnreadBadge from '../components/UnreadBadge';
import * as Notifications from 'expo-notifications';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'WaiterDisplay'>;

const WaiterDisplayScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();
  const [orders, setOrders] = useState<WaiterOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [servingId, setServingId] = useState<string | null>(null);
  const [waiterName, setWaiterName] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const mountedRef = useRef(true);
  const seenReadyIds = useRef<Set<string>>(new Set());
  const { count: waiterBadge, increment: incWaiterBadge, reset: resetWaiterBadge } = useBadgeCount(BADGE_KEYS.waiterReady);

  useFocusEffect(useCallback(() => { resetWaiterBadge(); }, [resetWaiterBadge]));

  const [readyPopup, setReadyPopup] = useState<{ orderNumber: string; tableNumber: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = (createdAt: string) => {
    const secs = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const loadOrders = useCallback(async () => {
    try {
      const data = await getWaiterOrders();
      if (mountedRef.current) setOrders(data);
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setupNotifications();
    loadOrders();

    AsyncStorage.getItem(WAITER_PROFILE_KEY).then(raw => {
      if (raw) {
        const p = JSON.parse(raw);
        if (mountedRef.current) setWaiterName(p.name || '');
      }
    });

    let socket: Socket;
    (async () => {
      const [hotelId, url, token] = await Promise.all([
        getStoredHotelId(), getSocketUrl(), getWaiterToken(),
      ]);
      console.log(`[SOCKET][Waiter] hotelId=${hotelId} | url=${url} | hasToken=${!!token}`);
      if (!hotelId || !mountedRef.current) {
        console.log('[SOCKET][Waiter] ABORT — hotelId missing, socket will not connect');
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
        console.log(`[SOCKET][Waiter] Connected | socketId=${socket.id}`);
        socket.emit('join_hotel', hotelId);
        console.log(`[SOCKET][Waiter] join_hotel emitted | hotelId=${hotelId}`);
      });

      socket.on('connect_error', (err) => {
        console.log(`[SOCKET][Waiter] connect_error: ${err.message}`);
        if (!mountedRef.current) return;
        if (err.message?.includes('authentication')) {
          clearWaiterToken().then(() => {
            if (mountedRef.current) navigation.replace('RoleSelect');
          });
        }
      });

      socket.on('disconnect', (reason) => {
        console.log(`[SOCKET][Waiter] Disconnected | reason=${reason}`);
      });

      socket.on('waiter_order_ready', (data: { orderId?: string; _id?: string; orderNumber: string; tableNumber: string }) => {
        console.log(`[SOCKET][Waiter] waiter_order_ready received | data=${JSON.stringify(data)}`);
        if (!mountedRef.current) return;
        const id = data.orderId || data._id || '';
        if (id && seenReadyIds.current.has(id)) return;
        if (id) seenReadyIds.current.add(id);
        incWaiterBadge();
        Vibration.vibrate([0, 300, 150, 300, 150, 500]);
        Notifications.scheduleNotificationAsync({
          content: {
            title: '🛎️ Order Ready!',
            body: `Table ${data.tableNumber || '—'} · ${data.orderNumber}`,
            data: { type: 'waiter_ready' },
          },
          trigger: { channelId: 'order_alerts_v2' },
        }).catch(() => {});
        setReadyPopup({ orderNumber: data.orderNumber, tableNumber: data.tableNumber || '' });
        loadOrders();
      });

      // If order is served by another device or admin marks it, remove from list
      socket.on('order_served', (data: { orderId: string }) => {
        console.log(`[SOCKET][Waiter] order_served received | orderId=${data?.orderId}`);
        if (!mountedRef.current) return;
        setOrders(prev => prev.filter(o => o._id !== data.orderId));
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

  const handleServe = async (order: WaiterOrder) => {
    setServingId(order._id);
    try {
      await markOrderServed(order._id);
      setOrders(prev => prev.filter(o => o._id !== order._id));
    } catch {
      // silent — socket will sync
    } finally {
      setServingId(null);
    }
  };

  const handleLogout = async () => {
    await clearWaiterToken();
    await AsyncStorage.removeItem(WAITER_PROFILE_KEY);
    navigation.replace('RoleSelect');
  };

  const renderOrder = ({ item }: { item: WaiterOrder }) => {
    void tick;
    const isServing = servingId === item._id;
    const token = item.orderNumber.split('-').pop() || '?';
    const time = elapsed(item.createdAt);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.tokenBadge}>
            <Text style={styles.tokenText}>#{token}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            {item.tableNumber ? <Text style={styles.tableText}>Table {item.tableNumber}</Text> : null}
            {item.customerName ? <Text style={styles.customerText} numberOfLines={1}>{item.customerName}</Text> : null}
          </View>
          <View style={styles.timeBadge}>
            <MaterialIcons name="schedule" size={12} color={Colors.success} />
            <Text style={styles.timeText}>{time}</Text>
          </View>
        </View>

        {/* Items */}
        <View style={styles.items}>
          {item.items.map((it, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemQty}>{it.quantity}×</Text>
              <Text style={styles.itemName} numberOfLines={1}>{it.productName}</Text>
            </View>
          ))}
        </View>

        {item.notes ? (
          <View style={styles.notesRow}>
            <MaterialIcons name="notes" size={14} color={Colors.warning} />
            <Text style={styles.notesText} numberOfLines={2}>{item.notes}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.serveBtn, isServing && styles.serveBtnDisabled]}
          onPress={() => handleServe(item)}
          disabled={!!isServing}
          activeOpacity={0.85}
        >
          {isServing
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <>
                <MaterialIcons name="room-service" size={18} color={Colors.white} />
                <Text style={styles.serveBtnText}>Mark Served</Text>
              </>
          }
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingTop: top }]}>
        <ActivityIndicator size="large" color={Colors.accent} />
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
            <Text style={{ fontSize: 22 }}>🛎️</Text>
            {waiterBadge > 0 && (
              <View style={{ position: 'absolute', top: -6, right: -8 }}>
                <UnreadBadge count={waiterBadge} />
              </View>
            )}
          </View>
          <View>
            <Text style={styles.headerTitle}>Waiter Screen</Text>
            <Text style={styles.headerSub}>
              {waiterName ? `${waiterName} · ` : ''}{orders.length} order{orders.length !== 1 ? 's' : ''} ready
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={loadOrders}>
            <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={handleLogout}>
            <MaterialIcons name="logout" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {orders.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={{ fontSize: 64, marginBottom: Spacing.lg }}>✅</Text>
          <Text style={styles.emptyTitle}>Nothing to serve</Text>
          <Text style={styles.emptySubtitle}>Orders marked Ready will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o._id}
          renderItem={renderOrder}
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: bottom + 20 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Order Ready Popup (floats over screen) ── */}
      <Modal
        visible={!!readyPopup}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setReadyPopup(null)}
      >
        <TouchableOpacity
          style={{ marginTop: (StatusBar.currentHeight || 0) + 8, marginHorizontal: 16 }}
          onPress={() => setReadyPopup(null)}
          activeOpacity={1}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.success, borderRadius: 14, padding: 16, gap: 12, overflow: 'hidden' }}>
            <MaterialIcons name="room-service" size={24} color={Colors.white} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: Colors.white, fontWeight: '700', fontSize: 16 }}>
                Order Ready — {readyPopup?.orderNumber}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 2 }}>
                {readyPopup?.tableNumber ? `Table ${readyPopup.tableNumber} · Ready to serve` : 'Ready to serve'}
              </Text>
            </View>
            <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.8)" />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1.5, borderBottomColor: Colors.border, ...Shadows.sm,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text },
  headerSub:   { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.success + '50',
    borderLeftWidth: 4, borderLeftColor: Colors.success, ...Shadows.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  tokenBadge: {
    backgroundColor: Colors.successBg ?? '#E6F9EE', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 6, minWidth: 48, alignItems: 'center',
  },
  tokenText:   { fontSize: FontSize.lg, fontWeight: '900', color: Colors.success },
  tableText:   { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  customerText:{ fontSize: FontSize.sm, color: Colors.textSecondary },
  timeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.successBg ?? '#E6F9EE',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  timeText: { fontSize: 11, color: Colors.success, fontWeight: '700' },

  items:   { marginBottom: Spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, paddingVertical: 3 },
  itemQty: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.accent, minWidth: 28, textAlign: 'right' },
  itemName:{ flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  notesRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.md,
    padding: Spacing.sm, marginBottom: Spacing.sm,
  },
  notesText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontStyle: 'italic' },

  serveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.success, borderRadius: BorderRadius.lg,
    paddingVertical: 11, marginTop: Spacing.sm,
  },
  serveBtnDisabled: { opacity: 0.6 },
  serveBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  emptyTitle:    { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.sm },
  emptySubtitle: { fontSize: FontSize.md, color: Colors.textMuted, textAlign: 'center' },
});

export default WaiterDisplayScreen;
