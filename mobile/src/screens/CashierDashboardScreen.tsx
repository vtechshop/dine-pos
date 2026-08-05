import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  ActivityIndicator, StatusBar, Modal, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootStackParamList, Settings, Order } from '../types';
import {
  getCashierOrders, clearCashierToken,
  getCashierToken, getStoredHotelId, getSocketUrl, getBaseUrl, getSettings, CashierOrder,
} from '../services/api';
import { CASHIER_PROFILE_KEY } from './CashierLoginScreen';
import { setupNotifications } from '../utils/notifications';
import { usePrinterSocket } from '../hooks/usePrinterSocket';
import { useGlobalToast } from '../context/GlobalToastContext';
import { NotificationSvc, orderLabel } from '../services/NotificationService';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';
import { useBadgeCount, BADGE_KEYS } from '../hooks/useBadgeCount';
import UnreadBadge from '../components/UnreadBadge';
import { printReceipt } from '../utils/receipt';

type Props = NativeStackScreenProps<RootStackParamList, 'CashierDashboard'>;

function HighlightText({ text, query, style, matchStyle }: {
  text: string; query: string; style?: any; matchStyle?: any;
}): React.ReactElement {
  if (!query) return <Text style={style}>{text}</Text>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {text.slice(0, idx)}
      <Text style={matchStyle}>{text.slice(idx, idx + query.length)}</Text>
      {text.slice(idx + query.length)}
    </Text>
  );
}

const ACTIVE_STATUSES = ['pending', 'preparing', 'ready', 'served'];

const CashierDashboardScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();
  const [orders, setOrders] = useState<CashierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [cashierName, setCashierName] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [socketLost, setSocketLost] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const mountedRef      = useRef(true);
  const submittingRef   = useRef(false);
  const ordersRef       = useRef<CashierOrder[]>([]);
  const listRef         = useRef<FlatList<CashierOrder>>(null);
  const prevReadyRef    = useRef(0);
  const [tick, setTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [payMethodFilter, setPayMethodFilter] = useState<'all' | 'cash' | 'upi' | 'card' | 'split'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'preparing' | 'ready' | 'served'>('all');
  const { count: cashierBadge, increment: incCashierBadge, reset: resetCashierBadge } = useBadgeCount(BADGE_KEYS.cashierPending);

  const { showToast } = useGlobalToast();

  usePrinterSocket('cashier', undefined, (msg) => showToast(NotificationSvc.printerError(msg), 8000));

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

  const STATUS_SORT: Record<string, number> = { ready: 0, preparing: 1, pending: 2, served: 3, completed: 4, cancelled: 5 };
  const activeOrders = orders
    .filter(o => ACTIVE_STATUSES.includes(o.status))
    .sort((a, b) => (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9));
  const completedOrders = orders.filter(o => o.status === 'completed');
  const readyOrders     = activeOrders.filter(o => o.status === 'ready');
  const todayRevenue    = completedOrders.reduce((sum, o) => sum + o.grandTotal, 0);

  // Auto-scroll list to top when a new ready order arrives
  useEffect(() => {
    if (readyOrders.length > prevReadyRef.current) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
    prevReadyRef.current = readyOrders.length;
  }, [readyOrders.length]);

  const loadOrders = useCallback(async () => {
    try {
      const data = await getCashierOrders();
      if (mountedRef.current) {
        ordersRef.current = data;
        setOrders(data);
      }
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
      if (ok && active) resetCashierBadge();
    })();
    return () => { active = false; };
  }, [loadOrders, resetCashierBadge]));

  useEffect(() => {
    mountedRef.current = true;
    // Per-effect cancellation flag — guards against fast unmount/remount races
    // where mountedRef.current is reset to true by the new effect before the
    // old async IIFE checks it, which would create a duplicate socket.
    let cancelled = false;
    loadOrders();

    AsyncStorage.getItem(CASHIER_PROFILE_KEY).then(raw => {
      if (raw && mountedRef.current) setCashierName((JSON.parse(raw) as { name?: string }).name || '');
    });

    getSettings().then(s => { if (mountedRef.current) setSettings(s); }).catch(() => {});

    let socket: Socket;
    (async () => {
      // Await channel creation before connecting so the first notification
      // always has a valid Android channel and plays the correct sound.
      await setupNotifications();
      const [hotelId, url, token, baseUrl] = await Promise.all([
        getStoredHotelId(), getSocketUrl(), getCashierToken(), getBaseUrl(),
      ]);
      const _ts = new Date().toISOString();
      console.log(
        '\n======== SOCKET START ========' +
        '\nRole=cashier' +
        '\nScreen=CashierDashboardScreen' +
        '\nThread=JS_THREAD' +
        `\nTimestamp=${_ts}` +
        `\nBASE_URL=${baseUrl ?? 'NULL'}` +
        `\nSOCKET_URL=${url ?? 'NULL'}` +
        `\nhotelId=${hotelId ?? 'NULL'}` +
        `\ntokenPresent=${!!token} tokenLength=${token?.length ?? 0}` +
        '\nsocketExists=N/A (per-render local var)' +
        '\nautoConnect=true' +
        "\ntransports=['websocket']" +
        `\ncancelled=${cancelled}` +
        '\n=============================='
      );
      if (cancelled || !hotelId) {
        const _r: string[] = [];
        if (cancelled) _r.push('cancelled=true');
        if (!hotelId) _r.push('hotelId=NULL');
        console.log(
          '\n======== EARLY RETURN ========' +
          '\nRETURN_BEFORE_SOCKET' +
          `\nreason: ${_r.join(' | ')}` +
          `\nstack: ${new Error('EARLY_RETURN').stack ?? 'unavailable'}` +
          '\n=============================='
        );
        return;
      }

      console.log('[CashierNotifSocket] Calling io()');
      socket = io(url, {
        transports: ['websocket'],
        auth: { token: token || '' },
        reconnectionAttempts: 20,
        reconnectionDelay: 2000,
      });
      socketRef.current = socket;
      console.log(`[CashierNotifSocket] io() returned — id=${socket.id ?? 'pending'} connected=${socket.connected}`);
      const _ceng = (socket.io as any).engine;
      console.log(
        '\n======== ENGINE SNAPSHOT [CashierNotifSocket] ========\n' +
        `uri=${(socket.io as any).uri}\n` +
        `transport=${_ceng?.transport?.name ?? 'n/a'}\n` +
        `readyState=${_ceng?.readyState ?? 'n/a'}\n` +
        `hostname=${_ceng?.hostname ?? 'n/a'}\n` +
        `port=${_ceng?.port ?? 'n/a'}\n` +
        `secure=${_ceng?.secure ?? 'n/a'}\n` +
        `path=${_ceng?.path ?? 'n/a'}\n` +
        '======================================================='
      );
      console.log('[CashierNotifSocket] autoConnect=true — socket.connect() NOT called explicitly');
      console.log('\n======== EVENTS ========');

      socket.on('connect', () => {
        console.log(`[CashierNotifSocket] EVENT connect — id=${socket.id} uri=${(socket.io as any).uri}`);
        socket.emit('join_hotel', hotelId);
        console.log(`[CashierNotifSocket] join_hotel EMITTED — hotelId=${hotelId} socketId=${socket.id} room=hotel_${hotelId} (no ack)`);
        loadOrders();
      });

      socket.on('connect_error', (err: any) => {
        console.log(
          `\n[CashierNotifSocket] EVENT connect_error` +
          `\nmessage=${err?.message}` +
          `\ndescription=${JSON.stringify(err?.description)}` +
          `\ntype=${err?.type}` +
          `\ntransport=${err?.context?.transport?.name ?? 'n/a'}` +
          `\nuri=${(socket.io as any).uri}` +
          `\nsocketId=${socket.id ?? 'none'}` +
          `\nconnected=${socket.connected}`
        );
        if (!mountedRef.current) return;
        if (err.message?.includes('authentication')) {
          clearCashierToken().then(() => {
            if (mountedRef.current) navigation.replace('RoleSelect');
          });
        }
      });

      socket.on('disconnect', (reason: string) => {
        console.log(`[CashierNotifSocket] EVENT disconnect — reason=${reason}`);
      });

      socket.io.on('reconnect_attempt', (n: number) => {
        console.log(`[CashierNotifSocket] EVENT reconnect_attempt ${n}/20`);
      });

      socket.io.on('reconnect', (n: number) => {
        console.log(`[CashierNotifSocket] EVENT reconnect — after ${n} attempt(s)`);
      });

      socket.on('reconnect_failed', () => {
        console.log('[CashierNotifSocket] EVENT reconnect_failed — gave up after 20 attempts');
        if (mountedRef.current) setSocketLost(true);
      });
      console.log('\n======== END ========');

      socket.on('new_order', (data: { _id?: string; orderNumber?: string; tableNumber?: string }) => {
        console.log(`[CashierNotifSocket] new_order received — id=${data._id ?? 'n/a'} table=${data.tableNumber ?? 'n/a'} order=${data.orderNumber ?? 'n/a'}`);
        if (!mountedRef.current) return;
        const label = orderLabel(data.tableNumber, data.orderNumber);
        // Vibration + push notification (background) handled by service; also show in-app toast
        const ev = NotificationSvc.handle('new_order', 'cashier', data._id || Date.now().toString(), 'New Order!', `${label} placed an order`);
        if (ev) showToast(ev);
        setNewOrderCount(c => c + 1);
        loadOrders();
      });

      socket.on('order_completed',    () => { if (mountedRef.current) loadOrders(); });
      socket.on('order_served', (data: { orderId: string; tableNumber?: string; orderNumber?: string }) => {
        if (!mountedRef.current) return;
        incCashierBadge();
        const label = orderLabel(data.tableNumber, data.orderNumber);
        const ev = NotificationSvc.handle('order_served', 'cashier', data.orderId, 'Order Served', `${label} has been served`);
        if (ev) showToast(ev);
        loadOrders();
      });
      socket.on('order_status_update', (data: { orderId: string; status: string; tableNumber?: string; orderNumber?: string }) => {
        if (!mountedRef.current) return;
        const label = orderLabel(data.tableNumber, data.orderNumber);
        if (data.status === 'ready') {
          const ev = NotificationSvc.handle('order_ready', 'cashier', data.orderId, '✅ Order Ready!', `${label} is ready to serve`);
          if (ev) showToast(ev);
          incCashierBadge();
        } else if (data.status === 'preparing') {
          const ev = NotificationSvc.handle('order_preparing', 'cashier', data.orderId, 'Now Preparing', `${label} is being prepared`);
          if (ev) showToast(ev);
        } else if (data.status === 'cancelled') {
          const ev = NotificationSvc.handle('order_cancelled', 'cashier', data.orderId, 'Order Cancelled', `${label} was cancelled`);
          if (ev) showToast(ev);
        }
        loadOrders();
      });

      socket.on('print_job_queued', (data: { jobId: string; jobType: string; printerTarget: string }) => {
        if (!mountedRef.current) return;
        if (data.jobType === 'receipt') {
          showToast({ icon: 'print-disabled', severity: 'warning', title: 'Printer Offline', body: 'Receipt queued — will print automatically when printer reconnects.' }, 6000);
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
    const openPayment = () => navigation.navigate('PaymentScreen', {
      mode: 'cashier',
      orderId: item._id,
      orderNumber: item.orderNumber,
      grandTotal: item.grandTotal,
    });
    return (
      <TouchableOpacity activeOpacity={0.92} onPress={openPayment}>
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
            <HighlightText
              text={'#' + token}
              query={q}
              style={styles.tokenText}
              matchStyle={{ backgroundColor: Colors.warning + '55', color: Colors.warning, fontWeight: '900' }}
            />
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
          onPress={openPayment}
          activeOpacity={0.85}
        >
          <MaterialIcons name="point-of-sale" size={18} color={Colors.white} />
          <Text style={styles.payBtnText}>Collect Payment · ₹{item.grandTotal.toFixed(0)}</Text>
        </TouchableOpacity>
        </View>
      </TouchableOpacity>
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
            onPress={() => printReceipt(item as unknown as Order, settings).catch((err: any) => Alert.alert('Print Failed', err?.message || 'Could not print receipt. Check your printer.'))}
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
  const q = searchQuery.trim().toLowerCase();

  const UPI_VARIANTS = ['upi', 'upi_intent', 'upi_qr', 'upi_collect'];
  const afterPayFilter = (tab === 'completed' && payMethodFilter !== 'all')
    ? listData.filter(o =>
        payMethodFilter === 'upi'
          ? UPI_VARIANTS.includes(o.paymentMethod || '')
          : o.paymentMethod === payMethodFilter
      )
    : (tab === 'active' && statusFilter !== 'all')
    ? listData.filter(o => o.status === statusFilter)
    : listData;

  const filteredData = q
    ? afterPayFilter.filter(o => {
        const token = (o.orderNumber.split('-').pop() || '').toLowerCase();
        return (
          token.endsWith(q) ||
          o.tableNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          (tab === 'completed' && (o.paymentMethod || '').toLowerCase().includes(q))
        );
      })
    : afterPayFilter;

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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'active'
                  ? `Active${activeOrders.length > 0 ? ` (${activeOrders.length})` : ''}`
                  : `Completed${completedOrders.length > 0 ? ` (${completedOrders.length})` : ''}`}
              </Text>
              {t === 'active' && readyOrders.length > 0 && (
                <View style={styles.readyTabBadge}>
                  <Text style={styles.readyTabBadgeText}>{readyOrders.length}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'active' && readyOrders.length > 0 && (
        <View style={styles.readySection}>
          <View style={styles.readySectionHeader}>
            <View style={styles.readyCountBadge}>
              <Text style={styles.readyCountBadgeText}>{readyOrders.length}</Text>
            </View>
            <Text style={styles.readySectionTitle}>READY FOR COLLECTION</Text>
          </View>
          {readyOrders.map(order => {
            const rtoken = order.orderNumber.split('-').pop() || '?';
            return (
              <TouchableOpacity
                key={order._id}
                style={styles.readyCard}
                onPress={() => navigation.navigate('PaymentScreen', {
                  mode: 'cashier',
                  orderId: order._id,
                  orderNumber: order.orderNumber,
                  grandTotal: order.grandTotal,
                })}
                activeOpacity={0.85}
              >
                <View style={styles.readyCardRow}>
                  <Text style={styles.readyToken}>#{rtoken}</Text>
                  <View style={{ flex: 1, marginLeft: Spacing.md }}>
                    {order.tableNumber ? <Text style={styles.readyTable}>Table {order.tableNumber}</Text> : null}
                    {order.customerName ? <Text style={styles.readyCustomer} numberOfLines={1}>{order.customerName}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.readyTime}>{elapsed(order.createdAt)}</Text>
                    <Text style={styles.readyAmount}>₹{order.grandTotal.toFixed(0)}</Text>
                  </View>
                </View>
                <View style={styles.readyPayBtn}>
                  <MaterialIcons name="point-of-sale" size={14} color={Colors.white} />
                  <Text style={styles.readyPayBtnText}>Collect Payment · ₹{order.grandTotal.toFixed(0)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={styles.searchContainer}>
        <MaterialIcons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Order no, table, name…"
          placeholderTextColor={Colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterChipRow}
        contentContainerStyle={styles.filterChipRowContent}
      >
        {tab === 'active'
          ? (['all', 'pending', 'preparing', 'ready', 'served'] as const).map(s => {
              const count = s === 'all'
                ? activeOrders.length
                : activeOrders.filter(o => o.status === s).length;
              if (s !== 'all' && count === 0) return null;
              const chipColor = s === 'ready' ? Colors.success : s === 'preparing' ? Colors.info : s === 'served' ? Colors.accent : Colors.warning;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.filterChip, statusFilter === s && { backgroundColor: chipColor + '22', borderColor: chipColor }]}
                  onPress={() => setStatusFilter(statusFilter === s && s !== 'all' ? 'all' : s)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterChipText, statusFilter === s && { color: s === 'all' ? Colors.info : chipColor }]}>
                    {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })
          : (['all', 'cash', 'upi', 'card', 'split'] as const).map(m => {
              const count = m === 'all'
                ? completedOrders.length
                : m === 'upi'
                ? completedOrders.filter(o => UPI_VARIANTS.includes(o.paymentMethod || '')).length
                : completedOrders.filter(o => o.paymentMethod === m).length;
              if (m !== 'all' && count === 0) return null;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.filterChip, payMethodFilter === m && styles.filterChipActive]}
                  onPress={() => setPayMethodFilter(payMethodFilter === m && m !== 'all' ? 'all' : m)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterChipText, payMethodFilter === m && styles.filterChipTextActive]}>
                    {m === 'all' ? 'All' : m.toUpperCase()} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })
        }
      </ScrollView>

      <FlatList
        ref={listRef}
        data={filteredData}
        keyExtractor={item => item._id}
        renderItem={tab === 'active' ? renderActiveOrder : renderCompletedOrder}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: bottom + 32 }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={{ fontSize: 40 }}>{q ? '🔍' : tab === 'active' ? '✅' : '📋'}</Text>
            <Text style={styles.emptyText}>
              {q ? 'No orders match your search' : tab === 'active' ? 'No active orders' : 'No completed orders today'}
            </Text>
          </View>
        }
      />

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
  // ── Ready Orders section ─────────────────────────────────────────────────────
  readySection: {
    backgroundColor: Colors.statusReadyBg, borderBottomWidth: 1,
    borderBottomColor: Colors.success + '40', paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm,
  },
  readySectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 2,
  },
  readySectionTitle: {
    fontSize: FontSize.xs, fontWeight: '800', color: Colors.success, letterSpacing: 0.8,
  },
  readyCountBadge: {
    backgroundColor: Colors.danger, borderRadius: BorderRadius.round,
    minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  readyCountBadgeText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '900' },
  readyCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.success + '55', ...Shadows.sm,
  },
  readyCardRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  readyToken:   { fontSize: FontSize.xl, fontWeight: '900', color: Colors.success },
  readyTable:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  readyCustomer:{ fontSize: FontSize.sm, color: Colors.textSecondary },
  readyTime:    { fontSize: FontSize.sm, fontWeight: '700', color: Colors.success, textAlign: 'right' },
  readyAmount:  { fontSize: FontSize.lg, fontWeight: '900', color: Colors.text, textAlign: 'right' },
  readyPayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.success, borderRadius: BorderRadius.md, paddingVertical: 8,
  },
  readyPayBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '800' },
  // ── Active tab ready badge ────────────────────────────────────────────────────
  readyTabBadge: {
    backgroundColor: Colors.danger, borderRadius: BorderRadius.round,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  readyTabBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '900' },
  // ── Search bar ───────────────────────────────────────────────────────────────
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, marginHorizontal: Spacing.lg, marginTop: Spacing.sm,
    marginBottom: 2, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md,
    paddingVertical: 10, borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: FontSize.md, color: Colors.text, paddingVertical: 0 },
  filterChipRow: { marginTop: Spacing.sm },
  filterChipRowContent: { gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: 4 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.infoBg, borderColor: Colors.info },
  filterChipText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.info },
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
  cancelBtnText:    { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: '600' },
  splitSection:     { gap: Spacing.sm, marginBottom: Spacing.xl },
  splitRow:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.background, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  splitMethodLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, width: 44 },
  splitInput:       { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, textAlign: 'right', paddingVertical: 0 },
  splitHint:        { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'right', fontWeight: '600' },

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

export default CashierDashboardScreen;
