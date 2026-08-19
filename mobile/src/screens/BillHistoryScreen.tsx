import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  TextInput, ActivityIndicator, Modal, Alert, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Order } from '../types';
import { searchOrders, cancelOrder, getSettings, getCashierToken, decodeJwtPayload } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'BillHistory'>;

type DateFilter = 'today' | 'week' | 'month';
type StatusFilter = 'all' | 'completed' | 'cancelled';

const PAGE_SIZE = 20;

// ── Date range helpers ───────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getDateRange(filter: DateFilter): { from: string; to: string } {
  const now = new Date();
  const today = toDateStr(now);
  if (filter === 'today') return { from: today, to: today };
  if (filter === 'week') {
    const past = new Date(now);
    past.setDate(past.getDate() - 6);
    return { from: toDateStr(past), to: today };
  }
  // month
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateStr(firstDay), to: today };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  pending:   Colors.warning,
  preparing: Colors.info,
  ready:     Colors.success,
  served:    Colors.served,
  completed: Colors.textSecondary,
  cancelled: Colors.danger,
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', preparing: 'Preparing', ready: 'Ready',
  served: 'Served', completed: 'Completed', cancelled: 'Cancelled',
};

const PM_COLOR: Record<string, string> = {
  cash: Colors.success,
  upi: '#6A1B9A', upi_intent: '#6A1B9A', upi_qr: '#6A1B9A', upi_collect: '#6A1B9A',
  card: Colors.info,
  split: Colors.warning,
  razorpay: Colors.info,
};

