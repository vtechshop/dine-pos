import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ActivityIndicator, StatusBar, TextInput, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { io, Socket } from 'socket.io-client';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';
import {
  getOnlineOrders, acceptOnlineOrder, rejectOnlineOrder, dispatchOnlineOrder,
  updateOrderStatus, getSocketUrl, getStoredHotelId, getToken,
  OnlineDeliveryOrder,
} from '../services/api';
import { useSettings } from '../context/SettingsContext';

type PlatformFilter = 'all' | 'swiggy' | 'zomato';
type StatusFilter   = 'needs-action' | 'active' | 'completed' | 'all';

const PLATFORM_TABS: { key: PlatformFilter; label: string; emoji: string; color: string }[] = [
  { key: 'all',    label: 'All',    emoji: '📦', color: Colors.primary },
  { key: 'swiggy', label: 'Swiggy', emoji: '🛵', color: '#FC8019' },
  { key: 'zomato', label: 'Zomato', emoji: '🍕', color: '#E23744' },
];

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'needs-action', label: 'Needs Action' },
  { key: 'active',       label: 'In Kitchen' },
  { key: 'completed',    label: 'Done' },
  { key: 'all',          label: 'All' },
];

const REJECT_REASONS = [
  'Item not available',
  'Store closed',
  'Too busy',
  'Delivery area not serviceable',
  'Other',
];

