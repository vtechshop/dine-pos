import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import { Coupon } from '../types';

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({
  code: '',
  description: '',
  type: 'percent' as 'percent' | 'flat',
  value: '',
  minOrderValue: '',
  maxDiscount: '',
  validFrom: todayStr(),
  validUntil: '',
  usageLimit: '',
  perCustomerLimit: '',
  isActive: true,
});

const CouponScreen: React.FC = () => {
  const { settings } = useSettings();
  const { bottom } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState(emptyForm());
  const [filterActive, setFilterActive] = useState<boolean | undefined>(undefined);
  const [page, setPage]       = useState(1);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const data = await api.getCoupons({ page: p, ...(filterActive !== undefined ? { active: filterActive } : {}) });
      if (p === 1) setCoupons(data.coupons);
      else setCoupons(prev => [...prev, ...data.coupons]);
      setTotal(data.total);
      setPage(p);
    } catch {
      Alert.alert('Error', 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  }, [filterActive]);

  useFocusEffect(useCallback(() => { load(1); }, [load]));

  const openCreate = () => {
    setForm(emptyForm());
    setShowModal(true);
  };

  const save = async () => {
    const code = form.code.trim().toUpperCase();
    if (!code) { Alert.alert('Validation', 'Coupon code is required'); return; }
    const value = parseFloat(form.value);
    if (!value || value <= 0) { Alert.alert('Validation', 'Discount value must be > 0'); return; }
    if (form.type === 'percent' && value > 100) { Alert.alert('Validation', 'Percentage cannot exceed 100'); return; }
    if (!form.validFrom) { Alert.alert('Validation', 'Valid from date is required'); return; }

    setSaving(true);
    try {
      await api.createCoupon({
        code,
        description: form.description.trim(),
        type: form.type,
        value,
        minOrderValue: form.minOrderValue ? parseFloat(form.minOrderValue) : 0,
        maxDiscount: form.maxDiscount ? parseFloat(form.maxDiscount) : undefined,
        validFrom: form.validFrom,
        validUntil: form.validUntil || undefined,
        usageLimit: form.usageLimit ? parseInt(form.usageLimit, 10) : undefined,
        perCustomerLimit: form.perCustomerLimit ? parseInt(form.perCustomerLimit, 10) : undefined,
        isActive: form.isActive,
      });
      setShowModal(false);
      load(1);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to create coupon');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = (id: string, code: string) => {
    Alert.alert('Deactivate', `Deactivate coupon ${code}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate', style: 'destructive', onPress: async () => {
          try {
            await api.deactivateCoupon(id);
            load(1);
          } catch { Alert.alert('Error', 'Failed to deactivate'); }
        },
      },
    ]);
  };

  const renderCoupon = ({ item }: { item: Coupon }) => {
    const discountLabel = item.type === 'percent'
      ? `${item.value}%${item.maxDiscount ? ` (max ${fmt(item.maxDiscount)})` : ''}`
      : fmt(item.value);
    const expired = item.validUntil ? new Date(item.validUntil) < new Date() : false;
    const statusColor = !item.isActive ? Colors.textMuted : expired ? '#F59E0B' : Colors.success;
    const statusLabel = !item.isActive ? 'Inactive' : expired ? 'Expired' : 'Active';

    return (
      <View style={[styles.card, !item.isActive && { opacity: 0.6 }]}>
        <View style={styles.cardHeader}>
          <View style={styles.codeTag}>
            <Text style={styles.codeText}>{item.code}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}

        <View style={styles.row}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Discount</Text>
            <Text style={styles.infoValue}>{discountLabel}</Text>
          </View>
          {item.minOrderValue > 0 && (
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Min Order</Text>
              <Text style={styles.infoValue}>{fmt(item.minOrderValue)}</Text>
            </View>
          )}
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Used</Text>
            <Text style={styles.infoValue}>
              {item.usageCount}{item.usageLimit ? `/${item.usageLimit}` : ''}
            </Text>
          </View>
        </View>

        {(item.validFrom || item.validUntil) && (
          <Text style={styles.validity}>
            {item.validFrom ? `From ${item.validFrom}` : ''}
            {item.validUntil ? ` · Until ${item.validUntil}` : ''}
          </Text>
        )}

        {item.isActive && !expired && (
          <TouchableOpacity style={styles.deactivateBtn} onPress={() => deactivate(item._id, item.code)}>
            <MaterialIcons name="block" size={14} color={Colors.danger} />
            <Text style={styles.deactivateBtnText}>Deactivate</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Coupons</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
          <MaterialIcons name="add" size={20} color={Colors.white} />
          <Text style={styles.addBtnText}>New Coupon</Text>
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={styles.filterRow}>
        {([undefined, true, false] as const).map((val) => {
          const label = val === undefined ? 'All' : val ? 'Active' : 'Inactive';
          return (
            <TouchableOpacity
              key={label}
              style={[styles.filterChip, filterActive === val && styles.filterChipActive]}
              onPress={() => { setFilterActive(val); }}
            >
              <Text style={[styles.filterChipText, filterActive === val && styles.filterChipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <Text style={styles.totalText}>{total} coupon{total !== 1 ? 's' : ''}</Text>
      </View>

      {loading && page === 1 ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={item => item._id}
          renderItem={renderCoupon}
          contentContainerStyle={{ padding: Spacing.md }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="local-offer" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No coupons yet</Text>
              <Text style={styles.emptyHint}>Tap "New Coupon" to create one</Text>
            </View>
          }
          onEndReached={() => { if (coupons.length < total) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loading && page > 1 ? <ActivityIndicator color={Colors.primary} style={{ margin: 16 }} /> : null}
        />
      )}

      {/* Create Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Coupon</Text>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <MaterialIcons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Coupon Code *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. WELCOME20"
              placeholderTextColor={Colors.textMuted}
              value={form.code}
              onChangeText={v => setForm(f => ({ ...f, code: v.toUpperCase() }))}
              autoCapitalize="characters"
            />

            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 20% off on first visit"
              placeholderTextColor={Colors.textMuted}
              value={form.description}
              onChangeText={v => setForm(f => ({ ...f, description: v }))}
            />

            <Text style={styles.fieldLabel}>Discount Type *</Text>
            <View style={styles.segmentRow}>
              {(['percent', 'flat'] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.segment, form.type === t && styles.segmentActive]}
                  onPress={() => setForm(f => ({ ...f, type: t }))}
                >
                  <Text style={[styles.segmentText, form.type === t && styles.segmentTextActive]}>
                    {t === 'percent' ? '% Percent' : `${cur} Flat`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>
              {form.type === 'percent' ? 'Percentage (0–100) *' : `Flat Amount (${cur}) *`}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={form.type === 'percent' ? '20' : '100'}
              placeholderTextColor={Colors.textMuted}
              value={form.value}
              onChangeText={v => setForm(f => ({ ...f, value: v }))}
              keyboardType="decimal-pad"
            />

            {form.type === 'percent' && (
              <>
                <Text style={styles.fieldLabel}>Max Discount ({cur})</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Leave blank for no cap"
                  placeholderTextColor={Colors.textMuted}
                  value={form.maxDiscount}
                  onChangeText={v => setForm(f => ({ ...f, maxDiscount: v }))}
                  keyboardType="decimal-pad"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Min Order Value ({cur})</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
              value={form.minOrderValue}
              onChangeText={v => setForm(f => ({ ...f, minOrderValue: v }))}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Valid From *</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              value={form.validFrom}
              onChangeText={v => setForm(f => ({ ...f, validFrom: v }))}
            />

            <Text style={styles.fieldLabel}>Valid Until</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD (blank = no expiry)"
              placeholderTextColor={Colors.textMuted}
              value={form.validUntil}
              onChangeText={v => setForm(f => ({ ...f, validUntil: v }))}
            />

            <Text style={styles.fieldLabel}>Total Usage Limit</Text>
            <TextInput
              style={styles.input}
              placeholder="Leave blank for unlimited"
              placeholderTextColor={Colors.textMuted}
              value={form.usageLimit}
              onChangeText={v => setForm(f => ({ ...f, usageLimit: v }))}
              keyboardType="number-pad"
            />

            <Text style={styles.fieldLabel}>Per Customer Limit</Text>
            <TextInput
              style={styles.input}
              placeholder="Leave blank for unlimited"
              placeholderTextColor={Colors.textMuted}
              value={form.perCustomerLimit}
              onChangeText={v => setForm(f => ({ ...f, perCustomerLimit: v }))}
              keyboardType="number-pad"
            />

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Active</Text>
              <Switch
                value={form.isActive}
                onValueChange={v => setForm(f => ({ ...f, isActive: v }))}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor={Colors.white}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={save}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.saveBtnText}>Create Coupon</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  addBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },

  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  filterChip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.border,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: FontSize.sm, color: Colors.textMuted },
  filterChipTextActive: { color: Colors.white, fontWeight: '700' },
  totalText: { marginLeft: 'auto', fontSize: FontSize.xs, color: Colors.textMuted },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, marginBottom: Spacing.sm, ...Shadows.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  codeTag: {
    backgroundColor: Colors.primary + '15', paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  codeText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary, letterSpacing: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.round },
  statusText: { fontSize: FontSize.xs, fontWeight: '700' },
  desc: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 8 },

  row: { flexDirection: 'row', gap: Spacing.md, marginBottom: 6 },
  infoItem: {},
  infoLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 2 },
  infoValue: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },

  validity: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  deactivateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: Spacing.sm, alignSelf: 'flex-end',
  },
  deactivateBtnText: { fontSize: FontSize.xs, color: Colors.danger, fontWeight: '600' },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: FontSize.lg, color: Colors.textMuted, marginTop: Spacing.md },
  emptyHint: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },

  // Modal
  modal: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.md, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  modalBody: { padding: Spacing.md },

  fieldLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: 4, marginTop: Spacing.sm },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.sm, fontSize: FontSize.md, color: Colors.text,
  },
  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segment: {
    flex: 1, paddingVertical: Spacing.sm, alignItems: 'center',
    borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  segmentActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segmentText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: Colors.white },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },

  saveBtn: {
    backgroundColor: Colors.primary, padding: Spacing.md, borderRadius: BorderRadius.md,
    alignItems: 'center', marginTop: Spacing.lg, marginBottom: 40,
  },
  saveBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
});

export default CouponScreen;
