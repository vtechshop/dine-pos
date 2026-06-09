import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, StatusBar,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CompositeScreenProps, useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { io, Socket } from 'socket.io-client';
import { RootStackParamList, TabParamList, DailyReport } from '../types';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';
import { getDailyReport, getProducts, getCategories, getStoredHotelId, getSocketUrl, getLowStockProducts, createOrder, getOrder } from '../services/api';
import { flushQueue, getQueue } from '../utils/offlineQueue';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { printReceipt } from '../utils/receipt';
import { setupNotifications, notifyNewOrder } from '../utils/notifications';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BT_PRINTER_ADDRESS_KEY = '@hotel_pos_bt_printer_address';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

interface Stats { todayOrders: number; todaySales: number; totalProducts: number; totalCategories: number }
interface NewOrderAlert { _id?: string; orderNumber: string; tableNumber: string; customerName: string; grandTotal: number; itemCount: number }

const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const { settings, refreshSettings } = useSettings();
  const { logout } = useAuth();
  const { clearCart } = useCart();
  const [stats, setStats]           = useState<Stats>({ todayOrders: 0, todaySales: 0, totalProducts: 0, totalCategories: 0 });
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [newOrderAlert, setNewOrderAlert] = useState<NewOrderAlert | null>(null);
  const [orderBadge, setOrderBadge] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [offlineCount, setOfflineCount]   = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const fetchStats = useCallback(async () => {
    try {
      setError(null);
      const [report, products, categories, lowStock, queue] = await Promise.all([
        getDailyReport().catch((): DailyReport => ({ date: '', totalSales: 0, totalTax: 0, totalOrders: 0, paymentBreakdown: { cash: 0, upi: 0, card: 0, split: 0 } })),
        getProducts().catch(() => []),
        getCategories().catch(() => []),
        getLowStockProducts(5).catch(() => ({ products: [], threshold: 5 })),
        getQueue().catch(() => []),
      ]);
      setStats({ todayOrders: report.totalOrders, todaySales: report.totalSales, totalProducts: products.length, totalCategories: categories.length });
      setLowStockCount(lowStock.products.length);
      setOfflineCount(queue.length);
      // Flush queued offline orders on each load
      if (queue.length > 0) {
        flushQueue(createOrder, (synced) => {
          if (synced > 0) setOfflineCount(0);
        });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Refresh settings (including isPremium) every time Home tab is visited
  useFocusEffect(useCallback(() => { refreshSettings(); }, []));

  useEffect(() => {
    setupNotifications();
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      navigation.navigate('Orders');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    const connect = async () => {
      const hotelId = await getStoredHotelId();
      if (!hotelId || !mounted) return;
      const url = await getSocketUrl();
      const socket = io(url, {
        transports: ['websocket'],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 20000,
      });
      socketRef.current = socket;
      socket.on('connect', () => socket.emit('join_hotel', hotelId));
      socket.on('new_order', async (data: NewOrderAlert) => {
        if (!mounted) return;
        setNewOrderAlert(data);
        setOrderBadge(p => p + 1);
        fetchStats();
        notifyNewOrder(data.tableNumber, data.grandTotal, data.itemCount, settingsRef.current.currencySymbol || '₹');
        // Auto-print receipt if a Bluetooth printer is paired
        try {
          const btAddress = await AsyncStorage.getItem(BT_PRINTER_ADDRESS_KEY);
          if (data._id && btAddress) {
            const order = await getOrder(data._id);
            if (order) await printReceipt(order, settingsRef.current);
          }
        } catch { /* silent — print failure should not block order flow */ }
      });
    };
    connect();
    return () => { mounted = false; socketRef.current?.disconnect(); socketRef.current = null; };
  }, [fetchStats]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchStats(); }, [fetchStats]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  if (loading) {
    return (
      <View style={styles.loader}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
    <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loaderText}>Loading dashboard...</Text>
      </View>
    );
  }

  const statCards = [
    { title: "Today's Sales",  value: fmt(stats.todaySales), icon: 'trending-up' as const,       color: Colors.success,  bg: Colors.successBg },
    { title: "Today's Orders", value: String(stats.todayOrders), icon: 'receipt-long' as const,  color: Colors.primary,  bg: Colors.primaryBg },
    { title: 'Products',       value: String(stats.totalProducts), icon: 'restaurant-menu' as const, color: Colors.warning, bg: Colors.warningBg },
    { title: 'Categories',     value: String(stats.totalCategories), icon: 'category' as const,   color: Colors.info,     bg: Colors.infoBg },
  ];

  const avgOrder = stats.todayOrders > 0 ? stats.todaySales / stats.todayOrders : 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity style={styles.avatarBtn} onPress={() => { clearCart(); logout(); }} activeOpacity={0.7}>
              <MaterialIcons name="logout" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
            <View style={{ marginLeft: Spacing.md }}>
              <Text style={styles.greetText}>{greeting} 👋</Text>
              <Text style={styles.hotelNameText} numberOfLines={1}>{settings.hotelName}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')} activeOpacity={0.8}>
            <MaterialIcons name="settings" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* ── Error banner ── */}
        {error && (
          <TouchableOpacity style={styles.errorBanner} onPress={fetchStats}>
            <MaterialIcons name="error-outline" size={18} color={Colors.white} />
            <Text style={styles.errorText}>{error}</Text>
            <MaterialIcons name="refresh" size={18} color={Colors.white} />
          </TouchableOpacity>
        )}

        {/* ── Low Stock Alert ── */}
        {lowStockCount > 0 && (
          <TouchableOpacity
            style={[styles.alertBanner, { backgroundColor: Colors.warning }]}
            onPress={() => navigation.navigate('Products' as any)}
            activeOpacity={0.88}
          >
            <MaterialIcons name="warning" size={22} color={Colors.white} />
            <Text style={[styles.alertTitle, { marginLeft: Spacing.md }]}>
              {lowStockCount} item{lowStockCount > 1 ? 's' : ''} running low on stock
            </Text>
            <MaterialIcons name="arrow-forward-ios" size={16} color={Colors.white} />
          </TouchableOpacity>
        )}

        {/* ── Offline Queue Alert ── */}
        {offlineCount > 0 && (
          <View style={[styles.alertBanner, { backgroundColor: Colors.info }]}>
            <MaterialIcons name="cloud-off" size={22} color={Colors.white} />
            <Text style={[styles.alertTitle, { marginLeft: Spacing.md, flex: 1 }]}>
              {offlineCount} order{offlineCount > 1 ? 's' : ''} queued offline — will sync when connected
            </Text>
          </View>
        )}

        {/* ── New Order Alert ── */}
        {newOrderAlert && (
          <TouchableOpacity
            style={styles.alertBanner}
            onPress={() => { setNewOrderAlert(null); setOrderBadge(0); navigation.navigate('Orders'); }}
            activeOpacity={0.88}
          >
            <View style={styles.alertBannerPulse} />
            <MaterialIcons name="notifications-active" size={24} color={Colors.white} />
            <View style={{ flex: 1, marginLeft: Spacing.md }}>
              <Text style={styles.alertTitle}>New Order — {newOrderAlert.orderNumber}</Text>
              <Text style={styles.alertSub}>
                {newOrderAlert.tableNumber ? `Table ${newOrderAlert.tableNumber}  ·  ` : ''}
                {newOrderAlert.itemCount} item{newOrderAlert.itemCount !== 1 ? 's' : ''}  ·  {fmt(newOrderAlert.grandTotal)}
              </Text>
            </View>
            {orderBadge > 0 && (
              <View style={styles.alertBadge}><Text style={styles.alertBadgeText}>{orderBadge}</Text></View>
            )}
          </TouchableOpacity>
        )}

        {/* ── Hero Revenue Card ── */}
        <View style={styles.heroCard}>
          <View style={styles.heroCardInner}>
            <Text style={styles.heroLabel}>Today's Revenue</Text>
            <Text style={styles.heroValue}>{fmt(stats.todaySales)}</Text>
            <View style={styles.heroSubRow}>
              <View style={styles.heroChip}>
                <MaterialIcons name="receipt" size={14} color={Colors.success} />
                <Text style={styles.heroChipText}>{stats.todayOrders} orders</Text>
              </View>
              <View style={styles.heroChip}>
                <MaterialIcons name="speed" size={14} color={Colors.warning} />
                <Text style={styles.heroChipText}>Avg {fmt(avgOrder)}</Text>
              </View>
            </View>
          </View>
          <View style={styles.heroIcon}>
            <MaterialIcons name="bar-chart" size={40} color={Colors.primary + '60'} />
          </View>
        </View>

        {/* ── Stat Grid ── */}
        <Text style={styles.sectionTitle}>Quick Stats</Text>
        <View style={styles.statsGrid}>
          {statCards.map((s, i) => (
            <View key={i} style={[styles.statCard, { borderLeftColor: s.color }]}>
              <View style={[styles.statIconWrap, { backgroundColor: s.bg }]}>
                <MaterialIcons name={s.icon} size={22} color={s.color} />
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statTitle}>{s.title}</Text>
            </View>
          ))}
        </View>

        {/* ── Quick Actions ── */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {[
            { label: 'New Bill',     icon: 'receipt' as const,          color: Colors.primary, bg: Colors.primaryBg, nav: 'Billing' },
            { label: 'Orders',       icon: 'receipt-long' as const,     color: Colors.success, bg: Colors.successBg, nav: 'Orders' },
            { label: 'Products',     icon: 'inventory' as const,         color: Colors.warning, bg: Colors.warningBg, nav: 'Products' },
            { label: 'Reports',      icon: 'bar-chart' as const,         color: Colors.info,    bg: Colors.infoBg,    nav: 'Reports' },
            { label: 'Floor Map',    icon: 'table-restaurant' as const,  color: Colors.accent,  bg: Colors.accentBg,  nav: 'TableLayout' },
            { label: 'Bookings',     icon: 'event-available' as const,   color: '#6A1B9A',      bg: 'rgba(106,27,154,0.1)', nav: 'Reservations' },
            { label: 'Expenses',     icon: 'account-balance-wallet' as const, color: Colors.danger, bg: Colors.dangerBg, nav: 'Expenses' },
            { label: 'Settings',     icon: 'settings' as const,          color: Colors.textSecondary, bg: Colors.elevated, nav: 'Settings' },
          ].map((a, i) => (
            <TouchableOpacity
              key={i}
              style={styles.actionCard}
              onPress={() => navigation.navigate(a.nav as any)}
              activeOpacity={0.8}
            >
              <View style={[styles.actionIconWrap, { backgroundColor: a.bg }]}>
                <MaterialIcons name={a.icon} size={28} color={a.color} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  loaderText: { color: Colors.textSecondary, fontSize: FontSize.md, marginTop: Spacing.md },
  scrollContent: { padding: Spacing.lg, paddingBottom: 100 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl, paddingTop: Spacing.md },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  greetText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  hotelNameText: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, maxWidth: 200 },
  settingsBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },

  // Banners
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.danger,
    borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.lg, gap: Spacing.sm,
  },
  errorText: { flex: 1, color: Colors.white, fontSize: FontSize.sm },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.success,
    borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.lg,
    overflow: 'hidden',
    ...Shadows.success,
  },
  alertBannerPulse: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  alertTitle: { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
  alertSub: { color: 'rgba(255,255,255,0.8)', fontSize: FontSize.sm, marginTop: 2 },
  alertBadge: {
    backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: BorderRadius.round,
    minWidth: 28, height: 28, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  alertBadgeText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.sm },

  // Hero card
  heroCard: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.xxl,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    ...Shadows.primary,
  },
  heroCardInner: { flex: 1 },
  heroLabel: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.75)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 },
  heroValue: { fontSize: FontSize.hero, fontWeight: '900', color: Colors.white, marginBottom: Spacing.md },
  heroSubRow: { flexDirection: 'row', gap: Spacing.md },
  heroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md, paddingVertical: 5,
  },
  heroChipText: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.9)', fontWeight: '700' },
  heroIcon: { marginLeft: Spacing.md },

  // Section title
  sectionTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },

  // Stats
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginBottom: Spacing.xl },
  statCard: {
    width: '47%',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    ...Shadows.sm,
  },
  statIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  statValue: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: 2 },
  statTitle: { fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Actions
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginBottom: Spacing.xl },
  actionCard: {
    width: '47%',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  actionIconWrap: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  actionLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});

export default HomeScreen;