const fmt = (n: number, symbol: string) =>
  `${symbol}${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

const minutesAgo = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

const OnlineOrdersScreen: React.FC = () => {
  const { settings } = useSettings();
  const { top, bottom } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';

  const [orders,        setOrders]        = useState<OnlineDeliveryOrder[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [platform,      setPlatform]      = useState<PlatformFilter>('all');
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('needs-action');
  const [selected,      setSelected]      = useState<OnlineDeliveryOrder | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [prepMinutes,   setPrepMinutes]   = useState('25');
  const [rejectReason,  setRejectReason]  = useState('');
  const [customReason,  setCustomReason]  = useState('');
  const [showReject,    setShowReject]    = useState(false);
  const [newCount,      setNewCount]      = useState(0);

  const socketRef  = useRef<Socket | null>(null);
  const mountedRef = useRef(true);

  const fetchOrders = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: '50' };
      if (platform !== 'all') params.platform = platform;
      const data = await getOnlineOrders(params);
      if (mountedRef.current) setOrders(data.orders);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load delivery orders');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [platform]);

  useFocusEffect(useCallback(() => {
    let active = true;
    fetchOrders();
    return () => { active = false; };
  }, [fetchOrders]));

  useEffect(() => {
    mountedRef.current = true;
    let socket: Socket;
    (async () => {
      const [url, hotelId, token] = await Promise.all([getSocketUrl(), getStoredHotelId(), getToken()]);
      if (!url || !hotelId) return;
      socket = io(url, { transports: ['websocket'], auth: { token: token || '' } });
      socketRef.current = socket;
      socket.on('connect',    () => { socket.emit('join_hotel', hotelId); });
      socket.on('new_delivery_order', () => {
        if (!mountedRef.current) return;
        setNewCount(c => c + 1);
        fetchOrders();
      });
      socket.on('order_status_update', (data: { orderId: string; status: string }) => {
        if (!mountedRef.current) return;
        setOrders(prev => prev.map(o => o._id === data.orderId ? { ...o, status: data.status as any } : o));
      });
    })();
    return () => {
      mountedRef.current = false;
      if (socketRef.current) { socketRef.current.off(); socketRef.current.disconnect(); socketRef.current = null; }
    };
  }, [fetchOrders]);

  const visibleOrders = orders.filter(o => {
    const platformMatch = platform === 'all' || o.orderSource === platform;
    let statusMatch = true;
    if (statusFilter === 'needs-action') statusMatch = o.status === 'pending' && !o.acceptedAt;
    else if (statusFilter === 'active')  statusMatch = o.status === 'pending' && !!o.acceptedAt || o.status === 'preparing' || o.status === 'ready';
    else if (statusFilter === 'completed') statusMatch = o.status === 'completed' || o.status === 'served' || o.status === 'cancelled';
    return platformMatch && statusMatch;
  });

  const handleAccept = async (order: OnlineDeliveryOrder) => {
    setActionLoading(true);
    try {
      await acceptOnlineOrder(order._id, parseInt(prepMinutes, 10) || 25);
      await updateOrderStatus(order._id, 'preparing');
      setOrders(prev => prev.map(o => o._id === order._id
        ? { ...o, status: 'preparing', acceptedAt: new Date().toISOString() } : o));
      setSelected(null);
    } catch (e: any) {
      Alert.alert('Failed', e.message || 'Could not accept order');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (order: OnlineDeliveryOrder) => {
    const reason = rejectReason === 'Other' ? customReason.trim() : rejectReason;
    if (!reason) { Alert.alert('Reason required', 'Please select or enter a rejection reason'); return; }
    setActionLoading(true);
    try {
      await rejectOnlineOrder(order._id, reason);
      await updateOrderStatus(order._id, 'cancelled');
      setOrders(prev => prev.map(o => o._id === order._id ? { ...o, status: 'cancelled' } : o));
      setSelected(null);
      setShowReject(false);
      setRejectReason('');
      setCustomReason('');
    } catch (e: any) {
      Alert.alert('Failed', e.message || 'Could not reject order');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDispatch = async (order: OnlineDeliveryOrder) => {
    setActionLoading(true);
    try {
      await dispatchOnlineOrder(order._id);
      await updateOrderStatus(order._id, 'completed');
      setOrders(prev => prev.map(o => o._id === order._id ? { ...o, status: 'completed' } : o));
      setSelected(null);
    } catch (e: any) {
      Alert.alert('Failed', e.message || 'Could not dispatch order');
    } finally {
      setActionLoading(false);
    }
  };

  const platformColor = (src: string) => src === 'swiggy' ? '#FC8019' : '#E23744';
  const platformEmoji = (src: string) => src === 'swiggy' ? '🛵' : '🍕';
  const platformName  = (src: string) => src === 'swiggy' ? 'SWIGGY' : 'ZOMATO';

  const renderCard = ({ item }: { item: OnlineDeliveryOrder }) => {
    const color = platformColor(item.orderSource);
    const mins  = minutesAgo(item.createdAt);
    const needsAcceptance = item.status === 'pending' && !item.acceptedAt;
    const isReady = item.status === 'ready';
    const isDone  = item.status === 'completed' || item.status === 'served' || item.status === 'cancelled';
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: color }, needsAcceptance && styles.cardUrgent]}
        onPress={() => setSelected(item)}
        activeOpacity={0.8}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.platformBadge, { backgroundColor: color + '18', borderColor: color + '50' }]}>
            <Text style={[styles.platformText, { color }]}>{platformEmoji(item.orderSource)} {platformName(item.orderSource)}</Text>
          </View>
          {needsAcceptance && (
            <View style={styles.urgentBadge}>
              <Text style={styles.urgentText}>⚡ ACCEPT NOW</Text>
            </View>
          )}
          {isReady && (
            <View style={[styles.urgentBadge, { backgroundColor: Colors.successBg, borderColor: Colors.success + '50' }]}>
              <Text style={[styles.urgentText, { color: Colors.success }]}>✅ READY</Text>
            </View>
          )}
          <View style={styles.cardHeaderRight}>
            <Text style={styles.cardNum}>#{item.orderNumber}</Text>
            <Text style={styles.cardTime}>{fmtTime(item.createdAt)} · {mins}m ago</Text>
          </View>
        </View>
        <Text style={styles.cardCustomer} numberOfLines={1}>{item.customerName || 'Customer'}</Text>
        {!!item.deliveryAddress && (
          <View style={styles.addressRow}>
            <MaterialIcons name="location-on" size={13} color={Colors.textMuted} />
            <Text style={styles.addressText} numberOfLines={2}>{item.deliveryAddress}</Text>
          </View>
        )}
        <View style={styles.cardFooter}>
          <Text style={styles.cardItems}>{item.items.length} item{item.items.length !== 1 ? 's' : ''}</Text>
          <Text style={[styles.cardTotal, { color }]}>{fmt(item.grandTotal, cur)}</Text>
        </View>
        {!isDone && (
          <View style={styles.cardActions}>
            {needsAcceptance && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: Colors.success }]}
                onPress={() => { setSelected(item); setShowReject(false); }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="check" size={15} color={Colors.white} />
                <Text style={styles.actionBtnText}>Accept</Text>
              </TouchableOpacity>
            )}
            {(item.status === 'preparing' || item.status === 'ready') && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: color }]}
                onPress={() => handleDispatch(item)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="local-shipping" size={15} color={Colors.white} />
                <Text style={styles.actionBtnText}>Dispatch</Text>
              </TouchableOpacity>
            )}
            {needsAcceptance && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={() => { setSelected(item); setShowReject(true); setRejectReason(''); setCustomReason(''); }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="close" size={15} color={Colors.danger} />
                <Text style={[styles.actionBtnText, { color: Colors.danger }]}>Reject</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Online Orders</Text>
          <Text style={styles.headerSub}>{visibleOrders.length} order{visibleOrders.length !== 1 ? 's' : ''}</Text>
        </View>
        <View style={styles.headerRight}>
          {newCount > 0 && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>{newCount} new</Text>
            </View>
          )}
          <TouchableOpacity style={styles.refreshBtn} onPress={() => { setLoading(true); fetchOrders(); setNewCount(0); }}>
            <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Platform filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterBarContent}>
        {PLATFORM_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.filterChip, platform === tab.key && { backgroundColor: tab.color, borderColor: tab.color }]}
            onPress={() => setPlatform(tab.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterChipText, platform === tab.key && { color: Colors.white }]}>
              {tab.emoji} {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Status filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusBar} contentContainerStyle={styles.filterBarContent}>
        {STATUS_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.statusChip, statusFilter === tab.key && styles.statusChipActive]}
            onPress={() => setStatusFilter(tab.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.statusChipText, statusFilter === tab.key && styles.statusChipTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading orders…</Text>
        </View>
      ) : visibleOrders.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ fontSize: 48 }}>📦</Text>
          <Text style={styles.emptyTitle}>No orders here</Text>
          <Text style={styles.emptySub}>
            {statusFilter === 'needs-action' ? 'All delivery orders accepted' : 'No orders match this filter'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleOrders}
          keyExtractor={o => o._id}
          renderItem={renderCard}
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: bottom + 20 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Order Detail + Accept Modal */}
      <Modal visible={!!selected && !showReject} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {selected && (() => {
              const color = platformColor(selected.orderSource);
              const needsAcceptance = selected.status === 'pending' && !selected.acceptedAt;
              const canDispatch = selected.status === 'preparing' || selected.status === 'ready';
              return (
                <>
                  <View style={styles.modalHeader}>
                    <View style={[styles.platformBadge, { backgroundColor: color + '18', borderColor: color + '50' }]}>
                      <Text style={[styles.platformText, { color }]}>{platformEmoji(selected.orderSource)} {platformName(selected.orderSource)}</Text>
                    </View>
                    <Text style={styles.modalOrderNum}>#{selected.orderNumber}</Text>
                    <TouchableOpacity onPress={() => setSelected(null)}>
                      <MaterialIcons name="close" size={24} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                    {/* Customer + address */}
                    <Text style={styles.modalCustomer}>{selected.customerName || 'Customer'}</Text>
                    {!!selected.deliveryAddress && (
                      <View style={styles.addressRowLg}>
                        <MaterialIcons name="location-on" size={15} color={Colors.textMuted} />
                        <Text style={styles.addressTextLg}>{selected.deliveryAddress}</Text>
                      </View>
                    )}

                    {/* Items */}
                    <Text style={styles.modalSectionTitle}>Items</Text>
                    {selected.items.map((item, i) => (
                      <View key={i} style={styles.itemRow}>
                        <Text style={styles.itemQty}>{item.quantity}×</Text>
                        <Text style={styles.itemName}>{item.productName}</Text>
                        {item.price > 0 && <Text style={styles.itemPrice}>{fmt(item.price * item.quantity, cur)}</Text>}
                      </View>
                    ))}

                    {/* Totals */}
                    <View style={styles.totalsBox}>
                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Subtotal</Text>
                        <Text style={styles.totalValue}>{fmt(selected.subtotal, cur)}</Text>
                      </View>
                      {selected.deliveryFee > 0 && (
                        <View style={styles.totalRow}>
                          <Text style={styles.totalLabel}>Delivery fee</Text>
                          <Text style={styles.totalValue}>{fmt(selected.deliveryFee, cur)}</Text>
                        </View>
                      )}
                      {selected.platformCommission > 0 && (
                        <View style={styles.totalRow}>
                          <Text style={[styles.totalLabel, { color: Colors.danger }]}>Platform commission</Text>
                          <Text style={[styles.totalValue, { color: Colors.danger }]}>−{fmt(selected.platformCommission, cur)}</Text>
                        </View>
                      )}
                      <View style={[styles.totalRow, styles.totalRowGrand]}>
                        <Text style={styles.totalLabelGrand}>Grand Total</Text>
                        <Text style={[styles.totalValueGrand, { color }]}>{fmt(selected.grandTotal, cur)}</Text>
                      </View>
                    </View>

                    {/* Prep time input (only when needing acceptance) */}
                    {needsAcceptance && (
                      <View style={styles.prepRow}>
                        <MaterialIcons name="timer" size={18} color={Colors.textSecondary} />
                        <Text style={styles.prepLabel}>Prep time (minutes)</Text>
                        <TextInput
                          style={styles.prepInput}
                          value={prepMinutes}
                          onChangeText={setPrepMinutes}
                          keyboardType="numeric"
                          maxLength={3}
                          selectTextOnFocus
                        />
                      </View>
                    )}
                  </ScrollView>

                  {/* Action buttons */}
                  {needsAcceptance && (
                    <View style={styles.modalActions}>
                      <TouchableOpacity
                        style={[styles.modalBtn, styles.rejectModalBtn]}
                        onPress={() => { setShowReject(true); setRejectReason(''); setCustomReason(''); }}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="close" size={18} color={Colors.danger} />
                        <Text style={[styles.modalBtnText, { color: Colors.danger }]}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalBtn, { backgroundColor: Colors.success, flex: 2 }]}
                        onPress={() => handleAccept(selected)}
                        disabled={actionLoading}
                        activeOpacity={0.8}
                      >
                        {actionLoading ? <ActivityIndicator size="small" color={Colors.white} />
                          : <><MaterialIcons name="check" size={18} color={Colors.white} />
                            <Text style={[styles.modalBtnText, { color: Colors.white }]}>Accept Order</Text></>}
                      </TouchableOpacity>
                    </View>
                  )}
                  {canDispatch && (
                    <View style={styles.modalActions}>
                      <TouchableOpacity
                        style={[styles.modalBtn, { backgroundColor: color, flex: 1 }]}
                        onPress={() => handleDispatch(selected)}
                        disabled={actionLoading}
                        activeOpacity={0.8}
                      >
                        {actionLoading ? <ActivityIndicator size="small" color={Colors.white} />
                          : <><MaterialIcons name="local-shipping" size={18} color={Colors.white} />
                            <Text style={[styles.modalBtnText, { color: Colors.white }]}>Mark Dispatched</Text></>}
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Reject Modal */}
      <Modal visible={showReject && !!selected} transparent animationType="slide" onRequestClose={() => setShowReject(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalOrderNum, { color: Colors.danger }]}>Reject Order #{selected?.orderNumber}</Text>
              <TouchableOpacity onPress={() => setShowReject(false)}>
                <MaterialIcons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <Text style={styles.modalSectionTitle}>Reason</Text>
              {REJECT_REASONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.reasonOption, rejectReason === r && styles.reasonOptionActive]}
                  onPress={() => setRejectReason(r)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.reasonRadio, rejectReason === r && styles.reasonRadioActive]} />
                  <Text style={[styles.reasonText, rejectReason === r && { color: Colors.danger, fontWeight: '700' }]}>{r}</Text>
                </TouchableOpacity>
              ))}
              {rejectReason === 'Other' && (
                <TextInput
                  style={styles.customReasonInput}
                  placeholder="Enter reason…"
                  value={customReason}
                  onChangeText={setCustomReason}
                  multiline
                  placeholderTextColor={Colors.textMuted}
                />
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.rejectModalBtn]} onPress={() => setShowReject(false)} activeOpacity={0.8}>
                <Text style={[styles.modalBtnText, { color: Colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: Colors.danger, flex: 2 }]}
                onPress={() => selected && handleReject(selected)}
                disabled={actionLoading}
                activeOpacity={0.8}
              >
                {actionLoading ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={[styles.modalBtnText, { color: Colors.white }]}>Confirm Reject</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border, ...Shadows.sm,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text },
  headerSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  newBadge: { backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  newBadgeText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.xs },

  filterBar: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  statusBar:  { backgroundColor: Colors.card },
  filterBarContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: BorderRadius.round, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  filterChipText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  statusChip: {
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  statusChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  statusChipText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary },
  statusChipTextActive: { color: Colors.white },

  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  loadingText: { marginTop: Spacing.md, color: Colors.textSecondary, fontSize: FontSize.md },
  emptyTitle:  { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, marginTop: Spacing.md, marginBottom: Spacing.sm },
  emptySub:    { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },

  // Order card
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1.5, borderColor: Colors.border,
    borderLeftWidth: 4, ...Shadows.sm,
  },
  cardUrgent: { borderTopWidth: 2, borderTopColor: Colors.danger },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm, flexWrap: 'wrap' },
  platformBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1,
  },
  platformText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  urgentBadge: {
    backgroundColor: Colors.dangerBg, borderColor: Colors.danger + '50',
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  urgentText: { fontSize: 10, fontWeight: '800', color: Colors.danger },
  cardHeaderRight: { marginLeft: 'auto' as any, alignItems: 'flex-end' },
  cardNum:  { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  cardTime: { fontSize: FontSize.xs, color: Colors.textMuted },
  cardCustomer: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xs },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginBottom: Spacing.sm },
  addressText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, fontStyle: 'italic' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  cardItems: { fontSize: FontSize.sm, color: Colors.textSecondary },
  cardTotal: { fontSize: FontSize.lg, fontWeight: '900' },
  cardActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: BorderRadius.md,
  },
  rejectBtn: { borderWidth: 1, borderColor: Colors.danger + '50', backgroundColor: Colors.dangerBg },
  actionBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.white },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xxl, borderTopRightRadius: BorderRadius.xxl,
    maxHeight: '88%', paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalOrderNum: { flex: 1, fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  modalBody: { padding: Spacing.lg, flexGrow: 0, maxHeight: 420 },
  modalCustomer: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.sm },
  addressRowLg: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginBottom: Spacing.lg },
  addressTextLg: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  modalSectionTitle: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  itemQty: { fontSize: FontSize.md, fontWeight: '900', color: Colors.primary, width: 28, textAlign: 'right' },
  itemName: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  itemPrice: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  totalsBox: { marginTop: Spacing.md, backgroundColor: Colors.card, borderRadius: BorderRadius.lg, padding: Spacing.md },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totalRowGrand: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.xs, paddingTop: Spacing.sm },
  totalLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  totalValue: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  totalLabelGrand: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  totalValueGrand: { fontSize: FontSize.xl, fontWeight: '900' },
  prepRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: Spacing.md, marginTop: Spacing.lg,
  },
  prepLabel: { flex: 1, fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  prepInput: {
    width: 60, textAlign: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.sm,
    borderWidth: 1.5, borderColor: Colors.borderFocus,
    fontSize: FontSize.lg, fontWeight: '800', color: Colors.text,
    paddingVertical: 6, paddingHorizontal: 8,
  },
  modalActions: {
    flexDirection: 'row', gap: Spacing.sm,
    padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  modalBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: BorderRadius.lg, paddingVertical: 13, flex: 1,
  },
  rejectModalBtn: { borderWidth: 1.5, borderColor: Colors.danger + '50', backgroundColor: Colors.dangerBg },
  modalBtnText: { fontSize: FontSize.md, fontWeight: '800' },

  // Reject modal
  reasonOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  reasonOptionActive: { backgroundColor: Colors.dangerBg + '60', borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm },
  reasonRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: Colors.border },
  reasonRadioActive: { borderColor: Colors.danger, backgroundColor: Colors.danger },
  reasonText: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  customReasonInput: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.md,
    padding: Spacing.md, marginTop: Spacing.md, fontSize: FontSize.md, color: Colors.text,
    minHeight: 80, textAlignVertical: 'top',
  },
});

export default OnlineOrdersScreen;
