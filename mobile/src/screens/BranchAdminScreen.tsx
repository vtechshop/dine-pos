import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { Branch, BranchStatus } from '../services/api';
import { PremiumGate } from '../components/PremiumGate';
import { RootStackParamList } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusStyle(status: BranchStatus): { bg: string; color: string } {
  switch (status) {
    case 'active':    return { bg: Colors.successBg, color: Colors.success };
    case 'suspended': return { bg: Colors.dangerBg,  color: Colors.danger };
    case 'pending':   return { bg: Colors.warningBg, color: Colors.warning };
  }
}

// ── Edit Form ─────────────────────────────────────────────────────────────────

interface EditForm { name: string; city: string; phone: string; }
const emptyEdit = (b: Branch): EditForm => ({
  name:  b.name,
  city:  b.city || '',
  phone: b.phone || '',
});

// ── Main Component ────────────────────────────────────────────────────────────

const BranchAdminScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bottom } = useSafeAreaInsets();

  const [branches, setBranches]     = useState<Branch[]>([]);
  const [total, setTotal]           = useState(0);
  const [maxBranches, setMaxBranches] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Edit modal
  const [showEdit, setShowEdit]       = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editForm, setEditForm]       = useState<EditForm>({ name: '', city: '', phone: '' });
  const [saving, setSaving]           = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const data = await api.fetchBranches();
      setBranches(data.branches);
      setTotal(data.total);
      setMaxBranches(data.maxBranches);
    } catch {
      Alert.alert('Error', 'Failed to load branches');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleToggleLoyalty = async (branch: Branch, enabled: boolean) => {
    try {
      await api.toggleBranchOrgLoyalty(branch._id, enabled);
      setBranches(prev => prev.map(b => b._id === branch._id ? { ...b, orgLoyaltyEnabled: enabled } : b));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update loyalty setting');
    }
  };

  const handleSuspend = (branch: Branch) => {
    Alert.alert(
      'Suspend Branch',
      `Suspend "${branch.name}"? It will be unable to process orders.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend', style: 'destructive', onPress: async () => {
            try { await api.deactivateBranch(branch._id); load(); }
            catch (e: any) { Alert.alert('Error', e?.message || 'Failed to suspend branch'); }
          },
        },
      ],
    );
  };

  const handleReactivate = (branch: Branch) => {
    Alert.alert(
      'Reactivate Branch',
      `Reactivate "${branch.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reactivate', onPress: async () => {
            try { await api.reactivateBranch(branch._id); load(); }
            catch (e: any) { Alert.alert('Error', e?.message || 'Failed to reactivate branch'); }
          },
        },
      ],
    );
  };

  const openEdit = (branch: Branch) => {
    setEditingBranch(branch);
    setEditForm(emptyEdit(branch));
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!editingBranch) return;
    if (!editForm.name.trim()) { Alert.alert('Validation', 'Branch name is required'); return; }
    setSaving(true);
    try {
      await api.updateBranch(editingBranch._id, {
        name:  editForm.name.trim(),
        city:  editForm.city.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
      });
      setShowEdit(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update branch');
    } finally {
      setSaving(false);
    }
  };

  // ── Render Item ───────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: Branch }) => {
    const ss = statusStyle(item.status);
    const isHQ = item.isHQ;

    return (
      <View style={styles.card}>
        {/* Row 1: name + HQ badge + edit */}
        <View style={styles.cardRow}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.branchName} numberOfLines={1}>{item.name}</Text>
            {isHQ && (
              <View style={styles.hqBadge}>
                <Text style={styles.hqBadgeTxt}>HQ</Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.editIcon} onPress={() => openEdit(item)}>
            <MaterialIcons name="edit" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Branch code + status */}
        <View style={styles.metaRow}>
          <View style={styles.codeChip}>
            <Text style={styles.codeTxt}>{item.branchCode}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: ss.bg }]}>
            <Text style={[styles.badgeTxt, { color: ss.color }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>

        {/* City + address */}
        {(item.city || item.address) && (
          <Text style={styles.addressTxt} numberOfLines={2}>
            <MaterialIcons name="place" size={13} color={Colors.textMuted} />
            {' '}{[item.city, item.address].filter(Boolean).join(' — ')}
          </Text>
        )}

        {/* Org Loyalty toggle (non-HQ only) */}
        {!isHQ && (
          <View style={styles.loyaltyRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.loyaltyLabel}>Org Loyalty</Text>
              <Text style={styles.loyaltyHint}>Share loyalty points across branches</Text>
            </View>
            <Switch
              value={item.orgLoyaltyEnabled}
              onValueChange={v => handleToggleLoyalty(item, v)}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>
        )}

        {/* Action buttons (non-HQ only) */}
        {!isHQ && (
          <View style={styles.cardActions}>
            {item.status === 'active' && (
              <TouchableOpacity style={styles.btnSuspend} onPress={() => handleSuspend(item)}>
                <MaterialIcons name="pause-circle-outline" size={14} color={Colors.danger} />
                <Text style={styles.btnSuspendTxt}>Suspend</Text>
              </TouchableOpacity>
            )}
            {item.status === 'suspended' && (
              <TouchableOpacity style={styles.btnReactivate} onPress={() => handleReactivate(item)}>
                <MaterialIcons name="play-circle-outline" size={14} color={Colors.success} />
                <Text style={styles.btnReactivateTxt}>Reactivate</Text>
              </TouchableOpacity>
            )}
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
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={28} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Branch Admin</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={branches}
          renderItem={renderItem}
          keyExtractor={i => i._id}
          contentContainerStyle={[styles.list, { paddingBottom: 40 + bottom }]}
          refreshing={refreshing}
          onRefresh={() => load(true)}
          ListHeaderComponent={
            <View>
              {/* Usage banner */}
              <View style={styles.usageBanner}>
                <MaterialIcons name="business" size={20} color={Colors.primary} />
                <Text style={styles.usageTxt}>
                  {total} branch{total !== 1 ? 'es' : ''}{maxBranches > 0 ? ` / ${maxBranches} max` : ''}
                </Text>
              </View>

              {/* Info note */}
              <View style={styles.noteCard}>
                <MaterialIcons name="info-outline" size={18} color={Colors.info} style={{ marginTop: 1 }} />
                <Text style={styles.noteTxt}>
                  To create a new branch, use the web panel. You can manage, suspend, and reactivate branches here.
                </Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="store" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No branches found</Text>
              <Text style={styles.emptyText}>This feature requires the multi-branch plan</Text>
            </View>
          }
        />
      )}

      {/* Edit Branch Modal */}
      <Modal
        visible={showEdit}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEdit(false)}
      >
        <View style={styles.overlay}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={[styles.sheet, { paddingBottom: 40 + bottom }]}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Edit Branch</Text>

              <Text style={styles.label}>Branch Name *</Text>
              <TextInput
                style={styles.input}
                value={editForm.name}
                onChangeText={v => setEditForm(p => ({ ...p, name: v }))}
                placeholder="e.g. Downtown Outlet"
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.label}>City</Text>
              <TextInput
                style={styles.input}
                value={editForm.city}
                onChangeText={v => setEditForm(p => ({ ...p, city: v }))}
                placeholder="e.g. Mumbai"
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={styles.input}
                value={editForm.phone}
                onChangeText={v => setEditForm(p => ({ ...p, phone: v }))}
                placeholder="+91 98765 43210"
                placeholderTextColor={Colors.textMuted}
                keyboardType="phone-pad"
              />

              <View style={styles.mActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setShowEdit(false)}
                >
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.saveTxt}>Save Changes</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
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

  list: { padding: Spacing.lg },

  usageBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  usageTxt: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },

  noteCard: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.infoBg, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, marginBottom: Spacing.lg,
    borderWidth: 1, borderColor: Colors.info + '30',
  },
  noteTxt: { flex: 1, fontSize: FontSize.sm, color: Colors.info, lineHeight: 20 },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
    marginBottom: Spacing.md, ...Shadows.sm,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  branchName: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text, flex: 1 },
  hqBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4,
    backgroundColor: Colors.accentBg, borderWidth: 1, borderColor: Colors.accent + '50',
  },
  hqBadgeTxt: { fontSize: FontSize.xs, fontWeight: '800', color: Colors.accentDark },
  editIcon:   { padding: 6, borderRadius: BorderRadius.md, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },

  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 6 },
  codeChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  codeTxt: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.text, letterSpacing: 1 },
  badge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt: { fontSize: FontSize.xs, fontWeight: '700' },

  addressTxt: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 6 },

  loyaltyRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.borderLight,
    marginTop: Spacing.sm,
  },
  loyaltyLabel: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  loyaltyHint:  { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  cardActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  btnSuspend: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.dangerBg, paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.danger + '40',
  },
  btnSuspendTxt: { color: Colors.danger, fontSize: FontSize.sm, fontWeight: '700' },
  btnReactivate: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successBg, paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.success + '40',
  },
  btnReactivateTxt: { color: Colors.success, fontSize: FontSize.sm, fontWeight: '700' },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm },

  // Modal
  overlay: { flex: 1, backgroundColor: Colors.overlay },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxxl, borderTopRightRadius: BorderRadius.xxxl,
    padding: Spacing.xxl, paddingBottom: 40, marginTop: 120,
  },
  handle:     { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  sheetTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },
  mActions:  { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  cancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  saveBtn:   { flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg, backgroundColor: Colors.primary, alignItems: 'center', ...Shadows.primary },
  saveTxt:   { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },
});

// ── Gated Export ──────────────────────────────────────────────────────────────

const BranchAdminScreenGated: React.FC = () => (
  <PremiumGate feature="Multi-Branch" description="Manage multiple branches, suspend or reactivate locations, and control org-wide loyalty settings.">
    <BranchAdminScreen />
  </PremiumGate>
);

export default BranchAdminScreenGated;
