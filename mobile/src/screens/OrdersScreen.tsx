import React, { useState, useCallback } from 'react';
import { showAlert } from '../utils/alert';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ActivityIndicator, StatusBar, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { Order } from '../types';
import { Colors, Spacing, FontSize, BorderRadius } from '../utils/constants';
import { getOrders, updateOrderStatus } from '../services/api';
import { printReceipt } from '../utils/receipt';
import { useSettings } from '../context/SettingsContext';

type OrderStatus = Order['status'];

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bg: string; icon: string }> = {
  pending:   { label: 'Pending',   color: Colors.warning,       bg: Colors.warningBg,       icon: 'hourglass-empty' },
  preparing: { label: 'Preparing', color: Colors.statusPreparing, bg: Colors.statusPreparingBg, icon: 'restaurant' },
  ready:     { label: 'Ready',     color: Colors.success,       bg: Colors.successBg,       icon: 'check-circle' },
  served:    { label: 'Served',    color: '#00897B',            bg: 'rgba(0,137,123,0.10)', icon: 'room-service' },
  completed: { label: 'Completed', color: Colors.textSecondary, bg: Colors.card,            icon: 'done-all' },
  cancelled: { label: 'Cancelled', color: Colors.danger,        bg: Colors.dangerBg,        icon: 'cancel' },
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'completed',
};

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: 'Mark Completed',
};

