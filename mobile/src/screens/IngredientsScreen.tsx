import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { showAlert } from '../utils/alert';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { Ingredient } from '../types';
import { PremiumGate } from '../components/PremiumGate';

const UNITS = ['kg', 'g', 'L', 'ml', 'pcs'];

const emptyForm = { name: '', unit: 'kg', currentStock: '', lowStockThreshold: '5', costPerUnit: '' };

const IngredientsScreen: React.FC = () => {
  const { bottom } = useSafeAreaInsets();

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState<Ingredient | null>(null);
  const [saving, setSaving]           = useState(false);
  const [form, setForm]               = useState(emptyForm);

  const [restockTarget, setRestockTarget] = useState<Ingredient | null>(null);
  const [restockQty, setRestockQty]        = useState('');
  const [restocking, setRestocking]        = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getIngredients();
      setIngredients(data);
    } catch {
      showAlert('Error', 'Failed to load ingredients');
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => { setEditing(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (ing: Ingredient) => {
    setEditing(ing);
    setForm({
      name: ing.name,
      unit: ing.unit,
      currentStock: String(ing.currentStock),
      lowStockThreshold: String(ing.lowStockThreshold),
      costPerUnit: String(ing.costPerUnit),
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { showAlert('Error', 'Ingredient name is required'); return; }
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        unit: form.unit,
        currentStock: parseFloat(form.currentStock) || 0,
        lowStockThreshold: parseFloat(form.lowStockThreshold) || 0,
        costPerUnit: parseFloat(form.costPerUnit) || 0,
      };
      if (editing) await api.updateIngredient(editing._id, data);
      else await api.createIngredient(data);
      setShowModal(false);
      load();
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const del = (ing: Ingredient) => {
    showAlert('Delete?', ing.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await api.deleteIngredient(ing._id); load(); }
          catch { showAlert('Error', 'Failed to delete'); }
        },
      },
    ]);
  };

  const openRestock = (ing: Ingredient) => { setRestockTarget(ing); setRestockQty(''); };

  const submitRestock = async () => {
    if (!restockTarget) return;
    const qty = parseFloat(restockQty);
    if (!qty || qty <= 0) { showAlert('Error', 'Enter a valid quantity'); return; }
    setRestocking(true);
    try {
      await api.restockIngredient(restockTarget._id, qty);
      setRestockTarget(null);
      load();
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to restock');
    } finally { setRestocking(false); }
  };

  const renderIngredient = ({ item }: { item: Ingredient }) => {
    const isLow = item.currentStock <= item.lowStockThreshold;
    return (
      <View style={styles.card}>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => openEdit(item)} activeOpacity={0.7}>
          <View style={styles.cardTop}>
            <Text style={styles.ingName}>{item.name}</Text>
            {isLow && (
              <View style={styles.lowBadge}>
                <MaterialIcons name="warning" size={11} color={Colors.danger} />
                <Text style={styles.lowBadgeText}>Low</Text>
              </View>
            )}
          </View>
          <Text style={[styles.ingStock, isLow && { color: Colors.danger }]}>
            {item.currentStock} {item.unit} in stock
          </Text>
          {item.costPerUnit > 0 && (
            <Text style={styles.ingCost}>₹{item.costPerUnit}/{item.unit}</Text>
          )}
        </TouchableOpacity>
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.restockBtn} onPress={() => openRestock(item)}>
            <MaterialIcons name="add-box" size={16} color={Colors.success} />
            <Text style={styles.restockBtnText}>Restock</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => del(item)} style={{ padding: 6 }}>
            <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const lowCount = ingredients.filter(i => i.currentStock <= i.lowStockThreshold).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { flex: 1 }]}>Raw Materials</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <MaterialIcons name="add" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={ingredients}
          renderItem={renderIngredient}
          keyExtractor={i => i._id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            lowCount > 0 ? (
              <View style={styles.alertBar}>
                <MaterialIcons name="warning" size={18} color={Colors.danger} />
                <Text style={styles.alertText}>{lowCount} ingredient{lowCount > 1 ? 's' : ''} running low</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="kitchen" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No Ingredients</Text>
              <Text style={styles.emptyText}>Tap + to add raw materials like Rice, Chicken, Oil...</Text>
            </View>
          }
        />
      )}

      {/* Add/Edit Modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modal, { paddingBottom: 40 + bottom }]}>
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>{editing ? 'Edit Ingredient' : 'Add Ingredient'}</Text>

            <Text style={styles.label}>Name *</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={v => setForm(p => ({ ...p, name: v }))}
              placeholder="Rice, Chicken, Oil..."
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.label}>Unit</Text>
            <View style={styles.unitRow}>
              {UNITS.map(u => (
                <TouchableOpacity
                  key={u}
                  style={[styles.unitChip, form.unit === u && styles.unitChipActive]}
                  onPress={() => setForm(p => ({ ...p, unit: u }))}
                >
                  <Text style={[styles.unitChipTxt, form.unit === u && { color: Colors.white }]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Current Stock</Text>
            <TextInput
              style={styles.input}
              value={form.currentStock}
              onChangeText={v => setForm(p => ({ ...p, currentStock: v }))}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />

            <Text style={styles.label}>Low Stock Alert Threshold</Text>
            <TextInput
              style={styles.input}
              value={form.lowStockThreshold}
              onChangeText={v => setForm(p => ({ ...p, lowStockThreshold: v }))}
              placeholder="5"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />

            <Text style={styles.label}>Cost per {form.unit} (optional)</Text>
            <TextInput
              style={styles.input}
              value={form.costPerUnit}
              onChangeText={v => setForm(p => ({ ...p, costPerUnit: v }))}
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />

            <View style={styles.mActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.saveTxt}>{editing ? 'Update' : 'Save Ingredient'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Restock Modal */}
      <Modal visible={!!restockTarget} transparent animationType="fade" onRequestClose={() => setRestockTarget(null)}>
        <View style={styles.overlay}>
          <View style={[styles.modal, { paddingBottom: 30 + bottom, marginTop: 'auto', marginBottom: 'auto', borderRadius: BorderRadius.xxl }]}>
            <Text style={styles.modalTitle}>Restock {restockTarget?.name}</Text>
            <Text style={styles.label}>Add Quantity ({restockTarget?.unit})</Text>
            <TextInput
              style={styles.input}
              value={restockQty}
              onChangeText={setRestockQty}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.mActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setRestockTarget(null)}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: Colors.success }]} onPress={submitRestock} disabled={restocking}>
                {restocking ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.saveTxt}>Add Stock</Text>}
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
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', ...Shadows.primary,
  },

  list: { padding: Spacing.lg, paddingBottom: 100 },

  alertBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.lg,
    padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.danger + '30',
  },
  alertText: { color: Colors.danger, fontWeight: '700', fontSize: FontSize.sm },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ingName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  lowBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.round,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  lowBadgeText: { fontSize: 10, fontWeight: '800', color: Colors.danger },
  ingStock: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  ingCost: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  cardActions: { alignItems: 'center', gap: 6 },
  restockBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: Colors.success + '40',
  },
  restockBtnText: { fontSize: 11, fontWeight: '700', color: Colors.success },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm, textAlign: 'center', paddingHorizontal: Spacing.xl },

  overlay: { flex: 1, backgroundColor: Colors.overlay },
  modal: {
    backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xxxl,
    borderTopRightRadius: BorderRadius.xxxl, padding: Spacing.xxl, paddingBottom: 40, marginTop: 60,
    marginHorizontal: Spacing.lg,
  },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  modalTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },
  unitRow: { flexDirection: 'row', gap: Spacing.sm },
  unitChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.round,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  unitChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  unitChipTxt: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },

  mActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  cancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  saveBtn:   { flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg, backgroundColor: Colors.primary, alignItems: 'center', ...Shadows.primary },
  saveTxt:   { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },
});

const IngredientsScreenGated: React.FC = () => (
  <PremiumGate feature="Raw Material Inventory" description="Track ingredient stock, set low-stock alerts, and link recipes to products for automatic deduction on every sale.">
    <IngredientsScreen />
  </PremiumGate>
);

export default IngredientsScreenGated;