function pmLabel(method: string): string {
  return method.replace(/_/g, ' ').toUpperCase();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function orderTypeLabel(order: Order): string {
  if (order.orderSource === 'swiggy') return 'Swiggy';
  if (order.orderSource === 'zomato') return 'Zomato';
  if (order.isParcel) return 'Takeaway';
  if (order.tableNumber) return `Table ${order.tableNumber}`;
  return 'Dine In';
}

function orderTypeIcon(order: Order): keyof typeof MaterialIcons.glyphMap {
  if (order.orderSource === 'swiggy' || order.orderSource === 'zomato') return 'delivery-dining';
  if (order.isParcel) return 'shopping-bag';
  return 'restaurant';
}

// ── Main Component ────────────────────────────────────────────────────────────

const BillHistoryScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter]   = useState<DateFilter>('today');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // ── List state ────────────────────────────────────────────────────────────
  const [orders, setOrders]         = useState<Order[]>([]);
  const [loading, setLoading]       = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // ── Detail modal ──────────────────────────────────────────────────────────
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // ── Settings / auth ───────────────────────────────────────────────────────
  const [sym, setSym]       = useState('₹');
  const [isAdmin, setIsAdmin] = useState(false);

  // ── Debounce ref ──────────────────────────────────────────────────────────
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstRender  = useRef(true);
  const reqSeqRef    = useRef(0);

  // Stable refs for use inside timeouts without adding to dep arrays
  const dfRef = useRef(dateFilter);
  const sfRef = useRef(statusFilter);
  dfRef.current = dateFilter;
  sfRef.current = statusFilter;

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    getSettings().then(s => setSym(s.currencySymbol || '₹')).catch(() => {});
    getCashierToken().then(t => {
      if (!t) { setIsAdmin(false); return; }
      try {
        const payload = decodeJwtPayload(t);
        setIsAdmin(payload?.role === 'admin');
      } catch {
        setIsAdmin(false);
      }
    }).catch(() => setIsAdmin(false));
  }, []);

  // ── Core fetch ────────────────────────────────────────────────────────────

  const load = useCallback(async (
    q: string,
    df: DateFilter,
    sf: StatusFilter,
    pg: number,
  ) => {
    const seq = ++reqSeqRef.current;
    if (pg === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const { from, to } = getDateRange(df);
      const result = await searchOrders({
        q:      q.trim() || undefined,
        status: sf !== 'all' ? sf : undefined,
        from,
        to,
        page:   pg,
        limit:  PAGE_SIZE,
      });

      if (reqSeqRef.current !== seq) return;
      if (pg === 1) {
        setOrders(result.orders);
      } else {
        setOrders(prev => [...prev, ...result.orders]);
      }
      setTotalPages(result.pages ?? 1);
      setPage(pg);
    } catch (err: any) {
      if (reqSeqRef.current !== seq) return;
      if (pg === 1) Alert.alert('Error', err?.message || 'Failed to load orders');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // ── Effects ───────────────────────────────────────────────────────────────

  // Immediate reload when date/status filter changes
  useEffect(() => {
    setOrders([]);
    setPage(1);
    load(searchQuery, dateFilter, statusFilter, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, statusFilter, load]);

  // Debounced reload when search query changes (skip very first render — handled above)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOrders([]);
      setPage(1);
      load(searchQuery, dfRef.current, sfRef.current, 1);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, load]);

  // ── Pagination ────────────────────────────────────────────────────────────

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && !loading && page < totalPages) {
      load(searchQuery, dateFilter, statusFilter, page + 1);
    }
  }, [loadingMore, loading, page, totalPages, searchQuery, dateFilter, statusFilter, load]);

  // ── Cancel workflow ───────────────────────────────────────────────────────

  const handleCancelOrder = useCallback(() => {
    if (!selectedOrder) return;
    Alert.alert(
      'Confirm Cancel',
      'This cannot be undone',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'destructive',
          onPress: async () => {
            setCancelLoading(true);
            try {
              await cancelOrder(selectedOrder._id, 'Admin cancelled from mobile');
              setSelectedOrder(null);
              setOrders([]);
              setPage(1);
              load(searchQuery, dateFilter, statusFilter, 1);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to cancel order');
            } finally {
              setCancelLoading(false);
            }
          },
        },
      ],
    );
  }, [selectedOrder, searchQuery, dateFilter, statusFilter, load]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderOrderCard = useCallback(({ item }: { item: Order }) => {
    const token = item.orderNumber.split('-').pop() || '?';
    const sc = STATUS_COLOR[item.status] || Colors.textMuted;
    const pc = PM_COLOR[item.paymentMethod] || Colors.textMuted;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => setSelectedOrder(item)}
        activeOpacity={0.88}
      >
        <View style={styles.cardRow}>
          {/* Token badge */}
          <View style={[styles.tokenBadge, { backgroundColor: sc + '18' }]}>
            <Text style={[styles.tokenText, { color: sc }]}>#{token}</Text>
          </View>

          {/* Order info */}
          <View style={styles.cardMid}>
            <View style={styles.cardTopRow}>
              <MaterialIcons name={orderTypeIcon(item)} size={13} color={Colors.textMuted} />
              <Text style={styles.orderTypeText}>{orderTypeLabel(item)}</Text>
              {!!item.customerName && (
                <Text style={styles.customerNameText} numberOfLines={1}>· {item.customerName}</Text>
              )}
            </View>
            <View style={styles.cardBotRow}>
              <View style={[styles.statusPill, { backgroundColor: sc + '18' }]}>
                <View style={[styles.statusDot, { backgroundColor: sc }]} />
                <Text style={[styles.statusPillText, { color: sc }]}>
                  {STATUS_LABEL[item.status] || item.status}
                </Text>
              </View>
              {item.status === 'completed' && (
                <View style={[styles.pmBadge, { backgroundColor: pc + '18' }]}>
                  <Text style={[styles.pmBadgeText, { color: pc }]}>
                    {pmLabel(item.paymentMethod)}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Amount + time */}
          <View style={styles.cardRight}>
            <Text style={styles.cardTotal}>{sym}{(item.grandTotal ?? 0).toFixed(0)}</Text>
            <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
            <Text style={styles.cardTime}>{formatTime(item.createdAt)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [sym]);

  const renderDetailModal = () => {
    if (!selectedOrder) return null;
    const o = selectedOrder;
    const sc = STATUS_COLOR[o.status] || Colors.textMuted;
    const pc = PM_COLOR[o.paymentMethod] || Colors.textMuted;
    const canCancel = isAdmin && o.status === 'pending';

    return (
      <Modal
        visible
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setSelectedOrder(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedOrder(null)}
        >
          {/* Inner view prevents overlay tap from closing when touching sheet */}
          <TouchableOpacity activeOpacity={1} style={styles.modalSheetWrap} onPress={() => {}}>
            <View style={[styles.modalSheet, { paddingBottom: Math.max(bottom, 16) + 8 }]}>
              <View style={styles.modalHandle} />

              {/* Header */}
              <View style={styles.detailHeader}>
                <View style={{ flex: 1, marginRight: Spacing.md }}>
                  <Text style={styles.detailOrderNum}>{o.orderNumber}</Text>
                  <Text style={styles.detailSub}>
                    {orderTypeLabel(o)} · {formatDate(o.createdAt)} {formatTime(o.createdAt)}
                  </Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: sc + '18' }]}>
                  <View style={[styles.statusDot, { backgroundColor: sc }]} />
                  <Text style={[styles.statusPillText, { color: sc }]}>
                    {STATUS_LABEL[o.status] || o.status}
                  </Text>
                </View>
              </View>

              {(!!o.customerName || !!o.customerPhone) && (
                <View style={styles.detailCustomerRow}>
                  <MaterialIcons name="person" size={14} color={Colors.textMuted} />
                  <Text style={styles.detailCustomerText}>
                    {[o.customerName, o.customerPhone].filter(Boolean).join('  ·  ')}
                  </Text>
                </View>
              )}

              {/* Items */}
              <Text style={styles.sectionTitle}>Items</Text>
              <View style={styles.itemsBlock}>
                {o.items.map((it, i) => (
                  <View key={i} style={styles.detailItemRow}>
                    <Text style={styles.detailItemQty}>{it.quantity}×</Text>
                    <Text style={styles.detailItemName} numberOfLines={2}>
                      {it.productName}
                      {it.variantName ? ` (${it.variantName})` : ''}
                    </Text>
                    <Text style={styles.detailItemPrice}>{sym}{(it.total ?? 0).toFixed(0)}</Text>
                  </View>
                ))}
              </View>

              {/* Payment breakdown */}
              <Text style={styles.sectionTitle}>Payment</Text>
              <View style={styles.breakdownBlock}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Subtotal</Text>
                  <Text style={styles.breakdownVal}>{sym}{(o.subtotal ?? 0).toFixed(2)}</Text>
                </View>
                {o.taxTotal > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Tax</Text>
                    <Text style={styles.breakdownVal}>{sym}{(o.taxTotal ?? 0).toFixed(2)}</Text>
                  </View>
                )}
                {o.discountAmount > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Discount</Text>
                    <Text style={[styles.breakdownVal, { color: Colors.success }]}>
                      -{sym}{(o.discountAmount ?? 0).toFixed(2)}
                    </Text>
                  </View>
                )}
                <View style={[styles.breakdownRow, styles.breakdownTotalRow]}>
                  <Text style={styles.breakdownTotalLabel}>Total</Text>
                  <Text style={styles.breakdownTotalVal}>{sym}{(o.grandTotal ?? 0).toFixed(2)}</Text>
                </View>
                {o.status === 'completed' && (
                  <View style={{ marginTop: Spacing.sm }}>
                    <View style={[styles.pmBadge, { backgroundColor: pc + '18', alignSelf: 'flex-start' }]}>
                      <Text style={[styles.pmBadgeText, { color: pc }]}>
                        {pmLabel(o.paymentMethod)}
                      </Text>
                    </View>
                    {o.splitDetails && (o.splitDetails.cash || o.splitDetails.upi || o.splitDetails.card) ? (
                      <View style={styles.splitDetail}>
                        {o.splitDetails.cash ? (
                          <Text style={styles.splitDetailText}>
                            Cash: {sym}{o.splitDetails.cash.toFixed(2)}
                          </Text>
                        ) : null}
                        {o.splitDetails.upi ? (
                          <Text style={styles.splitDetailText}>
                            UPI: {sym}{o.splitDetails.upi.toFixed(2)}
                          </Text>
                        ) : null}
                        {o.splitDetails.card ? (
                          <Text style={styles.splitDetailText}>
                            Card: {sym}{o.splitDetails.card.toFixed(2)}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                )}
              </View>

              {/* Notes */}
              {!!o.notes && (
                <View style={styles.notesRow}>
                  <MaterialIcons name="notes" size={14} color={Colors.warning} />
                  <Text style={styles.notesText}>{o.notes}</Text>
                </View>
              )}

              {/* Cancel button — admin + pending only */}
              {canCancel && (
                <TouchableOpacity
                  style={[styles.cancelOrderBtn, cancelLoading && styles.cancelOrderBtnDisabled]}
                  onPress={handleCancelOrder}
                  disabled={cancelLoading}
                  activeOpacity={0.85}
                >
                  {cancelLoading ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <>
                      <MaterialIcons name="cancel" size={18} color={Colors.white} />
                      <Text style={styles.cancelOrderBtnText}>Cancel Order</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.closeSheetBtn}
                onPress={() => setSelectedOrder(null)}
                activeOpacity={0.8}
              >
                <Text style={styles.closeSheetBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  };

  // ── Screen ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: top }]}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bill History</Text>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => {
            setOrders([]);
            setPage(1);
            load(searchQuery, dateFilter, statusFilter, 1);
          }}
        >
          <MaterialIcons name="refresh" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <MaterialIcons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Order number or customer name…"
          placeholderTextColor={Colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchQuery('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Date filter quick-select */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
      >
        {(
          [
            { key: 'today', label: 'Today' },
            { key: 'week',  label: 'Last 7 Days' },
            { key: 'month', label: 'This Month' },
          ] as { key: DateFilter; label: string }[]
        ).map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.filterChip, dateFilter === key && styles.filterChipActive]}
            onPress={() => setDateFilter(key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterChipText, dateFilter === key && styles.filterChipTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Status tabs */}
      <View style={styles.statusTabBar}>
        {(
          [
            { key: 'all',       label: 'All' },
            { key: 'completed', label: 'Completed' },
            { key: 'cancelled', label: 'Cancelled' },
          ] as { key: StatusFilter; label: string }[]
        ).map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.statusTab, statusFilter === key && styles.statusTabActive]}
            onPress={() => setStatusFilter(key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.statusTabText, statusFilter === key && styles.statusTabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Order list */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.info} />
          <Text style={styles.loadingText}>Loading orders…</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={item => item._id}
          renderItem={renderOrderCard}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: bottom + 32 }}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                size="small"
                color={Colors.info}
                style={{ marginVertical: Spacing.xl }}
              />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>🧾</Text>
              <Text style={styles.emptyText}>No orders found</Text>
              <Text style={styles.emptySubText}>
                Try a different search term or date range
              </Text>
            </View>
          }
        />
      )}

      {/* Detail bottom sheet */}
      {renderDetailModal()}
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  // ── Search ──────────────────────────────────────────────────────────────────
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    marginBottom: 2, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md,
    paddingVertical: 10, borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: FontSize.md, color: Colors.text, paddingVertical: 0 },

  // ── Date filter chips ───────────────────────────────────────────────────────
  filterRow: { marginTop: Spacing.sm },
  filterRowContent: { gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: BorderRadius.round,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.infoBg, borderColor: Colors.info },
  filterChipText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.info },

  // ── Status tabs ─────────────────────────────────────────────────────────────
  statusTabBar: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border, marginTop: Spacing.sm,
  },
  statusTab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statusTabActive: { borderBottomWidth: 2.5, borderBottomColor: Colors.info },
  statusTabText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  statusTabTextActive: { color: Colors.info, fontWeight: '800' },

  // ── Order card ──────────────────────────────────────────────────────────────
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.md, marginBottom: Spacing.sm,
    ...Shadows.sm, borderWidth: 1, borderColor: Colors.border,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  tokenBadge: {
    width: 46, height: 46, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  tokenText: { fontSize: FontSize.xs, fontWeight: '900' },
  cardMid: { flex: 1, gap: 5 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  orderTypeText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  customerNameText: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  cardBotRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.round,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: FontSize.xs, fontWeight: '700' },
  pmBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: BorderRadius.sm },
  pmBadgeText: { fontSize: FontSize.xs, fontWeight: '800' },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  cardTotal: { fontSize: FontSize.md, fontWeight: '900', color: Colors.text },
  cardDate: { fontSize: FontSize.xs, color: Colors.textMuted },
  cardTime: { fontSize: FontSize.xs, color: Colors.textMuted },

  // ── Loading / empty ─────────────────────────────────────────────────────────
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontSize: FontSize.md, color: Colors.textSecondary },
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: Spacing.sm },
  emptyIcon: { fontSize: 44 },
  emptyText: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySubText: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },

  // ── Detail modal ────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  modalSheetWrap: { width: '100%' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxl, borderTopRightRadius: BorderRadius.xxl,
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg,
    maxHeight: '90%',
    ...Shadows.lg,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.lg,
  },
  detailHeader: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.sm,
  },
  detailOrderNum: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.text },
  detailSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  detailCustomerRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  detailCustomerText: { fontSize: FontSize.sm, color: Colors.textSecondary },

  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: '800', color: Colors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: Spacing.md, marginBottom: Spacing.sm,
  },

  // Items
  itemsBlock: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, gap: 6,
  },
  detailItemRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
  },
  detailItemQty: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.info, width: 28 },
  detailItemName: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  detailItemPrice: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },

  // Breakdown
  breakdownBlock: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  breakdownRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3,
  },
  breakdownLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  breakdownVal: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  breakdownTotalRow: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    marginTop: Spacing.xs, paddingTop: Spacing.sm,
  },
  breakdownTotalLabel: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  breakdownTotalVal: { fontSize: FontSize.md, fontWeight: '900', color: Colors.info },
  splitDetail: { gap: 2, marginTop: Spacing.xs, paddingLeft: Spacing.sm },
  splitDetailText: { fontSize: FontSize.xs, color: Colors.textMuted },

  // Notes
  notesRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.md,
    padding: Spacing.sm, marginTop: Spacing.md,
  },
  notesText: { flex: 1, fontSize: FontSize.sm, color: Colors.warning },

  // Cancel
  cancelOrderBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.danger,
    borderRadius: BorderRadius.lg, paddingVertical: 14, marginTop: Spacing.lg,
  },
  cancelOrderBtnDisabled: { opacity: 0.55 },
  cancelOrderBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Close sheet
  closeSheetBtn: {
    alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.sm,
  },
  closeSheetBtnText: { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: '600' },
});

export default BillHistoryScreen;