const TAB_FILTERS: { key: string; label: string }[] = [
  { key: 'active',    label: 'Active' },
  { key: 'all',       label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'completed', label: 'Done' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PAGE_SIZE = 20;

const fmt = (iso: string) => {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  };
};

const OrdersScreen: React.FC = () => {
  const { settings } = useSettings();
  const cur = settings.currencySymbol || '₹';

  const [orders,       setOrders]       = useState<Order[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(1);
  const [totalPages,   setTotalPages]   = useState(1);
  const [activeTab,    setActiveTab]    = useState('active');
  const [selected,     setSelected]     = useState<Order | null>(null);
  const [updating,     setUpdating]     = useState(false);
  const [reprinting,   setReprinting]   = useState(false);

  const fetchOrders = useCallback(async (pageNum: number, tab: string, append = false) => {
    try {
      append ? setLoadingMore(true) : setLoading(true);
      const params: Record<string, string> = {
        page: pageNum.toString(),
        limit: PAGE_SIZE.toString(),
        sort: '-createdAt',
      };
      if (tab !== 'all' && tab !== 'active') params.status = tab;
      const data = await getOrders(params);

      let orders = data.orders;
      if (tab === 'active') {
        orders = orders.filter(o => o.status === 'pending');
      }

      setOrders(prev => append ? [...prev, ...orders] : orders);
      setPage(data.page);
      setTotalPages(data.pages);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load orders');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchOrders(1, activeTab);
  }, [fetchOrders, activeTab]));

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    fetchOrders(1, tab);
  };

  const handleStatusUpdate = async (order: Order, newStatus: OrderStatus) => {
    setUpdating(true);
    try {
      const updated = await updateOrderStatus(order._id, newStatus);
      setOrders(prev => prev.map(o => o._id === updated._id ? updated : o));
      if (selected?._id === updated._id) setSelected(updated);
      if (activeTab === 'active' && newStatus !== 'pending') {
        setOrders(prev => prev.filter(o => o._id !== updated._id));
        setSelected(null);
      }
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to update status');
    } finally {
      setUpdating(false);
    }
  };

  const handleCancel = (order: Order) => {
    showAlert('Cancel Order', `Cancel order #${order.orderNumber}?`, [
      { text: 'No', style: 'cancel' },
      { text: 'Cancel Order', style: 'destructive', onPress: () => handleStatusUpdate(order, 'cancelled') },
    ]);
  };

  const handleReprint = async (order: Order) => {
    try {
      setReprinting(true);
      await printReceipt(order, settings);
    } catch (e: any) {
      showAlert('Print Error', e.message || 'Failed to print');
    } finally {
      setReprinting(false); }
  };

  // ── Order Card ──────────────────────────────────────────────────────────────
  const renderCard = ({ item }: { item: Order }) => {
    const { date, time } = fmt(item.createdAt);
    const cfg = STATUS_CONFIG[item.status];
    return (
      <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} activeOpacity={0.75}>
        <View style={styles.cardTop}>
          <View style={styles.cardLeft}>
            <Text style={styles.orderNum}>#{item.orderNumber}</Text>
            {(item.tableNumber || item.customerName) ? (
              <Text style={styles.cardMeta} numberOfLines={1}>
                {item.tableNumber ? `Table ${item.tableNumber}` : item.customerName}
              </Text>
            ) : null}
          </View>
          <View style={styles.cardRight}>
            <Text style={styles.cardTotal}>{cur}{item.grandTotal.toFixed(2)}</Text>
            <Text style={styles.cardTime}>{date} {time}</Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: cfg.bg, borderColor: cfg.color + '40' }]}>
          <MaterialIcons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          {item.isParcel && <Text style={styles.parcelTag}>📦 Parcel</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Detail Modal ────────────────────────────────────────────────────────────
  const renderModal = () => {
    if (!selected) return null;
    const { date, time } = fmt(selected.createdAt);
    const cfg = STATUS_CONFIG[selected.status];
    const nextStatus = NEXT_STATUS[selected.status];
    const nextLabel  = NEXT_LABEL[selected.status];

    return (
      <Modal visible animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <ScrollView showsVerticalScrollIndicator={false}>

              {/* Header */}
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalOrderNum}>#{selected.orderNumber}</Text>
                  <Text style={styles.modalTime}>{date} at {time}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)} style={styles.closeBtn}>
                  <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Status Row */}
              <View style={[styles.statusRow, { backgroundColor: cfg.bg, borderColor: cfg.color + '50' }]}>
                <MaterialIcons name={cfg.icon as any} size={20} color={cfg.color} />
                <Text style={[styles.statusRowText, { color: cfg.color }]}>{cfg.label}</Text>
                {selected.tableNumber ? (
                  <Text style={styles.tableTag}>Table {selected.tableNumber}</Text>
                ) : null}
                {selected.isParcel ? <Text style={styles.tableTag}>📦 Parcel</Text> : null}
              </View>

              {/* Items */}
              <View style={styles.section}>
                {selected.items.map((item, i) => (
                  <View key={i} style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>{item.productName}</Text>
                    <Text style={styles.itemQty}>×{item.quantity}</Text>
                    <Text style={styles.itemTotal}>{cur}{item.total.toFixed(2)}</Text>
                  </View>
                ))}
              </View>

              {/* Totals */}
              <View style={styles.totals}>
                <View style={styles.totalRow}><Text style={styles.totalLbl}>Subtotal</Text><Text style={styles.totalVal}>{cur}{selected.subtotal.toFixed(2)}</Text></View>
                <View style={styles.totalRow}><Text style={styles.totalLbl}>Tax</Text><Text style={styles.totalVal}>{cur}{selected.taxTotal.toFixed(2)}</Text></View>
                {selected.discountAmount > 0 && (
                  <View style={styles.totalRow}><Text style={[styles.totalLbl, { color: Colors.success }]}>Discount</Text><Text style={[styles.totalVal, { color: Colors.success }]}>-{cur}{selected.discountAmount.toFixed(2)}</Text></View>
                )}
                <View style={[styles.totalRow, styles.grandRow]}>
                  <Text style={styles.grandLbl}>Grand Total</Text>
                  <Text style={styles.grandVal}>{cur}{selected.grandTotal.toFixed(2)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLbl}>Payment</Text>
                  <Text style={styles.totalVal}>{selected.paymentMethod.toUpperCase()}</Text>
                </View>
              </View>

              {/* Notes */}
              {selected.notes ? (
                <View style={styles.notesBox}>
                  <Text style={styles.notesLabel}>Notes</Text>
                  <Text style={styles.notesText}>{selected.notes}</Text>
                </View>
              ) : null}

              {/* Action Buttons */}
              <View style={styles.actions}>
                {nextStatus && nextLabel && selected.status !== 'cancelled' && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: cfg.color }]}
                    onPress={() => handleStatusUpdate(selected, nextStatus)}
                    disabled={updating}
                    activeOpacity={0.8}
                  >
                    {updating
                      ? <ActivityIndicator size="small" color={Colors.white} />
                      : <>
                          <MaterialIcons name={STATUS_CONFIG[nextStatus].icon as any} size={18} color={Colors.white} />
                          <Text style={styles.actionBtnText}>{nextLabel}</Text>
                        </>
                    }
                  </TouchableOpacity>
                )}

                <View style={styles.secondaryActions}>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => handleReprint(selected)}
                    disabled={reprinting}
                    activeOpacity={0.75}
                  >
                    {reprinting
                      ? <ActivityIndicator size="small" color={Colors.primary} />
                      : <><MaterialIcons name="print" size={16} color={Colors.primary} /><Text style={styles.secondaryBtnText}>Reprint</Text></>
                    }
                  </TouchableOpacity>

                  {selected.status === 'pending' && (
                    <TouchableOpacity
                      style={[styles.secondaryBtn, { borderColor: Colors.danger }]}
                      onPress={() => handleCancel(selected)}
                      disabled={updating}
                      activeOpacity={0.75}
                    >
                      <MaterialIcons name="cancel" size={16} color={Colors.danger} />
                      <Text style={[styles.secondaryBtnText, { color: Colors.danger }]}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Orders</Text>
        <TouchableOpacity onPress={() => fetchOrders(1, activeTab)} style={styles.refreshBtn}>
          <MaterialIcons name="refresh" size={22} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Status Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
        {TAB_FILTERS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => handleTabChange(t.key)}
            activeOpacity={0.75}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading orders...</Text>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="receipt-long" size={56} color={Colors.border} />
          <Text style={styles.emptyText}>No orders</Text>
          <Text style={styles.emptySubText}>
            {activeTab === 'active' ? 'No active orders right now' : 'Orders will appear here'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o._id}
          renderItem={renderCard}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={page < totalPages ? (
            <TouchableOpacity style={styles.loadMore} onPress={() => fetchOrders(page + 1, activeTab, true)} disabled={loadingMore}>
              {loadingMore ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.loadMoreText}>Load More</Text>}
            </TouchableOpacity>
          ) : null}
        />
      )}

      {renderModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl, paddingBottom: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  refreshBtn: { padding: Spacing.sm },

  // Tabs
  tabs: { backgroundColor: Colors.surface, maxHeight: 48 },
  tabsContent: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, gap: Spacing.sm },
  tab: {
    paddingHorizontal: Spacing.lg, paddingVertical: 7, borderRadius: BorderRadius.round,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.white, fontWeight: '700' },

  // Card
  list: { padding: Spacing.lg, paddingBottom: 120 },
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#8B3A1A', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.sm },
  cardLeft: { flex: 1 },
  cardRight: { alignItems: 'flex-end' },
  orderNum: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  cardMeta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  cardTotal: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary },
  cardTime: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: 5,
    borderRadius: BorderRadius.round, borderWidth: 1, alignSelf: 'flex-start',
  },
  statusText: { fontSize: FontSize.sm, fontWeight: '700' },
  parcelTag: { fontSize: FontSize.xs, color: Colors.textSecondary, marginLeft: Spacing.sm },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.md },
  emptyText: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '700', marginTop: Spacing.md },
  emptySubText: { color: Colors.textSecondary, fontSize: FontSize.md },
  loadMore: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, marginTop: Spacing.sm },
  loadMoreText: { color: Colors.primary, fontWeight: '600', fontSize: FontSize.md },

  // Modal
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modal: {
    backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xxxl,
    borderTopRightRadius: BorderRadius.xxxl, padding: Spacing.xxl,
    maxHeight: '90%', borderWidth: 1, borderColor: Colors.border,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  modalOrderNum: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  modalTime: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 2 },
  closeBtn: { padding: Spacing.xs },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    padding: Spacing.md, borderRadius: BorderRadius.lg,
    borderWidth: 1, marginBottom: Spacing.lg,
  },
  statusRowText: { fontSize: FontSize.md, fontWeight: '800', flex: 1 },
  tableTag: { fontSize: FontSize.sm, color: Colors.textSecondary, backgroundColor: Colors.card, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },

  section: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  itemName: { flex: 1, fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  itemQty: { fontSize: FontSize.md, color: Colors.textSecondary, marginHorizontal: Spacing.md },
  itemTotal: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  totals: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totalLbl: { fontSize: FontSize.md, color: Colors.textSecondary },
  totalVal: { fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  grandRow: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4, paddingTop: Spacing.sm },
  grandLbl: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  grandVal: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },

  notesBox: { backgroundColor: Colors.warningBg, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.warning + '40' },
  notesLabel: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.warning, marginBottom: 3 },
  notesText: { fontSize: FontSize.md, color: Colors.text },

  actions: { gap: Spacing.md, marginTop: Spacing.sm, paddingBottom: Spacing.xxl },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, paddingVertical: 15, borderRadius: BorderRadius.lg,
  },
  actionBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  secondaryActions: { flexDirection: 'row', gap: Spacing.md },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, paddingVertical: 12, borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primaryBg,
  },
  secondaryBtnText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },
});

export default OrdersScreen;
