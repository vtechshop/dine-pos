import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { VendorReturn, VendorReturnStatus } from '../services/api';
import { PremiumGate } from '../components/PremiumGate';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_FILTERS: Array<VendorReturnStatus | 'all'> = ['all', 'draft', 'approved', 'completed', 'cancelled'];

function statusStyle(status: VendorReturnStatus): { bg: string; color: string } {
  switch (status) {
    case 'draft':     return { bg: 'rgba(97,97,97,0.12)', color: '#616161' };
    case 'approved':  return { bg: Colors.infoBg,         color: Colors.info };
    case 'completed': return { bg: Colors.successBg,      color: Colors.success };
    case 'cancelled': return { bg: Colors.dangerBg,       color: Colors.danger };
  }
}

function vendorName(vendorId: VendorReturn['vendorId']): string {
  if (typeof vendorId === 'object' && vendorId !== null) return vendorId.name;
  return 'Vendor';
}

function shortRef(id: string): string {
  return id.slice(-6).toUpperCase();
}

// ── Main Component ────────────────────────────────────────────────────────────

const VendorReturnsScreen: React.FC = () => {
  const { bottom } = useSafeAreaInsets();

  const [returns, setReturns]       = useState<VendorReturn[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [pages, setPages]           = useState(1);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<VendorReturnStatus | 'all'>('all');

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async (p = 1, refresh = false) => {
    if (p === 1) refresh ? setRefreshing(true) : setLoading(true);
    try {
      const params: Parameters<typeof api.fetchVendorReturns>[0] = { page: p, limit: 20 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const data = await api.fetchVendorReturns(params);
      if (p === 1) setReturns(data.returns);
      else setReturns(prev => [...prev, ...data.returns]);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      Alert.alert('Error', 'Failed to load vendor returns');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useFocusEffect(useCallback(() => { load(1); }, [load]));

  // ── Actions ───────────────────────────────────────────────────────────────

  const confirm = (title: string, msg: string, onConfirm: () => Promise<void>) => {
    Alert.alert(title, msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm', onPress: async () => {
          try { await onConfirm(); load(1); }
          catch (e: any) { Alert.alert('Error', e?.message || 'Action failed'); }
        },
      },
    ]);
  };

  const handleApprove = (item: VendorReturn) =>
    confirm('Approve Return', `Approve return #${shortRef(item._id)}?`,
      () => api.approveVendorReturn(item._id).then(() => {}));

  const handleComplete = (item: VendorReturn) =>
    confirm('Complete Return', `Mark return #${shortRef(item._id)} as completed?`,
      () => api.completeVendorReturn(item._id).then(() => {}));

  const handleCancel = (item: VendorReturn) =>
    confirm('Cancel Return', `Cancel return #${shortRef(item._id)}? This cannot be undone.`,
      () => api.cancelVendorReturn(item._id).then(() => {}));

  // ── Render Item ───────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: VendorReturn }) => {
    const ss = statusStyle(item.status);
    const vname = vendorName(item.vendorId);
    const firstItem = item.items[0];
    const extraCount = item.items.length - 1;

    return (
      <View style={styles.card}>
        {/* Row 1: ref + status */}
        <View style={styles.cardRow}>
          <Text style={styles.refText}>#{shortRef(item._id)}</Text>
          <View style={[styles.badge, { backgroundColor: ss.bg }]}>
            <Text style={[styles.badgeTxt, { color: ss.color }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>

        {/* Vendor */}
        <Text style={styles.cardMeta}>
          <Text style={styles.metaLabel}>Vendor: </Text>{vname}
        </Text>

        {/* Items preview */}
        {firstItem && (
          <Text style={styles.cardMeta}>
            <Text style={styles.metaLabel}>Items: </Text>
            {firstItem.productName}
            {extraCount > 0 ? ` and ${extraCount} more` : ''}
          </Text>
        )}

        {/* Total value */}
        <Text style={styles.totalValue}>
          ₹{item.totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </Text>

        {/* Date */}
        <Text style={styles.cardDate}>
          {new Date(item.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </Text>

        {/* Action buttons */}
        {item.status === 'draft' && (
          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.btnApprove} onPress={() => handleApprove(item)}>
              <MaterialIcons name="check-circle" size={14} color={Colors.white} />
              <Text style={styles.btnApproveTxt}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnCancel} onPress={() => handleCancel(item)}>
              <MaterialIcons name="cancel" size={14} color={Colors.danger} />
              <Text style={styles.btnCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
        {item.status === 'approved' && (
          <View style={styles.cardActions}>
            <TouchableOpacity style={styles.btnComplete} onPress={() => handleComplete(item)}>
              <MaterialIcons name="done-all" size={14} color={Colors.white} />
              <Text style={styles.btnCompleteTxt}>Complete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnCancel} onPress={() => handleCancel(item)}>
              <MaterialIcons name="cancel" size={14} color={Colors.danger} />
              <Text style={styles.btnCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vendor Returns</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() =>
            Alert.alert(
              'Create Vendor Return',
              'Please create vendor returns from the web panel for full vendor selection. You can approve, complete, and cancel returns here.',
              [{ text: 'OK' }],
            )
          }
        >
          <MaterialIcons name="add" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {STATUS_FILTERS.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterChipTxt, statusFilter === s && styles.filterChipTxtActive]}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* List */}
      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={returns}
          renderItem={renderItem}
          keyExtractor={i => i._id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => load(1, true)}
          onEndReached={() => { if (page < pages) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            page < pages
              ? <ActivityIndicator color={Colors.primary} style={{ margin: 16 }} />
              : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="assignment-return" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No vendor returns</Text>
              <Text style={styles.emptyText}>Create returns from the web panel</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    ...Shadows.primary,
  },

  filterBar:        { maxHeight: 48, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterBarContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm, alignItems: 'center' as const },
  filterChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.round,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  filterChipActive:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipTxt:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  filterChipTxtActive: { color: Colors.white },

  list: { padding: Spacing.lg, paddingBottom: 100 },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
    marginBottom: Spacing.md, ...Shadows.sm,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  refText:  { fontSize: FontSize.md, fontWeight: '800', color: Colors.text, letterSpacing: 1 },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: FontSize.xs, fontWeight: '700' },
  cardMeta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 4 },
  metaLabel: { fontWeight: '600', color: Colors.textMuted },
  totalValue: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.danger, marginTop: 4 },
  cardDate: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },

  cardActions: {
    flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: Spacing.md,
  },
  btnApprove: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.success, paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.md, ...Shadows.success,
  },
  btnApproveTxt: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },
  btnComplete: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.info, paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.md,
  },
  btnCompleteTxt: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },
  btnCancel: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.dangerBg, paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.danger + '40',
  },
  btnCancelTxt: { color: Colors.danger, fontSize: FontSize.sm, fontWeight: '700' },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm },
});

// ── Gated Export ──────────────────────────────────────────────────────────────

const VendorReturnsScreenGated: React.FC = () => (
  <PremiumGate feature="Supply Chain" description="Manage vendor returns, approve and track return status across your supply chain.">
    <VendorReturnsScreen />
  </PremiumGate>
);

export default VendorReturnsScreenGated;
