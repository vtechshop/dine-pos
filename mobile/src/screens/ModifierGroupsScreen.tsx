import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { ModifierGroup, ModifierOption } from '../types';
import { PremiumGate } from '../components/PremiumGate';

// ─── empty form shapes ────────────────────────────────────────────────────────
const emptyGroupForm = {
  name: '',
  description: '',
  selectionType: 'single' as 'single' | 'multi',
  isRequired: false,
  minSelections: '1',
  maxSelections: '1',
};
const emptyOptionForm = { name: '', price: '', sku: '' };

// ─── inner component (unguarded) ─────────────────────────────────────────────
const ModifierGroupsScreen: React.FC = () => {
  const { bottom } = useSafeAreaInsets();

  // list state
  const [groups, setGroups]     = useState<ModifierGroup[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // group modal
  const [showGroupModal, setShowGroupModal]   = useState(false);
  const [editingGroup, setEditingGroup]       = useState<ModifierGroup | null>(null);
  const [groupForm, setGroupForm]             = useState(emptyGroupForm);
  const [savingGroup, setSavingGroup]         = useState(false);

  // option modal
  const [showOptionModal, setShowOptionModal] = useState(false);
  const [optionTargetGroupId, setOptionTargetGroupId] = useState<string | null>(null);
  const [editingOption, setEditingOption]     = useState<ModifierOption | null>(null);
  const [optionForm, setOptionForm]           = useState(emptyOptionForm);
  const [savingOption, setSavingOption]       = useState(false);

  // ── data loading ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getModifierGroups({ search: search || undefined, limit: 100 });
      setGroups(res.groups);
    } catch {
      Alert.alert('Error', 'Failed to load modifier groups');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── group CRUD ───────────────────────────────────────────────────────────────
  const openAddGroup = () => {
    setEditingGroup(null);
    setGroupForm(emptyGroupForm);
    setShowGroupModal(true);
  };

  const openEditGroup = (g: ModifierGroup) => {
    setEditingGroup(g);
    setGroupForm({
      name:          g.name,
      description:   g.description || '',
      selectionType: g.selectionType,
      isRequired:    g.isRequired,
      minSelections: String(g.minSelections),
      maxSelections: String(g.maxSelections),
    });
    setShowGroupModal(true);
  };

  const saveGroup = async () => {
    if (!groupForm.name.trim()) {
      Alert.alert('Required', 'Group name is required'); return;
    }
    setSavingGroup(true);
    try {
      const payload = {
        name:          groupForm.name.trim(),
        description:   groupForm.description.trim() || undefined,
        selectionType: groupForm.selectionType,
        isRequired:    groupForm.isRequired,
        minSelections: parseInt(groupForm.minSelections || '1', 10) || 1,
        maxSelections: parseInt(groupForm.maxSelections || '1', 10) || 1,
      };
      if (editingGroup) {
        const updated = await api.updateModifierGroup(editingGroup._id, payload);
        setGroups(prev => prev.map(g => g._id === editingGroup._id ? updated : g));
      } else {
        const created = await api.createModifierGroup(payload);
        setGroups(prev => [...prev, created]);
      }
      setShowGroupModal(false);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally {
      setSavingGroup(false);
    }
  };

  const deleteGroup = (g: ModifierGroup) => {
    Alert.alert(
      'Delete Group',
      `Delete "${g.name}" and all its options?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await api.deleteModifierGroup(g._id);
              setGroups(prev => prev.filter(x => x._id !== g._id));
              if (expanded === g._id) setExpanded(null);
            } catch {
              Alert.alert('Error', 'Failed to delete group');
            }
          },
        },
      ]
    );
  };

  // ── option CRUD ──────────────────────────────────────────────────────────────
  const openAddOption = (groupId: string) => {
    setOptionTargetGroupId(groupId);
    setEditingOption(null);
    setOptionForm(emptyOptionForm);
    setShowOptionModal(true);
  };

  const saveOption = async () => {
    if (!optionForm.name.trim() || !optionForm.price) {
      Alert.alert('Required', 'Name and price are required'); return;
    }
    if (!optionTargetGroupId) return;
    setSavingOption(true);
    try {
      const payload = {
        name:  optionForm.name.trim(),
        price: parseFloat(optionForm.price) || 0,
        sku:   optionForm.sku.trim() || undefined,
      };
      let updated: ModifierGroup;
      if (editingOption) {
        updated = await api.updateModifierOption(optionTargetGroupId, editingOption._id, payload);
      } else {
        updated = await api.addModifierOption(optionTargetGroupId, payload);
      }
      setGroups(prev => prev.map(g => g._id === optionTargetGroupId ? updated : g));
      setShowOptionModal(false);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save option');
    } finally {
      setSavingOption(false);
    }
  };

  const deleteOption = (groupId: string, opt: ModifierOption) => {
    Alert.alert(
      'Delete Option',
      `Remove "${opt.name}" from this group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              const updated = await api.deleteModifierOption(groupId, opt._id);
              setGroups(prev => prev.map(g => g._id === groupId ? updated : g));
            } catch {
              Alert.alert('Error', 'Failed to delete option');
            }
          },
        },
      ]
    );
  };

  // ── filtered list ────────────────────────────────────────────────────────────
  const filtered = search.trim()
    ? groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
    : groups;

  // ── render group card ────────────────────────────────────────────────────────
  const renderGroup = ({ item }: { item: ModifierGroup }) => {
    const isOpen = expanded === item._id;
    return (
      <View style={styles.card}>
        {/* Card header row */}
        <TouchableOpacity
          style={styles.cardHeader}
          onPress={() => setExpanded(isOpen ? null : item._id)}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1 }}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              <View style={[
                styles.badge,
                item.selectionType === 'single' ? styles.badgeSingle : styles.badgeMulti,
              ]}>
                <Text style={item.selectionType === 'single' ? styles.badgeTxt : styles.badgeMultiTxt}>
                  {item.selectionType}
                </Text>
              </View>
              {item.isRequired && (
                <View style={styles.badgeRequired}>
                  <Text style={styles.badgeRequiredTxt}>required</Text>
                </View>
              )}
            </View>
            {item.description ? (
              <Text style={styles.cardDesc} numberOfLines={1}>{item.description}</Text>
            ) : null}
            <Text style={styles.cardMeta}>
              {item.options.length} option{item.options.length !== 1 ? 's' : ''}
              {' · '}
              <Text style={{ color: item.isActive ? Colors.success : Colors.textMuted }}>
                {item.isActive ? 'enabled' : 'disabled'}
              </Text>
            </Text>
          </View>

          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.editIconBtn}
              onPress={() => openEditGroup(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
            >
              <MaterialIcons name="edit" size={18} color={Colors.info} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteIconBtn}
              onPress={() => deleteGroup(item)}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
            >
              <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
            </TouchableOpacity>
            <MaterialIcons
              name={isOpen ? 'expand-less' : 'expand-more'}
              size={22}
              color={Colors.textMuted}
            />
          </View>
        </TouchableOpacity>

        {/* Expanded options list */}
        {isOpen && (
          <View style={styles.optionsContainer}>
            <View style={styles.optionsDivider} />
            {item.options.length === 0 ? (
              <Text style={styles.noOptions}>No options yet</Text>
            ) : (
              item.options.map(opt => (
                <View key={opt._id} style={styles.optionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionName, !opt.isActive && { color: Colors.textMuted }]}>
                      {opt.name}
                    </Text>
                    {opt.sku ? <Text style={styles.optionSku}>SKU: {opt.sku}</Text> : null}
                  </View>
                  <Text style={styles.optionPrice}>₹{opt.price.toLocaleString('en-IN')}</Text>
                  <TouchableOpacity
                    style={styles.optionDeleteBtn}
                    onPress={() => deleteOption(item._id, opt)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="remove-circle-outline" size={18} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity
              style={styles.addOptionBtn}
              onPress={() => openAddOption(item._id)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.addOptionTxt}>Add option</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // ─── main render ─────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Modifier Groups</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAddGroup}>
          <MaterialIcons name="add" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <MaterialIcons name="search" size={20} color={Colors.textMuted} style={{ marginRight: Spacing.sm }} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search modifier groups..."
          placeholderTextColor={Colors.textMuted}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="close" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderGroup}
          keyExtractor={g => g._id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="tune" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No modifier groups</Text>
              <Text style={styles.emptyText}>Tap + to create your first group</Text>
            </View>
          }
        />
      )}

      {/* ── Create / Edit Group Modal ──────────────────────────────────────── */}
      <Modal
        visible={showGroupModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGroupModal(false)}
      >
        <View style={styles.overlay}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={[styles.sheet, { paddingBottom: 40 + bottom }]}>
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>
                {editingGroup ? 'Edit Group' : 'New Modifier Group'}
              </Text>

              <Text style={styles.label}>Name *</Text>
              <TextInput
                style={styles.input}
                value={groupForm.name}
                onChangeText={v => setGroupForm(p => ({ ...p, name: v }))}
                placeholder="e.g. Add-ons, Spice Level"
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />

              <Text style={styles.label}>Description (optional)</Text>
              <TextInput
                style={styles.input}
                value={groupForm.description}
                onChangeText={v => setGroupForm(p => ({ ...p, description: v }))}
                placeholder="Brief description..."
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.label}>Selection Type</Text>
              <View style={styles.toggleRow}>
                {(['single', 'multi'] as const).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.toggleChip,
                      groupForm.selectionType === t && styles.toggleChipActive,
                    ]}
                    onPress={() => setGroupForm(p => ({ ...p, selectionType: t }))}
                  >
                    <Text style={[
                      styles.toggleChipTxt,
                      groupForm.selectionType === t && styles.toggleChipTxtActive,
                    ]}>
                      {t === 'single' ? 'Single Select' : 'Multi Select'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Required</Text>
                <Switch
                  value={groupForm.isRequired}
                  onValueChange={v => setGroupForm(p => ({ ...p, isRequired: v }))}
                  trackColor={{ false: Colors.border, true: Colors.primary + '80' }}
                  thumbColor={groupForm.isRequired ? Colors.primary : Colors.textMuted}
                />
              </View>

              {groupForm.selectionType === 'multi' && (
                <>
                  <Text style={styles.label}>Min Selections</Text>
                  <TextInput
                    style={styles.input}
                    value={groupForm.minSelections}
                    onChangeText={v => setGroupForm(p => ({ ...p, minSelections: v.replace(/[^0-9]/g, '') }))}
                    placeholder="1"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                  />

                  <Text style={styles.label}>Max Selections</Text>
                  <TextInput
                    style={styles.input}
                    value={groupForm.maxSelections}
                    onChangeText={v => setGroupForm(p => ({ ...p, maxSelections: v.replace(/[^0-9]/g, '') }))}
                    placeholder="1"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                  />
                </>
              )}

              <View style={styles.mActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setShowGroupModal(false)}
                >
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={saveGroup}
                  disabled={savingGroup}
                >
                  {savingGroup
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.saveTxt}>{editingGroup ? 'Save Changes' : 'Create Group'}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Add / Edit Option Modal ────────────────────────────────────────── */}
      <Modal
        visible={showOptionModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowOptionModal(false)}
      >
        <View style={styles.overlay}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={[styles.sheet, { paddingBottom: 40 + bottom }]}>
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>
                {editingOption ? 'Edit Option' : 'Add Option'}
              </Text>

              <Text style={styles.label}>Name *</Text>
              <TextInput
                style={styles.input}
                value={optionForm.name}
                onChangeText={v => setOptionForm(p => ({ ...p, name: v }))}
                placeholder="e.g. Extra Cheese, Spicy"
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />

              <Text style={styles.label}>Price *</Text>
              <TextInput
                style={styles.input}
                value={optionForm.price}
                onChangeText={v => setOptionForm(p => ({ ...p, price: v }))}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />

              <Text style={styles.label}>SKU (optional)</Text>
              <TextInput
                style={styles.input}
                value={optionForm.sku}
                onChangeText={v => setOptionForm(p => ({ ...p, sku: v }))}
                placeholder="SKU code..."
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
              />

              <View style={styles.mActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setShowOptionModal(false)}
                >
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={saveOption}
                  disabled={savingOption}
                >
                  {savingOption
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.saveTxt}>{editingOption ? 'Save' : 'Add Option'}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

// ─── styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    ...Shadows.primary,
  },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  searchInput: {
    flex: 1, fontSize: FontSize.md, color: Colors.text,
    paddingVertical: Spacing.sm,
  },

  list:       { padding: Spacing.lg, paddingBottom: 100 },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.md, ...Shadows.sm,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: Spacing.lg,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: 4 },
  cardName:    { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  badge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.round,
  },
  badgeSingle:    { backgroundColor: Colors.infoBg },
  badgeMulti:     { backgroundColor: Colors.accentBg },
  badgeTxt:       { fontSize: FontSize.xs, fontWeight: '700', color: Colors.info, textTransform: 'uppercase' },
  badgeMultiTxt:  { fontSize: FontSize.xs, fontWeight: '700', color: Colors.accentDark, textTransform: 'uppercase' },
  badgeRequired: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.round,
    backgroundColor: Colors.dangerBg,
  },
  badgeRequiredTxt: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.danger, textTransform: 'uppercase' },
  cardDesc:    { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 4 },
  cardMeta:    { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '500' },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginLeft: Spacing.sm },
  editIconBtn: {
    padding: 6, backgroundColor: Colors.infoBg,
    borderRadius: BorderRadius.sm,
  },
  deleteIconBtn: {
    padding: 6, backgroundColor: Colors.dangerBg,
    borderRadius: BorderRadius.sm,
  },

  optionsContainer: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  optionsDivider:   { height: 1, backgroundColor: Colors.border, marginBottom: Spacing.md },
  noOptions:        { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing.sm },

  optionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  optionName:   { fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  optionSku:    { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  optionPrice:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginRight: Spacing.sm },
  optionDeleteBtn: { padding: 4 },

  addOptionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: Spacing.md, alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.round,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  addOptionTxt: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm },

  // Modal / sheet
  overlay: { flex: 1, backgroundColor: Colors.overlay },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxxl,
    borderTopRightRadius: BorderRadius.xxxl,
    padding: Spacing.xxl, paddingBottom: 40, marginTop: 80,
  },
  handle:     { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  modalTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: Spacing.lg },
  label:      { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },

  toggleRow:        { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.sm },
  toggleChip: {
    flex: 1, paddingVertical: 10, borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.card, alignItems: 'center',
  },
  toggleChipActive: { backgroundColor: Colors.primaryBg, borderColor: Colors.primary },
  toggleChipTxt:    { fontSize: FontSize.md, fontWeight: '600', color: Colors.textSecondary },
  toggleChipTxtActive: { color: Colors.primary, fontWeight: '800' },

  switchRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.lg },
  switchLabel: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },

  mActions:  { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  cancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  saveBtn:   { flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg, backgroundColor: Colors.primary, alignItems: 'center', ...Shadows.primary },
  saveTxt:   { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },
});

// ─── gated export ─────────────────────────────────────────────────────────────
const ModifierGroupsScreenGated: React.FC = () => (
  <PremiumGate
    feature="Modifier Groups"
    description="Create and manage add-on modifier groups for your menu items."
  >
    <ModifierGroupsScreen />
  </PremiumGate>
);

export default ModifierGroupsScreenGated;
