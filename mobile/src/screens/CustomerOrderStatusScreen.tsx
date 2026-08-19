import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, StatusBar, RefreshControl, Animated, Easing,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSocketUrl, getStoredHotelId } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { RootStackParamList } from '../types';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';

export const CUSTOMER_ORDER_KEY = '@dine_customer_last_order';

export interface StoredCustomerOrder {
  _id: string;
  orderNumber: string;
  token: string;
  items: Array<{ name: string; quantity: number; total: number }>;
  grandTotal: number;
  tableNumber: string;
  hotelId: string;
  status: 'received' | 'preparing' | 'ready' | 'served';
  placedAt: string;
}

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const STATUS_STEPS: Array<{
  key: StoredCustomerOrder['status'];
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  activeColor: string;
}> = [
  { key: 'received',  label: 'Received',  icon: 'receipt',              activeColor: Colors.info },
  { key: 'preparing', label: 'Preparing', icon: 'local-fire-department', activeColor: Colors.warning },
  { key: 'ready',     label: 'Ready!',    icon: 'check-circle',          activeColor: Colors.success },
  { key: 'served',    label: 'Served',    icon: 'room-service',          activeColor: Colors.success },
];

const STATUS_ORDER: Record<StoredCustomerOrder['status'], number> = {
  received: 0, preparing: 1, ready: 2, served: 3,
};

const CustomerOrderStatusScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const { settings } = useSettings();
  const { bottom } = useSafeAreaInsets();

  const [order, setOrder] = useState<StoredCustomerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const cur = settings.currencySymbol || '₹';

  // ── Pulse animation for "preparing" status ───────────────────────────────
  useEffect(() => {
    if (!order || order.status !== 'preparing') return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [order?.status]);

  // ── Load from AsyncStorage ────────────────────────────────────────────────
  const loadOrder = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(CUSTOMER_ORDER_KEY);
      if (!raw) { setOrder(null); return; }
      setOrder(JSON.parse(raw) as StoredCustomerOrder);
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ── Connect socket when order is loaded ───────────────────────────────────
  const connectSocket = useCallback(async (o: StoredCustomerOrder) => {
    if (socketRef.current) {
      socketRef.current.off();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (o.status === 'served') return;

    let hotelId = o.hotelId;
    if (!hotelId) hotelId = (await getStoredHotelId()) ?? '';
    if (!hotelId) return;

    const url = await getSocketUrl();
    const socket = io(url, { transports: ['websocket'], reconnectionAttempts: 5 });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join_hotel', hotelId));

    socket.on('order_status_update', async (data: { orderId: string; status: string }) => {
      if (data.orderId !== o._id) return;
      const s = data.status as StoredCustomerOrder['status'];
      if (!STATUS_ORDER[s] !== undefined) return;
      setOrder(prev => {
        if (!prev) return prev;
        const updated = { ...prev, status: s };
        AsyncStorage.setItem(CUSTOMER_ORDER_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    });

    socket.on('order_served', async (data: { orderId: string }) => {
      if (data.orderId !== o._id) return;
      setOrder(prev => {
        if (!prev) return prev;
        const updated = { ...prev, status: 'served' as const };
        AsyncStorage.setItem(CUSTOMER_ORDER_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });
      socket.off();
      socket.disconnect();
      socketRef.current = null;
    });
  }, []);

  useEffect(() => {
    if (order) connectSocket(order);
    return () => {
      if (socketRef.current) {
        socketRef.current.off();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [order?._id]);

  // ── Reload each time tab is focused ──────────────────────────────────────
  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadOrder();
  }, [loadOrder]));

  const handleDone = async () => {
    await AsyncStorage.removeItem(CUSTOMER_ORDER_KEY);
    setOrder(null);
    navigation.reset({ index: 0, routes: [{ name: 'CustomerTabs' }] });
  };

  const onRefresh = () => { setRefreshing(true); loadOrder(); };

  // ── Empty state ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: 0 }]}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.primary} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Order</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[styles.root, { paddingTop: 0 }]}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.primary} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Order</Text>
        </View>
        <View style={styles.centered}>
          <MaterialIcons name="receipt-long" size={64} color={Colors.border} />
          <Text style={styles.emptyTitle}>No active order</Text>
          <Text style={styles.emptyDesc}>Place an order from the menu and track it here in real time.</Text>
          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerTabs' }] })}
          >
            <MaterialIcons name="restaurant-menu" size={18} color={Colors.white} />
            <Text style={styles.menuBtnText}>Browse Menu</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const currentIdx = STATUS_ORDER[order.status] ?? 0;

  // ── Status headline ───────────────────────────────────────────────────────
  const statusMeta: Record<StoredCustomerOrder['status'], { icon: keyof typeof MaterialIcons.glyphMap; headline: string; sub: string; color: string }> = {
    received:  { icon: 'receipt',              headline: 'Order received!',    sub: 'The kitchen is about to start.',   color: Colors.info },
    preparing: { icon: 'local-fire-department', headline: 'Being prepared…',   sub: 'Your food is cooking.',            color: Colors.warning },
    ready:     { icon: 'check-circle',          headline: 'Ready to serve!',   sub: 'Your order is on its way.',        color: Colors.success },
    served:    { icon: 'room-service',          headline: 'Order served!',      sub: 'Enjoy your meal.',                 color: Colors.success },
  };
  const { icon: sIcon, headline, sub, color: sColor } = statusMeta[order.status];

  return (
    <View style={[styles.root, { paddingTop: 0 }]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primary} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Order</Text>
        <View style={styles.headerOrderNum}>
          <Text style={styles.headerOrderNumText}>{order.orderNumber}</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
      >
        {/* Status hero card */}
        <Animated.View style={[styles.heroCard, { transform: [{ scale: order.status === 'preparing' ? pulseAnim : 1 }] }]}>
          <View style={[styles.heroIconWrap, { backgroundColor: sColor + '18' }]}>
            <MaterialIcons name={sIcon} size={40} color={sColor} />
          </View>
          <Text style={[styles.heroHeadline, { color: sColor }]}>{headline}</Text>
          <Text style={styles.heroSub}>{sub}</Text>
        </Animated.View>

        {/* Status tracker */}
        <View style={styles.trackerCard}>
          {STATUS_STEPS.map((step, i) => {
            const active = currentIdx >= i;
            const isCurrent = currentIdx === i;
            return (
              <React.Fragment key={step.key}>
                {i > 0 && (
                  <View style={[styles.connector, active && { backgroundColor: step.activeColor }]} />
                )}
                <View style={styles.stepWrap}>
                  <View style={[
                    styles.stepDot,
                    active && { backgroundColor: step.activeColor, borderColor: step.activeColor },
                    isCurrent && styles.stepDotCurrent,
                  ]}>
                    <MaterialIcons
                      name={step.icon}
                      size={14}
                      color={active ? Colors.white : Colors.textMuted}
                    />
                  </View>
                  <Text style={[styles.stepLabel, active && { color: step.activeColor, fontWeight: '700' }]}>
                    {step.label}
                  </Text>
                </View>
              </React.Fragment>
            );
          })}
        </View>

        {/* Token + table */}
        <View style={styles.tokenRow}>
          <View style={[styles.tokenBox, { backgroundColor: Colors.primary }]}>
            <Text style={styles.tokenLabel}>TOKEN</Text>
            <Text style={styles.tokenNum}>#{order.token}</Text>
          </View>
          {order.tableNumber ? (
            <View style={[styles.tokenBox, { backgroundColor: Colors.info }]}>
              <Text style={styles.tokenLabel}>TABLE</Text>
              <Text style={styles.tokenNum}>{order.tableNumber}</Text>
            </View>
          ) : null}
        </View>

        {/* Order items */}
        <View style={styles.itemsCard}>
          <Text style={styles.itemsTitle}>Order Summary</Text>
          {order.items.map((item, i) => (
            <View key={i} style={[styles.itemRow, i < order.items.length - 1 && styles.itemRowBorder]}>
              <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.itemQty}>×{item.quantity}</Text>
              <Text style={styles.itemTotal}>{cur}{item.total.toFixed(0)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalVal}>{cur}{order.grandTotal.toFixed(0)}</Text>
          </View>
        </View>

        {/* Action */}
        {order.status === 'served' ? (
          <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
            <MaterialIcons name="restaurant-menu" size={18} color={Colors.white} />
            <Text style={styles.doneBtnText}>Order Again</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.payNote}>
            💵 Please pay {cur}{order.grandTotal.toFixed(0)} at the counter
          </Text>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  header: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white, letterSpacing: -0.3 },
  headerOrderNum: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  headerOrderNumText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.white },

  scroll: { padding: Spacing.xl, gap: Spacing.lg },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxxl },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl },

  menuBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadows.primary,
  },
  menuBtnText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.white },

  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadows.md,
  },
  heroIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  heroHeadline: { fontSize: FontSize.xxl, fontWeight: '900', textAlign: 'center' },
  heroSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },

  trackerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    ...Shadows.sm,
  },
  stepWrap: { alignItems: 'center', gap: 6, flex: 1 },
  stepDot: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 2, borderColor: Colors.border,
  },
  stepDotCurrent: { borderWidth: 2.5 },
  stepLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: '500', textAlign: 'center' },
  connector: {
    flex: 0,
    width: 20, height: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 20,
  },

  tokenRow: { flexDirection: 'row', gap: Spacing.md },
  tokenBox: {
    flex: 1, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, alignItems: 'center',
    ...Shadows.primary,
  },
  tokenLabel: { fontSize: FontSize.xs, fontWeight: '700', color: 'rgba(255,255,255,0.75)', letterSpacing: 1.5, textTransform: 'uppercase' },
  tokenNum: { fontSize: FontSize.xxxl, fontWeight: '900', color: Colors.white, marginTop: 4, letterSpacing: -1 },

  itemsCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    ...Shadows.sm,
  },
  itemsTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm },
  itemRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  itemName: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' },
  itemQty: { fontSize: FontSize.sm, color: Colors.textMuted, width: 30, textAlign: 'center' },
  itemTotal: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, width: 56, textAlign: 'right' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: Spacing.md, paddingTop: Spacing.md,
    borderTopWidth: 1.5, borderTopColor: Colors.border,
  },
  totalLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  totalVal: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.primary },

  doneBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    ...Shadows.primary,
  },
  doneBtnText: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.white },

  payNote: {
    textAlign: 'center',
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
});

export default CustomerOrderStatusScreen;
